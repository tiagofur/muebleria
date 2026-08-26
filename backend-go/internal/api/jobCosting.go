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
 * Job costing endpoints (OC-080..OC-084, issue #304).
 *
 * GET  /api/projects/{id}/costing — costing + server-computed estimate vs
 *      actual summary (revenue, estimated/actual direct cost, variance,
 *      expected/actual gross margin) with the valued material consumption
 *      lines. Only for roles allowed to see costs (COST-01/COST-02).
 * POST /api/projects/{id}/costing/baseline — freeze the baseline from the
 *      quote snapshot + production release (OC-080).
 * POST /api/projects/{id}/costing/labor-rate — set the shop hourly rate in
 *      force for new time entries.
 * POST /api/projects/{id}/costing/time — record labor time (OC-081).
 * POST /api/projects/{id}/costing/time/{entryId}/void — soft-void an entry.
 * POST /api/projects/{id}/costing/other — record freight/outsource/etc (OC-083).
 * POST /api/projects/{id}/costing/other/{costId}/void — soft-void a cost.
 */

// Role gates mirror the cost_* event RBAC matrix (rbac.go / rbac.ts).
func roleCanManageCosting(role domain.UserRole) bool {
	return domain.RoleCanAppendProjectEvent(role, "cost_baseline_captured")
}

func roleCanRecordCostTime(role domain.UserRole) bool {
	return domain.RoleCanAppendProjectEvent(role, "cost_time_recorded")
}

func roleCanRecordOtherCost(role domain.UserRole) bool {
	return domain.RoleCanAppendProjectEvent(role, "cost_other_recorded")
}

func roleCanVoidCostEntry(role domain.UserRole) bool {
	return domain.RoleCanAppendProjectEvent(role, "cost_entry_voided")
}

type costingViewResponse struct {
	Costing        *domain.JobCosting           `json:"costing"`
	Summary        domain.JobCostSummary        `json:"summary"`
	Material       domain.MaterialCostValuation `json:"material"`
	EventsAppended int                          `json:"events_appended,omitempty"`
}

// actorLabel resolves the human label of the actor from the JWT claims
// (the token carries the email; there is no display name).
func actorEmail(claims *auth.Claims) string {
	if claims == nil {
		return ""
	}
	return claims.Email
}

func costingPayload(v interface{}) json.RawMessage {
	raw, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	return raw
}

// buildCostingView computes the estimate vs actual summary (OC-084) for the
// costing payload: material actual from the job-assigned consumption valued
// by the storage layer (OC-082), labor from time entries + rework minutes at
// each entry's frozen rate, other actuals, all against the frozen baseline.
func buildCostingView(snap *domain.JobCostingSnapshot, costing *domain.JobCosting) costingViewResponse {
	if costing == nil {
		costing = snap.Costing
	}
	if snap.Consumption == nil {
		snap.Consumption = []domain.MaterialConsumptionInput{}
	}
	material := domain.ValueMaterialConsumptions(snap.Consumption)
	if material.Lines == nil {
		material.Lines = []domain.ValuedMaterialLine{}
	}
	if material.MissingValuationMaterialIDs == nil {
		material.MissingValuationMaterialIDs = []string{}
	}

	input := domain.JobCostSummaryInput{
		TimeEntries:      []domain.TimeEntry{},
		OtherCosts:       []domain.OtherActualCost{},
		LaborRatePerHour: 0,
		Material:         &material,
	}
	if costing != nil {
		input.Baseline = costing.Baseline
		input.TimeEntries = costing.TimeEntries
		input.LaborRatePerHour = costing.LaborRatePerHour
		input.OtherCosts = costing.OtherCosts
	}
	if snap.Quality != nil {
		rework := domain.ReworkCostSummary(snap.Quality)
		input.Rework = &rework
	}
	return costingViewResponse{
		Costing:  costing,
		Summary:  domain.ComputeJobCostSummary(input),
		Material: material,
	}
}

// HandleProjectCosting handles GET /api/projects/{id}/costing.
func (s *Server) HandleProjectCosting(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
		return
	}
	projectID := r.PathValue("id")
	if !requirePermission(w, s.actorCanViewCosts(r),
		"no tenés permiso para ver los costos de la obra") {
		return
	}
	var view costingViewResponse
	_, err := s.Store.MutateProjectCosting(r.Context(), projectID, func(snap *domain.JobCostingSnapshot) (*domain.JobCostingMutation, error) {
		view = buildCostingView(snap, nil)
		return &domain.JobCostingMutation{Costing: nil}, nil
	})
	if err != nil {
		respondWithMutationError(w, err)
		return
	}
	respondWithJSON(w, http.StatusOK, view)
}

