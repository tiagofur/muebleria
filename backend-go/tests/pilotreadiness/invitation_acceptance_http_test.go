package pilotreadiness

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"
)

type acceptanceInvitation struct {
	Invitation struct {
		ID      string `json:"id"`
		Version int64  `json:"version"`
	} `json:"invitation"`
	Token string `json:"invitation_token"`
}

func TestPilotReadiness_RevokedInvitationCannotMutateIdentityOrMembership(t *testing.T) {
	email := "accept-revoked@pilot-readiness.test"
	invitation := createAcceptanceInvitation(t, fx.a.admin.token, email, "user")

	revoke := sendInvitationCommand(t, invitation.Invitation.ID+":revoke", fx.a.admin.token,
		"accept-revoked-revoke-0001", invitation.Invitation.Version, map[string]string{"reason": "access withdrawn"})
	requireTeamHTTPStatus(t, revoke, http.StatusOK)

	response := sendAcceptanceRequest(fx.base, "accept-revoked-attempt-0001", map[string]string{
		"token": invitation.Token, "password": pilotPassword, "name": "Must Not Exist",
	})
	if response.err != nil {
		t.Fatal(response.err)
	}
	requireTeamHTTPError(t, teamHTTPResult{status: response.status, header: response.header, body: response.body}, http.StatusGone, "INVITATION_REVOKED")

	var identities, memberships, sessions int
	if err := fx.pool.QueryRow(t.Context(), `SELECT count(*) FROM users WHERE normalized_email=normalize_identity_email($1)`, email).Scan(&identities); err != nil {
		t.Fatal(err)
	}
	if err := fx.pool.QueryRow(t.Context(), `SELECT count(*) FROM memberships membership JOIN users app_user ON app_user.id=membership.user_id WHERE app_user.normalized_email=normalize_identity_email($1)`, email).Scan(&memberships); err != nil {
		t.Fatal(err)
	}
	if err := fx.pool.QueryRow(t.Context(), `SELECT count(*) FROM auth_sessions session_row JOIN users app_user ON app_user.id=session_row.user_id WHERE app_user.normalized_email=normalize_identity_email($1)`, email).Scan(&sessions); err != nil {
		t.Fatal(err)
	}
	if identities != 0 || memberships != 0 || sessions != 0 {
		t.Fatalf("revoked acceptance leaked identities=%d memberships=%d sessions=%d", identities, memberships, sessions)
	}

	var auditDetails string
	if err := fx.pool.QueryRow(t.Context(), `SELECT COALESCE(string_agg(details::text,' '),'') FROM security_audit_events WHERE details->>'invitation_id'=$1`, invitation.Invitation.ID).Scan(&auditDetails); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(auditDetails, "INVITATION_REVOKED") {
		t.Fatalf("revoked acceptance failure audit missing: %s", auditDetails)
	}
	assertNoSecrets(t, "revoked invitation audit", []byte(auditDetails), []string{invitation.Token, email, pilotPassword})
}

func TestPilotReadiness_RegisterRouteIsUnavailableAndMutationFree(t *testing.T) {
	counts := func() [3]int {
		t.Helper()
		var out [3]int
		for index, table := range []string{"users", "memberships", "invitations"} {
			if err := fx.pool.QueryRow(t.Context(), `SELECT count(*) FROM `+table).Scan(&out[index]); err != nil {
				t.Fatal(err)
			}
		}
		return out
	}
	before := counts()
	status, body := fx.do(t, http.MethodPost, "/api/auth/register", "", map[string]string{
		"email": "forbidden-register@pilot-readiness.test", "password": pilotPassword, "name": "Forbidden Register",
	})
	if status != http.StatusNotFound && status != http.StatusMethodNotAllowed {
		t.Fatalf("register status=%d body=%s", status, body)
	}
	if after := counts(); after != before {
		t.Fatalf("register route mutated foundation rows: before=%v after=%v", before, after)
	}
}

