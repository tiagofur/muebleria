package engine_test

import (
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

// #1493 slice 2: el layout NUNCA omite un cajón en silencio — cada bahía que
// no emite ensamble queda en FurnitureLayout.AssemblyRejections con la razón
// exacta, y los ensambles emitidos llevan su SelectedVariants.

func TestLayoutAssemblyRejections_1493(t *testing.T) {
	c := loadHeightsContract(t)
	agg := buildHeightsAgregadoFromContract(c)

	catalog := domain.Catalog{}
	catalog.Agregados = append(catalog.Agregados, agg)
	for _, n := range c.Nominals {
		catalog.Hardware = append(catalog.Hardware, domain.Hardware{
			ID: n.HardwareID, Code: n.HardwareID, Name: n.HardwareID, Active: true,
		})
	}

	edges := []domain.EdgeAssignment{{Side: "L1"}, {Side: "L2"}, {Side: "W1"}, {Side: "W2"}}
	newModule := func(heightMm int, insts ...domain.ModuleAgregadoInstance) domain.Module {
		return domain.Module{
			ID: "mod-rechazos", Code: "RECHAZOS", Name: "Módulo de rechazos",
			WidthMm: 600, HeightMm: heightMm, DepthMm: 500,
			BoardParts: []domain.BoardPart{
				{ID: "p-lat-izq", Description: "Lateral Izq", Quantity: 1, LengthMm: 542, WidthMm: 500, OptionRole: "LATERAL", Edges: edges},
				{ID: "p-lat-der", Description: "Lateral Der", Quantity: 1, LengthMm: 542, WidthMm: 500, OptionRole: "LATERAL", Edges: edges},
			},
			Agregados: insts,
		}
	}

	t.Run("bahía insuficiente produce rechazo variant_not_found con nominales que cabrían", func(t *testing.T) {
		// Mueble de 60mm: ni N (85.5) cabe.
		layout, err := engine.ResolveFurnitureLayout(newModule(60, domain.ModuleAgregadoInstance{
			ID: "agr-inst-bajo", AgregadoID: agg.ID, Quantity: 1,
		}), catalog, nil, nil)
		if err != nil {
			t.Fatalf("resolve layout: %v", err)
		}
		if len(layout.Assemblies) != 0 {
			t.Fatalf("expected no assemblies, got %d", len(layout.Assemblies))
		}
		if len(layout.AssemblyRejections) != 1 {
			t.Fatalf("expected 1 rejection, got %d: %+v", len(layout.AssemblyRejections), layout.AssemblyRejections)
		}
		rej := layout.AssemblyRejections[0]
		if rej.Reason != "variant_not_found" {
			t.Errorf("reason = %q, want variant_not_found", rej.Reason)
		}
		if rej.VariantSetID != c.VariantSetID {
			t.Errorf("variantSetId = %q, want %q", rej.VariantSetID, c.VariantSetID)
		}
		if rej.AssemblyInstanceID != "agr-inst-bajo" {
			t.Errorf("assemblyInstanceId = %q, want agr-inst-bajo", rej.AssemblyInstanceID)
		}
		if len(rej.FittingNominals) != 4 {
			t.Errorf("fittingNominals = %v, want the 4 height nominals", rej.FittingNominals)
		}
		if rej.BayHeightMm != 60.0 {
			t.Errorf("bayHeightMm = %v, want 60", rej.BayHeightMm)
		}
	})

	t.Run("bahía válida emite ensamble con selectedVariants y cero rechazos", func(t *testing.T) {
		layout, err := engine.ResolveFurnitureLayout(newModule(280, domain.ModuleAgregadoInstance{
			ID: "agr-inst-ok", AgregadoID: agg.ID, Quantity: 1,
		}), catalog, nil, nil)
		if err != nil {
			t.Fatalf("resolve layout: %v", err)
		}
		if len(layout.Assemblies) != 1 {
			t.Fatalf("expected 1 assembly, got %d", len(layout.Assemblies))
		}
		if len(layout.AssemblyRejections) != 0 {
			t.Fatalf("expected no rejections, got %+v", layout.AssemblyRejections)
		}
		svs := layout.Assemblies[0].SelectedVariants
		if len(svs) != 1 || svs[0].VariantSetID != c.VariantSetID {
			t.Fatalf("selectedVariants = %+v, want the height selection", svs)
		}
		if svs[0].NominalDimensionMm != 209.0 {
			t.Errorf("selected nominal = %v, want 209 (E)", svs[0].NominalDimensionMm)
		}
	})

	t.Run("cajonera 3 cajones con una bahía imposible: 2 ensambles + 1 rechazo en el MISMO layout", func(t *testing.T) {
		// 560mm: abajo PH*0.5=280 (E ok), arriba PH*0.5=280 partida en 2 (140, M ok).
		// Un TERCER agregado en una bahía de 60mm no cabe.
		layout, err := engine.ResolveFurnitureLayout(newModule(560,
			domain.ModuleAgregadoInstance{
				ID: "agr-inst-bajo", AgregadoID: agg.ID, Quantity: 1,
				Dimensions: &domain.AgregadoDimensions{HeightFormula: "PH * 0.5"},
			},
			domain.ModuleAgregadoInstance{
				ID: "agr-inst-alto", AgregadoID: agg.ID, Quantity: 2, LayoutDirection: "vertical",
				Position:   &domain.AgregadoPosition{ZFormula: "PH * 0.5"},
				Dimensions: &domain.AgregadoDimensions{HeightFormula: "PH * 0.5"},
			},
			domain.ModuleAgregadoInstance{
				ID: "agr-inst-imposible", AgregadoID: agg.ID, Quantity: 1,
				Position:   &domain.AgregadoPosition{ZFormula: "PH - 60"},
				Dimensions: &domain.AgregadoDimensions{HeightFormula: "60"},
			},
		), catalog, nil, nil)
		if err != nil {
			t.Fatalf("resolve layout: %v", err)
		}
		if len(layout.Assemblies) != 3 {
			t.Fatalf("expected 3 assemblies (E + M + M), got %d", len(layout.Assemblies))
		}
		if len(layout.AssemblyRejections) != 1 {
			t.Fatalf("expected 1 rejection, got %d: %+v", len(layout.AssemblyRejections), layout.AssemblyRejections)
		}
		rej := layout.AssemblyRejections[0]
		if rej.Reason != "variant_not_found" || rej.AssemblyInstanceID != "agr-inst-imposible" {
			t.Errorf("rejection = %+v, want the impossible bay as variant_not_found", rej)
		}
	})

	t.Run("receta inválida produce rechazo definition_invalid una vez por instancia", func(t *testing.T) {
		broken := buildHeightsAgregadoFromContract(c)
		broken.RigidMembers = append(broken.RigidMembers, domain.AgregadoRigidMember{
			MemberID: "dup", Role: "dup",
			Source: domain.RigidMemberSource{Kind: domain.RigidMemberSourceFixed, Fixed: &domain.FixedHardwareSource{HardwareID: ""}},
			Placement: domain.AssemblyAnchorRule{
				X: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
				Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
				Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
			},
			BOMRole: domain.BOMRoleIncludedInKit,
		})
		brokenCatalog := domain.Catalog{}
		brokenCatalog.Agregados = append(brokenCatalog.Agregados, broken)
		layout, err := engine.ResolveFurnitureLayout(newModule(280, domain.ModuleAgregadoInstance{
			ID: "agr-inst-rota", AgregadoID: broken.ID, Quantity: 1,
		}), brokenCatalog, nil, nil)
		if err != nil {
			t.Fatalf("resolve layout: %v", err)
		}
		if len(layout.Assemblies) != 0 {
			t.Fatalf("expected no assemblies for an invalid recipe, got %d", len(layout.Assemblies))
		}
		if len(layout.AssemblyRejections) != 1 || layout.AssemblyRejections[0].Reason != "definition_invalid" {
			t.Fatalf("expected 1 definition_invalid rejection, got %+v", layout.AssemblyRejections)
		}
	})
}
