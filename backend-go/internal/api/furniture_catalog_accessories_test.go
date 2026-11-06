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
	commercial := kitMain
	agr := domain.Agregado{
		ID:                      "agr-e",
		Code:                    "CAJON-E",
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
		Hardware: []domain.Hardware{
			{ID: optionGaleria, Active: true},
			{ID: optionBoxcap, Active: true},
			{ID: optionInactive, Active: false},
		},
		OptionGroups: []domain.OptionGroup{
			// Kit principal: galería (activa) + una inactiva.
			{ID: "og1", Code: "LATERAL_E", Name: "Lateral superior E", Kind: "hardware", Required: true, KitHardwareID: &kitMain, OptionIDs: []string{optionGaleria, optionInactive}},
			// Kit variante 70kg: mismo código LATERAL_E con boxcap extra (merge).
			{ID: "og2", Code: "LATERAL_E", Name: "Lateral superior E", Kind: "hardware", Required: true, KitHardwareID: &kitVar, OptionIDs: []string{optionGaleria, optionBoxcap}},
			// Grupo de OTRO kit: no participa.
			{ID: "og3", Code: "OTRO", Name: "Otro", Kind: "hardware", KitHardwareID: &kitMain},
		},
	}

	got := buildAccessoryGroupsForAgregado(agr, catalog)
	// OTRO también apunta a kit-e, así que son 2 grupos ordenados por código.
	if len(got) != 2 {
		t.Fatalf("groups = %d, want 2 (LATERAL_E + OTRO, ambos del kit-e)", len(got))
	}
	if got[0].Code != "LATERAL_E" || got[1].Code != "OTRO" {
		t.Fatalf("codes = %v/%v, want LATERAL_E/OTRO (orden alfabético)", got[0].Code, got[1].Code)
	}
	lat := got[0]
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
}
