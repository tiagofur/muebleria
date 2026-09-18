package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #395 / DT-11: DesignRevision approval + ProductionRelease API (ADR-0003,
// digital-thread §§17, 21–23, 25.6).
//
// Approval is an explicit, permission-protected lifecycle decision on an
// exact revision — publish never auto-approves. Release runs the whole §17
// gate server-side against exact revisions and pins the immutable row to
// them. The client supplies no verdicts: no approved flags, no preflight
// results, no fingerprints (§§32–33).

// HandleDesignRevisionApprove serves POST
// /api/designs/{designId}/revisions/{revisionId}:approve — the GENERIC
// design-lifecycle transition (#395, design-first flows without a
// commercial baseline). Production approval is the separate always-gated
// HandleProjectDesignRevisionApproveForProduction.
func (s *Server) HandleDesignRevisionApprove(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanApproveDesignRevisions), "no tenés permiso para aprobar revisiones de diseño") {
		return
	}

	designID := r.PathValue("designId")
	revisionID := r.PathValue("revisionId")
	if !isValidUUID(designID) || !isValidUUID(revisionID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "IDs inválidos", nil)
		return
	}

	rev, err := s.Store.ApproveDesignRevision(r.Context(), storage.ApproveDesignRevisionCommand{
		DesignID:         designID,
		DesignRevisionID: revisionID,
		ActorUserID:      claims.UserID,
		IP:               clientIP(r),
		RequestID:        RequestIDFromContext(r.Context()),
	})
	if err != nil {
		respondWithDesignApprovalError(w, err)
		return
	}
	// #640: embedded artifacts carry authoritative health on every surface
	// that serializes them (approve loads artifacts in the revision).
	respondWithJSON(w, http.StatusOK, s.toDesignRevisionDTOWithArtifactHealth(r.Context(), *rev))
}

// HandleProjectDesignRevisionApproveForProduction serves POST
// /api/projects/{projectId}/designs/{designId}/revisions/{revisionId}:approve-for-production
// (#502 / WEB-DT-3). The exact accepted QuoteRevision is REQUIRED: the
// server always runs the same authoritative commercial + preflight gate
// chain the release command enforces over the exact pair before the
// published→approved transition — there is no skip mode.
func (s *Server) HandleProjectDesignRevisionApproveForProduction(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanApproveDesignRevisions), "no tenés permiso para aprobar revisiones de diseño") {
		return
	}

	projectID := r.PathValue("projectId")
	designID := r.PathValue("designId")
	revisionID := r.PathValue("revisionId")
	if !isValidUUID(projectID) || !isValidUUID(designID) || !isValidUUID(revisionID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "IDs inválidos", nil)
		return
	}

	var payload openapi.ApproveDesignRevisionForProductionRequest
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "cuerpo de solicitud inválido", nil)
		return
	}
	quoteRevisionID := strings.TrimSpace(payload.QuoteRevisionId)
	if quoteRevisionID == "" || !isValidUUID(quoteRevisionID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "quoteRevisionId exacto es obligatorio para la aprobación de producción", nil)
		return
	}

	rev, err := s.Store.ApproveDesignRevisionForProduction(r.Context(), storage.ApproveDesignRevisionForProductionCommand{
		ProjectID:        projectID,
		DesignID:         designID,
		DesignRevisionID: revisionID,
		QuoteRevisionID:  quoteRevisionID,
		ActorUserID:      claims.UserID,
		IP:               clientIP(r),
		RequestID:        RequestIDFromContext(r.Context()),
	})
	if err != nil {
		respondWithDesignApprovalError(w, err)
		return
	}
	// #640: embedded artifacts carry authoritative health on every surface
	// that serializes them (approve loads artifacts in the revision).
	respondWithJSON(w, http.StatusOK, s.toDesignRevisionDTOWithArtifactHealth(r.Context(), *rev))
}

