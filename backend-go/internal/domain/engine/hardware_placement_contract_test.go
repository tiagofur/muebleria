package engine

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1046 aceptación #6 / #1210 — the shared TS↔Go parity contract: the SAME
// contracts/hardwarePlacementResolution.contract.json the vitest suite
// consumes pins (a) the placement-role resolution statuses with the
// concrete-wins precedence and (b) the positions-win demand rule with
// instance-quantity multiplication and bulk dedupe. One authority, every
// stack.
func TestHardwarePlacementResolutionContract(t *testing.T) {
	fixturePath := filepath.Join("..", "..", "..", "..", "contracts", "hardwarePlacementResolution.contract.json")
	raw, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var fixture struct {
		Schema   int `json:"schema"`
		Hardware []struct {
			ID string `json:"id"`
		} `json:"hardware"`
		ResolutionCases []struct {
			Name           string                   `json:"name"`
			GroupRequired  bool                     `json:"groupRequired"`
			Placement      domain.HardwarePlacement `json:"placement"`
			Choices        map[string]string        `json:"choices"`
			ExpectedStatus string                   `json:"expectedStatus"`
			ExpectedHWID   string                   `json:"expectedHardwareId"`
		} `json:"resolutionCases"`
		DemandCases []struct {
			Name              string                     `json:"name"`
			ComponentQuantity int                        `json:"componentQuantity"`
			Placements        []domain.HardwarePlacement `json:"placements"`
			BulkLines         []struct {
				ID         string  `json:"id"`
				Quantity   float64 `json:"quantity"`
				OptionRole string  `json:"optionRole"`
				HardwareID string  `json:"hardwareId"`
			} `json:"bulkLines"`
			Choices            map[string]string `json:"choices"`
			ExpectedPositioned []struct {
				HardwareID string  `json:"hardwareId"`
				Quantity   float64 `json:"quantity"`
			} `json:"expectedPositioned"`
			ExpectedBulkKept    []string `json:"expectedBulkKept"`
			ExpectedBulkDropped []string `json:"expectedBulkDropped"`
		} `json:"demandCases"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("parse fixture: %v", err)
	}
	if fixture.Schema != 1 {
		t.Fatalf("schema = %d, want 1", fixture.Schema)
	}

	catalogFor := func(groupRequired bool) domain.Catalog {
		catalog := domain.Catalog{
			Hardware: []domain.Hardware{},
			OptionGroups: []domain.OptionGroup{{
				ID: "og-contract", Code: "BISAGRA", Name: "Bisagras", Kind: "hardware",
				Required: groupRequired, OptionIDs: []string{"hw-bisagra-cl", "hw-bisagra-eco"},
			}},
		}
		for _, hw := range fixture.Hardware {
			catalog.Hardware = append(catalog.Hardware, domain.Hardware{
				ID: hw.ID, Code: hw.ID, Name: hw.ID, Unit: domain.UnitPiece, Active: true,
			})
		}
		return catalog
	}

	for _, testCase := range fixture.ResolutionCases {
		t.Run("resolution: "+testCase.Name, func(t *testing.T) {
			catalog := catalogFor(testCase.GroupRequired)
			out, err := resolvePlacementHardwareIDs(
				[]domain.HardwarePlacement{testCase.Placement},
				testCase.Choices, catalog, "contract",
			)

			switch testCase.ExpectedStatus {
			case "invalid":
				if err == nil || !strings.Contains(err.Error(), "neither hardwareId nor optionRole") {
					t.Fatalf("identity-less placement must fail closed, got err=%v", err)
				}
			case "unresolved":
				// Optional group (fixture groupRequired=false): the placement
				// stays out, never fabricated.
				if err != nil {
					t.Fatalf("unresolved optional placement must drop, got err=%v", err)
				}
				if len(out) != 0 {
					t.Fatalf("unresolved optional placement must be dropped: %+v", out)
				}
			default:
				if err != nil {
					t.Fatalf("resolve: %v", err)
				}
				if len(out) != 1 || out[0].HardwareID != testCase.ExpectedHWID {
					t.Fatalf("resolved = %+v, want hardwareId %q", out, testCase.ExpectedHWID)
				}
			}
		})
	}

	for _, testCase := range fixture.DemandCases {
		t.Run("demand: "+testCase.Name, func(t *testing.T) {
			catalog := catalogFor(true)
			bulkLines := make([]domain.HardwareLine, 0, len(testCase.BulkLines))
			for _, line := range testCase.BulkLines {
				bulkLines = append(bulkLines, domain.HardwareLine{
					ID: line.ID, Quantity: line.Quantity,
					OptionRole: line.OptionRole, HardwareID: line.HardwareID,
				})
			}
			module := domain.Module{
				Components: []domain.ComponentInstance{{
					ComponentID: "comp-contract", Quantity: testCase.ComponentQuantity,
					Overrides: &domain.ComponentInstanceOverrides{HardwarePlacements: testCase.Placements},
				}},
				HardwareLines: bulkLines,
			}

			counts, positioned, err := collectPlacementHardwareDemand(module, catalog, testCase.Choices)
			if err != nil {
				t.Fatalf("collect placement demand: %v", err)
			}
			if len(positioned) != len(testCase.ExpectedPositioned) {
				t.Fatalf("positioned lines = %+v, want %d", positioned, len(testCase.ExpectedPositioned))
			}
			for _, expected := range testCase.ExpectedPositioned {
				if counts[expected.HardwareID] != int(expected.Quantity) {
					t.Fatalf("counts[%s] = %d, want %v", expected.HardwareID, counts[expected.HardwareID], expected.Quantity)
				}
				found := false
				for _, line := range positioned {
					if line.HardwareID == expected.HardwareID &&
						line.OptionRole == "POSITIONED" && line.Quantity == expected.Quantity {
						found = true
					}
				}
				if !found {
					t.Fatalf("POSITIONED line for %s missing or wrong: %+v", expected.HardwareID, positioned)
				}
			}

			// The positions-win dedupe: a module bulk line whose RESOLVED id is
			// positioned is dropped; every other line is kept.
			for _, line := range bulkLines {
				resolvedID := resolvedBulkHardwareID(line, testCase.Choices)
				_, positionedHw := counts[resolvedID]
				droppedListed := containsString(testCase.ExpectedBulkDropped, line.ID)
				keptListed := containsString(testCase.ExpectedBulkKept, line.ID)
				if positionedHw && !droppedListed {
					t.Fatalf("bulk line %s resolves to a positioned hardware but is not listed as dropped", line.ID)
				}
				if !positionedHw && !keptListed {
					t.Fatalf("bulk line %s is not positioned but is not listed as kept", line.ID)
				}
			}
		})
	}
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
