package storage_test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #810 — conflict-safe Design WorkingCopy write boundary. The canonical
// workingVersion token (the working-copy updated_at exactly as returned by the
// last authoritative read) is a precondition validated UNDER the authoritative
// write lock: a stale writer receives a typed conflict and the newer server
// state survives intact. The SQL lock alone never proves the second input is
// still current (#679).

type wcBoundarySeed struct {
	fx     *rlsFixture
	fi1    *domain.FurnitureInstance
	fi2    *domain.FurnitureInstance
	design *domain.Design
}

func wcBoundarySetup(t *testing.T, name string) *wcBoundarySeed {
	t.Helper()
	fx := setupDesignsTestFixture(t)
	actorA := fiActorA()

	seed := &wcBoundarySeed{fx: fx}
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		seed.fi1, err = fx.store.CreateFurnitureInstance(ctx, storage.CreateFurnitureInstanceCommand{
			ProjectID:   fiSharedProject,
			Origin:      domain.FurnitureInstanceOriginQuote,
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		seed.fi2, err = fx.store.CreateFurnitureInstance(ctx, storage.CreateFurnitureInstanceCommand{
			ProjectID:   fiSharedProject,
			Origin:      domain.FurnitureInstanceOriginQuote,
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		seed.design, err = fx.store.CreateDesign(ctx, storage.CreateDesignCommand{
			ProjectID:   fiSharedProject,
			Name:        name,
			ActorUserID: rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("seed boundary design: %v", err)
	}
	return seed
}

func wcBoundaryItem(fiID string, width int, tx [3]float64) storage.UpdateDesignWorkingCopyItemCommand {
	return storage.UpdateDesignWorkingCopyItemCommand{
		FurnitureInstanceID: fiID,
		Parameters:          map[string]any{"width": width, "height": 720},
		MaterialChoices:     map[string]string{"carcase": "mdf-18"},
		Transform:           domain.Transform3D{TranslationMm: tx},
	}
}

// expected is the canonical workingVersion token held by the writer: the
// exact updated_at of its last authoritative read.
func wcBoundaryPut(t *testing.T, seed *wcBoundarySeed, expected *time.Time, items ...storage.UpdateDesignWorkingCopyItemCommand) (*domain.DesignWorkingCopy, error) {
	t.Helper()
	return fiTxAnd(t, seed.fx, fiActorA(), func(ctx context.Context) (*domain.DesignWorkingCopy, error) {
		return seed.fx.store.UpdateDesignWorkingCopy(ctx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:               seed.design.ID,
			ExpectedWorkingVersion: expected,
			SourceType:             domain.DesignRevisionSourceSketchup,
			Items:                  items,
			ActorUserID:            rlsUserA,
		})
	})
}

func wcBoundaryRead(t *testing.T, seed *wcBoundarySeed) *domain.DesignWorkingCopy {
	t.Helper()
	wc, err := fiTxAnd(t, seed.fx, fiActorA(), func(ctx context.Context) (*domain.DesignWorkingCopy, error) {
		return seed.fx.store.GetDesignWorkingCopy(ctx, seed.design.ID)
	})
	if err != nil {
		t.Fatalf("read working copy: %v", err)
	}
	return wc
}

func TestDesigns_WorkingCopyWriteBoundary_StaleWriterCannotOverwrite(t *testing.T) {
	seed := wcBoundarySetup(t, "Write Boundary Stale Writer")

	// CreateDesign seeds the working-copy row, so every writer — including
	// the first one — holds the creation token V0 (nothing-to-lose is only a
	// defensive branch for pre-seeding rows).
	w0 := wcBoundaryRead(t, seed)
	w1, err := wcBoundaryPut(t, seed, &w0.UpdatedAt, wcBoundaryItem(seed.fi1.ID, 600, [3]float64{0, 0, 0}))
	if err != nil {
		t.Fatalf("initial working copy write: %v", err)
	}
	v1 := w1.UpdatedAt

	// A and B both read W1 (they hold the same V1 token).
	// A writes W2 from V1: fi1 resized + fi2 added.
	_, err = wcBoundaryPut(t, seed, &v1,
		wcBoundaryItem(seed.fi1.ID, 800, [3]float64{0, 0, 0}),
		wcBoundaryItem(seed.fi2.ID, 600, [3]float64{500, 0, 0}))
	if err != nil {
		t.Fatalf("writer A from V1: %v", err)
	}

	// B writes from the SAME V1 with a divergent intent: typed conflict, and
	// W2 must survive intact.
	_, err = wcBoundaryPut(t, seed, &v1, wcBoundaryItem(seed.fi1.ID, 999, [3]float64{0, 0, 0}))
	if !errors.Is(err, storage.ErrWorkingCopyVersionConflict) {
		t.Fatalf("stale writer B error = %v, want ErrWorkingCopyVersionConflict", err)
	}

	w2, err := fiTxAnd(t, seed.fx, fiActorA(), func(ctx context.Context) (*domain.DesignWorkingCopy, error) {
		return seed.fx.store.GetDesignWorkingCopy(ctx, seed.design.ID)
	})
	if err != nil {
		t.Fatalf("readback W2: %v", err)
	}
	if len(w2.Items) != 2 {
		t.Fatalf("W2 items len = %d, want 2 (stale writer must not overwrite)", len(w2.Items))
	}
	fi1Item := w2.Items[0]
	if fi1Item.Parameters["width"] != float64(800) {
		t.Fatalf("W2 fi1 width = %v, want 800 (writer A's accepted state)", fi1Item.Parameters["width"])
	}
	if !w2.UpdatedAt.After(v1) {
		t.Fatalf("W2 updated_at %v not after V1 %v", w2.UpdatedAt, v1)
	}

	// The conflict above happened with ZERO new DesignRevisions: same
	// baseRevisionId, purely version-detected (#679 requirement).
	ctx := context.Background()
	var revCount int
	if err := seed.fx.admin.QueryRow(ctx, `SELECT count(*) FROM design_revisions WHERE design_id = $1`, seed.design.ID).Scan(&revCount); err != nil || revCount != 0 {
		t.Fatalf("design_revisions count = %d, want 0 (err=%v)", revCount, err)
	}
}

func TestDesigns_WorkingCopyWriteBoundary_PreconditionRequired(t *testing.T) {
	seed := wcBoundarySetup(t, "Write Boundary Precondition")
	seeded := wcBoundaryRead(t, seed)

	// The seeded row exists: writing without the canonical token is
	// rejected — no blind legacy PUT path survives (#810 negative proof).
	_, err := wcBoundaryPut(t, seed, nil, wcBoundaryItem(seed.fi1.ID, 700, [3]float64{0, 0, 0}))
	if !errors.Is(err, storage.ErrWorkingCopyPreconditionRequired) {
		t.Fatalf("missing precondition error = %v, want ErrWorkingCopyPreconditionRequired", err)
	}

	// A zero token means the caller last read an ABSENT working copy; a row
	// existing now is a diverged state, not a satisfiable precondition.
	zero := time.Time{}
	_, err = wcBoundaryPut(t, seed, &zero, wcBoundaryItem(seed.fi1.ID, 700, [3]float64{0, 0, 0}))
	if !errors.Is(err, storage.ErrWorkingCopyVersionConflict) {
		t.Fatalf("zero-token error = %v, want ErrWorkingCopyVersionConflict", err)
	}

	// State is untouched by both rejected writes.
	w2 := wcBoundaryRead(t, seed)
	if len(w2.Items) != 0 {
		t.Fatalf("working copy mutated by rejected writes: %+v", w2.Items)
	}
	if !w2.UpdatedAt.Equal(seeded.UpdatedAt) {
		t.Fatalf("updated_at changed on rejected writes: %v -> %v", seeded.UpdatedAt, w2.UpdatedAt)
	}
}

func TestDesigns_WorkingCopyWriteBoundary_ItemRemovalKeepsProjectInstances(t *testing.T) {
	seed := wcBoundarySetup(t, "Write Boundary Removal")
	w0 := wcBoundaryRead(t, seed)

	w1, err := wcBoundaryPut(t, seed, &w0.UpdatedAt,
		wcBoundaryItem(seed.fi1.ID, 600, [3]float64{0, 0, 0}),
		wcBoundaryItem(seed.fi2.ID, 600, [3]float64{500, 0, 0}))
	if err != nil {
		t.Fatalf("seed two items: %v", err)
	}

	// Design-intent delete (#810 Caso 1): the working copy drops FI-002…
	_, err = wcBoundaryPut(t, seed, &w1.UpdatedAt, wcBoundaryItem(seed.fi1.ID, 600, [3]float64{0, 0, 0}))
	if err != nil {
		t.Fatalf("remove fi2 from working copy: %v", err)
	}

	w2, err := fiTxAnd(t, seed.fx, fiActorA(), func(ctx context.Context) (*domain.DesignWorkingCopy, error) {
		return seed.fx.store.GetDesignWorkingCopy(ctx, seed.design.ID)
	})
	if err != nil {
		t.Fatalf("readback: %v", err)
	}
	if len(w2.Items) != 1 || w2.Items[0].FurnitureInstanceID != seed.fi1.ID {
		t.Fatalf("working copy after removal = %+v, want only fi1", w2.Items)
	}

	// …but the Project FurnitureInstance identity survives untouched: the
	// panel can derive FI-002 as pending again and re-place reuses it.
	ctx := context.Background()
	var fi2Status string
	err = seed.fx.admin.QueryRow(ctx,
		`SELECT lifecycle_status FROM furniture_instances WHERE id = $1`, seed.fi2.ID).Scan(&fi2Status)
	if err != nil {
		t.Fatalf("fi2 row after design removal: %v", err)
	}
	if fi2Status != string(domain.FurnitureInstanceLifecycleActive) {
		t.Fatalf("fi2 lifecycle = %q, want active (Project owns identity)", fi2Status)
	}
}

func TestDesigns_WorkingCopyWriteBoundary_ConcurrentWriters(t *testing.T) {
	seed := wcBoundarySetup(t, "Write Boundary Concurrent")
	w0 := wcBoundaryRead(t, seed)

	w1, err := wcBoundaryPut(t, seed, &w0.UpdatedAt, wcBoundaryItem(seed.fi1.ID, 600, [3]float64{0, 0, 0}))
	if err != nil {
		t.Fatalf("initial working copy write: %v", err)
	}
	stamp := w1.UpdatedAt

	const concurrency = 5
	var wg sync.WaitGroup
	start := make(chan struct{})
	errs := make([]error, concurrency)

	for i := 0; i < concurrency; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			<-start
			errs[idx] = fiTx(t, seed.fx.store, fiActorA(), func(ctx context.Context) error {
				expected := stamp
				_, pErr := seed.fx.store.UpdateDesignWorkingCopy(ctx, storage.UpdateDesignWorkingCopyCommand{
					DesignID:               seed.design.ID,
					ExpectedWorkingVersion: &expected,
					SourceType:             domain.DesignRevisionSourceSketchup,
					Items: []storage.UpdateDesignWorkingCopyItemCommand{
						wcBoundaryItem(seed.fi1.ID, 600+idx, [3]float64{float64(idx * 100), 0, 0}),
					},
					ActorUserID: rlsUserA,
				})
				return pErr
			})
		}(i)
	}
	close(start)
	wg.Wait()

	successCount, conflictCount := 0, 0
	for i := 0; i < concurrency; i++ {
		switch {
		case errs[i] == nil:
			successCount++
		case errors.Is(errs[i], storage.ErrWorkingCopyVersionConflict):
			conflictCount++
		default:
			t.Fatalf("unexpected error in goroutine %d: %v", i, errs[i])
		}
	}
	if successCount != 1 || conflictCount != concurrency-1 {
		t.Fatalf("concurrent writes: success=%d conflict=%d, want 1 success and %d conflicts",
			successCount, conflictCount, concurrency-1)
	}

	// The surviving state is exactly one accepted write, not a blend.
	final, err := fiTxAnd(t, seed.fx, fiActorA(), func(ctx context.Context) (*domain.DesignWorkingCopy, error) {
		return seed.fx.store.GetDesignWorkingCopy(ctx, seed.design.ID)
	})
	if err != nil {
		t.Fatalf("final readback: %v", err)
	}
	if len(final.Items) != 1 {
		t.Fatalf("final items len = %d, want 1", len(final.Items))
	}
}

func TestDesigns_WorkingCopyWriteBoundary_ResetRequiresCurrentVersion(t *testing.T) {
	seed := wcBoundarySetup(t, "Write Boundary Reset")
	w0 := wcBoundaryRead(t, seed)

	w1, err := wcBoundaryPut(t, seed, &w0.UpdatedAt, wcBoundaryItem(seed.fi1.ID, 600, [3]float64{0, 0, 0}))
	if err != nil {
		t.Fatalf("initial working copy write: %v", err)
	}

	var rev1 *domain.DesignRevision
	err = fiTx(t, seed.fx.store, fiActorA(), func(ctx context.Context) error {
		var pErr error
		rev1, pErr = seed.fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID:    seed.design.ID,
			SourceType:  domain.DesignRevisionSourceManual,
			ActorUserID: rlsUserA,
		})
		return pErr
	})
	if err != nil {
		t.Fatalf("publish R1: %v", err)
	}

	// Reset from a stale token: typed conflict, current state intact.
	stale := w1.UpdatedAt
	err = fiTx(t, seed.fx.store, fiActorA(), func(ctx context.Context) error {
		_, rErr := seed.fx.store.ResetDesignWorkingCopy(ctx, storage.ResetDesignWorkingCopyCommand{
			DesignID:               seed.design.ID,
			RevisionID:             rev1.ID,
			ExpectedWorkingVersion: &stale,
			ActorUserID:            rlsUserA,
		})
		return rErr
	})
	if !errors.Is(err, storage.ErrWorkingCopyVersionConflict) {
		t.Fatalf("reset with stale token error = %v, want ErrWorkingCopyVersionConflict", err)
	}

	// A missing token on reset is equally rejected.
	err = fiTx(t, seed.fx.store, fiActorA(), func(ctx context.Context) error {
		_, rErr := seed.fx.store.ResetDesignWorkingCopy(ctx, storage.ResetDesignWorkingCopyCommand{
			DesignID:    seed.design.ID,
			RevisionID:  rev1.ID,
			ActorUserID: rlsUserA,
		})
		return rErr
	})
	if !errors.Is(err, storage.ErrWorkingCopyPreconditionRequired) {
		t.Fatalf("reset without token error = %v, want ErrWorkingCopyPreconditionRequired", err)
	}

	// Reset from the CURRENT authoritative token succeeds.
	current, err := fiTxAnd(t, seed.fx, fiActorA(), func(ctx context.Context) (*domain.DesignWorkingCopy, error) {
		return seed.fx.store.GetDesignWorkingCopy(ctx, seed.design.ID)
	})
	if err != nil {
		t.Fatalf("current working copy read: %v", err)
	}
	stamp := current.UpdatedAt
	_, err = fiTxAnd(t, seed.fx, fiActorA(), func(ctx context.Context) (*domain.DesignWorkingCopy, error) {
		return seed.fx.store.ResetDesignWorkingCopy(ctx, storage.ResetDesignWorkingCopyCommand{
			DesignID:               seed.design.ID,
			RevisionID:             rev1.ID,
			ExpectedWorkingVersion: &stamp,
			ActorUserID:            rlsUserA,
		})
	})
	if err != nil {
		t.Fatalf("reset with current token: %v", err)
	}
}
