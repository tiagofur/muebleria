package engine_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

type agregadoParityFixture struct {
	SchemaID  string `json:"schemaId"`
	Comment   string `json:"comment"`
	Catalog   domain.Catalog
	Scenarios []struct {
		Name                        string                          `json:"name"`
		ModuleAgregados             []domain.ModuleAgregadoInstance `json:"moduleAgregados"`
		OptionChoices               map[string]string               `json:"optionChoices"`
		ExpectedEffectiveAgregadoID string                          `json:"expectedEffectiveAgregadoId"`
		ExpectedPartIDs             []string                        `json:"expectedPartIds"`
		ExpectedHardwareIDs         []string                        `json:"expectedHardwareIds"`
	} `json:"scenarios"`
}

func TestAgregadoEngineResolutionParitySharedContract(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "contracts", "agregadoEngineResolutionParity.contract.json"))
	if err != nil {
		t.Fatalf("failed reading shared contract: %v", err)
	}

	var fixture agregadoParityFixture
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("failed unmarshaling shared contract: %v", err)
	}

	if fixture.SchemaID != "granete.agregadoEngineResolutionParity.v1" {
		t.Fatalf("unexpected schemaId: %s", fixture.SchemaID)
	}

	for _, s := range fixture.Scenarios {
		t.Run(s.Name, func(t *testing.T) {
			mod := domain.Module{
				ID:            "mod-test",
				Code:          "MOD-TEST",
				Name:          "Módulo de Prueba",
				StructureID:   "st-base",
				WidthMm:       600,
				HeightMm:      720,
				DepthMm:       560,
				Agregados:     s.ModuleAgregados,
				Components:    []domain.ComponentInstance{},
				HardwareLines: []domain.HardwareLine{},
				BoardParts:    []domain.BoardPart{},
			}

			bom, err := engine.ResolveBomWithContext(mod, s.OptionChoices, fixture.Catalog, nil, "", nil, nil)
			if err != nil {
				t.Fatalf("ResolveBomWithContext unexpected error: %v", err)
			}

			partIDs := make([]string, 0, len(bom.BoardParts))
			for _, p := range bom.BoardParts {
				partIDs = append(partIDs, p.ID)
			}
			if !reflect.DeepEqual(partIDs, s.ExpectedPartIDs) {
				t.Errorf("partIds mismatch:\ngot:  %v\nwant: %v", partIDs, s.ExpectedPartIDs)
			}

			hwIDs := make([]string, 0, len(bom.HardwareLines))
			for _, h := range bom.HardwareLines {
				hwIDs = append(hwIDs, h.HardwareID)
			}
			if !reflect.DeepEqual(hwIDs, s.ExpectedHardwareIDs) {
				t.Errorf("hardwareIds mismatch:\ngot:  %v\nwant: %v", hwIDs, s.ExpectedHardwareIDs)
			}
		})
	}

	t.Run("fail-closed when role has no choice and instance has no fallback", func(t *testing.T) {
		brokenMod := domain.Module{
			ID:          "mod-broken",
			Code:        "MOD-BROKEN",
			Name:        "Módulo Roto",
			StructureID: "st-base",
			WidthMm:     600,
			HeightMm:    720,
			DepthMm:     560,
			Agregados: []domain.ModuleAgregadoInstance{
				{
					ID:         "inst-1",
					AgregadoID: "",
					OptionRole: "SISTEMA_CAJON",
					Quantity:   1,
				},
			},
			Components:    []domain.ComponentInstance{},
			HardwareLines: []domain.HardwareLine{},
			BoardParts:    []domain.BoardPart{},
		}

		_, err := engine.ResolveBomWithContext(brokenMod, map[string]string{"FRONT": "mat-18"}, fixture.Catalog, nil, "", nil, nil)
		if err == nil {
			t.Fatal("expected error, got nil")
		}
		if !strings.Contains(err.Error(), "has no selection and instance has no fallback") {
			t.Errorf("unexpected error message: %v", err)
		}
	})
}
