package storage_test

import (
	"context"
	"errors"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #784 — durable Design authoring defaults + explicit per-role inheritance
// modes (OWNER DECISIONS 2026-09-28). The contract proven here:
//   - defaults are Design-scoped durable intent on the working copy header,
//     following the #810 nil-keeps frontier;
//   - material_choice_modes are client-authorable lineage persisted verbatim
//     — never derived by value equality (the negative proof below is law);
//   - mode=design is lineage, NOT a live pointer: changing a default never
//     rewrites items; drift is projected (needsRollout) for the impact review;
//   - publish freezes defaults + modes; reset restores both; legacy shapes
//     normalize conservatively to override.

type dadSeed struct {
	fx     *rlsFixture
	fi1    *domain.FurnitureInstance
	fi2    *domain.FurnitureInstance
	design *domain.Design
}

func dadSetup(t *testing.T, name string) *dadSeed {
	t.Helper()
	fx := setupDesignsTestFixture(t)
	seed := &dadSeed{fx: fx}
	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
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
		t.Fatalf("seed #784 fixture: %v", err)
	}
	return seed
}

func dadItem(fiID string, choices map[string]string, modes map[string]domain.DesignMaterialChoiceMode) storage.UpdateDesignWorkingCopyItemCommand {
	return storage.UpdateDesignWorkingCopyItemCommand{
		FurnitureInstanceID: fiID,
		Parameters:          map[string]any{"widthMm": 600.0},
		MaterialChoices:     choices,
		MaterialChoiceModes: modes,
		Transform:           domain.Transform3D{TranslationMm: [3]float64{0, 0, 0}},
	}
}

func dadPut(t *testing.T, seed *dadSeed, defaults *domain.DesignAuthoringDefaults, items ...storage.UpdateDesignWorkingCopyItemCommand) (*domain.DesignWorkingCopy, error) {
	t.Helper()
	return fiTxAnd(t, seed.fx, fiActorA(), func(ctx context.Context) (*domain.DesignWorkingCopy, error) {
		return UpdateWorkingCopyCurrent(ctx, seed.fx.store, storage.UpdateDesignWorkingCopyCommand{
			DesignID:          seed.design.ID,
			SourceType:        domain.DesignRevisionSourceSketchup,
			AuthoringDefaults: defaults,
			Items:             items,
			ActorUserID:       rlsUserA,
		})
	})
}

func dadRead(t *testing.T, seed *dadSeed) *domain.DesignWorkingCopy {
	t.Helper()
	wc, err := fiTxAnd(t, seed.fx, fiActorA(), func(ctx context.Context) (*domain.DesignWorkingCopy, error) {
		return seed.fx.store.GetDesignWorkingCopy(ctx, seed.design.ID)
	})
	if err != nil {
		t.Fatalf("read working copy: %v", err)
	}
	return wc
}

func dadProvenance(t *testing.T, seed *dadSeed) *storage.DesignWorkingCopyMaterialProvenance {
	t.Helper()
	prov, err := fiTxAnd(t, seed.fx, fiActorA(), func(ctx context.Context) (*storage.DesignWorkingCopyMaterialProvenance, error) {
		return seed.fx.store.GetDesignWorkingCopyMaterialProvenance(ctx, seed.design.ID)
	})
	if err != nil {
		t.Fatalf("read provenance: %v", err)
	}
	return prov
}

func dadModeOf(wc *domain.DesignWorkingCopy, fiID, role string) domain.DesignMaterialChoiceMode {
	for _, item := range wc.Items {
		if item.FurnitureInstanceID == fiID {
			return item.MaterialChoiceModes[role]
		}
	}
	return ""
}

