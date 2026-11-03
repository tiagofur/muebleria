package engine

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// TestAgregadoRoleResolutionParity consumes the SAME
// contracts/agregadoRoleResolution.contract.json as the TS twin
// (packages/domain/src/agregadoRoleResolution.contract.test.ts).
// #1472 — parity contract for resolving effective agregado ID by role.
func TestAgregadoRoleResolutionParity(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "contracts", "agregadoRoleResolution.contract.json"))
	if err != nil {
		t.Fatalf("read contract: %v", err)
	}

	var contract struct {
		SchemaID string `json:"schemaId"`
		Cases    []struct {
			Name               string                       `json:"name"`
			Instance           domain.ModuleAgregadoInstance `json:"instance"`
			OptionChoices      map[string]string            `json:"optionChoices"`
			ExpectedAgregadoID string                       `json:"expectedAgregadoId"`
		} `json:"cases"`
	}

	if err := json.Unmarshal(raw, &contract); err != nil {
		t.Fatalf("parse contract: %v", err)
	}

	if contract.SchemaID != "granete.agregadoRoleResolution.v1" {
		t.Fatalf("unexpected contract schemaId %q", contract.SchemaID)
	}

	if len(contract.Cases) < 7 {
		t.Fatalf("contract must define at least 7 frozen cases, got %d", len(contract.Cases))
	}

	for _, c := range contract.Cases {
		got := ResolveEffectiveAgregadoID(c.Instance, c.OptionChoices)
		if got != c.ExpectedAgregadoID {
			t.Errorf("[%s] ResolveEffectiveAgregadoID() = %q, want %q", c.Name, got, c.ExpectedAgregadoID)
		}
	}
}
