package api

import (
	"context"
	"errors"
	"net/http"
	"time"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// refreshRotationOutcome carries the committed rotation to the caller WITHOUT
// any refresh material: the response body stays clean and the caller chooses
// the delivery transport (Mobile JSON vs Web Set-Cookie) only after the
// database commit, so a rotated secret is never written to a client on a
// rolled-back transaction.
type refreshRotationOutcome struct {
	response       LoginResponse
	nextRaw        string
	absoluteExpiry time.Time
}

// performRefreshRotation is the single SEC-2A rotation path shared by both
// transports: verifier lookup → credential/family/session lock → live
// account/org validation → access mint → R2 insert → R1 consume → audit →
// commit. It never writes the HTTP response; callers own transport delivery
// and error rendering.
func (s *Server) performRefreshRotation(r *http.Request, presentedRaw string, expectedClient domain.SessionClientType) (refreshRotationOutcome, error) {
	var outcome refreshRotationOutcome
	if s.RefreshCredentials == nil || s.RefreshCredentials.Validate(presentedRaw) != nil {
		return outcome, storage.ErrRefreshInvalid
	}
	nextRaw, nextVerifier, err := s.RefreshCredentials.Generate()
	if err != nil {
		return outcome, err
	}

	var response LoginResponse
	transport := openapi.AuthTransport(expectedClient)
	rotation, err := s.Store.RotateAuthRefreshCredential(r.Context(), storage.RotateAuthRefreshCredentialCommand{
		PresentedVerifier: s.RefreshCredentials.Verifier(presentedRaw),
		NextVerifier:      nextVerifier,
		ExpectedClient:    expectedClient,
		IP:                clientIP(r),
		RequestID:         RequestIDFromContext(r.Context()),
	}, func(txCtx context.Context, rotation storage.AuthRefreshRotation) error {
		u, err := s.Store.GetUserByID(txCtx, rotation.Session.UserID)
		if err != nil || u == nil || u.AccountStatus != domain.AccountStatusActive {
			return storage.ErrRefreshSessionInvalid
		}
		tc := auth.TokenContext{
			PlatformAdmin: u.PlatformAdmin,
			AuthStartedAt: rotation.Session.CreatedAt,
			SessionID:     rotation.Session.ID,
		}
		var organization *OrgSummaryDTO
		license := LicenseDTO{Plan: string(domain.LicensePlanNone), Status: string(domain.LicenseStatusNone)}
		roles := []string{}
		if rotation.Session.ActiveOrganizationID != nil {
			if rotation.Session.MembershipID == nil || rotation.MembershipCredentialVersion == nil || rotation.OrganizationCredentialVersion == nil {
				return storage.ErrRefreshSessionInvalid
			}
			membership, err := s.Store.GetActiveMembership(txCtx, u.ID, *rotation.Session.ActiveOrganizationID)
			if err != nil || membership == nil || membership.ID != *rotation.Session.MembershipID ||
				membership.Status != domain.MembershipStatusActive || membership.Organization.Status != domain.OrganizationStatusActive || len(membership.Roles) == 0 ||
				membership.CredentialVersion != *rotation.MembershipCredentialVersion || membership.Organization.CredentialVersion != *rotation.OrganizationCredentialVersion {
				return storage.ErrRefreshSessionInvalid
			}
			roles = rolesToStrings(membership.Roles)
			tc.Roles = roles
			tc.OrgID = membership.OrganizationID
			tc.MembershipID = membership.ID
			tc.MembershipCredentialVersion = membership.CredentialVersion
			tc.OrganizationCredentialVersion = membership.Organization.CredentialVersion
			org := toOrgSummaryDTO(membership.Organization)
			organization = &org
			license = org.License
		} else if rotation.MembershipCredentialVersion != nil || rotation.OrganizationCredentialVersion != nil {
			return storage.ErrRefreshSessionInvalid
		}
		accessToken, err := s.tokenAuthority().IssueTransportTokenUntil(u.ID, u.Email, tc, string(transport), rotation.Session.AbsoluteExpiresAt)
		if err != nil {
			return err
		}
		response = LoginResponse{
			Token: accessToken, SessionID: &rotation.Session.ID, User: toOpenAPIUser(u),
			License: license, Roles: roles, Organization: organization,
			Memberships: []MembershipDTO{}, SelectionRequired: rotation.Session.ActiveOrganizationID == nil && !u.PlatformAdmin,
			Transport: transport,
		}
		setAuthExpiryMetadata(&response, rotation.Session.CreatedAt, transport, &rotation.Session.AbsoluteExpiresAt)
		return nil
	})
	if err != nil {
		return outcome, err
	}
	if rotation == nil {
		return outcome, errors.New("refresh rotation returned no result")
	}
	outcome.response = response
	outcome.nextRaw = nextRaw
	outcome.absoluteExpiry = rotation.Session.AbsoluteExpiresAt
	return outcome, nil
}

// HandleRefreshCredential rotates the opaque credential presented in the JSON
// body. After SEC-4A this is the MOBILE transport contract (mobile storage is
// revisited by SEC-5); the Web transport rotates through its HttpOnly cookie in
// HandleWebCookieRefresh. Like every refresh path it is unauthenticated by
// access JWT: possession of the high-entropy secret enters the verifier-scoped
// PostgreSQL transaction above.
func (s *Server) HandleRefreshCredential(w http.ResponseWriter, r *http.Request) {
	if webRefreshCookieValue(r) != "" {
		rejectCredentialMix(w)
		return
	}
	var body openapi.RefreshRequest
	if !decodeGeneratedJSONBody(w, r, &body) {
		return
	}
	if body.Transport != openapi.RefreshTransportMobile {
		respondRefreshError(w, storage.ErrRefreshInvalid)
		return
	}
	outcome, err := s.performRefreshRotation(r, body.RefreshToken, domain.SessionClientMobile)
	if err != nil {
		respondRotationError(w, err)
		return
	}
	// Mobile keeps receiving the rotated secret in the body (secure-store
	// flow). The Web never does: its secret only ever travels as Set-Cookie.
	outcome.response.RefreshToken = &outcome.nextRaw
	expiresAt := outcome.absoluteExpiry.UTC().Format(time.RFC3339Nano)
	outcome.response.RefreshExpiresAt = &expiresAt
	respondWithJSON(w, http.StatusOK, outcome.response)
}

// HandleWebCookieRefresh rotates the Web refresh credential presented by the
// HttpOnly cookie (#460 SEC-4A). The CSRF boundary (exact allowed Origin +
// required custom header) runs before any database work; the rotation is the
// shared SEC-2A path; the rotated secret leaves the server ONLY as a fresh
// Set-Cookie after the commit, bounded by the session's ORIGINAL absolute
// expiry — refresh never slides the session deadline.
//
// Cookie-mutation semantics (#460 review): the browser's cookie is only
// cleared for TERMINAL public refresh states (invalid/expired/revoked/reused),
// where the credential is dead server-side. An internal failure rolled the
// rotation back, so R1 is still the live credential — the response carries no
// deletion Set-Cookie and a retry with the same cookie must be able to
// succeed.
func (s *Server) HandleWebCookieRefresh(w http.ResponseWriter, r *http.Request) {
	if !s.requireWebCookieCSRF(w, r) {
		return
	}
	raw := webRefreshCookieValue(r)
	outcome, err := s.performRefreshRotation(r, raw, domain.SessionClientWeb)
	if err != nil {
		if isPublicRefreshError(err) {
			s.clearWebRefreshCookie(w)
			respondRefreshError(w, err)
			return
		}
		respondWithInternalError(w, err, "refresh rotation")
		return
	}
	s.setWebRefreshCookie(w, outcome.nextRaw, outcome.absoluteExpiry)
	respondWithJSON(w, http.StatusOK, outcome.response)
}

func (s *Server) HandleLogout(w http.ResponseWriter, r *http.Request) {
	// Mobile body logout keeps the JSON credential contract; the Web cookie
	// logout is bodyless. Presenting both at once is the credential-mix
	// ambiguity refresh rejects, denied the same way here.
	if hasJSONRequestBody(r) {
		if webRefreshCookieValue(r) != "" {
			rejectCredentialMix(w)
			return
		}
		var body openapi.LogoutRequest
		if !decodeGeneratedJSONBody(w, r, &body) {
			return
		}
		if err := s.revokeByRawRefreshCredential(r, body.RefreshToken); err != nil {
			respondWithInternalError(w, err, "logout")
			return
		}
		respondWithJSON(w, http.StatusOK, openapi.LogoutResponse{LoggedOut: true})
		return
	}
	if raw := webRefreshCookieValue(r); raw != "" {
		if !s.requireWebCookieCSRF(w, r) {
			return
		}
		// Revocation FIRST, cookie clearing after it commits: a failed
		// transaction must not cost the browser its only refresh credential
		// (#460 review). Unknown/invalid credentials revoke nothing (no-op),
		// so clearing after a nil error is safe there too.
		if err := s.revokeByRawRefreshCredential(r, raw); err != nil {
			respondWithInternalError(w, err, "logout")
			return
		}
		s.clearWebRefreshCookie(w)
		respondWithJSON(w, http.StatusOK, openapi.LogoutResponse{LoggedOut: true})
		return
	}
	// No credential presented: enumeration-safe idempotent success with NO
	// state change and NO Set-Cookie. SameSite=Strict keeps a cross-site form
	// from carrying the cookie, and such an uncredentialed request must never
	// be able to delete the browser's cookie or revoke anything (#460 review:
	// no logout-CSRF via cookie deletion).
	respondWithJSON(w, http.StatusOK, openapi.LogoutResponse{LoggedOut: true})
}

// revokeByRawRefreshCredential revokes the family and its auth_session through
// the SEC-2A logout path. Logout is intentionally enumeration-safe and
// idempotent: a malformed, unknown, already-used or already-revoked credential
// revokes nothing (nil), while a real storage failure is RETURNED so callers
// can answer 5xx without touching the client's cookie.
func (s *Server) revokeByRawRefreshCredential(r *http.Request, raw string) error {
	if s.RefreshCredentials == nil || s.RefreshCredentials.Validate(raw) != nil {
		return nil
	}
	return s.Store.LogoutByRefreshCredential(r.Context(), s.RefreshCredentials.Verifier(raw), clientIP(r), RequestIDFromContext(r.Context()))
}

// refreshTransitionHandler dispatches POST /api/auth/refresh between the three
// credential transports with explicit, unambiguous precedence (#460 SEC-4A):
//
//	JSON body (+ no web cookie) → Mobile opaque-body flow
//	JSON body + web cookie      → rejected: credential mixing (fail closed)
//	no body + web cookie        → Web HttpOnly-cookie flow (CSRF boundary inside)
//	no body + no cookie         → legacy bodyless bearer bridge (SketchUp and
//	                              support sessions only; restricted in HandleRefresh)
func refreshTransitionHandler(opaque, webCookie, legacy http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cookiePresent := webRefreshCookieValue(r) != ""
		switch {
		case hasJSONRequestBody(r):
			if cookiePresent {
				rejectCredentialMix(w)
				return
			}
			opaque.ServeHTTP(w, r)
		case cookiePresent:
			webCookie.ServeHTTP(w, r)
		default:
			legacy.ServeHTTP(w, r)
		}
	})
}

