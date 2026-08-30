package api

import (
	"context"
	"errors"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
	"golang.org/x/time/rate"
)

type contextKey string

const UserContextKey contextKey = "user"

// UserLookup is the subset of Store needed to re-validate JWT subjects (issue #16).
type UserLookup interface {
	GetUserByID(ctx context.Context, id string) (*domain.User, error)
}

// MembershipLookup adds the organization context resolution used to keep the
// live membership roles / organization state in every request (ADR-0004).
type MembershipLookup interface {
	UserLookup
	GetActiveMembership(ctx context.Context, userID, organizationID string) (*domain.MembershipWithOrg, error)
	// GetOpenSupportSession resolves a platform support session that is still
	// open and unexpired (ADR-0005 §5).
	GetOpenSupportSession(ctx context.Context, sessionID string) (*domain.SupportSession, error)
}

type tenantTransactionRunner interface {
	WithinTenantTx(context.Context, storage.TenantActor, func(context.Context) error) error
}

type tenantActorSetter interface {
	SetTenantActor(context.Context, storage.TenantActor) (context.Context, error)
}

var errTenantHandlerFailure = errors.New("tenant handler failed")

// CORSMiddleware only allows origins present in the allowlist. The matched
// origin is reflected per request; non-matching origins get no Allow-Origin
// header at all. The wildcard "*" is intentionally never used so that
// authenticated cross-origin requests cannot come from arbitrary sites (#3).
func CORSMiddleware(allowedOrigins []string) func(http.Handler) http.Handler {
	allow := make(map[string]struct{}, len(allowedOrigins))
	for _, o := range allowedOrigins {
		allow[strings.TrimSpace(o)] = struct{}{}
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			// Vary is set regardless so caches don't pin a response to one origin.
			w.Header().Add("Vary", "Origin")
			if origin != "" {
				if _, ok := allow[origin]; ok {
					w.Header().Set("Access-Control-Allow-Origin", origin)
				}
			}
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-ID, If-Match, Idempotency-Key")
			w.Header().Set("Access-Control-Expose-Headers", "X-Request-ID, ETag, Idempotency-Replayed")
			w.Header().Set("Access-Control-Max-Age", "600")

			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// AuthMiddleware validates the Bearer JWT, re-loads the user from the DB to
// refresh active/platform flags, re-resolves the live membership when the
// token carries an organization scope (issue #16 pattern, ADR-0004) and puts
// claims in the request context. Failure responses are JSON and never leak
// parser/DB errors to the client.
func AuthMiddleware(jwtSecret string, users MembershipLookup) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			// Allow ?token= for <img src> catalog media (F040); header still preferred.
			if authHeader == "" {
				if q := strings.TrimSpace(r.URL.Query().Get("token")); q != "" {
					authHeader = "Bearer " + q
				}
			}
			if authHeader == "" {
				respondWithError(w, http.StatusUnauthorized, "missing authorization header")
				return
			}

			parts := strings.SplitN(authHeader, " ", 2)
			if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || strings.TrimSpace(parts[1]) == "" {
				respondWithError(w, http.StatusUnauthorized, "invalid authorization header")
				return
			}

			claims, err := auth.ValidateToken(strings.TrimSpace(parts[1]), jwtSecret)
			if err != nil {
				// Generic message: never echo the parser error back to the client.
				respondWithError(w, http.StatusUnauthorized, "invalid token")
				return
			}

			actor := storage.TenantActor{
				OrganizationID: claims.OrgID,
				UserID:         claims.UserID,
			}
			if claims.Support != nil {
				actor.SupportSessionID = claims.Support.SessionID
			}
			if runner, ok := users.(tenantTransactionRunner); ok {
				buffer := &captureWriter{header: make(http.Header)}
				err := runner.WithinTenantTx(r.Context(), actor, func(ctx context.Context) error {
					serveAuthenticatedRequest(buffer, r.WithContext(ctx), next, users, claims, actor)
					if buffer.status >= http.StatusInternalServerError && !buffer.commitFailureAudit {
						return errTenantHandlerFailure
					}
					return nil
				})
				if err != nil {
					// Deferred Team constraints fire on transaction commit, after the
					// handler has rendered into the capture writer. Preserve their typed
					// public contract instead of returning a generic transaction error.
					if eventType := teamInvariantAuditEvent(err); eventType != "" {
						if recorder, ok := users.(interface {
							RecordTeamInvariantBlocked(context.Context, string, string, string, string, string, string) error
						}); ok {
							if auditErr := recorder.RecordTeamInvariantBlocked(r.Context(), claims.OrgID, claims.UserID, eventType, r.URL.Path, clientIP(r), RequestIDFromContext(r.Context())); auditErr != nil {
								respondWithInternalError(w, auditErr, "team invariant audit")
								return
							}
						}
					}
					if respondWithTeamInvariantError(w, err) {
						return
					}
					respondWithInternalError(w, err, "tenant transaction")
					return
				}
				for key, values := range buffer.header {
					w.Header()[key] = append([]string(nil), values...)
				}
				status := buffer.status
				if status == 0 {
					status = http.StatusOK
				}
				w.WriteHeader(status)
				_, _ = w.Write(buffer.body.Bytes())
				return
			}

			serveAuthenticatedRequest(w, r, next, users, claims, actor)
		})
	}
}

