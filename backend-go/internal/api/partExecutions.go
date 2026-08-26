package api

/**
 * Physical production execution endpoints (OC-030..OC-034, issue #301).
 *
 * Server authority for the shop floor: piece operations (cut/cnc/edge) and
 * module unit transitions advance through here — locked read-modify-write via
 * MutateProjectPartExecutions — never through whole-project PUTs. The legacy
 * ItemFloorStatus is re-derived from the physical truth on every write
 * (OC-034 bridge) and every real transition lands in the floor event log.
 */

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// sectorForPartOperation maps a station operation to the sector that performs
// it (production-flow-v2: cut/cnc/edge work pieces).
func sectorForPartOperation(opType domain.PartOperationType) domain.ProductionSector {
	switch opType {
	case domain.PartOperationCut:
		return domain.SectorCutting
	case domain.PartOperationCNC:
		return domain.SectorCNC
	case domain.PartOperationEdgeBanding:
		return domain.SectorEdgeBanding
	default:
		return ""
	}
}

// sectorForUnitTargetStatus maps a module unit target status to the sector
// that performs it. QC happens in the assembly bay; packaging onwards is
// logistics (production-flow-v2 §Fase B).
func sectorForUnitTargetStatus(status domain.ModuleUnitStatus) domain.ProductionSector {
	switch status {
	case domain.ModuleUnitStatusAssembly, domain.ModuleUnitStatusModuleQC:
		return domain.SectorAssembly
	case domain.ModuleUnitStatusPackaged:
		return domain.SectorPackaging
	case domain.ModuleUnitStatusLoaded:
		return domain.SectorShipping
	case domain.ModuleUnitStatusInstalled:
		return domain.SectorInstall
	default:
		return ""
	}
}

// actorCanWorkSector enforces the F094 station separation for part/unit level
// work: scoped operators (produccion/almacen) only work their assigned
// sectors. Responds 403 and returns false when denied; sector-list read
// failures fall open to the role-only check (logged), same as floor-scan.
func (s *Server) actorCanWorkSector(w http.ResponseWriter, r *http.Request, roles []domain.UserRole, userID string, sector domain.ProductionSector) bool {
	if !domain.RolesAllScopedBySector(roles) {
		return true
	}
	sectors, err := s.Store.ListUserSectors(r.Context(), userID)
	if err != nil {
		log.Printf("[part-executions] cannot read sectors for user %s: %v (falling open)", userID, err)
		return true
	}
	names := make([]string, 0, len(sectors))
	for _, us := range sectors {
		names = append(names, us.Sector)
	}
	for _, role := range roles {
		if domain.RoleCanWorkSector(role, sector, names) {
			return true
		}
	}
	if false {
		return true
	}
	respondWithError(w, http.StatusForbidden,
		"ese trabajo es de "+domain.SectorLabelES(string(sector))+" y no lo tenés asignado")
	return false
}

// deriveItemStatuses re-derives the legacy ItemFloorStatus (OC-034) for every
// item that has physical units or pieces.
func deriveItemStatuses(snap *domain.PartExecutionsSnapshot) map[string]string {
	itemIDs := map[string]struct{}{}
	for _, u := range snap.Units {
		itemIDs[u.ProjectItemID] = struct{}{}
	}
	for _, p := range snap.Parts {
		itemIDs[p.ProjectItemID] = struct{}{}
	}
	out := make(map[string]string, len(itemIDs))
	for itemID := range itemIDs {
		var itemUnits []domain.ModuleUnitExecution
		var itemParts []domain.PartInstance
		for _, u := range snap.Units {
			if u.ProjectItemID == itemID {
				itemUnits = append(itemUnits, u)
			}
		}
		for _, p := range snap.Parts {
			if p.ProjectItemID == itemID {
				itemParts = append(itemParts, p)
			}
		}
		out[itemID] = domain.DeriveLegacyItemFloorStatus(itemUnits, itemParts)
	}
	return out
}

