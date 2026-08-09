package api

import (
	"net/http"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// --- CATALOG / AMBIENT MATERIALS (presentation-only floor/wall, #4150) ---
//
// Mirrors HandleMaterials / HandleMaterialByID exactly: same role guard
// (RoleCanMutateCatalog on mutate, any authenticated user on read), same
// duplicate-key → 409 mapping, same media-cleanup-on-PUT, same not-found → 404.
// Differences are only what ambient materials lack: no cost redaction (they
// carry no pricing), no separate image_url (only preview_texture_url), and no
// server-side id generation branch (the FE always sends the id).

func (s *Server) HandleAmbientMaterials(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		list, err := s.Store.ListAmbientMaterials(r.Context())
		if err != nil {
			respondWithInternalError(w, err, "ambient materials list")
			return
		}
		respondWithJSON(w, http.StatusOK, list)

	case http.MethodPost:
		if !requirePermission(w, domain.RoleCanMutateCatalog(actorRole(claimsFromRequest(r))), "no tenés permiso para modificar el catálogo") {
			return
		}
		var m domain.AmbientMaterial
		if !decodeJSONBody(w, r, &m) {
			return
		}
		m.Active = true
		if err := s.Store.CreateAmbientMaterial(r.Context(), &m); err != nil {
			if isDuplicateKey(err) {
				respondWithError(w, http.StatusConflict, "El código ingresado ya está registrado")
				return
			}
			respondWithInternalError(w, err, "ambient material create")
			return
		}
		respondWithJSON(w, http.StatusCreated, m)

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) HandleAmbientMaterialByID(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		respondWithError(w, http.StatusBadRequest, "missing ambient material id")
		return
	}

	switch r.Method {
	case http.MethodGet:
		m, err := s.Store.GetAmbientMaterialByID(r.Context(), id)
		if err != nil {
			respondWithError(w, http.StatusNotFound, "ambient material not found")
			return
		}
		respondWithJSON(w, http.StatusOK, m)

	case http.MethodPut:
		if !requirePermission(w, domain.RoleCanMutateCatalog(actorRole(claimsFromRequest(r))), "no tenés permiso para modificar el catálogo") {
			return
		}
		var m domain.AmbientMaterial
		if !decodeJSONBody(w, r, &m) {
			return
		}
		// Snapshot the current texture URL so we can clean up a replaced media
		// file after a successful commit (mirrors material boards PUT). Reading
		// first keeps cleanup off the failure path.
		prevTexture := ""
		if cur, err := s.Store.GetAmbientMaterialByID(r.Context(), id); err == nil && cur != nil {
			prevTexture = cur.PreviewTextureURL
		}
		if err := s.Store.UpdateAmbientMaterial(r.Context(), id, &m); err != nil {
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, err.Error())
				return
			}
			if isDuplicateKey(err) {
				respondWithError(w, http.StatusConflict, "El código ingresado ya está registrado")
				return
			}
			respondWithInternalError(w, err, "ambient material update")
			return
		}
		if prevTexture != m.PreviewTextureURL {
			deleteMediaFileByURL(s.MediaDir, prevTexture)
		}
		respondWithJSON(w, http.StatusOK, m)

	case http.MethodDelete:
		if !requirePermission(w, domain.RoleCanMutateCatalog(actorRole(claimsFromRequest(r))), "no tenés permiso para modificar el catálogo") {
			return
		}
		if err := s.Store.DeactivateAmbientMaterial(r.Context(), id); err != nil {
			respondWithInternalError(w, err, "ambient material deactivate")
			return
		}
		respondWithJSON(w, http.StatusOK, map[string]string{"message": "ambient material deactivated"})

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}
