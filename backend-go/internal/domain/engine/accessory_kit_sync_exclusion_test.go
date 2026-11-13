package engine

import (
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1613: las piezas de kit que son MIEMBROS de un grupo de opciones
// accesorio linkeado al kit (Galería/Boxcap/Boxcover) son elecciones
// consumibles (resolveAccessoryAssemblies) — el sync NUNCA las materializa
// como partes fijas, o cada bahía dibuja el set completo de insertos además
// del elegido (cajones dobles + cajón E extra del owner).
func TestSyncExcludesAccessoryGroupMembers_1613(t *testing.T) {
	galID := "hw-gal-ig"
	fijID := "hw-fij-e"
	movID := "hw-mov-e"
	kitID := "kit-e-gray"

	gal := domain.Hardware{
		ID: galID, Code: "MBOX-E-GAL-IG", Name: "Galería Merivobox E",
		KitHardwareID: &kitID, Active: true,
		Pieces: []domain.HardwarePiece{
			{Anchor: domain.MemberHandLeft},
			{Anchor: domain.MemberHandRight},
		},
	}
	fij := domain.Hardware{
		ID: fijID, Code: "MBOX-IRIDIUM-GRAY-E-FIJ", Name: "Perfil fijo E",
		KitHardwareID: &kitID, Active: true,
		Pieces: []domain.HardwarePiece{
			{Anchor: domain.MemberHandLeft},
			{Anchor: domain.MemberHandRight},
		},
	}
	mov := domain.Hardware{
		ID: movID, Code: "MBOX-IRIDIUM-GRAY-E-MOV", Name: "Perfil móvil E",
		KitHardwareID: &kitID, Active: true,
		Pieces: []domain.HardwarePiece{
			{Anchor: domain.MemberHandLeft},
			{Anchor: domain.MemberHandRight},
		},
	}

	group := domain.OptionGroup{
		ID:        "og-inserto",
		Code:      "MBOX_IRIDIUM_GRAY_E_INSERTO",
		Name:      "Inserto",
		Kind:      "hardware",
		Required:  true,
		OptionIDs: []string{galID},
	}
	groupKit := kitID
	group.KitHardwareID = &groupKit

	catalog := domain.Catalog{
		Hardware:      []domain.Hardware{gal, fij, mov},
		OptionGroups:  []domain.OptionGroup{group},
	}
	agr := domain.Agregado{ID: "agr-gray", Code: "MBOX-IRIDIUM-GRAY-CAJON"}

	got := syncAgregadoRigidMembersFromCatalog(agr, catalog, kitID)

	var gotIDs []string
	for _, m := range got.RigidMembers {
		if m.Source.Fixed != nil {
			gotIDs = append(gotIDs, m.Source.Fixed.HardwareID)
		}
	}
	if len(gotIDs) != 4 {
		t.Fatalf("members = %v, want 4 (FIJ/MOV × mano; la GAL es elección, nunca parte fija)", gotIDs)
	}
	for _, id := range gotIDs {
		if id == galID {
			t.Fatalf("la pieza-inserto %s fue materializada como parte fija (debe viajar sólo por resolveAccessoryAssemblies)", id)
		}
	}

	// Sin el grupo linkeado (legacy), la GAL sigue siendo parte fija del kit —
	// byte-identical behavior para catálogos sin grupos accesorios.
	catalogNoGroups := domain.Catalog{Hardware: []domain.Hardware{gal, fij, mov}}
	gotLegacy := syncAgregadoRigidMembersFromCatalog(agr, catalogNoGroups, kitID)
	if len(gotLegacy.RigidMembers) != 6 {
		t.Fatalf("legacy members = %d, want 6 (sin grupos accesorios el sync no excluye nada)", len(gotLegacy.RigidMembers))
	}
}
