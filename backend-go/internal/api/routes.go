package api

import (
	"net/http"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/storage"
)

// the segment first and then dispatches only the exact supported commands.
func membershipCommandRouter(commands map[string]http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		segment := r.PathValue("membershipCommand")
		membershipID, command, ok := strings.Cut(segment, ":")
		if !ok || membershipID == "" || command == "" || strings.Contains(command, ":") {
			http.NotFound(w, r)
			return
		}
		handler, ok := commands[command]
		if !ok {
			http.NotFound(w, r)
			return
		}
		r.SetPathValue("membershipId", membershipID)
		handler.ServeHTTP(w, r)
	})
}

func organizationCommandRouter(commands map[string]http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		segment := r.PathValue("organizationCommand")
		organizationID, command, ok := strings.Cut(segment, ":")
		if !ok || organizationID == "" || command == "" || strings.Contains(command, ":") {
			http.NotFound(w, r)
			return
		}
		handler, ok := commands[command]
		if !ok {
			http.NotFound(w, r)
			return
		}
		r.SetPathValue("id", organizationID)
		r.SetPathValue("command", command)
		handler.ServeHTTP(w, r)
	})
}

// publishCommandRouter adapts /api/designs/{designId}/publish/{sessionId}:finalize
// (command-oriented OpenAPI path) to net/http's ServeMux: the wildcard must
// occupy an entire segment, so the sessionId:command segment is captured and
// split here (#392 / DT-8).
func publishCommandRouter(commands map[string]http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		segment := r.PathValue("publishCommand")
		sessionID, command, ok := strings.Cut(segment, ":")
		if !ok || sessionID == "" || command == "" || strings.Contains(command, ":") {
			http.NotFound(w, r)
			return
		}
		handler, ok := commands[command]
		if !ok {
			http.NotFound(w, r)
			return
		}
		r.SetPathValue("sessionId", sessionID)
		handler.ServeHTTP(w, r)
	})
}

// designRevisionArtifactCommandRouter adapts
// /api/designs/{designId}/revisions/{revisionId}/artifacts/{kind}:authorize
// the same way (#392 / DT-8).
// hardwareAssetSessionCommandRouter dispatches "{sessionId}:{command}" for
// the staged hardware asset upload flow (#667 M1).
func hardwareAssetSessionCommandRouter(commands map[string]http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		segment := r.PathValue("sessionCommand")
		sessionID, command, ok := strings.Cut(segment, ":")
		if !ok || sessionID == "" || command == "" || strings.Contains(command, ":") {
			http.NotFound(w, r)
			return
		}
		handler, ok := commands[command]
		if !ok {
			http.NotFound(w, r)
			return
		}
		r.SetPathValue("sessionId", sessionID)
		handler.ServeHTTP(w, r)
	})
}

// hardwareAssetCommandRouter dispatches the canonical asset command shapes
// (#667 M1 R1) — "{assetId}:{command}" and
// "{assetId}/revisions/{revisionId}:{command}" — binding the exact path
// values the handlers expect.
func hardwareAssetCommandRouter(commands map[string]http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		segment := r.PathValue("assetCommand")
		if assetPrefix, command, hasRevisionsCmd := strings.Cut(segment, "/revisions:"); hasRevisionsCmd {
			if !isValidUUID(assetPrefix) || command == "" || strings.ContainsAny(command, ":/") {
				http.NotFound(w, r)
				return
			}
			handler, found := commands[command]
			if !found {
				http.NotFound(w, r)
				return
			}
			r.SetPathValue("assetId", assetPrefix)
			handler.ServeHTTP(w, r)
			return
		}
		if assetPrefix, revisionRest, hasRevision := strings.Cut(segment, "/revisions/"); hasRevision {
			revisionID, command, ok := strings.Cut(revisionRest, ":")
			if !ok || !isValidUUID(assetPrefix) || !isValidUUID(revisionID) ||
				command == "" || strings.ContainsAny(command, ":/") {
				http.NotFound(w, r)
				return
			}
			handler, found := commands[command]
			if !found {
				http.NotFound(w, r)
				return
			}
			r.SetPathValue("assetId", assetPrefix)
			r.SetPathValue("revisionId", revisionID)
			handler.ServeHTTP(w, r)
			return
		}
		assetID, command, ok := strings.Cut(segment, ":")
		if !ok || !isValidUUID(assetID) || command == "" || strings.ContainsAny(command, ":/") {
			http.NotFound(w, r)
			return
		}
		handler, found := commands[command]
		if !found {
			http.NotFound(w, r)
			return
		}
		r.SetPathValue("assetId", assetID)
		handler.ServeHTTP(w, r)
	})
}

