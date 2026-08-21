package domain

import (
	"fmt"
	"time"
)

/**
 * Physical Production Execution: Part Instances, Operations, Routing & Module Units (OC-030..OC-034).
 * Parity with packages/domain/src/partExecution.ts.
 */

// PartOperationType represents the discrete manufacturing operation for a piece.
type PartOperationType string

const (
	PartOperationCut         PartOperationType = "cut"
	PartOperationCNC         PartOperationType = "cnc"
	PartOperationEdgeBanding PartOperationType = "edge_banding"
	PartOperationInspection  PartOperationType = "inspection"
)

var partOperationTypes = map[string]struct{}{
	"cut":          {},
	"cnc":          {},
	"edge_banding": {},
	"inspection":   {},
}

// IsValidPartOperationType validates if a string is an approved PartOperationType.
func IsValidPartOperationType(t string) bool {
	_, ok := partOperationTypes[t]
	return ok
}

// PartOperationStatus represents the state of an individual operation.
type PartOperationStatus string

const (
	PartOperationStatusQueued     PartOperationStatus = "queued"
	PartOperationStatusInProgress PartOperationStatus = "in_progress"
	PartOperationStatusCompleted  PartOperationStatus = "completed"
	PartOperationStatusBlocked    PartOperationStatus = "blocked"
	PartOperationStatusRework     PartOperationStatus = "rework"
	PartOperationStatusSkipped    PartOperationStatus = "skipped"
)

var partOperationStatuses = map[string]struct{}{
	"queued":      {},
	"in_progress": {},
	"completed":   {},
	"blocked":     {},
	"rework":      {},
	"skipped":     {},
}

// IsValidPartOperationStatus validates if a string is an approved PartOperationStatus.
func IsValidPartOperationStatus(s string) bool {
	_, ok := partOperationStatuses[s]
	return ok
}

// ModuleUnitStatus represents the physical progress of a furniture unit from assembly onwards.
type ModuleUnitStatus string

const (
	ModuleUnitStatusAwaitingParts ModuleUnitStatus = "awaiting_parts"
	ModuleUnitStatusAssembly      ModuleUnitStatus = "assembly"
	ModuleUnitStatusModuleQC      ModuleUnitStatus = "module_qc"
	ModuleUnitStatusPackaged      ModuleUnitStatus = "packaged"
	ModuleUnitStatusLoaded        ModuleUnitStatus = "loaded"
	ModuleUnitStatusInstalled     ModuleUnitStatus = "installed"
)

var moduleUnitStatuses = map[string]struct{}{
	"awaiting_parts": {},
	"assembly":       {},
	"module_qc":      {},
	"packaged":       {},
	"loaded":         {},
	"installed":      {},
}

// IsValidModuleUnitStatus validates if a string is an approved ModuleUnitStatus.
func IsValidModuleUnitStatus(s string) bool {
	_, ok := moduleUnitStatuses[s]
	return ok
}

// PartInstanceStatus represents the overall state of a single physical piece.
type PartInstanceStatus string

const (
	PartInstanceStatusPending          PartInstanceStatus = "pending"
	PartInstanceStatusInProgress       PartInstanceStatus = "in_progress"
	PartInstanceStatusReadyForAssembly PartInstanceStatus = "ready_for_assembly"
	PartInstanceStatusAssembled        PartInstanceStatus = "assembled"
	PartInstanceStatusScrapped         PartInstanceStatus = "scrapped"
)

// PartOperation is an executable step in a piece's manufacturing route.
type PartOperation struct {
	ID           string              `json:"id"`
	Type         PartOperationType   `json:"type"`
	Sequence     int                 `json:"sequence"`
	Status       PartOperationStatus `json:"status"`
	StartedAt    *time.Time          `json:"started_at,omitempty"`
	CompletedAt  *time.Time          `json:"completed_at,omitempty"`
	OperatorID   string              `json:"operator_id,omitempty"`
	OperatorName string              `json:"operator_name,omitempty"`
	MachineID    string              `json:"machine_id,omitempty"`
	Notes        string              `json:"notes,omitempty"`
}

