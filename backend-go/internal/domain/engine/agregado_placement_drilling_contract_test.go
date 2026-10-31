package engine_test

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

// #1413 F131 — shared TS↔Go contract: a hardwarePlacement authored on an
// AGREGADO component drills its `agr-*` host part on the definition-default
// (release) path — the same transport TS projectDrilling resolves for the
// KDT/MPR exports (agregadoPlacementDrilling.contract.test.ts). The fixture
// hardware HER-PLACA-BIS carries the static Go machining profile
// (authoringManualMachiningProfiles: screw pilot Ø5×10) mirrored by the TS
// catalog profile, so the frozen hole is byte-identical in both runtimes:
// face=anchorFace, x/y=relativePosition.
func TestAgregadoPlacementDrillingSharedContract(t *testing.T) {
	raw, err := os.ReadFile("../../../../contracts/agregadoPlacementDrilling.contract.json")
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var fixture struct {
		SchemaID string `json:"schemaId"`
		Hardware struct {
			ID   string `json:"id"`
			Code string `json:"code"`
			Name string `json:"name"`
		} `json:"hardware"`
		Agregado domain.Agregado `json:"agregado"`
		// The fixture's instance slice is runtime-neutral (TS camelCase); map
		// it here like every shared fixture does.
		AgregadoInstances []struct {
			AgregadoID string `json:"agregadoId"`
			Quantity   int    `json:"quantity"`
		} `json:"agregadoInstances"`
		Expected struct {
			HostPartIDUnit0 string `json:"hostPartIdUnit0"`
			HostPartIDUnit1 string `json:"hostPartIdUnit1"`
			Hole            struct {
				Face       string  `json:"face"`
				XMm        float64 `json:"xMm"`
				YMm        float64 `json:"yMm"`
				DiameterMm float64 `json:"diameterMm"`
				DepthMm    float64 `json:"depthMm"`
				Type       string  `json:"type"`
			} `json:"hole"`
		} `json:"expected"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("parse fixture: %v", err)
	}
	if fixture.SchemaID != "granete.agregado-placement-drilling.v1" {
		t.Fatalf("unexpected fixture schema %q", fixture.SchemaID)
	}

	catalog := domain.Catalog{
		Components: []domain.Component{{
			ID: "comp-agr-lateral", Code: "COM-AGR-LAT", Name: "Lateral de Cajón (agregado F131)",
			Placement: domain.PlacementInterno, GeometryKind: "rectangular_board",
			LengthMm: 500, WidthMm: 120, ThicknessMm: 18,
			OptionRoles: []string{"INTERIOR"}, Active: true,
		}},
		Agregados: []domain.Agregado{fixture.Agregado},
		Hardware: []domain.Hardware{{
			ID: fixture.Hardware.ID, Code: fixture.Hardware.Code, Name: fixture.Hardware.Name,
			Unit: domain.UnitPiece, Active: true,
		}},
		Materials: []domain.MaterialBoard{{
			ID: "mat-f131", Code: "MDF-F131", Name: "MDF F131", ThicknessMm: 18, Active: true,
		}},
		Structures: []domain.Structure{{
			ID: "struct-agr-f131", Code: "STRUCT-AGR-F131", Name: "Cuerpo F131", Active: true,
		}},
	}
	instances := make([]domain.ModuleAgregadoInstance, 0, len(fixture.AgregadoInstances))
	for _, inst := range fixture.AgregadoInstances {
		instances = append(instances, domain.ModuleAgregadoInstance{
			AgregadoID: inst.AgregadoID, Quantity: inst.Quantity,
		})
	}
	module := domain.Module{
		ID: "mod-agr-f131", Code: "MOD-AGR-F131", Name: "Módulo con agregado F131",
		WidthMm: 600, HeightMm: 720, DepthMm: 590,
		StructureID: "struct-agr-f131",
		Agregados:   instances,
	}

	resolved, err := engine.ResolveAuthoringLayout(engine.AuthoringResolveInput{
		Module:        module,
		Catalog:       catalog,
		Dims:          &engine.LayoutDims{WidthMm: 600, HeightMm: 720, DepthMm: 590},
		OptionChoices: map[string]string{"INTERIOR": "mat-f131"},
		PrecisionMm:   0.01,
	})
	if err != nil {
		t.Fatalf("authoring resolve: %v", err)
	}
	if len(resolved.StructuralIssues) != 0 {
		t.Fatalf("resolve rejected the definition-default state: %+v", resolved.StructuralIssues)
	}
	for _, issue := range resolved.ValidationIssues {
		if issue.Severity == domain.IssueSeverityError {
			t.Fatalf("resolve validation error %s: %s", issue.Code, issue.Message)
		}
	}

	// The release freeze derives DRILL from exactly these operations; one
	// manual placement per unit → one operation per unit host, no more.
	operationsByHost := map[string][]engine.ResolvedMachiningOperation{}
	for _, operation := range resolved.Machining.Operations {
		operationsByHost[operation.HostComponentInstanceID] = append(
			operationsByHost[operation.HostComponentInstanceID], operation)
	}
	for _, host := range []string{fixture.Expected.HostPartIDUnit0, fixture.Expected.HostPartIDUnit1} {
		operations := operationsByHost[host]
		if len(operations) != 1 {
			t.Fatalf("host %s carries %d machining operations, want exactly 1", host, len(operations))
		}
		operation := operations[0]
		if operation.Provenance.SourceKind != "manualHardwarePlacement" {
			t.Fatalf("host %s operation provenance %q, want manualHardwarePlacement", host, operation.Provenance.SourceKind)
		}
		if len(operation.Holes) != 1 {
			t.Fatalf("host %s operation freezes %d holes, want exactly 1", host, len(operation.Holes))
		}
		hole := operation.Holes[0]
		want := fixture.Expected.Hole
		if hole.Face != want.Face || hole.XMm != want.XMm || hole.YMm != want.YMm ||
			hole.DiameterMm != want.DiameterMm || hole.DepthMm != want.DepthMm || hole.Type != want.Type {
			t.Fatalf("host %s hole %+v does not match the shared contract %+v", host, hole, want)
		}
		delete(operationsByHost, host)
	}
	if len(operationsByHost) != 0 {
		t.Fatalf("unexpected machining operations on non-contract hosts: %v", operationsByHost)
	}
}