type captureBaselineRequest struct{}

// HandleCostingBaseline handles POST /api/projects/{id}/costing/baseline —
// freezes the official baseline (OC-080) from the quote snapshot + the
// production release currently on the floor.
func (s *Server) HandleCostingBaseline(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	claims := claimsFromRequest(r)
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), roleCanManageCosting),
		"no tenés permiso para capturar el baseline de costos") {
		return
	}

	var view costingViewResponse
	mutation, err := s.Store.MutateProjectCosting(r.Context(), projectID, func(snap *domain.JobCostingSnapshot) (*domain.JobCostingMutation, error) {
		now := time.Now().UTC()
		baseline, err := domain.BuildCostBaseline(snap.Costing, snap.PriceSnapshot, snap.ProductionRelease, projectID, actorID(claims), now)
		if err != nil {
			return nil, err
		}

		next := domain.JobCosting{}
		if snap.Costing != nil {
			next = *snap.Costing
		} else {
			next = domain.JobCosting{
				ID:        domain.NewJobCostingEntityID("jc"),
				ProjectID: projectID,
				CreatedAt: now,
			}
		}
		next.Baseline = baseline
		if err := domain.ValidateJobCostingTransition(snap.Costing, &next); err != nil {
			return nil, fmt.Errorf("BAD_REQUEST:%s", err.Error())
		}

		events := []domain.ProjectEvent{{
			ID: newProjectEventID(), ProjectID: projectID,
			Type: "cost_baseline_captured", At: now, ByUserID: byUserIDFromClaims(claims), Source: domain.ProjectEventSourceAPI,
			Note: "Baseline de costos capturado",
			Payload: costingPayload(map[string]interface{}{
				"baseline_id": baseline.ID, "release_id": baseline.Source.ReleaseID,
				"bom_fingerprint": baseline.Source.BOMFingerprint,
				"revenue":         baseline.Revenue, "estimated_direct_cost": baseline.EstimatedDirectCost,
				"expected_gross_margin": baseline.ExpectedGrossMargin,
			}),
		}}

		view = buildCostingView(&domain.JobCostingSnapshot{
			Costing: &next, PriceSnapshot: snap.PriceSnapshot, ProductionRelease: snap.ProductionRelease,
			Quality: snap.Quality, Consumption: snap.Consumption,
		}, nil)
		return &domain.JobCostingMutation{Costing: &next, Events: events}, nil
	})
	if err != nil {
		respondWithMutationError(w, err)
		return
	}
	view.EventsAppended = len(mutation.Events)
	respondWithJSON(w, http.StatusOK, view)
}

type setLaborRateRequest struct {
	RatePerHour float64 `json:"rate_per_hour"`
}

// HandleCostingLaborRate handles POST /api/projects/{id}/costing/labor-rate —
// sets the hourly rate in force for new time entries. Existing entries keep
// their frozen rate, so history is never rewritten.
func (s *Server) HandleCostingLaborRate(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	claims := claimsFromRequest(r)
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), roleCanManageCosting),
		"no tenés permiso para configurar la tarifa horaria") {
		return
	}
	var body setLaborRateRequest
	if !decodeJSONBody(w, r, &body) {
		return
	}
	if body.RatePerHour <= 0 {
		respondWithError(w, http.StatusBadRequest, "la tarifa horaria debe ser mayor a cero")
		return
	}

	var view costingViewResponse
	mutation, err := s.Store.MutateProjectCosting(r.Context(), projectID, func(snap *domain.JobCostingSnapshot) (*domain.JobCostingMutation, error) {
		if snap.Costing == nil {
			return nil, fmt.Errorf("NOT_FOUND:la obra no tiene módulo de costos iniciado (capturar el baseline primero)")
		}
		next := *snap.Costing
		next.LaborRatePerHour = body.RatePerHour
		if err := domain.ValidateJobCostingTransition(snap.Costing, &next); err != nil {
			return nil, fmt.Errorf("BAD_REQUEST:%s", err.Error())
		}
		view = buildCostingView(&domain.JobCostingSnapshot{
			Costing: &next, PriceSnapshot: snap.PriceSnapshot, ProductionRelease: snap.ProductionRelease,
			Quality: snap.Quality, Consumption: snap.Consumption,
		}, nil)
		return &domain.JobCostingMutation{Costing: &next}, nil
	})
	if err != nil {
		respondWithMutationError(w, err)
		return
	}
	view.EventsAppended = len(mutation.Events)
	respondWithJSON(w, http.StatusOK, view)
}