// PartInstance represents one physical piece of a unit of a project line item.
type PartInstance struct {
	ID                    string             `json:"id"`
	ProjectID             string             `json:"project_id"`
	ProductionRevision    string             `json:"production_revision"`
	ProjectItemID         string             `json:"project_item_id"`
	UnitIndex             int                `json:"unit_index"`
	PartCode              string             `json:"part_code"`
	PartDefinitionID      string             `json:"part_definition_id,omitempty"`
	Description           string             `json:"description"`
	MaterialID            string             `json:"material_id"`
	LengthMm              float64            `json:"length_mm"`
	WidthMm               float64            `json:"width_mm"`
	ThicknessMm           float64            `json:"thickness_mm"`
	Grain                 int                `json:"grain"`
	Edges                 []EdgeAssignment   `json:"edges"`
	RequiredOperations    []PartOperation    `json:"required_operations"`
	CurrentOperationIndex int                `json:"current_operation_index"`
	Status                PartInstanceStatus `json:"status"`
}

// ModuleUnitExecution represents one physical unit of furniture from assembly onwards.
type ModuleUnitExecution struct {
	ID                 string                      `json:"id"`
	ProjectID          string                      `json:"project_id"`
	ProjectItemID      string                      `json:"project_item_id"`
	UnitIndex          int                         `json:"unit_index"`
	ProductionRevision string                      `json:"production_revision"`
	Status             ModuleUnitStatus            `json:"status"`
	PackageCount       *int                        `json:"package_count,omitempty"`
	SupervisorOverride *SupervisorAssemblyOverride `json:"supervisor_override,omitempty"`
	AssembledAt        *time.Time                  `json:"assembled_at,omitempty"`
	QCPassedAt         *time.Time                  `json:"qc_passed_at,omitempty"`
	PackagedAt         *time.Time                  `json:"packaged_at,omitempty"`
	LoadedAt           *time.Time                  `json:"loaded_at,omitempty"`
	InstalledAt        *time.Time                  `json:"installed_at,omitempty"`
	Notes              string                      `json:"notes,omitempty"`
}

// SupervisorAssemblyOverride audits a supervisor forcing assembly with
// incomplete pieces (OC-032).
type SupervisorAssemblyOverride struct {
	OverriddenBy      string    `json:"overridden_by"`
	OverriddenAt      time.Time `json:"overridden_at"`
	Reason            string    `json:"reason"`
	MissingPartsCount int       `json:"missing_parts_count"`
}

// moduleUnitStatusTransitions is the strict forward chain of physical unit
// statuses (OC-033), in parity with MODULE_UNIT_STATUS_TRANSITIONS in
// packages/domain/src/partExecution.ts.
var moduleUnitStatusTransitions = map[ModuleUnitStatus][]ModuleUnitStatus{
	ModuleUnitStatusAwaitingParts: {ModuleUnitStatusAssembly},
	ModuleUnitStatusAssembly:      {ModuleUnitStatusModuleQC},
	ModuleUnitStatusModuleQC:      {ModuleUnitStatusPackaged},
	ModuleUnitStatusPackaged:      {ModuleUnitStatusLoaded},
	ModuleUnitStatusLoaded:        {ModuleUnitStatusInstalled},
	ModuleUnitStatusInstalled:     {},
}

// CanTransitionModuleUnitStatus reports whether the forward physical chain
// allows moving from one unit status to another.
func CanTransitionModuleUnitStatus(from, to ModuleUnitStatus) bool {
	for _, next := range moduleUnitStatusTransitions[from] {
		if next == to {
			return true
		}
	}
	return false
}

// NextModuleUnitStatus returns the next status in the physical chain, or ""
// when the unit is already installed.
func NextModuleUnitStatus(status ModuleUnitStatus) ModuleUnitStatus {
	if next := moduleUnitStatusTransitions[status]; len(next) > 0 {
		return next[0]
	}
	return ""
}

