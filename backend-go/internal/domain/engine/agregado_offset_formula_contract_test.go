package engine_test

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

// #1418: parity test for member anchor offset formulas against the shared
// contract fixture — X resolves against PW, the formula result rounds to
// whole mm, and the anchor (ref) contributes the base.
func TestAgregadoOffsetFormulaSharedContract(t *testing.T) {
	data, err := os.ReadFile("../../../../contracts/agregadoOffsetFormula.contract.json")
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var fixture struct {
		Agregado domain.Agregado `json:"agregado"`
		Cases    []struct {
			WidthMm   float64 `json:"widthMm"`
			ExpectedX float64 `json:"expectedX"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatalf("unmarshal fixture: %v", err)
	}

	for _, c := range fixture.Cases {
		resolved, err := engine.ResolveAgregadoAssembly(fixture.Agregado, engine.AssemblyResolutionParams{
			WidthMm: c.WidthMm, DepthMm: 500, HeightMm: 150,
		})
		if err != nil {
			t.Fatalf("width %g: resolve: %v", c.WidthMm, err)
		}
		if len(resolved.RigidMembers) != 1 {
			t.Fatalf("width %g: expected 1 member", c.WidthMm)
		}
		gotX := resolved.RigidMembers[0].LocalTransform.TranslationMm[0]
		if gotX != c.ExpectedX {
			t.Fatalf("width %g: expected x=%g, got %g", c.WidthMm, c.ExpectedX, gotX)
		}
	}
}
