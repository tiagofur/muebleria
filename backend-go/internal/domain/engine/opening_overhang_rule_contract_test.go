package engine

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

// #1138 — paridad compartida Go del blob de la regla de rebase inferior. El
// MISMO fixture lo consume el dominio TS
// (packages/domain/src/openingOverhangRule.contract.test.ts): version
// estricta, entero positivo, claves desconocidas = error, ausencia = sin
// regla (BLOCKED veraz, jamás un default).
func TestOpeningOverhangRuleContract(t *testing.T) {
	fixturePath := filepath.Join("..", "..", "..", "..", "contracts", "openingOverhangRule.contract.json")
	raw, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var fixture struct {
		Schema   int    `json:"schema"`
		Contract string `json:"contract"`
		Cases    []struct {
			Name      string          `json:"name"`
			Overrides json.RawMessage `json:"overrides"`
			Expected  *struct {
				Version    int `json:"version"`
				OverhangMm int `json:"overhangMm"`
			} `json:"expected"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("decode fixture: %v", err)
	}
	if fixture.Schema != 1 || fixture.Contract != OpeningFrontContract {
		t.Fatalf("fixture contract mismatch: schema=%d contract=%s", fixture.Schema, fixture.Contract)
	}

	for _, tc := range fixture.Cases {
		t.Run(tc.Name, func(t *testing.T) {
			rule, err := ParseOpeningOverhangRule(tc.Overrides)
			if err != nil {
				t.Fatalf("parse rejected a fixture case: %v", err)
			}
			if tc.Expected == nil {
				if rule != nil {
					t.Fatalf("rule = %+v, want nil", rule)
				}
				return
			}
			if rule == nil {
				t.Fatalf("rule = nil, want %+v", tc.Expected)
			}
			if rule.Version != tc.Expected.Version || rule.OverhangMm != tc.Expected.OverhangMm {
				t.Fatalf("rule = %+v, want %+v", rule, tc.Expected)
			}
		})
	}
}

func TestOpeningOverhangRuleMalformedFailsClosed(t *testing.T) {
	cases := []struct {
		name string
		blob string
	}{
		{"versión futura no se interpreta", `{"opening.bottom-overhang":{"version":2,"overhangMm":40}}`},
		{"overhangMm cero", `{"opening.bottom-overhang":{"version":1,"overhangMm":0}}`},
		{"overhangMm negativo", `{"opening.bottom-overhang":{"version":1,"overhangMm":-40}}`},
		{"overhangMm no entero", `{"opening.bottom-overhang":{"version":1,"overhangMm":40.5}}`},
		{"overhangMm ausente", `{"opening.bottom-overhang":{"version":1}}`},
		{"overhangMm no numérico", `{"opening.bottom-overhang":{"version":1,"overhangMm":"40"}}`},
		{"clave desconocida", `{"opening.bottom-overhang":{"version":1,"overhangMm":40,"bodyShiftMm":10}}`},
		{"blob no objeto", `{"opening.bottom-overhang":"regla"}`},
		{"blob lista", `{"opening.bottom-overhang":[40]}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if rule, err := ParseOpeningOverhangRule(json.RawMessage(tc.blob)); err == nil {
				t.Fatalf("malformed rule parsed as %+v — must fail closed", rule)
			}
		})
	}
}

// #1138: nil input and nil blob read as NO rule (the BLOCKED-verbatim path),
// never as a zero default.
func TestOpeningOverhangRuleAbsentReadsNil(t *testing.T) {
	for i, overrides := range []json.RawMessage{
		nil,
		json.RawMessage("null"),
		json.RawMessage(`{}`),
		json.RawMessage(fmt.Sprintf(`{%q:{%q:1}}`, "opening.capabilities", "version")),
	} {
		if rule, err := ParseOpeningOverhangRule(overrides); err != nil || rule != nil {
			t.Fatalf("case %d: rule = %+v err = %v, want nil/nil", i, rule, err)
		}
	}
}
