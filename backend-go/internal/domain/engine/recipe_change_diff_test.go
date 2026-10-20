package engine_test

import (
	"encoding/json"
	"errors"
	"math"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

// #1369 slice 1 — recipe change simulation: a pure, deterministic diff of the
// candidate recipe against the current one, keyed by DECLARED ids, with
// variant rejections surfaced as alternatives (never a clamp).

func cloneAgregado(t *testing.T, a domain.Agregado) domain.Agregado {
	t.Helper()
	raw, err := json.Marshal(a)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var out domain.Agregado
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return out
}

func drawerParams() engine.AssemblyResolutionParams {
	return engine.AssemblyResolutionParams{WidthMm: 600.0, DepthMm: 550.0, HeightMm: 200.0}
}

func mustSimulate(t *testing.T, current, candidate domain.Agregado, params engine.AssemblyResolutionParams) engine.RecipeChangeDiff {
	t.Helper()
	diff, err := engine.SimulateRecipeChange(current, candidate, params)
	if err != nil {
		t.Fatalf("simulate: %v", err)
	}
	return diff
}

func memberRow(t *testing.T, diff engine.RecipeChangeDiff, id string) engine.RecipeMemberChange {
	t.Helper()
	for _, m := range diff.Members {
		if m.MemberID == id {
			return m
		}
	}
	t.Fatalf("member %q not in diff", id)
	return engine.RecipeMemberChange{}
}

func boardRow(t *testing.T, diff engine.RecipeChangeDiff, id string) engine.RecipeBoardChange {
	t.Helper()
	for _, b := range diff.Boards {
		if b.ComponentID == id {
			return b
		}
	}
	t.Fatalf("board %q not in diff", id)
	return engine.RecipeBoardChange{}
}

func TestSimulateRecipeChange_SameRecipeIsNoChangesAndIdempotent(t *testing.T) {
	current := buildSyntheticDrawerFixture()
	candidate := cloneAgregado(t, current)

	first := mustSimulate(t, current, candidate, drawerParams())
	second := mustSimulate(t, current, candidate, drawerParams())

	if first.State != engine.RecipeChangeNoChanges {
		t.Fatalf("state = %s, want %s", first.State, engine.RecipeChangeNoChanges)
	}
	if !first.CandidateResolved || first.Summary.TotalChanges != 0 {
		t.Fatalf("no-changes diff must be resolved with zero changes: %+v", first.Summary)
	}
	// Every row is present (identity preserved) and unchanged.
	if len(first.Members) != 6 || len(first.Boards) != 2 || len(first.Variants) != 1 {
		t.Fatalf("rows = members %d boards %d variants %d, want 6/2/1", len(first.Members), len(first.Boards), len(first.Variants))
	}
	for _, m := range first.Members {
		if m.Change != engine.ChangeUnchanged {
			t.Fatalf("member %s change = %s, want unchanged", m.MemberID, m.Change)
		}
	}
	// Byte-identical output: idempotence is observable.
	a, _ := json.Marshal(first)
	b, _ := json.Marshal(second)
	if string(a) != string(b) {
		t.Fatalf("two identical simulations produced different JSON:\n%s\n%s", a, b)
	}
	// Sorted by declared id, not by recipe array order.
	for i := 1; i < len(first.Members); i++ {
		if first.Members[i-1].MemberID > first.Members[i].MemberID {
			t.Fatalf("members not sorted by id: %s > %s", first.Members[i-1].MemberID, first.Members[i].MemberID)
		}
	}
}

func TestSimulateRecipeChange_ClassifiesMembersBoardsAndConsumption(t *testing.T) {
	current := buildSyntheticDrawerFixture()
	candidate := cloneAgregado(t, current)

	// Remove one member, add one, move one, swap the commercial kit.
	var members []domain.AgregadoRigidMember
	for _, m := range candidate.RigidMembers {
		switch m.MemberID {
		case "locking_device_left":
			continue // removed
		case "side_right":
			m.Placement.X.OffsetMm = -10.0 // moved 10 mm inward
		}
		members = append(members, m)
	}
	mid := members[0] // clone of side_left
	mid.MemberID = "runner_mid"
	mid.Role = "drawer_runner_mid"
	mid.Placement.X = domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 300.0}
	members = append(members, mid)
	candidate.RigidMembers = members
	// Resize the bottom board: W-35 → W-55.
	candidate.Components[0].Overrides.WidthRule.OffsetMm = -55.0
	newKit := "hw-kit-drawer-premium"
	candidate.CommercialKitHardwareID = &newKit

	diff := mustSimulate(t, current, candidate, drawerParams())

	if diff.State != engine.RecipeChangeValid || !diff.CandidateResolved {
		t.Fatalf("state = %s resolved=%v, want valid/resolved", diff.State, diff.CandidateResolved)
	}
	if got := memberRow(t, diff, "locking_device_left"); got.Change != engine.ChangeRemoved || got.HardwareIDBefore == "" || got.TranslationBefore == nil {
		t.Fatalf("removed member row = %+v", got)
	}
	if got := memberRow(t, diff, "runner_mid"); got.Change != engine.ChangeAdded || got.HardwareIDAfter == "" || got.TranslationAfter == nil || got.TranslationAfter[0] != 300 {
		t.Fatalf("added member row = %+v", got)
	}
	moved := memberRow(t, diff, "side_right")
	if moved.Change != engine.ChangeMoved || moved.TranslationDeltaMm == nil || math.Abs(moved.TranslationDeltaMm[0]-(-10.0)) > 1e-6 {
		t.Fatalf("moved member row = %+v", moved)
	}
	if moved.TranslationBefore == nil || moved.TranslationAfter == nil || moved.TranslationBefore[0] != 600 || moved.TranslationAfter[0] != 590 {
		t.Fatalf("moved member must carry before/after: %+v", moved)
	}
	if got := memberRow(t, diff, "side_left"); got.Change != engine.ChangeUnchanged || got.TranslationDeltaMm != nil {
		t.Fatalf("untouched member must stay unchanged with no delta: %+v", got)
	}
	bottom := boardRow(t, diff, "comp-drawer-bottom")
	if bottom.Change != engine.ChangeResized || bottom.Before == nil || bottom.After == nil ||
		bottom.Before.WidthMm != 565 || bottom.After.WidthMm != 545 {
		t.Fatalf("resized board row = %+v (before=%+v after=%+v)", bottom, bottom.Before, bottom.After)
	}
	if got := boardRow(t, diff, "comp-drawer-back"); got.Change != engine.ChangeUnchanged {
		t.Fatalf("untouched board = %+v", got)
	}
	// Consumption: the old kit line disappears, the new one appears.
	var oldKit, newKitSeen bool
	for _, c := range diff.Consumption {
		if c.HardwareID == "hw-kit-drawer-synth" && c.Change == engine.ChangeRemoved {
			oldKit = true
		}
		if c.HardwareID == "hw-kit-drawer-premium" && c.Change == engine.ChangeAdded {
			newKitSeen = true
		}
	}
	if !oldKit || !newKitSeen {
		t.Fatalf("kit swap not reflected in consumption: %+v", diff.Consumption)
	}
	if diff.Summary.Added < 2 || diff.Summary.Removed < 2 || diff.Summary.Moved != 1 || diff.Summary.Resized != 1 || diff.Summary.Rejected != 0 {
		t.Fatalf("summary = %+v", diff.Summary)
	}
}

