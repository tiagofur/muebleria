package storage_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1398: valid child row ids are CLIENT identity (deterministic fixtures;
// presets are referenced later by project_items.measure_preset_id). A client
// that clones another module without dropping its child ids collides on the
// primary key: the create fails with a typed duplicate-key error naming the
// child insert — never a lost transaction. Ids the client omits are
// generated and echoed back, and UPDATE keeps client ids across edits.
func TestCreateModule_ChildRowIDs(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	store := fixture.store

	const (
		moduleAID    = "a1398000-0000-0000-0000-00000000000a"
		presetAID    = "b1398000-0000-0000-0000-00000000000b"
		hwLineAID    = "c1398000-0000-0000-0000-00000000000c"
		boardPartAID = "e1398000-0000-0000-0000-00000000000e"
		moduleBID    = "d1398000-0000-0000-0000-00000000000d"
		moduleCID    = "f1398000-0000-0000-0000-00000000000f"
	)

	// Explicit valid child ids are honored (deterministic fixture style).
	moduleA := &domain.Module{
		ID: moduleAID, Code: "T1398-A", Name: "Plantilla con hijos",
		WidthMm: 600, HeightMm: 2100, DepthMm: 600,
		Presets:       []domain.DimensionPreset{{ID: presetAID, Name: "Alto 2100", WidthMm: 600, HeightMm: 2100, DepthMm: 600}},
		HardwareLines: []domain.HardwareLine{{ID: hwLineAID, Quantity: 4, OptionRole: "INTERIOR"}},
		BoardParts:    []domain.BoardPart{{ID: boardPartAID, Description: "Costado", Quantity: 2, LengthMm: 2100, WidthMm: 600}},
	}
	if err := isolationRuntimeError(fixture, fixture.actorA, func(txCtx context.Context) error {
		return store.CreateModule(txCtx, moduleA)
	}); err != nil {
		t.Fatalf("create module A with explicit child ids: %v", err)
	}
	if moduleA.Presets[0].ID != presetAID || moduleA.HardwareLines[0].ID != hwLineAID || moduleA.BoardParts[0].ID != boardPartAID {
		t.Fatalf("honored child ids must be echoed, got preset=%s hw=%s part=%s", moduleA.Presets[0].ID, moduleA.HardwareLines[0].ID, moduleA.BoardParts[0].ID)
	}

	// The template-clone pattern drags module A's real child ids: typed
	// duplicate-key failure naming the child insert, nothing more.
	clone := &domain.Module{
		ID: moduleBID, Code: "T1398-B", Name: "Clon que arrastra ids",
		WidthMm: 600, HeightMm: 2100, DepthMm: 600,
		Presets:       []domain.DimensionPreset{{ID: presetAID, Name: "Alto 2100", WidthMm: 600, HeightMm: 2100, DepthMm: 600}},
		HardwareLines: []domain.HardwareLine{{ID: hwLineAID, Quantity: 2, OptionRole: "INTERIOR"}},
		BoardParts:    []domain.BoardPart{{ID: boardPartAID, Description: "Costado clonado", Quantity: 2, LengthMm: 2100, WidthMm: 600}},
	}
	cloneErr := isolationRuntimeError(fixture, fixture.actorA, func(txCtx context.Context) error {
		return store.CreateModule(txCtx, clone)
	})
	if cloneErr == nil {
		t.Fatal("a create dragging another module's child ids must fail")
	}
	var pgErr *pgconn.PgError
	if !errors.As(cloneErr, &pgErr) || pgErr.Code != "23505" {
		t.Fatalf("the collision must surface as a typed duplicate-key error, got %v", cloneErr)
	}
	if !strings.Contains(cloneErr.Error(), "board part") && !strings.Contains(cloneErr.Error(), "hardware line") && !strings.Contains(cloneErr.Error(), "module preset") {
		t.Fatalf("the error must name the failing child insert, got %v", cloneErr)
	}

	// The store is healthy after the failed create: the tenant transaction
	// rolled back cleanly and the next command works.
	afterFailure := &domain.Module{
		ID: moduleCID, Code: "T1398-C", Name: "Después del conflicto",
		WidthMm: 600, HeightMm: 720, DepthMm: 590,
	}
	if err := isolationRuntimeError(fixture, fixture.actorA, func(txCtx context.Context) error {
		return store.CreateModule(txCtx, afterFailure)
	}); err != nil {
		t.Fatalf("create after a failed create must work: %v", err)
	}

	// UPDATE keeps client ids across edits (stable identity).
	current := isolationRuntimeValue(t, fixture, fixture.actorA, func(txCtx context.Context) (*domain.Module, error) {
		return store.GetModuleByID(txCtx, moduleAID)
	})
	renamed := *current
	renamed.Name = "Plantilla renombrada"
	if err := isolationRuntimeError(fixture, fixture.actorA, func(txCtx context.Context) error {
		return store.UpdateModule(txCtx, moduleAID, current.Version, &renamed)
	}); err != nil {
		t.Fatalf("update keeping child ids: %v", err)
	}
	if renamed.Presets[0].ID != presetAID {
		t.Fatalf("update must keep the preset id, got %q", renamed.Presets[0].ID)
	}
}
