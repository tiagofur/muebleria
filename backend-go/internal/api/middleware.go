package api

import (
	"context"
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
}

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
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
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

			// Re-read active/platform flags from DB so deactivation and staff
			// changes take effect immediately instead of waiting for token
			// expiry (issue #16). users.role is deprecated: memberships are
			// the source of truth for roles (ADR-0004).
			if users != nil {
				u, err := users.GetUserByID(r.Context(), claims.UserID)
				if err != nil || u == nil || !u.Active {
					respondWithError(w, http.StatusUnauthorized, "invalid token")
					return
				}
				claims.Email = u.Email
				claims.PlatformAdmin = u.PlatformAdmin

				// Live organization scope: the token names the organization,
				// but membership roles and the organization's active flag are
				// re-read from the DB — a revoked membership or a suspended
				// organization cuts access on the next request, not at expiry.
				if claims.OrgID != "" {
					m, err := users.GetActiveMembership(r.Context(), claims.UserID, claims.OrgID)
					if err != nil || m == nil || !m.Active || !m.Organization.Active || len(m.Roles) == 0 {
						respondWithError(w, http.StatusUnauthorized, "invalid token")
						return
					}
					roles := make([]string, len(m.Roles))
					for i, r := range m.Roles {
						roles[i] = string(r)
					}
					claims.Roles = roles
					claims.Role = auth.PrimaryRole(roles)
				} else {
					// TRANSITIONAL (until the F170b RBAC union sweep): org-less
					// tokens keep the deprecated users.role as single-role view
					// so existing single-organization flows and clients keep
					// working. Login only issues org-less tokens to platform
					// staff without a membership.
					claims.Roles = []string{string(u.Role)}
					claims.Role = string(u.Role)
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

			ctx := context.WithValue(r.Context(), UserContextKey, claims)
			// Propagate the organization scope to the storage layer so reads
			// and writes are filtered without changing handler signatures
			// (ADR-0004 row-level isolation).
			ctx = storage.WithOrgCtx(ctx, claims.OrgID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
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
