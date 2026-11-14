package engine_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

// #1613 ronda 4: paridad TS↔Go del filtro por kit efectivo. Autoridad única:
// contracts/fixtures/kitFilterPerBay.contract.json — ambos lados CONSTRUYEN
// catálogo y receta desde el JSON (patrón accessoryKitParity). El espejo TS
// vive en packages/domain/src/kitFilterPerBay.contract.test.ts.

type kitFilterFixture struct {
	Kits []struct {
		ID                 string  `json:"id"`
		Code               string  `json:"code"`
		VariantHardwareID  string  `json:"variantHardwareId"`
		NominalDimensionMm float64 `json:"nominalDimensionMm"`
		Parts              []struct {
			ID   string `json:"id"`
			Code string `json:"code"`
		} `json:"parts"`
	} `json:"kits"`
	LooseHardware []struct {
		ID       string `json:"id"`
		Code     string `json:"code"`
		MemberID string `json:"memberId"`
	} `json:"looseHardware"`
	Agregado struct {
		ID           string `json:"id"`
		Code         string `json:"code"`
		VariantSetID string `json:"variantSetId"`
	} `json:"agregado"`
	Module struct {
		WidthMm  int `json:"widthMm"`
		HeightMm int `json:"heightMm"`
		DepthMm  int `json:"depthMm"`
	} `json:"module"`
	Bays []struct {
		ID                     string             `json:"id"`
		HeightFormula          string             `json:"heightFormula"`
		ExpectedHardwareCounts map[string]float64 `json:"expectedHardwareCounts"`
	} `json:"bays"`
}

func loadKitFilterFixture(t *testing.T) kitFilterFixture {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "contracts", "fixtures", "kitFilterPerBay.contract.json"))
	if err != nil {
		t.Fatalf("failed reading shared contract: %v", err)
	}
	var f kitFilterFixture
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatalf("failed unmarshaling shared contract: %v", err)
	}
	if len(f.Kits) != 2 || len(f.Bays) != 2 {
		t.Fatalf("fixture shape: want 2 kits / 2 bays, got %d kits / %d bays", len(f.Kits), len(f.Bays))
	}
	return f
}

