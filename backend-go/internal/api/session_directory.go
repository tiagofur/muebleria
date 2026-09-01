package api

import (
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

func noStore(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
}

func noStoreMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		noStore(w)
		next.ServeHTTP(w, r)
	})
}

func rejectSessionQueryToken(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.TrimSpace(r.URL.Query().Get("token")) != "" {
			noStore(w)
			respondWithAPIError(w, http.StatusUnauthorized, openapi.ApiErrorCodeUnauthorized, "authorization header required", nil)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func sessionDirectoryResponse(entries []storage.AuthSessionDirectoryEntry, currentSessionID string) openapi.SessionDirectory {
	now := time.Now()
	items := make([]openapi.SessionSummary, 0, len(entries))
	for _, entry := range entries {
		items = append(items, sessionSummaryResponse(entry, currentSessionID, now))
	}
	return openapi.SessionDirectory{Items: items, Limit: storage.AuthSessionDirectoryLimit}
}

func sessionSummaryResponse(entry storage.AuthSessionDirectoryEntry, currentSessionID string, now time.Time) openapi.SessionSummary {
	out := openapi.SessionSummary{
		ID: entry.ID, ClientType: openapi.AuthTransport(entry.ClientType),
		CreatedAt:         entry.CreatedAt.UTC().Format(time.RFC3339Nano),
		LastSeenAt:        formatOptionalTime(entry.LastSeenAt),
		AbsoluteExpiresAt: entry.AbsoluteExpiresAt.UTC().Format(time.RFC3339Nano),
		RevokedAt:         formatOptionalTime(entry.RevokedAt), IsCurrent: entry.ID == currentSessionID,
		DeviceHint: entry.DeviceHint, MembershipID: entry.MembershipID,
		Status: openapi.SessionStatus(entry.Status(now)),
	}
	if entry.ActiveOrganizationID != nil && entry.OrganizationName != nil && entry.OrganizationSlug != nil {
		out.ActiveOrganization = &openapi.SessionOrganizationSummary{
			ID: *entry.ActiveOrganizationID, Name: *entry.OrganizationName, Slug: *entry.OrganizationSlug,
		}
	}
	return out
}

func (s *Server) HandleListMySessions(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	claims := claimsFromRequest(r)
	entries, err := s.Store.ListOwnAuthSessions(r.Context(), claims.UserID, storage.AuthSessionDirectoryLimit)
	if err != nil {
		respondWithInternalError(w, err, "list own auth sessions")
		return
	}
	respondWithJSON(w, http.StatusOK, sessionDirectoryResponse(entries, claims.Sid))
}

func (s *Server) HandleRevokeMySession(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	claims := claimsFromRequest(r)
	result, err := s.Store.RevokeOwnAuthSession(r.Context(), storage.RevokeAuthSessionCommand{
		ActorUserID: claims.UserID, SessionID: r.PathValue("sessionId"),
		IP: clientIP(r), RequestID: RequestIDFromContext(r.Context()),
	})
	if respondWithSessionDirectoryError(w, err) {
		return
	}
	respondWithJSON(w, http.StatusOK, openapi.SessionRevokeResponse{
		Session: sessionSummaryResponse(result.Session, claims.Sid, time.Now()), Revoked: result.Revoked,
	})
}

func (s *Server) orgSessionTarget(w http.ResponseWriter, r *http.Request, actorUserID, organizationID string) (*storage.OrgTeamMember, bool) {
	team, err := s.Store.ListOrgTeam(r.Context(), organizationID, actorUserID)
	if err != nil {
		respondWithInternalError(w, err, "organization session target")
		return nil, false
	}
	for i := range team {
		if team[i].MembershipID == r.PathValue("membershipId") {
			return &team[i], true
		}
	}
	respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeMembershipNotFound, "membresía no encontrada", nil)
	return nil, false
}

func (s *Server) HandleListMembershipSessions(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	claims, _, ok := s.requireOrgTeamCapability(w, r, domain.TeamCapabilityRevokeSessions)
	if !ok {
		return
	}
	if _, ok := s.orgSessionTarget(w, r, claims.UserID, claims.OrgID); !ok {
		return
	}
	entries, err := s.Store.ListMembershipAuthSessions(r.Context(), claims.UserID, claims.OrgID, r.PathValue("membershipId"), storage.AuthSessionDirectoryLimit)
	if err != nil {
		respondWithInternalError(w, err, "list membership auth sessions")
		return
	}
	respondWithJSON(w, http.StatusOK, sessionDirectoryResponse(entries, claims.Sid))
}

func validatedSessionReason(w http.ResponseWriter, reason string) (string, bool) {
	reason = strings.TrimSpace(reason)
	if reason == "" || utf8.RuneCountInString(reason) > 200 {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "reason debe tener entre 1 y 200 caracteres", nil)
		return "", false
	}
	return reason, true
}