type recordTimeRequest struct {
	Category string  `json:"category"`
	Minutes  float64 `json:"minutes"`
	Note     string  `json:"note"`
}

// HandleCostingTime handles POST /api/projects/{id}/costing/time — records
// actual labor time (OC-081), freezing the shop hourly rate in force.
func (s *Server) HandleCostingTime(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	claims := claimsFromRequest(r)
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), roleCanRecordCostTime),
		"no tenés permiso para registrar tiempo de obra") {
		return
	}
	var body recordTimeRequest
	if !decodeJSONBody(w, r, &body) {
		return
	}
	if !domain.IsValidTimeEntryCategory(body.Category) {
		respondWithError(w, http.StatusBadRequest, "categoría de tiempo inválida: "+body.Category)
		return
	}
	if body.Minutes <= 0 {
		respondWithError(w, http.StatusBadRequest, "los minutos deben ser mayores a cero")
		return
	}

	var view costingViewResponse
	mutation, err := s.Store.MutateProjectCosting(r.Context(), projectID, func(snap *domain.JobCostingSnapshot) (*domain.JobCostingMutation, error) {
		if snap.Costing == nil {
			return nil, fmt.Errorf("NOT_FOUND:la obra no tiene módulo de costos iniciado (capturar el baseline primero)")
		}
		now := time.Now().UTC()
		entry := domain.TimeEntry{
			ID:          domain.NewJobCostingEntityID("tme"),
			Category:    domain.TimeEntryCategory(body.Category),
			Minutes:     body.Minutes,
			At:          now,
			ByUserID:    actorID(claims),
			ByName:      actorEmail(claims),
			Note:        strings.TrimSpace(body.Note),
			RatePerHour: snap.Costing.LaborRatePerHour,
		}

		next := *snap.Costing
		next.TimeEntries = append(append([]domain.TimeEntry{}, snap.Costing.TimeEntries...), entry)
		if err := domain.ValidateJobCostingTransition(snap.Costing, &next); err != nil {
			return nil, fmt.Errorf("BAD_REQUEST:%s", err.Error())
		}

		events := []domain.ProjectEvent{{
			ID: newProjectEventID(), ProjectID: projectID,
			Type: "cost_time_recorded", At: now, ByUserID: byUserIDFromClaims(claims), Source: domain.ProjectEventSourceAPI,
			Payload: costingPayload(map[string]interface{}{
				"entry_id": entry.ID, "category": entry.Category,
				"minutes": entry.Minutes, "rate_per_hour": entry.RatePerHour,
			}),
		}}

		view = buildCostingView(&domain.JobCostingSnapshot{
			Costing: &next, PriceSnapshot: snap.PriceSnapshot, ProductionRelease: snap.ProductionRelease,
			Quality: snap.Quality, Consumption: snap.Consumption,
		}, nil)
		return &domain.JobCostingMutation{Costing: &next, Events: events}, nil
	})
	if err != nil {
		respondWithMutationError(w, err)
		return
	}
	view.EventsAppended = len(mutation.Events)
	respondWithJSON(w, http.StatusOK, view)
}

type voidCostEntryRequest struct {
	Reason string `json:"reason"`
}

// HandleCostingTimeVoid handles POST /api/projects/{id}/costing/time/{entryId}/void.
func (s *Server) HandleCostingTimeVoid(w http.ResponseWriter, r *http.Request) {
	s.voidCostEntry(w, r, "time")
}

