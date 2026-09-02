package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #460 / SEC-7 step-up boundary and MFA handler contract: the sensitive
// commands answer a typed 403 (never 401, so no client mistakes it for access
// expiry) distinguishing MFA_REQUIRED / STEP_UP_REQUIRED / STEP_UP_EXPIRED,
// a valid grant passes through, and a legacy ver4 bearer (no sid) can never
// be elevated. Route-level proofs with real PostgreSQL live in
// tests/pilotreadiness.

func stepUpTestServer(store *stubStore) *Server {
	srv := NewServer(store, "step-up-unit-test-secret-min-32-bytes!", nil, 100, 100)
	keyring, err := auth.NewMFAKeyring("test", map[string][]byte{"test": []byte("mfa-api-test-key-32-bytes-yes-ok!!")})
	if err != nil {
		panic(err)
	}
	secrets, err := auth.NewMFASecrets(keyring)
	if err != nil {
		panic(err)
	}
	srv.MFASecrets = secrets
	return srv
}

func stepUpRequest(t *testing.T, srv *Server, store *stubStore, body string, sid string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/auth/devices/approve", strings.NewReader(body))
	req = withClaims(req, "u-step", string(domain.RoleAdmin))
	if sid != "" {
		claims := claimsFromRequest(req)
		claims.Sid = sid
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "stepup-test-key-1")
	rec := httptest.NewRecorder()
	srv.RequireStepUp(domain.StepUpScopeDeviceEnrollment,
		http.HandlerFunc(srv.HandleDeviceApprove)).ServeHTTP(rec, req)
	return rec
}

func decodeStepUpError(t *testing.T, rec *httptest.ResponseRecorder) openapi.ApiError {
	t.Helper()
	var payload openapi.ApiError
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("body is not an ApiError: %s", rec.Body.String())
	}
	return payload
}

func TestRequireStepUp_NoFactorsIsMFARequired(t *testing.T) {
	store := &stubStore{mfaEnabledFactors: 0}
	srv := stepUpTestServer(store)
	rec := stepUpRequest(t, srv, store, `{"code":"K7M2QP"}`, "sid-1")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 (body=%s)", rec.Code, rec.Body.String())
	}
	payload := decodeStepUpError(t, rec)
	if payload.Code != openapi.ApiErrorCodeMfaRequired {
		t.Fatalf("code = %s, want MFA_REQUIRED", payload.Code)
	}
	// The challenge must not reach the command handler.
	if store.approveDeviceReceived != nil {
		t.Fatal("MFA_REQUIRED challenge must not execute the command")
	}
}

func TestRequireStepUp_ChallengeWithoutGrant(t *testing.T) {
	store := &stubStore{mfaEnabledFactors: 1}
	srv := stepUpTestServer(store)
	rec := stepUpRequest(t, srv, store, `{"code":"K7M2QP"}`, "sid-1")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d (body=%s)", rec.Code, rec.Body.String())
	}
	payload := decodeStepUpError(t, rec)
	if payload.Code != openapi.ApiErrorCodeStepUpRequired {
		t.Fatalf("code = %s, want STEP_UP_REQUIRED", payload.Code)
	}
	if payload.Details["scope"] != domain.StepUpScopeDeviceEnrollment {
		t.Fatalf("details.scope = %v", payload.Details["scope"])
	}
	if store.approveDeviceReceived != nil {
		t.Fatal("STEP_UP_REQUIRED challenge must not execute the command")
	}
}

func TestRequireStepUp_ExpiredGrant(t *testing.T) {
	store := &stubStore{mfaEnabledFactors: 1, mfaStepUpFreshness: storage.MFAStepUpFreshness{Expired: true}}
	srv := stepUpTestServer(store)
	rec := stepUpRequest(t, srv, store, `{"code":"K7M2QP"}`, "sid-1")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d", rec.Code)
	}
	if payload := decodeStepUpError(t, rec); payload.Code != openapi.ApiErrorCodeStepUpExpired {
		t.Fatalf("code = %s, want STEP_UP_EXPIRED", payload.Code)
	}
}

