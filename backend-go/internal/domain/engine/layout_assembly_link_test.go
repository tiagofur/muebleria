package engine

// #1464 — la caja del cajón (componentes del agregado) debe viajar con el
// MISMO assemblyInstanceId que sus rieles (assemblies[]), y el frente como
// agregado propio debe llevar placement + assemblyInstanceId. Sin ese enlace
// DoorActors agrupa frente+rieles y la caja queda estática (apertura partida).

import (
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func fixedRail(id string, membership string) domain.AgregadoRigidMember {
	return domain.AgregadoRigidMember{
		MemberID: id,
		Role:     "fixed_rail",
		Source: domain.RigidMemberSource{
			Kind:  domain.RigidMemberSourceFixed,
			Fixed: &domain.FixedHardwareSource{HardwareID: "hw-rail"},
		},
		Placement: domain.AssemblyAnchorRule{
			X: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
			Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
			Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
		},
		BOMRole:         domain.BOMRoleIncludedInKit,
		ActorMembership: membership,
	}
}

func scratchDrawerShapeModule(t *testing.T) (domain.Module, domain.Catalog) {
	t.Helper()
	module := domain.Module{
		ID:          "mod-1",
		Code:        "MOD-BAJ-TEST",
		Name:        "Bajo 3 Cajones Test",
		StructureID: "st-1",
		WidthMm:     600,
		HeightMm:    720,
		DepthMm:     590,
		Agregados: []domain.ModuleAgregadoInstance{
			// Drawer con instance id propio (shape real del owner).
			{ID: "draw-inst-1", AgregadoID: "agr-drawer", Name: "Cajón", Quantity: 1},
			// Frente como agregado propio, SIN instance id (usa el fallback).
			{AgregadoID: "agr-front", Name: "Frente Cajon", Quantity: 1},
		},
	}
	catalog := domain.Catalog{
		Structures: []domain.Structure{{ID: "st-1", Components: []domain.ComponentInstance{}}},
		Components: []domain.Component{
			{ID: "comp-lateral", Code: "COM-LAT", Name: "Lateral", Placement: "lateral_izquierdo", OptionRoles: []string{"INTERIOR"}, Active: true},
			{ID: "comp-front", Code: "COM-FRE-CAJ", Name: "Frente", Placement: "frente_cajon", OptionRoles: []string{"FRENTES"}, Active: true},
		},
		Agregados: []domain.Agregado{
			{
				ID:   "agr-drawer",
				Code: "CAJON", Name: "Cajón",
				CommercialKitHardwareID: kitPtr("kit-1"),
				Components: []domain.ComponentInstance{
					{ComponentID: "comp-lateral", Quantity: 1, PlacementOverride: drawerPlacement("lateral_izquierdo")},
				},
				RigidMembers: []domain.AgregadoRigidMember{
					fixedRail("fixed_rail_left", "body"),
					fixedRail("moving_rail_left", "actor:drawer"),
				},
			},
			{
				ID:   "agr-front",
				Code: "AGR-FRE-CAJ", Name: "Frente Cajon",
				Components: []domain.ComponentInstance{
					{ComponentID: "comp-front", Quantity: 1, PlacementOverride: drawerPlacement("frente_cajon")},
				},
				RigidMembers: []domain.AgregadoRigidMember{},
			},
		},
	}
	return module, catalog
}

func drawerPlacement(p domain.ComponentPlacement) *domain.ComponentPlacement {
	return &p
}

func kitPtr(id string) *string { return &id }

func TestDrawerAssemblyLinksBoxBoardsToRailsAssembly(t *testing.T) {
	module, catalog := scratchDrawerShapeModule(t)
	layout, err := ResolveFurnitureLayout(module, catalog, nil, nil)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}

	asmIDs := map[string]bool{}
	for _, a := range layout.Assemblies {
		asmIDs[a.AssemblyInstanceID] = true
	}
	if len(layout.Assemblies) != 1 {
		t.Fatalf("sólo el agregado con rieles emite ensamble; got %d", len(layout.Assemblies))
	}

	boxLinked := 0
	frontLinked := 0
	for _, c := range layout.Components {
		switch c.SlotID {
		case "lateral_izquierdo":
			// La caja DEBE viajar con el ensamble de sus rieles.
			if c.AssemblyInstanceID == "" || !asmIDs[c.AssemblyInstanceID] {
				t.Fatalf("board de caja %s sin assemblyInstanceId vinculado al ensamble de rieles (got %q)", c.ComponentInstanceID, c.AssemblyInstanceID)
			}
			boxLinked++
		case "frente_cajon":
			// El frente lleva su propio assemblyInstanceId + placement: DoorActors
			// lo toma como frente (early return) y su jaladera lo sigue por host.
			if c.AssemblyInstanceID == "" {
				t.Fatalf("frente %s sin assemblyInstanceId", c.ComponentInstanceID)
			}
			if asmIDs[c.AssemblyInstanceID] {
				t.Fatalf("el frente no debe colgar del ensamble de rieles (got %q)", c.AssemblyInstanceID)
			}
			frontLinked++
		}
	}
	if boxLinked == 0 || frontLinked != 1 {
		t.Fatalf("esperaba caja enlazada (%d) y 1 frente enlazado, got front=%d", boxLinked, frontLinked)
	}
}
