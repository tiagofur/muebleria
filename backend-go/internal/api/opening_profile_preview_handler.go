package api

// #1534 — the gola profile editor's live preview: the editor sends its
// in-flight fields (NOTHING is saved) and the server resolves the datasheet
// sentences with the A3 contract; React renders them verbatim. POST-as-read
// (the generated client boundary does not model query parameters).

import (
	"net/http"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

func (s *Server) HandleOpeningProfilePreview(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var body struct {
		HeightMm             int      `json:"heightMm"`
		Positions            []string `json:"positions"`
		FrontDiscountTopMm   *int     `json:"frontDiscountTopMm"`
		FrontDiscountBetween *int     `json:"frontDiscountBetweenMm"`
	}
	if !decodeJSONBody(w, r, &body) {
		return
	}
	lines, resErr := engine.GolaProfilePreviewSentences(body.HeightMm, body.Positions, body.FrontDiscountTopMm, body.FrontDiscountBetween)
	if resErr != nil {
		// Input-shape failures answer 422 with the exact Spanish message
		// (same family as the editor's other field validations).
		respondWithAPIError(w, http.StatusUnprocessableEntity, openapi.ApiErrorCodeBadRequest, resErr.Message, nil)
		return
	}
	respondWithJSON(w, http.StatusOK, map[string]any{"previews": lines})
}