// AdvancePartOperation completes the operation of the given type for a piece.
// Stations are sequential per piece (cut → cnc → edge_banding): the operation
// is only completed when every previous operation in the route is already
// completed or skipped. Returns the updated piece and whether it changed.
func AdvancePartOperation(part PartInstance, operationType PartOperationType, details OperatorDetails) (PartInstance, bool) {
	opIdx := -1
	for i, op := range part.RequiredOperations {
		if op.Type == operationType && (op.Status == PartOperationStatusQueued || op.Status == PartOperationStatusInProgress) {
			opIdx = i
			break
		}
	}
	if opIdx == -1 {
		return part, false
	}
	for _, op := range part.RequiredOperations[:opIdx] {
		if op.Status != PartOperationStatusCompleted && op.Status != PartOperationStatusSkipped {
			return part, false
		}
	}

	updated := part
	updated.RequiredOperations = append([]PartOperation(nil), part.RequiredOperations...)
	op := updated.RequiredOperations[opIdx]
	op.Status = PartOperationStatusCompleted
	op.CompletedAt = &details.At
	if details.OperatorID != "" {
		op.OperatorID = details.OperatorID
	}
	if details.OperatorName != "" {
		op.OperatorName = details.OperatorName
	}
	if details.MachineID != "" {
		op.MachineID = details.MachineID
	}
	if details.Notes != "" {
		op.Notes = details.Notes
	}
	updated.RequiredOperations[opIdx] = op

	nextOpIdx := -1
	allDone := true
	for i, op := range updated.RequiredOperations {
		if op.Status == PartOperationStatusQueued || op.Status == PartOperationStatusInProgress {
			if nextOpIdx == -1 {
				nextOpIdx = i
			}
			allDone = false
		}
	}
	updated.CurrentOperationIndex = nextOpIdx
	if nextOpIdx == -1 {
		updated.CurrentOperationIndex = len(updated.RequiredOperations) - 1
	}
	if allDone {
		updated.Status = PartInstanceStatusReadyForAssembly
	} else {
		updated.Status = PartInstanceStatusInProgress
	}
	return updated, true
}

// OperatorDetails identifies who/when/how an operation was executed.
type OperatorDetails struct {
	At           time.Time
	OperatorID   string
	OperatorName string
	MachineID    string
	Notes        string
}

// AssemblyReadiness is the convergence gate verdict for one unit (OC-032).
type AssemblyReadiness struct {
	IsReady              bool           `json:"is_ready"`
	CanStartWithOverride bool           `json:"can_start_with_override"`
	ReadyPieces          int            `json:"ready_pieces"`
	TotalPieces          int            `json:"total_pieces"`
	MissingPieces        []PartInstance `json:"missing_pieces"`
	Blockers             []string       `json:"blockers"`
	HasOverride          bool           `json:"has_override"`
}

// CheckAssemblyReadiness reports whether a unit may enter assembly.
//
// Stale revision guard (docs/production-flow-v2.md §7): when releasedRevision
// is non-empty and differs from the unit's (or a piece's) production revision,
// assembly is blocked until a supervisor override is recorded — physical
// production never runs silently against a stale revision.
func CheckAssemblyReadiness(unit ModuleUnitExecution, allParts []PartInstance, releasedRevision string) AssemblyReadiness {
	var unitParts []PartInstance
	for _, p := range allParts {
		if p.ProjectItemID == unit.ProjectItemID && p.UnitIndex == unit.UnitIndex {
			unitParts = append(unitParts, p)
		}
	}
	if len(unitParts) == 0 {
		return AssemblyReadiness{
			Blockers: []string{"No hay piezas generadas para esta unidad"},
		}
	}

	unitRevisionStale := releasedRevision != "" && unit.ProductionRevision != releasedRevision
	hasOverride := unit.SupervisorOverride != nil

	readyCount := 0
	staleParts := 0
	var missing []PartInstance
	for _, p := range unitParts {
		if p.ProductionRevision != unit.ProductionRevision {
			staleParts++
			missing = append(missing, p)
			continue
		}
		if p.Status == PartInstanceStatusReadyForAssembly || p.Status == PartInstanceStatusAssembled {
			readyCount++
		} else {
			missing = append(missing, p)
		}
	}

	isReady := (len(missing) == 0 && !unitRevisionStale) || hasOverride

	var blockers []string
	if !hasOverride {
		if unitRevisionStale {
			blockers = append(blockers,
				"La revisión liberada ("+releasedRevision+") difiere de la revisión de la unidad ("+unit.ProductionRevision+")")
		}
		if staleParts > 0 {
			blockers = append(blockers, fmt.Sprintf("%d pieza(s) pertenecen a una revisión anterior", staleParts))
		}
		if len(missing) > 0 {
			blockers = append(blockers, fmt.Sprintf("Faltan %d piezas por terminar antes de armado", len(missing)))
		}
	}
	if missing == nil {
		missing = []PartInstance{}
	}
	if blockers == nil {
		blockers = []string{}
	}

	return AssemblyReadiness{
		IsReady:              isReady,
		CanStartWithOverride: !isReady,
		ReadyPieces:          readyCount,
		TotalPieces:          len(unitParts),
		MissingPieces:        missing,
		Blockers:             blockers,
		HasOverride:          hasOverride,
	}
}

