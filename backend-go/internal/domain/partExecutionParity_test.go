package domain

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// TestPartOperationTypesFixtureParity validates parity with contracts/partOperationTypes.json
func TestPartOperationTypesFixtureParity(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "partOperationTypes.json"))
	if err != nil {
		t.Fatalf("read contracts/partOperationTypes.json: %v", err)
	}
	var fixture struct {
		Comment                   string   `json:"comment"`
		OperationTypes            []string `json:"operationTypes"`
		OperationStatuses         []string `json:"operationStatuses"`
		RejectedOperationTypes    []string `json:"rejectedOperationTypes"`
		RejectedOperationStatuses []string `json:"rejectedOperationStatuses"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("parse contracts/partOperationTypes.json: %v", err)
	}

	goTypes := make(map[string]struct{}, len(partOperationTypes))
	for k := range partOperationTypes {
		goTypes[k] = struct{}{}
	}
	for _, typ := range fixture.OperationTypes {
		if _, ok := goTypes[typ]; !ok {
			t.Errorf("fixture operationType %q missing from Go partOperationTypes", typ)
		}
		delete(goTypes, typ)
	}
	for extra := range goTypes {
		t.Errorf("Go partOperationTypes has %q not present in the shared fixture", extra)
	}

	for _, rejected := range fixture.RejectedOperationTypes {
		if IsValidPartOperationType(rejected) {
			t.Errorf("fixture rejected operationType %q must not be valid in Go", rejected)
		}
	}

	goStatuses := make(map[string]struct{}, len(partOperationStatuses))
	for k := range partOperationStatuses {
		goStatuses[k] = struct{}{}
	}
	for _, st := range fixture.OperationStatuses {
		if _, ok := goStatuses[st]; !ok {
			t.Errorf("fixture operationStatus %q missing from Go partOperationStatuses", st)
		}
		delete(goStatuses, st)
	}
	for extra := range goStatuses {
		t.Errorf("Go partOperationStatuses has %q not present in the shared fixture", extra)
	}

	for _, rejected := range fixture.RejectedOperationStatuses {
		if IsValidPartOperationStatus(rejected) {
			t.Errorf("fixture rejected operationStatus %q must not be valid in Go", rejected)
		}
	}
}

// TestModuleUnitStatusesFixtureParity validates parity with contracts/moduleUnitStatuses.json
func TestModuleUnitStatusesFixtureParity(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "moduleUnitStatuses.json"))
	if err != nil {
		t.Fatalf("read contracts/moduleUnitStatuses.json: %v", err)
	}
	var fixture struct {
		Comment              string   `json:"comment"`
		UnitStatuses         []string `json:"unitStatuses"`
		RejectedUnitStatuses []string `json:"rejectedUnitStatuses"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("parse contracts/moduleUnitStatuses.json: %v", err)
	}

	goUnitStatuses := make(map[string]struct{}, len(moduleUnitStatuses))
	for k := range moduleUnitStatuses {
		goUnitStatuses[k] = struct{}{}
	}
	for _, st := range fixture.UnitStatuses {
		if _, ok := goUnitStatuses[st]; !ok {
			t.Errorf("fixture unitStatus %q missing from Go moduleUnitStatuses", st)
		}
		delete(goUnitStatuses, st)
	}
	for extra := range goUnitStatuses {
		t.Errorf("Go moduleUnitStatuses has %q not present in the shared fixture", extra)
	}

	for _, rejected := range fixture.RejectedUnitStatuses {
		if IsValidModuleUnitStatus(rejected) {
			t.Errorf("fixture rejected unitStatus %q must not be valid in Go", rejected)
		}
	}
}