// buildFloorEvent mirrors recordFloorEvent (F092) but for the part-executions
// transaction: who/when/how from the JWT actor, with a note for non-adjacent
// or backwards derivations (rework downgrades the legacy status honestly).
func (s *Server) buildFloorEvent(r *http.Request, projectID, itemID, from, to string, source domain.FloorEventSource, note string) domain.FloorStatusEvent {
	claims := claimsFromRequest(r)
	ev := domain.FloorStatusEvent{
		ID:        newFloorEventID(),
		ProjectID: projectID,
		ItemID:    itemID,
		From:      from,
		To:        to,
		At:        time.Now().UTC(),
		ByUserID:  actorID(claims),
		ByName:    claims.Email,
		Source:    source,
		Note:      note,
	}
	if ev.ByUserID != "" {
		if user, err := s.Store.GetUserByID(r.Context(), ev.ByUserID); err == nil && user != nil && user.Name != "" {
			ev.ByName = user.Name
		}
	}
	return ev
}

// releasedRevisionFor returns the currently released production revision of a
// project ("" when never released).
func releasedRevisionFor(project *domain.Project) string {
	if project != nil && project.ProductionRelease != nil && project.ProductionRelease.ID != "" {
		return project.ProductionRelease.ID
	}
	return ""
}

// HandleProjectPartExecutions handles GET /api/projects/{id}/part-executions —
// pieces and units with per-unit assembly readiness, for station screens.
func (s *Server) HandleProjectPartExecutions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
		return
	}
	projectID := r.PathValue("id")
	project, err := s.Store.GetProjectByID(r.Context(), projectID)
	if err != nil || project == nil {
		respondWithError(w, http.StatusNotFound, "obra no encontrada")
		return
	}
	released := releasedRevisionFor(project)
	readiness := make([]domain.AssemblyReadiness, 0, len(project.ModuleUnits))
	for _, u := range project.ModuleUnits {
		readiness = append(readiness, domain.CheckAssemblyReadiness(u, project.PartInstances, released))
	}
	if project.PartInstances == nil {
		project.PartInstances = []domain.PartInstance{}
	}
	if project.ModuleUnits == nil {
		project.ModuleUnits = []domain.ModuleUnitExecution{}
	}
	respondWithJSON(w, http.StatusOK, map[string]interface{}{
		"part_instances":     project.PartInstances,
		"module_units":       project.ModuleUnits,
		"assembly_readiness": readiness,
	})
}

type advancePartRequest struct {
	OperationType string `json:"operation_type"`
	/** Scanner mode: empty operation_type + advance resolves the CURRENT
	 * operation server-side (the QR knows the piece, not the station). */
	Advance      bool   `json:"advance,omitempty"`
	OperatorName string `json:"operator_name,omitempty"`
	MachineID    string `json:"machine_id,omitempty"`
	Notes        string `json:"notes,omitempty"`
	Source       string `json:"source,omitempty"`
}