// HandleCostingOtherVoid handles POST /api/projects/{id}/costing/other/{costId}/void.
func (s *Server) HandleCostingOtherVoid(w http.ResponseWriter, r *http.Request) {
	s.voidCostEntry(w, r, "other")
}

// voidCostEntry soft-voids a time entry or an other actual cost (audit trail
// preserved, cost stops counting). Supervisors only (cost_entry_voided RBAC).
func (s *Server) voidCostEntry(w http.ResponseWriter, r *http.Request, entryType string) {
	projectID := r.PathValue("id")
	entryID := r.PathValue("entryId")
	if entryType == "other" {
		entryID = r.PathValue("costId")
	}
	claims := claimsFromRequest(r)
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), roleCanVoidCostEntry),
		"no tenés permiso para anular registros de costos") {
		return
	}
	var body voidCostEntryRequest
	if !decodeJSONBody(w, r, &body) {
		return
	}

	var view costingViewResponse
	mutation, err := s.Store.MutateProjectCosting(r.Context(), projectID, func(snap *domain.JobCostingSnapshot) (*domain.JobCostingMutation, error) {
		if snap.Costing == nil {
			return nil, fmt.Errorf("NOT_FOUND:la obra no tiene módulo de costos iniciado")
		}
		now := time.Now().UTC()
		next := *snap.Costing

		if entryType == "time" {
			idx := -1
			for i, e := range snap.Costing.TimeEntries {
				if e.ID == entryID {
					idx = i
					break
				}
			}
			if idx == -1 {
				return nil, fmt.Errorf("NOT_FOUND:registro de tiempo no encontrado: %s", entryID)
			}
			if snap.Costing.TimeEntries[idx].RemovedAt != nil {
				return nil, fmt.Errorf("CONFLICT:el registro de tiempo ya está anulado")
			}
			entries := append([]domain.TimeEntry{}, snap.Costing.TimeEntries...)
			entries[idx].RemovedAt = &now
			entries[idx].RemovedByUserID = actorID(claims)
			entries[idx].RemovedByName = actorEmail(claims)
			next.TimeEntries = entries

			if err := domain.ValidateJobCostingTransition(snap.Costing, &next); err != nil {
				return nil, fmt.Errorf("BAD_REQUEST:%s", err.Error())
			}
			events := []domain.ProjectEvent{{
				ID: newProjectEventID(), ProjectID: projectID,
				Type: "cost_entry_voided", At: now, ByUserID: byUserIDFromClaims(claims), Source: domain.ProjectEventSourceAPI,
				Note: strings.TrimSpace(body.Reason),
				Payload: costingPayload(map[string]interface{}{
					"entry_type": "time", "entry_id": entryID,
					"category": next.TimeEntries[idx].Category, "minutes": next.TimeEntries[idx].Minutes,
				}),
			}}
			view = buildCostingView(&domain.JobCostingSnapshot{
				Costing: &next, PriceSnapshot: snap.PriceSnapshot, ProductionRelease: snap.ProductionRelease,
				Quality: snap.Quality, Consumption: snap.Consumption,
			}, nil)
			return &domain.JobCostingMutation{Costing: &next, Events: events}, nil
		}

		idx := -1
		for i, c := range snap.Costing.OtherCosts {
			if c.ID == entryID {
				idx = i
				break
			}
		}
		if idx == -1 {
			return nil, fmt.Errorf("NOT_FOUND:costo no encontrado: %s", entryID)
		}
		if snap.Costing.OtherCosts[idx].RemovedAt != nil {
			return nil, fmt.Errorf("CONFLICT:el costo ya está anulado")
		}
		costs := append([]domain.OtherActualCost{}, snap.Costing.OtherCosts...)
		costs[idx].RemovedAt = &now
		costs[idx].RemovedByUserID = actorID(claims)
		costs[idx].RemovedByName = actorEmail(claims)
		next.OtherCosts = costs

		if err := domain.ValidateJobCostingTransition(snap.Costing, &next); err != nil {
			return nil, fmt.Errorf("BAD_REQUEST:%s", err.Error())
		}
		events := []domain.ProjectEvent{{
			ID: newProjectEventID(), ProjectID: projectID,
			Type: "cost_entry_voided", At: now, ByUserID: byUserIDFromClaims(claims), Source: domain.ProjectEventSourceAPI,
			Note: strings.TrimSpace(body.Reason),
			Payload: costingPayload(map[string]interface{}{
				"entry_type": "other", "entry_id": entryID,
				"kind": next.OtherCosts[idx].Kind, "amount": next.OtherCosts[idx].Amount,
			}),
		}}
		view = buildCostingView(&domain.JobCostingSnapshot{
			Costing: &next, PriceSnapshot: snap.PriceSnapshot, ProductionRelease: snap.ProductionRelease,
			Quality: snap.Quality, Consumption: snap.Consumption,
		}, nil)
		return &domain.JobCostingMutation{Costing: &next, Events: events}, nil
	})
	if err != nil {
		respondWithMutationError(w, err)
		return
	}
	view.EventsAppended = len(mutation.Events)
	respondWithJSON(w, http.StatusOK, view)
}