func serveAuthenticatedRequest(
	w http.ResponseWriter,
	r *http.Request,
	next http.Handler,
	users MembershipLookup,
	claims *auth.Claims,
	actor storage.TenantActor,
) {

	// Re-read active/platform flags from DB so deactivation and staff
	// changes take effect immediately instead of waiting for token
	// expiry (issue #16). users.role is deprecated: memberships are
	// the source of truth for roles (ADR-0004).
	if users != nil {
		u, err := users.GetUserByID(r.Context(), claims.UserID)
		if err != nil || u == nil || u.AccountStatus != domain.AccountStatusActive {
			respondWithError(w, http.StatusUnauthorized, "invalid token")
			return
		}
		claims.Email = u.Email
		claims.PlatformAdmin = u.PlatformAdmin

		// Live organization scope: the token names the organization,
		// but membership roles and the organization's active flag are
		// re-read from the DB — a revoked membership or a suspended
		// organization cuts access on the next request, not at expiry.
		if claims.Support != nil {
			// Support session: platform staff acting as admin of one
			// organization. The session row is re-validated per
			// request — logout/expiry cut access immediately. The
			// actor stays the platform admin (UserID/Email claims).
			if !claims.PlatformAdmin {
				respondWithError(w, http.StatusUnauthorized, "invalid token")
				return
			}
			ss, err := users.GetOpenSupportSession(r.Context(), claims.Support.SessionID)
			if err != nil || ss == nil ||
				ss.OrganizationID != claims.OrgID ||
				ss.PlatformAdminUserID != claims.UserID {
				respondWithError(w, http.StatusUnauthorized, "invalid token")
				return
			}
			claims.Roles = []string{string(domain.RoleAdmin)}
			claims.Role = string(domain.RoleAdmin)
		} else if claims.OrgID != "" {
			m, err := users.GetActiveMembership(r.Context(), claims.UserID, claims.OrgID)
			if err != nil || m == nil || m.Status != domain.MembershipStatusActive || m.Organization.Status != domain.OrganizationStatusActive || len(m.Roles) == 0 ||
				m.ID != claims.MembershipID || m.CredentialVersion != claims.MembershipCredentialVersion ||
				m.Organization.CredentialVersion != claims.OrganizationCredentialVersion ||
				(m.SessionsRevokedAt != nil && !claims.AuthStartedAt.Time.After(*m.SessionsRevokedAt)) {
				respondWithError(w, http.StatusUnauthorized, "invalid token")
				return
			}
			roles := make([]string, len(m.Roles))
			for i, r := range m.Roles {
				roles[i] = string(r)
			}
			claims.Roles = roles
			claims.Role = auth.PrimaryRole(roles)
			actor.MembershipID = m.ID
			if setter, ok := users.(tenantActorSetter); ok {
				ctx, err := setter.SetTenantActor(r.Context(), actor)
				if err != nil {
					respondWithInternalError(w, err, "tenant actor")
					return
				}
				r = r.WithContext(ctx)
			}
		} else {
			// Org-less tokens carry NO business scope and NO roles
			// (fail-closed, ADR-0005): platform staff use the console
			// routes only; everyone else must select an organization
			// before any data access (enforced below).
			claims.Roles = nil
			claims.Role = ""
		}
	}

	// Extension tokens are read-only: a long-lived SketchUp session token
	// must not be able to mutate workshop data even if leaked. Refresh
	// stays open so the extension can renew before expiry.
	if claims.Client == auth.ExtensionClient &&
		r.Method != http.MethodGet &&
		!(r.Method == http.MethodPost && r.URL.Path == "/api/auth/refresh") {
		respondWithError(w, http.StatusForbidden, "el token de la extensión es de solo lectura")
		return
	}

	// Business data requires an explicit organization scope (ADR-0005
	// fail-closed): org-less tokens (platform staff between support
	// sessions, users mid org-selection) may only reach platform routes,
	// canonical organization commands, and auth endpoints. Without this
	// gate the storage layer's database context would otherwise be empty,
	// and every RLS policy must remain fail-closed.
	if claims.OrgID == "" &&
		!strings.HasPrefix(r.URL.Path, "/api/platform/") &&
		r.URL.Path != "/api/organizations" &&
		!strings.HasPrefix(r.URL.Path, "/api/organizations/") &&
		!strings.HasPrefix(r.URL.Path, "/api/auth/") {
		respondWithError(w, http.StatusForbidden, "elegí un taller para continuar")
		return
	}

	ctx := context.WithValue(r.Context(), UserContextKey, claims)
	ctx = storage.WithTenantActorCtx(ctx, actor)
	next.ServeHTTP(w, r.WithContext(ctx))
}