// HandleAdvancePartOperation handles POST /api/projects/{id}/parts/{partId}/advance —
// one station completes one operation of one physical piece. With
// `advance:true` and no `operation_type`, the server completes the piece's
// current operation (station-scan semantics).
func (s *Server) HandleAdvancePartOperation(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	partID := r.PathValue("partId")
	claims := claimsFromRequest(r)
	roles := actorRoles(claims)
	if !requirePermission(w,
		domain.AnyRole(roles, domain.RoleCanMarkProduced) || domain.AnyRole(roles, domain.RoleCanExportProduction) ||
			domain.AnyRole(roles, domain.RoleCanClaimProductionJob),
		"no tenés permiso para avanzar el piso de fábrica") {
		return
	}
	var body advancePartRequest
	if !decodeJSONBody(w, r, &body) {
		return
	}
	scannerMode := body.OperationType == ""
	if scannerMode && !body.Advance {
		respondWithError(w, http.StatusBadRequest, "falta operation_type o advance")
		return
	}
	if !scannerMode && !domain.IsValidPartOperationType(body.OperationType) {
		respondWithError(w, http.StatusBadRequest, "tipo de operación desconocido: "+body.OperationType)
		return
	}
	var sector domain.ProductionSector
	if !scannerMode {
		sector = sectorForPartOperation(domain.PartOperationType(body.OperationType))
		if sector == "" {
			respondWithError(w, http.StatusBadRequest, "esa operación no corresponde a una estación física")
			return
		}
		if !s.actorCanWorkSector(w, r, roles, actorID(claims), sector) {
			return
		}
	} else if !s.actorCanWorkSectorInTx(r, roles, actorID(claims), domain.SectorCutting) &&
		!s.actorCanWorkSectorInTx(r, roles, actorID(claims), domain.SectorCNC) &&
		!s.actorCanWorkSectorInTx(r, roles, actorID(claims), domain.SectorEdgeBanding) {
		// Scanner mode has no station context: any pre-assembly sector works.
		respondWithError(w, http.StatusForbidden, "no tenés ninguna estación de piezas asignada")
		return
	}

	project, err := s.Store.GetProjectByID(r.Context(), projectID)
	if err != nil || project == nil {
		respondWithError(w, http.StatusNotFound, "obra no encontrada")
		return
	}

	var updatedPart *domain.PartInstance
	var readiness *domain.AssemblyReadiness
	mutation, err := s.Store.MutateProjectPartExecutions(r.Context(), projectID, func(snap *domain.PartExecutionsSnapshot) (*domain.PartExecutionsMutation, error) {
		idx := -1
		for i, p := range snap.Parts {
			if p.ID == partID {
				idx = i
				break
			}
		}
		if idx == -1 {
			return nil, fmt.Errorf("NOT_FOUND:pieza no encontrada en esta obra")
		}
		before := deriveItemStatuses(snap)
		part := snap.Parts[idx]
		opType := domain.PartOperationType(body.OperationType)
		if scannerMode {
			// Resolve the piece's CURRENT operation — the scan identifies the
			// piece; the route says what runs next.
			if part.CurrentOperationIndex < 0 || part.CurrentOperationIndex >= len(part.RequiredOperations) {
				return nil, fmt.Errorf("CONFLICT:la pieza no tiene operaciones pendientes")
			}
			opType = part.RequiredOperations[part.CurrentOperationIndex].Type
			if opType != domain.PartOperationCut && opType != domain.PartOperationCNC && opType != domain.PartOperationEdgeBanding {
				return nil, fmt.Errorf("CONFLICT:la pieza no tiene operaciones de estación pendientes")
			}
		}
		advanced, changed := domain.AdvancePartOperation(part, opType, domain.OperatorDetails{
			At:           time.Now().UTC(),
			OperatorID:   actorID(claims),
			OperatorName: body.OperatorName,
			MachineID:    body.MachineID,
			Notes:        body.Notes,
		})
		if !changed {
			return nil, fmt.Errorf("CONFLICT:la operación %s no está disponible para esa pieza (secuencia o estado)", opType)
		}
		snap.Parts[idx] = advanced
		after := deriveItemStatuses(snap)

		events := []domain.FloorStatusEvent{}
		if before[part.ProjectItemID] != after[part.ProjectItemID] {
			note := fmt.Sprintf("Pieza %s (%s): %s completado", part.PartCode, part.ID, body.OperationType)
			events = append(events, s.buildFloorEvent(r, projectID, part.ProjectItemID,
				before[part.ProjectItemID], after[part.ProjectItemID],
				domain.NormalizeFloorEventSource(body.Source), note))
		}

		updatedPart = &snap.Parts[idx]
		for _, u := range snap.Units {
			if u.ProjectItemID == part.ProjectItemID && u.UnitIndex == part.UnitIndex {
				check := domain.CheckAssemblyReadiness(u, snap.Parts, releasedRevisionFor(project))
				readiness = &check
				break
			}
		}
		return &domain.PartExecutionsMutation{
			Parts:        snap.Parts,
			Units:        snap.Units,
			ItemStatuses: after,
			FloorEvents:  events,
		}, nil
	})
	if err != nil {
		respondWithMutationError(w, err)
		return
	}
	_ = mutation
	respondWithJSON(w, http.StatusOK, map[string]interface{}{
		"part":               updatedPart,
		"assembly_readiness": readiness,
	})
}

type advanceUnitRequest struct {
	TargetStatus string `json:"target_status,omitempty"`
	Advance      bool   `json:"advance,omitempty"`
	Notes        string `json:"notes,omitempty"`
	Source       string `json:"source,omitempty"`
	/** Bulto identity (OC-033): how many packages this unit was split into
	 * when entering `packaged`. Persisted on the unit for QR/scanner flows. */
	PackageCount *int `json:"package_count,omitempty"`
}