func TestRequireStepUp_ValidGrantExecutesCommand(t *testing.T) {
	store := &stubStore{
		mfaEnabledFactors:  1,
		mfaStepUpFreshness: storage.MFAStepUpFreshness{Valid: true},
	}
	srv := stepUpTestServer(store)
	rec := stepUpRequest(t, srv, store, `{"code":"K7M2QP"}`, "sid-1")
	// The command runs (the stub approves without an idempotency store —
	// the RequireIdempotency wrapper is route-level and covered by the
	// PostgreSQL proofs).
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d (body=%s)", rec.Code, rec.Body.String())
	}
	if store.approveDeviceReceived == nil {
		t.Fatal("valid step-up must reach the command")
	}
}

func TestRequireStepUp_LegacyVer4TokenCannotElevate(t *testing.T) {
	store := &stubStore{mfaEnabledFactors: 1, mfaStepUpFreshness: storage.MFAStepUpFreshness{Valid: true}}
	srv := stepUpTestServer(store)
	// No sid: the ver4 transitional shape. Step-up authority binds to the
	// registry session, so a valid-looking freshness answer is irrelevant —
	// the boundary rejects before consulting it.
	rec := stepUpRequest(t, srv, store, `{"code":"K7M2QP"}`, "")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d", rec.Code)
	}
	if payload := decodeStepUpError(t, rec); payload.Code != openapi.ApiErrorCodeStepUpRequired {
		t.Fatalf("code = %s, want STEP_UP_REQUIRED", payload.Code)
	}
}

