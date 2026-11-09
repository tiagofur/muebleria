package domain

import (
	"strings"
	"testing"
)

func v2IntPtr(v int) *int           { return &v }
func v2FloatPtr(v float64) *float64 { return &v }

func validV2Profile() OpeningProfile {
	return OpeningProfile{
		ID: "op-v2", Code: "GOLA-L-8006", Name: "Gola L 8006",
		Material: GolaMaterialAluminum, CrossSectionShape: "L",
		Positions:          []string{GolaPositionTop},
		ProfileHeightMm:    v2FloatPtr(56.5),
		ProfileDepthMm:     v2FloatPtr(27.2),
		FrontDiscountTopMm: v2IntPtr(40),
		Active:             true,
		BOMMembers: map[string]OpeningBOMMember{
			GolaRoleProfile:  {HardwareID: "hw-8006", Rule: "interior_width"},
			GolaRoleSupports: {HardwareID: "hw-su116", Rule: "per_length", SpacingMm: v2IntPtr(600), DimensionsMm: &[3]float64{39.5, 16.5, 20}},
			GolaRoleEndCaps:  {HardwareID: "hw-cap", Rule: "per_exposed_end"},
		},
	}
}

func normalizedValidate(p OpeningProfile) error {
	NormalizeOpeningProfileWrite(&p, nil)
	return ValidateOpeningProfile(p)
}

// #1530 — no upper bound: 25, 30, 40 and 52 are accepted; ≤ 0 is rejected.
func TestGolaProfileV2DiscountHasNoUpperBound(t *testing.T) {
	for _, value := range []int{25, 30, 40, 52} {
		p := validV2Profile()
		p.Positions = []string{GolaPositionTop, GolaPositionBetween}
		p.FrontDiscountTopMm = v2IntPtr(value)
		p.FrontDiscountBetweenMm = v2IntPtr(value)
		if err := normalizedValidate(p); err != nil {
			t.Fatalf("discount %d must be accepted: %v", value, err)
		}
	}
	for _, value := range []int{0, -1} {
		top := validV2Profile()
		top.FrontDiscountTopMm = v2IntPtr(value)
		if err := normalizedValidate(top); err == nil || !IsOpeningProfileValidationError(err) {
			t.Fatalf("top discount %d must be rejected as a validation error, got %v", value, err)
		}
		between := validV2Profile()
		between.Positions = []string{GolaPositionBetween}
		between.CrossSectionShape = "C"
		between.FrontDiscountBetweenMm = v2IntPtr(value)
		if err := normalizedValidate(between); err == nil {
			t.Fatalf("between discount %d must be rejected", value)
		}
	}
}

// #1530 — a profile without the discount of a declared position cannot be
// used there; the Spanish message names the missing field.
func TestGolaProfileV2UsagePerPosition(t *testing.T) {
	p := validV2Profile()
	p.Material = GolaMaterialMelamine
	p.CrossSectionShape = "flat"
	p.Positions = []string{GolaPositionTop, GolaPositionBetween}
	p.FrontDiscountTopMm = v2IntPtr(36)
	p.FrontDiscountBetweenMm = nil

	if usage := p.UsageAt(GolaPositionTop); !usage.Usable || len(usage.Missing) != 0 {
		t.Fatalf("top must be usable: %+v", usage)
	}
	usage := p.UsageAt(GolaPositionBetween)
	if usage.Usable || len(usage.Missing) != 1 || usage.Missing[0] != "front_discount_between_mm" {
		t.Fatalf("between must be blocked by its discount: %+v", usage)
	}
	if !strings.Contains(usage.Message, "No se puede usar entre frentes: falta el descuento") {
		t.Fatalf("the message must name the missing field in Spanish: %q", usage.Message)
	}
	if err := p.UsageError(GolaPositionBetween); err == nil || !IsOpeningProfileValidationError(err) {
		t.Fatalf("UsageError must reject between: %v", err)
	}

	// Height and depth are required too; the datasheet status is not.
	p.ProfileHeightMm = nil
	p.DatasheetStatus = "pending"
	p.GeometryOrigin = ""
	top := p.UsageAt(GolaPositionTop)
	if top.Usable || top.Missing[0] != "profile_height_mm" || !strings.Contains(top.Message, "el alto del perfil") {
		t.Fatalf("missing height must block: %+v", top)
	}

	// An undeclared position is not usable.
	only := validV2Profile()
	if usage := only.UsageAt(GolaPositionBetween); usage.Usable || !strings.Contains(usage.Message, "no se declaró") {
		t.Fatalf("an undeclared position must not be usable: %+v", usage)
	}

	// Pending datasheet without origin is usable: data only since #1530.
	ready := validV2Profile()
	ready.DatasheetStatus = "pending"
	if usage := ready.UsageAt(GolaPositionTop); !usage.Usable {
		t.Fatalf("the datasheet status must not block use: %+v", usage)
	}
	ready.WithUsage()
	if len(ready.Usage) != 1 || !ready.Usage[GolaPositionTop].Usable {
		t.Fatalf("WithUsage must cover every declared position: %+v", ready.Usage)
	}
}

