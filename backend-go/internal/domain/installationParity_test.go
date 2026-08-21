package domain

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// TestInstallationStatusesFixtureParity validates parity with
// contracts/installationStatuses.json (OC-070..OC-074).
func TestInstallationStatusesFixtureParity(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "installationStatuses.json"))
	if err != nil {
		t.Fatalf("read contracts/installationStatuses.json: %v", err)
	}
	var fixture struct {
		Comment                    string              `json:"comment"`
		JobStatuses                []string            `json:"jobStatuses"`
		VisitStatuses              []string            `json:"visitStatuses"`
		VisitResults               []string            `json:"visitResults"`
		FieldIssueStatuses         []string            `json:"fieldIssueStatuses"`
		FieldIssueStatusTransitions map[string][]string `json:"fieldIssueStatusTransitions"`
		PunchItemStatuses          []string            `json:"punchItemStatuses"`
		PunchItemStatusTransitions map[string][]string `json:"punchItemStatusTransitions"`
		PunchSeverities            []string            `json:"punchSeverities"`
		CloseoutCheckCodes         []string            `json:"closeoutCheckCodes"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("parse contracts/installationStatuses.json: %v", err)
	}

	assertSetParity := func(name string, fixtureValues []string, goMap map[string]struct{}, isValid func(string) bool) {
		goValues := make(map[string]struct{}, len(goMap))
		for k := range goMap {
			goValues[k] = struct{}{}
		}
		for _, v := range fixtureValues {
			if _, ok := goValues[v]; !ok {
				t.Errorf("fixture %s %q missing from Go", name, v)
			}
			delete(goValues, v)
			if isValid != nil && !isValid(v) {
				t.Errorf("fixture %s %q must be valid in Go", name, v)
			}
		}
		for extra := range goValues {
			t.Errorf("Go %s has %q not present in the shared fixture", name, extra)
		}
	}

	assertSetParity("visitStatuses", fixture.VisitStatuses, installationVisitStatuses, IsValidInstallationVisitStatus)
	assertSetParity("visitResults", fixture.VisitResults, installationVisitResults, IsValidInstallationVisitResult)
	assertSetParity("fieldIssueStatuses", fixture.FieldIssueStatuses, fieldIssueStatuses, IsValidFieldIssueStatus)
	assertSetParity("punchItemStatuses", fixture.PunchItemStatuses, punchItemStatuses, IsValidPunchItemStatus)
	assertSetParity("punchSeverities", fixture.PunchSeverities, punchSeverities, IsValidPunchSeverity)

	for _, status := range fixture.JobStatuses {
		switch InstallationJobStatus(status) {
		case InstallationJobPlanned, InstallationJobInProgress, InstallationJobCompleted:
		default:
			t.Errorf("fixture jobStatus %q missing from Go", status)
		}
	}

	for from, targets := range fixture.FieldIssueStatusTransitions {
		goTargets := fieldIssueStatusTransitions[FieldIssueStatus(from)]
		if len(goTargets) != len(targets) {
			t.Fatalf("field issue transitions from %q: fixture has %v, Go has %v", from, targets, goTargets)
		}
		for _, to := range targets {
			if !CanTransitionFieldIssueStatus(FieldIssueStatus(from), FieldIssueStatus(to)) {
				t.Errorf("field issue transition %q → %q from fixture must be legal in Go", from, to)
			}
		}
	}

	for _, code := range fixture.CloseoutCheckCodes {
		if _, ok := closeoutCheckLabels[CloseoutCheckCode(code)]; !ok {
			t.Errorf("fixture closeoutCheckCode %q missing from Go", code)
		}
	}
}

func installationTestJob() *InstallationJob {
	at := time.Date(2026, 9, 1, 9, 0, 0, 0, time.UTC)
	return &InstallationJob{
		ID:        "ijob-1",
		ProjectID: "proj-1",
		Visits: []InstallationVisit{
			{ID: "ivis-1", Date: "2026-09-01", Crew: []string{"Juan"}, Status: InstallationVisitScheduled, CreatedAt: at},
		},
		FieldIssues: []FieldIssue{},
		PunchItems:  []PunchItem{},
		CreatedAt:   at,
	}
}

func installationTestUnits(installed bool) []ModuleUnitExecution {
	status := ModuleUnitStatusLoaded
	if installed {
		status = ModuleUnitStatusInstalled
	}
	return []ModuleUnitExecution{{
		ID: "unit-1", ProjectID: "proj-1", ProjectItemID: "item-1", UnitIndex: 1,
		ProductionRevision: "rev-1", Status: status,
	}}
}

// TestInstallationJobTransitionValidation mirrors the TS action validations:
// append-only entities, legal transitions, non-revocable closeout facts.
func TestInstallationJobTransitionValidation(t *testing.T) {
	prev := installationTestJob()

	scheduledToInProgress := installationTestJob()
	scheduledToInProgress.Visits[0].Status = InstallationVisitInProgress
	if err := ValidateInstallationJobTransition(prev, scheduledToInProgress); err != nil {
		t.Fatalf("scheduled → in_progress must pass: %v", err)
	}

	skipToCompleted := installationTestJob()
	skipToCompleted.Visits[0].Status = InstallationVisitCompleted
	skipToCompleted.Visits[0].Result = InstallationVisitResultFinished
	if err := ValidateInstallationJobTransition(prev, skipToCompleted); err == nil {
		t.Fatal("scheduled → completed (skip) must be rejected")
	}

	removed := installationTestJob()
	removed.Visits = nil
	if err := ValidateInstallationJobTransition(prev, removed); err == nil {
		t.Fatal("removing a visit must be rejected")
	}

	illegalIssue := installationTestJob()
	illegalIssue.FieldIssues = []FieldIssue{{ID: "fiss-1", Description: "d", Status: FieldIssueVerified, ReportedAt: time.Now()}}
	if err := ValidateInstallationJobTransition(prev, illegalIssue); err == nil {
		t.Fatal("creating an issue directly as verified must be rejected (open first)")
	}

	closedWithoutEvidence := installationTestJob()
	closedWithoutEvidence.PunchItems = []PunchItem{{ID: "pnch-1", Description: "d", Owner: "o", Severity: PunchSeverityMajor, Status: PunchItemClosed, OpenedAt: time.Now()}}
	if err := ValidateInstallationJobTransition(prev, closedWithoutEvidence); err == nil {
		t.Fatal("closing a punch without resolution evidence must be rejected")
	}
}

// TestCloseoutGatesOC074 mirrors the TS closeout gate tests: installed units
// alone never close a project (OC-074).
func TestCloseoutGatesOC074(t *testing.T) {
	job := installationTestJob()
	units := installationTestUnits(true)

	checks, ready := EvaluateCloseoutReadiness(units, nil, job, false)
	if ready {
		t.Fatal("open visit must block closeout readiness")
	}
	visitsCheck := findCloseoutCheck(t, checks, CloseoutCheckVisitsCompleted)
	if visitsCheck.Passed {
		t.Fatal("visits_completed gate must fail with an open visit")
	}

	job.Visits[0].Status = InstallationVisitCompleted
	job.Visits[0].Result = InstallationVisitResultFinished
	checks, ready = EvaluateCloseoutReadiness(units, nil, job, true)
	if ready {
		t.Fatal("missing client sign-off must block project close")
	}
	if findCloseoutCheck(t, checks, CloseoutCheckClientSignOff).Passed {
		t.Fatal("client_signoff gate must fail before sign-off is recorded")
	}

	signedAt := time.Now()
	job.Closeout = &ClientCloseout{SignedOffBy: "María", SignedOffAt: signedAt}
	_, ready = EvaluateCloseoutReadiness(units, nil, job, true)
	if !ready {
		t.Fatal("installed units + closed visits + sign-off must be ready")
	}

	withBlocker := installationTestJob()
	withBlocker.Visits[0].Status = InstallationVisitCompleted
	withBlocker.Visits[0].Result = InstallationVisitResultFinished
	withBlocker.PunchItems = []PunchItem{{ID: "pnch-1", Description: "Falta zócalo", Owner: "Carlos", Severity: PunchSeverityCritical, IsBlocker: true, Status: PunchItemOpen, OpenedAt: time.Now()}}
	if _, ready := EvaluateCloseoutReadiness(units, nil, withBlocker, false); ready {
		t.Fatal("open blocking punch must block closeout even with all units installed (OC-074)")
	}
	failing := ValidateCloseoutEventAppend(units, nil, withBlocker, "client_signed_off")
	if len(failing) == 0 {
		t.Fatal("raw client_signed_off event append must be blocked by OC-074 gates")
	}

	notInstalled := installationTestUnits(false)
	if _, ready := EvaluateCloseoutReadiness(notInstalled, nil, job, false); ready {
		t.Fatal("units not installed must block closeout")
	}
}

func findCloseoutCheck(t *testing.T, checks []CloseoutCheck, code CloseoutCheckCode) CloseoutCheck {
	t.Helper()
	for _, c := range checks {
		if c.Code == code {
			return c
		}
	}
	t.Fatalf("closeout check %s not found", code)
	return CloseoutCheck{}
}

// TestInstallationUnitsSummaryLegacyFallback mirrors the TS legacy fallback.
func TestInstallationUnitsSummaryLegacyFallback(t *testing.T) {
	mode, installed, total := InstallationUnitsSummary(nil, []ProjectItem{
		{ID: "item-1", FloorStatus: "installed"},
		{ID: "item-2", FloorStatus: "loaded"},
	})
	if mode != "legacy" || installed != 1 || total != 2 {
		t.Fatalf("legacy summary mismatch: %s %d/%d", mode, installed, total)
	}

	mode, installed, total = InstallationUnitsSummary(nil, nil)
	if mode != "none" || installed != 0 || total != 0 {
		t.Fatalf("none summary mismatch: %s %d/%d", mode, installed, total)
	}

	mode, _, _ = InstallationUnitsSummary(installationTestUnits(true), nil)
	if mode != "physical" {
		t.Fatalf("physical units must win over legacy: got %s", mode)
	}
}

// TestDeriveInstallationJobStatus mirrors the TS derivation.
func TestDeriveInstallationJobStatus(t *testing.T) {
	if got := DeriveInstallationJobStatus(nil, false); got != InstallationJobPlanned {
		t.Fatalf("no job → planned, got %s", got)
	}
	if got := DeriveInstallationJobStatus(installationTestJob(), false); got != InstallationJobPlanned {
		t.Fatalf("only scheduled visits → planned, got %s", got)
	}
	inProgress := installationTestJob()
	inProgress.Visits[0].Status = InstallationVisitInProgress
	if got := DeriveInstallationJobStatus(inProgress, false); got != InstallationJobInProgress {
		t.Fatalf("started visit → in_progress, got %s", got)
	}
	if got := DeriveInstallationJobStatus(inProgress, true); got != InstallationJobCompleted {
		t.Fatalf("installation_completed event → completed, got %s", got)
	}
}
