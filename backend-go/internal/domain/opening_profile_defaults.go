package domain

// Suggested values when a workshop creates a gola profile (#1530, ADR-0009
// A2.1, §14.2/§14.6). Served by GET /api/catalog/opening-profiles/suggestions
// to the profile editor (#1534). They are suggestions only: the workshop may
// change every value and none of them is ever written without the workshop
// saving it.

// GolaProfileSuggestion is one starting point for a new profile, in the same
// wire shape as the profile write.
type GolaProfileSuggestion struct {
	Key                    string                      `json:"key"`
	Label                  string                      `json:"label"`
	Source                 string                      `json:"source"`
	Manufacturer           string                      `json:"manufacturer,omitempty"`
	Material               string                      `json:"material"`
	CrossSectionShape      string                      `json:"cross_section_shape"`
	Positions              []string                    `json:"positions"`
	FrontDiscountTopMm     *int                        `json:"front_discount_top_mm,omitempty"`
	FrontDiscountBetweenMm *int                        `json:"front_discount_between_mm,omitempty"`
	BodyModifiers          []OpeningBodyModifier       `json:"body_modifiers"`
	BOMMembers             map[string]OpeningBOMMember `json:"bom_members"`
}

const (
	// ItalianStripHeightMm is the owner default for the strip (#1524).
	ItalianStripHeightMm = 70.0
	// ItalianNotchClearanceMm is added to both notch dimensions (#1524).
	ItalianNotchClearanceMm = 1.0
	// ItalianBevelDepthOffsetMm: the bevel size is depthMm − 2 (#1524).
	ItalianBevelDepthOffsetMm = 2.0
)

// GolaProfileSuggestions returns the manufacturer and owner defaults. When
// profileDepthMm is known, the Italian bevel size (depth − 2) is filled in;
// otherwise it stays empty for the workshop to complete.
func GolaProfileSuggestions(profileDepthMm *float64) []GolaProfileSuggestion {
	forty, thirtySix := 40, 36
	italianTop, italianBetween := 36, 36
	stripHeight := ItalianStripHeightMm
	notchHeight := ItalianStripHeightMm
	notchClearance := ItalianNotchClearanceMm
	bevelAngle := 45.0
	var bevelSize *float64
	if profileDepthMm != nil && *profileDepthMm-ItalianBevelDepthOffsetMm > 0 {
		size := *profileDepthMm - ItalianBevelDepthOffsetMm
		bevelSize = &size
	}
	return []GolaProfileSuggestion{
		{
			Key:                "scilm-8006-l",
			Label:              "Gola L 8006 (arriba)",
			Source:             "Ficha SCILM 8006: H − 40",
			Manufacturer:       "SCILM",
			Material:           GolaMaterialAluminum,
			CrossSectionShape:  "L",
			Positions:          []string{GolaPositionTop},
			FrontDiscountTopMm: &forty,
			BodyModifiers: []OpeningBodyModifier{
				{Role: "horizontal", Effect: "depth_reduction"},
			},
			BOMMembers: map[string]OpeningBOMMember{},
		},
		{
			Key:                    "scilm-8007-c",
			Label:                  "Gola C 8007 (entre frentes)",
			Source:                 "Ficha SCILM 8007: hueco de 36",
			Manufacturer:           "SCILM",
			Material:               GolaMaterialAluminum,
			CrossSectionShape:      "C",
			Positions:              []string{GolaPositionBetween},
			FrontDiscountBetweenMm: &thirtySix,
			BodyModifiers:          []OpeningBodyModifier{},
			BOMMembers:             map[string]OpeningBOMMember{},
		},
		{
			Key:                    "italiana",
			Label:                  "Gola italiana (arriba y entre frentes)",
			Source:                 "Valores del taller (#1524)",
			Material:               GolaMaterialMelamine,
			CrossSectionShape:      "flat",
			Positions:              []string{GolaPositionTop, GolaPositionBetween},
			FrontDiscountTopMm:     &italianTop,
			FrontDiscountBetweenMm: &italianBetween,
			BodyModifiers: []OpeningBodyModifier{
				{Role: "horizontal", Effect: "depth_reduction"},
				{
					Role:             "lateral",
					NotchHeightMm:    &notchHeight,
					NotchDepthSource: NotchDepthFromStripThickness,
					NotchClearanceMm: &notchClearance,
					NotchAt:          "top_front",
				},
				{Role: "door", BevelAngleDeg: &bevelAngle, BevelSizeMm: bevelSize, BevelAt: "top_front"},
			},
			// The strip component is picked by the workshop; only its
			// height is suggested.
			BOMMembers: map[string]OpeningBOMMember{
				GolaRoleStrip: {Rule: "interior_width", Unit: "piece", HeightMm: &stripHeight},
			},
		},
	}
}