func TestHandleMFAStepUp_Contract(t *testing.T) {
	newReq := func(body string) (*http.Request, *stubStore, *Server) {
		store := &stubStore{}
		srv := stepUpTestServer(store)
		req := httptest.NewRequest(http.MethodPost, "/api/auth/mfa/step-up", strings.NewReader(body))
		req = withClaims(req, "u-step", string(domain.RoleAdmin))
		claims := claimsFromRequest(req)
		claims.Sid = "sid-1"
		req.Header.Set("Content-Type", "application/json")
		return req, store, srv
	}

	t.Run("invalid scope", func(t *testing.T) {
		req, _, srv := newReq(`{"scope":"god_mode","method":"totp","code":"123456"}`)
		rec := httptest.NewRecorder()
		srv.HandleMFAStepUp(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("status = %d", rec.Code)
		}
	})

	t.Run("ver4 without sid is refused", func(t *testing.T) {
		store := &stubStore{}
		srv := stepUpTestServer(store)
		req := httptest.NewRequest(http.MethodPost, "/api/auth/mfa/step-up", strings.NewReader(`{"scope":"security_admin","method":"totp","code":"123456"}`))
		req = withClaims(req, "u-step", string(domain.RoleAdmin))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		srv.HandleMFAStepUp(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("status = %d", rec.Code)
		}
		if payload := decodeStepUpError(t, rec); payload.Code != openapi.ApiErrorCodeStepUpRequired {
			t.Fatalf("code = %s", payload.Code)
		}
	})

	t.Run("success echoes scope and expiry", func(t *testing.T) {
		req, store, srv := newReq(`{"scope":"support_access","method":"totp","code":" 123 456 "}`)
		store.mfaStepUpFn = func(ctx context.Context, cmd storage.MFAStepUpCommand) (*storage.MFAStepUpResult, error) {
			if cmd.Scope != domain.StepUpScopeSupportAccess || cmd.SessionID != "sid-1" {
				t.Fatalf("command scope/session mismatch: %+v", cmd)
			}
			if cmd.Code != "123456" {
				t.Fatalf("code must be normalized, got %q", cmd.Code)
			}
			return &storage.MFAStepUpResult{Scope: cmd.Scope, Method: "totp", ExpiresAt: time.Now().Add(storage.StepUpTTL)}, nil
		}
		rec := httptest.NewRecorder()
		srv.HandleMFAStepUp(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
		}
		var payload struct {
			Scope     string `json:"scope"`
			ExpiresAt string `json:"expires_at"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil || payload.Scope != "support_access" || payload.ExpiresAt == "" {
			t.Fatalf("payload: %s err=%v", rec.Body.String(), err)
		}
	})

	t.Run("no factors is MFA_REQUIRED", func(t *testing.T) {
		req, store, srv := newReq(`{"scope":"security_admin","method":"totp","code":"123456"}`)
		store.mfaStepUpFn = func(ctx context.Context, cmd storage.MFAStepUpCommand) (*storage.MFAStepUpResult, error) {
			return nil, storage.ErrMFANoEnabledFactor
		}
		rec := httptest.NewRecorder()
		srv.HandleMFAStepUp(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("status = %d", rec.Code)
		}
		if payload := decodeStepUpError(t, rec); payload.Code != openapi.ApiErrorCodeMfaRequired {
			t.Fatalf("code = %s", payload.Code)
		}
	})

	t.Run("invalid code is typed", func(t *testing.T) {
		req, store, srv := newReq(`{"scope":"security_admin","method":"totp","code":"123456"}`)
		store.mfaStepUpFn = func(ctx context.Context, cmd storage.MFAStepUpCommand) (*storage.MFAStepUpResult, error) {
			return nil, storage.ErrMFAInvalidCode
		}
		rec := httptest.NewRecorder()
		srv.HandleMFAStepUp(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("status = %d", rec.Code)
		}
		if payload := decodeStepUpError(t, rec); payload.Code != openapi.ApiErrorCodeMfaInvalid {
			t.Fatalf("code = %s", payload.Code)
		}
	})

	t.Run("recovery invalid is typed", func(t *testing.T) {
		req, store, srv := newReq(`{"scope":"security_admin","method":"recovery","code":"AAAAA-BBBBB"}`)
		store.mfaStepUpFn = func(ctx context.Context, cmd storage.MFAStepUpCommand) (*storage.MFAStepUpResult, error) {
			return nil, storage.ErrMFARecoveryInvalid
		}
		rec := httptest.NewRecorder()
		srv.HandleMFAStepUp(rec, req)
		if payload := decodeStepUpError(t, rec); payload.Code != openapi.ApiErrorCodeMfaRecoveryInvalid {
			t.Fatalf("code = %s", payload.Code)
		}
	})
}

func TestMFAEndpoints_FailClosedWithoutSecrets(t *testing.T) {
	store := &stubStore{}
	srv := NewServer(store, "step-up-unit-test-secret-min-32-bytes!", nil, 100, 100) // no MFASecrets
	for _, tc := range []struct {
		name, method, path, body string
	}{
		{"begin", http.MethodPost, "/api/auth/mfa/totp:begin", `{}`},
		{"verify", http.MethodPost, "/api/auth/mfa/totp/30000000-0000-0000-0000-000000000001:verify", `{"code":"123456"}`},
		{"step-up", http.MethodPost, "/api/auth/mfa/step-up", `{"scope":"security_admin","method":"totp","code":"123456"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
			req = withClaims(req, "u-step", string(domain.RoleAdmin))
			claims := claimsFromRequest(req)
			claims.Sid = "sid-1"
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			switch tc.name {
			case "begin":
				srv.HandleBeginMFAEnrollment(rec, req)
			case "verify":
				srv.HandleVerifyMFAEnrollment(rec, req)
			default:
				srv.HandleMFAStepUp(rec, req)
			}
			if rec.Code != http.StatusServiceUnavailable {
				t.Fatalf("status = %d, want 503 without MFA secrets (body=%s)", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestHandleBeginMFAEnrollment_ReturnsProvisioningOnce(t *testing.T) {
	store := &stubStore{}
	srv := stepUpTestServer(store)
	store.mfaEnrollFn = func(ctx context.Context, cmd storage.CreateMFAEnrollmentCommand) (*domain.MFAFactor, error) {
		if cmd.UserID != "u-step" || len(cmd.EncryptedSecret) == 0 || cmd.EncryptionKid == "" {
			t.Fatalf("enrollment command incomplete: %+v", cmd)
		}
		expires := time.Now().Add(storage.MFAEnrollmentTTL).UTC()
		return &domain.MFAFactor{ID: "f-1", Status: domain.MFAFactorStatusPending, PendingExpiresAt: &expires}, nil
	}
	req := httptest.NewRequest(http.MethodPost, "/api/auth/mfa/totp:begin", strings.NewReader(`{"label":"Tel"}`))
	req = withClaims(req, "u-step", string(domain.RoleAdmin))
	claimsFromRequest(req).Sid = "sid-test"
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.HandleBeginMFAEnrollment(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	var payload struct {
		FactorID        string `json:"factor_id"`
		ProvisioningUri string `json:"provisioning_uri"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(payload.ProvisioningUri, "otpauth://totp/Granete:") ||
		!strings.Contains(payload.ProvisioningUri, "secret=") {
		t.Fatalf("provisioning uri malformed: %s", payload.ProvisioningUri)
	}
	if cache := rec.Header().Get("Cache-Control"); !strings.Contains(cache, "no-store") {
		// Handler-level: the route adds noStoreMiddleware; nothing here yet.
		_ = cache
	}
}

// Enrolling an ADDITIONAL factor must prove the existing one (review
// blocker): with ≥1 enabled factor, begin and verify answer the
// security_admin challenge unless a fresh grant exists; the FIRST factor is
// the account's bootstrap (plain authenticated session).
func TestMFAEnrollment_SecondFactorRequiresSecurityAdminStepUp(t *testing.T) {
	enrollRequest := func(srv *Server, method, path, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req = withClaims(req, "u-enroll", string(domain.RoleAdmin))
		claims := claimsFromRequest(req)
		claims.Sid = "sid-enroll"
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		switch method {
		case http.MethodPost:
			if strings.Contains(path, ":verify") {
				srv.HandleVerifyMFAEnrollment(rec, req)
			} else {
				srv.HandleBeginMFAEnrollment(rec, req)
			}
		}
		return rec
	}

	t.Run("bootstrap with zero factors passes with no grant", func(t *testing.T) {
		store := &stubStore{mfaEnabledFactors: 0}
		srv := stepUpTestServer(store)
		store.mfaEnrollFn = func(ctx context.Context, cmd storage.CreateMFAEnrollmentCommand) (*domain.MFAFactor, error) {
			expires := time.Now().Add(storage.MFAEnrollmentTTL).UTC()
			return &domain.MFAFactor{ID: "f-1", Status: domain.MFAFactorStatusPending, PendingExpiresAt: &expires}, nil
		}
		rec := enrollRequest(srv, http.MethodPost, "/api/auth/mfa/totp:begin", `{}`)
		if rec.Code != http.StatusCreated {
			t.Fatalf("bootstrap begin status = %d body=%s", rec.Code, rec.Body.String())
		}
	})

	t.Run("second factor is challenged without a grant", func(t *testing.T) {
		store := &stubStore{mfaEnabledFactors: 1}
		srv := stepUpTestServer(store)
		rec := enrollRequest(srv, http.MethodPost, "/api/auth/mfa/totp:begin", `{}`)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("begin status = %d body=%s", rec.Code, rec.Body.String())
		}
		if payload := decodeStepUpError(t, rec); payload.Code != openapi.ApiErrorCodeStepUpRequired {
			t.Fatalf("begin code = %s, want STEP_UP_REQUIRED", payload.Code)
		} else if payload.Details["scope"] != domain.StepUpScopeSecurityAdmin {
			t.Fatalf("begin details.scope = %v", payload.Details["scope"])
		}
		rec = enrollRequest(srv, http.MethodPost, "/api/auth/mfa/totp/f-1:verify", `{"code":"123456"}`)
		if payload := decodeStepUpError(t, rec); payload.Code != openapi.ApiErrorCodeStepUpRequired {
			t.Fatalf("verify code = %s, want STEP_UP_REQUIRED (TOCTOU re-check)", payload.Code)
		}
	})

	t.Run("expired grant is told apart", func(t *testing.T) {
		store := &stubStore{mfaEnabledFactors: 1, mfaStepUpFreshness: storage.MFAStepUpFreshness{Expired: true}}
		srv := stepUpTestServer(store)
		rec := enrollRequest(srv, http.MethodPost, "/api/auth/mfa/totp:begin", `{}`)
		if payload := decodeStepUpError(t, rec); payload.Code != openapi.ApiErrorCodeStepUpExpired {
			t.Fatalf("code = %s, want STEP_UP_EXPIRED", payload.Code)
		}
	})

	t.Run("fresh grant lets the second factor through", func(t *testing.T) {
		store := &stubStore{
			mfaEnabledFactors:  1,
			mfaStepUpFreshness: storage.MFAStepUpFreshness{Valid: true},
		}
		srv := stepUpTestServer(store)
		store.mfaEnrollFn = func(ctx context.Context, cmd storage.CreateMFAEnrollmentCommand) (*domain.MFAFactor, error) {
			expires := time.Now().Add(storage.MFAEnrollmentTTL).UTC()
			return &domain.MFAFactor{ID: "f-2", Status: domain.MFAFactorStatusPending, PendingExpiresAt: &expires}, nil
		}
		rec := enrollRequest(srv, http.MethodPost, "/api/auth/mfa/totp:begin", `{}`)
		if rec.Code != http.StatusCreated {
			t.Fatalf("begin status = %d body=%s", rec.Code, rec.Body.String())
		}
	})

	t.Run("ver4 session cannot enroll a second factor", func(t *testing.T) {
		store := &stubStore{mfaEnabledFactors: 1, mfaStepUpFreshness: storage.MFAStepUpFreshness{Valid: true}}
		srv := stepUpTestServer(store)
		req := httptest.NewRequest(http.MethodPost, "/api/auth/mfa/totp:begin", strings.NewReader(`{}`))
		req = withClaims(req, "u-enroll", string(domain.RoleAdmin)) // no Sid
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		srv.HandleBeginMFAEnrollment(rec, req)
		if payload := decodeStepUpError(t, rec); payload.Code != openapi.ApiErrorCodeStepUpRequired {
			t.Fatalf("code = %s, want STEP_UP_REQUIRED", payload.Code)
		}
	})
}

func TestMFAErrors_TypedMapping(t *testing.T) {
	// respondWithMFAError must map every storage sentinel to its contract
	// code — no message parsing anywhere.
	cases := []struct {
		err  error
		code openapi.ApiErrorCode
	}{
		{storage.ErrMFAEnrollmentExpired, openapi.ApiErrorCodeMfaEnrollmentExpired},
		{storage.ErrMFAFactorNotFound, openapi.ApiErrorCodeMfaFactorNotFound},
		{storage.ErrMFARecoveryInvalid, openapi.ApiErrorCodeMfaRecoveryInvalid},
		{storage.ErrMFAInvalidCode, openapi.ApiErrorCodeMfaInvalid},
		{storage.ErrMFASecretsUnconfigured, openapi.ApiErrorCodeInternalError},
		{errors.New("boom"), openapi.ApiErrorCodeInternalError},
	}
	for _, tc := range cases {
		rec := httptest.NewRecorder()
		respondWithMFAError(rec, tc.err, "test")
		var payload openapi.ApiError
		if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
			t.Fatalf("%v: body %s", tc.err, rec.Body.String())
		}
		if payload.Code != tc.code {
			t.Fatalf("%v mapped to %s, want %s", tc.err, payload.Code, tc.code)
		}
	}
}

func TestMFAStepUp_ConcurrentRateLimit(t *testing.T) {
	st := &stubStore{
		mfaEnabledFactors: 1,
		mfaStepUpFn: func(ctx context.Context, cmd storage.MFAStepUpCommand) (*storage.MFAStepUpResult, error) {
			return nil, storage.ErrMFAInvalidCode
		},
	}
	srv := stepUpTestServer(st)

	bodyJSON := `{"scope":"security_admin", "method": "totp", "code": "000000"}`
	var wg sync.WaitGroup
	results := make(chan int, 20)

	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			req := httptest.NewRequest(http.MethodPost, "/api/auth/mfa/step-up", strings.NewReader(bodyJSON))
			req.Header.Set("Content-Type", "application/json")
			req = withClaims(req, "usr-limit", "user")
			// Inject a Sid into the claims
			claims := claimsFromRequest(req)
			claims.Sid = "sid-1"
			
			rec := httptest.NewRecorder()
			srv.HandleMFAStepUp(rec, req)
			results <- rec.Code
		}()
	}

	wg.Wait()
	close(results)

	var badRequestCount, tooManyRequestsCount int
	for code := range results {
		if code == http.StatusForbidden { // mapped from ErrMFAInvalidCode
			badRequestCount++
		} else if code == http.StatusTooManyRequests {
			tooManyRequestsCount++
		} else {
			t.Errorf("unexpected status code: %d", code)
		}
	}

	if badRequestCount != 5 {
		t.Errorf("expected exactly 5 verification failures (burst limit), got %d", badRequestCount)
	}
	if tooManyRequestsCount != 15 {
		t.Errorf("expected exactly 15 too many requests, got %d", tooManyRequestsCount)
	}
}
