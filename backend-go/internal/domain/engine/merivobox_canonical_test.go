package engine_test

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

// Canonical MERIVOBOX pilot parity (#670-E review R12).
//
// Single numeric authority: contracts/fixtures/merivobox-pilot-canonical.json.
// The Go engine must resolve the pilot fixture against the same canonical
// numbers used by the TS domain, the Proyectar WebGL suite and the SketchUp
// TestUp evidence, and the committed host evidence must match them too, so no
// runtime can keep a "slightly different MERIVOBOX pilot".

const canonicalFixturePath = "../../../../contracts/fixtures/merivobox-pilot-canonical.json"
const hostEvidencePath = "../../../../progress/host_smoke_670_e_merivobox_pilot_evidence.json"

type canonicalBoard struct {
	WidthMm     float64 `json:"widthMm"`
	LengthMm    float64 `json:"lengthMm"`
	ThicknessMm float64 `json:"thicknessMm"`
}

type canonicalContract struct {
	Configuration struct {
		OuterWidthMm     float64 `json:"outerWidthMm"`
		LeftPanelMm      float64 `json:"leftPanelThicknessMm"`
		RightPanelMm     float64 `json:"rightPanelThicknessMm"`
		DerivedLwMm      float64 `json:"derivedLwMm"`
		AssemblyHeightMm float64 `json:"assemblyHeightMm"`
		CarcaseDepthMm   float64 `json:"carcaseDepthMm"`
		SelectedNlMm     float64 `json:"selectedNominalDepthMm"`
		MutatedOuterMm   float64 `json:"mutatedOuterWidthMm"`
		MutatedLwMm      float64 `json:"mutatedDerivedLwMm"`
		VariantASpaceMm  float64 `json:"variantASpaceDepthMm"`
		VariantANlMm     float64 `json:"variantASelectedNominalDepthMm"`
	} `json:"configuration"`
	Hardware struct {
		VariantSetID    string `json:"variantSetId"`
		CommercialKitID string `json:"commercialKitHardwareId"`
	} `json:"hardware"`
	Provenance struct {
		ClearanceMm float64 `json:"clearanceMm"`
	} `json:"provenance"`
	ExpectedFabricatedMm struct {
		W600Nl500 struct {
			Bottom canonicalBoard `json:"bottom"`
			Back   canonicalBoard `json:"back"`
		} `json:"w600Nl500"`
		W800Nl500 struct {
			Bottom canonicalBoard `json:"bottom"`
			Back   canonicalBoard `json:"back"`
		} `json:"w800Nl500"`
		W600Nl450 struct {
			Bottom canonicalBoard `json:"bottom"`
		} `json:"w600Nl450"`
		RightMembersDeltaMm float64 `json:"rightMembersDeltaMm"`
	} `json:"expectedFabricatedMm"`
}

type hostEvidence struct {
	Head   string `json:"head"`
	RbzSHA string `json:"rbz_sha256"`
	Tests  map[string]struct {
		Status      string `json:"status"`
		BottomPanel *struct {
			WidthMm     float64 `json:"width_mm"`
			LengthMm    float64 `json:"length_mm"`
			ThicknessMm float64 `json:"thickness_mm"`
		} `json:"bottom_panel"`
		BackPanel *struct {
			WidthMm     float64 `json:"width_mm"`
			LengthMm    float64 `json:"length_mm"`
			ThicknessMm float64 `json:"thickness_mm"`
		} `json:"back_panel"`
	} `json:"tests"`
	W600ToW800Delta struct {
		SideRight struct {
			DeltaMm float64 `json:"delta_mm"`
		} `json:"side_right"`
		Bottom struct {
			WidthBeforeMm float64 `json:"width_mm_before"`
			WidthAfterMm  float64 `json:"width_mm_after"`
			DeltaWidthMm  float64 `json:"delta_width_mm"`
			LengthMm      float64 `json:"length_mm"`
			ThicknessMm   float64 `json:"thickness_mm"`
		} `json:"bottom"`
		Back struct {
			WidthAfterMm float64 `json:"width_mm_after"`
			ThicknessMm  float64 `json:"thickness_mm"`
		} `json:"back"`
	} `json:"w600_to_w800_delta"`
	VariantSwitch struct {
		BottomLength450Mm float64 `json:"bottom_length_450_mm"`
		BottomLength500Mm float64 `json:"bottom_length_500_mm"`
	} `json:"variant_switch_nl450_to_nl500"`
}

