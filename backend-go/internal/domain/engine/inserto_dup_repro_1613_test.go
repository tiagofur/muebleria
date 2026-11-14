package engine_test

import (
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

// #1613 — regresión resolve-level del repro del owner (QA Cajonera 3 cajones
// MERIVOBOX por altura + grupo de insertos linkeado al kit E): la variante
// por bahía manda en el kit efectivo, el sync nunca materializa los insertos
// como partes fijas y el ensamble accesorio nace SÓLO en la bahía cuyo kit
// matchea. R2/R4 son los estados que el owner vio dobles en vivo.
type insertoDupFixture struct {
	kitMID    string
	kitEID    string
	fijMID    string
	movMID    string
	fijEID    string
	movEID    string
	galID     string
	groupCode string
	alturasID string
	grayID    string
}

func buildInsertoDupCatalog(t *testing.T) (domain.Catalog, domain.Module, insertoDupFixture) {
	t.Helper()
	f := insertoDupFixture{
		kitMID:    "kit-m-gray",
		kitEID:    "kit-e-gray",
		fijMID:    "hw-fij-m",
		movMID:    "hw-mov-m",
		fijEID:    "hw-fij-e",
		movEID:    "hw-mov-e",
		galID:     "hw-gal-ig",
		groupCode: "MBOX_IRIDIUM_GRAY_E_INSERTO",
		alturasID: "agr-alturas",
		grayID:    "agr-gray",
	}

	piecePair := func() []domain.HardwarePiece {
		return []domain.HardwarePiece{
			{Anchor: domain.MemberHandLeft},
			{Anchor: domain.MemberHandRight},
		}
	}
	hw := func(id, code string, kit *string) domain.Hardware {
		return domain.Hardware{
			ID: id, Code: code, Name: code, Active: true,
			KitHardwareID: kit,
			Pieces:        piecePair(),
		}
	}
	kitM, kitE := f.kitMID, f.kitEID
	// #1613: la GAL es HIJA del kit E en este fixture — el estado que el fix
	// de sync (layout.go:902) defiende. Así los asserts «GAL ausente» a nivel
	// resolve ejercen la exclusión de verdad, no un catálogo que nunca la
	// habría materializado.
	gal := hw(f.galID, "MBOX-E-GAL-IG", &kitE)

	catalog := domain.Catalog{
		Hardware: []domain.Hardware{
			hw(f.fijMID, "MBOX-GRAY-M-FIJ", &kitM),
			hw(f.movMID, "MBOX-GRAY-M-MOV", &kitM),
			hw(f.fijEID, "MBOX-GRAY-E-FIJ", &kitE),
			hw(f.movEID, "MBOX-GRAY-E-MOV", &kitE),
			gal,
		},
		OptionGroups: []domain.OptionGroup{
			{
				ID: "og-inserto", Code: f.groupCode, Name: "Inserto",
				Kind: "hardware", Required: true, OptionIDs: []string{f.galID},
				KitHardwareID: &kitE,
			},
			// #1577: el grupo de rol de agregado — la siembra del plugin lo
			// pisa con el primer miembro; el resolve debe honrar la elección
			// manteniendo la atribución por-bahía del kit de variante.
			{
				ID: "og-cajon", Code: "CAJON", Name: "Cajones",
				Kind: "agregado", Required: true,
				OptionIDs: []string{f.alturasID, f.grayID},
			},
			{ID: "og-lateral", Code: "LATERAL", Name: "Lateral", Kind: "board", Required: true, OptionIDs: []string{"mat-lat"}},
		},
		Materials: []domain.MaterialBoard{{
			ID: "mat-lat", Code: "MAT-LAT", Name: "Lateral", WidthMm: 1830, LengthMm: 2440,
			ThicknessMm: 18, BoardPrice: 100, CostPerM2: 100, Active: true,
		}},
	}

	alturas := domain.Agregado{
		ID: f.alturasID, Code: "MBOX-QA-ALTURAS", Name: "Cajón por altura", Active: true,
		VariantSets: []domain.AgregadoVariantSet{{
			ID:        "height-variants",
			Dimension: "height",
			Variants: []domain.ProductVariant{
				{NominalDimensionMm: 108, HardwareID: f.kitMID, CommercialKitHardwareID: f.kitMID},
				{NominalDimensionMm: 209, HardwareID: f.kitEID, CommercialKitHardwareID: f.kitEID},
			},
		}},
		CompatibilityRules: []domain.AssemblyCompatibilityRule{
			{VariantSetID: "height-variants", ClearanceMm: 0, SelectionStrategy: "max_fitting"},
		},
		Components:    []domain.ComponentInstance{},
		HardwareLines: []domain.HardwareLine{},
	}
	// El gray limpio (rev 13): receta SIN miembros fijos — los perfiles los
	// aporta el kit de la variante en resolve, la galería es elección.
	gray := domain.Agregado{
		ID: f.grayID, Code: "MBOX-IRIDIUM-GRAY-CAJON", Name: "Cajón Gray", Active: true,
		VariantSets: []domain.AgregadoVariantSet{{
			ID:        "height-variants",
			Dimension: "height",
			Variants: []domain.ProductVariant{
				{NominalDimensionMm: 108, HardwareID: f.kitMID, CommercialKitHardwareID: f.kitMID},
				{NominalDimensionMm: 209, HardwareID: f.kitEID, CommercialKitHardwareID: f.kitEID},
			},
		}},
		CompatibilityRules: []domain.AssemblyCompatibilityRule{
			{VariantSetID: "height-variants", ClearanceMm: 0, SelectionStrategy: "max_fitting"},
		},
		Components:    []domain.ComponentInstance{},
		HardwareLines: []domain.HardwareLine{},
	}

	edges := []domain.EdgeAssignment{{Side: "L1"}, {Side: "L2"}, {Side: "W1"}, {Side: "W2"}}
	catalog.Agregados = []domain.Agregado{alturas, gray}
	mod := domain.Module{
		ID: "mod-qa-3caj", Code: "MOD-QA-MBOX-3CAJ", Name: "QA Cajonera",
		WidthMm: 600, HeightMm: 720, DepthMm: 560,
		BoardParts: []domain.BoardPart{
			{ID: "p-lat-izq", Description: "Lateral Izq", Quantity: 1, LengthMm: 542, WidthMm: 500, OptionRole: "LATERAL", Edges: edges},
			{ID: "p-lat-der", Description: "Lateral Der", Quantity: 1, LengthMm: 542, WidthMm: 500, OptionRole: "LATERAL", Edges: edges},
			{ID: "p-frente-bajo", Description: "Frente bajo", Quantity: 1, LengthMm: 564, WidthMm: 360, OptionRole: "FRENTE", Edges: edges},
			{ID: "p-frente-alto", Description: "Frente alto", Quantity: 1, LengthMm: 564, WidthMm: 180, OptionRole: "FRENTE", Edges: edges},
		},
		Agregados: []domain.ModuleAgregadoInstance{
			{ID: "qa-mbox-bajo", AgregadoID: f.alturasID, OptionRole: "CAJON", Quantity: 1,
				Dimensions: &domain.AgregadoDimensions{HeightFormula: "PH * 0.5"}},
			{ID: "qa-mbox-alto", AgregadoID: f.alturasID, OptionRole: "CAJON", Quantity: 2, LayoutDirection: "vertical",
				Position:   &domain.AgregadoPosition{ZFormula: "PH * 0.5"},
				Dimensions: &domain.AgregadoDimensions{HeightFormula: "PH * 0.5"}},
		},
		Components:    []domain.ComponentInstance{},
		HardwareLines: []domain.HardwareLine{},
	}
	return catalog, mod, f
}

func assemblyMemberHwIDs(asm engine.LayoutAssembly) map[string]bool {
	out := map[string]bool{}
	for _, m := range asm.RigidMembers {
		if m.HardwareID != "" {
			out[m.HardwareID] = true
		}
	}
	return out
}

func TestInsertoDupRepro_1613(t *testing.T) {
	catalog, mod, f := buildInsertoDupCatalog(t)

	// R1 sin elecciones: 3 bahías (E abajo, M arriba ×2) + el inserto POR
	// DEFECTO (primera opción del grupo, decisión del owner 2026-11-13) como
	// ensamble accesorio SÓLO en la bahía E. Nunca como parte fija.
	layout, err := engine.ResolveFurnitureLayout(mod, catalog, nil, map[string]string{"LATERAL": "mat-lat"})
	if err != nil {
		t.Fatalf("R1 unexpected error: %v", err)
	}
	if len(layout.Assemblies) != 4 {
		t.Fatalf("R1 assemblies = %d, want 4 (3 bahías + inserto por defecto); rejections=%+v", len(layout.Assemblies), layout.AssemblyRejections)
	}
	if acc := accessoryAssembliesOf(layout); len(acc) != 1 {
		t.Fatalf("R1 must mount exactly the default inserto, got %d accessory assemblies", len(acc))
	}
	if len(layout.AssemblyRejections) != 0 {
		t.Fatalf("R1 rejections = %+v, want none (the default inserto satisfies the required group)", layout.AssemblyRejections)
	}
	for _, asm := range layout.Assemblies {
		if strings.Contains(asm.AssemblyInstanceID, "-acc-") {
			continue
		}
		if assemblyMemberHwIDs(asm)[f.galID] {
			t.Fatalf("R1: la galería quedó materializada como parte fija en %s", asm.AssemblyInstanceID)
		}
	}

	// R2 override sembrado de CAJON (#1577): la elección pisa el agregado del
	// módulo por el Gray (receta limpia) — cada bahía debe llevar SOLO las
	// piezas de SU kit de variante (E abajo, M arriba), jamás FIJ/MOV del kit
	// E sobre una bahía M, y la GAL (hija del kit E en el fixture) jamás
	// materializada como parte fija — aquí la exclusión de layout.go:902
	// se ejercita de verdad.
	layout2, err := engine.ResolveFurnitureLayout(mod, catalog, nil, map[string]string{
		"LATERAL": "mat-lat",
		"CAJON":   f.grayID,
	})
	if err != nil {
		t.Fatalf("R2 unexpected error: %v", err)
	}
	if len(layout2.Assemblies) != 4 {
		t.Fatalf("R2 assemblies = %d, want 4 (3 bahías + inserto por defecto); rejections=%+v", len(layout2.Assemblies), layout2.AssemblyRejections)
	}
	for _, asm := range layout2.Assemblies {
		if strings.Contains(asm.AssemblyInstanceID, "-acc-") {
			continue
		}
		ids := assemblyMemberHwIDs(asm)
		z := asm.Placement["translation"].([]float64)[2]
		if z < 1 {
			// Bahía baja: variant E → piezas del kit E, nunca M.
			if ids[f.fijMID] || ids[f.movMID] {
				t.Fatalf("R2 bahía baja con piezas del kit M: %v", ids)
			}
			if !ids[f.fijEID] || !ids[f.movEID] {
				t.Fatalf("R2 bahía baja sin el kit E completo: %v", ids)
			}
		} else {
			// Bahías altas: variant M → piezas del kit M, nunca E.
			if ids[f.fijEID] || ids[f.movEID] {
				t.Fatalf("R2 bahía alta con piezas del kit E (kit cruzado): %v", ids)
			}
			if !ids[f.fijMID] || !ids[f.movMID] {
				t.Fatalf("R2 bahía alta sin el kit M completo: %v", ids)
			}
		}
		if ids[f.galID] {
			t.Fatalf("R2 bahía %s con la galería materializada (la exclusión #1613 no corrió)", asm.AssemblyInstanceID)
		}
	}

	// R4 con la elección del inserto SOBRE el override de CAJON (el estado
	// exacto del owner: siembra de CAJON + usuario elige la galería):
	// exactamente 4 ensambles — 3 bahías del Gray con sus piezas de variante
	// + 1 ensamble accesorio de 2 tiras SÓLO en la bahía E (z=0). El inserto
	// es una elección (#1555), nunca parte fija.
	layout4, err := engine.ResolveFurnitureLayout(mod, catalog, nil, map[string]string{
		"LATERAL":                     "mat-lat",
		"CAJON":                       f.grayID,
		"MBOX_IRIDIUM_GRAY_E_INSERTO": f.galID,
	})
	if err != nil {
		t.Fatalf("R4 unexpected error: %v", err)
	}
	if len(layout4.Assemblies) != 4 {
		t.Fatalf("R4 assemblies = %d, want 4 (3 bahías + 1 accesorio)", len(layout4.Assemblies))
	}
	acc := accessoryAssembliesOf(layout4)
	if len(acc) != 1 {
		t.Fatalf("R4 accessory assemblies = %d, want 1", len(acc))
	}
	accZ := acc[0].Placement["translation"].([]float64)[2]
	if accZ > 1 {
		t.Fatalf("R4 accesorio en bahía alta (z=%g): sólo la bahía E monta el kit con inserto", accZ)
	}
	if len(acc[0].RigidMembers) != 2 {
		t.Fatalf("R4 accesorio con %d miembros, want 2 tiras", len(acc[0].RigidMembers))
	}
	for _, asm := range layout4.Assemblies {
		if strings.Contains(asm.AssemblyInstanceID, "-acc-") {
			continue
		}
		if assemblyMemberHwIDs(asm)[f.galID] {
			t.Fatalf("R4: la galería elegida quedó también como parte fija en %s", asm.AssemblyInstanceID)
		}
	}
}
