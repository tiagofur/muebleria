package api

// #1178 password reset — an honest bootstrap without email infrastructure:
// admin-issued links travel copy/paste exactly like invitations; the public
// forgot endpoint is anti-enumeration (uniform 204) and delivers nowhere
// until an email adapter lands (link only in server logs, and never in
// production). Confirmation consumes the token in one transaction and cuts
// every live session of the identity.

import (
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// HandleRequestPasswordReset implements POST /api/auth/password-resets — the
// public forgot entry point. The response is identical whether or not the
// email belongs to an account; a disabled account is treated as unknown.
func (s *Server) HandleRequestPasswordReset(w http.ResponseWriter, r *http.Request) {
	var body openapi.PasswordResetRequest
	if !decodeGeneratedJSONBody(w, r, &body) {
		return
	}
	email := strings.TrimSpace(body.Email)
	if email == "" {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "email es obligatorio", nil)
		return
	}
	ip := clientIP(r)
	issuance, err := s.Store.RequestPasswordReset(r.Context(), email, ip, RequestIDFromContext(r.Context()))
	if err != nil {
		respondWithInternalError(w, err, "password reset request")
		return
	}
	if issuance != nil {
		deliverPasswordResetLink(email, issuance, ip)
	}
	respondWithJSON(w, http.StatusOK, openapi.PasswordResetRequestResponse{Status: "accepted"})
}

// isProductionEnv answers GRANETE_ENV with the exact semantics config applies
// (parseWebRefreshCookieSecurity): normalized to lower/trim, with "prod" as a
// production spelling. Review #1195: the raw compare here previously missed
// "prod", running production with development log behavior.
func isProductionEnv() bool {
	env := strings.ToLower(strings.TrimSpace(os.Getenv("GRANETE_ENV")))
	return env == "production" || env == "prod"
}

// deliverPasswordResetLink is the delivery adapter slot (#1178): until an
// email provider exists the only channel is the server log, and only outside
// production — production drops the link rather than leaking a credential
// into logs. The requester never receives it over this endpoint.
func deliverPasswordResetLink(email string, issuance *storage.PasswordResetIssuance, ip string) {
	expiresAt := issuance.ExpiresAt.UTC().Format(time.RFC3339)
	if isProductionEnv() {
		slog.Info("password reset requested: email delivery not configured; link withheld",
			"expires_at", expiresAt, "ip", ip)
		return
	}
	slog.Info("password reset requested: one-time link below (email delivery not configured; the requester never receives it here)",
		"email", email, "link", "/reset-password?token="+issuance.Token, "expires_at", expiresAt, "ip", ip)
}

// HandleConfirmPasswordReset implements POST /api/auth/password-resets:confirm —
// the public consumption boundary. Unknown/expired/used/revoked tokens share
// one typed error: the token is a high-entropy credential, so there is no
// oracle value in distinguishing the failure modes.
func (s *Server) HandleConfirmPasswordReset(w http.ResponseWriter, r *http.Request) {
	var body openapi.PasswordResetConfirmRequest
	if !decodeGeneratedJSONBody(w, r, &body) {
		return
	}
	if strings.TrimSpace(body.Token) == "" || body.NewPassword == "" {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "token y nueva contraseña son obligatorios", nil)
		return
	}
	if err := auth.ValidatePassword(body.NewPassword); err != nil {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "la nueva contraseña no cumple la política: mínimo 8 caracteres con al menos una letra y un dígito", nil)
		return
	}
	hash, err := auth.HashPassword(body.NewPassword)
	if err != nil {
		respondWithInternalError(w, err, "hash password reset")
		return
	}
	_, err = s.Store.ConfirmPasswordReset(r.Context(), storage.ConfirmPasswordResetCommand{
		Token:        strings.TrimSpace(body.Token),
		PasswordHash: hash,
		IP:           clientIP(r),
		RequestID:    RequestIDFromContext(r.Context()),
	})
	if errors.Is(err, storage.ErrPasswordResetTokenInvalid) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodePasswordResetTokenInvalid, "el enlace de restablecimiento no es válido o ya fue utilizado; pedí uno nuevo", nil)
		return
	}
	if err != nil {
		respondWithInternalError(w, err, "confirm password reset")
		return
	}
	respondWithJSON(w, http.StatusOK, openapi.PasswordResetConfirmResponse{Status: "completed"})
}

// HandleIssueMembershipPasswordReset implements the
// org.memberships:issue-password-reset command: an org admin mints a one-time
// reset link for an ACTIVE member of their workshop. Authority mirrors
// revoke-sessions (same capability class, step-up, idempotency): whoever can
// cut a member's access wholesale can hand them a new password.
func (s *Server) HandleIssueMembershipPasswordReset(w http.ResponseWriter, r *http.Request) {
	claims, _, ok := s.requireOrgTeamCapability(w, r, domain.TeamCapabilityRevokeSessions)
	if !ok {
		return
	}
	if claims.Support != nil {
		respondWithError(w, http.StatusForbidden, "la sesión de soporte sólo puede consultar Team")
		return
	}
	members, err := s.Store.ListOrgTeam(r.Context(), claims.OrgID, claims.UserID)
	if err != nil {
		respondWithInternalError(w, err, "issue password reset: team")
		return
	}
	var member *storage.OrgTeamMember
	for i := range members {
		if members[i].MembershipID == r.PathValue("membershipId") {
			member = &members[i]
			break
		}
	}
	if member == nil {
		respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeMembershipNotFound, "miembro no encontrado", nil)
		return
	}
	if member.Status != domain.MembershipStatusActive {
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeMembershipNotSelectable, "sólo un miembro activo puede recibir un restablecimiento de contraseña", nil)
		return
	}
	issuance, err := s.Store.IssuePasswordResetToken(r.Context(), member.UserID, "admin", &claims.UserID, storage.PasswordResetTokenTTL, clientIP(r), RequestIDFromContext(r.Context()))
	if err != nil {
		respondWithInternalError(w, err, "issue password reset")
		return
	}
	respondWithJSON(w, http.StatusCreated, openapi.PasswordResetIssuanceResponse{
		Token:       issuance.Token,
		ResetURL:    "/reset-password?token=" + issuance.Token,
		ExpiresAt:   issuance.ExpiresAt.UTC().Format(time.RFC3339),
		EmailMasked: maskInvitationEmail(member.Email),
	})
}
