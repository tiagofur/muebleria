package engine

import (
	"fmt"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1613 ronda 4: el sync aditivo de la web persiste la UNIÓN de los kits por
// variante (E+M) como miembros fijos (rev 14-17). Sin el filtro por kit
// efectivo cada bahía dibujaba el cajón completo del OTRO kit encima del
// suyo — un cajón M salía con el fijador E (más alto) superpuesto.
func TestSyncFiltersMembersByEffectiveKit_1613(t *testing.T) {
	kitM := "kit-m-gray"
	kitE := "kit-e-gray"

	kitPart := func(id, code, name, kit string) domain.Hardware {
		k := kit
		return domain.Hardware{
			ID: id, Code: code, Name: name,
			KitHardwareID: &k, Active: true,
			Pieces: []domain.HardwarePiece{
				{Anchor: domain.MemberHandLeft},
				{Anchor: domain.MemberHandRight},
			},
		}
	}
	hwMFix := kitPart("hw-m-fij", "MBOX-IRIDIUM-GRAY-M-FIJ", "Perfil fijo M", kitM)
	hwMMov := kitPart("hw-m-mov", "MBOX-IRIDIUM-GRAY-M-MOV", "Perfil móvil M", kitM)
	hwEFix := kitPart("hw-e-fij", "MBOX-IRIDIUM-GRAY-E-FIJ", "Perfil fijo E", kitE)
	hwEMov := kitPart("hw-e-mov", "MBOX-IRIDIUM-GRAY-E-MOV", "Perfil móvil E", kitE)
	// Sin kit: tornillo de perforación (#1487) — nunca se descarta.
	screw := domain.Hardware{
		ID: "hw-tor-fondo", Code: "MBOX-TOR-FONDO", Name: "Tornillo fondo", Active: true,
	}

	catalog := domain.Catalog{
		Hardware: []domain.Hardware{hwMFix, hwMMov, hwEFix, hwEMov, screw},
	}

	// Miembros persistidos (patrón rev 17): los DOS kits × mano + tornillo.
	fixedMember := func(hwID, hand string) domain.AgregadoRigidMember {
		return domain.AgregadoRigidMember{
			MemberID: fmt.Sprintf("part_%s_%s", hwID, hand),
			Source: domain.RigidMemberSource{
				Fixed: &domain.FixedHardwareSource{HardwareID: hwID},
			},
			Hand: hand,
		}
	}
	poisonedMembers := []domain.AgregadoRigidMember{
		fixedMember("hw-m-fij", domain.MemberHandLeft),
		fixedMember("hw-m-fij", domain.MemberHandRight),
		fixedMember("hw-m-mov", domain.MemberHandLeft),
		fixedMember("hw-m-mov", domain.MemberHandRight),
		fixedMember("hw-e-fij", domain.MemberHandLeft),
		fixedMember("hw-e-fij", domain.MemberHandRight),
		fixedMember("hw-e-mov", domain.MemberHandLeft),
		fixedMember("hw-e-mov", domain.MemberHandRight),
		{
			MemberID: "tor_fondo",
			Source:   domain.RigidMemberSource{Fixed: &domain.FixedHardwareSource{HardwareID: "hw-tor-fondo"}},
		},
	}

	memberIDs := func(agr domain.Agregado) map[string]int {
		counts := map[string]int{}
		for _, m := range agr.RigidMembers {
			if m.Source.Fixed == nil {
				continue
			}
			counts[m.Source.Fixed.HardwareID]++
		}
		return counts
	}

	agr := domain.Agregado{ID: "agr-gray", Code: "MBOX-IRIDIUM-GRAY-CAJON", RigidMembers: poisonedMembers}

	// Bahía M (108): sólo piezas del kit M + el tornillo sin kit.
	gotM := syncAgregadoRigidMembersFromCatalog(agr, catalog, kitM)
	idsM := memberIDs(gotM)
	if len(idsM) != 3 || idsM["hw-m-fij"] != 2 || idsM["hw-m-mov"] != 2 || idsM["hw-tor-fondo"] != 1 {
		t.Fatalf("bahía M = %v, want {hw-m-fij:2, hw-m-mov:2, hw-tor-fondo:1} — las piezas del kit E deben caer", idsM)
	}

	// Bahía E (209): sólo piezas del kit E + el tornillo.
	gotE := syncAgregadoRigidMembersFromCatalog(agr, catalog, kitE)
	idsE := memberIDs(gotE)
	if len(idsE) != 3 || idsE["hw-e-fij"] != 2 || idsE["hw-e-mov"] != 2 || idsE["hw-tor-fondo"] != 1 {
		t.Fatalf("bahía E = %v, want {hw-e-fij:2, hw-e-mov:2, hw-tor-fondo:1} — las piezas del kit M deben caer", idsE)
	}

	// Agregado sin kit efectivo ("" — p. ej. sólo tableros): nada se filtra.
	gotNone := syncAgregadoRigidMembersFromCatalog(agr, catalog, "")
	if got := len(gotNone.RigidMembers); got != len(poisonedMembers) {
		t.Fatalf("sin kit efectivo members = %d, want %d (sin kit no hay filtro)", got, len(poisonedMembers))
	}

	// Receta limpia (rev 13): el sync MATERIALIZA el kit de la bahía — el
	// comportamiento que ya funcionaba no cambia.
	clean := domain.Agregado{ID: "agr-gray", Code: "MBOX-IRIDIUM-GRAY-CAJON"}
	gotClean := syncAgregadoRigidMembersFromCatalog(clean, catalog, kitM)
	idsClean := memberIDs(gotClean)
	if len(idsClean) != 2 || idsClean["hw-m-fij"] != 2 || idsClean["hw-m-mov"] != 2 {
		t.Fatalf("receta limpia + kit M = %v, want {hw-m-fij:2, hw-m-mov:2} (materialización por variante intacta)", idsClean)
	}
}