func TestSimulateRecipeChange_RejectedVariantSurfacesAlternativesNeverClamps(t *testing.T) {
	current := buildSyntheticDrawerFixture()
	// The user explicitly picks the 550 nominal while the space only fits 500
	// (550 - clearance 3 = 547): the narrowed set is REJECTED with the
	// alternative listed, and nothing is clamped to 500 behind the user's back.
	candidate, err := engine.RestrictVariantSelections(cloneAgregado(t, current), map[string]float64{"vs-drawer-depth": 550})
	if err != nil {
		t.Fatalf("restrict: %v", err)
	}

	diff := mustSimulate(t, current, candidate, drawerParams())

	if diff.State != engine.RecipeChangePartiallyInvalid || diff.CandidateResolved {
		t.Fatalf("state = %s resolved=%v, want partially_invalid/unresolved", diff.State, diff.CandidateResolved)
	}
	if len(diff.Variants) != 1 || diff.Variants[0].Change != engine.ChangeVariantRejected || diff.Variants[0].Rejection == nil {
		t.Fatalf("variants = %+v", diff.Variants)
	}
	rej := diff.Variants[0].Rejection
	if rej.RequestedSpaceMm != 550 || rej.RequiredClearanceMm != 3 || len(rej.AvailableNominals) != 1 || rej.AvailableNominals[0] != 550 {
		t.Fatalf("rejection = %+v", rej)
	}
	if len(rej.FittingNominals) != 0 {
		t.Fatalf("550 cannot fit 547: fitting = %v", rej.FittingNominals)
	}
	if diff.Variants[0].Before == nil || diff.Variants[0].Before.NominalDimensionMm != 500 {
		t.Fatalf("the current selection (500) must travel with the rejection: %+v", diff.Variants[0].Before)
	}
	if len(diff.Members) != 0 || len(diff.Boards) != 0 || len(diff.Consumption) != 0 {
		t.Fatalf("an unresolved candidate must not fabricate member/board/consumption rows")
	}
	if diff.Summary.Rejected != 1 || diff.Summary.TotalChanges != 1 {
		t.Fatalf("summary = %+v", diff.Summary)
	}

	// A legitimate alternative is an explicit nominal SMALLER than what
	// max_fitting would pick: at depth 600 the current recipe selects 550; the
	// user chooses 500 → valid variant change, and the boards whose length rule
	// depends on the variant resize accordingly (540 → 490).
	deeper := drawerParams()
	deeper.DepthMm = 600.0
	smaller, err := engine.RestrictVariantSelections(cloneAgregado(t, current), map[string]float64{"vs-drawer-depth": 500})
	if err != nil {
		t.Fatalf("restrict: %v", err)
	}
	ok := mustSimulate(t, current, smaller, deeper)
	if ok.State != engine.RecipeChangeValid || len(ok.Variants) != 1 || ok.Variants[0].Change != engine.ChangeVariantChanged {
		t.Fatalf("explicit 500 at depth 600 should be a valid variant change: state=%s variants=%+v", ok.State, ok.Variants)
	}
	if ok.Variants[0].Before.NominalDimensionMm != 550 || ok.Variants[0].After.NominalDimensionMm != 500 {
		t.Fatalf("variant before/after = %v/%v, want 550/500", ok.Variants[0].Before.NominalDimensionMm, ok.Variants[0].After.NominalDimensionMm)
	}
	bottom := boardRow(t, ok, "comp-drawer-bottom")
	if bottom.Change != engine.ChangeResized || bottom.Before.LengthMm != 540 || bottom.After.LengthMm != 490 {
		t.Fatalf("variant-driven board length must resize 540 → 490: %+v before=%+v after=%+v", bottom, bottom.Before, bottom.After)
	}
}

