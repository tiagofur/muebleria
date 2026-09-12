package storage_test

import (
	"context"
	"errors"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #642 legacy recovery storage proofs against real PostgreSQL. A legacy
// revision (pre-#642 row shape: items persisted, commercial snapshot honestly
// NULL) is never mutated, backfilled or replaced: modernization mints the NEXT
// revision from the project's current editable commercial state with a fresh
// canonical snapshot, pinned to the exact legacy latest as its base.

// seedLegacyQuoteRevision materializes the fixture line's physical units and
// inserts a snapshot-less legacy revision over them, optionally advanced to
// published/accepted through direct SQL lifecycle transitions (the modern
// commands refuse snapshot-less rows — these rows only exist pre-migration).
func seedLegacyQuoteRevision(t *testing.T, fx *quoteLifecycleFixture, advanceTo string) *domain.QuoteRevision {
	t.Helper()
	actorA := fiActorA()

	var materialized *domain.QuoteLineMaterialization
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		materialized, err = fx.store.MaterializeQuoteLine(ctx, storage.MaterializeQuoteLineCommand{
			ProjectID:   fx.projectID,
			QuoteLineID: csLine,
			ActorUserID: rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("materialize legacy line: %v", err)
	}

	// The migration suite proves this row shape predates migration 000130.
	// This current-schema fixture temporarily bypasses only the post-migration
	// guards (INSERT snapshot requirement, snapshot-less transition backstop)
	// to synthesize the preserved pre-#642 row — including its lifecycle
	// state — and exercise application behavior over it.
	if _, err := fx.admin.Exec(context.Background(),
		`ALTER TABLE quote_revisions DISABLE TRIGGER protect_quote_revisions_immutable`); err != nil {
		t.Fatalf("disable trigger for legacy fixture: %v", err)
	}
	var legacy *domain.QuoteRevision
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		items := make([]storage.CreateQuoteRevisionItemCommand, 0, len(materialized.Instances))
		for _, instance := range materialized.Instances {
			items = append(items, storage.CreateQuoteRevisionItemCommand{
				FurnitureInstanceID: instance.FurnitureInstanceID,
				QuoteLineID:         csLine,
				FurnitureDefinitionID: csModule,
				Parameters:          map[string]any{},
				MaterialChoices:     map[string]string{"INTERIOR": csMaterial},
				LifecycleStatus:     "active",
			})
		}
		var err error
		legacy, err = fx.store.CreateQuoteRevision(ctx, storage.CreateQuoteRevisionCommand{
			ProjectID: fx.projectID,
			Status:    "draft",
			Items:     items,
		})
		return err
	})
	if err != nil {
		t.Fatalf("seed legacy revision: %v", err)
	}

	for _, transition := range []string{
		"UPDATE quote_revisions SET status='published', published_at=NOW() WHERE id='" + legacy.ID + "'",
		"UPDATE quote_revisions SET status='accepted', accepted_at=NOW() WHERE id='" + legacy.ID + "'",
	} {
		needed := advanceTo == "accepted" ||
			(advanceTo == "published" && transition == "published")
		if !needed {
			continue
		}
		if _, err := fx.admin.Exec(context.Background(), transition); err != nil {
			t.Fatalf("advance legacy revision to %s: %v", advanceTo, err)
		}
	}
	if _, enableErr := fx.admin.Exec(context.Background(),
		`ALTER TABLE quote_revisions ENABLE TRIGGER protect_quote_revisions_immutable`); enableErr != nil {
		t.Fatalf("re-enable trigger after legacy fixture: %v", enableErr)
	}
	return legacy
}

func legacyRevisionRowJSON(t *testing.T, fx *quoteLifecycleFixture, revisionID string) string {
	t.Helper()
	var raw string
	if err := fx.admin.QueryRow(context.Background(),
		`SELECT to_jsonb(qr)::text FROM quote_revisions qr WHERE id = $1`, revisionID,
	).Scan(&raw); err != nil {
		t.Fatalf("read legacy revision row: %v", err)
	}
	return raw
}