// RecordSupervisorAssemblyOverride audits a supervisor allowing assembly with
// incomplete pieces (OC-032).
func RecordSupervisorAssemblyOverride(unit ModuleUnitExecution, reason, overriddenBy string, missingPartsCount int, at time.Time) ModuleUnitExecution {
	updated := unit
	updated.SupervisorOverride = &SupervisorAssemblyOverride{
		OverriddenBy:      overriddenBy,
		OverriddenAt:      at,
		Reason:            reason,
		MissingPartsCount: missingPartsCount,
	}
	return updated
}

// AdvanceModuleUnitStatus moves a unit forward through the physical chain,
// validating the transition. Returns the updated unit and whether it changed.
func AdvanceModuleUnitStatus(unit ModuleUnitExecution, target ModuleUnitStatus, at time.Time, notes string) (ModuleUnitExecution, bool) {
	if target != unit.Status && !CanTransitionModuleUnitStatus(unit.Status, target) {
		return unit, false
	}
	updated := unit
	updated.Status = target
	if notes != "" {
		updated.Notes = notes
	}
	stamp := func(target ModuleUnitStatus, statuses ...ModuleUnitStatus) *time.Time {
		for _, s := range statuses {
			if s == target {
				t := at
				return &t
			}
		}
		return nil
	}
	if t := stamp(target, ModuleUnitStatusAssembly, ModuleUnitStatusModuleQC); t != nil && updated.AssembledAt == nil {
		updated.AssembledAt = t
	}
	if t := stamp(target, ModuleUnitStatusModuleQC, ModuleUnitStatusPackaged); t != nil && updated.QCPassedAt == nil {
		updated.QCPassedAt = t
	}
	if t := stamp(target, ModuleUnitStatusPackaged, ModuleUnitStatusLoaded); t != nil && updated.PackagedAt == nil {
		updated.PackagedAt = t
	}
	if t := stamp(target, ModuleUnitStatusLoaded, ModuleUnitStatusInstalled); t != nil && updated.LoadedAt == nil {
		updated.LoadedAt = t
	}
	if t := stamp(target, ModuleUnitStatusInstalled); t != nil && updated.InstalledAt == nil {
		updated.InstalledAt = t
	}
	return updated, true
}