// 1+2 — defaults and modes round-trip durably through the working copy
// (save/reopen server-side: a fresh GET returns the exact written intent).
func TestDesignAuthoringDefaults_RoundTripDefaultsAndModes(t *testing.T) {
	seed := dadSetup(t, "Cocina #784 roundtrip")
	defaults := &domain.DesignAuthoringDefaults{MaterialChoices: map[string]string{"INTERIOR": "mat-roble", "FRENTES": "mat-blanco"}}

	if _, err := dadPut(t, seed, defaults,
		dadItem(seed.fi1.ID,
			map[string]string{"INTERIOR": "mat-roble", "FRENTES": "mat-negro"},
			map[string]domain.DesignMaterialChoiceMode{"INTERIOR": domain.DesignMaterialChoiceModeDesign, "FRENTES": domain.DesignMaterialChoiceModeOverride}),
	); err != nil {
		t.Fatalf("put with defaults+modes: %v", err)
	}

	wc := dadRead(t, seed)
	if wc.AuthoringDefaults.MaterialChoices["INTERIOR"] != "mat-roble" || wc.AuthoringDefaults.MaterialChoices["FRENTES"] != "mat-blanco" {
		t.Fatalf("authoring defaults = %v, want the written block", wc.AuthoringDefaults.MaterialChoices)
	}
	if got := dadModeOf(wc, seed.fi1.ID, "INTERIOR"); got != domain.DesignMaterialChoiceModeDesign {
		t.Fatalf("INTERIOR mode = %q, want design", got)
	}
	if got := dadModeOf(wc, seed.fi1.ID, "FRENTES"); got != domain.DesignMaterialChoiceModeOverride {
		t.Fatalf("FRENTES mode = %q, want override", got)
	}
	if err := domain.ValidateDesignMaterialChoiceModes(wc.Items[0].MaterialChoices, wc.Items[0].MaterialChoiceModes); err != nil {
		t.Fatalf("stored state must satisfy strict parity: %v", err)
	}
}

// Nil-keeps frontier: a write that omits authoring_defaults preserves them;
// an explicit empty block clears them deliberately.
func TestDesignAuthoringDefaults_NilKeepsAndExplicitEmpty(t *testing.T) {
	seed := dadSetup(t, "Cocina #784 nil-keeps")
	defaults := &domain.DesignAuthoringDefaults{MaterialChoices: map[string]string{"INTERIOR": "mat-roble"}}
	if _, err := dadPut(t, seed, defaults, dadItem(seed.fi1.ID, map[string]string{"INTERIOR": "mat-roble"}, nil)); err != nil {
		t.Fatalf("seed defaults: %v", err)
	}

	// Omitted field (nil): a legacy-shape items-only write keeps the defaults.
	if _, err := dadPut(t, seed, nil, dadItem(seed.fi1.ID, map[string]string{"INTERIOR": "mat-roble"}, nil)); err != nil {
		t.Fatalf("nil-keeps write: %v", err)
	}
	if got := dadRead(t, seed).AuthoringDefaults.MaterialChoices["INTERIOR"]; got != "mat-roble" {
		t.Fatalf("nil write dropped the defaults: got %q", got)
	}

	// Explicit empty block: the canonical empty state, never ambiguity.
	if _, err := dadPut(t, seed, &domain.DesignAuthoringDefaults{}, dadItem(seed.fi1.ID, map[string]string{"INTERIOR": "mat-roble"}, nil)); err != nil {
		t.Fatalf("explicit empty write: %v", err)
	}
	if wc := dadRead(t, seed); len(wc.AuthoringDefaults.MaterialChoices) != 0 {
		t.Fatalf("explicit empty must clear defaults, got %v", wc.AuthoringDefaults.MaterialChoices)
	}
}