// HandleAdvanceModuleUnit handles POST /api/projects/{id}/units/{unitId}/advance —
// assembly entry (convergence gate) and the logistics chain onwards.
func (s *Server) HandleAdvanceModuleUnit(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	unitID := r.PathValue("unitId")
	claims := claimsFromRequest(r)
	roles := actorRoles(claims)
	if !requirePermission(w,
		domain.AnyRole(roles, domain.RoleCanMarkProduced) || domain.AnyRole(roles, domain.RoleCanExportProduction) ||
			domain.AnyRole(roles, domain.RoleCanClaimProductionJob),
		"no tenés permiso para avanzar el piso de fábrica") {
		return
	}
	var body advanceUnitRequest
	if !decodeJSONBody(w, r, &body) {
		return
	}

	project, err := s.Store.GetProjectByID(r.Context(), projectID)
	if err != nil || project == nil {
		respondWithError(w, http.StatusNotFound, "obra no encontrada")
		return
	}

	var updatedUnit *domain.ModuleUnitExecution
	var readiness *domain.AssemblyReadiness
	var gateBlocked *domain.AssemblyReadiness
	var qcGateBlocked *domain.UnitQcGateResult
	mutation, err := s.Store.MutateProjectPartExecutions(r.Context(), projectID, func(snap *domain.PartExecutionsSnapshot) (*domain.PartExecutionsMutation, error) {
		idx := -1
		for i, u := range snap.Units {
			if u.ID == unitID {
				idx = i
				break
			}
		}
		if idx == -1 {
			return nil, fmt.Errorf("NOT_FOUND:unidad no encontrada en esta obra")
		}
		unit := snap.Units[idx]

		target := domain.ModuleUnitStatus(body.TargetStatus)
		if target == "" {
			if !body.Advance {
				return nil, fmt.Errorf("BAD_REQUEST:falta target_status o advance")
			}
			target = domain.NextModuleUnitStatus(unit.Status)
			if target == "" {
				return nil, fmt.Errorf("CONFLICT:la unidad ya está instalada")
			}
		}
		if !domain.IsValidModuleUnitStatus(string(target)) {
			return nil, fmt.Errorf("BAD_REQUEST:estado de unidad desconocido: %s", target)
		}
		if !s.actorCanWorkSectorInTx(r, roles, actorID(claims), sectorForUnitTargetStatus(target)) {
			return nil, fmt.Errorf("FORBIDDEN")
		}

		// Convergence gate (OC-032): assembly may only start when every
		// required piece is ready against the released revision — or a
		// supervisor override was recorded.
		if target == domain.ModuleUnitStatusAssembly && unit.Status == domain.ModuleUnitStatusAwaitingParts {
			check := domain.CheckAssemblyReadiness(unit, snap.Parts, releasedRevisionFor(project))
			if !check.IsReady {
				blocked := check
				gateBlocked = &blocked
				return nil, fmt.Errorf("ASSEMBLY_GATE")
			}
		}

		// QC gate (OC-062): a unit only enters packaging with an approved QC
		// checklist and no open quality issue — or an audited supervisor
		// override recorded on its QC record.
		if target == domain.ModuleUnitStatusPackaged && unit.Status == domain.ModuleUnitStatusModuleQC {
			gate := domain.EvaluateUnitQcGate(snap.Quality, unit)
			if !gate.Ready {
				blocked := gate
				qcGateBlocked = &blocked
				return nil, fmt.Errorf("QC_GATE")
			}
		}

		before := deriveItemStatuses(snap)
		advanced, changed := domain.AdvanceModuleUnitStatus(unit, target, time.Now().UTC(), body.Notes)
		if !changed {
			return nil, fmt.Errorf("CONFLICT:transición inválida %s → %s", unit.Status, target)
		}
		if target == domain.ModuleUnitStatusPackaged && body.PackageCount != nil {
			if *body.PackageCount < 1 || *body.PackageCount > 99 {
				return nil, fmt.Errorf("BAD_REQUEST:package_count debe estar entre 1 y 99")
			}
			advanced.PackageCount = body.PackageCount
		}
		snap.Units[idx] = advanced
		after := deriveItemStatuses(snap)

		events := []domain.FloorStatusEvent{}
		if before[unit.ProjectItemID] != after[unit.ProjectItemID] {
			note := fmt.Sprintf("Unidad %d (%s) → %s", unit.UnitIndex, unit.ID, target)
			events = append(events, s.buildFloorEvent(r, projectID, unit.ProjectItemID,
				before[unit.ProjectItemID], after[unit.ProjectItemID],
				domain.NormalizeFloorEventSource(body.Source), note))
		}

		updatedUnit = &snap.Units[idx]
		check := domain.CheckAssemblyReadiness(advanced, snap.Parts, releasedRevisionFor(project))
		readiness = &check
		return &domain.PartExecutionsMutation{
			Parts:        snap.Parts,
			Units:        snap.Units,
			ItemStatuses: after,
			FloorEvents:  events,
		}, nil
	})
	if err != nil {
		if gateBlocked != nil {
			respondWithJSON(w, http.StatusConflict, map[string]interface{}{
				"error":              "el gate de armado bloquea el avance",
				"assembly_readiness": *gateBlocked,
			})
			return
		}
		if qcGateBlocked != nil {
			respondWithJSON(w, http.StatusConflict, map[string]interface{}{
				"error":   "el gate de QC bloquea el empaquetado de la unidad",
				"qc_gate": *qcGateBlocked,
			})
			return
		}
		respondWithMutationError(w, err)
		return
	}
	_ = mutation
	respondWithJSON(w, http.StatusOK, map[string]interface{}{
		"unit":               updatedUnit,
		"assembly_readiness": readiness,
		"next_status":        domain.NextModuleUnitStatus(updatedUnit.Status),
	})
}