func respondWithDesignApprovalError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrDesignRevisionNotFound):
		respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "La revisión de diseño no existe", nil)
	case errors.Is(err, domain.ErrInvalidDesignCommand):
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "comando de aprobación inválido", nil)
	case errors.Is(err, domain.ErrDesignRevisionApprovalInvalid):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "la revisión no puede aprobarse desde su estado actual", nil)
	default:
		var preflightBlocked *domain.ReleasePreflightBlockedError
		var commercialBlocked *domain.ReleaseCommercialGateError
		var resolutionFailure *domain.ReleaseUnitResolutionFailure
		if errors.As(err, &preflightBlocked) || errors.As(err, &commercialBlocked) ||
			errors.As(err, &resolutionFailure) ||
			errors.Is(err, storage.ErrReleaseSnapshotResolution) ||
			errors.Is(err, domain.ErrReleaseQuoteNotAccepted) ||
			errors.Is(err, domain.ErrQuoteRevisionNotFound) ||
			errors.Is(err, domain.ErrCrossProjectRelease) {
			// #502 production approval gate: SAME typed 409 blocker vocabulary
			// the release command exposes — one verdict, two commands. #727:
			// release snapshot resolution participates in the same chain.
			respondWithProductionReleaseError(w, err)
			return
		}
		respondWithInternalError(w, err, "approve design revision")
	}
}

// HandleDesignRevisionPreflight serves POST
// /api/designs/{designId}/revisions/{revisionId}/preflight (#502 / WEB-DT-3).
// Read-only evaluation of the authoritative release manufacturing preflight
// over the exact immutable revision — the same verdict createProductionRelease
// enforces, surfaced so Web can show it WITHOUT a second engine and without
// attempting a release to discover blockers.
func (s *Server) HandleDesignRevisionPreflight(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanAccessProjects), "no tenés permiso para ver el preflight de la revisión") {
		return
	}

	designID := r.PathValue("designId")
	revisionID := r.PathValue("revisionId")
	if !isValidUUID(designID) || !isValidUUID(revisionID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "IDs inválidos", nil)
		return
	}

	result, err := s.Store.EvaluateDesignRevisionPreflight(r.Context(), designID, revisionID)
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrDesignRevisionNotFound):
			respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "La revisión de diseño no existe", nil)
		case errors.Is(err, domain.ErrInvalidReleaseCommand):
			respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "IDs inválidos", nil)
		default:
			respondWithInternalError(w, err, "evaluate design revision preflight")
		}
		return
	}
	// Server-authoritative projection (#502 permissions): every project role
	// sees the verdict, the business-safe message and the blocked-unit count;
	// the manufacturing internals (per-unit items, structured issue codes and
	// parameter diagnostics) only reach roles with release/manufacturing
	// capability.
	includesDetail := domain.AnyRole(actorRoles(claims), domain.RoleCanReleaseProduction)
	respondWithJSON(w, http.StatusOK, toManufacturingPreflightDTO(result, includesDetail))
}

func toManufacturingPreflightIssueDTO(issues []domain.ManufacturingPreflightIssue) []openapi.ManufacturingPreflightIssue {
	out := make([]openapi.ManufacturingPreflightIssue, 0, len(issues))
	for _, issue := range issues {
		dto := openapi.ManufacturingPreflightIssue{
			Code:    openapi.ManufacturingPreflightIssueCode(issue.Code),
			Message: issue.Message,
		}
		if issue.FurnitureInstanceID != "" {
			id := issue.FurnitureInstanceID
			dto.FurnitureInstanceId = &id
		}
		if issue.FurnitureDefinitionID != "" {
			id := issue.FurnitureDefinitionID
			dto.FurnitureDefinitionId = &id
		}
		if issue.Parameter != "" {
			p := issue.Parameter
			dto.Parameter = &p
		}
		out = append(out, dto)
	}
	return out
}

