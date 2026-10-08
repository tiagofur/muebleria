package api

import (
	"net/http"
)

// #1078 follow-up (#1218): the organization's factory construction policy as
// a catalog read — the parsed standard-library overlay, nil when no active
// overlay governs and the library ladder applies. Any session member may read
// it: it is catalog state (same visibility as materials/hardware), never
// overlay admin content — the web previews resolve pricing and F129 drilling
// against the SAME bands the server quotes and releases freeze.
func (s *Server) HandleConstructionPolicy(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	policy, err := s.Store.GetFactoryConstructionPolicy(r.Context())
	if err != nil {
		// A broken overlay fails closed everywhere (live catalog, release
		// freeze and this read) — never a silent library-default preview.
		respondWithInternalError(w, err, "construction policy read")
		return
	}
	if policy == nil {
		respondWithJSON(w, http.StatusOK, map[string]any{"construction_policy": nil})
		return
	}
	respondWithJSON(w, http.StatusOK, map[string]any{"construction_policy": policy})
}