func TestKitFilterPerBaySharedContract_1613(t *testing.T) {
	f := loadKitFilterFixture(t)

	variants := make([]domain.ProductVariant, 0, len(f.Kits))
	hardware := make([]domain.Hardware, 0, len(f.Kits)*3+len(f.LooseHardware))
	// La receta persiste la UNIÓN de los kits (patrón rev 17): miembros fijos
	// de TODAS las partes de TODOS los kits × mano + los herrajes sueltos.
	members := make([]domain.AgregadoRigidMember, 0, len(f.Kits)*4+len(f.LooseHardware))
	member := func(id, hwID, hand string, xRef domain.AssemblyAxisRef) domain.AgregadoRigidMember {
		return domain.AgregadoRigidMember{
			MemberID: id,
			Role:     "drawer_guide",
			Source: domain.RigidMemberSource{
				Kind:  domain.RigidMemberSourceFixed,
				Fixed: &domain.FixedHardwareSource{HardwareID: hwID},
			},
			Placement: domain.AssemblyAnchorRule{
				X: domain.AssemblyAxisPlacement{Ref: xRef},
				Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
				Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
			},
			BOMRole: domain.BOMRoleIncludedInKit,
			Hand:    hand,
		}
	}

	for _, kit := range f.Kits {
		variants = append(variants, domain.ProductVariant{
			NominalDimensionMm:      kit.NominalDimensionMm,
			HardwareID:              kit.VariantHardwareID,
			CommercialKitHardwareID: kit.ID,
		})
		kitID := kit.ID
		hardware = append(hardware, domain.Hardware{
			ID: kit.VariantHardwareID, Code: kit.Code, Name: kit.Code,
			Unit: "set", CostPerUnit: 200, Active: true,
		})
		for _, part := range kit.Parts {
			hardware = append(hardware, domain.Hardware{
				ID: part.ID, Code: part.Code, Name: part.Code,
				Unit: "piece", CostPerUnit: 100, Active: true,
				KitHardwareID: &kitID,
				Pieces: []domain.HardwarePiece{
					{Anchor: domain.MemberHandLeft},
					{Anchor: domain.MemberHandRight},
				},
			})
			members = append(members,
				member("part-"+part.ID+"-left", part.ID, domain.MemberHandLeft, domain.AxisRefMin),
				member("part-"+part.ID+"-right", part.ID, domain.MemberHandRight, domain.AxisRefMax),
			)
		}
	}
	for _, loose := range f.LooseHardware {
		hardware = append(hardware, domain.Hardware{
			ID: loose.ID, Code: loose.Code, Name: loose.Code,
			Unit: "piece", CostPerUnit: 5, Active: true,
		})
		m := member(loose.MemberID, loose.ID, "", domain.AxisRefMin)
		members = append(members, m)
	}

	agr := domain.Agregado{
		ID:     f.Agregado.ID,
		Code:   f.Agregado.Code,
		Name:   f.Agregado.Code,
		Active: true,
		VariantSets: []domain.AgregadoVariantSet{
			{ID: f.Agregado.VariantSetID, Dimension: "height", Variants: variants},
		},
		RigidMembers: members,
	}

	inst := make([]domain.ModuleAgregadoInstance, 0, len(f.Bays))
	for _, bay := range f.Bays {
		inst = append(inst, domain.ModuleAgregadoInstance{
			ID: bay.ID, AgregadoID: agr.ID, Quantity: 1,
			Dimensions: &domain.AgregadoDimensions{HeightFormula: bay.HeightFormula},
		})
	}
	mod := domain.Module{
		ID: "mod-cajonera", Code: "CAJONERA", Name: "Cajonera",
		WidthMm: f.Module.WidthMm, HeightMm: f.Module.HeightMm, DepthMm: f.Module.DepthMm,
		Agregados: inst,
	}
	catalog := domain.Catalog{Agregados: []domain.Agregado{agr}, Hardware: hardware}

	layout, err := engine.ResolveFurnitureLayout(mod, catalog, nil, nil)
	if err != nil {
		t.Fatalf("ResolveFurnitureLayout unexpected error: %v", err)
	}
	if len(layout.AssemblyRejections) != 0 {
		t.Fatalf("expected no rejections, got %+v", layout.AssemblyRejections)
	}

	byBay := map[string]map[string]float64{}
	for _, asm := range layout.Assemblies {
		counts := map[string]float64{}
		for _, rm := range asm.RigidMembers {
			counts[rm.HardwareID]++
		}
		byBay[asm.AssemblyInstanceID] = counts
	}
	if len(layout.Assemblies) != len(f.Bays) {
		t.Fatalf("assemblies = %d, want %d (%+v)", len(layout.Assemblies), len(f.Bays), layout.Assemblies)
	}
	for _, bay := range f.Bays {
		got := byBay[bay.ID]
		if len(got) != len(bay.ExpectedHardwareCounts) {
			t.Fatalf("bahía %s = %v, want exactamente %v (piezas del otro kit deben caer)", bay.ID, got, bay.ExpectedHardwareCounts)
		}
		for hwID, want := range bay.ExpectedHardwareCounts {
			if got[hwID] != want {
				t.Errorf("bahía %s: %s = %g, want %g (todo: %v)", bay.ID, hwID, got[hwID], want, got)
			}
		}
	}

	// Control anti-regresión del fixture: la unión envenenada EXISTE en la
	// receta — si el filtro se rompe, alguna bahía gana piezas del otro kit.
	if len(members) < 9 {
		t.Fatalf("fixture sanity: la receta envenenada debe tener ≥9 miembros, tiene %d", len(members))
	}
}
