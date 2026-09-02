package api

import (
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
	"golang.org/x/time/rate"
)

// #460 SEC-7 — MFA management and step-up authentication. A normal
// authenticated session must NOT be enough for security-sensitive commands:
// RequireStepUp answers STEP_UP_REQUIRED (403 — deliberately NOT 401, so
// clients never mistake it for access-token expiry) until the user verifies a
// second factor for exactly one least-privilege scope, and the resulting
// server-side grant lives 10 minutes bound to the registry session.
//
// Secrets never travel: the provisioning URI is returned once by the begin
// endpoint, TOTP codes and recovery codes appear only in their own verify
// responses, and no MFA field is ever logged.

// mfaAttempt policy: 5 failed attempts per user+purpose with one token
// refilling every 60s. SEC-8 moves this to distributed storage; meanwhile
// brute force against a 6-digit TOTP (window ±1) is bounded per user, not
// just per IP. Successful verifications do NOT consume budget — the bound is
// a brute-force floor, not friction for legitimate use.
const (
	mfaAttemptBurst = 5
	mfaAttemptEvery = time.Minute
)

// userRateLimiter is a token-bucket keyed by user (not IP): the actor behind
// an authenticated MFA verification is known, so the bound follows the
// identity. Same opportunistic eviction as the IP limiter.
type userRateLimiter struct {
	mu       sync.Mutex
	rps      rate.Limit
	burst    int
	limiters map[string]*ipBucket
}

func newUserRateLimiter(rps rate.Limit, burst int) *userRateLimiter {
	return &userRateLimiter{rps: rps, burst: burst, limiters: make(map[string]*ipBucket)}
}

func (rl *userRateLimiter) get(key string) *rate.Limiter {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	now := time.Now()
	if len(rl.limiters) > 1024 {
		for k, b := range rl.limiters {
			if now.Sub(b.lastSeen) > 10*time.Minute {
				delete(rl.limiters, k)
			}
		}
	}
	b, exists := rl.limiters[key]
	if !exists {
		b = &ipBucket{limiter: rate.NewLimiter(rl.rps, rl.burst)}
		rl.limiters[key] = b
	}
	b.lastSeen = now
	return b.limiter
}

// mfaBudgetExhausted reports whether the user's failure budget for the
// purpose is spent (429 before attempting). It does NOT consume a token;
// fractional refill must not leak attempts through, so at least ONE whole
// token must be available.
func (s *Server) mfaBudgetExhausted(userID, purpose string) bool {
	if s.mfaAttemptLimiter == nil {
		// A Server built without the limiter (zero value) fails closed.
		return true
	}
	return s.mfaAttemptLimiter.get(purpose+":"+userID).Tokens() < 1
}

// noteMFAFailure consumes one failure token when the error is a code
// rejection (invalid TOTP / recovery code). Other errors (not found, expired,
// 5xx) do not touch the brute-force budget.
func (s *Server) noteMFAFailure(userID, purpose string, err error) {
	if !errors.Is(err, storage.ErrMFAInvalidCode) && !errors.Is(err, storage.ErrMFARecoveryInvalid) {
		return
	}
	if s.mfaAttemptLimiter == nil {
		return
	}
	s.mfaAttemptLimiter.get(purpose + ":" + userID).Allow()
}

