package engine_test

import (
	"encoding/json"
	"os"
	"strings"
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

// #1418 review B3: evaluation errors at resolve time fail with an explicit
// error (never a silent fallback to the numeric offset).
func TestResolveAgregadoAssemblyOffsetFormulaEvaluationError(t *testing.T) {
	formula := "PW/(PW-1)"
	agregado := domain.Agregado{
		ID:   "agr-formula-err",
		Code: "FORMULA-ERR",
		Name: "Fórmula con división por cero",
		RigidMembers: []domain.AgregadoRigidMember{
			{
				MemberID: "m",
				Role:     "r",
				Source: domain.RigidMemberSource{
					Kind:  domain.RigidMemberSourceFixed,
					Fixed: &domain.FixedHardwareSource{HardwareID: "hw-x"},
				},
				Placement: domain.AssemblyAnchorRule{
					X: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetFormula: &formula},
					Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 0},
					Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 0},
				},
				BOMRole: domain.BOMRoleNonPurchasing,
			},
		},
	}
	_, err := engine.ResolveAgregadoAssembly(agregado, engine.AssemblyResolutionParams{
		WidthMm: 1, DepthMm: 500, HeightMm: 150,
	})
	if err == nil {
		t.Fatal("expected resolve error for PW/(PW-1) at width 1 (division by zero), got nil")
	}
	if !strings.Contains(err.Error(), "offset formula") {
		t.Fatalf("expected offset formula error context, got: %v", err)
	}
}

// #1422 perfección (review B2): the RESULT of an offset formula carries the
// same magnitude bound as offsetMm — a regression deleting the bound check
// would fail this test (mirror of the TS case).
func TestResolveAgregadoAssemblyOffsetFormulaOutOfBounds(t *testing.T) {
	formula := "PW*99999999"
	agregado := domain.Agregado{
		ID:   "agr-formula-bounds",
		Code: "FORMULA-BOUNDS",
		Name: "Fórmula fuera de cota",
		RigidMembers: []domain.AgregadoRigidMember{
			{
				MemberID: "m",
				Role:     "r",
				Source: domain.RigidMemberSource{
					Kind:  domain.RigidMemberSourceFixed,
					Fixed: &domain.FixedHardwareSource{HardwareID: "hw-x"},
				},
				Placement: domain.AssemblyAnchorRule{
					X: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetFormula: &formula},
					Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 0},
					Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 0},
				},
				BOMRole: domain.BOMRoleNonPurchasing,
			},
		},
	}
	_, err := engine.ResolveAgregadoAssembly(agregado, engine.AssemblyResolutionParams{
		WidthMm: 400, DepthMm: 500, HeightMm: 150,
	})
	if err == nil {
		t.Fatal("expected out-of-bounds error for PW*99999999, got nil")
	}
	if !strings.Contains(err.Error(), "out of bounds") {
		t.Fatalf("expected out of bounds error, got: %v", err)
	}
}
