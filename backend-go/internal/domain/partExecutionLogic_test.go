package domain

import (
	"testing"
	"time"
)

/**
 * Behavioral parity with packages/domain/src/partExecution.test.ts:
 * sequence guard, stale revision gate, unit transition chain, rework and
 * legacy ItemFloorStatus derivation (OC-030..OC-034).
 */

var logicNow = time.Date(2026, 8, 21, 10, 0, 0, 0, time.UTC)

func logicPart(route ...PartOperationType) PartInstance {
	ops := make([]PartOperation, 0, len(route))
	for i, t := range route {
		ops = append(ops, PartOperation{
			ID:       "op",
			Type:     t,
			Sequence: i + 1,
			Status:   PartOperationStatusQueued,
		})
	}
	return PartInstance{
		ID:                 "p1",
		ProjectID:          "proj-1",
		ProductionRevision: "rev-1",
		ProjectItemID:      "item-1",
		UnitIndex:          1,
		PartCode:           "LAT",
		RequiredOperations: ops,
		Status:             PartInstanceStatusPending,
	}
}

func TestAdvancePartOperationSequenceGuard(t *testing.T) {
	part := logicPart(PartOperationCut, PartOperationCNC, PartOperationEdgeBanding)

	// edge_banding before cut/cnc → rejected
	if updated, changed := AdvancePartOperation(part, PartOperationEdgeBanding, OperatorDetails{At: logicNow}); changed {
		t.Fatalf("edge before cut must be rejected, got %+v", updated.RequiredOperations[2])
	}
	// cnc before cut → rejected
	if _, changed := AdvancePartOperation(part, PartOperationCNC, OperatorDetails{At: logicNow}); changed {
		t.Fatal("cnc before cut must be rejected")
	}

	// Sequential advance works and finishes ready_for_assembly
	afterCut, _ := AdvancePartOperation(part, PartOperationCut, OperatorDetails{At: logicNow})
	afterCnc, _ := AdvancePartOperation(afterCut, PartOperationCNC, OperatorDetails{At: logicNow})
	afterEdge, changed := AdvancePartOperation(afterCnc, PartOperationEdgeBanding, OperatorDetails{At: logicNow})
	if !changed || afterEdge.Status != PartInstanceStatusReadyForAssembly {
		t.Fatalf("sequential advance must finish ready_for_assembly, got status=%s", afterEdge.Status)
	}

	// Unknown/completed operation → no change
	if _, changed := AdvancePartOperation(afterEdge, PartOperationCut, OperatorDetails{At: logicNow}); changed {
		t.Fatal("advancing an already completed operation must not change the part")
	}
}

func TestCheckAssemblyReadinessStaleRevision(t *testing.T) {
	unit := ModuleUnitExecution{
		ID: "u1", ProjectID: "proj-1", ProjectItemID: "item-1", UnitIndex: 1,
		ProductionRevision: "rev-1", Status: ModuleUnitStatusAwaitingParts,
	}
	done := logicPart(PartOperationCut)
	done.Status = PartInstanceStatusReadyForAssembly

	// All pieces ready but released revision moved to rev-2 → blocked
	stale := CheckAssemblyReadiness(unit, []PartInstance{done}, "rev-2")
	if stale.IsReady || !stale.CanStartWithOverride {
		t.Fatalf("stale revision must block assembly (isReady=%v)", stale.IsReady)
	}
	if len(stale.Blockers) == 0 || stale.Blockers[0][:3] != "La " {
		t.Fatalf("expected revision blocker, got %v", stale.Blockers)
	}

	// Correct revision → ready
	fresh := CheckAssemblyReadiness(unit, []PartInstance{done}, "rev-1")
	if !fresh.IsReady || fresh.ReadyPieces != 1 || fresh.TotalPieces != 1 {
		t.Fatalf("fresh revision must be ready, got %+v", fresh)
	}

	// Piece from an older revision counts as missing
	stalePiece := done
	stalePiece.ProductionRevision = "rev-0"
	mixed := CheckAssemblyReadiness(unit, []PartInstance{stalePiece}, "rev-1")
	if mixed.IsReady || mixed.ReadyPieces != 0 || len(mixed.MissingPieces) != 1 {
		t.Fatalf("stale piece must be missing, got %+v", mixed)
	}

	// Supervisor override unblocks the stale gate
	overridden := RecordSupervisorAssemblyOverride(unit, "Cambio menor", "sup-1", 0, logicNow)
	if check := CheckAssemblyReadiness(overridden, []PartInstance{done}, "rev-2"); !check.IsReady || !check.HasOverride {
		t.Fatalf("override must unblock stale revision, got %+v", check)
	}
}

