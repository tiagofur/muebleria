package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

/**
 * Material planning endpoints (OC-050..OC-054, issue #302).
 *
 * GET  /api/projects/{id}/materials — planning + derived evidence view
 *      (warehouse availability, project coverage, release gates).
 * POST /api/projects/{id}/materials/derive — materialize requirements from
 *      the released BOM (only path: no heuristics, OC-050).
 * POST /api/projects/{id}/materials/reserve — reserve against availability;
 *      the shortage remainder is audited (OC-051/052).
 * POST /api/projects/{id}/materials/release — evidence-backed release to the
 *      floor; failing gates require an audited override (OC-054). This is the
 *      only writer of projects.materials_release.
 */

func materialsPayload(v interface{}) json.RawMessage {
	raw, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	return raw
}

// roleCanManagePlanning mirrors the event RBAC matrix: the roles allowed to
// append materials_* lifecycle events are the roles that may work the plan.
func roleCanManagePlanning(role domain.UserRole) bool {
	return domain.RoleCanAppendProjectEvent(role, "materials_required")
}

func roleCanOverrideRelease(role domain.UserRole) bool {
	return domain.RoleCanAppendProjectEvent(role, "materials_release_overridden")
}

type materialsViewResponse struct {
	Planning       *domain.MaterialPlanning       `json:"planning"`
	Availability   []domain.MaterialAvailability  `json:"availability"`
	Coverage       []domain.ProjectLineCoverage   `json:"coverage"`
	ReleaseChecks  []domain.MaterialsReleaseCheck `json:"release_checks"`
	ReleaseReady   bool                           `json:"release_ready"`
	Released       bool                           `json:"released"`
	EventsAppended int                            `json:"events_appended,omitempty"`
}

func buildMaterialsView(snap *domain.MaterialPlanningSnapshot, planning *domain.MaterialPlanning) materialsViewResponse {
	if planning == nil {
		planning = snap.Planning
	}
	plannings := snap.AllPlannings
	if planning != nil {
		plannings = replacePlanning(snap.AllPlannings, planning)
	}
	checks, ready := domain.EvaluateMaterialsReleaseReadiness(planning, snap.Stock, plannings)
	if checks == nil {
		checks = []domain.MaterialsReleaseCheck{}
	}
	coverage := domain.ComputeProjectCoverage(planning.ProjectID, snap.Stock, plannings, snap.PurchaseOrders)
	if coverage == nil {
		coverage = []domain.ProjectLineCoverage{}
	}
	availability := domain.ComputeWarehouseAvailability(snap.Stock, plannings, snap.PurchaseOrders)
	return materialsViewResponse{
		Planning:      planning,
		Availability:  availability,
		Coverage:      coverage,
		ReleaseChecks: checks,
		ReleaseReady:  ready,
		Released:      snap.MaterialsReleased,
	}
}

func replacePlanning(all []*domain.MaterialPlanning, planning *domain.MaterialPlanning) []*domain.MaterialPlanning {
	out := make([]*domain.MaterialPlanning, 0, len(all)+1)
	found := false
	for _, p := range all {
		if p != nil && p.ProjectID == planning.ProjectID {
			out = append(out, planning)
			found = true
		} else {
			out = append(out, p)
		}
	}
	if !found {
		out = append(out, planning)
	}
	return out
}

// HandleProjectMaterials handles GET /api/projects/{id}/materials.
func (s *Server) HandleProjectMaterials(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
		return
	}
	projectID := r.PathValue("id")
	claims := claimsFromRequest(r)
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), roleCanManagePlanning),
		"no tenés permiso para ver la planificación de materiales") {
		return
	}
	var view materialsViewResponse
	_, err := s.Store.MutateProjectMaterialPlanning(r.Context(), projectID, func(snap *domain.MaterialPlanningSnapshot) (*domain.MaterialPlanningMutation, error) {
		view = buildMaterialsView(snap, nil)
		return &domain.MaterialPlanningMutation{Planning: snap.Planning}, nil
	})
	if err != nil {
		respondWithMutationError(w, err)
		return
	}
	respondWithJSON(w, http.StatusOK, view)
}

