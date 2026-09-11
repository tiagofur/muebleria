package domain

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

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
		AdapterID:                   "granete-ptx",
		AdapterVersion:              "1.1.0",
		AdapterImplementationDigest: "b56de3839ac9a0da94aa9c90b62d56cad19aefea27d365ff934cac46c1f70d8b",
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

	sel.AdapterID = "woodwop-mpr"
	sel.AdapterVersion = "0.1.0"
	sel.AdapterImplementationDigest = "4ae7d19fb29c555c5de0346d06ae88cbc47bfa043b80222b9d427705c5c7e782"
	blockers := ResolveMachineOutputBlockers(catalog, sel)
	if len(blockers) != 1 || blockers[0].Code != "SERIALIZER_NOT_IMPLEMENTED" {
		t.Fatalf("expected SERIALIZER_NOT_IMPLEMENTED blocker, got %v", blockers)
	}
}
