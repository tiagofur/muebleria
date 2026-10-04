package api

import (
	"net/http"
)

// Contrato: media del catálogo (F040) con grants de lectura firmados
// (#460 SEC-3) — nunca JWT de sesión en URL.
func registerMediaRoutes(server *Server, mux *http.ServeMux, authMW func(http.Handler) http.Handler) {
	// Catalog media (F040) — upload mutate-catalog roles; GET any auth.
	// #460 SEC-3: reads accept a session Authorization header OR a
	// short-lived resource-scoped media grant in the query string — never a
	// session JWT in the URL. :authorize mints those grants after the normal
	// session/org authorization.
	mux.Handle("POST /api/media", authMW(http.HandlerFunc(server.HandleMediaUpload)))
	// Stateless grant minting: no durable side effect, so no idempotency
	// receipt (a signed read URL is intentionally replay-safe by design).
	mux.Handle("POST /api/media:authorize", noStoreMiddleware(authMW(http.HandlerFunc(server.HandleMediaAuthorize))))
	mux.Handle("GET /api/media/{name}", server.mediaGetAuth(http.HandlerFunc(server.HandleMediaGet)))
}
