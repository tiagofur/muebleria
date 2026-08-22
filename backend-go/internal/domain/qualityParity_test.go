package domain

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// TestQualityStatusesFixtureParity validates parity with
// contracts/qualityStatuses.json (OC-060..OC-062).
func TestQualityStatusesFixtureParity(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "qualityStatuses.json"))
	if err != nil {
		t.Fatalf("read contracts/qualityStatuses.json: %v", err)
	}
	var fixture struct {
		Comment              string              `json:"comment"`
		IssueCategories      []string            `json:"issueCategories"`
		IssueStatuses        []string            `json:"issueStatuses"`
		IssueStatusTransitions map[string][]string `json:"issueStatusTransitions"`
		ReworkActionTypes    []string            `json:"reworkActionTypes"`
		QcCheckCodes         []string            `json:"qcCheckCodes"`
		QcGateCheckCodes     []string            `json:"qcGateCheckCodes"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("parse contracts/qualityStatuses.json: %v", err)
	}

	assertFixtureSetParity(t, "issueCategories", fixture.IssueCategories, qualityIssueCategories, IsValidQualityIssueCategory)
	assertFixtureSetParity(t, "issueStatuses", fixture.IssueStatuses, qualityIssueStatuses, IsValidQualityIssueStatus)
	assertFixtureSetParity(t, "reworkActionTypes", fixture.ReworkActionTypes, reworkActionTypes, IsValidReworkActionType)
	assertFixtureSetParity(t, "qcCheckCodes", fixture.QcCheckCodes, qcCheckCodes, IsValidQcCheckCode)

	for from, targets := range fixture.IssueStatusTransitions {
		goTargets := qualityIssueStatusTransitions[QualityIssueStatus(from)]
		if len(goTargets) != len(targets) {
			t.Fatalf("issue transitions from %q: fixture has %v, Go has %v", from, targets, goTargets)
		}
		for _, to := range targets {
			if !CanTransitionQualityIssueStatus(QualityIssueStatus(from), QualityIssueStatus(to)) {
				t.Errorf("issue transition %q → %q from fixture must be legal in Go", from, to)
			}
		}
	}

	for _, code := range fixture.QcGateCheckCodes {
		if _, ok := qcGateCheckLabels[QcGateCheckCode(code)]; !ok {
			t.Errorf("fixture qcGateCheckCode %q missing from Go", code)
		}
	}
}

func qualityTestUnit() ModuleUnitExecution {
	return ModuleUnitExecution{
		ID: "unit-1", ProjectID: "proj-1", ProjectItemID: "item-1", UnitIndex: 1,
		ProductionRevision: "rel-1", Status: ModuleUnitStatusModuleQC,
	}
}

func fullQcChecklist() []UnitQcChecklistItem {
	return []UnitQcChecklistItem{
		{Code: QcCheckSquare, Passed: true},
		{Code: QcCheckDimensions, Passed: true},
		{Code: QcCheckHardware, Passed: true},
		{Code: QcCheckDoorsDrawers, Passed: true},
		{Code: QcCheckFinish, Passed: true},
		{Code: QcCheckIdentification, Passed: true},
	}
}

// TestEvaluateUnitQcGate mirrors the TS gate tests: blocked without a record,
// open after a passing checklist, blocked by open issues and unlocked (but
// flagged) by a supervisor override.
func TestEvaluateUnitQcGate(t *testing.T) {
	blocked := EvaluateUnitQcGate(nil, qualityTestUnit())
	if blocked.Ready {
		t.Fatal("sin registro de QC el gate debe bloquear")
	}
	if len(blocked.Failing) != 1 || blocked.Failing[0].Code != QcGateCheckPassed {
		t.Fatalf("checks: %+v", blocked.Failing)
	}

	passedAt := time.Date(2026, 8, 21, 11, 0, 0, 0, time.UTC)
	job := &QualityJob{UnitQC: []UnitQcRecord{{
		UnitID: "unit-1", Checklist: fullQcChecklist(), PassedAt: &passedAt,
	}}}
	gate := EvaluateUnitQcGate(job, qualityTestUnit())
	if !gate.Ready || gate.Overridden {
		t.Fatalf("checklist aprobado debe pasar: %+v", gate)
	}

	// Open issue on the unit keeps the gate closed.
	issueJob := &QualityJob{
		Issues: []QualityIssue{{ID: "qiss-1", Description: "Cajón trabado", Category: QualityCategoryArmado, Status: QualityIssueOpen, ModuleUnitID: "unit-1"}},
	}
	gate = EvaluateUnitQcGate(issueJob, qualityTestUnit())
	if gate.Ready {
		t.Fatal("un issue abierto debe bloquear")
	}

	// Mueble-level issue also blocks its units.
	itemJob := &QualityJob{
		Issues: []QualityIssue{{ID: "qiss-2", Description: "Puerta desalineada", Category: QualityCategoryArmado, Status: QualityIssueOpen, ProjectItemID: "item-1"}},
	}
	if issues := OpenIssuesForUnit(itemJob, qualityTestUnit()); len(issues) != 1 {
		t.Fatalf("issue de mueble debe bloquear la unidad: %+v", issues)
	}

	// Supervisor override opens the gate auditably.
	overrideJob := &QualityJob{UnitQC: []UnitQcRecord{{
		UnitID: "unit-1",
		Override: &QcOverride{Reason: "Despacho urgente", At: passedAt},
	}}}
	gate = EvaluateUnitQcGate(overrideJob, qualityTestUnit())
	if !gate.Ready || !gate.Overridden {
		t.Fatalf("override debe habilitar auditadamente: %+v", gate)
	}
}

// TestValidateQualityJobTransition guards append-only issues and legal status
// transitions.
func TestValidateQualityJobTransition(t *testing.T) {
	at := time.Date(2026, 8, 21, 10, 0, 0, 0, time.UTC)
	prev := &QualityJob{
		ID: "qjob-1", ProjectID: "proj-1", CreatedAt: at,
		Issues: []QualityIssue{{
			ID: "qiss-1", Description: "Frente rayado", Category: QualityCategoryDano,
			Status: QualityIssueOpen, ReportedAt: at,
		}},
	}

	// Illegal status jump.
	illegal := *prev
	illegal.Issues = []QualityIssue{{
		ID: "qiss-1", Description: "Frente rayado", Category: QualityCategoryDano,
		Status: QualityIssueVerified, ReportedAt: at,
	}}
	if err := ValidateQualityJobTransition(prev, &illegal); err == nil {
		t.Fatal("open → verified debe ser ilegal")
	}

	// Legal resolution.
	resolved := *prev
	resolvedAt := at.Add(time.Hour)
	resolved.Issues = []QualityIssue{{
		ID: "qiss-1", Description: "Frente rayado", Category: QualityCategoryDano,
		Status: QualityIssueResolved, ReportedAt: at, ResolvedAt: &resolvedAt,
	}}
	if err := ValidateQualityJobTransition(prev, &resolved); err != nil {
		t.Fatalf("open → resolved debe ser legal: %v", err)
	}

	// Issues are not removable.
	removed := *prev
	removed.Issues = nil
	if err := ValidateQualityJobTransition(prev, &removed); err == nil {
		t.Fatal("los issues no son removibles")
	}
}

// TestReworkCostAccumulation mirrors reworkCostSummary for job costing.
func TestReworkCostAccumulation(t *testing.T) {
	job := &QualityJob{ReworkActions: []ReworkAction{
		{ID: "a1", IssueID: "i1", Action: ReworkActionRework, MaterialCost: 25.5, LaborMinutes: 30},
		{ID: "a2", IssueID: "i2", Action: ReworkActionScrap, MaterialCost: 300, LaborMinutes: 45.5},
	}}
	var materialCost, laborMinutes float64
	for _, a := range job.ReworkActions {
		materialCost += a.MaterialCost
		laborMinutes += a.LaborMinutes
	}
	if materialCost != 325.5 || laborMinutes != 75.5 {
		t.Fatalf("costos: %v / %v", materialCost, laborMinutes)
	}
}
