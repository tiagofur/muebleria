package storage

import (
	"context"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1052 slice 1: the construction block round-trips through the components
// table; an empty block never persists (NULL), and clearing it on update
// stores NULL again.
func TestComponentConstruction_roundTrip(t *testing.T) {
	store := newMigratedRuntimeStore(t)
	code := "CMP-CONST-" + time.Now().Format("20060102-150405.000000")

	comp := &domain.Component{
		Code: code, Name: "Piso Construcción", Placement: domain.PlacementInterno,
		GeometryKind: "rectangular_board", LengthMm: 568, WidthMm: 560, ThicknessMm: 18,
		OptionRoles: []string{"INTERIOR"}, Active: true,
		Construction: &domain.ComponentConstruction{
			ConstructiveRole: "horizontal",
			ConnectionFaces:  []string{"left", "right"},
			JoinerySystemID:  "screw-only",
		},
	}
	withinInitialOrganization(t, store, func(txCtx context.Context) error { return store.CreateComponent(txCtx, comp) })
	t.Cleanup(func() {
		withinInitialOrganization(t, store, func(txCtx context.Context) error { return store.DeleteComponent(txCtx, comp.ID, comp.Version) })
	})

	var loaded *domain.Component
	withinInitialOrganization(t, store, func(txCtx context.Context) error {
		var err error
		loaded, err = store.GetComponentByID(txCtx, comp.ID)
		return err
	})
	if loaded.Construction == nil {
		t.Fatal("construction block must survive create+get")
	}
	if loaded.Construction.ConstructiveRole != "horizontal" ||
		loaded.Construction.JoinerySystemID != "screw-only" ||
		len(loaded.Construction.ConnectionFaces) != 2 ||
		loaded.Construction.ConnectionFaces[0] != "left" ||
		loaded.Construction.ConnectionFaces[1] != "right" {
		t.Fatalf("construction mismatch: %+v", loaded.Construction)
	}

	var list []domain.Component
	withinInitialOrganization(t, store, func(txCtx context.Context) error {
		var err error
		list, err = store.ListComponents(txCtx)
		return err
	})
	var listed *domain.Component
	for i := range list {
		if list[i].ID == comp.ID {
			listed = &list[i]
			break
		}
	}
	if listed == nil || listed.Construction == nil {
		t.Fatal("construction block must survive list")
	}

	// Clearing the block stores NULL (no phanthom override).
	comp.Construction = nil
	withinInitialOrganization(t, store, func(txCtx context.Context) error { return store.UpdateComponent(txCtx, comp.ID, comp.Version, comp) })
	var cleared *domain.Component
	withinInitialOrganization(t, store, func(txCtx context.Context) error {
		var err error
		cleared, err = store.GetComponentByID(txCtx, comp.ID)
		return err
	})
	if cleared.Construction != nil {
		t.Fatalf("cleared block must read nil, got %+v", cleared.Construction)
	}

	// An all-empty block normalizes to NULL on write.
	comp.Construction = &domain.ComponentConstruction{}
	withinInitialOrganization(t, store, func(txCtx context.Context) error { return store.UpdateComponent(txCtx, comp.ID, comp.Version, comp) })
	var empty *domain.Component
	withinInitialOrganization(t, store, func(txCtx context.Context) error {
		var err error
		empty, err = store.GetComponentByID(txCtx, comp.ID)
		return err
	})
	if empty.Construction != nil {
		t.Fatalf("empty block must normalize to nil, got %+v", empty.Construction)
	}
}