// RequireStepUp is the reusable sensitive-command boundary: it runs AFTER
// AuthMiddleware and BEFORE any idempotency wrapper, so a STEP_UP_REQUIRED
// challenge never consumes the command's Idempotency-Key — the retried
// command reuses it (#460 SEC-7 §17).
//
// Response contract (403, typed):
//   - no enabled factor  → MFA_REQUIRED (enroll first; no bypass exists:
//     enrollment only completes after a live TOTP proves authenticator
//     possession);
//   - grant missing      → STEP_UP_REQUIRED with details {scope};
//   - grant TTL passed   → STEP_UP_EXPIRED with details {scope}.
//
// Legacy ver4 sessions have no sid and can never hold a grant: sensitive
// commands on them require re-login to a ver5 session by design.
func (s *Server) RequireStepUp(scope string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims := claimsFromRequest(r)
		if claims == nil || claims.UserID == "" {
			respondWithError(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		if claims.Sid == "" {
			respondWithAPIError(w, http.StatusForbidden, openapi.ApiErrorCodeStepUpRequired,
				"Confirmá tu identidad para continuar.", map[string]any{"scope": scope})
			return
		}
		enabled, err := s.Store.CountEnabledMFAFactors(r.Context(), claims.UserID)
		if err != nil {
			respondWithInternalError(w, err, "step-up factor count")
			return
		}
		if enabled == 0 {
			respondWithAPIError(w, http.StatusForbidden, openapi.ApiErrorCodeMfaRequired,
				"Necesitás configurar autenticación en dos pasos antes de esta acción.", map[string]any{"scope": scope})
			return
		}
		freshness, err := s.Store.GetMFAStepUpFreshness(r.Context(), claims.Sid, claims.UserID, scope)
		if err != nil {
			respondWithInternalError(w, err, "step-up freshness")
			return
		}
		if freshness.Valid {
			next.ServeHTTP(w, r)
			return
		}
		if freshness.Expired {
			respondWithAPIError(w, http.StatusForbidden, openapi.ApiErrorCodeStepUpExpired,
				"La confirmación de identidad expiró. Verificá tu código de nuevo.", map[string]any{"scope": scope})
			return
		}
		respondWithAPIError(w, http.StatusForbidden, openapi.ApiErrorCodeStepUpRequired,
			"Confirmá tu identidad para continuar.", map[string]any{"scope": scope})
	})
}

// mfaCommandRouter adapts the colon-command segments
// /api/auth/mfa/{family}/{factorId}:{command} to net/http's ServeMux.
func mfaCommandRouter(commands map[string]http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		segment := r.PathValue("factorCommand")
		factorID, command, ok := strings.Cut(segment, ":")
		if !ok || factorID == "" || command == "" || strings.Contains(command, ":") {
			http.NotFound(w, r)
			return
		}
		handler, ok := commands[command]
		if !ok {
			http.NotFound(w, r)
			return
		}
		r.SetPathValue("factorId", factorID)
		handler.ServeHTTP(w, r)
	})
}

// mfaSecretsRequired answers 503 when the server was built without the MFA
// keyring: every MFA endpoint refuses to operate rather than degrade.
func (s *Server) mfaSecretsRequired(w http.ResponseWriter) (*auth.MFASecrets, bool) {
	if s.MFASecrets == nil {
		respondWithAPIError(w, http.StatusServiceUnavailable, openapi.ApiErrorCodeInternalError,
			"La configuración de seguridad del servidor está incompleta.", nil)
		return nil, false
	}
	return s.MFASecrets, true
}

// requireFactorEnrollmentAuthority is the anti-hijack gate on MFA
// enrollment (review blocker): the FIRST factor is the account's deliberate
// bootstrap (plain authenticated session), but once the user holds ≥1
// enabled factor, adding another one must prove the EXISTING factor through
// a fresh security_admin step-up. Without this, a stolen normal session on
// an MFA-protected account could enroll its own authenticator, verify it and
// then mint security_admin authority with it.
//
// The check re-runs on BOTH begin and verify: the step-up grant (10 min) can
// expire before the enrollment does (15 min), and the factor count is
// re-read at each boundary so a state change between them cannot slip a
// factor through (TOCTOU).
func (s *Server) requireFactorEnrollmentAuthority(w http.ResponseWriter, r *http.Request, claims *auth.Claims) bool {
	// A ver4 bearer carries no sid and can never hold a step-up grant; a
	// user with existing factors on such a session must re-login.
	if claims.Sid == "" {
		respondWithAPIError(w, http.StatusForbidden, openapi.ApiErrorCodeStepUpRequired,
			"Confirmá tu identidad para continuar.", map[string]any{"scope": domain.StepUpScopeSecurityAdmin})
		return false
	}
	enabled, err := s.Store.CountEnabledMFAFactors(r.Context(), claims.UserID)
	if err != nil {
		respondWithInternalError(w, err, "mfa enrollment authority")
		return false
	}
	if enabled == 0 {
		return true // bootstrap: the first factor proves authenticator possession itself
	}
	freshness, err := s.Store.GetMFAStepUpFreshness(r.Context(), claims.Sid, claims.UserID, domain.StepUpScopeSecurityAdmin)
	if err != nil {
		respondWithInternalError(w, err, "mfa enrollment authority freshness")
		return false
	}
	if freshness.Valid {
		return true
	}
	if freshness.Expired {
		respondWithAPIError(w, http.StatusForbidden, openapi.ApiErrorCodeStepUpExpired,
			"La confirmación de identidad expiró. Verificá tu código de nuevo.", map[string]any{"scope": domain.StepUpScopeSecurityAdmin})
		return false
	}
	respondWithAPIError(w, http.StatusForbidden, openapi.ApiErrorCodeStepUpRequired,
		"Confirmá tu identidad para agregar otro factor.", map[string]any{"scope": domain.StepUpScopeSecurityAdmin})
	return false
}