type deriveMaterialsRequest struct {
	Lines []struct {
		Kind       string  `json:"kind"`
		MaterialID string  `json:"material_id"`
		Quantity   float64 `json:"quantity"`
	} `json:"lines"`
}

// HandleMaterialsDerive handles POST /api/projects/{id}/materials/derive —
// materialize the requirements snapshot from the released BOM (OC-050). The
// lines come from the TS BOM engine; the server binds them to the recorded
// production release (id + bomFingerprint) and audits materials_required.
func (s *Server) HandleMaterialsDerive(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	claims := claimsFromRequest(r)
	roles := actorRoles(claims)
	if !requirePermission(w, domain.AnyRole(roles, roleCanManagePlanning),
		"no tenés permiso para derivar requerimientos") {
		return
	}
	var body deriveMaterialsRequest
	if !decodeJSONBody(w, r, &body) {
		return
	}
	if len(body.Lines) == 0 {
		respondWithError(w, http.StatusBadRequest, "derivar requiere las líneas del BOM liberado")
		return
	}
	lines := make([]domain.MaterialRequirementLine, 0, len(body.Lines))
	for _, line := range body.Lines {
		if !domain.ValidStockMaterialKind(line.Kind) || strings.TrimSpace(line.MaterialID) == "" || line.Quantity <= 0 {
			respondWithError(w, http.StatusBadRequest, "línea de requerimiento inválida (material + cantidad > 0)")
			return
		}
		lines = append(lines, domain.MaterialRequirementLine{
			Kind:       line.Kind,
			MaterialID: strings.TrimSpace(line.MaterialID),
			Quantity:   line.Quantity,
		})
	}

	var view materialsViewResponse
	_, err := s.Store.MutateProjectMaterialPlanning(r.Context(), projectID, func(snap *domain.MaterialPlanningSnapshot) (*domain.MaterialPlanningMutation, error) {
		release := snap.ProductionRelease
		if release == nil || release.ReleaseID == "" {
			return nil, fmt.Errorf("CONFLICT:los requerimientos se derivan del BOM liberado: la obra no tiene liberación de producción")
		}
		if snap.Planning != nil && snap.Planning.Release != nil {
			return nil, fmt.Errorf("CONFLICT:el material de esta obra ya fue liberado")
		}

		now := time.Now().UTC()
		planning := snap.Planning
		if planning == nil {
			planning = &domain.MaterialPlanning{
				ID:        domain.NewMaterialPlanningID("mplan"),
				ProjectID: projectID,
				CreatedAt: now,
			}
		}
		planning = &domain.MaterialPlanning{
			ID:        planning.ID,
			ProjectID: planning.ProjectID,
			Requirements: &domain.MaterialRequirementsSnapshot{
				ReleaseID:      release.ReleaseID,
				BomFingerprint: release.ManufacturingFingerprint,
				DerivedAt:      now,
				DerivedBy:      actorID(claims),
				Lines:          lines,
			},
			Reservations: planning.Reservations,
			Release:      planning.Release,
			CreatedAt:    planning.CreatedAt,
		}
		if err := domain.ValidateMaterialPlanningShape(planning); err != nil {
			return nil, fmt.Errorf("BAD_REQUEST:%s", err.Error())
		}

		event := domain.ProjectEvent{
			ID: newProjectEventID(), ProjectID: projectID,
			Type: "materials_required", At: now, ByUserID: byUserIDFromClaims(claims), Source: domain.ProjectEventSourceAPI,
			Note:    fmt.Sprintf("Requerimientos derivados del BOM liberado (%d líneas)", len(lines)),
			Payload: materialsPayload(map[string]interface{}{"release_id": release.ReleaseID, "bom_fingerprint": release.ManufacturingFingerprint, "line_count": len(lines)}),
		}
		view = buildMaterialsViewWithPlanning(snap, planning)
		return &domain.MaterialPlanningMutation{Planning: planning, Events: []domain.ProjectEvent{event}}, nil
	})
	if err != nil {
		respondWithMutationError(w, err)
		return
	}
	view.EventsAppended = 1
	respondWithJSON(w, http.StatusOK, view)
}

