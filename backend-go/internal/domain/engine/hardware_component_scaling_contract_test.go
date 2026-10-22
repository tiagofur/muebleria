package engine

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// hcsExpectedHardware is the frozen resolved-demand row: hardwareId → quantity.
// A dropped per-copy line (N=0) simply does not appear.
type hcsExpectedHardware struct {
	HardwareID string  `json:"hardwareId"`
	Quantity   float64 `json:"quantity"`
}

// TestHardwareComponentScalingSharedContract consumes the SAME
// contracts/hardwareComponentScaling.contract.json as the TS twin
// (packages/domain/src/hardwareComponentScaling.contract.test.ts).
// #1394 — parity contract: a module hardware line linked to a catalog
// component (HardwareLine.ComponentID) is PER-COPY — the resolved BOM
// multiplies its quantity by the component's effective copies after bindings
// (the same N of #1383/#1384); zero copies drop the demand. Unlinked lines
// stay fixed. Expectations are frozen; if one engine drifts, align the
// engine — never the fixture.
func TestHardwareComponentScalingSharedContract(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "contracts", "hardwareComponentScaling.contract.json"))
	if err != nil {
		t.Fatalf("read contract: %v", err)
	}
	var fixture struct {
		SchemaID      string            `json:"schemaId"`
		OptionChoices map[string]string `json:"optionChoices"`
		Dims          struct {
			WidthMm  int `json:"widthMm"`
			HeightMm int `json:"heightMm"`
			DepthMm  int `json:"depthMm"`
		} `json:"dims"`
		Catalog    pbCatalog                             `json:"catalog"`
		Parameters []domain.FurnitureParameterDefinition `json:"parameters"`
		Cases      []struct {
			Name               string                `json:"name"`
			Values             map[string]any        `json:"values"`
			ExpectedBoardParts int                   `json:"expectedBoardParts"`
			ExpectedHardware   []hcsExpectedHardware `json:"expectedHardware"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("parse contract: %v", err)
	}
	if fixture.SchemaID != "granete.hardwareComponentScaling.v1" {
		t.Fatalf("unexpected contract schemaId %q", fixture.SchemaID)
	}
	if len(fixture.Cases) < 4 {
		t.Fatalf("contract must freeze at least N=0/1/4/8, got %d cases", len(fixture.Cases))
	}

	loader := plinthFixture{Catalog: fixture.Catalog}
	catalog := loader.toDomainCatalog()
	module := catalog.Modules[0]
	module.ParameterDefinitions = fixture.Parameters

	for _, c := range fixture.Cases {
		c := c
		t.Run(c.Name, func(t *testing.T) {
			if issues := domain.ValidateModuleFurnitureParameterConsumers(module, catalog); len(issues) != 0 {
				t.Fatalf("fixture binding consumers invalid: %v", issues)
			}
			values, issues, err := domain.EvaluateFurnitureParameters(fixture.Parameters, c.Values)
			if err != nil || len(issues) != 0 {
				t.Fatalf("parameter evaluation failed: %v %v", err, issues)
			}
			prepared := ApplyEvaluatedComponentBindings(module, values)
			bom, err := ResolveBomWithContext(prepared, fixture.OptionChoices, catalog, nil, "", nil,
				&domain.ItemCustomDims{WidthMm: fixture.Dims.WidthMm, HeightMm: fixture.Dims.HeightMm, DepthMm: fixture.Dims.DepthMm})
			if err != nil {
				t.Fatalf("resolveBom: %v", err)
			}
			if len(bom.BoardParts) != c.ExpectedBoardParts {
				t.Fatalf("board parts = %d, want %d", len(bom.BoardParts), c.ExpectedBoardParts)
			}
			got := make([]hcsExpectedHardware, 0, len(bom.HardwareLines))
			for _, line := range bom.HardwareLines {
				got = append(got, hcsExpectedHardware{HardwareID: line.HardwareID, Quantity: line.Quantity})
			}
			sort.Slice(got, func(i, j int) bool {
				if got[i].HardwareID != got[j].HardwareID {
					return got[i].HardwareID < got[j].HardwareID
				}
				return got[i].Quantity < got[j].Quantity
			})
			want := append([]hcsExpectedHardware(nil), c.ExpectedHardware...)
			sort.Slice(want, func(i, j int) bool {
				if want[i].HardwareID != want[j].HardwareID {
					return want[i].HardwareID < want[j].HardwareID
				}
				return want[i].Quantity < want[j].Quantity
			})
			if len(got) != len(want) {
				t.Fatalf("resolved hardware lines = %+v, want %+v", got, want)
			}
			for i := range want {
				if got[i] != want[i] {
					t.Fatalf("resolved hardware lines = %+v, want %+v", got, want)
				}
			}
		})
	}
}

// TestHardwareComponentScalingReleaseUnit proves the PRODUCTION RELEASE
// reflects the same scaled quantity: the release unit applies the item's
// parameters (the #483 authority) and resolves its BOM through the same
// resolveBomCommon path the quote uses.
func TestHardwareComponentScalingReleaseUnit(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "contracts", "hardwareComponentScaling.contract.json"))
	if err != nil {
		t.Fatalf("read contract: %v", err)
	}
	var fixture struct {
		OptionChoices map[string]string `json:"optionChoices"`
		Dims          struct {
			WidthMm  int `json:"widthMm"`
			HeightMm int `json:"heightMm"`
			DepthMm  int `json:"depthMm"`
		} `json:"dims"`
		Catalog    pbCatalog                             `json:"catalog"`
		Parameters []domain.FurnitureParameterDefinition `json:"parameters"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("parse contract: %v", err)
	}
	loader := plinthFixture{Catalog: fixture.Catalog}
	catalog := loader.toDomainCatalog()
	module := catalog.Modules[0]
	module.ParameterDefinitions = fixture.Parameters
	catalog.Modules = []domain.Module{module}

	for _, n := range []int{0, 1, 4, 8} {
		item := domain.DesignRevisionItem{
			ID:                    "item-hcs",
			FurnitureInstanceID:   "inst-hcs",
			FurnitureDefinitionID: module.ID,
			Parameters: map[string]any{
				"entrepanos": float64(n),
				"widthMm":    float64(fixture.Dims.WidthMm),
				"heightMm":   float64(fixture.Dims.HeightMm),
				"depthMm":    float64(fixture.Dims.DepthMm),
			},
			MaterialChoices: fixture.OptionChoices,
		}
		unit, err := ResolveReleaseUnit(item, catalog)
		if err != nil {
			t.Fatalf("N=%d: ResolveReleaseUnit: %v", n, err)
		}
		wantSupports := float64(4 * n)
		supports := 0.0
		unlinked := 0.0
		for _, line := range unit.BOM.HardwareLines {
			switch line.HardwareID {
			case "hw-soporte":
				supports = line.Quantity
			case "hw-tirador":
				unlinked = line.Quantity
			default:
				t.Fatalf("N=%d: unexpected hardware %q in release BOM", n, line.HardwareID)
			}
		}
		if supports != wantSupports {
			t.Fatalf("N=%d: release soportes = %v, want %v", n, supports, wantSupports)
		}
		if unlinked != 2 {
			t.Fatalf("N=%d: release tirador = %v, want fixed 2", n, unlinked)
		}
	}
}