type assemblyOverrideRequest struct {
	Reason string `json:"reason"`
}

// HandleAssemblyOverride handles POST /api/projects/{id}/units/{unitId}/assembly-override —
// supervisor-only audited pass to assemble with incomplete pieces (OC-032).
func (s *Server) HandleAssemblyOverride(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	unitID := r.PathValue("unitId")
	claims := claimsFromRequest(r)
	roles := actorRoles(claims)
	// Override is a supervisor action (mark/export roles), never a scoped
	// station operator.
	if !requirePermission(w,
		domain.AnyRole(roles, domain.RoleCanSuperviseFloor),
		"sólo supervisión puede autorizar armado con piezas faltantes") {
		return
	}
	var body assemblyOverrideRequest
	if !decodeJSONBody(w, r, &body) || body.Reason == "" {
		respondWithError(w, http.StatusBadRequest, "la razón del override es obligatoria")
		return
	}

	var updatedUnit *domain.ModuleUnitExecution
	var readiness *domain.AssemblyReadiness
	_, err := s.Store.MutateProjectPartExecutions(r.Context(), projectID, func(snap *domain.PartExecutionsSnapshot) (*domain.PartExecutionsMutation, error) {
		idx := -1
		for i, u := range snap.Units {
			if u.ID == unitID {
				idx = i
				break
			}
		}
		if idx == -1 {
			return nil, fmt.Errorf("NOT_FOUND:unidad no encontrada en esta obra")
		}
		unit := snap.Units[idx]
		check := domain.CheckAssemblyReadiness(unit, snap.Parts, "")
		if unit.SupervisorOverride != nil {
			return nil, fmt.Errorf("CONFLICT:la unidad ya tiene un override registrado")
		}
		overridden := domain.RecordSupervisorAssemblyOverride(unit, body.Reason, actorID(claims), len(check.MissingPieces), time.Now().UTC())
		snap.Units[idx] = overridden

		after := deriveItemStatuses(snap)
		events := []domain.FloorStatusEvent{
			s.buildFloorEvent(r, projectID, unit.ProjectItemID,
				snap.ItemStatuses[unit.ProjectItemID], after[unit.ProjectItemID],
				domain.FloorEventSourceManual,
				"Override supervisor de armado: "+body.Reason),
		}
		updatedUnit = &snap.Units[idx]
		finalCheck := domain.CheckAssemblyReadiness(overridden, snap.Parts, "")
		readiness = &finalCheck
		return &domain.PartExecutionsMutation{
			Parts:        snap.Parts,
			Units:        snap.Units,
			ItemStatuses: after,
			FloorEvents:  events,
		}, nil
	})
	if err != nil {
		respondWithMutationError(w, err)
		return
	}
	respondWithJSON(w, http.StatusOK, map[string]interface{}{
		"unit":               updatedUnit,
		"assembly_readiness": readiness,
	})
}

type partReworkRequest struct {
	Action          string `json:"action"`
	Reason          string `json:"reason"`
	TargetOperation string `json:"target_operation,omitempty"`
	/** OC-061 job costing: affected material cost (money) and labor (minutes)
	 * recorded with the quality/rework lifecycle events. */
	MaterialCost *float64 `json:"material_cost,omitempty"`
	LaborMinutes *float64 `json:"labor_minutes,omitempty"`
}

