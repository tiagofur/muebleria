package api

import (
	_ "embed"
	"encoding/json"
	"net/http"
	"time"

	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// The embedded catalog is a copy of the shared interchange artifact
// contracts/pilotFurnitureCatalog.json (source of truth: the TS module
// @muebles/domain/pilotFurnitureCatalog). Regenerate with:
//
//	go generate ./internal/api
//
//go:generate cp ../../../contracts/pilotFurnitureCatalog.json ./contracts/pilotFurnitureCatalog.json
//
//go:embed contracts/pilotFurnitureCatalog.json
var pilotFurnitureCatalogJSON []byte

// pilotFurnitureCatalogRevision is extracted once from the embedded payload and
// used as a weak validator so clients can cache the catalog per revision.
var pilotFurnitureCatalogRevisionValue = func() string {
	var envelope struct {
		RevisionID string `json:"revisionId"`
	}
	if err := json.Unmarshal(pilotFurnitureCatalogJSON, &envelope); err != nil || envelope.RevisionID == "" {
		panic("furniture: embedded pilot catalog is not a valid contract envelope")
	}
	return `"` + envelope.RevisionID + `"`
}()

func pilotFurnitureCatalogRevision() string { return pilotFurnitureCatalogRevisionValue }

// HandleFurnitureDefinitions: GET /api/furniture/definitions
// Serves the workshop's parametric furniture catalog to authenticated clients
// (today: the SketchUp extension). Requires an active per-user license; the
// response body is the shared contract artifact verbatim so every client sees
// byte-identical catalog data.
func (s *Server) HandleFurnitureDefinitions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	claims, ok := r.Context().Value(UserContextKey).(*auth.Claims)
	if !ok || claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}

	u, err := s.Store.GetUserByID(r.Context(), claims.UserID)
	if err != nil || u == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}

	status := domain.LicenseStatusAt(u.LicensePlan, u.LicenseExpiresAt, time.Now())
	if status != domain.LicenseStatusActive {
		// Blockers must explain how to resolve them: point the user at the
		// workshop admin instead of a bare 403.
		respondWithError(w, http.StatusForbidden,
			"tu licencia no está activa. Pedile al administrador del taller que asigne o renueve tu licencia (plan y vencimiento) para usar la biblioteca de Granete.")
		return
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "private, max-age=300")
	if r.Header.Get("If-None-Match") == pilotFurnitureCatalogRevision() {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("ETag", pilotFurnitureCatalogRevision())
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(pilotFurnitureCatalogJSON)
}
