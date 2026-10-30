package domain_test

import (
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1418 review B3: the Go trust boundary validates offset formulas
// fail-closed — empty, wrong charset and (at resolve time) evaluation
// errors never persist.
func TestValidateAxisPlacementOffsetFormula(t *testing.T) {
	cases := []struct {
		name    string
		formula string
		wantErr string
	}{
		{"vacía", "   ", "empty offsetFormula"},
		{"charset inválido", "PW; DROP TABLE", "invalid offsetFormula"},
		{"símbolos fuera de vocabulario", "PW/2$", "invalid offsetFormula"},
	}
	for _, tc := range cases {
		f := tc.formula
		err := domain.ValidateAxisPlacement("x", domain.AssemblyAxisPlacement{
			Ref:           domain.AxisRefMin,
			OffsetMm:      0,
			OffsetFormula: &f,
		})
		if err == nil {
			t.Fatalf("%s: expected error, got nil", tc.name)
		}
		if !strings.Contains(err.Error(), tc.wantErr) {
			t.Fatalf("%s: expected %q in error, got %v", tc.name, tc.wantErr, err)
		}
	}

	valid := "PW/2 - 100"
	if err := domain.ValidateAxisPlacement("x", domain.AssemblyAxisPlacement{
		Ref: domain.AxisRefMin, OffsetMm: 0, OffsetFormula: &valid,
	}); err != nil {
		t.Fatalf("fórmula válida rechazada: %v", err)
	}
}

// #1421 rev (pasada de perfección): el resultado de la fórmula tiene la MISMA
// cota de magnitud que offsetMm, y la validación de charset acepta whitespace
// total (paridad TS).
func TestValidateAxisPlacementOffsetFormulaWhitespace(t *testing.T) {
	f := "PW\t\n/ 2"
	if err := domain.ValidateAxisPlacement("x", domain.AssemblyAxisPlacement{
		Ref: domain.AxisRefMin, OffsetMm: 0, OffsetFormula: &f,
	}); err != nil {
		t.Fatalf("whitespace total debe pasar validación: %v", err)
	}
}