type recordOtherCostRequest struct {
	Kind   string  `json:"kind"`
	Amount float64 `json:"amount"`
	Vendor string  `json:"vendor"`
	Note   string  `json:"note"`
}

// HandleCostingOther handles POST /api/projects/{id}/costing/other — records
// an out-of-production actual cost (OC-083).
func (s *Server) HandleCostingOther(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	claims := claimsFromRequest(r)
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), roleCanRecordOtherCost),
		"no tenés permiso para registrar costos externos") {
		return
	}
	var body recordOtherCostRequest
	if !decodeJSONBody(w, r, &body) {
		return
	}
	if !domain.IsValidOtherCostKind(body.Kind) {
		respondWithError(w, http.StatusBadRequest, "tipo de costo inválido: "+body.Kind)
		return
	}
	if body.Amount <= 0 {
		respondWithError(w, http.StatusBadRequest, "el monto debe ser mayor a cero")
		return
	}

	var view costingViewResponse
	mutation, err := s.Store.MutateProjectCosting(r.Context(), projectID, func(snap *domain.JobCostingSnapshot) (*domain.JobCostingMutation, error) {
		if snap.Costing == nil {
			return nil, fmt.Errorf("NOT_FOUND:la obra no tiene módulo de costos iniciado (capturar el baseline primero)")
		}
		now := time.Now().UTC()
		cost := domain.OtherActualCost{
			ID:       domain.NewJobCostingEntityID("oth"),
			Kind:     domain.OtherCostKind(body.Kind),
			Amount:   body.Amount,
			At:       now,
			ByUserID: actorID(claims),
			ByName:   actorEmail(claims),
			Vendor:   strings.TrimSpace(body.Vendor),
			Note:     strings.TrimSpace(body.Note),
		}

		next := *snap.Costing
		next.OtherCosts = append(append([]domain.OtherActualCost{}, snap.Costing.OtherCosts...), cost)
		if err := domain.ValidateJobCostingTransition(snap.Costing, &next); err != nil {
			return nil, fmt.Errorf("BAD_REQUEST:%s", err.Error())
		}

		events := []domain.ProjectEvent{{
			ID: newProjectEventID(), ProjectID: projectID,
			Type: "cost_other_recorded", At: now, ByUserID: byUserIDFromClaims(claims), Source: domain.ProjectEventSourceAPI,
			Payload: costingPayload(map[string]interface{}{
				"cost_id": cost.ID, "kind": cost.Kind, "amount": cost.Amount,
			}),
		}}

		view = buildCostingView(&domain.JobCostingSnapshot{
			Costing: &next, PriceSnapshot: snap.PriceSnapshot, ProductionRelease: snap.ProductionRelease,
			Quality: snap.Quality, Consumption: snap.Consumption,
		}, nil)
		return &domain.JobCostingMutation{Costing: &next, Events: events}, nil
	})
	if err != nil {
		respondWithMutationError(w, err)
		return
	}
	view.EventsAppended = len(mutation.Events)
	respondWithJSON(w, http.StatusOK, view)
}