func toManufacturingPreflightDTO(result *domain.ManufacturingPreflightResult, includesDetail bool) openapi.ManufacturingPreflightResult {
	blocked := 0
	for _, item := range result.Items {
		if item.Status == domain.ManufacturingPreflightItemBlocked {
			blocked++
		}
	}
	message := "El preflight de fabricación valida todas las unidades de la revisión contra el catálogo: listo."
	if result.Status == domain.ManufacturingPreflightBlocked {
		message = fmt.Sprintf("El preflight de fabricación bloquea la revisión: %d %s con problemas de fabricación.", blocked, pluralizeUnits(blocked))
	}
	dto := openapi.ManufacturingPreflightResult{
		DesignRevisionId: result.DesignRevisionID,
		Scope:            result.Scope,
		Status:           openapi.ManufacturingPreflightStatus(result.Status),
		Message:          message,
		IncludesDetail:   includesDetail,
		BlockedItemCount: int64(blocked),
		Items:            []openapi.ManufacturingPreflightItem{},
		Issues:           []openapi.ManufacturingPreflightIssue{},
	}
	if !includesDetail {
		return dto
	}
	for _, item := range result.Items {
		dto.Items = append(dto.Items, openapi.ManufacturingPreflightItem{
			FurnitureInstanceId:   item.FurnitureInstanceID,
			FurnitureDefinitionId: item.FurnitureDefinitionID,
			Status:                openapi.ManufacturingPreflightItemStatus(item.Status),
			Issues:                toManufacturingPreflightIssueDTO(item.Issues),
		})
	}
	dto.Issues = toManufacturingPreflightIssueDTO(result.Issues)
	return dto
}

func pluralizeUnits(count int) string {
	if count == 1 {
		return "unidad"
	}
	return "unidades"
}

// HandleProjectProductionReleases serves GET (list) and POST (create) for
// /api/projects/{projectId}/production-releases.
func (s *Server) HandleProjectProductionReleases(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	projectID := r.PathValue("projectId")
	if !isValidUUID(projectID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "projectId inválido", nil)
		return
	}

	switch r.Method {
	case http.MethodGet:
		if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanAccessProjects), "no tenés permiso para ver releases de producción") {
			return
		}
		readbacks, err := s.Store.ListProjectProductionReleases(r.Context(), projectID)
		if err != nil {
			respondWithProductionReleaseError(w, err)
			return
		}
		items := make([]openapi.ProductionRelease, 0, len(readbacks))
		for _, readback := range readbacks {
			items = append(items, toProductionReleaseDTO(readback))
		}
		respondWithJSON(w, http.StatusOK, items)
	case http.MethodPost:
		if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanReleaseProduction), "no tenés permiso para liberar producción") {
			return
		}
		var payload openapi.CreateProductionReleaseRequest
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "cuerpo de solicitud inválido", nil)
			return
		}
		designRevisionID := strings.TrimSpace(payload.DesignRevisionID)
		if !isValidUUID(designRevisionID) {
			respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "designRevisionId debe ser un UUID válido", nil)
			return
		}
		quoteRevisionID := ""
		if payload.QuoteRevisionID != nil && strings.TrimSpace(*payload.QuoteRevisionID) != "" {
			quoteRevisionID = strings.TrimSpace(*payload.QuoteRevisionID)
			if !isValidUUID(quoteRevisionID) {
				respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "quoteRevisionId debe ser un UUID válido", nil)
				return
			}
		}

		readback, err := s.Store.CreateProductionRelease(r.Context(), storage.CreateProductionReleaseCommand{
			ProjectID:        projectID,
			DesignRevisionID: designRevisionID,
			QuoteRevisionID:  quoteRevisionID,
			ActorUserID:      claims.UserID,
			IP:               clientIP(r),
			RequestID:        RequestIDFromContext(r.Context()),
		})
		if err != nil {
			respondWithProductionReleaseError(w, err)
			return
		}
		respondWithJSON(w, http.StatusCreated, toProductionReleaseDTO(*readback))
	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// HandleProjectProductionRelease serves GET
