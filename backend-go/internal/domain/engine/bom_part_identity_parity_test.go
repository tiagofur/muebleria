package engine

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// TestBomPartIdentityParityContract pins the #995 K3-parity naming rule: the
// Go BOM and the TS BOM (packages/domain/src/engine/bomPartIdentityParity.test.ts)
// must name composed part ids IDENTICALLY — structure copies `st-<id>-copy-N`,
// module copies `mod-<id>-copy-N`, agregado units with the #388 instance tag.
// composeFrozenDrilling joins these ids against the frozen release program; a
// divergence here kills every composed release export.
func TestBomPartIdentityParityContract(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "contracts", "bomPartIdentityParity.contract.json"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var fixture struct {
		StructureComponents []struct {
			ComponentID string `json:"componentId"`
			Quantity    int    `json:"quantity"`
		} `json:"structureComponents"`
		ModuleComponents []struct {
			ComponentID string `json:"componentId"`
			Quantity    int    `json:"quantity"`
		} `json:"moduleComponents"`
		Agregado struct {
			ID         string `json:"id"`
			Components []struct {
				ComponentID string `json:"componentId"`
				Quantity    int    `json:"quantity"`
			} `json:"components"`
		} `json:"agregado"`
		// The fixture speaks the TS wire shape (camelCase); the domain struct's
		// json tags are snake_case, so the instances come through their own
		// mirror and get built explicitly below.
		AgregadoInstances []struct {
			ID         string `json:"id"`
			AgregadoID string `json:"agregadoId"`
			Quantity   int    `json:"quantity"`
		} `json:"agregadoInstances"`
		ExpectedPartIDs []string `json:"expectedPartIds"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("decode fixture: %v", err)
	}

	edges := []domain.EdgeAssignment{
		{Side: "L1", Enabled: false}, {Side: "L2", Enabled: false},
		{Side: "W1", Enabled: false}, {Side: "W2", Enabled: false},
	}
	component := func(id, role string) domain.Component {
		return domain.Component{
			ID: id, Code: id, Name: id,
			Placement:    domain.ComponentPlacement("interno"),
			GeometryKind: "rectangular_board",
			LengthMm:     700, WidthMm: 500, ThicknessMm: 18,
			DefaultEdges: edges,
			OptionRoles:  []string{"BODY"},
			Active:       true,
		}
	}
	catalog := domain.Catalog{
		Materials: []domain.MaterialBoard{{
			ID: "mat-body", Code: "MAT-BODY", Name: "Tablero paridad",
			WidthMm: 1830, LengthMm: 2440, ThicknessMm: 18,
			GrainDefault: true, BoardPrice: 100, WastePercent: 0, CostPerM2: 100,
			Active: true,
		}},
		OptionGroups: []domain.OptionGroup{{
			ID: "og-body", Code: "BODY", Name: "Cuerpo", Kind: "board", Required: true,
			OptionIDs: []string{"mat-body"},
		}},
		Components: []domain.Component{
			component("comp-lateral", "BODY"),
			component("comp-puerta", "BODY"),
			component("comp-frente-cajon", "BODY"),
		},
		Structures: []domain.Structure{{
			ID: "struct-a", Code: "ST-A", Name: "Cuerpo paridad",
			Components: []domain.ComponentInstance{},
			Active:     true,
		}},
		Agregados: []domain.Agregado{{
			ID: fixture.Agregado.ID, Code: "CAJ", Name: "Cajones",
			WidthMm: 500, HeightMm: 120, DepthMm: 500,
		}},
	}
	for _, entry := range fixture.StructureComponents {
		catalog.Structures[0].Components = append(catalog.Structures[0].Components,
			domain.ComponentInstance{ComponentID: entry.ComponentID, Quantity: entry.Quantity})
	}
	for _, entry := range fixture.Agregado.Components {
		catalog.Agregados[0].Components = append(catalog.Agregados[0].Components,
			domain.ComponentInstance{ComponentID: entry.ComponentID, Quantity: entry.Quantity})
	}

	module := domain.Module{
		ID: "mod-a", Code: "MOD-A", Name: "Módulo paridad",
		StructureID: "struct-a",
		WidthMm:     600, HeightMm: 720, DepthMm: 560,
		BaseMode:      "none",
		Components:    []domain.ComponentInstance{},
		HardwareLines: []domain.HardwareLine{},
		BoardParts:    []domain.BoardPart{},
	}
	for _, entry := range fixture.ModuleComponents {
		module.Components = append(module.Components,
			domain.ComponentInstance{ComponentID: entry.ComponentID, Quantity: entry.Quantity})
	}
	for _, entry := range fixture.AgregadoInstances {
		module.Agregados = append(module.Agregados, domain.ModuleAgregadoInstance{
			ID: entry.ID, AgregadoID: entry.AgregadoID, Quantity: entry.Quantity,
		})
	}

	bom, err := ResolveBomWithContext(module, map[string]string{"BODY": "mat-body"}, catalog, nil, "", nil,
		&domain.ItemCustomDims{WidthMm: 600, HeightMm: 720, DepthMm: 560})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}

	ids := make([]string, 0, len(bom.BoardParts))
	for _, part := range bom.BoardParts {
		ids = append(ids, part.ID)
	}
	if len(ids) != len(fixture.ExpectedPartIDs) {
		t.Fatalf("expected %d parts, got %d: %v", len(fixture.ExpectedPartIDs), len(ids), ids)
	}
	for i, want := range fixture.ExpectedPartIDs {
		if ids[i] != want {
			t.Fatalf("part[%d] = %q, want %q (full: %v)", i, ids[i], want, ids)
		}
	}
}
