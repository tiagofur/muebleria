package engine

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1135 — the shared TS↔Go parity contract for the opening configuration
// validator: three states (valid / blocked / invalid with a stable reason),
// capability gating for NEW authoring only, and fail-closed vocabulary.
// contracts/openingConfigurationValidation.contract.json.
func TestOpeningConfigurationValidationContract(t *testing.T) {
	fixturePath := filepath.Join("..", "..", "..", "..", "contracts", "openingConfigurationValidation.contract.json")
	raw, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var fixture struct {
		Schema int `json:"schema"`
		Cases  []struct {
			Name         string                         `json:"name"`
			Selection    OpeningConfigurationSelection  `json:"selection"`
			Capabilities *domain.OpeningCapabilities    `json:"capabilities"`
			Profiles     []OpeningProfileSelectionData  `json:"profiles"`
			Expected     OpeningConfigurationValidation `json:"expected"`
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
			got := ValidateOpeningConfiguration(tc.Selection, tc.Capabilities, tc.Profiles, nil)
			if !reflect.DeepEqual(got, tc.Expected) {
				t.Fatalf("validation = %+v, want %+v", got, tc.Expected)
			}
		})
	}
}

// #1135 — historical semantics: a persisted configuration resolves against
// the PINNED profile data its caller feeds the resolver, whatever today's
// capabilities say, and a pinned set missing the profile fails explicitly —
// the engine has no "latest" fallback by construction.
func TestOpeningConfigurationHistoricalSemantics(t *testing.T) {
	intent := OpeningIntent{
		Layout: OpeningLayout{Direction: "vertical", Zones: []OpeningZone{
			{ID: "z1", Access: "drawer", Ratio: 1},
			{ID: "z2", Access: "drawer", Ratio: 1},
		}},
		Grips:       []OpeningGrip{{Boundary: "top", ProfileID: "profile.gola-l.alu"}},
		Positioning: "overlay",
	}
	// The pinned release's revision of the profile (the values the design
	// was authored against).
	pinnedRevision := []OpeningProfileData{{
		ProfileID: "profile.gola-l.alu", DatasheetStatus: "verified",
		FrontReductionMm: 66, GripClearanceMm: 4,
	}}
	pinnedResolution, resErr := ResolveOpeningFront(intent, 720, pinnedRevision, nil)
	if resErr != nil {
		t.Fatalf("historical resolution rejected: %s (%s)", resErr.Code, resErr.Message)
	}

	// Today's capability says the system is unavailable — the historical
	// design keeps resolving, byte-identical.
	disabledCapabilities := &domain.OpeningCapabilities{
		Version: 1,
		Grips:   map[string]domain.OpeningGripCapability{domain.OpeningGripSystemGola: {Enabled: false}},
	}
	if disabledCapabilities.Grips[domain.OpeningGripSystemGola].Enabled {
		t.Fatal("test setup: gola must be disabled today")
	}
	repeat, resErr := ResolveOpeningFront(intent, 720, pinnedRevision, nil)
	if resErr != nil {
		t.Fatalf("repeat historical resolution rejected: %s (%s)", resErr.Code, resErr.Message)
	}
	if !reflect.DeepEqual(pinnedResolution, repeat) {
		t.Fatal("changing today's capability must not change a historical resolution")
	}

	// A newer datasheet value does NOT leak into the historical resolution:
	// the resolver consumes the set its caller passes (the pinned one).
	newerRevision := []OpeningProfileData{{
		ProfileID: "profile.gola-l.alu", DatasheetStatus: "verified",
		FrontReductionMm: 80, GripClearanceMm: 10,
	}}
	withNewer, resErr := ResolveOpeningFront(intent, 720, newerRevision, nil)
	if resErr != nil {
		t.Fatalf("newer revision resolution rejected: %s (%s)", resErr.Code, resErr.Message)
	}
	if withNewer.AvailableFrontHeightMm == pinnedResolution.AvailableFrontHeightMm {
		t.Fatal("the pinned revision's values must be what the caller passed — no silent upgrade")
	}

	// The pinned release missing the profile fails explicitly — never a
	// fallback to the current catalog.
	_, resErr = ResolveOpeningFront(intent, 720, nil, nil)
	if resErr == nil || resErr.Code != OpeningErrProfileUnknown {
		t.Fatalf("missing pinned profile: code = %v, want %s", resErr, OpeningErrProfileUnknown)
	}
}

// #1135 — the reason→message mapping is total over the reason codes the
// fixture pins: the UI prints messages, never raw codes alone.
func TestOpeningSelectionReasonMessagesTotal(t *testing.T) {
	for _, reason := range []string{
		OpeningReasonSystemUnknown, OpeningReasonSystemUnavailable,
		OpeningReasonProfileRequired, OpeningReasonProfileNotApplicable,
		OpeningReasonProfileNotCurated, OpeningReasonProfileUnknown,
		OpeningReasonDatasheetPending, OpeningReasonPlacementRestricted,
		OpeningReasonPlacementIncompatible, OpeningReasonFurnitureTypeUnknown,
		OpeningReasonOverhangEvidencePend,
	} {
		if OpeningSelectionReasonMessage(reason) == reason {
			t.Fatalf("reason %s has no workshop-facing message", reason)
		}
	}
}