func (s *Server) HandleRevokeMembershipSession(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	claims, _, ok := s.requireOrgTeamCapability(w, r, domain.TeamCapabilityRevokeSessions)
	if !ok {
		return
	}
	target, ok := s.orgSessionTarget(w, r, claims.UserID, claims.OrgID)
	if !ok {
		return
	}
	var body openapi.RevokeSessionRequest
	if !decodeGeneratedJSONBody(w, r, &body) {
		return
	}
	reason, ok := validatedSessionReason(w, body.Reason)
	if !ok {
		return
	}
	result, err := s.Store.RevokeMembershipAuthSession(r.Context(), storage.RevokeAuthSessionCommand{
		ActorUserID: claims.UserID, TargetUserID: target.UserID,
		OrganizationID: claims.OrgID, TargetMembershipID: target.MembershipID,
		SessionID: r.PathValue("sessionId"), Reason: reason,
		IP: clientIP(r), RequestID: RequestIDFromContext(r.Context()),
	})
	if respondWithSessionDirectoryError(w, err) {
		return
	}
	respondWithJSON(w, http.StatusOK, openapi.SessionRevokeResponse{
		Session: sessionSummaryResponse(result.Session, claims.Sid, time.Now()), Revoked: result.Revoked,
	})
}

func (s *Server) HandleListPlatformUserSessions(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	claims := claimsFromRequest(r)
	entries, err := s.Store.ListPlatformUserAuthSessions(r.Context(), r.PathValue("userId"), storage.AuthSessionDirectoryLimit)
	if errors.Is(err, storage.ErrAuthSessionNotFound) {
		respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeSessionNotFound, "sesión no encontrada", nil)
		return
	}
	if err != nil {
		respondWithInternalError(w, err, "list platform user auth sessions")
		return
	}
	respondWithJSON(w, http.StatusOK, sessionDirectoryResponse(entries, claims.Sid))
}

func (s *Server) HandleRevokePlatformUserSession(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	claims := claimsFromRequest(r)
	var body openapi.RevokeSessionRequest
	if !decodeGeneratedJSONBody(w, r, &body) {
		return
	}
	reason, ok := validatedSessionReason(w, body.Reason)
	if !ok {
		return
	}
	result, err := s.Store.RevokePlatformAuthSession(r.Context(), storage.RevokeAuthSessionCommand{
		ActorUserID: claims.UserID, TargetUserID: r.PathValue("userId"),
		SessionID: r.PathValue("sessionId"), Reason: reason,
		IP: clientIP(r), RequestID: RequestIDFromContext(r.Context()),
	})
	if respondWithSessionDirectoryError(w, err) {
		return
	}
	respondWithJSON(w, http.StatusOK, openapi.SessionRevokeResponse{
		Session: sessionSummaryResponse(result.Session, claims.Sid, time.Now()), Revoked: result.Revoked,
	})
}

func respondWithSessionDirectoryError(w http.ResponseWriter, err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, storage.ErrAuthSessionNotFound) {
		respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeSessionNotFound, "sesión no encontrada", nil)
		return true
	}
	respondWithInternalError(w, err, "auth session directory command")
	return true
}