// /api/projects/{projectId}/production-releases/{releaseId}.
func (s *Server) HandleProjectProductionRelease(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanAccessProjects), "no tenés permiso para ver releases de producción") {
		return
	}
	projectID := r.PathValue("projectId")
	releaseID := r.PathValue("releaseId")
	if !isValidUUID(projectID) || !isValidUUID(releaseID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "IDs inválidos", nil)
		return
	}

	readback, err := s.Store.GetProjectProductionRelease(r.Context(), projectID, releaseID)
	if err != nil {
		respondWithProductionReleaseError(w, err)
		return
	}
	respondWithJSON(w, http.StatusOK, toProductionReleaseDTO(*readback))
}

// HandleProjectProductionReleaseCuttingDemand serves GET
// /api/projects/{projectId}/workshop-occurrences (#781). The project's
// frozen manufacturing occurrence authority: the LATEST production release's
// frozen unit order (ordinal = snapshot position, index+1) projected onto the
// CURRENT quote-line↔instance links. Engineering consumes it to build the
// derived BOM context so the same physical occurrence keeps the same workshop
// code from preview to PTX/CNC. Tenant-safe (release + link reads are
// org-scoped); no release yet is a plain 404-shaped unavailable answer, never
// a fallback to a live ordering.
func (s *Server) HandleProjectWorkshopOccurrences(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	// Same industrial-preparation guard as the cutting demand: the frozen
	// occurrence authority is factory engineering content.
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanReleaseProduction), "no tenés permiso para ver la ocurrencia de fabricación de esta obra") {
		return
	}
	projectID := r.PathValue("projectId")
	if !isValidUUID(projectID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "ID inválido", nil)
		return
	}
	view, err := s.Store.GetProjectWorkshopOccurrences(r.Context(), projectID)
	if err != nil {
		switch {
		case errors.Is(err, storage.ErrReleaseSnapshotUnavailable):
			respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound,
				"Esta obra todavía no tiene una liberación congelada",
				map[string]any{"blocker": "release_snapshot_unavailable"})
		default:
			respondWithProductionReleaseError(w, err)
		}
		return
	}
	respondWithJSON(w, http.StatusOK, toWorkshopOccurrencesDTO(view))
}

func toWorkshopOccurrencesDTO(view *storage.WorkshopOccurrenceProjectionView) openapi.ProjectWorkshopOccurrences {
	dto := openapi.ProjectWorkshopOccurrences{
		ReleaseID:                 view.ReleaseID,
		ReleaseNumber:             int64(view.ReleaseNumber),
		CoversAllCurrentInstances: view.CoversAllCurrentInstances,
		Assignments:               make([]openapi.WorkshopOccurrenceAssignment, 0, len(view.Assignments)),
	}
	for _, assignment := range view.Assignments {
		dto.Assignments = append(dto.Assignments, openapi.WorkshopOccurrenceAssignment{
			FurnitureInstanceID:       assignment.FurnitureInstanceID,
			ProjectItemID:             assignment.ProjectItemID,
			WorkshopOccurrenceOrdinal: int64(assignment.Ordinal),
		})
	}
	return dto
}

// /api/projects/{projectId}/production-releases/{releaseId}/cutting-demand
// (#739). Tenant-safe projection of the FROZEN manufacturing snapshot: the
// board cutting demand engineering prepares against — exact unit/part
// identities, quantities, finished dimensions, effective thickness, material
// identity, grain and edge flags. No costs, no routing, no evaluated
// parameters; the current catalog is never consulted to rebuild pieces. A
// missing/corrupt snapshot is unavailable evidence: an actionable conflict,
// never a fallback to the mutable project.
func (s *Server) HandleProjectProductionReleaseCuttingDemand(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	// #739 — industrial preparation capability (admin/gerente_produccion/
	// ingeniero): the frozen despiece is factory engineering content, never a
	// store/commercial surface. Cross-org isolation is enforced by the
	// snapshot read (organization_id-scoped), mirroring the release reads.
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanReleaseProduction), "no tenés permiso para preparar el corte de esta liberación") {
		return
	}
	projectID := r.PathValue("projectId")
	releaseID := r.PathValue("releaseId")
	if !isValidUUID(projectID) || !isValidUUID(releaseID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "IDs inválidos", nil)
		return
	}

	demand, err := s.Store.GetProjectProductionReleaseCuttingDemand(r.Context(), projectID, releaseID)
	if err != nil {
		switch {
		case errors.Is(err, storage.ErrReleaseSnapshotUnavailable):
			respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict,
				"El despiece congelado de esta liberación no está disponible",
				map[string]any{"blocker": "release_snapshot_unavailable"})
		default:
			respondWithProductionReleaseError(w, err)
		}
		return
	}
	respondWithJSON(w, http.StatusOK, toReleaseCuttingDemandDTO(demand))
}

