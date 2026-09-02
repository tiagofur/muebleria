package pilotreadiness

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"testing"
)

type teamHTTPResult struct {
	status int
	header http.Header
	body   []byte
}

type teamHTTPMember struct {
	MembershipID      string   `json:"membership_id"`
	UserID            string   `json:"user_id"`
	MembershipStatus  string   `json:"membership_status"`
	Roles             []string `json:"roles"`
	Version           int64    `json:"version"`
	LastActivity      *string  `json:"last_activity"`
	CredentialVersion int64    `json:"credential_version"`
	SessionsRevokedAt *string  `json:"sessions_revoked_at"`
}

func sendTeamHTTPRequest(t *testing.T, path, token, key string, version int64, body any) teamHTTPResult {
	t.Helper()
	var payload []byte
	if body != nil {
		var err error
		payload, err = json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
	}
	req, err := http.NewRequest(http.MethodPost, fx.base+path, bytes.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if key != "" {
		req.Header.Set("Idempotency-Key", key)
	}
	if version > 0 {
		req.Header.Set("If-Match", `"v`+strconv.FormatInt(version, 10)+`"`)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return teamHTTPResult{status: resp.StatusCode, header: resp.Header.Clone(), body: raw}
}

func requireTeamHTTPStatus(t *testing.T, result teamHTTPResult, status int) {
	t.Helper()
	if result.status != status {
		t.Fatalf("status=%d want=%d body=%s", result.status, status, truncate(result.body))
	}
}

func requireTeamHTTPError(t *testing.T, result teamHTTPResult, status int, code string) {
	t.Helper()
	requireTeamHTTPStatus(t, result, status)
	var response struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(result.body, &response); err != nil || response.Code != code {
		t.Fatalf("error=%+v decode=%v body=%s", response, err, result.body)
	}
}

func teamDirectory(t *testing.T, token string) []teamHTTPMember {
	t.Helper()
	var directory struct {
		Items []teamHTTPMember `json:"items"`
	}
	fx.decode(t, http.MethodGet, "/api/org/memberships", token, nil, http.StatusOK, &directory)
	return directory.Items
}

func findTeamHTTPMember(t *testing.T, members []teamHTTPMember, userID string) teamHTTPMember {
	t.Helper()
	for _, member := range members {
		if member.UserID == userID {
			return member
		}
	}
	t.Fatalf("user %s missing from Team directory", userID)
	return teamHTTPMember{}
}

func TestPilotReadiness_TeamCommandsExecuteThroughRealHTTPAndPostgres(t *testing.T) {
	accepted := fx.inviteAndAccept(t, fx.a.admin.token, "team-command-flow@pilot-readiness.test", "produccion")
	if len(accepted.Memberships) != 1 {
		t.Fatalf("accepted memberships=%+v", accepted.Memberships)
	}
	targetID := accepted.Memberships[0].ID
	source := findTeamHTTPMember(t, teamDirectory(t, fx.a.admin.token), fx.a.admin.id)

	unauthorized := sendTeamHTTPRequest(t, "/api/org/memberships/"+targetID+":change-sectors", "", "team-http-unauthorized-0001", 1, map[string]any{"sectors": []string{"cutting"}, "reason": "line assignment"})
	requireTeamHTTPError(t, unauthorized, http.StatusUnauthorized, "UNAUTHORIZED")
	missingIdempotency := sendTeamHTTPRequest(t, "/api/org/memberships/"+targetID+":change-sectors", fx.a.admin.token, "", 1, map[string]any{"sectors": []string{"cutting"}, "reason": "line assignment"})
	requireTeamHTTPError(t, missingIdempotency, http.StatusBadRequest, "BAD_REQUEST")

	sectors := sendTeamHTTPRequest(t, "/api/org/memberships/"+targetID+":change-sectors", fx.a.admin.token, "team-http-sectors-0001", 1, map[string]any{"sectors": []string{"cutting"}, "reason": "line assignment"})
	requireTeamHTTPStatus(t, sectors, http.StatusOK)
	stale := sendTeamHTTPRequest(t, "/api/org/memberships/"+targetID+":change-sectors", fx.a.admin.token, "team-http-sectors-stale-0001", 1, map[string]any{"sectors": []string{"cnc"}, "reason": "stale assignment"})
	requireTeamHTTPError(t, stale, http.StatusPreconditionFailed, "MEMBERSHIP_VERSION_CONFLICT")
	clearSectors := sendTeamHTTPRequest(t, "/api/org/memberships/"+targetID+":change-sectors", fx.a.admin.token, "team-http-sectors-clear-0001", 2, map[string]any{"sectors": []string{}, "reason": "prepare admin handoff"})
	requireTeamHTTPStatus(t, clearSectors, http.StatusOK)

	transferBody := map[string]any{"target_membership_id": targetID, "target_version": 3, "demote_source": false, "reason": "coverage handoff"}
	// #460 SEC-7: transfer-admin is organization_admin step-up gated; the
	// step-up boundary runs BEFORE the handler, so a foreign org admin without
	// elevated authority sees the challenge — fail-closed: the target's
	// existence is not processed without it. The exact code depends on whether
	// that user already enrolled a factor in an earlier test (shared fixture),
	// and BOTH prove the gate: MFA_REQUIRED (no factor) or STEP_UP_REQUIRED
	// (factor, no fresh grant).
	crossOrg := sendTeamHTTPRequest(t, "/api/org/memberships/"+source.MembershipID+":transfer-admin", fx.b.admin.token, "team-http-transfer-cross-0001", source.Version, transferBody)
	requireTeamHTTPStatus(t, crossOrg, http.StatusForbidden)
	crossOrgBody := string(crossOrg.body)
	if !strings.Contains(crossOrgBody, "MFA_REQUIRED") && !strings.Contains(crossOrgBody, "STEP_UP_REQUIRED") {
		t.Fatalf("cross-org transfer-admin must be stopped by the step-up boundary, body=%s", crossOrgBody)
	}
	fx.pilotStepUp(t, fx.a.admin, fx.mfaFor(t, fx.a.admin), "organization_admin")
	transfer := sendTeamHTTPRequest(t, "/api/org/memberships/"+source.MembershipID+":transfer-admin", fx.a.admin.token, "team-http-transfer-0001", source.Version, transferBody)
	requireTeamHTTPStatus(t, transfer, http.StatusOK)

	revokeBody := map[string]string{"reason": "security rotation"}
	revoke := sendTeamHTTPRequest(t, "/api/org/memberships/"+targetID+":revoke-sessions", fx.a.admin.token, "team-http-revoke-0001", 4, revokeBody)
	requireTeamHTTPStatus(t, revoke, http.StatusOK)
	replay := sendTeamHTTPRequest(t, "/api/org/memberships/"+targetID+":revoke-sessions", fx.a.admin.token, "team-http-revoke-0001", 4, revokeBody)
	requireTeamHTTPStatus(t, replay, http.StatusOK)
	if replay.header.Get("Idempotency-Replayed") != "true" || !bytes.Equal(revoke.body, replay.body) {
		t.Fatalf("revoke replay header=%q first=%s replay=%s", replay.header.Get("Idempotency-Replayed"), revoke.body, replay.body)
	}
	memberAfterRevoke := findTeamHTTPMember(t, teamDirectory(t, fx.a.admin.token), accepted.User.ID)
	if memberAfterRevoke.Version != 5 || memberAfterRevoke.CredentialVersion != 2 || memberAfterRevoke.SessionsRevokedAt == nil || memberAfterRevoke.LastActivity == nil {
		t.Fatalf("revocation read model=%+v", memberAfterRevoke)
	}
	fx.want(t, http.MethodGet, "/api/org/memberships", accepted.Token, nil, http.StatusUnauthorized)

	preview := sendTeamHTTPRequest(t, "/api/org/memberships/"+targetID+":offboarding-preview", fx.a.admin.token, "team-http-preview-0001", 5, nil)
	requireTeamHTTPStatus(t, preview, http.StatusOK)
	var previewBody struct {
		ImpactVersion string `json:"impact_version"`
	}
	if err := json.Unmarshal(preview.body, &previewBody); err != nil || len(previewBody.ImpactVersion) != 64 {
		t.Fatalf("preview=%+v decode=%v body=%s", previewBody, err, preview.body)
	}
	offboardBody := map[string]any{"impact_version": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "reason": "employment ended", "reassignment": map[string]any{}}
	changedImpact := sendTeamHTTPRequest(t, "/api/org/memberships/"+targetID+":offboard", fx.a.admin.token, "team-http-offboard-stale-impact-0001", 5, offboardBody)
	requireTeamHTTPError(t, changedImpact, http.StatusConflict, "IMPACT_VERSION_CONFLICT")
	unchanged := findTeamHTTPMember(t, teamDirectory(t, fx.a.admin.token), accepted.User.ID)
	if unchanged.Version != 5 || unchanged.MembershipStatus != "active" {
		t.Fatalf("failed offboard was not rolled back: %+v", unchanged)
	}
	offboardBody["impact_version"] = previewBody.ImpactVersion
	offboard := sendTeamHTTPRequest(t, "/api/org/memberships/"+targetID+":offboard", fx.a.admin.token, "team-http-offboard-0001", 5, offboardBody)
	requireTeamHTTPStatus(t, offboard, http.StatusOK)
	left := findTeamHTTPMember(t, teamDirectory(t, fx.a.admin.token), accepted.User.ID)
	if left.Version != 6 || left.MembershipStatus != "left" || left.CredentialVersion != 3 {
		t.Fatalf("offboarded member=%+v", left)
	}
}