// AdminMiddleware wraps AuthMiddleware and requires the live DB role to be admin.
func AdminMiddleware(jwtSecret string, users MembershipLookup) func(http.Handler) http.Handler {
	authMW := AuthMiddleware(jwtSecret, users)
	return func(next http.Handler) http.Handler {
		return authMW(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims, ok := r.Context().Value(UserContextKey).(*auth.Claims)
			if !ok || claims == nil || !domain.AnyRole(actorRoles(claims), func(rl domain.UserRole) bool {
				return rl == domain.RoleAdmin
			}) {
				respondWithError(w, http.StatusForbidden, "admin access required")
				return
			}
			next.ServeHTTP(w, r)
		}))
	}
}

// RoleMiddleware wraps AuthMiddleware and requires the live DB role to be one of the allowed roles.
func RoleMiddleware(jwtSecret string, users MembershipLookup, allowedRoles ...domain.UserRole) func(http.Handler) http.Handler {
	authMW := AuthMiddleware(jwtSecret, users)
	roleSet := make(map[string]struct{}, len(allowedRoles))
	for _, r := range allowedRoles {
		roleSet[string(r)] = struct{}{}
	}
	return func(next http.Handler) http.Handler {
		return authMW(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			claims, ok := r.Context().Value(UserContextKey).(*auth.Claims)
			if !ok || claims == nil {
				respondWithError(w, http.StatusUnauthorized, "unauthorized")
				return
			}
			allowed := false
			for _, rl := range actorRoles(claims) {
				if _, ok := roleSet[string(rl)]; ok {
					allowed = true
					break
				}
			}
			if !allowed {
				respondWithError(w, http.StatusForbidden, "insufficient permissions")
				return
			}
			next.ServeHTTP(w, r)
		}))
	}
}

// ipRateLimiter manages token buckets with active TTL eviction to prevent memory leaks.
type ipRateLimiter struct {
	mu       sync.Mutex
	rps      rate.Limit
	burst    int
	limiters map[string]*ipBucket
}

type ipBucket struct {
	limiter  *rate.Limiter
	lastSeen time.Time
}

func newIPRateLimiter(rps float64, burst int) *ipRateLimiter {
	return &ipRateLimiter{
		rps:      rate.Limit(rps),
		burst:    burst,
		limiters: make(map[string]*ipBucket),
	}
}

func (rl *ipRateLimiter) get(ip string) *rate.Limiter {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()

	// Opportunistic purge if map size grows large (e.g. > 1024 IPs)
	if len(rl.limiters) > 1024 {
		for k, b := range rl.limiters {
			if now.Sub(b.lastSeen) > 10*time.Minute {
				delete(rl.limiters, k)
			}
		}
	}

	b, exists := rl.limiters[ip]
	if !exists {
		b = &ipBucket{
			limiter: rate.NewLimiter(rl.rps, rl.burst),
		}
		rl.limiters[ip] = b
	}
	b.lastSeen = now
	return b.limiter
}

// RateLimitMiddleware applies a per-client-IP token bucket. Requests exceeding
// the rate get 429 Too Many Requests with a Retry-After hint (#6).
//
// Intended for sensitive endpoints (login, register) to blunt brute-force and
// credential-stuffing attacks.
func RateLimitMiddleware(rps float64, burst int) func(http.Handler) http.Handler {
	rl := newIPRateLimiter(rps, burst)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			lim := rl.get(clientIP(r))
			if !lim.Allow() {
				retryAfter := int(lim.Reserve().Delay().Seconds())
				if retryAfter < 1 {
					retryAfter = 1
				}
				w.Header().Set("Retry-After", strconv.Itoa(retryAfter))
				respondWithError(w, http.StatusTooManyRequests, "too many requests, slow down")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// clientIP extracts the client address, honoring X-Forwarded-For when present.
// Falls back to RemoteAddr.
func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if i := strings.IndexByte(xff, ','); i >= 0 {
			return strings.TrimSpace(xff[:i])
		}
		return strings.TrimSpace(xff)
	}
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return strings.TrimSpace(xri)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return strings.TrimSpace(r.RemoteAddr)
	}
	return strings.TrimSpace(host)
}