func TestModuleUnitTransitionChain(t *testing.T) {
	cases := []struct {
		from, to ModuleUnitStatus
		valid    bool
	}{
		{ModuleUnitStatusAwaitingParts, ModuleUnitStatusAssembly, true},
		{ModuleUnitStatusModuleQC, ModuleUnitStatusPackaged, true},
		{ModuleUnitStatusAwaitingParts, ModuleUnitStatusInstalled, false},
		{ModuleUnitStatusAssembly, ModuleUnitStatusPackaged, false},
		{ModuleUnitStatusPackaged, ModuleUnitStatusAssembly, false},
		{ModuleUnitStatusInstalled, ModuleUnitStatusLoaded, false},
	}
	for _, c := range cases {
		if got := CanTransitionModuleUnitStatus(c.from, c.to); got != c.valid {
			t.Fatalf("CanTransitionModuleUnitStatus(%s→%s)=%v, want %v", c.from, c.to, got, c.valid)
		}
	}
	if next := NextModuleUnitStatus(ModuleUnitStatusAwaitingParts); next != ModuleUnitStatusAssembly {
		t.Fatalf("next of awaiting_parts must be assembly, got %s", next)
	}
	if next := NextModuleUnitStatus(ModuleUnitStatusInstalled); next != "" {
		t.Fatalf("next of installed must be empty, got %s", next)
	}

	unit := ModuleUnitExecution{Status: ModuleUnitStatusAwaitingParts, ProductionRevision: "rev-1"}
	// Invalid jump rejected
	if _, changed := AdvanceModuleUnitStatus(unit, ModuleUnitStatusInstalled, logicNow, ""); changed {
		t.Fatal("jump awaiting_parts→installed must be rejected")
	}
	// Valid chain stamps milestones
	inAssembly, _ := AdvanceModuleUnitStatus(unit, ModuleUnitStatusAssembly, logicNow, "")
	if inAssembly.AssembledAt == nil {
		t.Fatal("assembly must stamp assembledAt")
	}
	inQC, _ := AdvanceModuleUnitStatus(inAssembly, ModuleUnitStatusModuleQC, logicNow, "")
	if inQC.QCPassedAt == nil {
		t.Fatal("module_qc must stamp qcPassedAt")
	}
}

func TestTriggerPartRework(t *testing.T) {
	part := logicPart(PartOperationCut, PartOperationEdgeBanding)
	afterCut, _ := AdvancePartOperation(part, PartOperationCut, OperatorDetails{At: logicNow})
	afterEdge, _ := AdvancePartOperation(afterCut, PartOperationEdgeBanding, OperatorDetails{At: logicNow})

	reworked, changed := TriggerPartRework(afterEdge, "rework", "Canto despegado", PartOperationEdgeBanding)
	if !changed || reworked.Status != PartInstanceStatusInProgress {
		t.Fatalf("rework must reopen the piece, got status=%s", reworked.Status)
	}
	if reworked.RequiredOperations[1].Status != PartOperationStatusRework {
		t.Fatalf("target op must be rework, got %s", reworked.RequiredOperations[1].Status)
	}

	refab, changed := TriggerPartRework(afterEdge, "refabricate", "Pieza partida", "")
	if !changed || refab.Status != PartInstanceStatusPending || refab.CurrentOperationIndex != 0 {
		t.Fatalf("refabricate must reset the piece, got %+v", refab)
	}
	for _, op := range refab.RequiredOperations {
		if op.Status != PartOperationStatusQueued || op.CompletedAt != nil {
			t.Fatal("refabricate must queue all operations without timestamps")
		}
	}
}

func TestDeriveLegacyItemFloorStatus(t *testing.T) {
	unit := ModuleUnitExecution{Status: ModuleUnitStatusAwaitingParts}
	uncut := logicPart(PartOperationCut)
	if got := DeriveLegacyItemFloorStatus([]ModuleUnitExecution{unit}, []PartInstance{uncut}); got != "pending" {
		t.Fatalf("pending expected, got %s", got)
	}

	cutDone := uncut
	cutDone.RequiredOperations = []PartOperation{{ID: "op", Type: PartOperationCut, Status: PartOperationStatusCompleted}}
	if got := DeriveLegacyItemFloorStatus([]ModuleUnitExecution{unit}, []PartInstance{cutDone}); got != "cut" {
		t.Fatalf("cut expected, got %s", got)
	}

	ready := cutDone
	ready.Status = PartInstanceStatusReadyForAssembly
	if got := DeriveLegacyItemFloorStatus([]ModuleUnitExecution{unit}, []PartInstance{ready}); got != "edged" {
		t.Fatalf("edged expected, got %s", got)
	}

	assembled, _ := AdvanceModuleUnitStatus(unit, ModuleUnitStatusAssembly, logicNow, "")
	if got := DeriveLegacyItemFloorStatus([]ModuleUnitExecution{assembled}, []PartInstance{ready}); got != "assembled" {
		t.Fatalf("assembled expected, got %s", got)
	}

	installed := ModuleUnitExecution{Status: ModuleUnitStatusInstalled}
	if got := DeriveLegacyItemFloorStatus([]ModuleUnitExecution{installed}, []PartInstance{ready}); got != "installed" {
		t.Fatalf("installed expected, got %s", got)
	}

	// Mixed units: one installed + one packaged → packaged (all-units semantics)
	packaged := ModuleUnitExecution{Status: ModuleUnitStatusPackaged}
	if got := DeriveLegacyItemFloorStatus([]ModuleUnitExecution{installed, packaged}, []PartInstance{ready}); got != "packaged" {
		t.Fatalf("packaged expected for mixed units, got %s", got)
	}
}
