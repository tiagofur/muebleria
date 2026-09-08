package engine

import (
	"fmt"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #577 canonical physical execution derivation. The PartInstances and
// ModuleUnits a canonical ProductionRelease authorizes are derived EXCLUSIVELY
// from the frozen snapshot: the frozen BOM parts carry the physical truth
// (dimensions/material/grain/edges) and the frozen routing program carries the
// required operations. Nothing here reads mutable project state, the current
// catalog or client input — the guard has already validated the exact
// P1/revision/fingerprint pair and the routing program's coverage.
//
// The neutral DRILL intent maps onto the existing physical station vocabulary
// ("cnc"); station and machine adapters stay out of this boundary.

// ReleaseExecutionUnitView is the frozen-snapshot projection one unit
// contributes to the derivation (owner-private; the API never re-exposes the
// raw private payload shape).
type ReleaseExecutionUnitView struct {
	FurnitureInstanceID string
	Parts               []domain.ResolvedBoardPart
}

// DeriveCanonicalPartExecutions derives the exact physical executions of one
// canonical release from its frozen snapshot data. Every revision item is one
// physical unit (quantity 1 per FurnitureInstance); every board part copy
// becomes one PartInstance stamped with the exact release id.
func DeriveCanonicalPartExecutions(releaseID string, units []ReleaseExecutionUnitView, routing *ReleaseRoutingProgram) ([]domain.PartInstance, []domain.ModuleUnitExecution, error) {
	if strings.TrimSpace(releaseID) == "" {
		return nil, nil, fmt.Errorf("canonical execution requires the exact release identity")
	}
	if len(units) == 0 {
		return nil, nil, fmt.Errorf("canonical execution requires frozen units")
	}
	if routing == nil {
		return nil, nil, fmt.Errorf("canonical execution requires the frozen routing program")
	}
	routingUnits := make(map[string]ReleaseRoutingUnit, len(routing.Units))
	for _, unit := range routing.Units {
		routingUnits[unit.FurnitureInstanceID] = unit
	}

	parts := make([]domain.PartInstance, 0, len(units))
	unitsOut := make([]domain.ModuleUnitExecution, 0, len(units))
	seenUnits := make(map[string]bool, len(units))
	for _, unit := range units {
		if strings.TrimSpace(unit.FurnitureInstanceID) == "" {
			return nil, nil, fmt.Errorf("canonical execution unit requires the furniture instance identity")
		}
		if seenUnits[unit.FurnitureInstanceID] {
			return nil, nil, fmt.Errorf("canonical execution unit %s appears more than once", unit.FurnitureInstanceID)
		}
		seenUnits[unit.FurnitureInstanceID] = true

		routingUnit, ok := routingUnits[unit.FurnitureInstanceID]
		if !ok {
			return nil, nil, fmt.Errorf("frozen routing does not cover unit %s", unit.FurnitureInstanceID)
		}
		routingParts := make(map[string]ReleaseRoutingPart, len(routingUnit.Parts))
		for _, part := range routingUnit.Parts {
			routingParts[part.PartID] = part
		}
		if len(routingUnit.Parts) != len(unit.Parts) {
			return nil, nil, fmt.Errorf("frozen routing and BOM disagree on unit %s parts", unit.FurnitureInstanceID)
		}
		for _, board := range unit.Parts {
			routingPart, ok := routingParts[board.ID]
			if !ok {
				return nil, nil, fmt.Errorf("frozen routing does not cover part %s", board.ID)
			}
			copies := board.Quantity
			if copies < 1 {
				copies = 1
			}
			for copyIndex := 1; copyIndex <= copies; copyIndex++ {
				parts = append(parts, canonicalPartInstance(releaseID, unit.FurnitureInstanceID, board, routingPart, copyIndex))
			}
		}

		unitsOut = append(unitsOut, domain.ModuleUnitExecution{
			ID:                 canonicalUnitID(releaseID, unit.FurnitureInstanceID),
			ProjectID:          "",
			ProjectItemID:      unit.FurnitureInstanceID,
			UnitIndex:          1,
			ProductionRevision: releaseID,
			Status:             domain.ModuleUnitStatusAwaitingParts,
		})
	}
	if len(routingUnits) != len(units) {
		return nil, nil, fmt.Errorf("frozen routing covers %d units, snapshot has %d", len(routingUnits), len(units))
	}
	return parts, unitsOut, nil
}

func canonicalUnitID(releaseID, furnitureInstanceID string) string {
	return fmt.Sprintf("%s:%s:u1", releaseID, furnitureInstanceID)
}

func canonicalPartInstance(releaseID, furnitureInstanceID string, board domain.ResolvedBoardPart, routing ReleaseRoutingPart, copyIndex int) domain.PartInstance {
	partCode := board.Code
	if partCode == "" {
		partCode = board.ID
	}
	partID := fmt.Sprintf("%s:%s:%s:p1", releaseID, furnitureInstanceID, board.ID)
	if copyIndex > 1 {
		partID = fmt.Sprintf("%s:%s:%s:p%d", releaseID, furnitureInstanceID, board.ID, copyIndex)
	}

	grain := 0
	if board.Grain == domain.GrainYes {
		grain = 1
	}
	edges := append([]domain.EdgeAssignment(nil), board.Edges...)

	// Operation sequence mirrors the floor contract: cut is always step 1,
	// then machining (neutral drill → cnc station), then edge banding when
	// any frozen side is enabled. Statuses start queued; identity carries the
	// sequence so station scans stay deterministic.
	sequence := 1
	operations := []domain.PartOperation{{
		ID: fmt.Sprintf("op-cut-%d", sequence), Type: domain.PartOperationCut,
		Sequence: sequence, Status: domain.PartOperationStatusQueued,
	}}
	if routing.CncRequired {
		sequence++
		operations = append(operations, domain.PartOperation{
			ID: fmt.Sprintf("op-cnc-%d", sequence), Type: domain.PartOperationCNC,
			Sequence: sequence, Status: domain.PartOperationStatusQueued,
		})
	}
	if len(routing.EdgeBandingSides) > 0 {
		sequence++
		operations = append(operations, domain.PartOperation{
			ID: fmt.Sprintf("op-edge-%d", sequence), Type: domain.PartOperationEdgeBanding,
			Sequence: sequence, Status: domain.PartOperationStatusQueued,
		})
	}

	return domain.PartInstance{
		ID:                    partID,
		ProjectID:             "",
		ProductionRevision:    releaseID,
		ProjectItemID:         furnitureInstanceID,
		UnitIndex:             1,
		PartCode:              partCode,
		PartDefinitionID:      board.ID,
		Description:           board.Description,
		MaterialID:            board.MaterialID,
		LengthMm:              float64(board.LengthMm),
		WidthMm:               float64(board.WidthMm),
		ThicknessMm:           float64(board.ThicknessMm),
		Grain:                 grain,
		Edges:                 edges,
		RequiredOperations:    operations,
		CurrentOperationIndex: 0,
		Status:                domain.PartInstanceStatusPending,
	}
}