func toReleaseCuttingDemandDTO(view *storage.ReleaseCuttingDemandView) openapi.ReleaseCuttingDemand {
	dto := openapi.ReleaseCuttingDemand{
		ReleaseID:               view.ReleaseID,
		ReleaseNumber:           int64(view.ReleaseNumber),
		DesignRevisionID:        view.DesignRevisionID,
		DesignRevisionNumber:    int64(view.DesignRevisionNumber),
		ManufacturingFingerprint: view.ManufacturingFingerprint,
		SchemaVersion:           int64(view.SchemaVersion),
		Units:                   make([]openapi.ReleaseCuttingDemandUnit, 0, len(view.Units)),
	}
	for _, unit := range view.Units {
		unitDTO := openapi.ReleaseCuttingDemandUnit{
			FurnitureInstanceID:   unit.FurnitureInstanceID,
			FurnitureDefinitionID: unit.FurnitureDefinitionID,
			WorkshopOccurrenceOrdinal: int64(unit.WorkshopOccurrenceOrdinal),
			Pieces:                make([]openapi.ReleaseCuttingDemandPiece, 0, len(unit.Pieces)),
		}
		for _, piece := range unit.Pieces {
			pieceDTO := openapi.ReleaseCuttingDemandPiece{
				PartID:      piece.PartID,
				Description: piece.Description,
				Quantity:    int64(piece.Quantity),
				LengthMm:    int64(piece.LengthMm),
				WidthMm:     int64(piece.WidthMm),
				ThicknessMm: int64(piece.ThicknessMm),
				MaterialID:  piece.MaterialID,
				Grain:       int64(piece.Grain),
				L1:          int64(piece.L1),
				L2:          int64(piece.L2),
				W1:          int64(piece.W1),
				W2:          int64(piece.W2),
			}
			if piece.PartCode != "" {
				code := piece.PartCode
				pieceDTO.PartCode = &code
			}
			if piece.EdgeBandID != "" {
				edge := piece.EdgeBandID
				pieceDTO.EdgeBandID = &edge
			}
			if piece.OptionRole != "" {
				role := piece.OptionRole
				pieceDTO.OptionRole = &role
			}
			unitDTO.Pieces = append(unitDTO.Pieces, pieceDTO)
		}
		dto.Units = append(dto.Units, unitDTO)
	}
	return dto
}

func toProductionReleaseDTO(readback storage.ProductionReleaseReadback) openapi.ProductionRelease {
	release := readback.Release
	dto := openapi.ProductionRelease{
		ID:                       release.ID,
		ProjectID:                release.ProjectID,
		ReleaseNumber:            int64(release.ReleaseNumber),
		DesignRevisionID:         release.DesignRevisionID,
		DesignRevisionNumber:     int64(release.DesignRevisionNumber),
		ManufacturingFingerprint: release.ManufacturingFingerprint,
		Status:                   openapi.ProductionReleaseStatus(release.Status),
		ReleasedBy:               release.ReleasedBy,
		ReleasedAt:               release.ReleasedAt.UTC().Format(time.RFC3339Nano),
		Staleness: openapi.ProductionReleaseStaleness{
			ManufacturingStale: readback.Staleness.ManufacturingStale,
		},
	}
	if release.DesignID != "" {
		designID := release.DesignID
		dto.DesignID = &designID
	}
	if release.QuoteRevisionID != "" {
		q := release.QuoteRevisionID
		dto.QuoteRevisionID = &q
	}
	if readback.Staleness.CurrentDesignRevisionID != "" {
		id := readback.Staleness.CurrentDesignRevisionID
		dto.Staleness.CurrentDesignRevisionID = &id
		if readback.Staleness.CurrentDesignRevisionNumber > 0 {
			n := int64(readback.Staleness.CurrentDesignRevisionNumber)
			dto.Staleness.CurrentDesignRevisionNumber = &n
		}
	}
	return dto
}

