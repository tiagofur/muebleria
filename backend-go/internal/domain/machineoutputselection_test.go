package domain

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

func machineOutputString(value string) *string { return &value }

func TestMachineOutputCatalogParity(t *testing.T) {
	raw, err := os.ReadFile("../../../contracts/machineOutputCatalog.contract.json")
	if err != nil {
		t.Fatalf("read contract fixture: %v", err)
	}
	var fixture MachineOutputCatalog
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("parse contract fixture: %v", err)
	}
	embedded, err := ParseMachineOutputCatalog()
	if err != nil {
		t.Fatalf("parse embedded catalog: %v", err)
	}
	if !reflect.DeepEqual(fixture, embedded) {
		t.Fatalf("embedded catalog diverged from contracts/machineOutputCatalog.contract.json")
	}
}

func validCuttingSelection() MachineOutputSelection {
	return MachineOutputSelection{
		Operation:                   OperationCutting,
		MachineProfileID:            "client-a-machine-b-hpp250",
		MachineProfileRevisionID:    "r1",
		OutputProfileID:             "ptx-generic",
		OutputProfileRevisionID:     "r1",
		OutputProfileDigest:         machineOutputString("d05d279e6c1e40ccb1fc9995d5e5d6c1b54112af5b62e91ba2275912872d4595"),
		AdapterID:                   "granete-ptx",
		AdapterVersion:              "1.4.0",
		AdapterImplementationDigest: "8c13f67bfc8f1354984b90bbea1a3719b91905b62d63af570eec3d83a52a7916",
	}
}

func TestValidateMachineOutputSelectionAcceptsCompatibleTuple(t *testing.T) {
	catalog, _ := ParseMachineOutputCatalog()
	if err := ValidateMachineOutputSelection(catalog, validCuttingSelection()); err != nil {
		t.Fatalf("expected valid tuple, got %v", err)
	}
}

func TestValidateMachineOutputSelectionRejectsIncompatibleTuples(t *testing.T) {
	catalog, _ := ParseMachineOutputCatalog()

	mutate := func(f func(*MachineOutputSelection)) MachineOutputSelection {
		sel := validCuttingSelection()
		f(&sel)
		return sel
	}

	rejections := []struct {
		name string
		sel  MachineOutputSelection
	}{
		{"family mismatch", mutate(func(s *MachineOutputSelection) {
			s.OutputProfileID = "saw-homag"
		})},
		{"unknown machine", mutate(func(s *MachineOutputSelection) { s.MachineProfileID = "hp-999" })},
		{"stale machine revision", mutate(func(s *MachineOutputSelection) { s.MachineProfileRevisionID = "r0" })},
		{"stale profile revision", mutate(func(s *MachineOutputSelection) { s.OutputProfileRevisionID = "r0" })},
		{"adapter digest mismatch", mutate(func(s *MachineOutputSelection) { s.AdapterImplementationDigest = "deadbeef" })},
		{"adapter version mismatch", mutate(func(s *MachineOutputSelection) { s.AdapterVersion = "9.9.9" })},
		{"machine does not cover operation", mutate(func(s *MachineOutputSelection) { s.Operation = OperationMachining })},
		{"empty adapter id", mutate(func(s *MachineOutputSelection) { s.AdapterID = " " })},
		{"unknown operation", mutate(func(s *MachineOutputSelection) { s.Operation = "painting" })},
	}

	for _, rejection := range rejections {
		if err := ValidateMachineOutputSelection(catalog, rejection.sel); err == nil {
			t.Errorf("%s: expected rejection, got nil", rejection.name)
		}
	}
}

func TestResolveMachineOutputBlockersSurfacesMissingSerializer(t *testing.T) {
	catalog, _ := ParseMachineOutputCatalog()
	sel := validCuttingSelection()
	if blockers := ResolveMachineOutputBlockers(catalog, sel); len(blockers) != 0 {
		t.Fatalf("implemented serializer must not block, got %v", blockers)
	}

	sel.AdapterID = "homag-saw"
	sel.AdapterVersion = "0.1.0"
	sel.AdapterImplementationDigest = "c6278fffdde1296eb508772d7a240c06695bba8b4bcac2e59b64761b38a74e9e"
	blockers := ResolveMachineOutputBlockers(catalog, sel)
	if len(blockers) != 1 || blockers[0].Code != "SERIALIZER_NOT_IMPLEMENTED" {
		t.Fatalf("expected SERIALIZER_NOT_IMPLEMENTED blocker, got %v", blockers)
	}
}

func validKdtMachiningSelection() MachineOutputSelection {
	return MachineOutputSelection{
		Operation:                   OperationMachining,
		MachineProfileID:            "client-b-machine-c-kdt-flexdrill1200",
		MachineProfileRevisionID:    "r1",
		OutputProfileID:             "kdt-flexdrill-1200",
		OutputProfileRevisionID:     "r2",
		OutputProfileDigest:         machineOutputString("d11d92c35fb481e158cebc336a6c7c419c39b89366e5939dea39787b1bc8b77e"),
		AdapterID:                   "granete-kdt",
		AdapterVersion:              "0.2.0",
		AdapterImplementationDigest: "b9b824c7f86b16603f4d90e278d5920d26b816fdcff9007804ae64e3f0a5d17f",
	}
}

// #1005 K2: the kdt tuple validates against the catalog with the r2
// serializer revision implemented — structural blockers are empty (the
// generation FLOW is #1005 K3, not a catalog blocker). There is never a
// fallback to another profile.
func TestKdtSelectionValidatesWithImplementedSerializer(t *testing.T) {
	catalog, err := ParseMachineOutputCatalog()
	if err != nil {
		t.Fatalf("parse embedded catalog: %v", err)
	}
	if err := ValidateMachineOutputSelection(catalog, validKdtMachiningSelection()); err != nil {
		t.Fatalf("expected valid kdt tuple, got %v", err)
	}
	if blockers := ResolveMachineOutputBlockers(catalog, validKdtMachiningSelection()); len(blockers) != 0 {
		t.Fatalf("implemented serializer must not block, got %v", blockers)
	}

	// A kdt profile is machining-only: selecting it against cutting fails closed.
	sel := validKdtMachiningSelection()
	sel.Operation = OperationCutting
	if err := ValidateMachineOutputSelection(catalog, sel); err == nil {
		t.Fatalf("kdt profile must not validate for the cutting operation")
	}

	// A stale digest never validates, even with the right ids.
	stale := validKdtMachiningSelection()
	stale.OutputProfileDigest = machineOutputString("deadbeef")
	if err := ValidateMachineOutputSelection(catalog, stale); err == nil {
		t.Fatalf("stale kdt digest must be rejected")
	}
}
