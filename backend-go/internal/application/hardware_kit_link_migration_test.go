package application

// #1437 — the kit link backfill: exact wizard-suffix convention, dry-run by
// default, fail-closed report of everything ignored, never a guess.

import (
	"context"
	"fmt"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

type hardwareKitLinkStubStore struct {
	hardwares []domain.Hardware
	applied   [][2]string // partID, kitID
	failApply map[string]error
	// forceFalse simulates the race: the UPDATE affects 0 rows because the
	// part got linked between ListHardwares and the write.
	forceFalse map[string]bool
}

func (s *hardwareKitLinkStubStore) ListHardwares(context.Context) ([]domain.Hardware, error) {
	return s.hardwares, nil
}

func (s *hardwareKitLinkStubStore) ApplyHardwareKitLink(_ context.Context, partID, kitID string) (bool, error) {
	if s.failApply != nil {
		if err := s.failApply[partID]; err != nil {
			return false, err
		}
	}
	if s.forceFalse[partID] {
		return false, nil
	}
	for i := range s.hardwares {
		if s.hardwares[i].ID == partID {
			if !unlinked(s.hardwares[i]) {
				return false, nil
			}
			kit := kitID
			s.hardwares[i].KitHardwareID = &kit
			s.applied = append(s.applied, [2]string{partID, kitID})
			return true, nil
		}
	}
	return false, fmt.Errorf("parte inexistente %s", partID)
}

func kitLinkFixture() []domain.Hardware {
	kit := "kit-494"
	return []domain.Hardware{
		{ID: kit, Code: "49402645", Name: "Set corredera Hafele", Unit: "set", Active: true},
		{ID: "p1", Code: "49402645-FIJ-I", Name: "Guía fija izq", Unit: "piece", Active: true},
		{ID: "p2", Code: "49402645-FIJ-D", Name: "Guía fija der", Unit: "piece", Active: true},
		{ID: "p3", Code: "49402645-MOV-I", Name: "Móvil izq", Unit: "piece", Active: true},
		{ID: "p4", Code: "49402645-MOV-D", Name: "Móvil der", Unit: "piece", Active: true},
		{ID: "libre", Code: "BIS-CL110", Name: "Bisagra suelta", Unit: "piece", Active: true},
	}
}

func TestMigrateHardwareKitLinksDryRunProposesWithoutWriting(t *testing.T) {
	store := &hardwareKitLinkStubStore{hardwares: kitLinkFixture()}
	report, err := MigrateHardwareKitLinks(context.Background(), store, "org-1", false)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if !report.DryRun {
		t.Fatal("must report dry-run")
	}
	if len(report.Linked) != 4 {
		t.Fatalf("linked = %d, want 4 (got %+v)", len(report.Linked), report.Linked)
	}
	if report.KitsWithParts != 1 {
		t.Fatalf("kits_with_parts = %d, want 1", report.KitsWithParts)
	}
	if len(store.applied) != 0 {
		t.Fatal("dry-run must not write")
	}
	for _, change := range report.Linked {
		if change.KitCode != "49402645" {
			t.Fatalf("unexpected kit: %+v", change)
		}
		want := "49402645" + change.Suffix
		if change.PartCode != want {
			t.Fatalf("part code %q must be kit code + suffix %q", change.PartCode, want)
		}
	}
}

func TestMigrateHardwareKitLinksApplyWritesAndReadsBack(t *testing.T) {
	store := &hardwareKitLinkStubStore{hardwares: kitLinkFixture()}
	report, err := MigrateHardwareKitLinks(context.Background(), store, "org-1", true)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if report.DryRun {
		t.Fatal("apply run must not report dry-run")
	}
	if len(report.Linked) != 4 || len(store.applied) != 4 {
		t.Fatalf("applied = %d, linked = %d, want 4/4", len(store.applied), len(report.Linked))
	}
	for _, change := range report.Linked {
		if change.KitID != "kit-494" {
			t.Fatalf("unexpected kit id: %+v", change)
		}
	}
	for _, h := range store.hardwares {
		if h.Code == "BIS-CL110" && !unlinked(h) {
			t.Fatal("unrelated hardware must stay unlinked")
		}
	}
}

func TestMigrateHardwareKitLinksIgnoresAlreadyLinked(t *testing.T) {
	fixture := kitLinkFixture()
	other := "kit-otro"
	fixture[1].KitHardwareID = &other // 49402645-FIJ-I ya vinculada a otro juego
	store := &hardwareKitLinkStubStore{hardwares: fixture}
	report, err := MigrateHardwareKitLinks(context.Background(), store, "org-1", true)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if len(report.Linked) != 3 {
		t.Fatalf("linked = %d, want 3", len(report.Linked))
	}
	found := false
	for _, skip := range report.Ignored {
		if skip.PartCode == "49402645-FIJ-I" {
			found = true
		}
	}
	if !found {
		t.Fatalf("already-linked part must be reported ignored: %+v", report.Ignored)
	}
}

func TestMigrateHardwareKitLinksReportsNearMisses(t *testing.T) {
	fixture := kitLinkFixture()
	fixture = append(fixture,
		domain.Hardware{ID: "orfano", Code: "ORFAN-COPA", Name: "Copa huérfana", Unit: "piece", Active: true},
		domain.Hardware{ID: "nokit", Code: "BIS-CL110-BRAZO", Name: "Brazo sin set", Unit: "piece", Active: true},
	)
	store := &hardwareKitLinkStubStore{hardwares: fixture}
	report, err := MigrateHardwareKitLinks(context.Background(), store, "org-1", false)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	reasons := map[string]string{}
	for _, skip := range report.Ignored {
		reasons[skip.PartCode] = skip.Reason
	}
	if _, ok := reasons["ORFAN-COPA"]; !ok {
		t.Fatalf("orphan suffix part must be reported: %+v", report.Ignored)
	}
	if _, ok := reasons["BIS-CL110-BRAZO"]; !ok {
		t.Fatalf("suffix over non-set base must be reported: %+v", report.Ignored)
	}
	// BIS-CL110 is a piece, not a set — its -BRAZO sibling must NOT link.
	for _, change := range report.Linked {
		if change.PartCode == "BIS-CL110-BRAZO" {
			t.Fatal("non-set base must never produce a link")
		}
	}
}

func TestMigrateHardwareKitLinksSetPartIsNotAKit(t *testing.T) {
	kit := "kit-a"
	other := "kit-b"
	fixture := []domain.Hardware{
		{ID: kit, Code: "SET-A", Name: "Set A", Unit: "set", Active: true},
		{ID: "anidado", Code: "SET-B", Name: "Set que es parte", Unit: "set", Active: true, KitHardwareID: &other},
		{ID: "parte-b", Code: "SET-B-PIEZA", Name: "Parte del set B", Unit: "piece", Active: true},
	}
	store := &hardwareKitLinkStubStore{hardwares: fixture}
	report, err := MigrateHardwareKitLinks(context.Background(), store, "org-1", false)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	for _, change := range report.Linked {
		if change.KitID == "anidado" {
			t.Fatal("a set that is itself a part must not be a kit candidate")
		}
	}
}

func TestMigrateHardwareKitLinksApplyRaceMovesToIgnored(t *testing.T) {
	store := &hardwareKitLinkStubStore{
		hardwares:  kitLinkFixture(),
		forceFalse: map[string]bool{"p2": true}, // 49402645-FIJ-D pierde la carrera
	}
	report, err := MigrateHardwareKitLinks(context.Background(), store, "org-1", true)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if len(report.Linked) != 3 {
		t.Fatalf("linked = %d, want 3", len(report.Linked))
	}
	found := false
	for _, skip := range report.Ignored {
		if skip.PartCode == "49402645-FIJ-D" {
			found = true
		}
	}
	if !found {
		t.Fatalf("raced part must be reported ignored: %+v", report.Ignored)
	}
}
