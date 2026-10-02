package storage_test

import (
	"context"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #977 — deleting a unit in SketchUp drops its design working item (#810
// Caso 1). The authored state (parameters, choices, #784 lineage modes) must
// not die with the row: the same update transaction captures it onto the
// FurnitureInstance, and the list endpoint the placement flow consumes reads
// it back. Version/updated_at stay untouched: a background sync can never
// poison a concurrent instance command's If-Match.
func TestUpdateDesignWorkingCopyDroppedItemSnapshotsAuthoringState(t *testing.T) {
	seed := dadSetup(t, "authoring-snapshot-drop")

	choices := map[string]string{"FRENTES": "mat-frentes", "INTERIOR": "mat-interior"}
	modes := map[string]domain.DesignMaterialChoiceMode{"FRENTES": domain.DesignMaterialChoiceModeOverride, "INTERIOR": domain.DesignMaterialChoiceModeDesign}
	authored := storage.UpdateDesignWorkingCopyItemCommand{
		FurnitureInstanceID: seed.fi1.ID,
		Parameters:          map[string]any{"widthMm": 450.0, "heightMm": 720.0, "depthMm": 590.0},
		MaterialChoices:     choices,
		MaterialChoiceModes: modes,
		Transform:           domain.Transform3D{TranslationMm: [3]float64{10, 20, 30}},
	}
	if _, err := dadPut(t, seed, nil, authored); err != nil {
		t.Fatalf("seed authored item: %v", err)
	}
	before, err := fiTxAnd(t, seed.fx, fiActorA(), func(ctx context.Context) (*domain.FurnitureInstance, error) {
		return seed.fx.store.GetFurnitureInstanceByID(ctx, seed.fi1.ID)
	})
	if err != nil {
		t.Fatalf("read instance before drop: %v", err)
	}

	// The conscious delete intent: the next sync PUTs the working copy
	// without the item (the local root is gone).
	if _, err := dadPut(t, seed, nil); err != nil {
		t.Fatalf("drop item: %v", err)
	}

	if got := len(dadRead(t, seed).Items); got != 0 {
		t.Fatalf("working copy items = %d, want 0", got)
	}

	summaries, err := fiTxAnd(t, seed.fx, fiActorA(), func(ctx context.Context) ([]storage.FurnitureInstanceSummary, error) {
		return seed.fx.store.ListFurnitureInstanceSummariesByProject(ctx, fiSharedProject, true)
	})
	if err != nil {
		t.Fatalf("list summaries: %v", err)
	}
	var snapshot *domain.FurnitureInstanceAuthoringSnapshot
	var after *domain.FurnitureInstance
	for _, summary := range summaries {
		if summary.Instance.ID == seed.fi1.ID {
			snapshot = summary.Instance.AuthoringSnapshot
		}
	}
	if snapshot == nil {
		t.Fatalf("dropped item left no authoring snapshot on the instance")
	}
	for key, want := range map[string]any{"widthMm": 450.0, "heightMm": 720.0, "depthMm": 590.0} {
		if got := snapshot.Parameters[key]; got != want {
			t.Fatalf("snapshot parameter %s = %v, want %v", key, got, want)
		}
	}
	if got := snapshot.MaterialChoices["FRENTES"]; got != "mat-frentes" {
		t.Fatalf("snapshot FRENTES = %q, want mat-frentes", got)
	}
	if got := snapshot.MaterialChoiceModes["INTERIOR"]; got != domain.DesignMaterialChoiceModeDesign {
		t.Fatalf("snapshot INTERIOR mode = %q, want design", got)
	}

	// Internal plumbing: the optimistic token and timestamps of the identity
	// row never move for a snapshot write.
	after, err = fiTxAnd(t, seed.fx, fiActorA(), func(ctx context.Context) (*domain.FurnitureInstance, error) {
		return seed.fx.store.GetFurnitureInstanceByID(ctx, seed.fi1.ID)
	})
	if err != nil {
		t.Fatalf("read instance after drop: %v", err)
	}
	if after.Version != before.Version || !after.UpdatedAt.Equal(before.UpdatedAt) {
		t.Fatalf("snapshot write moved identity state: version %d→%d updatedAt %s→%s",
			before.Version, after.Version, before.UpdatedAt, after.UpdatedAt)
	}
}

// A kept item must not produce (or refresh) a snapshot: the snapshot is the
// delete→re-place fallback only, and the live item stays the truth.
func TestUpdateDesignWorkingCopyKeptItemWritesNoSnapshot(t *testing.T) {
	seed := dadSetup(t, "authoring-snapshot-kept")

	if _, err := dadPut(t, seed, nil,
		dadItem(seed.fi1.ID, map[string]string{"INTERIOR": "mat-blanco"}, nil)); err != nil {
		t.Fatalf("seed item: %v", err)
	}

	summaries, err := fiTxAnd(t, seed.fx, fiActorA(), func(ctx context.Context) ([]storage.FurnitureInstanceSummary, error) {
		return seed.fx.store.ListFurnitureInstanceSummariesByProject(ctx, fiSharedProject, true)
	})
	if err != nil {
		t.Fatalf("list summaries: %v", err)
	}
	for _, summary := range summaries {
		if summary.Instance.ID == seed.fi1.ID && summary.Instance.AuthoringSnapshot != nil {
			t.Fatalf("kept item wrote an authoring snapshot: %+v", summary.Instance.AuthoringSnapshot)
		}
	}
}
