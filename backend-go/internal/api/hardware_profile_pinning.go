package api

import (
	"net/http"
	"strings"

	"github.com/google/uuid"

	"github.com/tiagofur/muebles-backend/internal/application"
)

// HandleHardwareProfilesForRelease answers GET /api/manufacturing-libraries/standard/releases/{releaseId}/hardware-profiles
// — the pinned read (#918): the exact release id identifies the content,
// never "current". Clients that follow current must resolve the release id
// explicitly first (GET .../releases/current) and then pin it.
func (s *Server) HandleHardwareProfilesForRelease(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	releaseID, err := uuid.Parse(r.PathValue("releaseId"))
	if err != nil {
		respondWithError(w, http.StatusBadRequest, "invalid release id")
		return
	}
	profiles, err := application.HardwareProfilesForRelease(r.Context(), s.Store, releaseID)
	if err != nil {
		msg := err.Error()
		if strings.Contains(msg, "no manifest") || strings.Contains(msg, "not found") {
			respondWithError(w, http.StatusNotFound, "release manifest not found")
			return
		}
		respondWithInternalError(w, err, "resolve pinned hardware profiles")
		return
	}
	respondWithJSON(w, http.StatusOK, profiles)
}