// TriggerPartRework reopens a piece for a specific operation rework or a full
// refabrication (OC-061). Returns the updated piece and whether it changed.
func TriggerPartRework(part PartInstance, action, reason string, targetOperation PartOperationType) (PartInstance, bool) {
	switch action {
	case "refabricate":
		updated := part
		updated.RequiredOperations = append([]PartOperation(nil), part.RequiredOperations...)
		for i := range updated.RequiredOperations {
			op := updated.RequiredOperations[i]
			op.Status = PartOperationStatusQueued
			op.CompletedAt = nil
			if reason != "" {
				op.Notes = "Refabricación: " + reason
			}
			updated.RequiredOperations[i] = op
		}
		updated.CurrentOperationIndex = 0
		updated.Status = PartInstanceStatusPending
		return updated, true
	case "rework":
		targetOpIdx := -1
		if targetOperation != "" {
			for i, op := range part.RequiredOperations {
				if op.Type == targetOperation {
					targetOpIdx = i
					break
				}
			}
		} else {
			for i, op := range part.RequiredOperations {
				if op.Status == PartOperationStatusCompleted {
					targetOpIdx = i
				}
			}
		}
		if targetOpIdx == -1 {
			return part, false
		}
		updated := part
		updated.RequiredOperations = append([]PartOperation(nil), part.RequiredOperations...)
		for i := targetOpIdx; i < len(updated.RequiredOperations); i++ {
			op := updated.RequiredOperations[i]
			if i == targetOpIdx {
				op.Status = PartOperationStatusRework
			} else {
				op.Status = PartOperationStatusQueued
			}
			op.CompletedAt = nil
			if reason != "" {
				op.Notes = "Retrabajo: " + reason
			}
			updated.RequiredOperations[i] = op
		}
		updated.CurrentOperationIndex = targetOpIdx
		updated.Status = PartInstanceStatusInProgress
		return updated, true
	default:
		return part, false
	}
}

// DeriveLegacyItemFloorStatus computes the backward-compatible ItemFloorStatus
// for one project item from its physical units and pieces (OC-034). Parity
// with deriveLegacyItemFloorStatus in partExecution.ts.
func DeriveLegacyItemFloorStatus(units []ModuleUnitExecution, parts []PartInstance) string {
	if len(units) == 0 && len(parts) == 0 {
		return "pending"
	}
	if len(units) > 0 {
		allInstalled := true
		allLoaded := true
		allPackaged := true
		anyAssembledPlus := false
		for _, u := range units {
			switch u.Status {
			case ModuleUnitStatusInstalled:
				anyAssembledPlus = true
			case ModuleUnitStatusLoaded:
				anyAssembledPlus = true
				allInstalled = false
			case ModuleUnitStatusPackaged:
				anyAssembledPlus = true
				allInstalled = false
				allLoaded = false
			case ModuleUnitStatusModuleQC, ModuleUnitStatusAssembly:
				anyAssembledPlus = true
				allInstalled = false
				allLoaded = false
				allPackaged = false
			case ModuleUnitStatusAwaitingParts:
				allInstalled = false
				allLoaded = false
				allPackaged = false
			}
		}
		if allInstalled {
			return "installed"
		}
		if allLoaded {
			return "loaded"
		}
		if allPackaged {
			return "packaged"
		}
		if anyAssembledPlus {
			return "assembled"
		}
	}
	if len(parts) > 0 {
		allReady := true
		allCut := true
		for _, p := range parts {
			if p.Status != PartInstanceStatusReadyForAssembly && p.Status != PartInstanceStatusAssembled {
				allReady = false
			}
			cutDone := false
			for _, op := range p.RequiredOperations {
				if op.Type == PartOperationCut && op.Status == PartOperationStatusCompleted {
					cutDone = true
				}
			}
			if !cutDone {
				allCut = false
			}
		}
		if allReady {
			return "edged"
		}
		if allCut {
			return "cut"
		}
	}
	return "pending"
}

// PartExecutionsSnapshot is the locked state handed to a station mutation
// (part_instances + module_units + the per-item legacy floor statuses used by
// the OC-034 backward-compat bridge).
type PartExecutionsSnapshot struct {
	Parts        []PartInstance
	Units        []ModuleUnitExecution
	ItemStatuses map[string]string
	/** itemID → line quantity, for generation validation (unit count per item). */
	ItemQuantities map[string]int
}

// PartExecutionsMutation is what a station mutation produced and what gets
// persisted atomically: new JSONB payloads, derived legacy item statuses and
// the audit floor events.
type PartExecutionsMutation struct {
	Parts        []PartInstance
	Units        []ModuleUnitExecution
	ItemStatuses map[string]string
	FloorEvents  []FloorStatusEvent
}
