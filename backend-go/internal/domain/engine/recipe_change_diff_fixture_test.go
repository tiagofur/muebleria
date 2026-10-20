package engine_test

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

// #1369 — single wire authority for the recipe change diff:
// contracts/fixtures/recipe-change-diff-canonical.json. Go PRODUCES the diff;
// this test freezes it; the TS side only CONSUMES (types + fail-closed parser,
// packages/domain/src/recipeChangeDiff.contract.test.ts) — React never
// re-resolves. Regenerate deliberately with UPDATE_RECIPE_DIFF_FIXTURE=1 after
// an intentional contract change, and review the JSON diff.
const recipeDiffFixturePath = "../../../../contracts/fixtures/recipe-change-diff-canonical.json"

type recipeDiffCanonical struct {
	Description  string                          `json:"description"`
	Current      domain.Agregado                 `json:"current"`
	Candidate    domain.Agregado                 `json:"candidate"`
	Params       engine.AssemblyResolutionParams `json:"params"`
	ExpectedDiff json.RawMessage                 `json:"expectedDiff"`
}

func canonicalRecipeDiffInput(t *testing.T) (domain.Agregado, domain.Agregado, engine.AssemblyResolutionParams) {
	t.Helper()
	current := buildSyntheticDrawerFixture()
	candidate := cloneAgregado(t, current)
	// One of each classified change: a member removed, one added, one moved,
	// a board resized, the commercial kit swapped (consumption), the variant
	// unchanged.
	var members []domain.AgregadoRigidMember
	for _, m := range candidate.RigidMembers {
		switch m.MemberID {
		case "locking_device_left":
			continue
		case "side_right":
			m.Placement.X.OffsetMm = -10.0
		}
		members = append(members, m)
	}
	mid := members[0]
	mid.MemberID = "runner_mid"
	mid.Role = "drawer_runner_mid"
	mid.Placement.X = domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 300.0}
	candidate.RigidMembers = append(members, mid)
	candidate.Components[0].Overrides.WidthRule.OffsetMm = -55.0
	kit := "hw-kit-drawer-premium"
	candidate.CommercialKitHardwareID = &kit
	return current, candidate, drawerParams()
}

func canonicalJSON(t *testing.T, v any) []byte {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var buf bytes.Buffer
	if err := json.Indent(&buf, raw, "", "  "); err != nil {
		t.Fatalf("indent: %v", err)
	}
	return buf.Bytes()
}

func TestRecipeChangeDiffCanonicalFixture(t *testing.T) {
	current, candidate, params := canonicalRecipeDiffInput(t)
	diff, err := engine.SimulateRecipeChange(current, candidate, params)
	if err != nil {
		t.Fatalf("simulate: %v", err)
	}
	gotDiff := canonicalJSON(t, diff)

	if os.Getenv("UPDATE_RECIPE_DIFF_FIXTURE") == "1" {
		fixture := recipeDiffCanonical{
			Description:  "#1369 recipe change diff — produced by Go engine.SimulateRecipeChange over the synthetic drawer recipe; TS consumes this contract verbatim (no re-resolve).",
			Current:      current,
			Candidate:    candidate,
			Params:       params,
			ExpectedDiff: gotDiff,
		}
		if err := os.WriteFile(filepath.Clean(recipeDiffFixturePath), append(canonicalJSON(t, fixture), '\n'), 0o644); err != nil {
			t.Fatalf("write fixture: %v", err)
		}
		t.Logf("fixture regenerated at %s", recipeDiffFixturePath)
	}

	raw, err := os.ReadFile(filepath.Clean(recipeDiffFixturePath))
	if err != nil {
		t.Fatalf("read fixture (regenerate with UPDATE_RECIPE_DIFF_FIXTURE=1): %v", err)
	}
	var fixture recipeDiffCanonical
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("decode fixture: %v", err)
	}

	// 1. The committed inputs still produce the committed diff.
	fromFixture, err := engine.SimulateRecipeChange(fixture.Current, fixture.Candidate, fixture.Params)
	if err != nil {
		t.Fatalf("simulate fixture inputs: %v", err)
	}
	if got, want := string(canonicalJSON(t, fromFixture)), string(canonicalJSON(t, json.RawMessage(fixture.ExpectedDiff))); got != want {
		t.Fatalf("engine output drifted from the committed contract (regenerate deliberately if intended):\n--- got\n%s\n--- want\n%s", got, want)
	}
	// 2. The in-code canonical input matches the committed one (no silent drift
	//    between the test helper and the fixture).
	if got, want := string(canonicalJSON(t, diff)), string(canonicalJSON(t, json.RawMessage(fixture.ExpectedDiff))); got != want {
		t.Fatalf("canonical input helper drifted from the fixture")
	}
}