func respondRotationError(w http.ResponseWriter, err error) {
	if isPublicRefreshError(err) {
		respondRefreshError(w, err)
		return
	}
	respondWithInternalError(w, err, "refresh rotation")
}

func isPublicRefreshError(err error) bool {
	return errors.Is(err, storage.ErrRefreshInvalid) || errors.Is(err, storage.ErrRefreshExpired) ||
		errors.Is(err, storage.ErrRefreshRevoked) || errors.Is(err, storage.ErrRefreshReused) ||
		errors.Is(err, storage.ErrRefreshTypeMismatch) || errors.Is(err, storage.ErrRefreshSessionRevoked)
}

func respondRefreshError(w http.ResponseWriter, err error) {
	code := openapi.ApiErrorCodeRefreshInvalid
	message := "La credencial de renovación no es válida. Iniciá sesión de nuevo."
	switch {
	case errors.Is(err, storage.ErrRefreshExpired):
		code, message = openapi.ApiErrorCodeRefreshExpired, "La sesión expiró. Iniciá sesión de nuevo."
	case errors.Is(err, storage.ErrRefreshRevoked), errors.Is(err, storage.ErrRefreshSessionRevoked):
		code, message = openapi.ApiErrorCodeRefreshRevoked, "La sesión fue revocada. Iniciá sesión de nuevo."
	case errors.Is(err, storage.ErrRefreshReused):
		code, message = openapi.ApiErrorCodeRefreshReused, "La sesión fue revocada por seguridad. Iniciá sesión de nuevo."
	}
	respondWithAPIError(w, http.StatusUnauthorized, code, message, nil)
}