func TestSimulateRecipeChange_FittingNominalsListTheOnesThatWouldFit(t *testing.T) {
	current := buildSyntheticDrawerFixture()
	// Space 420 → max nominal 417: none of 450/500/550 fits, and the diff says so
	// with an empty fitting list; the resolver rejects (no clamp to 450).
	shallow := drawerParams()
	shallow.DepthMm = 420.0
	candidate := cloneAgregado(t, current)
	// Current must resolve: give it a nominal that fits (400) in a separate set
	// copy, while the candidate keeps the original set.
	current.VariantSets[0].Variants = append([]domain.ProductVariant{{NominalDimensionMm: 400, HardwareID: "hw-side-400"}}, current.VariantSets[0].Variants...)

	diff := mustSimulate(t, current, candidate, shallow)
	if diff.State != engine.RecipeChangePartiallyInvalid {
		t.Fatalf("state = %s, want partially_invalid", diff.State)
	}
	rej := diff.Variants[0].Rejection
	if len(rej.AvailableNominals) != 3 || len(rej.FittingNominals) != 0 {
		t.Fatalf("rejection = %+v", rej)
	}
}

func TestRestrictVariantSelections_FailsClosedOnUnknownSetOrNominal(t *testing.T) {
	recipe := buildSyntheticDrawerFixture()
	if _, err := engine.RestrictVariantSelections(recipe, map[string]float64{"vs-ghost": 500}); err == nil {
		t.Fatal("unknown variant set must be an error, never ignored")
	}
	if _, err := engine.RestrictVariantSelections(recipe, map[string]float64{"vs-drawer-depth": 475}); err == nil {
		t.Fatal("a nominal absent from the set must be an error, never ignored")
	}
	narrowed, err := engine.RestrictVariantSelections(recipe, map[string]float64{"vs-drawer-depth": 450})
	if err != nil {
		t.Fatalf("restrict: %v", err)
	}
	if len(narrowed.VariantSets[0].Variants) != 1 || narrowed.VariantSets[0].Variants[0].NominalDimensionMm != 450 {
		t.Fatalf("narrowed set = %+v", narrowed.VariantSets[0].Variants)
	}
	if len(recipe.VariantSets[0].Variants) != 3 {
		t.Fatal("RestrictVariantSelections must not mutate its input")
	}
}

func TestSimulateRecipeChange_InvalidRecipesFailWithTypedErrors(t *testing.T) {
	current := buildSyntheticDrawerFixture()

	broken := cloneAgregado(t, current)
	broken.RigidMembers[0].Source.Variant.VariantSetID = "vs-ghost"
	_, err := engine.SimulateRecipeChange(current, broken, drawerParams())
	var candErr *engine.ErrCandidateRecipeInvalid
	if !errors.As(err, &candErr) {
		t.Fatalf("invalid candidate err = %v (%T), want ErrCandidateRecipeInvalid", err, err)
	}

	_, err = engine.SimulateRecipeChange(broken, current, drawerParams())
	var curErr *engine.ErrCurrentRecipeUnresolvable
	if !errors.As(err, &curErr) {
		t.Fatalf("invalid current err = %v (%T), want ErrCurrentRecipeUnresolvable", err, err)
	}
}