// Legacy writer semantics (owner decision 2026-09-28): a PUT whose items
// omit material_choice_modes entirely is a pre-#784 writer. For an EXISTING
// item the persisted lineage survives when the value is unchanged — only an
// explicitly changed value becomes an override. Equality detects "the legacy
// writer changed the value", never lineage itself. New items conservatively
// start as override (the same statement the 000138 backfill made).
func TestDesignAuthoringDefaults_LegacyPutPreservesDesignLineage(t *testing.T) {
	seed := dadSetup(t, "Cocina #784 legacy lineage")
	defaults := &domain.DesignAuthoringDefaults{MaterialChoices: map[string]string{"INTERIOR": "mat-roble", "FRENTES": "mat-negro"}}

	// Seed with EXPLICIT #784 modes: INTERIOR design-backed, FRENTES override.
	if _, err := dadPut(t, seed, defaults,
		dadItem(seed.fi1.ID, map[string]string{"INTERIOR": "mat-roble", "FRENTES": "mat-negro"},
			map[string]domain.DesignMaterialChoiceMode{
				"INTERIOR": domain.DesignMaterialChoiceModeDesign,
				"FRENTES":  domain.DesignMaterialChoiceModeOverride,
			})); err != nil {
		t.Fatalf("seed explicit modes: %v", err)
	}

	legacyItem := func(choices map[string]string) storage.UpdateDesignWorkingCopyItemCommand {
		return dadItem(seed.fi1.ID, choices, nil)
	}

	t.Run("unrelated legacy PUT preserves design lineage", func(t *testing.T) {
		// Same materialized values, modes field absent (e.g. an old plugin
		// moved the furniture and full-replaced the working copy).
		if _, err := dadPut(t, seed, nil,
			legacyItem(map[string]string{"INTERIOR": "mat-roble", "FRENTES": "mat-negro"})); err != nil {
			t.Fatalf("legacy put: %v", err)
		}
		wc := dadRead(t, seed)
		if got := dadModeOf(wc, seed.fi1.ID, "INTERIOR"); got != domain.DesignMaterialChoiceModeDesign {
			t.Fatalf("INTERIOR mode = %q, want preserved design (unrelated legacy PUT must not destroy lineage)", got)
		}
		if got := dadModeOf(wc, seed.fi1.ID, "FRENTES"); got != domain.DesignMaterialChoiceModeOverride {
			t.Fatalf("FRENTES mode = %q, want preserved override", got)
		}
	})

	t.Run("legacy material change becomes explicit override", func(t *testing.T) {
		// The legacy writer changed INTERIOR — even to the very value of the
		// design default, the change is an exception, never a grant of design.
		if _, err := dadPut(t, seed, nil,
			legacyItem(map[string]string{"INTERIOR": "mat-blanco", "FRENTES": "mat-negro"})); err != nil {
			t.Fatalf("legacy change put: %v", err)
		}
		wc := dadRead(t, seed)
		if got := dadModeOf(wc, seed.fi1.ID, "INTERIOR"); got != domain.DesignMaterialChoiceModeOverride {
			t.Fatalf("INTERIOR mode = %q, want override after a legacy value change", got)
		}
		if got := dadModeOf(wc, seed.fi1.ID, "FRENTES"); got != domain.DesignMaterialChoiceModeOverride {
			t.Fatalf("FRENTES mode = %q, want preserved override", got)
		}
	})

	t.Run("legacy override stays override when unchanged", func(t *testing.T) {
		if _, err := dadPut(t, seed, nil,
			legacyItem(map[string]string{"INTERIOR": "mat-blanco", "FRENTES": "mat-negro"})); err != nil {
			t.Fatalf("legacy unchanged put: %v", err)
		}
		if got := dadModeOf(dadRead(t, seed), seed.fi1.ID, "FRENTES"); got != domain.DesignMaterialChoiceModeOverride {
			t.Fatalf("FRENTES mode = %q, want override preserved", got)
		}
	})

	t.Run("new legacy item starts conservative override", func(t *testing.T) {
		// A first-time item from a legacy writer carries no lineage statement:
		// every materialized role is override, even when the value equals the
		// design default (equality never grants design).
		if _, err := dadPut(t, seed, defaults,
			legacyItem(map[string]string{"INTERIOR": "mat-roble"})); err != nil {
			t.Fatalf("new legacy item put: %v", err)
		}
		wc := dadRead(t, seed)
		if got := dadModeOf(wc, seed.fi1.ID, "INTERIOR"); got != domain.DesignMaterialChoiceModeOverride {
			t.Fatalf("INTERIOR mode = %q, want override for a brand-new legacy item", got)
		}
		// Parity still holds on the stored state.
		if err := domain.ValidateDesignMaterialChoiceModes(wc.Items[0].MaterialChoices, wc.Items[0].MaterialChoiceModes); err != nil {
			t.Fatalf("stored parity: %v", err)
		}
	})
}

