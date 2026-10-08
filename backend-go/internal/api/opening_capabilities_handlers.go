package api

import (
	"net/http"
)

// #1134: the organization's opening capabilities as a catalog read — the
// parsed `opening.capabilities` overlay blob, nil when no active overlay
// governs. Any session member may read it: catalog state (same visibility as
// the construction policy), consumed by authoring surfaces to offer ONLY
// available systems for new selections. Available ≠ valid: disabling a
// capability never invalidates existing designs — they resolve against
// their pinned release.
func (s *Server) HandleOpeningCapabilities(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	capabilities, err := s.Store.GetOpeningCapabilities(r.Context())
	if err != nil {
		// A broken overlay fails closed (same discipline as the
		// construction policy read) — never a silent library default.
		respondWithInternalError(w, err, "opening capabilities read")
		return
	}
	if capabilities == nil {
		respondWithJSON(w, http.StatusOK, map[string]any{"opening_capabilities": nil})
		return
	}
	respondWithJSON(w, http.StatusOK, map[string]any{"opening_capabilities": capabilities})
}