func sendInvitationCommand(t *testing.T, command, token, key string, version int64, body any) teamHTTPResult {
	t.Helper()
	var payload []byte
	if body != nil {
		var err error
		payload, err = json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
	}
	req, err := http.NewRequest(http.MethodPost, fx.base+"/api/org/invitations/"+command, bytes.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", key)
	req.Header.Set("If-Match", `"v`+fmt.Sprint(version)+`"`)
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

type acceptanceHTTPResult struct {
	status int
	header http.Header
	body   []byte
	err    error
}

func TestPilotReadiness_InvitationAcceptanceHTTP_NewIdentityReplayIsStable(t *testing.T) {
	email := "accept-new-replay@pilot-readiness.test"
	invitation := createAcceptanceInvitation(t, fx.a.admin.token, email, "user")
	key := "accept-new-replay-key-0001"
	payload := map[string]string{"token": invitation.Token, "password": pilotPassword, "name": "Replay Member"}

	first := sendAcceptanceRequest(fx.base, key, payload)
	if first.err != nil || first.status != http.StatusOK {
		t.Fatalf("first acceptance status=%d err=%v body=%s", first.status, first.err, first.body)
	}
	replay := sendAcceptanceRequest(fx.base, key, payload)
	if replay.err != nil || replay.status != http.StatusOK {
		t.Fatalf("replayed acceptance status=%d err=%v body=%s", replay.status, replay.err, replay.body)
	}
	if !bytes.Equal(first.body, replay.body) {
		t.Fatalf("replayed response changed\nfirst=%s\nreplay=%s", first.body, replay.body)
	}
	if replay.header.Get("Idempotency-Replayed") != "true" {
		t.Fatalf("replay header=%q, want true", replay.header.Get("Idempotency-Replayed"))
	}

	accepted := decodeAcceptance(t, first.body)
	assertDirectAcceptanceSession(t, accepted, fx.a.id)
	assertAcceptedPersistence(t, invitation, email, accepted, fx.a.id, "membership_created", []string{key})
}

func TestPilotReadiness_InvitationAcceptanceHTTP_ExistingIdentityCreatesOnlyInvitingMembership(t *testing.T) {
	email := "accept-existing@pilot-readiness.test"
	original := fx.inviteAndAccept(t, fx.a.admin.token, email, "user")
	invitation := createAcceptanceInvitation(t, fx.b.admin.token, email, "vendedor")
	key := "accept-existing-key-0001"

	response := sendAcceptanceRequest(fx.base, key, map[string]string{"token": invitation.Token, "password": pilotPassword})
	if response.err != nil || response.status != http.StatusOK {
		t.Fatalf("existing acceptance status=%d err=%v body=%s", response.status, response.err, response.body)
	}
	accepted := decodeAcceptance(t, response.body)
	if accepted.User.ID != original.User.ID {
		t.Fatalf("identity changed: original=%s accepted=%s", original.User.ID, accepted.User.ID)
	}
	assertDirectAcceptanceSession(t, accepted, fx.b.id)
	assertAcceptedPersistence(t, invitation, email, accepted, fx.b.id, "membership_created", []string{key})

	var totalMemberships int
	if err := fx.pool.QueryRow(t.Context(), `SELECT count(*) FROM memberships WHERE user_id=$1`, accepted.User.ID).Scan(&totalMemberships); err != nil {
		t.Fatal(err)
	}
	if totalMemberships != 2 {
		t.Fatalf("existing identity memberships=%d, want one per organization", totalMemberships)
	}
}

func TestPilotReadiness_InvitationAcceptanceHTTP_ReactivatesMembershipInPlace(t *testing.T) {
	for _, lifecycleStatus := range []string{"suspended", "left"} {
		t.Run(lifecycleStatus, func(t *testing.T) {
			email := fmt.Sprintf("accept-reactivate-%s@pilot-readiness.test", lifecycleStatus)
			original := fx.inviteAndAccept(t, fx.a.admin.token, email, "user")
			membershipID := original.Memberships[0].ID

			var update string
			if lifecycleStatus == "suspended" {
				update = `UPDATE memberships SET status='suspended', suspended_at=NOW(), suspended_by=$2, suspension_reason='temporary hold', version=version+1 WHERE id=$1`
			} else {
				update = `UPDATE memberships SET status='left', left_at=NOW(), left_by=$2, leave_reason='member departed', version=version+1 WHERE id=$1`
			}
			if _, err := fx.pool.Exec(t.Context(), update, membershipID, fx.a.admin.id); err != nil {
				t.Fatal(err)
			}

			invitation := createAcceptanceInvitation(t, fx.a.admin.token, email, "vendedor")
			key := "accept-reactivate-" + lifecycleStatus + "-key-0001"
			response := sendAcceptanceRequest(fx.base, key, map[string]string{"token": invitation.Token, "password": pilotPassword})
			if response.err != nil || response.status != http.StatusOK {
				t.Fatalf("reactivation status=%d err=%v body=%s", response.status, response.err, response.body)
			}
			accepted := decodeAcceptance(t, response.body)
			if accepted.Memberships[0].ID != membershipID {
				t.Fatalf("membership id changed: before=%s after=%s", membershipID, accepted.Memberships[0].ID)
			}
			assertDirectAcceptanceSession(t, accepted, fx.a.id)
			assertAcceptedPersistence(t, invitation, email, accepted, fx.a.id, "membership_reactivated", []string{key})

			var status string
			var metadataClear bool
			var roles []string
			if err := fx.pool.QueryRow(t.Context(), `SELECT status,roles,
				suspended_at IS NULL AND suspended_by IS NULL AND suspension_reason IS NULL
				AND left_at IS NULL AND left_by IS NULL AND leave_reason IS NULL
				FROM memberships WHERE id=$1`, membershipID).Scan(&status, &roles, &metadataClear); err != nil {
				t.Fatal(err)
			}
			if status != "active" || !metadataClear || len(roles) != 1 || roles[0] != "vendedor" {
				t.Fatalf("reactivated membership status=%q roles=%v metadata_clear=%v", status, roles, metadataClear)
			}
		})
	}
}

func TestPilotReadiness_InvitationAcceptanceHTTP_ConcurrentCommandsConsumeOnce(t *testing.T) {
	email := "accept-concurrent-http@pilot-readiness.test"
	invitation := createAcceptanceInvitation(t, fx.a.admin.token, email, "user")
	payload := map[string]string{"token": invitation.Token, "password": pilotPassword, "name": "Concurrent HTTP Member"}
	keys := []string{"accept-concurrent-key-0001", "accept-concurrent-key-0002"}

	start := make(chan struct{})
	results := make(chan acceptanceHTTPResult, len(keys))
	var wg sync.WaitGroup
	for _, key := range keys {
		key := key
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			results <- sendAcceptanceRequest(fx.base, key, payload)
		}()
	}
	close(start)
	wg.Wait()
	close(results)

	var success acceptanceHTTPResult
	successes, alreadyUsed := 0, 0
	for result := range results {
		if result.err != nil {
			t.Fatalf("concurrent request failed: %v", result.err)
		}
		switch result.status {
		case http.StatusOK:
			successes++
			success = result
		case http.StatusConflict:
			if !bytes.Contains(result.body, []byte("INVITATION_ALREADY_USED")) {
				t.Fatalf("unexpected conflict body=%s", result.body)
			}
			alreadyUsed++
		default:
			t.Fatalf("unexpected concurrent status=%d body=%s", result.status, result.body)
		}
	}
	if successes != 1 || alreadyUsed != 1 {
		t.Fatalf("successes=%d already_used=%d", successes, alreadyUsed)
	}

	accepted := decodeAcceptance(t, success.body)
	assertDirectAcceptanceSession(t, accepted, fx.a.id)
	assertAcceptedPersistence(t, invitation, email, accepted, fx.a.id, "membership_created", keys)
}

func createAcceptanceInvitation(t *testing.T, adminToken, email string, role string) acceptanceInvitation {
	t.Helper()
	var invitation acceptanceInvitation
	fx.decode(t, http.MethodPost, "/api/org/invitations", adminToken, map[string]any{
		"email": email, "roles": []string{role},
	}, http.StatusCreated, &invitation)
	if invitation.Invitation.ID == "" || invitation.Token == "" {
		t.Fatalf("incomplete invitation response: %+v", invitation)
	}
	return invitation
}

func sendAcceptanceRequest(base, key string, payload map[string]string) acceptanceHTTPResult {
	body, err := json.Marshal(payload)
	if err != nil {
		return acceptanceHTTPResult{err: err}
	}
	req, err := http.NewRequest(http.MethodPost, base+"/api/auth/invitations:accept", bytes.NewReader(body))
	if err != nil {
		return acceptanceHTTPResult{err: err}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", key)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return acceptanceHTTPResult{err: err}
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	return acceptanceHTTPResult{status: resp.StatusCode, header: resp.Header.Clone(), body: raw, err: err}
}

func decodeAcceptance(t *testing.T, body []byte) loginResponse {
	t.Helper()
	var accepted loginResponse
	if err := json.Unmarshal(body, &accepted); err != nil {
		t.Fatalf("decode acceptance response: %v body=%s", err, body)
	}
	if accepted.Token == "" || accepted.User.ID == "" || len(accepted.Memberships) != 1 {
		t.Fatalf("incomplete acceptance response: %+v", accepted)
	}
	return accepted
}

func assertDirectAcceptanceSession(t *testing.T, accepted loginResponse, organizationID string) {
	t.Helper()
	if accepted.SelectionRequired || accepted.Organization == nil || accepted.Organization.ID != organizationID || accepted.Memberships[0].OrganizationID != organizationID {
		t.Fatalf("acceptance is not directly scoped to inviting organization: %+v", accepted)
	}
	status, body := fx.do(t, http.MethodGet, "/api/auth/me", accepted.Token, nil)
	if status != http.StatusOK {
		t.Fatalf("acceptance session is unusable: status=%d body=%s", status, body)
	}
}

func assertAcceptedPersistence(t *testing.T, invitation acceptanceInvitation, email string, accepted loginResponse, organizationID, membershipEvent string, receiptKeys []string) {
	t.Helper()
	ctx := context.Background()
	var identities, memberships int
	if err := fx.pool.QueryRow(ctx, `SELECT count(*) FROM users WHERE normalized_email=normalize_identity_email($1)`, email).Scan(&identities); err != nil {
		t.Fatal(err)
	}
	if err := fx.pool.QueryRow(ctx, `SELECT count(*) FROM memberships WHERE organization_id=$1 AND user_id=$2`, organizationID, accepted.User.ID).Scan(&memberships); err != nil {
		t.Fatal(err)
	}
	if identities != 1 || memberships != 1 {
		t.Fatalf("identities=%d target_memberships=%d, want 1/1", identities, memberships)
	}

	var invitationStatus, acceptedBy string
	var invitationVersion int64
	if err := fx.pool.QueryRow(ctx, `SELECT status,accepted_by::text,version FROM invitations WHERE id=$1`, invitation.Invitation.ID).Scan(&invitationStatus, &acceptedBy, &invitationVersion); err != nil {
		t.Fatal(err)
	}
	if invitationStatus != "accepted" || acceptedBy != accepted.User.ID || invitationVersion != 2 {
		t.Fatalf("invitation status=%q accepted_by=%s version=%d", invitationStatus, acceptedBy, invitationVersion)
	}

	for _, eventType := range []string{"invitation_accepted", membershipEvent} {
		var count int
		if err := fx.pool.QueryRow(ctx, `SELECT count(*) FROM security_audit_events WHERE organization_id=$1 AND event_type=$2 AND details->>'invitation_id'=$3`, organizationID, eventType, invitation.Invitation.ID).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 1 {
			t.Fatalf("%s count=%d, want exactly 1", eventType, count)
		}
	}

	var auditDetails string
	if err := fx.pool.QueryRow(ctx, `SELECT COALESCE(string_agg(details::text,' '),'') FROM security_audit_events WHERE details->>'invitation_id'=$1`, invitation.Invitation.ID).Scan(&auditDetails); err != nil {
		t.Fatal(err)
	}
	secrets := []string{invitation.Token, email, pilotPassword, accepted.Token}
	assertNoSecrets(t, "audit", []byte(auditDetails), secrets)
	for _, key := range receiptKeys {
		var body []byte
		var headers string
		if err := fx.pool.QueryRow(ctx, `SELECT body,headers::text FROM api_idempotency_receipts WHERE scope_key=$1`, acceptanceScopeKey(key)).Scan(&body, &headers); err != nil {
			t.Fatal(err)
		}
		if !bytes.HasPrefix(body, []byte("gcm1:")) {
			t.Fatalf("acceptance receipt %s is not encrypted", key)
		}
		assertNoSecrets(t, "receipt", append(body, []byte(headers)...), secrets)
	}
}

func acceptanceScopeKey(key string) string {
	sum := sha256.Sum256([]byte("anonymous\x00\x00auth.accept-invitation\x00" + key))
	return hex.EncodeToString(sum[:])
}

func assertNoSecrets(t *testing.T, location string, value []byte, secrets []string) {
	t.Helper()
	for _, secret := range secrets {
		if secret != "" && strings.Contains(string(value), secret) {
			t.Fatalf("%s leaked secret %q", location, secret)
		}
	}
}
