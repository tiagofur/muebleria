package engine

import (
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1138 — caso C de punta a punta en el engine: la regla respaldada habilita
// la resolución; el cuerpo no cambia; los frentes del borde inferior
// extienden exactamente la regla; sin BOM de jaladera/gola; y el gate de
// familias rige la selección. El golden compartido
// (openingFrontResolution.contract.json) pinea los números; aquí viven los
// invariantes de aceptancia transversales (espejo de openingCaseC en TS).
func overhangPtr(v int) *int { return &v }

func caseCLayout(overhangMm *int) (*OpeningFrontLayout, *OpeningResolutionError) {
	intent := OpeningIntent{
		Positioning: "bottom_overhang",
		Layout: OpeningLayout{Direction: "vertical", Zones: []OpeningZone{
			{ID: "puerta", Access: "hinged", Ratio: 1},
		}},
	}
	return ResolveOpeningFrontLayout(intent, 600, 720, nil, overhangMm)
}

func TestOpeningCaseCWithoutRuleStaysBlocked(t *testing.T) {
	layout, resErr := caseCLayout(nil)
	if resErr == nil || layout != nil {
		t.Fatalf("sin regla respaldada el caso C debe seguir BLOCKED: %+v / %v", layout, resErr)
	}
	if resErr.Code != OpeningErrOverhangEvidencePend {
		t.Fatalf("code = %s, want %s", resErr.Code, OpeningErrOverhangEvidencePend)
	}
}

func TestOpeningCaseCMalformedRuleFailsClosed(t *testing.T) {
	for _, mm := range []int{0, -40} {
		if _, resErr := caseCLayout(overhangPtr(mm)); resErr == nil || resErr.Code != OpeningErrLayoutInvalid {
			t.Fatalf("regla %d: code = %v, want %s", mm, resErr, OpeningErrLayoutInvalid)
		}
	}
}

func TestOpeningCaseCResolvesWithBodyUntouched(t *testing.T) {
	layout, resErr := caseCLayout(overhangPtr(40))
	if resErr != nil {
		t.Fatalf("resolve rejected: %s (%s)", resErr.Code, resErr.Message)
	}
	// El CUERPO: la resolución v1 divide la altura del cuerpo sin tocarla.
	if layout.Resolution.AvailableFrontHeightMm != 720 {
		t.Fatalf("available = %d, want 720 (el cuerpo no cambia)", layout.Resolution.AvailableFrontHeightMm)
	}
	// El FRENTE: aumenta exactamente la regla, declarada y auditable.
	front := layout.Fronts[0]
	if front.HeightMm != 760 || front.OverhangMm == nil || *front.OverhangMm != 40 {
		t.Fatalf("front = %+v, want heightMm 760 con overhangMm 40", front)
	}
	if len(front.Grips) != 0 {
		t.Fatalf("el caso C no consume hardware: grips = %+v", front.Grips)
	}
}

func TestOpeningCaseCTwoZonesOnlyBottomExtends(t *testing.T) {
	intent := OpeningIntent{
		Positioning: "bottom_overhang",
		Layout: OpeningLayout{Direction: "vertical", Zones: []OpeningZone{
			{ID: "z1", Access: "hinged", Ratio: 1},
			{ID: "z2", Access: "hinged", Ratio: 1},
		}},
	}
	layout, resErr := ResolveOpeningFrontLayout(intent, 600, 720, nil, overhangPtr(40))
	if resErr != nil {
		t.Fatalf("resolve rejected: %s (%s)", resErr.Code, resErr.Message)
	}
	if layout.Fronts[0].OverhangMm != nil || layout.Fronts[0].HeightMm != 360 {
		t.Fatalf("z1 debe quedar intacta: %+v", layout.Fronts[0])
	}
	if layout.Fronts[1].HeightMm != 400 || layout.Fronts[1].OverhangMm == nil {
		t.Fatalf("z2 debe extender la regla: %+v", layout.Fronts[1])
	}
}

func TestOpeningCaseCFamilyGateRulesSelection(t *testing.T) {
	capabilities := &domain.OpeningCapabilities{
		Version: 1,
		Grips:   map[string]domain.OpeningGripCapability{domain.OpeningGripSystemBottomOverhang: {Enabled: true}},
		ByFurnitureType: map[string]domain.OpeningFurnitureTypeCapabilities{
			"superior": {Grips: map[string]domain.OpeningFurnitureTypeGrip{
				domain.OpeningGripSystemBottomOverhang: {Placements: []string{"bottom"}},
			}},
		},
	}
	rule := &domain.OpeningOverhangRule{Version: 1, OverhangMm: 40}
	selection := OpeningConfigurationSelection{
		System:        domain.OpeningGripSystemBottomOverhang,
		FurnitureType: "superior",
		Placements:    []string{"bottom"},
	}
	// Con regla: la selección pasa el gate.
	if got := ValidateOpeningConfiguration(selection, capabilities, nil, rule); got.State != OpeningSelectionValid {
		t.Fatalf("validación = %+v, want valid", got)
	}
	// Una posición fuera de la familia declarada sigue restringida.
	restricted := selection
	restricted.Placements = []string{"top"}
	if got := ValidateOpeningConfiguration(restricted, capabilities, nil, rule); got.State != OpeningSelectionInvalid || got.Reason != OpeningReasonPlacementRestricted {
		t.Fatalf("validación = %+v, want placementRestricted", got)
	}
	// Sin regla respaldada: blocked veraz aunque la familia permita.
	if got := ValidateOpeningConfiguration(selection, capabilities, nil, nil); got.State != OpeningSelectionBlocked || got.Reason != OpeningReasonOverhangEvidencePend {
		t.Fatalf("validación = %+v, want blocked/OQ-3", got)
	}
}
