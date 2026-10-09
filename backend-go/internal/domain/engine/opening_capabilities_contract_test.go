package engine

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1134 — the shared TS↔Go parity contract for the opening capabilities
// overlay: one blob key, version-gated, vocabulary-strict, no unknown keys
// anywhere (which keeps dimensions out — they belong to the OpeningProfile
// datasheet). contracts/openingCapabilities.contract.json.
func TestOpeningCapabilitiesContract(t *testing.T) {
	fixturePath := filepath.Join("..", "..", "..", "..", "contracts", "openingCapabilities.contract.json")
	raw, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var fixture struct {
		Schema int `json:"schema"`
		Cases  []struct {
			Name      string                      `json:"name"`
			Overrides map[string]any              `json:"overrides"`
			Expected  *domain.OpeningCapabilities `json:"expected"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("decode fixture: %v", err)
	}
	if fixture.Schema != 1 {
		t.Fatalf("fixture schema = %d, want 1", fixture.Schema)
	}
	for _, tc := range fixture.Cases {
		t.Run(tc.Name, func(t *testing.T) {
			overrides, err := json.Marshal(tc.Overrides)
			if err != nil {
				t.Fatalf("encode overrides: %v", err)
			}
			capabilities, err := ParseOpeningCapabilities(overrides)
			if err != nil {
				t.Fatalf("parse rejected: %v", err)
			}
			if !reflect.DeepEqual(capabilities, tc.Expected) {
				t.Fatalf("capabilities = %+v, want %+v", capabilities, tc.Expected)
			}
		})
	}
}

// #1134 — fail-closed shapes live on each side's unit tests: unknown
// version, unknown system/type/placement, unknown keys (dimensions!), two
// defaults, profiles outside gola.
func TestOpeningCapabilitiesFailClosed(t *testing.T) {
	base := map[string]any{
		"version": 1,
		"grips": map[string]any{
			"handle": map[string]any{"enabled": true, "default": true},
		},
	}
	parse := func(t *testing.T, blob map[string]any) error {
		t.Helper()
		overrides, err := json.Marshal(map[string]any{"opening.capabilities": blob})
		if err != nil {
			t.Fatalf("encode: %v", err)
		}
		_, err = ParseOpeningCapabilities(overrides)
		return err
	}

	if err := parse(t, base); err != nil {
		t.Fatalf("baseline must parse: %v", err)
	}

	futureVersion := map[string]any{
		"version": 2,
		"grips":   base["grips"],
	}
	if err := parse(t, futureVersion); err == nil {
		t.Fatal("unknown version must fail closed (no fallback)")
	}

	unknownSystem := map[string]any{
		"version": 1,
		"grips": map[string]any{
			"integrated_profile": map[string]any{"enabled": true},
		},
	}
	if err := parse(t, unknownSystem); err == nil || !strings.Contains(err.Error(), "sistema") {
		t.Fatalf("unknown system: err = %v", err)
	}

	dimensionKey := map[string]any{
		"version":        1,
		"grips":          base["grips"],
		"maxReductionMm": 5,
	}
	if err := parse(t, dimensionKey); err == nil {
		t.Fatal("dimensional payload must fail closed — dimensions belong to the OpeningProfile")
	}

	twoDefaults := map[string]any{
		"version": 1,
		"grips": map[string]any{
			"handle":          map[string]any{"enabled": true, "default": true},
			"bottom_overhang": map[string]any{"enabled": true, "default": true},
		},
	}
	if err := parse(t, twoDefaults); err == nil || !strings.Contains(err.Error(), "por defecto") {
		t.Fatalf("two defaults: err = %v", err)
	}

	profilesOnHandle := map[string]any{
		"version": 1,
		"grips": map[string]any{
			"handle": map[string]any{"enabled": true, "profiles": []any{"profile.x"}},
		},
	}
	if err := parse(t, profilesOnHandle); err == nil {
		t.Fatal("profiles outside gola must fail closed")
	}

	unknownType := map[string]any{
		"version": 1,
		"grips":   base["grips"],
		"byFurnitureType": map[string]any{
			"medio": map[string]any{"grips": map[string]any{}},
		},
	}
	if err := parse(t, unknownType); err == nil || !strings.Contains(err.Error(), "tipo de mueble") {
		t.Fatalf("unknown furniture type: err = %v", err)
	}

	unknownPlacement := map[string]any{
		"version": 1,
		"grips":   base["grips"],
		"byFurnitureType": map[string]any{
			"superior": map[string]any{"grips": map[string]any{
				"gola": map[string]any{"placements": []any{"left"}},
			}},
		},
	}
	if err := parse(t, unknownPlacement); err == nil {
		t.Fatal("unknown placement must fail closed")
	}
}

// #1134 — available ≠ valid: the capabilities govern OFFERING; the resolver
// keeps its own authority. Disabling a system or listing a pending-datasheet
// profile never changes what ResolveOpeningFront produces — existing designs
// keep resolving against their pinned release untouched.
func TestOpeningCapabilitiesAvailableIsNotValid(t *testing.T) {
	capabilities := &domain.OpeningCapabilities{
		Version: 1,
		Grips: map[string]domain.OpeningGripCapability{
			domain.OpeningGripSystemGola: {Enabled: false},
		},
	}
	// The resolver consumes profile data, not the capabilities: a disabled
	// gola still resolves a design that declares it (the design predates the
	// capability change; its release is pinned).
	intent := OpeningIntent{
		Layout: OpeningLayout{Direction: "vertical", Zones: []OpeningZone{
			{ID: "z1", Access: "drawer", Ratio: 1},
		}},
		Grips:       []OpeningGrip{{Boundary: "top", ProfileID: "profile.gola-l.alu"}},
		Positioning: "overlay",
	}
	verifiedProfiles := []OpeningProfileData{{
		ProfileID: "profile.gola-l.alu", DatasheetStatus: "verified",
		FrontReductionMm: 66, GripClearanceMm: 4,
	}}
	resolution, resErr := ResolveOpeningFront(intent, 720, verifiedProfiles, nil)
	if resErr != nil || resolution == nil {
		t.Fatalf("disabled capability must not invalidate an existing design: %v", resErr)
	}
	if capabilities.Grips[domain.OpeningGripSystemGola].Enabled {
		t.Fatal("test setup: gola must be disabled in the capabilities")
	}
	// And the reverse: enabling a capability never makes an unverified
	// datasheet resolvable — validity stays with the evidence gate.
	pendingProfiles := []OpeningProfileData{{
		ProfileID: "profile.gola-l.alu", DatasheetStatus: "pending_oq2",
		FrontReductionMm: 66, GripClearanceMm: 4,
	}}
	_, resErr = ResolveOpeningFront(intent, 720, pendingProfiles, nil)
	if resErr == nil || resErr.Code != OpeningErrDatasheetPending {
		t.Fatalf("enabled capability must not launder a pending datasheet: %v", resErr)
	}
}