// #1530 — roles are a fixed vocabulary; strip takes only a component and the
// hardware roles take only hardware.
func TestGolaProfileV2FixedRoles(t *testing.T) {
	cases := []struct {
		name    string
		mutate  func(p *OpeningProfile)
		wantMsg string
	}{
		{"unknown role", func(p *OpeningProfile) {
			p.BOMMembers["tira"] = OpeningBOMMember{ComponentID: "comp", Rule: "interior_width"}
		}, "no existe"},
		{"profile with a component", func(p *OpeningProfile) {
			p.BOMMembers[GolaRoleProfile] = OpeningBOMMember{ComponentID: "comp", Rule: "interior_width"}
		}, "sólo acepta un herraje"},
		{"endCaps empty", func(p *OpeningProfile) {
			p.BOMMembers[GolaRoleEndCaps] = OpeningBOMMember{Rule: "per_exposed_end"}
		}, "sólo acepta un herraje"},
		{"strip with hardware", func(p *OpeningProfile) {
			p.Material = GolaMaterialMelamine
			p.BOMMembers[GolaRoleStrip] = OpeningBOMMember{HardwareID: "hw", Rule: "interior_width"}
		}, "sólo acepta un componente"},
		{"strip on aluminum", func(p *OpeningProfile) {
			p.BOMMembers[GolaRoleStrip] = OpeningBOMMember{ComponentID: "comp", Rule: "interior_width"}
		}, "gola italiana"},
		{"zero spacing", func(p *OpeningProfile) {
			p.BOMMembers[GolaRoleSupports] = OpeningBOMMember{HardwareID: "hw", Rule: "per_length", SpacingMm: v2IntPtr(0)}
		}, "espaciado"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			p := validV2Profile()
			tc.mutate(&p)
			err := normalizedValidate(p)
			if err == nil || !IsOpeningProfileValidationError(err) || !strings.Contains(err.Error(), tc.wantMsg) {
				t.Fatalf("want validation error containing %q, got %v", tc.wantMsg, err)
			}
		})
	}

	italian := validV2Profile()
	italian.Material = GolaMaterialMelamine
	italian.CrossSectionShape = ""
	italian.Positions = []string{GolaPositionTop, GolaPositionBetween}
	italian.FrontDiscountTopMm = v2IntPtr(36)
	italian.FrontDiscountBetweenMm = v2IntPtr(36)
	italian.BOMMembers = map[string]OpeningBOMMember{
		GolaRoleStrip: {ComponentID: "comp-tira", Rule: "interior_width", HeightMm: v2FloatPtr(70)},
	}
	italian.BodyModifiers = []OpeningBodyModifier{
		{Role: "lateral", NotchHeightMm: v2FloatPtr(70), NotchDepthSource: NotchDepthFromStripThickness, NotchClearanceMm: v2FloatPtr(1), NotchAt: "top_front"},
		{Role: "door", BevelAngleDeg: v2FloatPtr(45), BevelSizeMm: v2FloatPtr(25), BevelAt: "top_front"},
	}
	if err := normalizedValidate(italian); err != nil {
		t.Fatalf("the Italian gola with strip, notch and bevel must validate: %v", err)
	}
}

// #1530 (A5) — non-profile grip types are rejected at the write boundary.
func TestGolaProfileV2RejectsNonProfileGripTypes(t *testing.T) {
	for _, gripType := range []string{"handle", "bottom_reveal", "none"} {
		p := validV2Profile()
		p.Material = ""
		p.GripType = gripType
		p.CompatiblePlacements = []string{"top"}
		p.DatasheetStatus = "pending"
		if err := normalizedValidate(p); err == nil || !IsOpeningProfileValidationError(err) {
			t.Fatalf("%s must be rejected, got %v", gripType, err)
		}
	}
}