func loadCanonicalContract(t *testing.T) canonicalContract {
	t.Helper()
	raw, err := os.ReadFile(filepath.Clean(canonicalFixturePath))
	if err != nil {
		t.Fatalf("read canonical fixture: %v", err)
	}
	var c canonicalContract
	if err := json.Unmarshal(raw, &c); err != nil {
		t.Fatalf("parse canonical fixture: %v", err)
	}
	return c
}

// canonicalPilotFixture returns the pilot fixture with the REAL_VERIFIED
// clearance (3.0 mm, Blum KA-160/24-ES) from the canonical contract.
func canonicalPilotFixture(c canonicalContract) domain.Agregado {
	fixture := buildMerivoboxPilotFixture()
	fixture.CompatibilityRules = []domain.AssemblyCompatibilityRule{
		{
			VariantSetID:      c.Hardware.VariantSetID,
			ClearanceMm:       c.Provenance.ClearanceMm,
			SelectionStrategy: "max_fitting",
		},
	}
	return fixture
}

func TestMerivoboxCanonicalPilotParity_R12(t *testing.T) {
	c := loadCanonicalContract(t)

	// Furniture authority chain: outer W and real carcase panels derive LW.
	lw := c.Configuration.OuterWidthMm - c.Configuration.LeftPanelMm - c.Configuration.RightPanelMm
	if lw != c.Configuration.DerivedLwMm {
		t.Errorf("derived LW %v != canonical %v", lw, c.Configuration.DerivedLwMm)
	}
	if lw == c.Configuration.OuterWidthMm {
		t.Errorf("LW must not equal outer W (panels missing from the chain)")
	}

	fixture := canonicalPilotFixture(c)

	// Canonical configuration: LW570 / depth 530 selects NL 500.
	res, err := engine.ResolveAgregadoAssembly(fixture, engine.AssemblyResolutionParams{
		WidthMm:  c.Configuration.DerivedLwMm,
		DepthMm:  c.Configuration.CarcaseDepthMm,
		HeightMm: c.Configuration.AssemblyHeightMm,
	})
	if err != nil {
		t.Fatalf("canonical resolution failed: %v", err)
	}
	if len(res.SelectedVariants) != 1 || res.SelectedVariants[0].NominalDimensionMm != c.Configuration.SelectedNlMm {
		t.Errorf("expected NL %v, got %+v", c.Configuration.SelectedNlMm, res.SelectedVariants)
	}
	assertCanonicalBoard(t, res, "comp-bottom", c.ExpectedFabricatedMm.W600Nl500.Bottom)
	assertCanonicalBoard(t, res, "comp-back", c.ExpectedFabricatedMm.W600Nl500.Back)

	// Mutated outer W800 -> LW770: right members move the canonical delta,
	// fabricated boards regenerate to the canonical widths.
	res800, err := engine.ResolveAgregadoAssembly(fixture, engine.AssemblyResolutionParams{
		WidthMm:  c.Configuration.MutatedLwMm,
		DepthMm:  c.Configuration.CarcaseDepthMm,
		HeightMm: c.Configuration.AssemblyHeightMm,
	})
	if err != nil {
		t.Fatalf("mutated resolution failed: %v", err)
	}
	delta := rightMemberX(res800) - rightMemberX(res)
	if delta != c.ExpectedFabricatedMm.RightMembersDeltaMm {
		t.Errorf("right member delta %v != canonical %v", delta, c.ExpectedFabricatedMm.RightMembersDeltaMm)
	}
	assertCanonicalBoard(t, res800, "comp-bottom", c.ExpectedFabricatedMm.W800Nl500.Bottom)
	assertCanonicalBoard(t, res800, "comp-back", c.ExpectedFabricatedMm.W800Nl500.Back)

	// Variant A space depth selects NL 450 with the canonical bottom length.
	resA, err := engine.ResolveAgregadoAssembly(fixture, engine.AssemblyResolutionParams{
		WidthMm:  c.Configuration.DerivedLwMm,
		DepthMm:  c.Configuration.VariantASpaceMm,
		HeightMm: c.Configuration.AssemblyHeightMm,
	})
	if err != nil {
		t.Fatalf("variant A resolution failed: %v", err)
	}
	if resA.SelectedVariants[0].NominalDimensionMm != c.Configuration.VariantANlMm {
		t.Errorf("expected NL %v for space %v, got %+v",
			c.Configuration.VariantANlMm, c.Configuration.VariantASpaceMm, resA.SelectedVariants)
	}
	assertCanonicalBoard(t, resA, "comp-bottom", c.ExpectedFabricatedMm.W600Nl450.Bottom)
}

