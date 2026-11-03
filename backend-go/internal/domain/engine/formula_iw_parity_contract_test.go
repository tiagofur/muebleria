package engine

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// TestFormulaIWParity consumes the SAME
// contracts/formulaIWParity.contract.json as the TS twin
// (packages/domain/src/formulaIWParity.contract.test.ts).
// #1470 — parity contract for the derived interior-width variable IW
// (IW = parentW − 2*T): expectations are frozen; if one engine drifts, align
// the engine — never the fixture.
func TestFormulaIWParity(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "contracts", "formulaIWParity.contract.json"))
	if err != nil {
		t.Fatalf("read contract: %v", err)
	}
	var contract struct {
		SchemaID string `json:"schemaId"`
		Dims     struct {
			W  int `json:"W"`
			H  int `json:"H"`
			D  int `json:"D"`
			PW int `json:"PW"`
			PH int `json:"PH"`
			PD int `json:"PD"`
			T  int `json:"T"`
		} `json:"dims"`
		Cases []struct {
			Name       string `json:"name"`
			Formula    string `json:"formula"`
			N          int    `json:"N"`
			I          int    `json:"i"`
			ExpectedMm int    `json:"expectedMm"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &contract); err != nil {
		t.Fatalf("parse contract: %v", err)
	}
	if contract.SchemaID != "granete.formulaIWParity.v1" {
		t.Fatalf("unexpected contract schemaId %q", contract.SchemaID)
	}
	if len(contract.Cases) < 6 {
		t.Fatalf("contract must define at least 6 frozen cases, got %d", len(contract.Cases))
	}
	for _, c := range contract.Cases {
		dims := formulaDims{
			W:  contract.Dims.W,
			H:  contract.Dims.H,
			D:  contract.Dims.D,
			PW: contract.Dims.PW,
			PH: contract.Dims.PH,
			PD: contract.Dims.PD,
			T:  contract.Dims.T,
			N:  c.N,
			I:  c.I,
		}
		v, err := evaluatePartFormula(c.Formula, dims)
		if err != nil {
			t.Fatalf("%s: evaluatePartFormula(%q): %v", c.Name, c.Formula, err)
		}
		if v != c.ExpectedMm {
			t.Fatalf("%s: evaluatePartFormula(%q) = %d, want %d", c.Name, c.Formula, v, c.ExpectedMm)
		}
	}
}

// #1470 — the PW→W fallback mirror: with no parent width (PW=0, the Go shape
// of the TS "undefined" case) IW derives from W, and with no thickness (T=0,
// the agregado envelope shape) IW collapses to the parent width — exactly what
// writing PW-2*T resolves to there. The TS twin lives in engine.test.ts.
func TestEvaluatePartFormulaInteriorWidthFallbacks(t *testing.T) {
	cases := []struct {
		name  string
		dims  formulaDims
		want  int
	}{
		{"no parent width falls back to W", formulaDims{W: 564, H: 18, D: 482, T: 18}, 528},
		{"no thickness collapses IW to the parent width", formulaDims{W: 600, H: 720, D: 560, PW: 600, PH: 720, PD: 560}, 600},
	}
	for _, tc := range cases {
		v, err := evaluatePartFormula("IW", tc.dims)
		if err != nil {
			t.Fatalf("%s: evaluatePartFormula(IW): %v", tc.name, err)
		}
		if v != tc.want {
			t.Fatalf("%s: IW = %d, want %d", tc.name, v, tc.want)
		}
	}
}