// HandlePartRework handles POST /api/projects/{id}/parts/{partId}/rework —
// supervisor action reopening one piece (OC-060/061): emits the auditable
// quality_issue_reported + rework_started lifecycle events and downgrades the
// legacy item status honestly.
func (s *Server) HandlePartRework(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	partID := r.PathValue("partId")
	claims := claimsFromRequest(r)
	roles := actorRoles(claims)
	if !requirePermission(w,
		domain.AnyRole(roles, domain.RoleCanSuperviseFloor),
		"sólo supervisión puede retrabajar piezas") {
		return
	}
	var body partReworkRequest
	if !decodeJSONBody(w, r, &body) {
		return
	}
	if body.Action != "rework" && body.Action != "refabricate" {
		respondWithError(w, http.StatusBadRequest, "action debe ser rework o refabricate")
		return
	}
	if body.Reason == "" {
		respondWithError(w, http.StatusBadRequest, "la razón es obligatoria")
		return
	}
	if body.TargetOperation != "" && !domain.IsValidPartOperationType(body.TargetOperation) {
		respondWithError(w, http.StatusBadRequest, "operación objetivo desconocida: "+body.TargetOperation)
		return
	}
	if body.MaterialCost != nil && *body.MaterialCost < 0 {
		respondWithError(w, http.StatusBadRequest, "material_cost no puede ser negativo")
		return
	}
	if body.LaborMinutes != nil && *body.LaborMinutes < 0 {
		respondWithError(w, http.StatusBadRequest, "labor_minutes no puede ser negativo")
		return
	}

	var updatedPart *domain.PartInstance
	mutation, err := s.Store.MutateProjectPartExecutions(r.Context(), projectID, func(snap *domain.PartExecutionsSnapshot) (*domain.PartExecutionsMutation, error) {
		idx := -1
		for i, p := range snap.Parts {
			if p.ID == partID {
				idx = i
				break
			}
		}
		if idx == -1 {
			return nil, fmt.Errorf("NOT_FOUND:pieza no encontrada en esta obra")
		}
		part := snap.Parts[idx]
		before := deriveItemStatuses(snap)
		reworked, changed := domain.TriggerPartRework(part, body.Action, body.Reason, domain.PartOperationType(body.TargetOperation))
		if !changed {
			return nil, fmt.Errorf("CONFLICT:no se pudo reabrir la pieza para retrabajo")
		}
		snap.Parts[idx] = reworked
		after := deriveItemStatuses(snap)

		events := []domain.FloorStatusEvent{}
		if before[part.ProjectItemID] != after[part.ProjectItemID] {
			events = append(events, s.buildFloorEvent(r, projectID, part.ProjectItemID,
				before[part.ProjectItemID], after[part.ProjectItemID],
				domain.FloorEventSourceManual,
				fmt.Sprintf("Retrabajo pieza %s (%s): %s — %s", part.PartCode, part.ID, body.Action, body.Reason)))
		}
		updatedPart = &snap.Parts[idx]
		return &domain.PartExecutionsMutation{
			Parts:        snap.Parts,
			Units:        snap.Units,
			ItemStatuses: after,
			FloorEvents:  events,
		}, nil
	})
	if err != nil {
		respondWithMutationError(w, err)
		return
	}

	// OC-060/061 audit: quality issue + rework start in the lifecycle log.
	// Best effort after the mutation committed — same convention as the
	// floor-scan event write.
	actor := actorID(claims)
	for _, evType := range []string{"quality_issue_reported", "rework_started"} {
		note := fmt.Sprintf("%s — pieza %s (%s): %s. Motivo: %s",
			evType, updatedPart.PartCode, updatedPart.ID, body.Action, body.Reason)
		if err := s.Store.InsertProjectEvent(r.Context(), domain.ProjectEvent{
			ID:        newProjectEventID(),
			ProjectID: projectID,
			Type:      evType,
			At:        time.Now().UTC(),
			ByUserID:  &actor,
			Source:    domain.ProjectEventSourceAPI,
			Note:      note,
			Payload:   reworkEventPayload(updatedPart.ID, body),
		}); err != nil {
			log.Printf("[part-executions] %s insert failed for project %s: %v", evType, projectID, err)
		}
	}
	_ = mutation
	respondWithJSON(w, http.StatusOK, map[string]interface{}{"part": updatedPart})
}

