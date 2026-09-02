package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #460 / SEC-6 device credentials, handler-level contract: approve
// normalizes the typed PIN, enroll rejects transports other than sketchup,
// and the token endpoint mints a bearer whose sid resolves through the REAL
// session-registry middleware path (the original implementation minted a
// sid with no registry row, so every authenticated request 401'd).

func TestDeviceApprove_NormalizesTypedCode(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}

	req := httptest.NewRequest(http.MethodPost, "/api/auth/devices/approve",
		strings.NewReader(`{"code":"k7m2-qp"}`))
	req = withClaims(req, "u-approve", string(domain.RoleAdmin))
	rec := httptest.NewRecorder()
	srv.HandleDeviceApprove(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("approve status = %d: %s", rec.Code, rec.Body.String())
	}
	if store.approveDeviceReceived == nil || store.approveDeviceReceived.Code != "K7M2QP" {
		t.Fatalf("approve must normalize the typed PIN, got %+v", store.approveDeviceReceived)
	}
	if store.approveDeviceReceived.ApprovingUser != "u-approve" {
		t.Fatalf("approve must bind the authenticated user, got %+v", store.approveDeviceReceived)
	}
}

func TestDeviceApprove_RejectsMalformedCode(t *testing.T) {
	srv := &Server{Store: &stubStore{}}

	req := httptest.NewRequest(http.MethodPost, "/api/auth/devices/approve",
		strings.NewReader(`{"code":"SHORT"}`))
	req = withClaims(req, "u-approve", string(domain.RoleAdmin))
	rec := httptest.NewRecorder()
	srv.HandleDeviceApprove(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("malformed code status = %d, want 400", rec.Code)
	}
}

func TestDeviceEnroll_OnlySketchupTransport(t *testing.T) {
	srv := &Server{Store: &stubStore{}}

	req := httptest.NewRequest(http.MethodPost, "/api/auth/devices/enroll",
		strings.NewReader(`{"client_type":"web","display_name":"Browser"}`))
	rec := httptest.NewRecorder()
	srv.HandleDeviceEnroll(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("web client_type must be rejected, got %d", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/auth/devices/enroll",
		strings.NewReader(`{"client_type":"sketchup","display_name":"Mac del taller"}`))
	rec = httptest.NewRecorder()
	srv.HandleDeviceEnroll(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("sketchup enroll status = %d: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		ID   string `json:"id"`
		Code string `json:"code"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil || body.ID == "" || len(body.Code) != 6 {
		t.Fatalf("enroll response shape: err=%v body=%+v", err, body)
	}
}

// The regression proof for the registry linkage: a token minted by
// HandleDeviceToken must carry the device session's sid, resolve it live
// through AuthMiddleware and survive the client-type/scope checks — an
// org-scoped sketchup bearer (login's single-membership auto-selection) on
// the identically scoped sketchup session.
func TestDeviceToken_MintedBearerPassesSessionRegistryMiddleware(t *testing.T) {
	authority := mustAuthority(sessionRegistryTestSecret)
	sessionID := "sess-dev-1"
	membershipID, orgID := "u-1:org-1", "org-1"
	store := &stubStore{resolveDeviceResult: &storage.DeviceTokenResult{
		Device: &domain.AuthDevice{ID: "dev-1", UserID: "u-1", ClientType: "sketchup"},
		User:   &domain.User{ID: "u-1", Email: "u@test.com", AccountStatus: domain.AccountStatusActive},
		Session: &domain.AuthSession{
			ID: sessionID, UserID: "u-1", ClientType: domain.SessionClientSketchup,
			MembershipID:         &membershipID,
			ActiveOrganizationID: &orgID,
			CreatedAt:            time.Now().Add(-time.Minute),
			AbsoluteExpiresAt:    time.Now().Add(29 * 24 * time.Hour),
		},
		OrgID:                         orgID,
		MembershipID:                  membershipID,
		MembershipCredentialVersion:   1,
		OrganizationCredentialVersion: 1,
		Roles:                         []string{"user"},
	}}
	srv := &Server{Store: store, Tokens: authority}

	req := httptest.NewRequest(http.MethodPost, "/api/auth/devices/token",
		strings.NewReader(`{"device_secret":"dev-1:`+strings.Repeat("a1", 32)+`"}`))
	rec := httptest.NewRecorder()
	srv.HandleDeviceToken(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("token status = %d: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		AccessToken     string    `json:"access_token"`
		AccessExpiresAt time.Time `json:"access_expires_at"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil || body.AccessToken == "" {
		t.Fatalf("token response shape: err=%v body=%+v", err, body)
	}
	if body.AccessExpiresAt.IsZero() || body.AccessExpiresAt.After(time.Now().Add(31*24*time.Hour)) {
		t.Fatalf("access expiry must carry the registry-capped server clock value: %v", body.AccessExpiresAt)
	}

	users := sessionRegistryFixture()
	users.sessions[sessionID] = &domain.AuthSession{
		ID: sessionID, UserID: "u-1", ClientType: domain.SessionClientSketchup,
		MembershipID:         &membershipID,
		ActiveOrganizationID: &orgID,
		CreatedAt:            time.Now().Add(-time.Minute),
		AbsoluteExpiresAt:    time.Now().Add(29 * 24 * time.Hour),
	}
	mwRec := serveSessionRegistry(t, users, body.AccessToken)
	if mwRec.Code != http.StatusOK {
		t.Fatalf("device bearer must pass the registry middleware, got %d: %s", mwRec.Code, mwRec.Body.String())
	}

	// Revoking the registry session cuts the bearer on the next request,
	// even with the JWT itself unexpired.
	revoked := time.Now().Add(-time.Second)
	users.sessions[sessionID].RevokedAt = &revoked
	mwRec = serveSessionRegistry(t, users, body.AccessToken)
	if mwRec.Code != http.StatusUnauthorized {
		t.Fatalf("revoked device session must cut the bearer, got %d", mwRec.Code)
	}
}

func TestDeviceToken_WrongSecretIsUniformUnauthorized(t *testing.T) {
	srv := &Server{Store: &stubStore{}} // stub resolves to ErrDeviceNotFound

	for _, secret := range []string{"dev-1:" + strings.Repeat("ff", 32), "garbage", ""} {
		req := httptest.NewRequest(http.MethodPost, "/api/auth/devices/token",
			strings.NewReader(`{"device_secret":"`+secret+`"}`))
		rec := httptest.NewRecorder()
		srv.HandleDeviceToken(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("secret %q: status = %d, want 401", secret, rec.Code)
		}
	}
}

var _ = context.Background