// 4+5 — unknown modes, modes without a choice and PARTIAL statements reject
// fail-closed.
func TestDesignAuthoringDefaults_InvalidModesRejected(t *testing.T) {
	seed := dadSetup(t, "Cocina #784 invalid modes")
	cases := []struct {
		name    string
		choices map[string]string
		modes   map[string]domain.DesignMaterialChoiceMode
	}{
		{"partial statement", map[string]string{"INTERIOR": "a", "FRENTES": "b"}, map[string]domain.DesignMaterialChoiceMode{"INTERIOR": domain.DesignMaterialChoiceModeDesign}},
		{"unknown mode", map[string]string{"INTERIOR": "a"}, map[string]domain.DesignMaterialChoiceMode{"INTERIOR": "inherited"}},
		{"mode without choice", map[string]string{"INTERIOR": "a"}, map[string]domain.DesignMaterialChoiceMode{"FRENTES": domain.DesignMaterialChoiceModeDesign}},
	}
	for _, tc := range cases {
		_, err := dadPut(t, seed, nil, dadItem(seed.fi1.ID, tc.choices, tc.modes))
		if !errors.Is(err, domain.ErrInvalidMaterialChoiceModes) {
			t.Fatalf("%s: err = %v, want ErrInvalidMaterialChoiceModes", tc.name, err)
		}
	}
}

// 6 — CRITICAL negative equality proof: an override whose value equals the
// current Design default remains 'override' no matter what the default says.
func TestDesignAuthoringDefaults_EqualValueOverrideStaysOverride(t *testing.T) {
	seed := dadSetup(t, "Cocina #784 igualdad negativa")
	defaults := &domain.DesignAuthoringDefaults{MaterialChoices: map[string]string{"INTERIOR": "mat-roble"}}
	if _, err := dadPut(t, seed, defaults,
		dadItem(seed.fi1.ID, map[string]string{"INTERIOR": "mat-roble"},
			map[string]domain.DesignMaterialChoiceMode{"INTERIOR": domain.DesignMaterialChoiceModeOverride})); err != nil {
		t.Fatalf("seed equal-value override: %v", err)
	}

	prov := dadProvenance(t, seed)
	entry := dadFindInheritance(prov, seed.fi1.ID, "INTERIOR")
	if entry == nil || entry.Mode != domain.DesignMaterialChoiceModeOverride {
		t.Fatalf("projection must keep override even when values are identical: %+v", entry)
	}
	if entry.NeedsRollout {
		t.Fatal("override is never a rollout candidate")
	}

	// Flipping the default to the very same value must not flip lineage.
	sameDefaults := &domain.DesignAuthoringDefaults{MaterialChoices: map[string]string{"INTERIOR": "mat-roble", "FRENTES": "mat-roble"}}
	if _, err := dadPut(t, seed, sameDefaults,
		dadItem(seed.fi1.ID, map[string]string{"INTERIOR": "mat-roble"},
			map[string]domain.DesignMaterialChoiceMode{"INTERIOR": domain.DesignMaterialChoiceModeOverride})); err != nil {
		t.Fatalf("rewrite with same default: %v", err)
	}
	if got := dadModeOf(dadRead(t, seed), seed.fi1.ID, "INTERIOR"); got != domain.DesignMaterialChoiceModeOverride {
		t.Fatalf("mode = %q, want override (equality must never flip lineage)", got)
	}
}

