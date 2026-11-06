package api

import (
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1519 F2: la proyección de accesorios del juego — por agregado elegido,
// los grupos kind:hardware vinculados a su kit comercial (y a los kits de
// sus variantes de altura #1493), sólo opciones activas, merge por código,
// orden determinista.
func TestBuildAccessoryGroupsForAgregado_1519(t *testing.T) {
	kitMain := "kit-e"
	kitVar := "kit-e-70kg"
	kitOtro := "kit-otro"
	commercial := kitMain
	agr := domain.Agregado{
		ID:                      "agr-e",
		Code:                    "CAJON-E",
		Active:                  true,
		CommercialKitHardwareID: &commercial,
		VariantSets: []domain.AgregadoVariantSet{
			{
				ID:        "vs-h",
				Dimension: "height",
				Variants: []domain.ProductVariant{
					{NominalDimensionMm: 108, HardwareID: "hw-guia-108", CommercialKitHardwareID: kitMain},
					{NominalDimensionMm: 146, HardwareID: "hw-guia-146", CommercialKitHardwareID: kitVar},
				},
			},
		},
	}
	optionGaleria := "hw-galeria"
	optionBoxcap := "hw-boxcap"
	optionInactive := "hw-off"
	catalog := domain.Catalog{
		Agregados: []domain.Agregado{agr},
		Hardware: []domain.Hardware{
			{ID: optionGaleria, Active: true},
			{ID: optionBoxcap, Active: true},
			{ID: optionInactive, Active: false},
		},
		// Fixture DESORDENADO a propósito (review P2-2: matar la mutación de
		// quitar sort/por-código) y con grupos discriminatorios: OTRO-KIT (de
		// otro kit), SIN-KIT (grupo común) y BOARD (otro kind) NO participan.
		OptionGroups: []domain.OptionGroup{
			// El rol CAJON kind=agregado con el agregado como opción activa.
			{ID: "og-c", Code: "CAJON", Name: "Cajón", Kind: "agregado", Required: true, OptionIDs: []string{"agr-e"}},
			// Kit variante 70kg: mismo código LATERAL_E con boxcap extra (merge).
			{ID: "og2", Code: "LATERAL_E", Name: "Lateral superior E", Kind: "hardware", Required: true, KitHardwareID: &kitVar, OptionIDs: []string{optionGaleria, optionBoxcap}},
			// De OTRO kit: no participa aunque sea kind hardware activo.
			{ID: "og3", Code: "AA_OTRO_KIT", Name: "De otro kit", Kind: "hardware", Required: true, KitHardwareID: &kitOtro, OptionIDs: []string{optionGaleria}},
			// Sin kit (grupo común): no participa.
			{ID: "og4", Code: "AA_SIN_KIT", Name: "Común", Kind: "hardware", OptionIDs: []string{optionGaleria}},
			// Otro kind: no participa.
			{ID: "og5", Code: "AA_BOARD", Name: "Board", Kind: "board", KitHardwareID: &kitMain, OptionIDs: []string{optionGaleria}},
			{ID: "og1", Code: "LATERAL_E", Name: "Lateral superior E", Kind: "hardware", Required: true, KitHardwareID: &kitMain, OptionIDs: []string{optionGaleria, optionInactive}},
			// Kit principal: B_COVER_E (ordena ANTES de LATERAL_E — review:
			// con un solo grupo el sort no es observable) + galería + inactiva.
			{ID: "og6", Code: "B_COVER_E", Name: "Boxcover E", Kind: "hardware", Required: false, KitHardwareID: &kitMain, OptionIDs: []string{optionBoxcap}},
		},
	}

	got := buildAccessoryGroupsForAgregado(agr, catalog)
	// Sólo los grupos de kit-e: OTRO-KIT/SIN-KIT/AA_BOARD quedan fuera (kit
	// ajeno, sin kit, otro kind), el inactivo no entra, y el ORDEN es
	// alfabético — B_COVER_E antes que LATERAL_E (review: con un solo grupo
	// el sort no era observable).
	if len(got) != 2 {
		t.Fatalf("groups = %d (%v), want [B_COVER_E LATERAL_E]", len(got), got)
	}
	if got[0].Code != "B_COVER_E" || got[1].Code != "LATERAL_E" {
		t.Fatalf("codes = %v/%v, want B_COVER_E/LATERAL_E (orden alfabético)", got[0].Code, got[1].Code)
	}
	if got[0].Required {
		t.Errorf("B_COVER_E must not inherit required from LATERAL_E (merge por código, no por grupo)")
	}
	lat := got[1]
	if !lat.Required {
		t.Error("LATERAL_E must inherit required=true")
	}
	want := map[string]bool{optionGaleria: true, optionBoxcap: true}
	if len(lat.OptionIDs) != len(want) {
		t.Fatalf("LATERAL_E options = %v, want merged active %v", lat.OptionIDs, want)
	}
	for _, id := range lat.OptionIDs {
		if !want[id] {
			t.Errorf("LATERAL_E option %s inesperada o inactiva", id)
		}
	}

	// Sin kit comercial → nil (no explota).
	empty := domain.Agregado{ID: "agr-vacio", Code: "SIN-KIT"}
	if got2 := buildAccessoryGroupsForAgregado(empty, catalog); got2 != nil {
		t.Fatalf("agregado sin kit debe proyectar nil, got %v", got2)
	}

	// #1519 (review P2-2): la proyección completa por ROL —
	// buildAgregadoRoles llena Options del agregado elegido con LATERAL_E
	// (hw-galería activa) y NUNCA con grupos ajenos/sin kit/board.
	roles := buildAgregadoRoles(domain.Module{
		ID: "mod-x",
		Agregados: []domain.ModuleAgregadoInstance{
			{AgregadoID: agr.ID, OptionRole: "CAJON"},
		},
	}, catalog)
	if len(roles) != 1 || roles[0].Code != "CAJON" {
		t.Fatalf("roles = %v, want CAJON", roles)
	}
	if len(roles[0].Options) != 1 {
		t.Fatalf("Options = %v, want 1 opción con LATERAL_E", roles[0].Options)
	}
	opt := roles[0].Options[0]
	if opt.AgregadoID != agr.ID {
		t.Fatalf("option agregadoId = %q, want %q", opt.AgregadoID, agr.ID)
	}
	if len(opt.AccessoryGroups) != 2 {
		t.Fatalf("accessoryGroups = %v, want [B_COVER_E LATERAL_E]", opt.AccessoryGroups)
	}
	if opt.AccessoryGroups[0].Code != "B_COVER_E" || opt.AccessoryGroups[1].Code != "LATERAL_E" {
		t.Fatalf("accessoryGroups codes = %v/%v, want B_COVER_E/LATERAL_E (orden alfabético)",
			opt.AccessoryGroups[0].Code, opt.AccessoryGroups[1].Code)
	}
	for _, group := range opt.AccessoryGroups {
		for _, id := range group.OptionIDs {
			if id == optionInactive {
				t.Errorf("la opción inactiva %s no debe entrar", id)
			}
		}
	}
}