func legacyItemCount(t *testing.T, fx *quoteLifecycleFixture, revisionID string) int {
	t.Helper()
	var count int
	if err := fx.admin.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM quote_revision_items WHERE quote_revision_id = $1`, revisionID,
	).Scan(&count); err != nil {
		t.Fatalf("count legacy items: %v", err)
	}
	return count
}

// Test D — modernization from a legacy draft: the next revision carries a
// canonical snapshot from the CURRENT editable state, pins the legacy latest
// as base, and leaves the legacy row byte-identical.
func TestQuoteLegacyRecovery_ModernizeFromLegacyDraft(t *testing.T) {
	fx := setupCommercialSnapshotFixture(t)
	actorA := fiActorA()
	legacy := seedLegacyQuoteRevision(t, fx, "draft")
	legacyBefore := legacyRevisionRowJSON(t, fx, legacy.ID)
	legacyItemsBefore := legacyItemCount(t, fx, legacy.ID)

	var modern *storage.CreateInitialQuoteRevisionResult
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		modern, err = fx.store.CreateInitialQuoteRevision(ctx, storage.CreateInitialQuoteRevisionCommand{
			ProjectID:           fx.projectID,
			BaseQuoteRevisionID: legacy.ID,
			ActorUserID:         rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("modernize legacy draft: %v", err)
	}
	if modern.Revision.RevisionNumber != 2 || modern.Revision.Status != "draft" {
		t.Fatalf("modern revision must be Q2 draft, got Q%d %s", modern.Revision.RevisionNumber, modern.Revision.Status)
	}
	if modern.Revision.BaseQuoteRevisionID != legacy.ID {
		t.Fatalf("modern revision must pin the legacy latest as base, got %s", modern.Revision.BaseQuoteRevisionID)
	}
	if modern.Revision.CommercialSnapshot == nil {
		t.Fatal("modern revision must freeze a canonical commercial snapshot")
	}

	// The legacy revision stays byte-identical — no backfill, no mutation.
	if got := legacyRevisionRowJSON(t, fx, legacy.ID); got != legacyBefore {
		t.Fatalf("legacy revision mutated by modernization:\nbefore %s\nafter  %s", legacyBefore, got)
	}
	if got := legacyItemCount(t, fx, legacy.ID); got != legacyItemsBefore {
		t.Fatalf("legacy items mutated: %d → %d", legacyItemsBefore, got)
	}

	// The modern revision continues through the normal lifecycle.
	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		if _, err := fx.store.PublishQuoteRevision(ctx, storage.QuoteRevisionLifecycleCommand{
			ProjectID:       fx.projectID,
			QuoteRevisionID: modern.Revision.ID,
		}); err != nil {
			return err
		}
		_, err := fx.store.AcceptQuoteRevision(ctx, storage.QuoteRevisionLifecycleCommand{
			ProjectID:       fx.projectID,
			QuoteRevisionID: modern.Revision.ID,
		})
		return err
	})
	if err != nil {
		t.Fatalf("modern revision lifecycle: %v", err)
	}
}

// Test E — a legacy ACCEPTED baseline modernizes without touching its status:
// the new draft is minted from current state, and accepting it supersedes the
// legacy accepted baseline through the normal atomic transition.
func TestQuoteLegacyRecovery_ModernizeFromLegacyAccepted(t *testing.T) {
	fx := setupCommercialSnapshotFixture(t)
	actorA := fiActorA()
	legacy := seedLegacyQuoteRevision(t, fx, "accepted")
	legacyItemsBefore := legacyItemCount(t, fx, legacy.ID)

	var modern *storage.CreateInitialQuoteRevisionResult
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		modern, err = fx.store.CreateInitialQuoteRevision(ctx, storage.CreateInitialQuoteRevisionCommand{
			ProjectID:           fx.projectID,
			BaseQuoteRevisionID: legacy.ID,
			ActorUserID:         rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("modernize legacy accepted: %v", err)
	}
	if modern.Revision.CommercialSnapshot == nil || modern.Revision.RevisionNumber != 2 {
		t.Fatalf("modern revision must be a snapshot-carrying Q2, got Q%d snapshot=%v",
			modern.Revision.RevisionNumber, modern.Revision.CommercialSnapshot != nil)
	}

	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		if _, err := fx.store.PublishQuoteRevision(ctx, storage.QuoteRevisionLifecycleCommand{
			ProjectID:       fx.projectID,
			QuoteRevisionID: modern.Revision.ID,
		}); err != nil {
			return err
		}
		accepted, err := fx.store.AcceptQuoteRevision(ctx, storage.QuoteRevisionLifecycleCommand{
			ProjectID:       fx.projectID,
			QuoteRevisionID: modern.Revision.ID,
		})
		if err != nil {
			return err
		}
		if len(accepted.SupersededRevisions) != 1 || accepted.SupersededRevisions[0].ID != legacy.ID {
			return errors.New("accepting the modern revision must supersede exactly the legacy accepted baseline")
		}
		return nil
	})
	if err != nil {
		t.Fatalf("modern lifecycle supersedes legacy accepted: %v", err)
	}

	// The legacy row only moved through its OWN lifecycle (accepted stays
	// accepted with its original timestamps; supersede is status-only) — its
	// snapshot is still NULL and its items are intact.
	var status string
	var snapshot *string
	if err := fx.admin.QueryRow(context.Background(),
		`SELECT status, commercial_snapshot::text FROM quote_revisions WHERE id = $1`, legacy.ID,
	).Scan(&status, &snapshot); err != nil {
		t.Fatalf("read legacy after supersede: %v", err)
	}
	if status != "superseded" || snapshot != nil {
		t.Fatalf("legacy must be superseded with snapshot still NULL, got status=%s snapshot=%v", status, snapshot)
	}
	if got := legacyItemCount(t, fx, legacy.ID); got != legacyItemsBefore {
		t.Fatalf("legacy items mutated: %d → %d", legacyItemsBefore, got)
	}
}

// A latest revision that already carries canonical truth is NOT legacy: the
// modernize command rejects typed — requote owns that continuation.
func TestQuoteLegacyRecovery_ModernizeRejectsModernLatest(t *testing.T) {
	fx := setupCommercialSnapshotFixture(t)
	actorA := fiActorA()

	var modern *domain.QuoteRevision
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		created, err := fx.store.CreateInitialQuoteRevision(ctx, storage.CreateInitialQuoteRevisionCommand{
			ProjectID:   fx.projectID,
			ActorUserID: rlsUserA,
		})
		modern = created.Revision
		return err
	})
	if err != nil {
		t.Fatalf("create modern Q1: %v", err)
	}

	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.CreateInitialQuoteRevision(ctx, storage.CreateInitialQuoteRevisionCommand{
			ProjectID:           fx.projectID,
			BaseQuoteRevisionID: modern.ID,
			ActorUserID:         rlsUserA,
		})
		return err
	})
	if !errors.Is(err, domain.ErrQuoteRevisionNotLegacy) {
		t.Fatalf("modern latest must reject modernization typed, got %v", err)
	}
}

// Base discipline: a stale base and a baseless create over an existing legacy
// latest both answer the typed optimistic-concurrency conflict.
func TestQuoteLegacyRecovery_BaseConcurrencyFailClosed(t *testing.T) {
	fx := setupCommercialSnapshotFixture(t)
	actorA := fiActorA()
	seedLegacyQuoteRevision(t, fx, "draft")

	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.CreateInitialQuoteRevision(ctx, storage.CreateInitialQuoteRevisionCommand{
			ProjectID:           fx.projectID,
			BaseQuoteRevisionID: "7eeeeeee-0000-0000-0000-00000000000e",
			ActorUserID:         rlsUserA,
		})
		return err
	})
	if !errors.Is(err, domain.ErrQuoteRevisionConflict) {
		t.Fatalf("stale base must reject with the typed conflict, got %v", err)
	}

	err = fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, err := fx.store.CreateInitialQuoteRevision(ctx, storage.CreateInitialQuoteRevisionCommand{
			ProjectID:   fx.projectID,
			ActorUserID: rlsUserA,
		})
		return err
	})
	if !errors.Is(err, domain.ErrQuoteRevisionConflict) {
		t.Fatalf("baseless create over existing revisions must reject typed, got %v", err)
	}
}
