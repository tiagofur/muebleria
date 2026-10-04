package api

// Contrato: tipo Server (dependencias inyectadas) y su ciclo de vida —
// constructores, authority de tokens perezosa y gate COST-01/02 del actor.
// Consumido por routes.go y todos los handlers del paquete.

import (
	"net/http"
	"sync"

	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// actorCanViewCosts resolves COST-01/COST-02 for the request actor (F039 + F044).
func (s *Server) actorCanViewCosts(r *http.Request) bool {
	roles := actorRoles(claimsFromRequest(r))
	ws, err := s.Store.GetWorkshopSettings(r.Context())
	flag := false
	if err == nil {
		flag = ws.VendedorCanViewCosts
	}
	return domain.AnyRole(roles, func(r domain.UserRole) bool {
		return domain.RoleCanViewCosts(r, flag)
	})
}

type Server struct {
	Store          Store
	JWTSecret      string
	allowedOrigins []string
	rateLimitRPS   float64
	rateLimitBurst int
	// MediaDir filesystem root for catalog images (F040). Empty disables upload.
	MediaDir string
	// Tokens mints and validates ver5 credentials under the exact HS256 policy
	// (#460). When nil, a single-key authority is derived lazily from JWTSecret
	// (tests and minimal embedders); production always sets it from config so
	// issuer/keyring come from the environment.
	Tokens *auth.Authority
	// RefreshCredentials is configured from the independent
	// REFRESH_TOKEN_PEPPER. Production refuses to boot without it.
	RefreshCredentials *auth.RefreshCredentials
	// WebRefreshCookieInsecureLocalDev drops the Secure attribute from the Web
	// refresh cookie (#460 SEC-4A). Zero value = Secure (fail-closed default);
	// only config may opt local dev/gates out, and production can never.
	WebRefreshCookieInsecureLocalDev bool
	// MediaTokens signs/validates resource-scoped media read grants under the
	// dedicated MEDIA_SIGNING_KEY (#460 SEC-3). Nil fails closed: a server
	// built without one neither mints nor accepts media grants.
	MediaTokens *auth.MediaAuthority
	// hardwareAssetLimits holds the configurable per-representation byte caps
	// for hardware 3D asset uploads (#667 M1); nil = package defaults.
	hardwareAssetLimits map[domain.HardwareAssetRepresentation]int64
	// hardwareAssetUnlink is a TEST seam over the collector's file removal:
	// when set it replaces removeHardwareAssetPath so regressions can stop
	// the collector inside its critical section. nil in production.
	hardwareAssetUnlink func(ownerOrgID, storageKey string) error
	// MFASecrets encrypts TOTP secrets and keys recovery verifiers under the
	// dedicated MFA_ENCRYPTION_KEYS keyring (#460 SEC-7). Nil fails closed:
	// every MFA endpoint refuses to operate, and step-up-gated commands stay
	// blocked — no plaintext fallback ever exists.
	MFASecrets        *auth.MFASecrets
	mfaAttemptLimiter *userRateLimiter
	authorityOnce     sync.Once
	lazyAuthority     *auth.Authority
}

func NewServer(store Store, jwtSecret string, allowedOrigins []string, rateLimitRPS float64, rateLimitBurst int) *Server {
	return &Server{
		Store:             store,
		JWTSecret:         jwtSecret,
		allowedOrigins:    allowedOrigins,
		rateLimitRPS:      rateLimitRPS,
		rateLimitBurst:    rateLimitBurst,
		mfaAttemptLimiter: newUserRateLimiter(mfaAttemptEvery, mfaAttemptBurst),
	}
}

// NewServerWithMedia is NewServer plus media storage directory (F040).
func NewServerWithMedia(store Store, jwtSecret string, allowedOrigins []string, rateLimitRPS float64, rateLimitBurst int, mediaDir string) *Server {
	s := NewServer(store, jwtSecret, allowedOrigins, rateLimitRPS, rateLimitBurst)
	s.MediaDir = mediaDir
	return s
}

// tokenAuthority resolves the minting/validation authority. A server built
// with only a secret gets the implicit single-key ring under the legacy kid,
// matching the default config of a deployment without JWT_KEYRING.
func (s *Server) tokenAuthority() *auth.Authority {
	s.authorityOnce.Do(func() {
		if s.Tokens != nil {
			s.lazyAuthority = s.Tokens
			return
		}
		keyring, err := auth.SingleKeyKeyring(s.JWTSecret)
		if err != nil {
			panic("auth: invalid server JWT secret: " + err.Error())
		}
		authority, err := auth.NewAuthority(keyring, "")
		if err != nil {
			panic("auth: building token authority: " + err.Error())
		}
		s.lazyAuthority = authority
	})
	return s.lazyAuthority
}
