package storage_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1416: a POST that carries a recipe must NOT lose it. Before the fix, the
// API layer validated the recipe (422 on invalid since #1412) and then
// CreateAgregado silently dropped it — the agregado was born blind. Legacy
// creates without a recipe keep the exact previous behavior (no revision row).
func TestCreateAgregado_PersistsRecipeAsRevisionOneWhenPresent(t *testing.T) {
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor
	id := fmt.Sprintf("create-recipe-agregado-%d", time.Now().UnixNano())
	// Sin cleanup: este test corre sobre una DB desechable fresca (migraciones
	// por test) y la revisión es INMUTABLE una vez escrita (trigger P0001) —
	// borrarla en cleanup es imposible por diseño (#1168).

	kitID := "kit-create-recipe"
	in := &domain.Agregado{
		ID:      id,
		Code:    fmt.Sprintf("CREATE-RECIPE-%d", time.Now().UnixNano()),
		Name:    "Cajón con receta al nacer",
		Active:  true,
		WidthMm: 400, HeightMm: 150, DepthMm: 500,
		CommercialKitHardwareID: &kitID,
		RigidMembers: []domain.AgregadoRigidMember{
			{
				MemberID: "fixed_rail_left",
				Role:     "fixed_rail",
				Source: domain.RigidMemberSource{
					Kind:  domain.RigidMemberSourceFixed,
					Fixed: &domain.FixedHardwareSource{HardwareID: "hw-design-left"},
				},
				Placement: domain.AssemblyAnchorRule{
					X: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 10},
					Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 0},
					Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 0},
				},
				BOMRole:         domain.BOMRoleIncludedInKit,
				ActorMembership: "body",
			},
		},
	}
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.CreateAgregado(txCtx, in)
	})

	got := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Agregado, error) {
		return store.GetAgregadoByIDWithRecipe(txCtx, id)
	})
	if got.CurrentRevisionID == nil || *got.CurrentRevisionID == "" {
		t.Fatal("create with recipe must pin a current revision (born blind otherwise)")
	}
	if len(got.RigidMembers) != 1 || got.RigidMembers[0].MemberID != "fixed_rail_left" {
		t.Fatalf("recipe lost on create: %+v", got.RigidMembers)
	}
	if got.CommercialKitHardwareID == nil || *got.CommercialKitHardwareID != kitID {
		t.Fatalf("commercial kit lost on create: %+v", got.CommercialKitHardwareID)
	}
	if got.RigidMembers[0].ActorMembership != "body" {
		t.Fatalf("actor membership lost on create: %+v", got.RigidMembers[0].ActorMembership)
	}
}

func TestCreateAgregado_LegacyWithoutRecipeKeepsNoRevisionRow(t *testing.T) {
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor
	id := "create-legacy-agregado"
	t.Cleanup(func() { cleanupConnectStoreFixture(t, `DELETE FROM agregados WHERE id = $1`, id) })

	in := &domain.Agregado{ID: id, Code: fmt.Sprintf("CREATE-LEGACY-%d", time.Now().UnixNano()), Name: "Legacy sin receta", Active: true}
	withinConnectStoreTenant(t, store, actor, func(txCtx context.Context) error {
		return store.CreateAgregado(txCtx, in)
	})

	got := withinConnectStoreTenantValue(t, store, actor, func(txCtx context.Context) (*domain.Agregado, error) {
		return store.GetAgregadoByIDWithRecipe(txCtx, id)
	})
	if got.CurrentRevisionID != nil {
		t.Fatalf("legacy create must not allocate a revision (got %v)", *got.CurrentRevisionID)
	}
	if len(got.RigidMembers) != 0 {
		t.Fatalf("legacy create must not invent members: %+v", got.RigidMembers)
	}
}
