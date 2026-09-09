package api

import (
	"net/http"
	"strings"
	"time"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #637 / DT-MAT: detection read model + explicit reconciliation command for
// quoted material choices missing from an existing design working snapshot.

func toMaterialRoleProvenanceDTO(role engine.MaterialRoleProvenance) openapi.MaterialRoleProvenance {
	dto := openapi.MaterialRoleProvenance{
		Role:       role.Role,
		Provenance: openapi.MaterialProvenanceStatus(role.Provenance),
	}
	if role.WorkingChoice != "" {
		dto.WorkingChoice = &role.WorkingChoice
	}
	if role.QuotedChoice != "" {
		dto.QuotedChoice = &role.QuotedChoice
	}
	if role.EffectiveChoice != "" {
		dto.EffectiveChoice = &role.EffectiveChoice
	}
	return dto
}

func toDesignWorkingItemMaterialProvenanceDTO(item storage.DesignWorkingItemMaterialProvenance) openapi.DesignWorkingItemMaterialProvenance {
	dto := openapi.DesignWorkingItemMaterialProvenance{
		FurnitureInstanceID: item.FurnitureInstanceID,
		Roles:               make([]openapi.MaterialRoleProvenance, 0, len(item.Roles)),
		Reconcilable:        item.Reconcilable,
	}
	if item.FurnitureDefinitionID != "" {
		dto.FurnitureDefinitionID = &item.FurnitureDefinitionID
	}
	for _, role := range item.Roles {
		dto.Roles = append(dto.Roles, toMaterialRoleProvenanceDTO(role))
	}
	return dto
}

func toDesignWorkingCopyMaterialProvenanceDTO(prov storage.DesignWorkingCopyMaterialProvenance) openapi.DesignWorkingCopyMaterialProvenance {
	dto := openapi.DesignWorkingCopyMaterialProvenance{
		DesignID:  prov.DesignID,
		ProjectID: prov.ProjectID,
		Items:     make([]openapi.DesignWorkingItemMaterialProvenance, 0, len(prov.Items)),
	}
	if !prov.WorkingCopyUpdatedAt.IsZero() {
		updatedAt := prov.WorkingCopyUpdatedAt.UTC().Format(time.RFC3339Nano)
		dto.WorkingCopyUpdatedAt = &updatedAt
	}
	for _, item := range prov.Items {
		dto.Items = append(dto.Items, toDesignWorkingItemMaterialProvenanceDTO(item))
	}
	return dto
}

// HandleDesignWorkingCopyMaterialProvenance serves GET for
// /api/designs/{designId}/working-copy/material-provenance: the read-only
// detection model. Reading never repairs anything (#637 no-silent-repair).
func (s *Server) HandleDesignWorkingCopyMaterialProvenance(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanAccessProjects), "no tenés permiso para ver el diseño") {
		return
	}
	designID := r.PathValue("designId")
	if !isValidUUID(designID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "designId inválido", nil)
		return
	}
	prov, err := s.Store.GetDesignWorkingCopyMaterialProvenance(r.Context(), designID)
	if err != nil {
		respondWithDesignError(w, err)
		return
	}
	respondWithJSON(w, http.StatusOK, toDesignWorkingCopyMaterialProvenanceDTO(*prov))
}

// HandleDesignWorkingCopyMaterialsReconcile serves POST for
// /api/designs/{designId}/working-copy/material-choices:reconcile: the
// explicit, observable repair of ONE exact unit's missing quoted roles.
// Authored roles always win and published revisions are never touched.
func (s *Server) HandleDesignWorkingCopyMaterialsReconcile(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanAccessProjects), "no tenés permiso para editar el diseño") {
		return
	}
	designID := r.PathValue("designId")
	if !isValidUUID(designID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "designId inválido", nil)
		return
	}

	var body openapi.ReconcileDesignWorkingMaterialsRequest
	if !decodeJSONBody(w, r, &body) {
		return
	}
	furnitureInstanceID := strings.TrimSpace(body.FurnitureInstanceID)
	if !isValidUUID(furnitureInstanceID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "furniture_instance_id inválido", nil)
		return
	}

	var expectedUpdatedAt *time.Time
	if body.ExpectedUpdatedAt != nil && strings.TrimSpace(*body.ExpectedUpdatedAt) != "" {
		parsed, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(*body.ExpectedUpdatedAt))
		if err != nil {
			respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "expected_updated_at inválido", nil)
			return
		}
		expectedUpdatedAt = &parsed
	}

	result, err := s.Store.ReconcileDesignWorkingMaterials(r.Context(), storage.ReconcileDesignWorkingMaterialsCommand{
		DesignID:            designID,
		FurnitureInstanceID: furnitureInstanceID,
		ExpectedUpdatedAt:   expectedUpdatedAt,
		ActorUserID:         claims.UserID,
		IP:                  clientIP(r),
		RequestID:           RequestIDFromContext(r.Context()),
	})
	if err != nil {
		respondWithDesignError(w, err)
		return
	}

	filled := result.FilledChoices
	if filled == nil {
		filled = map[string]string{}
	}
	preserved := result.PreservedChoices
	if preserved == nil {
		preserved = map[string]string{}
	}
	respondWithJSON(w, http.StatusOK, openapi.DesignWorkingMaterialsReconciliation{
		DesignID:             result.DesignID,
		ProjectID:            result.ProjectID,
		FurnitureInstanceID:  result.FurnitureInstanceID,
		FilledChoices:        filled,
		PreservedChoices:     preserved,
		WorkingCopyUpdatedAt: result.WorkingCopyUpdatedAt.UTC().Format(time.RFC3339Nano),
	})
}