type reserveMaterialsRequest struct {
	Lines []struct {
		Kind       string  `json:"kind"`
		MaterialID string  `json:"material_id"`
		Quantity   float64 `json:"quantity"`
	} `json:"lines"`
}

// HandleMaterialsReserve handles POST /api/projects/{id}/materials/reserve —
// server-authoritative reservations capped by warehouse availability
// (OC-051). The shortage remainder is audited via
// materials_shortage_detected (OC-052).
func (s *Server) HandleMaterialsReserve(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	claims := claimsFromRequest(r)
	roles := actorRoles(claims)
	if !requirePermission(w, domain.AnyRole(roles, roleCanManagePlanning),
		"no tenés permiso para reservar material") {
		return
	}
	var body reserveMaterialsRequest
	if !decodeJSONBody(w, r, &body) {
		return
	}
	var wanted []domain.ReserveLine
	for _, line := range body.Lines {
		if line.Quantity <= 0 {
			continue
		}
		if !domain.ValidStockMaterialKind(line.Kind) || strings.TrimSpace(line.MaterialID) == "" {
			respondWithError(w, http.StatusBadRequest, "línea de reserva inválida")
			return
		}
		wanted = append(wanted, domain.ReserveLine{
			Kind:       line.Kind,
			MaterialID: strings.TrimSpace(line.MaterialID),
			Quantity:   line.Quantity,
		})
	}

	var view materialsViewResponse
	var reservedLines, shortLines []domain.ReserveLine
	mutation, err := s.Store.MutateProjectMaterialPlanning(r.Context(), projectID, func(snap *domain.MaterialPlanningSnapshot) (*domain.MaterialPlanningMutation, error) {
		if snap.Planning == nil || snap.Planning.Requirements == nil {
			return nil, fmt.Errorf("CONFLICT:derivar los requerimientos del BOM liberado antes de reservar material")
		}
		if snap.Planning.Release != nil {
			return nil, fmt.Errorf("CONFLICT:el material de esta obra ya fue liberado")
		}

		now := time.Now().UTC()
		next, reserved, short := domain.PlanReservations(snap.Planning, snap.Stock, snap.AllPlannings, wanted, actorID(claims), now)
		if len(reserved) == 0 && len(short) == 0 {
			return nil, fmt.Errorf("CONFLICT:no hay material pendiente por reservar")
		}

		events := []domain.ProjectEvent{}
		if len(reserved) > 0 && !snap.HasMaterialsReservedEvent {
			events = append(events, domain.ProjectEvent{
				ID: newProjectEventID(), ProjectID: projectID,
				Type: "materials_reserved", At: now, ByUserID: byUserIDFromClaims(claims), Source: domain.ProjectEventSourceAPI,
				Note:    fmt.Sprintf("Material reservado (%d líneas)", len(reserved)),
				Payload: materialsPayload(map[string]interface{}{"lines": reserved}),
			})
		}
		if len(short) > 0 {
			events = append(events, domain.ProjectEvent{
				ID: newProjectEventID(), ProjectID: projectID,
				Type: "materials_shortage_detected", At: now, ByUserID: byUserIDFromClaims(claims), Source: domain.ProjectEventSourceAPI,
				Note:    fmt.Sprintf("Faltante de material detectado (%d líneas)", len(short)),
				Payload: materialsPayload(map[string]interface{}{"lines": short}),
			})
		}

		view = buildMaterialsViewWithPlanning(snap, next)
		reservedLines = reserved
		shortLines = short
		return &domain.MaterialPlanningMutation{Planning: next, Events: events}, nil
	})
	if err != nil {
		respondWithMutationError(w, err)
		return
	}
	view.EventsAppended = len(mutation.Events)
	respondWithJSON(w, http.StatusOK, map[string]interface{}{
		"planning":        view.Planning,
		"coverage":        view.Coverage,
		"release_checks":  view.ReleaseChecks,
		"release_ready":   view.ReleaseReady,
		"reserved_lines":  reservedLines,
		"short_lines":     shortLines,
		"events_appended": len(mutation.Events),
	})
}

type releaseMaterialsRequest struct {
	OverrideReason string `json:"override_reason,omitempty"`
}

