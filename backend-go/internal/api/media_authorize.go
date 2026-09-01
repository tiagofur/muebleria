package api

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// maxMediaAuthorizeResources bounds one authorize batch. Enough for a whole
// catalog page in a single request, small enough that minting stays cheap.
const maxMediaAuthorizeResources = 100

// HandleMediaAuthorize: POST /api/media:authorize (#460 SEC-3).
//
// The authorization happens BEFORE any grant is minted: AuthMiddleware has
// validated the session bearer, its live registry row and the organization
// scope; here we additionally require that each requested file physically
// exists under the caller's organization partition (cross-org or missing
// files are simply omitted — enumeration-safe). Only then does the dedicated
// MediaAuthority sign a media_read grant for the exact resource.
func (s *Server) HandleMediaAuthorize(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	if s.MediaTokens == nil {
		respondWithError(w, http.StatusServiceUnavailable, "firma de medios no configurada")
		return
	}
	if strings.TrimSpace(s.MediaDir) == "" {
		respondWithError(w, http.StatusServiceUnavailable, "almacenamiento de medios no configurado")
		return
	}
	var body openapi.MediaAuthorizeRequest
	if !decodeGeneratedJSONBody(w, r, &body) {
		return
	}
	if len(body.Resources) == 0 || len(body.Resources) > maxMediaAuthorizeResources {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest,
			"resources debe tener entre 1 y 100 elementos", nil)
		return
	}

	claims := claimsFromRequest(r)
	orgID := storage.OrgFromCtx(r.Context())
	cap := mediaGrantAbsoluteCap(claims)

	grants := make([]openapi.MediaGrant, 0, len(body.Resources))
	seen := make(map[string]struct{}, len(body.Resources))
	for _, filename := range body.Resources {
		filename = strings.TrimSpace(filename)
		if auth.MediaResourceKey(filename) == "" {
			respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest,
				"recurso de medio inválido", nil)
			return
		}
		if _, dup := seen[filename]; dup {
			continue
		}
		seen[filename] = struct{}{}

		// The file must exist under the CALLER's organization partition;
		// anything else (missing or another tenant's) is omitted so the
		// response never distinguishes "exists elsewhere" from "gone".
		path := filepath.Join(s.MediaDir, orgID, filename)
		if !strings.HasPrefix(filepath.Clean(path), filepath.Clean(s.MediaDir)+string(os.PathSeparator)) {
			continue
		}
		if info, err := os.Stat(path); err != nil || info.IsDir() {
			continue
		}

		signed, mc, err := s.MediaTokens.Issue(auth.MediaIssueRequest{
			ResourceKey: auth.MediaResourceKey(filename),
			OrgID:       orgID,
			SessionID:   claims.Sid,
			UserID:      claims.UserID,
			AbsoluteCap: cap,
		})
		if err != nil {
			respondWithInternalError(w, err, "media grant issue")
			return
		}
		grants = append(grants, openapi.MediaGrant{
			Filename:  filename,
			URL:       "/api/media/" + filename + "?grant=" + signed,
			ExpiresAt: mc.ExpiresAt.UTC().Format(time.RFC3339Nano),
		})
	}
	respondWithJSON(w, http.StatusOK, openapi.MediaAuthorizeResponse{Grants: grants})
}

// mediaGrantAbsoluteCap derives the never-exceed bound of a session-bound
// grant from the minting session's absolute origin: the registry seeds
// absolute_expires_at at auth_started_at + the transport's session TTL, and
// refresh never extends it. A grant therefore can never outlive the session
// that authorized it even though consumption is stateless.
func mediaGrantAbsoluteCap(claims *auth.Claims) time.Time {
	if claims == nil || claims.Sid == "" || claims.AuthStartedAt == nil {
		return time.Time{}
	}
	if claims.Support != nil {
		return claims.AuthStartedAt.Add(auth.SupportTokenTTL)
	}
	return claims.AuthStartedAt.Add(auth.TransportSessionTTL(claims.Transport))
}

// mediaGrantRemainingKey carries the signed grant's remaining lifetime into
// the handler so its Cache-Control max-age never outlives the credential
// that authorized the response (#460 review: a 3-minute grant must not pin a
// "fresh" response for 24 hours).
type mediaGrantRemainingKey struct{}

// mediaGetAuth authenticates GET /api/media/{name} under exactly one of two
// credential classes, with explicit precedence (#460 SEC-3):
//
//   - Authorization header present → the full session policy (AuthMiddleware:
//     live registry row, membership, organization scope). The query string
//     never participates in session authentication; a `grant` param is
//     ignored on this branch.
//   - No header → a `grant` query param must carry a valid media_read
//     credential for EXACTLY this filename. Signature, resource and
//     organization are part of the signed material.
//
// Anything else — including the historical `?token=<session JWT>` — is a 401.
func (s *Server) mediaGetAuth(next http.Handler) http.Handler {
	sessionAuth := AuthMiddleware(s.tokenAuthority(), s.Store)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			sessionAuth(next).ServeHTTP(w, r)
			return
		}
		if s.MediaTokens == nil {
			respondWithAPIError(w, http.StatusServiceUnavailable, openapi.ApiErrorCodeMediaAccessInvalid,
				"la autorización de medios no está configurada", nil)
			return
		}
		grant := strings.TrimSpace(r.URL.Query().Get("grant"))
		if grant == "" {
			noStore(w)
			respondWithAPIError(w, http.StatusUnauthorized, openapi.ApiErrorCodeUnauthorized,
				"authorization header or media grant required", nil)
			return
		}
		claims, err := s.MediaTokens.Validate(grant)
		if err != nil {
			noStore(w)
			if errors.Is(err, auth.ErrMediaTokenExpired) {
				respondWithAPIError(w, http.StatusUnauthorized, openapi.ApiErrorCodeMediaAccessExpired,
					"el acceso al medio expiró; volvé a autorizarlo", nil)
			} else {
				respondWithAPIError(w, http.StatusUnauthorized, openapi.ApiErrorCodeMediaAccessInvalid,
					"acceso al medio inválido", nil)
			}
			return
		}
		// Exact-resource binding: the signed key must name THIS path segment.
		// A valid grant pointed at another file is indistinguishable from a
		// missing one (404 downstream), never a 403 that confirms existence.
		if auth.MediaFilenameFromResource(claims.Resource) != r.PathValue("name") {
			noStore(w)
			respondWithError(w, http.StatusNotFound, "not found")
			return
		}
		ctx := storage.WithOrgCtx(r.Context(), claims.OrgID)
		ctx = context.WithValue(ctx, mediaGrantRemainingKey{}, time.Until(claims.ExpiresAt.Time))
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