// GET /api/auth/mfa/factors
func (s *Server) HandleListMFAFactors(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil || claims.UserID == "" {
		respondWithError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	factors, err := s.Store.ListMFAFactors(r.Context(), claims.UserID)
	if err != nil {
		respondWithInternalError(w, err, "mfa factor list")
		return
	}
	views := make([]openapi.MFAFactorView, 0, len(factors))
	for _, f := range factors {
		views = append(views, openapi.MFAFactorView{
			ID: f.ID, FactorType: f.FactorType, Status: f.Status, Label: f.Label,
			CreatedAt: f.CreatedAt.UTC().Format(time.RFC3339Nano),
			EnabledAt: timePtrString(f.EnabledAt), LastUsedAt: timePtrString(f.LastUsedAt),
			PendingExpiresAt: timePtrString(f.PendingExpiresAt),
		})
	}
	respondWithJSON(w, http.StatusOK, openapi.MFAFactorDirectory{Factors: views})
}

// POST /api/auth/mfa/totp:begin — the provisioning URI exists exactly once.
func (s *Server) HandleBeginMFAEnrollment(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil || claims.UserID == "" {
		respondWithError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if !s.requireFactorEnrollmentAuthority(w, r, claims) {
		return
	}
	secrets, ok := s.mfaSecretsRequired(w)
	if !ok {
		return
	}
	if s.mfaBudgetExhausted(claims.UserID, "enroll") {
		respondWithError(w, http.StatusTooManyRequests, "too many requests, slow down")
		return
	}
	var body openapi.MFAEnrollBeginRequest
	if !decodeGeneratedJSONBody(w, r, &body) {
		return
	}
	label := ""
	if body.Label != nil {
		label = strings.TrimSpace(*body.Label)
		if len([]rune(label)) > 120 {
			respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "label demasiado largo", nil)
			return
		}
	}
	raw, encoded, err := auth.GenerateTOTPSecret()
	if err != nil {
		respondWithInternalError(w, err, "mfa enroll entropy")
		return
	}
	ciphertext, kid, err := secrets.EncryptTOTPSecret(raw)
	if err != nil {
		respondWithInternalError(w, err, "mfa enroll seal")
		return
	}
	uri := auth.BuildTOTPProvisioningURI(claims.Email, mfaIssuerLabel(r), encoded)
	factor, err := s.Store.CreateMFAEnrollment(r.Context(), storage.CreateMFAEnrollmentCommand{
		UserID:           claims.UserID,
		FactorID:         uuid.NewString(),
		EncryptedSecret:  ciphertext,
		EncryptionKid:    kid,
		Label:            label,
		PendingExpiresAt: time.Now().Add(storage.MFAEnrollmentTTL).UTC(),
		IP:               clientIP(r),
		RequestID:        RequestIDFromContext(r.Context()),
	})
	if err != nil {
		respondWithInternalError(w, err, "mfa enroll")
		return
	}
	respondWithJSON(w, http.StatusCreated, openapi.MFAEnrollBeginResponse{
		FactorID:        factor.ID,
		ProvisioningUri: uri,
		ExpiresAt:       factor.PendingExpiresAt.UTC().Format(time.RFC3339Nano),
	})
}

// mfaIssuerLabel keeps the QR issuer stable regardless of the deployment's
// issuer override: authenticators display it as the account's brand.
func mfaIssuerLabel(_ *http.Request) string { return "Granete" }

// POST /api/auth/mfa/totp/{factorId}:verify — enable a pending enrollment.
// The enrollment-authority gate re-runs here: a grant that was fresh at
// begin may have expired (or the factor set changed) before verification.
func (s *Server) HandleVerifyMFAEnrollment(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil || claims.UserID == "" {
		respondWithError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if !s.requireFactorEnrollmentAuthority(w, r, claims) {
		return
	}
	secrets, ok := s.mfaSecretsRequired(w)
	if !ok {
		return
	}
	if s.mfaBudgetExhausted(claims.UserID, "enroll-verify") {
		respondWithError(w, http.StatusTooManyRequests, "too many requests, slow down")
		return
	}
	var body openapi.MFAEnrollVerifyRequest
	if !decodeGeneratedJSONBody(w, r, &body) {
		return
	}
	factorID := strings.TrimSpace(r.PathValue("factorId"))
	if _, err := uuid.Parse(factorID); err != nil {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "invalid request", nil)
		return
	}
	result, err := s.Store.EnableMFAFactor(r.Context(), storage.EnableMFAFactorCommand{
		UserID:    claims.UserID,
		FactorID:  factorID,
		Code:      auth.NormalizeTOTPCodeInput(body.Code),
		Secrets:   secrets,
		IP:        clientIP(r),
		RequestID: RequestIDFromContext(r.Context()),
	})
	if err != nil {
		s.noteMFAFailure(claims.UserID, "enroll-verify", err)
		respondWithMFAError(w, err, "mfa enroll verify")
		return
	}
	respondWithJSON(w, http.StatusOK, openapi.MFAEnrollVerifiedResponse{
		FactorID:      result.Factor.ID,
		Status:        result.Factor.Status,
		RecoveryCodes: result.RecoveryCodes,
	})
}

// POST /api/auth/mfa/factors/{factorId}:remove — requires security_admin
// step-up (enforced at the route boundary, before idempotency).
func (s *Server) HandleRemoveMFAFactor(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil || claims.UserID == "" {
		respondWithError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	factorID := strings.TrimSpace(r.PathValue("factorId"))
	if _, err := uuid.Parse(factorID); err != nil {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "invalid request", nil)
		return
	}
	removed, err := s.Store.RevokeMFAFactor(r.Context(), storage.RevokeMFAFactorCommand{
		UserID:    claims.UserID,
		FactorID:  factorID,
		IP:        clientIP(r),
		RequestID: RequestIDFromContext(r.Context()),
	})
	if err != nil {
		respondWithMFAError(w, err, "mfa factor remove")
		return
	}
	respondWithJSON(w, http.StatusOK, openapi.MFAFactorRemovedResponse{FactorID: removed.ID, Status: removed.Status})
}

// POST /api/auth/mfa/recovery-codes:regenerate — requires security_admin
// step-up (route boundary).
func (s *Server) HandleRegenerateMFARecoveryCodes(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil || claims.UserID == "" {
		respondWithError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	secrets, ok := s.mfaSecretsRequired(w)
	if !ok {
		return
	}
	if s.mfaBudgetExhausted(claims.UserID, "recovery-regenerate") {
		respondWithError(w, http.StatusTooManyRequests, "too many requests, slow down")
		return
	}
	codes, err := s.Store.RegenerateMFARecoveryCodes(r.Context(), storage.RegenerateMFARecoveryCommand{
		UserID:    claims.UserID,
		Secrets:   secrets,
		IP:        clientIP(r),
		RequestID: RequestIDFromContext(r.Context()),
	})
	if err != nil {
		respondWithMFAError(w, err, "mfa recovery regenerate")
		return
	}
	respondWithJSON(w, http.StatusOK, openapi.MFARecoveryCodesResponse{RecoveryCodes: codes})
}

// POST /api/auth/mfa/step-up — verify a second factor for ONE scope.
func (s *Server) HandleMFAStepUp(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil || claims.UserID == "" {
		respondWithError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	secrets, ok := s.mfaSecretsRequired(w)
	if !ok {
		return
	}
	var body openapi.MFAStepUpRequest
	if !decodeGeneratedJSONBody(w, r, &body) {
		return
	}
	scope := string(body.Scope)
	if !domain.ValidStepUpScope(scope) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "scope inválido", nil)
		return
	}
	method := body.Method
	if method != domain.StepUpMethodTOTP && method != domain.StepUpMethodRecovery {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "method inválido", nil)
		return
	}
	// A ver5 registry session is the step-up anchor: legacy ver4 bearers and
	// tokens without a live sid cannot be elevated.
	if claims.Sid == "" {
		respondWithAPIError(w, http.StatusForbidden, openapi.ApiErrorCodeStepUpRequired,
			"Iniciá sesión de nuevo para confirmar tu identidad.", map[string]any{"scope": scope})
		return
	}
	if s.mfaBudgetExhausted(claims.UserID, "step-up") {
		respondWithError(w, http.StatusTooManyRequests, "too many requests, slow down")
		return
	}
	code := auth.NormalizeTOTPCodeInput(body.Code)
	if method == domain.StepUpMethodRecovery {
		code = auth.NormalizeRecoveryCodeInput(body.Code)
	}
	result, err := s.Store.VerifyMFAStepUp(r.Context(), storage.MFAStepUpCommand{
		UserID:    claims.UserID,
		SessionID: claims.Sid,
		Scope:     scope,
		Method:    method,
		Code:      code,
		Secrets:   secrets,
		IP:        clientIP(r),
		RequestID: RequestIDFromContext(r.Context()),
	})
	if err != nil {
		s.noteMFAFailure(claims.UserID, "step-up", err)
		if errors.Is(err, storage.ErrMFANoEnabledFactor) {
			respondWithAPIError(w, http.StatusForbidden, openapi.ApiErrorCodeMfaRequired,
				"Necesitás configurar autenticación en dos pasos.", map[string]any{"scope": scope})
			return
		}
		respondWithMFAError(w, err, "mfa step-up")
		return
	}
	respondWithJSON(w, http.StatusOK, openapi.MFAStepUpResponse{
		Scope:     openapi.MFAStepUpScope(result.Scope),
		Method:    result.Method,
		ExpiresAt: result.ExpiresAt.UTC().Format(time.RFC3339Nano),
	})
}

