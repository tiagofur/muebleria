package engine_test

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

// #1493 slice 3: paridad TS↔Go de la cotización del kit por bahía. Autoridad
// numérica única: contracts/fixtures/variantKitQuoteParity.contract.json —
// ambos lados CONSTRUYEN la receta desde el JSON (patrón del pilot canónico).
// El espejo TS vive en packages/domain/src/variantKitQuoteParity.test.ts.

type variantKitQuoteFixture struct {
	Heights []struct {
		Code               string  `json:"code"`
		NominalDimensionMm float64 `json:"nominalDimensionMm"`
		HardwareID         string  `json:"hardwareId"`
		KitHardwareID      string  `json:"kitHardwareId"`
	} `json:"heights"`
	Module struct {
		WidthMm        int     `json:"widthMm"`
		HeightMm       int     `json:"heightMm"`
		DepthMm        int     `json:"depthMm"`
		BottomFraction float64 `json:"bottomFraction"`
		TopCount       int     `json:"topCount"`
	} `json:"module"`
	ExpectedKitLines []struct {
		InstanceID string  `json:"instanceId"`
		UnitIndex  int     `json:"unitIndex"`
		HardwareID string  `json:"hardwareId"`
		Quantity   float64 `json:"quantity"`
	} `json:"expectedKitLines"`
}

func loadVariantKitQuoteFixture(t *testing.T) variantKitQuoteFixture {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "contracts", "fixtures", "variantKitQuoteParity.contract.json"))
	if err != nil {
		t.Fatalf("failed reading shared contract: %v", err)
	}
	var fixture variantKitQuoteFixture
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("failed unmarshaling shared contract: %v", err)
	}
	if len(fixture.Heights) != 4 {
		t.Fatalf("expected 4 heights, got %d", len(fixture.Heights))
	}
	return fixture
}

// buildVariantKitQuoteAgregado construye la receta desde los números del
// fixture (el kit de la variante es el único dato de autoría).
func buildVariantKitQuoteAgregado(f variantKitQuoteFixture) domain.Agregado {
	variants := make([]domain.ProductVariant, 0, len(f.Heights))
	for _, h := range f.Heights {
		variants = append(variants, domain.ProductVariant{
			NominalDimensionMm:      h.NominalDimensionMm,
			HardwareID:              h.HardwareID,
			CommercialKitHardwareID: h.KitHardwareID,
		})
	}
	member := func(id, role string, xRef domain.AssemblyAxisRef) domain.AgregadoRigidMember {
		return domain.AgregadoRigidMember{
			MemberID: id,
			Role:     role,
			Source: domain.RigidMemberSource{
				Kind:    domain.RigidMemberSourceVariant,
				Variant: &domain.VariantHardwareSource{VariantSetID: "height-variants"},
			},
			Placement: domain.AssemblyAnchorRule{
				X: domain.AssemblyAxisPlacement{Ref: xRef},
				Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
				Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
			},
			BOMRole: domain.BOMRoleIncludedInKit,
		}
	}
	return domain.Agregado{
		ID:     "agr-mbox-alturas",
		Code:   "MERIVOBOX-ALTURAS",
		Name:   "MERIVOBOX por altura",
		Active: true,
		VariantSets: []domain.AgregadoVariantSet{
			{ID: "height-variants", Dimension: "height", Variants: variants},
		},
		RigidMembers: []domain.AgregadoRigidMember{
			member("side-left", "drawer_side_left", domain.AxisRefMin),
			member("side-right", "drawer_side_right", domain.AxisRefMax),
		},
		Components:    []domain.ComponentInstance{},
		HardwareLines: []domain.HardwareLine{},
	}
}

