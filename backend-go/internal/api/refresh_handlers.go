package api

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// HandleRefreshCredential rotates one opaque credential. It is deliberately
// unauthenticated by access JWT: possession of the high-entropy refresh secret
// enters a verifier-scoped PostgreSQL transaction, and the live session is
// authoritative before any replacement is committed.
func (s *Server) HandleRefreshCredential(w http.ResponseWriter, r *http.Request) {
	var body openapi.RefreshRequest
	if !decodeGeneratedJSONBody(w, r, &body) {
		return
	}
	if s.RefreshCredentials == nil || s.RefreshCredentials.Validate(body.RefreshToken) != nil {
		respondRefreshError(w, storage.ErrRefreshInvalid)
		return
	}
	if body.Transport != openapi.AuthTransportWeb && body.Transport != openapi.AuthTransportMobile {
		respondRefreshError(w, storage.ErrRefreshInvalid)
		return
	}
	expectedClient := sessionClientType(string(body.Transport))
	nextRaw, nextVerifier, err := s.RefreshCredentials.Generate()
	if err != nil {
		respondWithInternalError(w, err, "refresh credential generation")
		return
	}

	var response LoginResponse
	rotation, err := s.Store.RotateAuthRefreshCredential(r.Context(), storage.RotateAuthRefreshCredentialCommand{
		PresentedVerifier: s.RefreshCredentials.Verifier(body.RefreshToken),
		NextVerifier:      nextVerifier,
		ExpectedClient:    expectedClient,
		IP:                clientIP(r),
		RequestID:         RequestIDFromContext(r.Context()),
	}, func(txCtx context.Context, rotation storage.AuthRefreshRotation) error {
		u, err := s.Store.GetUserByID(txCtx, rotation.Session.UserID)
		if err != nil || u == nil || u.AccountStatus != domain.AccountStatusActive {
			return storage.ErrRefreshSessionInvalid
		}
		transport := openapi.AuthTransport(rotation.Session.ClientType)
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
		expiresAt := rotation.ExpiresAt.UTC().Format(time.RFC3339Nano)
		response = LoginResponse{
			Token: accessToken, SessionID: &rotation.Session.ID, User: toOpenAPIUser(u),
			License: license, Roles: roles, Organization: organization,
			Memberships: []MembershipDTO{}, SelectionRequired: rotation.Session.ActiveOrganizationID == nil && !u.PlatformAdmin,
			Transport: transport, RefreshToken: &nextRaw, RefreshExpiresAt: &expiresAt,
		}
		return nil
	})
	if err != nil {
		if isPublicRefreshError(err) {
			respondRefreshError(w, err)
			return
		}
		respondWithInternalError(w, err, "refresh rotation")
		return
	}
	if rotation == nil {
		respondWithInternalError(w, errors.New("refresh rotation returned no result"), "refresh rotation")
		return
	}
	respondWithJSON(w, http.StatusOK, response)
}

func (s *Server) HandleLogout(w http.ResponseWriter, r *http.Request) {
	var body openapi.LogoutRequest
	if !decodeGeneratedJSONBody(w, r, &body) {
		return
	}
	// Logout is intentionally enumeration-safe and idempotent. A malformed,
	// unknown, already-used or already-revoked credential receives the same
	// successful response; a known family is revoked with its auth_session.
	if s.RefreshCredentials != nil && s.RefreshCredentials.Validate(body.RefreshToken) == nil {
		if err := s.Store.LogoutByRefreshCredential(r.Context(), s.RefreshCredentials.Verifier(body.RefreshToken), clientIP(r), RequestIDFromContext(r.Context())); err != nil {
			respondWithInternalError(w, err, "logout")
			return
		}
	}
	respondWithJSON(w, http.StatusOK, openapi.LogoutResponse{LoggedOut: true})
}

func refreshTransitionHandler(opaque, legacy http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.ContentLength != 0 || strings.Contains(strings.ToLower(r.Header.Get("Content-Type")), "application/json") {
			opaque.ServeHTTP(w, r)
			return
		}
		legacy.ServeHTTP(w, r)
	})
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
