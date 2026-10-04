package api

import (
	"github.com/tiagofur/muebles-backend/internal/domain"
	"net/http"
)

// Contrato: rutas públicas y protegidas de auth — login, refresh (SEC-2),
// logout, select-org, devices (SEC-6), MFA (SEC-7), me/sessions/perfil.
func registerAuthRoutes(server *Server, mux *http.ServeMux, authRL, authMW func(http.Handler) http.Handler) {
	// Endpoints públicos (Auth) — with rate limiting
	mux.Handle("POST /api/auth/login", noStoreMiddleware(authRL(http.HandlerFunc(server.HandleLogin))))

	// SEC-2 primary path: opaque single-use refresh credential, dispatched per
	// transport (#460 SEC-4A): JSON body = Mobile; HttpOnly web refresh cookie
	// (CSRF-gated) = Web; the no-body bearer branch is a finite compatibility
	// bridge restricted to SketchUp/support tokens (it moves out with SEC-6)
	// and is no longer the OpenAPI refresh contract.
	mux.Handle("POST /api/auth/refresh", noStoreMiddleware(authRL(refreshTransitionHandler(
		http.HandlerFunc(server.HandleRefreshCredential),
		http.HandlerFunc(server.HandleWebCookieRefresh),
		authMW(http.HandlerFunc(server.HandleRefresh)),
	))))
	mux.Handle("POST /api/auth/logout", noStoreMiddleware(authRL(http.HandlerFunc(server.HandleLogout))))
	// Select-org: swaps an authenticated token for one scoped to a chosen
	// organization (multi-membership users, ADR-0004).

	// Device Auth (#460 SEC-6): anonymous enrollment is rate-limited like the
	// other auth entry points; approve/list/revoke require the web session
	// (approve and revoke are idempotent commands). #460 SEC-7: approving a
	// device binds a 30-day credential to the caller's identity, so it needs
	// a fresh device_enrollment step-up — the boundary runs BEFORE the
	// idempotency wrapper so a STEP_UP_REQUIRED challenge never consumes the
	// command's Idempotency-Key (the retried command reuses it).
	//
	// #563: Decouple enrollment polling rate limiter so continuous polling
	// during a pending enrollment does not drain the sensitive login/enroll bucket.
	devicePollRPS := server.rateLimitRPS
	if devicePollRPS < 0.5 {
		devicePollRPS = 0.5
	}
	devicePollBurst := server.rateLimitBurst
	if devicePollBurst < 10 {
		devicePollBurst = 10
	}
	devicePollRL := RateLimitMiddleware(devicePollRPS, devicePollBurst)

	mux.Handle("POST /api/auth/devices/enroll", noStoreMiddleware(authRL(http.HandlerFunc(server.HandleDeviceEnroll))))
	mux.Handle("POST /api/auth/devices/enroll/poll", noStoreMiddleware(devicePollRL(http.HandlerFunc(server.HandleDeviceEnrollPoll))))
	mux.Handle("POST /api/auth/devices/approve", noStoreMiddleware(authMW(server.RequireStepUp(domain.StepUpScopeDeviceEnrollment, server.RequireIdempotency("auth.approve-device", http.HandlerFunc(server.HandleDeviceApprove))))))
	mux.Handle("POST /api/auth/devices/exchange", noStoreMiddleware(authRL(http.HandlerFunc(server.HandleDeviceExchange))))
	mux.Handle("POST /api/auth/devices/token", noStoreMiddleware(authRL(http.HandlerFunc(server.HandleDeviceToken))))
	mux.Handle("GET /api/auth/devices", noStoreMiddleware(rejectSessionQueryToken(authMW(http.HandlerFunc(server.HandleListMyDevices)))))
	mux.Handle("POST /api/auth/devices/revoke", noStoreMiddleware(rejectSessionQueryToken(authMW(server.RequireIdempotency("auth.revoke-device", http.HandlerFunc(server.HandleRevokeDevice))))))

	// MFA management + step-up (#460 SEC-7). The provisioning URI and the
	// recovery codes exist only inside their responses (no-store); factor
	// removal and recovery regeneration require a fresh security_admin
	// step-up BEFORE their idempotency wrappers.
	mux.Handle("GET /api/auth/mfa/factors", noStoreMiddleware(rejectSessionQueryToken(authMW(http.HandlerFunc(server.HandleListMFAFactors)))))
	mux.Handle("POST /api/auth/mfa/totp:begin", noStoreMiddleware(rejectSessionQueryToken(authMW(http.HandlerFunc(server.HandleBeginMFAEnrollment)))))
	mux.Handle("POST /api/auth/mfa/totp/{factorCommand...}", noStoreMiddleware(rejectSessionQueryToken(authMW(mfaCommandRouter(map[string]http.Handler{
		"verify": http.HandlerFunc(server.HandleVerifyMFAEnrollment),
	})))))
	mux.Handle("POST /api/auth/mfa/factors/{factorCommand...}", noStoreMiddleware(rejectSessionQueryToken(authMW(mfaCommandRouter(map[string]http.Handler{
		"remove": server.RequireStepUp(domain.StepUpScopeSecurityAdmin, server.RequireIdempotency("auth.remove-mfa-factor", http.HandlerFunc(server.HandleRemoveMFAFactor))),
	})))))
	mux.Handle("POST /api/auth/mfa/recovery-codes:regenerate", noStoreMiddleware(rejectSessionQueryToken(authMW(server.RequireStepUp(domain.StepUpScopeSecurityAdmin, server.RequireIdempotency("auth.regenerate-mfa-recovery", http.HandlerFunc(server.HandleRegenerateMFARecoveryCodes)))))))
	mux.Handle("POST /api/auth/mfa/step-up", noStoreMiddleware(rejectSessionQueryToken(authMW(http.HandlerFunc(server.HandleMFAStepUp)))))

	mux.Handle("POST /api/auth/select-org", noStoreMiddleware(authMW(http.HandlerFunc(server.HandleSelectOrg))))
	mux.Handle("GET /api/auth/me", authMW(http.HandlerFunc(server.HandleMe)))
	mux.Handle("GET /api/auth/sketchup/profile", noStoreMiddleware(rejectSessionQueryToken(authMW(http.HandlerFunc(server.HandleSketchupProfile)))))
	mux.Handle("GET /api/auth/sessions", noStoreMiddleware(rejectSessionQueryToken(authMW(http.HandlerFunc(server.HandleListMySessions)))))
	mux.Handle("POST /api/auth/sessions/{sessionId}/revoke", noStoreMiddleware(rejectSessionQueryToken(authMW(server.RequireIdempotency("auth.revoke-session", http.HandlerFunc(server.HandleRevokeMySession))))))
}