func TestVariantKitQuoteParitySharedContract_1493(t *testing.T) {
	f := loadVariantKitQuoteFixture(t)
	variantAgregado := buildVariantKitQuoteAgregado(f)

	// Control legacy: la MISMA receta con el kit a nivel agregado y SIN kits
	// de variante — la cotización no aporta líneas de kit.
	legacyKits := []domain.ProductVariant{}
	for _, h := range f.Heights {
		legacyKits = append(legacyKits, domain.ProductVariant{
			NominalDimensionMm: h.NominalDimensionMm,
			HardwareID:         h.HardwareID,
		})
	}
	kitLevel := "kit-mbox-m"
	legacyAgregado := domain.Agregado{
		ID:                      "agr-mbox-legacy",
		Code:                    "MERIVOBOX-LEGACY",
		Name:                    "MERIVOBOX legacy",
		Active:                  true,
		CommercialKitHardwareID: &kitLevel,
		VariantSets: []domain.AgregadoVariantSet{
			{ID: "height-variants", Dimension: "height", Variants: legacyKits},
		},
		RigidMembers:  variantAgregado.RigidMembers,
		Components:    []domain.ComponentInstance{},
		HardwareLines: []domain.HardwareLine{},
	}

	hardware := []domain.Hardware{}
	for _, h := range f.Heights {
		hardware = append(hardware,
			domain.Hardware{ID: h.HardwareID, Code: h.HardwareID, Name: h.HardwareID, Unit: "piece", CostPerUnit: 100, Active: true},
			domain.Hardware{ID: h.KitHardwareID, Code: h.KitHardwareID, Name: h.KitHardwareID, Unit: "set", CostPerUnit: 200, Active: true},
		)
	}

	// La receta legacy viaja en el MISMO módulo (inst-legacy): sus líneas de
	// kit no deben existir — el kit a nivel agregado no se cotiza por variante.
	mod := domain.Module{
		ID: "mod-cajonera", Code: "CAJONERA-3", Name: "Cajonera 3 cajones",
		StructureID: "st-base",
		WidthMm:     f.Module.WidthMm, HeightMm: f.Module.HeightMm, DepthMm: f.Module.DepthMm,
		Agregados: []domain.ModuleAgregadoInstance{
			{ID: "inst-bajo", AgregadoID: "agr-mbox-alturas", Quantity: 1,
				Dimensions: &domain.AgregadoDimensions{HeightFormula: fmt.Sprintf("PH * %g", f.Module.BottomFraction)}},
			{ID: "inst-alto", AgregadoID: "agr-mbox-alturas", Quantity: f.Module.TopCount, LayoutDirection: "vertical",
				Position:   &domain.AgregadoPosition{ZFormula: fmt.Sprintf("PH * %g", f.Module.BottomFraction)},
				Dimensions: &domain.AgregadoDimensions{HeightFormula: fmt.Sprintf("PH * %g", f.Module.BottomFraction)}},
			{ID: "inst-legacy", AgregadoID: "agr-mbox-legacy", Quantity: 1},
		},
		Components:    []domain.ComponentInstance{},
		HardwareLines: []domain.HardwareLine{},
		BoardParts:    []domain.BoardPart{},
	}

	catalog := domain.Catalog{
		Structures: []domain.Structure{{
			ID: "st-base", Code: "ST-BASE", Name: "Cuerpo",
			Components: []domain.ComponentInstance{},
			Agregados:  []domain.ModuleAgregadoInstance{},
			Active:     true,
		}},
		Agregados: []domain.Agregado{variantAgregado, legacyAgregado},
		Hardware:  hardware,
	}

	bom, err := engine.ResolveBomWithContext(mod, map[string]string{}, catalog, nil, "", nil, nil)
	if err != nil {
		t.Fatalf("ResolveBomWithContext unexpected error: %v", err)
	}

	kitLines := make([]domain.ResolvedHardwareLine, 0)
	for _, line := range bom.HardwareLines {
		if line.OptionRole == "COMMERCIAL_KIT" {
			kitLines = append(kitLines, line)
		}
	}

	if len(kitLines) != len(f.ExpectedKitLines) {
		t.Fatalf("expected %d kit lines, got %d: %+v", len(f.ExpectedKitLines), len(kitLines), kitLines)
	}
	for i, want := range f.ExpectedKitLines {
		got := kitLines[i]
		wantID := fmt.Sprintf("kit-agr-%s-u%d", want.InstanceID, want.UnitIndex)
		if got.ID != wantID || got.HardwareID != want.HardwareID || got.Quantity != want.Quantity {
			t.Errorf("kit line %d = {id:%s hw:%s qty:%g}, want {id:%s hw:%s qty:%g}",
				i, got.ID, got.HardwareID, got.Quantity, wantID, want.HardwareID, want.Quantity)
		}
	}
}