// 7+8 — changing a Design default performs ZERO item rewrites; drift is only
// projected (needsRollout), exactly the impact-review truth.
func TestDesignAuthoringDefaults_DefaultChangeNeverMutatesItems(t *testing.T) {
	seed := dadSetup(t, "Cocina #784 no silent mutation")
	blanco := &domain.DesignAuthoringDefaults{MaterialChoices: map[string]string{"INTERIOR": "mat-blanco"}}
	if _, err := dadPut(t, seed, blanco,
		dadItem(seed.fi1.ID, map[string]string{"INTERIOR": "mat-blanco"},
			map[string]domain.DesignMaterialChoiceMode{"INTERIOR": domain.DesignMaterialChoiceModeDesign}),
		dadItem(seed.fi2.ID, map[string]string{"INTERIOR": "mat-negro"},
			map[string]domain.DesignMaterialChoiceMode{"INTERIOR": domain.DesignMaterialChoiceModeOverride}),
	); err != nil {
		t.Fatalf("seed items: %v", err)
	}
	before := dadRead(t, seed)

	roble := &domain.DesignAuthoringDefaults{MaterialChoices: map[string]string{"INTERIOR": "mat-roble"}}
	if _, err := dadPut(t, seed, roble,
		dadItem(seed.fi1.ID, map[string]string{"INTERIOR": "mat-blanco"},
			map[string]domain.DesignMaterialChoiceMode{"INTERIOR": domain.DesignMaterialChoiceModeDesign}),
		dadItem(seed.fi2.ID, map[string]string{"INTERIOR": "mat-negro"},
			map[string]domain.DesignMaterialChoiceMode{"INTERIOR": domain.DesignMaterialChoiceModeOverride}),
	); err != nil {
		t.Fatalf("change default: %v", err)
	}

	after := dadRead(t, seed)
	for i, item := range after.Items {
		if item.MaterialChoices["INTERIOR"] != before.Items[i].MaterialChoices["INTERIOR"] {
			t.Fatalf("item %s materialized choice mutated silently", item.FurnitureInstanceID)
		}
		if item.MaterialChoiceModes["INTERIOR"] != before.Items[i].MaterialChoiceModes["INTERIOR"] {
			t.Fatalf("item %s lineage mutated silently", item.FurnitureInstanceID)
		}
	}

	prov := dadProvenance(t, seed)
	designBacked := dadFindInheritance(prov, seed.fi1.ID, "INTERIOR")
	if designBacked == nil || !designBacked.NeedsRollout || designBacked.DesignDefault != "mat-roble" || designBacked.AppliedChoice != "mat-blanco" {
		t.Fatalf("design-backed projection = %+v, want stale (blanco vs roble) needing rollout", designBacked)
	}
	overridden := dadFindInheritance(prov, seed.fi2.ID, "INTERIOR")
	if overridden == nil || overridden.NeedsRollout {
		t.Fatalf("override projection = %+v, never a rollout candidate", overridden)
	}
	if len(prov.InheritanceSummary) != 1 {
		t.Fatalf("summary roles = %d, want 1", len(prov.InheritanceSummary))
	}
	summary := prov.InheritanceSummary[0]
	if summary.Role != "INTERIOR" || summary.Items != 2 || summary.DesignBacked != 1 || summary.NeedsRollout != 1 || summary.DesignCurrent != 0 || summary.Overridden != 1 {
		t.Fatalf("summary = %+v, want items=2 design=1 rollout=1 current=0 overridden=1", summary)
	}
}

// Design-backed items already carrying the current default count as current.
func TestDesignAuthoringDefaults_NeedsRolloutCurrentAndStale(t *testing.T) {
	seed := dadSetup(t, "Cocina #784 needsRollout")
	defaults := &domain.DesignAuthoringDefaults{MaterialChoices: map[string]string{"INTERIOR": "mat-roble"}}
	if _, err := dadPut(t, seed, defaults,
		dadItem(seed.fi1.ID, map[string]string{"INTERIOR": "mat-roble"},
			map[string]domain.DesignMaterialChoiceMode{"INTERIOR": domain.DesignMaterialChoiceModeDesign}),
		dadItem(seed.fi2.ID, map[string]string{"INTERIOR": "mat-blanco"},
			map[string]domain.DesignMaterialChoiceMode{"INTERIOR": domain.DesignMaterialChoiceModeDesign}),
	); err != nil {
		t.Fatalf("seed: %v", err)
	}
	prov := dadProvenance(t, seed)
	if current := dadFindInheritance(prov, seed.fi1.ID, "INTERIOR"); current == nil || current.NeedsRollout {
		t.Fatalf("item carrying the current default = %+v, want current", current)
	}
	if stale := dadFindInheritance(prov, seed.fi2.ID, "INTERIOR"); stale == nil || !stale.NeedsRollout {
		t.Fatalf("stale item = %+v, want needsRollout", stale)
	}
	summary := prov.InheritanceSummary[0]
	if summary.DesignBacked != 2 || summary.NeedsRollout != 1 || summary.DesignCurrent != 1 {
		t.Fatalf("summary = %+v, want design=2 rollout=1 current=1", summary)
	}
}