// #1530 bridge — a v2 write mirrors the legacy fields the engine still reads,
// and a legacy write fills the v2 fields with the 000180 rule.
func TestGolaProfileV2LegacyBridge(t *testing.T) {
	v2 := validV2Profile()
	v2.FrontDiscountTopMm = v2IntPtr(52)
	NormalizeOpeningProfileWrite(&v2, nil)
	if v2.GripType != "gola" || v2.DatasheetStatus != "pending" ||
		v2.DoorReductionMm == nil || *v2.DoorReductionMm != 52 ||
		len(v2.CompatiblePlacements) != 1 || v2.CompatiblePlacements[0] != "top" {
		t.Fatalf("v2 write must mirror the legacy fields: %+v", v2)
	}

	legacy := OpeningProfile{
		Code: "GOLA-OLD", Name: "Gola vieja", GripType: "gola", CrossSectionShape: "L",
		CompatiblePlacements: []string{"top", "bottom"}, DatasheetStatus: "verified",
		FrontReductionMm: v2IntPtr(38), GripClearanceMm: v2IntPtr(2),
		ProfileHeightMm: v2FloatPtr(56.5), ProfileDepthMm: v2FloatPtr(27.2), Active: true,
	}
	NormalizeOpeningProfileWrite(&legacy, nil)
	if legacy.Material != GolaMaterialAluminum || len(legacy.Positions) != 1 ||
		legacy.FrontDiscountTopMm == nil || *legacy.FrontDiscountTopMm != 40 {
		t.Fatalf("legacy write must derive v2 fields: %+v", legacy)
	}
	if err := ValidateOpeningProfile(legacy); err != nil {
		t.Fatalf("a legacy verified profile without origin must stay valid (origin is informational): %v", err)
	}

	// Update from a legacy client keeps what it cannot express.
	stored := validV2Profile()
	stored.Material = GolaMaterialMelamine
	stored.Positions = []string{"top", "between"}
	stored.FrontDiscountBetweenMm = v2IntPtr(36)
	stored.BOMMembers = map[string]OpeningBOMMember{GolaRoleStrip: {ComponentID: "c", Rule: "interior_width", HeightMm: v2FloatPtr(80)}}
	incoming := OpeningProfile{
		Code: "GOLA-IT", Name: "Italiana", GripType: "gola", CrossSectionShape: "flat",
		CompatiblePlacements: []string{"top", "between"}, DatasheetStatus: "pending",
		DoorReductionMm: v2IntPtr(36), Active: true,
		BOMMembers: map[string]OpeningBOMMember{GolaRoleStrip: {ComponentID: "c", Rule: "interior_width"}},
	}
	NormalizeOpeningProfileWrite(&incoming, &stored)
	if incoming.Material != GolaMaterialMelamine || incoming.FrontDiscountBetweenMm == nil ||
		*incoming.FrontDiscountBetweenMm != 36 || *incoming.BOMMembers[GolaRoleStrip].HeightMm != 80 {
		t.Fatalf("legacy update must carry the v2-only values: %+v", incoming)
	}
}

// #1530 — owner and manufacturer suggestions (#1524).
func TestGolaProfileSuggestions(t *testing.T) {
	byKey := map[string]GolaProfileSuggestion{}
	for _, s := range GolaProfileSuggestions(v2FloatPtr(27)) {
		byKey[s.Key] = s
	}
	if l := byKey["scilm-8006-l"]; *l.FrontDiscountTopMm != 40 || l.Positions[0] != "top" {
		t.Fatalf("8006 L: %+v", l)
	}
	if c := byKey["scilm-8007-c"]; *c.FrontDiscountBetweenMm != 36 || c.Positions[0] != "between" {
		t.Fatalf("8007 C: %+v", c)
	}
	it := byKey["italiana"]
	if *it.FrontDiscountTopMm != 36 || *it.FrontDiscountBetweenMm != 36 || it.Material != GolaMaterialMelamine {
		t.Fatalf("italiana discounts: %+v", it)
	}
	if *it.BOMMembers[GolaRoleStrip].HeightMm != 70 {
		t.Fatalf("strip default 70")
	}
	notch, bevel := it.BodyModifiers[1], it.BodyModifiers[2]
	if *notch.NotchHeightMm != 70 || *notch.NotchClearanceMm != 1 || notch.NotchDepthSource != NotchDepthFromStripThickness {
		t.Fatalf("notch 70 × strip thickness + 1: %+v", notch)
	}
	if *bevel.BevelAngleDeg != 45 || bevel.BevelSizeMm == nil || *bevel.BevelSizeMm != 25 {
		t.Fatalf("bevel 45° of depth − 2: %+v", bevel)
	}
	if noDepth := GolaProfileSuggestions(nil)[2].BodyModifiers[2]; noDepth.BevelSizeMm != nil {
		t.Fatalf("without depth the bevel size stays empty")
	}
}

// #1534 — the v2 bridge is SYMMETRIC: a write that declares the positions
// through compatible_placements only (the gola editor's shape) derives
// positions from it, restricted to the v2 vocabulary.
func TestNormalizeOpeningProfileWriteDerivesPositionsFromCompatible(t *testing.T) {
	p := OpeningProfile{
		GripType:             "gola",
		CrossSectionShape:    "L",
		Material:             GolaMaterialAluminum,
		CompatiblePlacements: []string{"top", "bottom"}, // bottom is not a v2 position
		FrontDiscountTopMm:   intPtr(40),
	}
	NormalizeOpeningProfileWrite(&p, nil)
	if len(p.Positions) != 1 || p.Positions[0] != GolaPositionTop {
		t.Fatalf("positions = %v, want [top] (bottom never becomes a v2 position)", p.Positions)
	}
	if len(p.CompatiblePlacements) != 1 || p.CompatiblePlacements[0] != GolaPositionTop {
		t.Fatalf("compatible_placements normalized to %v, want [top]", p.CompatiblePlacements)
	}
	if p.DoorReductionMm == nil || *p.DoorReductionMm != 40 {
		t.Fatalf("door bridge drifted: %v", p.DoorReductionMm)
	}
}