func TestMerivoboxCanonicalPilotHostEvidenceParity_R12(t *testing.T) {
	c := loadCanonicalContract(t)

	raw, err := os.ReadFile(filepath.Clean(hostEvidencePath))
	if err != nil {
		t.Fatalf("read host evidence: %v (evidence must be regenerated by the real TestUp run)", err)
	}
	var ev hostEvidence
	if err := json.Unmarshal(raw, &ev); err != nil {
		t.Fatalf("parse host evidence: %v", err)
	}

	for name, block := range ev.Tests {
		if block.Status != "pass" {
			t.Errorf("host evidence '%s' status = %q, want pass", name, block.Status)
		}
	}

	e1 := ev.Tests["e1_e2_insert_w600"]
	if e1.BottomPanel == nil || e1.BackPanel == nil {
		t.Fatalf("host evidence e1_e2_insert_w600 missing measured panels")
	}
	want := c.ExpectedFabricatedMm.W600Nl500
	// Host-measured inches->mm readback carries float noise; parity is exact
	// to the micron, not to the last IEEE-754 bit.
	assertCloseMM(t, "bottom width", e1.BottomPanel.WidthMm, want.Bottom.WidthMm)
	assertCloseMM(t, "bottom length", e1.BottomPanel.LengthMm, want.Bottom.LengthMm)
	assertCloseMM(t, "bottom thickness", e1.BottomPanel.ThicknessMm, want.Bottom.ThicknessMm)
	assertCloseMM(t, "back width", e1.BackPanel.WidthMm, want.Back.WidthMm)
	assertCloseMM(t, "back length", e1.BackPanel.LengthMm, want.Back.LengthMm)
	assertCloseMM(t, "back thickness", e1.BackPanel.ThicknessMm, want.Back.ThicknessMm)

	w800 := ev.W600ToW800Delta
	want800 := c.ExpectedFabricatedMm.W800Nl500
	assertCloseMM(t, "bottom width after W800", w800.Bottom.WidthAfterMm, want800.Bottom.WidthMm)
	assertCloseMM(t, "bottom width before W800", w800.Bottom.WidthBeforeMm, want.Bottom.WidthMm)
	assertCloseMM(t, "bottom delta width", w800.Bottom.DeltaWidthMm, c.ExpectedFabricatedMm.RightMembersDeltaMm)
	assertCloseMM(t, "bottom length W800", w800.Bottom.LengthMm, want800.Bottom.LengthMm)
	assertCloseMM(t, "bottom thickness W800", w800.Bottom.ThicknessMm, want800.Bottom.ThicknessMm)
	assertCloseMM(t, "back width after W800", w800.Back.WidthAfterMm, want800.Back.WidthMm)
	assertCloseMM(t, "back thickness W800", w800.Back.ThicknessMm, want800.Back.ThicknessMm)
	assertCloseMM(t, "side right delta", w800.SideRight.DeltaMm, c.ExpectedFabricatedMm.RightMembersDeltaMm)
	assertCloseMM(t, "bottom length NL450", ev.VariantSwitch.BottomLength450Mm, c.ExpectedFabricatedMm.W600Nl450.Bottom.LengthMm)
	assertCloseMM(t, "bottom length NL500", ev.VariantSwitch.BottomLength500Mm, want.Bottom.LengthMm)
}

func assertCloseMM(t *testing.T, what string, got, want float64) {
	t.Helper()
	if math.Abs(got-want) > 1e-6 {
		t.Errorf("SketchUp host %s %v != canonical %v", what, got, want)
	}
}

func assertCanonicalBoard(t *testing.T, res domain.ResolvedAssembly, componentID string, want canonicalBoard) {
	t.Helper()
	for i := range res.FabricatedComponents {
		fc := &res.FabricatedComponents[i]
		if fc.ComponentID != componentID {
			continue
		}
		if fc.WidthMm != want.WidthMm || fc.LengthMm != want.LengthMm {
			t.Errorf("%s fabricated %v x %v != canonical %v x %v",
				componentID, fc.WidthMm, fc.LengthMm, want.WidthMm, want.LengthMm)
		}
		return
	}
	t.Errorf("fabricated component %s not found", componentID)
}

func rightMemberX(res domain.ResolvedAssembly) float64 {
	for i := range res.RigidMembers {
		if res.RigidMembers[i].MemberID == "side-right" {
			return res.RigidMembers[i].LocalTransform.TranslationMm[0]
		}
	}
	return 0
}