type consumeMaterialsRequest struct {
	Lines []struct {
		Kind       string  `json:"kind"`
		MaterialID string  `json:"material_id"`
		Quantity   float64 `json:"quantity"`
	} `json:"lines"`
}

// HandleMaterialsConsume handles POST /api/projects/{id}/materials/consume —
// a picking despacho consumes the project's active reservations (oldest
// first, partial splits). The reservation record is history: an unmark
// reverts stock but never revokes consumption.
func (s *Server) HandleMaterialsConsume(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	claims := claimsFromRequest(r)
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), roleCanManagePlanning),
		"no tenés permiso para despachar material reservado") {
		return
	}
	var body consumeMaterialsRequest
	if !decodeJSONBody(w, r, &body) {
		return
	}
	lines := make([]domain.ReserveLine, 0, len(body.Lines))
	for _, line := range body.Lines {
		if line.Quantity <= 0 {
			continue
		}
		if !domain.ValidStockMaterialKind(line.Kind) || strings.TrimSpace(line.MaterialID) == "" {
			respondWithError(w, http.StatusBadRequest, "línea de consumo inválida")
			return
		}
		lines = append(lines, domain.ReserveLine{
			Kind:       line.Kind,
			MaterialID: strings.TrimSpace(line.MaterialID),
			Quantity:   line.Quantity,
		})
	}

	var view materialsViewResponse
	mutation, err := s.Store.MutateProjectMaterialPlanning(r.Context(), projectID, func(snap *domain.MaterialPlanningSnapshot) (*domain.MaterialPlanningMutation, error) {
		if snap.Planning == nil {
			// Sin planificación no hay reservas que consumir: no-op honesto.
			view = buildMaterialsView(snap, nil)
			return &domain.MaterialPlanningMutation{Planning: snap.Planning}, nil
		}
		next := domain.ConsumePlannedMaterials(snap.Planning, lines, time.Now().UTC())
		if err := domain.ValidateMaterialPlanningTransition(snap.Planning, next); err != nil {
			return nil, fmt.Errorf("BAD_REQUEST:%s", err.Error())
		}
		view = buildMaterialsViewWithPlanning(snap, next)
		return &domain.MaterialPlanningMutation{Planning: next}, nil
	})
	if err != nil {
		respondWithMutationError(w, err)
		return
	}
	view.EventsAppended = len(mutation.Events)
	respondWithJSON(w, http.StatusOK, view)
}