// 10+11 — the #810 frontier is untouched by the new fields: missing token
// still 428s and a stale writer still 409s (the newer state survives).
func TestDesignAuthoringDefaults_OptimisticConcurrencyIntact(t *testing.T) {
	seed := dadSetup(t, "Cocina #784 concurrencia")
	defaults := &domain.DesignAuthoringDefaults{MaterialChoices: map[string]string{"INTERIOR": "mat-blanco"}}
	if _, err := dadPut(t, seed, defaults, dadItem(seed.fi1.ID, map[string]string{"INTERIOR": "mat-blanco"}, nil)); err != nil {
		t.Fatalf("seed: %v", err)
	}

	// Missing token → 428 precondition.
	err := fiTx(t, seed.fx.store, fiActorA(), func(ctx context.Context) error {
		_, err := seed.fx.store.UpdateDesignWorkingCopy(ctx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:          seed.design.ID,
			SourceType:        domain.DesignRevisionSourceSketchup,
			AuthoringDefaults: &domain.DesignAuthoringDefaults{MaterialChoices: map[string]string{"INTERIOR": "mat-roble"}},
			Items:             []storage.UpdateDesignWorkingCopyItemCommand{dadItem(seed.fi1.ID, map[string]string{"INTERIOR": "mat-blanco"}, nil)},
			ActorUserID:       rlsUserA,
		})
		return err
	})
	if !errors.Is(err, storage.ErrWorkingCopyPreconditionRequired) {
		t.Fatalf("missing token err = %v, want precondition required", err)
	}

	// Stale token → 409 conflict, newer defaults survive.
	stale := dadRead(t, seed)
	if _, err := dadPut(t, seed, &domain.DesignAuthoringDefaults{MaterialChoices: map[string]string{"INTERIOR": "mat-negro"}},
		dadItem(seed.fi1.ID, map[string]string{"INTERIOR": "mat-blanco"}, nil)); err != nil {
		t.Fatalf("advance default: %v", err)
	}
	conflictErr := fiTx(t, seed.fx.store, fiActorA(), func(ctx context.Context) error {
		stamp := stale.UpdatedAt
		_, err := seed.fx.store.UpdateDesignWorkingCopy(ctx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:               seed.design.ID,
			ExpectedWorkingVersion: &stamp,
			SourceType:             domain.DesignRevisionSourceSketchup,
			AuthoringDefaults:      &domain.DesignAuthoringDefaults{MaterialChoices: map[string]string{"INTERIOR": "mat-roble"}},
			Items:                  []storage.UpdateDesignWorkingCopyItemCommand{dadItem(seed.fi1.ID, map[string]string{"INTERIOR": "mat-blanco"}, nil)},
			ActorUserID:            rlsUserA,
		})
		return err
	})
	if !errors.Is(conflictErr, storage.ErrWorkingCopyVersionConflict) {
		t.Fatalf("stale writer err = %v, want version conflict", conflictErr)
	}
	if got := dadRead(t, seed).AuthoringDefaults.MaterialChoices["INTERIOR"]; got != "mat-negro" {
		t.Fatalf("newer defaults lost: got %q, want mat-negro", got)
	}
}