// respondWithMFAError maps the storage typed errors to the public contract.
// Messages are generic on purpose: no code echo, no factor oracle.
func respondWithMFAError(w http.ResponseWriter, err error, context string) {
	switch {
	case errors.Is(err, storage.ErrMFAEnrollmentExpired):
		respondWithAPIError(w, http.StatusGone, openapi.ApiErrorCodeMfaEnrollmentExpired,
			"La configuración expiró. Volvé a empezar.", nil)
	case errors.Is(err, storage.ErrMFAFactorNotFound):
		respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeMfaFactorNotFound,
			"Factor no encontrado.", nil)
	case errors.Is(err, storage.ErrMFARecoveryInvalid):
		respondWithAPIError(w, http.StatusForbidden, openapi.ApiErrorCodeMfaRecoveryInvalid,
			"Código de recuperación inválido o ya usado.", nil)
	case errors.Is(err, storage.ErrMFAInvalidCode):
		respondWithAPIError(w, http.StatusForbidden, openapi.ApiErrorCodeMfaInvalid,
			"Código inválido.", nil)
	case errors.Is(err, storage.ErrMFASecretsUnconfigured):
		respondWithAPIError(w, http.StatusServiceUnavailable, openapi.ApiErrorCodeInternalError,
			"La configuración de seguridad del servidor está incompleta.", nil)
	default:
		respondWithInternalError(w, err, context)
	}
}

func timePtrString(t *time.Time) *string {
	if t == nil {
		return nil
	}
	formatted := t.UTC().Format(time.RFC3339Nano)
	return &formatted
}
