package api

// #1178 handler-level validation and authority boundaries. The full token
// lifecycle runs against real PostgreSQL in storage tests and in the
// organization browser gate; these stubs pin the request-shape contract,
// the anti-enumeration uniformity and the issuance authority.

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

func TestRequestPasswordResetUniformOutcome(t *testing.T) {
	// Anti-enumeration: known and unknown emails get byte-identical responses.
	var lastBody []byte
	for _, issuance := range []*storage.PasswordResetIssuance{nil, {Token: "raw", ExpiresAt: time.Now().Add(time.Hour)}} {
		store := &stubStore{passwordResetIssuance: issuance}
		server := NewServer(store, "secret", nil, 1, 1)
		req := httptest.NewRequest(http.MethodPost, "/api/auth/password-resets", bytes.NewBufferString(`{"email":"alguien@example.com"}`))
		rec := httptest.NewRecorder()
		server.HandleRequestPasswordReset(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
		}
		if lastBody != nil && !bytes.Equal(lastBody, rec.Body.Bytes()) {
			t.Fatalf("responses diverge between known and unknown emails: %s vs %s", lastBody, rec.Body.Bytes())
		}
		lastBody = rec.Body.Bytes()
		var payload openapi.PasswordResetRequestResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil || payload.Status != "accepted" {
			t.Fatalf("payload=%+v err=%v", payload, err)
		}
	}
	if lastBody == nil {
		t.Fatal("expected at least one response")
	}
}

func TestRequestPasswordResetRequiresEmail(t *testing.T) {
	server := NewServer(&stubStore{}, "secret", nil, 1, 1)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/password-resets", bytes.NewBufferString(`{"email":"  "}`))
	rec := httptest.NewRecorder()
	server.HandleRequestPasswordReset(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestConfirmPasswordResetRequestShape(t *testing.T) {
	tests := []struct {
		name        string
		body        string
		wantMessage string
	}{
		{"missing token", `{"token":"","new_password":"abc12345"}`, "obligatorios"},
		{"weak password", `{"token":"t","new_password":"short"}`, "política"},
		{"password without digit", `{"token":"t","new_password":"sololetslargas"}`, "política"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := NewServer(&stubStore{}, "secret", nil, 1, 1)
			req := httptest.NewRequest(http.MethodPost, "/api/auth/password-resets:confirm", bytes.NewBufferString(test.body))
			rec := httptest.NewRecorder()
			server.HandleConfirmPasswordReset(rec, req)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
			}
			if !strings.Contains(rec.Body.String(), test.wantMessage) {
				t.Fatalf("message missing %q: %s", test.wantMessage, rec.Body.String())
			}
		})
	}
}

func TestIssuePasswordResetAuthorityAndTarget(t *testing.T) {
	factory := &domain.Organization{ID: "org-1", Type: domain.OrganizationTypeFactory, Status: domain.OrganizationStatusActive, CredentialVersion: 1}
	member := storage.OrgTeamMember{MembershipID: "m-1", UserID: "user-9", Email: "miembro@example.com", Status: domain.MembershipStatusActive}

	t.Run("issues for active member", func(t *testing.T) {
		store := &stubStore{getOrgByID: factory, orgTeam: []storage.OrgTeamMember{member}}
		server := NewServer(store, "secret", nil, 1, 1)
		req := withClaims(httptest.NewRequest(http.MethodPost, "/api/org/memberships/m-1:issue-password-reset", nil), "admin-1", string(domain.RoleAdmin))
		claimsFromRequest(req).OrgID = "org-1"
		req.SetPathValue("membershipId", "m-1")
		rec := httptest.NewRecorder()
		server.HandleIssueMembershipPasswordReset(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
		}
		var payload openapi.PasswordResetIssuanceResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
			t.Fatal(err)
		}
		if !strings.HasPrefix(payload.ResetURL, "/reset-password?token=") || payload.EmailMasked == "" {
			t.Fatalf("payload=%+v", payload)
		}
		if store.issuedResetUserID != "user-9" || store.issuedResetVia != "admin" {
			t.Fatalf("issued target=%q via=%q", store.issuedResetUserID, store.issuedResetVia)
		}
	})

	t.Run("unknown member", func(t *testing.T) {
		store := &stubStore{getOrgByID: factory, orgTeam: []storage.OrgTeamMember{member}}
		server := NewServer(store, "secret", nil, 1, 1)
		req := withClaims(httptest.NewRequest(http.MethodPost, "/api/org/memberships/m-x:issue-password-reset", nil), "admin-1", string(domain.RoleAdmin))
		claimsFromRequest(req).OrgID = "org-1"
		req.SetPathValue("membershipId", "m-x")
		rec := httptest.NewRecorder()
		server.HandleIssueMembershipPasswordReset(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
		}
	})

	t.Run("suspended member is rejected", func(t *testing.T) {
		suspended := member
		suspended.MembershipID = "m-2"
		suspended.Status = domain.MembershipStatusSuspended
		store := &stubStore{getOrgByID: factory, orgTeam: []storage.OrgTeamMember{suspended}}
		server := NewServer(store, "secret", nil, 1, 1)
		req := withClaims(httptest.NewRequest(http.MethodPost, "/api/org/memberships/m-2:issue-password-reset", nil), "admin-1", string(domain.RoleAdmin))
		claimsFromRequest(req).OrgID = "org-1"
		req.SetPathValue("membershipId", "m-2")
		rec := httptest.NewRecorder()
		server.HandleIssueMembershipPasswordReset(rec, req)
		if rec.Code != http.StatusConflict {
			t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
		}
		if store.issuedResetUserID != "" {
			t.Fatal("suspended member must not receive a reset token")
		}
	})
}

// #1242: withholding the raw one-time credential is the DEFAULT — the link
// only reaches the server log behind the explicit Config dev opt-in, so an
// unset GRANETE_ENV can no longer classify a deployment as "development log".
func TestDeliverPasswordResetLinkWithholdsTokenByDefault(t *testing.T) {
	issuance := &storage.PasswordResetIssuance{Token: "reset-secret-token-1242", ExpiresAt: time.Now().Add(time.Hour).UTC()}
	var buf bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	defer slog.SetDefault(previous)

	deliverPasswordResetLink(false, "user@example.com", issuance, "127.0.0.1")
	if logged := buf.String(); strings.Contains(logged, issuance.Token) || strings.Contains(logged, "link=") {
		t.Fatalf("default must withhold the raw reset credential from logs, got: %s", logged)
	}
	if !strings.Contains(buf.String(), "link withheld") {
		t.Fatalf("withholding must be observable in the log, got: %s", buf.String())
	}

	buf.Reset()
	deliverPasswordResetLink(true, "user@example.com", issuance, "127.0.0.1")
	if !strings.Contains(buf.String(), issuance.Token) {
		t.Fatalf("the explicit dev opt-in must log the link for copy/paste delivery, got: %s", buf.String())
	}
}

// Review #1195: the issuance response embeds the raw one-time token, so its
// replayed idempotency receipt must be sealed like the invitation links.
func TestIssuePasswordResetReceiptIsSealed(t *testing.T) {
	if !sensitiveIdempotencyOperations["org.issue-password-reset"] {
		t.Fatal("org.issue-password-reset must be a sensitive idempotency operation (raw token in the 201 body)")
	}
}
