package api

// #1599: the SketchUp extension announces library developer mode with the
// X-Granete-Library-Mode: draft header on every request while the mode is on
// (one adapter, no contract body changes). The server marks the project it
// creates or syncs — and ONLY for extension sessions of roles allowed to use
// the mode (#1598): anyone else's header is ignored, exactly as their draft
// resolve is refused.

import (
	"net/http"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// LibraryModeHeader carries the extension's library mode.
const LibraryModeHeader = "X-Granete-Library-Mode"

func libraryDevModeRequested(r *http.Request) bool {
	return strings.EqualFold(strings.TrimSpace(r.Header.Get(LibraryModeHeader)), "draft")
}

// markProjectDevModeIfRequested stamps the permanent dev-mode mark on
// projectID when the request carries the dev-mode header from a caller with
// developer-mode authority. A request without the header leaves the project
// byte-identical to the pre-#1599 behaviour.
func (s *Server) markProjectDevModeIfRequested(r *http.Request, projectID string) error {
	if projectID == "" || !libraryDevModeRequested(r) {
		return nil
	}
	claims := claimsFromRequest(r)
	// The fact is "made from SketchUp in developer mode": only an extension
	// session of a role allowed to use the mode (#1598) can state it. A web
	// or API session sending the header is ignored.
	if claims == nil || claims.Client != auth.ExtensionClient ||
		!domain.AnyRole(actorRoles(claims), domain.RoleCanUseLibraryDraft) {
		return nil
	}
	_, err := s.Store.MarkProjectDevMode(r.Context(), projectID, claims.UserID, clientIP(r), RequestIDFromContext(r.Context()))
	return err
}