// actorCanWorkSectorInTx is the sector check inside a mutation closure: it
// must not write the 403 itself (the caller owns the response), so it only
// reports the verdict.
func (s *Server) actorCanWorkSectorInTx(r *http.Request, roles []domain.UserRole, userID string, sector domain.ProductionSector) bool {
	if !domain.RolesAllScopedBySector(roles) {
		return true
	}
	sectors, err := s.Store.ListUserSectors(r.Context(), userID)
	if err != nil {
		log.Printf("[part-executions] cannot read sectors for user %s: %v (falling open)", userID, err)
		return true
	}
	names := make([]string, 0, len(sectors))
	for _, us := range sectors {
		names = append(names, us.Sector)
	}
	for _, role := range roles {
		if domain.RoleCanWorkSector(role, sector, names) {
			return true
		}
	}
	return false
}

// respondWithMutationError maps mutation closure errors to HTTP responses.
func respondWithMutationError(w http.ResponseWriter, err error) {
	msg := err.Error()
	switch {
	case strings.HasPrefix(msg, "NOT_FOUND:"):
		respondWithError(w, http.StatusNotFound, strings.TrimPrefix(msg, "NOT_FOUND:"))
	case strings.HasPrefix(msg, "CONFLICT:"):
		respondWithError(w, http.StatusConflict, strings.TrimPrefix(msg, "CONFLICT:"))
	case strings.HasPrefix(msg, "BAD_REQUEST:"):
		respondWithError(w, http.StatusBadRequest, strings.TrimPrefix(msg, "BAD_REQUEST:"))
	case msg == "FORBIDDEN":
		respondWithError(w, http.StatusForbidden, "no tenés ese sector asignado")
	case msg == "ASSEMBLY_GATE":
		respondWithError(w, http.StatusConflict, "el gate de armado bloquea el avance")
	case msg == "project not found":
		respondWithError(w, http.StatusNotFound, "obra no encontrada")
	default:
		respondWithError(w, http.StatusInternalServerError, "no se pudo actualizar la ejecución física")
	}
}

// reworkEventPayload serializes the OC-061 costing data with the rework
// action so job costing can query it from the lifecycle log.
func reworkEventPayload(partID string, body partReworkRequest) json.RawMessage {
	payload := map[string]interface{}{
		"part_instance_id": partID,
		"action":           body.Action,
		"reason":           body.Reason,
	}
	if body.MaterialCost != nil {
		payload["material_cost"] = *body.MaterialCost
	}
	if body.LaborMinutes != nil {
		payload["labor_minutes"] = *body.LaborMinutes
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return json.RawMessage(fmt.Sprintf(`{"part_instance_id":%q,"action":%q}`, partID, body.Action))
	}
	return raw
}

type generatePartExecutionsRequest struct {
	PartInstances []domain.PartInstance        `json:"part_instances"`
	ModuleUnits   []domain.ModuleUnitExecution `json:"module_units"`
	/** Progress guard: replacing executions that already advanced requires an
	 * explicit supervisor force (audited with floor events). */
	Force bool `json:"force,omitempty"`
}

