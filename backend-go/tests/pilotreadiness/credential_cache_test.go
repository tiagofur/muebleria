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

func credentialResponse(t *testing.T, path, token string, body any, headers map[string]string, accepted int, dst any) {
	t.Helper()
	rawBody, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(http.MethodPost, fx.base+path, bytes.NewReader(rawBody))
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", pilotIdempotencyKey(path, token, rawBody))
	for name, value := range headers {
		req.Header.Set(name, value)
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
	if resp.StatusCode != accepted {
		t.Fatalf("POST %s: status=%d want=%d body=%s", path, resp.StatusCode, accepted, truncate(raw))
	}
	if !strings.Contains(resp.Header.Get("Cache-Control"), "no-store") {
		t.Fatalf("POST %s: Cache-Control=%q, want no-store", path, resp.Header.Get("Cache-Control"))
	}
	if resp.Header.Get("Pragma") != "no-cache" {
		t.Fatalf("POST %s: Pragma=%q, want no-cache", path, resp.Header.Get("Pragma"))
	}
	if dst != nil {
		if err := json.Unmarshal(raw, dst); err != nil {
			t.Fatalf("POST %s: decode response: %v body=%s", path, err, truncate(raw))
		}
	}
}

func TestCredentialIssuingResponsesAreNoStore(t *testing.T) {
	const email = "credential-cache@pilot-readiness.test"
	var invitationA struct {
		Invitation struct {
			ID      string `json:"id"`
			Version int64  `json:"version"`
		} `json:"invitation"`
		InvitationToken string `json:"invitation_token"`
	}
	credentialResponse(t, "/api/org/invitations", fx.a.admin.token, map[string]any{
		"email": email, "roles": []string{"vendedor"},
	}, nil, http.StatusCreated, &invitationA)

	var resentA struct {
		Invitation struct {
			Version int64 `json:"version"`
		} `json:"invitation"`
		InvitationToken string `json:"invitation_token"`
	}
	credentialResponse(t, "/api/org/invitations/"+invitationA.Invitation.ID+":resend", fx.a.admin.token, nil, map[string]string{
		"If-Match": `"v` + strconv.FormatInt(invitationA.Invitation.Version, 10) + `"`,
	}, http.StatusOK, &resentA)
	if resentA.InvitationToken == "" || resentA.InvitationToken == invitationA.InvitationToken {
		t.Fatalf("resend did not return a rotated invitation credential: %+v", resentA)
	}

	var acceptedA loginResponse
	credentialResponse(t, "/api/auth/invitations:accept", "", map[string]string{
		"token": resentA.InvitationToken, "password": pilotPassword, "name": "Credential Cache Member",
	}, nil, http.StatusOK, &acceptedA)
	if acceptedA.Token == "" || acceptedA.RefreshToken == "" {
		t.Fatalf("invitation acceptance did not emit access and refresh credentials: %+v", acceptedA)
	}

	var invitationB struct {
		InvitationToken string `json:"invitation_token"`
	}
	credentialResponse(t, "/api/org/invitations", fx.b.admin.token, map[string]any{
		"email": email, "roles": []string{"vendedor"},
	}, nil, http.StatusCreated, &invitationB)
	var acceptedB loginResponse
	credentialResponse(t, "/api/auth/invitations:accept", "", map[string]string{
		"token": invitationB.InvitationToken, "password": pilotPassword,
	}, nil, http.StatusOK, &acceptedB)

	var selected loginResponse
	credentialResponse(t, "/api/auth/select-org", acceptedA.Token, map[string]string{
		"organization_id": fx.b.id,
	}, nil, http.StatusOK, &selected)
	if selected.Token == "" || selected.Organization == nil || selected.Organization.ID != fx.b.id {
		t.Fatalf("select-org did not emit the expected scoped credential: %+v", selected)
	}

	var support struct {
		Token     string `json:"token"`
		SessionID string `json:"session_id"`
	}
	credentialResponse(t, "/api/platform/organizations/"+fx.a.id+"/support-session", fx.platform.token, map[string]string{
		"reason": "credential cache header proof",
	}, nil, http.StatusCreated, &support)
	if support.Token == "" || support.SessionID == "" {
		t.Fatalf("support session did not emit a bearer credential: %+v", support)
	}
	fx.endSupportSession(t, support.SessionID)
}