// HandleMaterialsRelease handles POST /api/projects/{id}/materials/release —
// the evidence-backed materials release (OC-054). Failing gates require an
// override reason; the override is audited (materials_release_overridden)
// before materials_ready, and the processStage stamp
// (projects.materials_release) is written in the same transaction.
func (s *Server) HandleMaterialsRelease(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	claims := claimsFromRequest(r)
	roles := actorRoles(claims)
	if !requirePermission(w, domain.AnyRole(roles, func(rr domain.UserRole) bool { return domain.RoleCanAppendProjectEvent(rr, "materials_ready") }),
		"no tenés permiso para liberar material") {
		return
	}
	var body releaseMaterialsRequest
	if !decodeJSONBody(w, r, &body) {
		return
	}
	overrideReason := strings.TrimSpace(body.OverrideReason)

	var gateChecks []domain.MaterialsReleaseCheck
	gateBlocked := false
	var view materialsViewResponse
	mutation, err := s.Store.MutateProjectMaterialPlanning(r.Context(), projectID, func(snap *domain.MaterialPlanningSnapshot) (*domain.MaterialPlanningMutation, error) {
		if snap.MaterialsReleased || snap.Planning.Release != nil {
			return nil, fmt.Errorf("CONFLICT:el material de esta obra ya fue liberado")
		}

		plannings := snap.AllPlannings
		if snap.Planning != nil {
			plannings = replacePlanning(snap.AllPlannings, snap.Planning)
		}
		checks, ready := domain.EvaluateMaterialsReleaseReadiness(snap.Planning, snap.Stock, plannings)
		gateChecks = checks
		if !ready {
			if overrideReason == "" {
				gateBlocked = true
				return nil, fmt.Errorf("MATERIALS_GATE")
			}
			if !domain.AnyRole(roles, roleCanOverrideRelease) {
				return nil, fmt.Errorf("FORBIDDEN:no tenés permiso para liberar material con faltantes (override)")
			}
		}

		now := time.Now().UTC()
		byUserID := actorID(claims)
		planning := snap.Planning
		if planning == nil {
			planning = &domain.MaterialPlanning{
				ID:        domain.NewMaterialPlanningID("mplan"),
				ProjectID: projectID,
				CreatedAt: now,
			}
		}
		reservations := make([]domain.MaterialReservation, 0, len(planning.Reservations))
		for _, res := range planning.Reservations {
			if res.Status == domain.MaterialReservationActive {
				res.Status = domain.MaterialReservationReleased
				res.ReleasedAt = &now
			}
			reservations = append(reservations, res)
		}
		release := &domain.MaterialsReleaseEvidence{ReleasedAt: now, ReleasedBy: byUserID}
		if !ready && overrideReason != "" {
			failing := make([]string, 0)
			for _, c := range checks {
				if c.Required && !c.Passed {
					failing = append(failing, string(c.Code))
				}
			}
			release.Override = &domain.MaterialsReleaseOverride{
				Reason:        overrideReason,
				ByUserID:      byUserID,
				At:            now,
				FailingChecks: failing,
			}
		}
		next := &domain.MaterialPlanning{
			ID:           planning.ID,
			ProjectID:    planning.ProjectID,
			Requirements: planning.Requirements,
			Reservations: reservations,
			Release:      release,
			CreatedAt:    planning.CreatedAt,
		}
		if err := domain.ValidateMaterialPlanningTransition(snap.Planning, next); err != nil {
			return nil, fmt.Errorf("BAD_REQUEST:%s", err.Error())
		}

		events := []domain.ProjectEvent{}
		if release.Override != nil {
			events = append(events, domain.ProjectEvent{
				ID: newProjectEventID(), ProjectID: projectID,
				Type: "materials_release_overridden", At: now, ByUserID: byUserIDFromClaims(claims), Source: domain.ProjectEventSourceAPI,
				Note:    "Liberación con faltantes (override): " + overrideReason,
				Payload: materialsPayload(map[string]interface{}{"reason": overrideReason, "failing_checks": release.Override.FailingChecks}),
			})
		}
		lineCount := 0
		if planning.Requirements != nil {
			lineCount = len(planning.Requirements.Lines)
		}
		events = append(events, domain.ProjectEvent{
			ID: newProjectEventID(), ProjectID: projectID,
			Type: "materials_ready", At: now, ByUserID: byUserIDFromClaims(claims), Source: domain.ProjectEventSourceAPI,
			Note:    "Material completo — liberado a producción",
			Payload: materialsPayload(map[string]interface{}{"line_count": lineCount}),
		})

		view = buildMaterialsViewWithPlanning(snap, next)
		view.Released = true
		return &domain.MaterialPlanningMutation{
			Planning:         next,
			MaterialsRelease: &domain.MaterialsReleaseStamp{ReleasedBy: byUserID, ReleasedAt: now},
			Events:           events,
		}, nil
	})
	if err != nil {
		if gateBlocked {
			respondWithJSON(w, http.StatusConflict, map[string]interface{}{
				"error":          "la liberación de material requiere evidencia completa o un override con motivo",
				"release_checks": gateChecks,
			})
			return
		}
		respondWithMutationError(w, err)
		return
	}
	view.EventsAppended = len(mutation.Events)
	respondWithJSON(w, http.StatusOK, view)
}

// buildMaterialsViewWithPlanning builds the evidence view for a candidate
// planning (the stored snapshot context with the candidate swapped in).
func buildMaterialsViewWithPlanning(snap *domain.MaterialPlanningSnapshot, planning *domain.MaterialPlanning) materialsViewResponse {
	plannings := replacePlanning(snap.AllPlannings, planning)
	view := buildMaterialsView(snap, planning)
	_ = plannings
	return view
}

func byUserIDFromClaims(claims *auth.Claims) *string {
	if claims == nil || claims.UserID == "" {
		return nil
	}
	return &claims.UserID
}