func designRevisionArtifactCommandRouter(commands map[string]http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		segment := r.PathValue("artifactCommand")
		kind, command, ok := strings.Cut(segment, ":")
		if !ok || kind == "" || command == "" || strings.Contains(command, ":") {
			http.NotFound(w, r)
			return
		}
		handler, ok := commands[command]
		if !ok {
			http.NotFound(w, r)
			return
		}
		r.SetPathValue("kind", kind)
		handler.ServeHTTP(w, r)
	})
}

// designRevisionCommandRouter adapts
// /api/designs/{designId}/revisions/{revisionId}:approve the same way (#395 /
// DT-11): the wildcard must occupy an entire segment, so the
// revisionId:command segment is captured and split here.
func designRevisionCommandRouter(commands map[string]http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		segment := r.PathValue("revisionCommand")
		revisionID, command, ok := strings.Cut(segment, ":")
		if !ok || revisionID == "" || command == "" || strings.Contains(command, ":") {
			http.NotFound(w, r)
			return
		}
		handler, ok := commands[command]
		if !ok {
			http.NotFound(w, r)
			return
		}
		r.SetPathValue("revisionId", revisionID)
		handler.ServeHTTP(w, r)
	})
}

func designPairingGrantCommandRouter(commands map[string]http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		segment := r.PathValue("grantCommand")
		grantID, command, ok := strings.Cut(segment, ":")
		if !ok || grantID == "" || command == "" || strings.Contains(command, ":") {
			http.NotFound(w, r)
			return
		}
		handler, ok := commands[command]
		if !ok {
			http.NotFound(w, r)
			return
		}
		r.SetPathValue("grantId", grantID)
		handler.ServeHTTP(w, r)
	})
}

// RegisterRoutes componen la tabla de ruteo: crea el mux, declara los
// middlewares compartidos y delega a los registradores por dominio
// (routes_<dominio>.go) en el orden de registro original (Fase C #1017).
func RegisterRoutes(server *Server) http.Handler {
	mux := http.NewServeMux()

	// Rate limiting on auth endpoints to blunt brute-force / credential
	// stuffing (#6). Applied per client-IP before the handler runs.
	authRL := RateLimitMiddleware(server.rateLimitRPS, server.rateLimitBurst)

	// Health check endpoint (unauthenticated) — used by Docker healthchecks and Caddy depends_on.
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})

	// Endpoints protegidos por JWT (role/active re-checked against DB — #16)
	authMW := AuthMiddleware(server.tokenAuthority(), server.Store)
	// #327: manufacturing subresources (physical execution, MRP, quality,
	// installation, job costing) are factory-only — the sales org gets 404.
	mfgOnly := server.manufacturingOnly

	registerAuthRoutes(server, mux, authRL, authMW)
	registerPlatformRoutes(server, mux, authMW)
	registerOrgRoutes(server, mux, authRL, authMW)
	registerLibraryRoutes(server, mux, authMW)
	registerCatalogRoutes(server, mux, authMW)
	registerProjectRoutes(server, mux, authMW)
	registerDesignRoutes(server, mux, authRL, authMW)
	registerCommercialRoutes(server, mux, authMW)
	registerReleaseRoutes(server, mux, authMW)
	registerDesignPublishRoutes(server, mux, authMW)
	registerManufacturingRoutes(server, mux, authMW, mfgOnly)
	registerOperationsRoutes(server, mux, authMW)
	registerWorkspaceRoutes(server, mux, authMW)
	registerMediaRoutes(server, mux, authMW)
	registerWorkspaceSettingsRoutes(server, mux, authMW)

	// NOTE: legacy /api/staff/* routes were removed (users.role bridge): they
	// created/listed GLOBAL users with no organization scope and no caller in
	// the clients. Team management lives in /api/org/* (memberships, #326) and
	// exposes no global-user management bridge.

	// SEC-8 (#1191): the trusted-proxy policy wraps EVERYTHING (outermost) so
	// the rate limiter, audit IP and every clientIP(r) reader see the same
	// resolved client. With no proxies configured it is a pass-through and
	// clientIP trusts only the direct peer — fail-closed by construction.
	// Aplicar CORS a toda la aplicación (allowlist, nunca wildcard)
	return TrustedProxyMiddleware(server.TrustedProxies)(
		CORSMiddleware(server.allowedOrigins)(RequestIDMiddleware(mux)))
}

// The coherent source view must be selected before AuthMiddleware opens its tenant transaction.
func consistentReleaseCatalogMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(w, r.WithContext(storage.WithConsistentCatalogTx(r.Context())))
	})
}