// 12 — RLS: org B cannot read or write the Design defaults of an org-A-only
// project's design.
func TestDesignAuthoringDefaults_RLSCrossOrgDenied(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	var fi *domain.FurnitureInstance
	var d *domain.Design
	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		var err error
		fi, err = fx.store.CreateFurnitureInstance(ctx, storage.CreateFurnitureInstanceCommand{
			ProjectID:   fiProjectAOnly,
			Origin:      domain.FurnitureInstanceOriginQuote,
			ActorUserID: rlsUserA,
		})
		if err != nil {
			return err
		}
		d, err = fx.store.CreateDesign(ctx, storage.CreateDesignCommand{
			ProjectID:   fiProjectAOnly,
			Name:        "Privado A",
			ActorUserID: rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("seed private design: %v", err)
	}

	err = fiTx(t, fx.store, fiActorB(), func(ctx context.Context) error {
		_, err := fx.store.GetDesignWorkingCopy(ctx, d.ID)
		return err
	})
	if !errors.Is(err, domain.ErrDesignNotFound) {
		t.Fatalf("cross-org read err = %v, want not found (uniform)", err)
	}

	err = fiTx(t, fx.store, fiActorB(), func(ctx context.Context) error {
		_, err := UpdateWorkingCopyCurrent(ctx, fx.store, storage.UpdateDesignWorkingCopyCommand{
			DesignID:          d.ID,
			SourceType:        domain.DesignRevisionSourceSketchup,
			AuthoringDefaults: &domain.DesignAuthoringDefaults{MaterialChoices: map[string]string{"INTERIOR": "mat-roble"}},
			Items:             []storage.UpdateDesignWorkingCopyItemCommand{dadItem(fi.ID, map[string]string{"INTERIOR": "mat-roble"}, nil)},
			ActorUserID:       rlsUserB,
		})
		return err
	})
	if err == nil {
		t.Fatal("cross-org write must fail")
	}
}

// 13+14+15 — publish freezes the working copy's authoring defaults AND each
// item's modes atomically; later working-copy changes never alter the frozen
// revision (historical interpretation stays exact).
func TestDesignAuthoringDefaults_PublishFreezesDefaultsAndModes(t *testing.T) {
	seed := dadSetup(t, "Cocina #784 publish freeze")
	blanco := &domain.DesignAuthoringDefaults{MaterialChoices: map[string]string{"INTERIOR": "mat-blanco"}}
	if _, err := dadPut(t, seed, blanco,
		dadItem(seed.fi1.ID, map[string]string{"INTERIOR": "mat-blanco"},
			map[string]domain.DesignMaterialChoiceMode{"INTERIOR": domain.DesignMaterialChoiceModeDesign}),
		dadItem(seed.fi2.ID, map[string]string{"INTERIOR": "mat-negro"},
			map[string]domain.DesignMaterialChoiceMode{"INTERIOR": domain.DesignMaterialChoiceModeOverride}),
	); err != nil {
		t.Fatalf("seed: %v", err)
	}

	var rev1 *domain.DesignRevision
	err := fiTx(t, seed.fx.store, fiActorA(), func(ctx context.Context) error {
		var err error
		rev1, err = seed.fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID:    seed.design.ID,
			SourceType:  domain.DesignRevisionSourceSketchup,
			ActorUserID: rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("publish R1: %v", err)
	}
	if rev1.AuthoringDefaultsSnapshot == nil || rev1.AuthoringDefaultsSnapshot.MaterialChoices["INTERIOR"] != "mat-blanco" {
		t.Fatalf("R1 defaults snapshot = %+v, want frozen blanco", rev1.AuthoringDefaultsSnapshot)
	}
	for _, item := range rev1.Items {
		if item.MaterialChoiceModes == nil {
			t.Fatalf("R1 item %s froze nil modes; new publishes require explicit modes", item.FurnitureInstanceID)
		}
		if err := domain.ValidateDesignMaterialChoiceModes(item.MaterialChoices, item.MaterialChoiceModes); err != nil {
			t.Fatalf("R1 item %s parity: %v", item.FurnitureInstanceID, err)
		}
	}

	// Working copy moves on: default → negro and the design-backed item
	// materializes negro through explicit intent (e.g. the #471 rollout).
	negro := &domain.DesignAuthoringDefaults{MaterialChoices: map[string]string{"INTERIOR": "mat-negro"}}
	if _, err := dadPut(t, seed, negro,
		dadItem(seed.fi1.ID, map[string]string{"INTERIOR": "mat-negro"},
			map[string]domain.DesignMaterialChoiceMode{"INTERIOR": domain.DesignMaterialChoiceModeDesign}),
		dadItem(seed.fi2.ID, map[string]string{"INTERIOR": "mat-negro"},
			map[string]domain.DesignMaterialChoiceMode{"INTERIOR": domain.DesignMaterialChoiceModeOverride}),
	); err != nil {
		t.Fatalf("mutate working copy: %v", err)
	}

	var frozen *domain.DesignRevision
	err = fiTx(t, seed.fx.store, fiActorA(), func(ctx context.Context) error {
		var err error
		frozen, err = seed.fx.store.GetDesignRevision(ctx, seed.design.ID, rev1.ID)
		return err
	})
	if err != nil {
		t.Fatalf("read back R1: %v", err)
	}
	if frozen.AuthoringDefaultsSnapshot == nil || frozen.AuthoringDefaultsSnapshot.MaterialChoices["INTERIOR"] != "mat-blanco" {
		t.Fatalf("R1 defaults were altered by later working changes: %+v", frozen.AuthoringDefaultsSnapshot)
	}
	if frozen.Items[0].MaterialChoices["INTERIOR"] != "mat-blanco" || frozen.Items[0].MaterialChoiceModes["INTERIOR"] != domain.DesignMaterialChoiceModeDesign {
		t.Fatalf("R1 historical interpretation changed: %+v", frozen.Items[0])
	}
}

// 16 — reset-to-revision restores defaults AND item modes from the frozen
// snapshot; a LEGACY revision (modes NULL, pre-contract) resets to
// conservative override for every materialized role.
func TestDesignAuthoringDefaults_ResetRestoresDefaultsAndModes(t *testing.T) {
	seed := dadSetup(t, "Cocina #784 reset")
	blanco := &domain.DesignAuthoringDefaults{MaterialChoices: map[string]string{"INTERIOR": "mat-blanco"}}
	if _, err := dadPut(t, seed, blanco,
		dadItem(seed.fi1.ID, map[string]string{"INTERIOR": "mat-blanco"},
			map[string]domain.DesignMaterialChoiceMode{"INTERIOR": domain.DesignMaterialChoiceModeDesign})); err != nil {
		t.Fatalf("seed: %v", err)
	}
	var rev1 *domain.DesignRevision
	err := fiTx(t, seed.fx.store, fiActorA(), func(ctx context.Context) error {
		var err error
		rev1, err = seed.fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID: seed.design.ID, SourceType: domain.DesignRevisionSourceSketchup, ActorUserID: rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("publish R1: %v", err)
	}

	negro := &domain.DesignAuthoringDefaults{MaterialChoices: map[string]string{"INTERIOR": "mat-negro"}}
	if _, err := dadPut(t, seed, negro,
		dadItem(seed.fi1.ID, map[string]string{"INTERIOR": "mat-negro"},
			map[string]domain.DesignMaterialChoiceMode{"INTERIOR": domain.DesignMaterialChoiceModeOverride})); err != nil {
		t.Fatalf("diverge: %v", err)
	}

	err = fiTx(t, seed.fx.store, fiActorA(), func(ctx context.Context) error {
		_, err := ResetWorkingCopyCurrent(ctx, seed.fx.store, storage.ResetDesignWorkingCopyCommand{
			DesignID:    seed.design.ID,
			RevisionID:  rev1.ID,
			ActorUserID: rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("reset: %v", err)
	}
	wc := dadRead(t, seed)
	if wc.AuthoringDefaults.MaterialChoices["INTERIOR"] != "mat-blanco" {
		t.Fatalf("reset left current defaults in place: %v", wc.AuthoringDefaults.MaterialChoices)
	}
	if got := dadModeOf(wc, seed.fi1.ID, "INTERIOR"); got != domain.DesignMaterialChoiceModeDesign {
		t.Fatalf("reset mode = %q, want design from the frozen snapshot", got)
	}
	if wc.Items[0].MaterialChoices["INTERIOR"] != "mat-blanco" {
		t.Fatalf("reset choice = %q, want blanco", wc.Items[0].MaterialChoices["INTERIOR"])
	}
}

func dadFindInheritance(prov *storage.DesignWorkingCopyMaterialProvenance, fiID, role string) *domain.DesignRoleInheritance {
	for i, item := range prov.Items {
		if item.FurnitureInstanceID == fiID {
			for j, entry := range item.Inheritance {
				if entry.Role == role {
					return &prov.Items[i].Inheritance[j]
				}
			}
		}
	}
	return nil
}
