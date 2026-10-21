package engine

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// TestSpatialNDistributionParity consumes the SAME
// contracts/spatialNDistributionParity.contract.json as the TS twin
// (packages/domain/src/spatialNDistributionParity.contract.test.ts).
// #1393/#1383 — parity contract for the spatial copy-count variable N:
// expectations are frozen; if one engine drifts, align the engine — never
// the fixture.
func TestSpatialNDistributionParity(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "contracts", "spatialNDistributionParity.contract.json"))
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
	if contract.SchemaID != "granete.spatialNDistributionParity.v1" {
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
			t.Fatalf("%s: evaluatePartFormula(%q, N=%d, i=%d): %v", c.Name, c.Formula, c.N, c.I, err)
		}
		if v != c.ExpectedMm {
			t.Fatalf("%s: evaluatePartFormula(%q, N=%d, i=%d) = %d, want %d", c.Name, c.Formula, c.N, c.I, v, c.ExpectedMm)
		}
	}
}