// respondWithProductionReleaseError maps the gate verdicts to exact HTTP
// semantics: gate rejections are 409 CONFLICT with the authoritative blockers
// in details; missing and cross-project objects share the uniform 404.
func respondWithProductionReleaseError(w http.ResponseWriter, err error) {
	var preflightBlocked *domain.ReleasePreflightBlockedError
	if errors.As(err, &preflightBlocked) {
		issues := make([]map[string]any, 0, len(preflightBlocked.Result.Issues))
		for _, issue := range preflightBlocked.Result.Issues {
			issues = append(issues, map[string]any{
				"code":                  string(issue.Code),
				"furnitureInstanceId":   issue.FurnitureInstanceID,
				"furnitureDefinitionId": issue.FurnitureDefinitionID,
				"parameter":             issue.Parameter,
				"message":               issue.Message,
			})
		}
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict,
			"el preflight de fabricación bloqueó el release",
			map[string]any{
				"blocker": "manufacturing_preflight_blocked",
				"issues":  issues,
			})
		return
	}
	var commercialBlocked *domain.ReleaseCommercialGateError
	if errors.As(err, &commercialBlocked) {
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict,
			commercialBlocked.Error(),
			map[string]any{
				"blocker":            string(commercialBlocked.Cause),
				"requiresRequote":    commercialBlocked.Classification.Summary.RequiresRequote,
				"requiresResolution": commercialBlocked.Classification.Summary.RequiresResolution,
			})
		return
	}
	// #727: an unresolvable snapshot is an actionable conflict — the exact
	// physical identities and the business-safe reason travel in details, never
	// SQL, paths or internals.
	var resolutionFailure *domain.ReleaseUnitResolutionFailure
	if errors.As(err, &resolutionFailure) {
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict,
			"La revisión no puede resolverse para fabricación",
			map[string]any{
				"blocker":                "release_snapshot_resolution",
				"furnitureInstanceId":    resolutionFailure.FurnitureInstanceID,
				"furnitureDefinitionId":  resolutionFailure.FurnitureDefinitionID,
				"reason":                 resolutionFailure.Reason,
			})
		return
	}
	switch {
	case errors.Is(err, domain.ErrDesignNotFound), errors.Is(err, domain.ErrDesignRevisionNotFound),
		errors.Is(err, domain.ErrQuoteRevisionNotFound), errors.Is(err, domain.ErrReleaseNotFound),
		errors.Is(err, domain.ErrCrossProjectRelease):
		respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "El proyecto, la revisión o el release no existe", nil)
	case errors.Is(err, domain.ErrInvalidReleaseCommand):
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "comando de release inválido", nil)
	case errors.Is(err, storage.ErrReleaseSnapshotResolution):
		// Collection-level resolution failure without a typed unit cause.
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict,
			"La revisión no puede resolverse para fabricación",
			map[string]any{"blocker": "release_snapshot_resolution"})
	case errors.Is(err, domain.ErrDesignRevisionNotApproved):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "la revisión de diseño no está aprobada para producción", nil)
	case errors.Is(err, domain.ErrReleaseQuoteNotAccepted):
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "la cotización base no está aceptada", nil)
	default:
		respondWithInternalError(w, err, "production release")
	}
}