// HandleGeneratePartExecutions handles PUT /api/projects/{id}/part-executions —
// persists the client-derived physical instances (TS owns the BOM resolution)
// AFTER server-side validation: every line/item exists, one unit per unit of
// quantity, revision matches the released one, and every route starts with a
// cut. Idempotent for untouched executions; replacing progress requires
// force + supervisor and is audited with floor events.
func (s *Server) HandleGeneratePartExecutions(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	claims := claimsFromRequest(r)
	roles := actorRoles(claims)
	if !requirePermission(w,
		domain.AnyRole(roles, domain.RoleCanSuperviseFloor),
		"sólo supervisión puede generar las unidades físicas de la obra") {
		return
	}
	var body generatePartExecutionsRequest
	if !decodeJSONBody(w, r, &body) {
		return
	}
	if len(body.PartInstances) == 0 || len(body.ModuleUnits) == 0 {
		respondWithError(w, http.StatusBadRequest, "part_instances y module_units son requeridos")
		return
	}

	project, err := s.Store.GetProjectByID(r.Context(), projectID)
	if err != nil || project == nil {
		respondWithError(w, http.StatusNotFound, "obra no encontrada")
		return
	}
	released := releasedRevisionFor(project)

	var result map[string]interface{}
	_, err = s.Store.MutateProjectPartExecutions(r.Context(), projectID, func(snap *domain.PartExecutionsSnapshot) (*domain.PartExecutionsMutation, error) {
		// ── Validation (server authority) ────────────────────────────────
		unitsPerItem := map[string]int{}
		for _, u := range body.ModuleUnits {
			qty, ok := snap.ItemQuantities[u.ProjectItemID]
			if !ok {
				return nil, fmt.Errorf("BAD_REQUEST:unidad %s referencia la línea %s que no existe en la obra", u.ID, u.ProjectItemID)
			}
			if u.UnitIndex < 1 || u.UnitIndex > qty {
				return nil, fmt.Errorf("BAD_REQUEST:unidad %s tiene unitIndex %d fuera de rango (línea con cantidad %d)", u.ID, u.UnitIndex, qty)
			}
			if u.Status != domain.ModuleUnitStatusAwaitingParts {
				return nil, fmt.Errorf("BAD_REQUEST:las unidades se generan en awaiting_parts, no en %s", u.Status)
			}
			if released != "" && u.ProductionRevision != released {
				return nil, fmt.Errorf("CONFLICT:la revisión de la unidad (%s) difiere de la liberada (%s)", u.ProductionRevision, released)
			}
			unitsPerItem[u.ProjectItemID]++
		}
		for itemID, count := range unitsPerItem {
			if count != snap.ItemQuantities[itemID] {
				return nil, fmt.Errorf("BAD_REQUEST:la línea %s declara %d unidades físicas pero llegaron %d", itemID, snap.ItemQuantities[itemID], count)
			}
		}
		seenPartIDs := map[string]struct{}{}
		for _, p := range body.PartInstances {
			if _, ok := snap.ItemQuantities[p.ProjectItemID]; !ok {
				return nil, fmt.Errorf("BAD_REQUEST:pieza %s referencia la línea %s que no existe en la obra", p.ID, p.ProjectItemID)
			}
			if _, dup := seenPartIDs[p.ID]; dup {
				return nil, fmt.Errorf("BAD_REQUEST:id de pieza duplicado: %s", p.ID)
			}
			seenPartIDs[p.ID] = struct{}{}
			if len(p.RequiredOperations) == 0 || p.RequiredOperations[0].Type != domain.PartOperationCut {
				return nil, fmt.Errorf("BAD_REQUEST:toda ruta de pieza empieza en cut: %s", p.ID)
			}
			if p.Status != domain.PartInstanceStatusPending {
				return nil, fmt.Errorf("BAD_REQUEST:las piezas se generan en pending, no en %s", p.Status)
			}
			if released != "" && p.ProductionRevision != released {
				return nil, fmt.Errorf("CONFLICT:la revisión de la pieza %s (%s) difiere de la liberada (%s)", p.ID, p.ProductionRevision, released)
			}
		}

		// ── Progress guard ──────────────────────────────────────────────
		hasProgress := false
		for _, existing := range snap.Parts {
			for _, op := range existing.RequiredOperations {
				if op.Status == domain.PartOperationStatusCompleted || op.Status == domain.PartOperationStatusInProgress || op.Status == domain.PartOperationStatusRework {
					hasProgress = true
				}
			}
		}
		for _, existing := range snap.Units {
			if existing.Status != domain.ModuleUnitStatusAwaitingParts {
				hasProgress = true
			}
		}
		if hasProgress && !body.Force {
			return nil, fmt.Errorf("CONFLICT:la obra ya tiene avance físico; regenerar requiere force=true (supervisión) y queda auditado")
		}

		// ── Replace + audit ─────────────────────────────────────────────
		before := deriveItemStatuses(snap)
		snap.Parts = body.PartInstances
		snap.Units = body.ModuleUnits
		after := deriveItemStatuses(snap)

		var events []domain.FloorStatusEvent
		for itemID, beforeStatus := range before {
			if beforeStatus != after[itemID] && after[itemID] == "pending" {
				ev := s.buildFloorEvent(r, projectID, itemID, beforeStatus, "pending",
					domain.FloorEventSourceManual, "Regeneración de piezas/unidades físicas (supervisión)")
				events = append(events, ev)
			}
		}

		result = map[string]interface{}{
			"part_instances": len(body.PartInstances),
			"module_units":   len(body.ModuleUnits),
			"forced":         hasProgress,
		}
		return &domain.PartExecutionsMutation{
			Parts:        snap.Parts,
			Units:        snap.Units,
			ItemStatuses: after,
			FloorEvents:  events,
		}, nil
	})
	if err != nil {
		respondWithMutationError(w, err)
		return
	}
	respondWithJSON(w, http.StatusOK, result)
}
