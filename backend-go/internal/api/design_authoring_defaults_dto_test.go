package api

import (
	"testing"

	"github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

func intPtr(v int) *int { return &v }

func floatPtr(v float64) *float64 { return &v }

// #1330 — the working-copy DTO exposes the durable opening selection with
// its frozen pin so the web's read-only procedencia surface consumes exactly
// what the design opening GET serializes. Mapping fidelity: no field
// invented, no truthful absence coerced.
func TestToDesignAuthoringDefaultsDTOMapsOpeningPin(t *testing.T) {
	withoutOpening := toDesignAuthoringDefaultsDTO(domain.DesignAuthoringDefaults{
		MaterialChoices: map[string]string{"INTERIOR": "mat-1"},
	})
	if withoutOpening.Opening != nil {
		t.Fatalf("a design without opening must serialize the absence, got %+v", withoutOpening.Opening)
	}

	discount := 40
	full := toDesignAuthoringDefaultsDTO(domain.DesignAuthoringDefaults{
		MaterialChoices: map[string]string{},
		Opening: &domain.DesignOpeningSelection{
			System: "gola", ProfileID: "profile.gola-l.8006", Placements: []string{"top"},
			ProfilePin: &domain.DesignOpeningProfilePin{
				ProfileCode: "GOLA-L-8006", FrontReductionMm: 38, GripClearanceMm: 2,
				DoorReductionMm: &discount, DatasheetStatus: "verified",
				ProfileHeightMm: 56.5, ProfileDepthMm: 27.2,
				CompatiblePlacements: []string{"top"},
				BodyModifiers: []domain.OpeningBodyModifier{
					{Role: "lateral", NotchHeightMm: floatPtr(56.5), NotchDepthMm: floatPtr(27.2), NotchAt: "top_front"},
					{Role: "horizontal", Effect: "depth_reduction"},
				},
				BOM: &domain.DesignOpeningProfilePinBOM{
					ProfileVersion: 8,
					Members: map[string]domain.OpeningBOMMember{
						"profile": {HardwareID: "hw-8006", Rule: "interior_width", Unit: "meter"},
						"supports": {HardwareID: "hw-su116", Rule: "per_length", SpacingMm: intPtr(400),
							DimensionsMm: &[3]float64{17, 19.5, 39.5}},
					},
				},
			},
		},
	})

	opening := full.Opening
	if opening == nil || opening.System != "gola" || opening.ProfileId == nil || *opening.ProfileId != "profile.gola-l.8006" {
		t.Fatalf("selection drifted: %+v", opening)
	}
	pin := opening.ProfilePin
	if pin == nil {
		t.Fatal("the pin must travel with the selection")
	}
	if pin.ProfileCode != "GOLA-L-8006" || pin.FrontReductionMm != 38 || pin.GripClearanceMm != 2 ||
		pin.DoorReductionMm == nil || *pin.DoorReductionMm != 40 || pin.DatasheetStatus != "verified" ||
		pin.ProfileHeightMm == nil || *pin.ProfileHeightMm != 56.5 || pin.ProfileDepthMm == nil || *pin.ProfileDepthMm != 27.2 {
		t.Fatalf("pin datasheet slice drifted: %+v", pin)
	}
	if len(pin.BodyModifiers) != 2 {
		t.Fatalf("body modifiers drifted: %+v", pin.BodyModifiers)
	}
	notch := pin.BodyModifiers[0]
	if notch.NotchHeightMm == nil || *notch.NotchHeightMm != 56.5 || notch.NotchAt == nil || *notch.NotchAt != "top_front" {
		t.Fatalf("notch modifier drifted: %+v", notch)
	}
	reduction := pin.BodyModifiers[1]
	if reduction.Effect == nil || *reduction.Effect != "depth_reduction" {
		t.Fatalf("derived reduction modifier drifted: %+v", reduction)
	}
	if pin.Bom == nil || pin.Bom.ProfileVersion != 8 || len(pin.Bom.Members) != 2 {
		t.Fatalf("pin BOM slice drifted: %+v", pin.Bom)
	}
	supports := pin.Bom.Members["supports"]
	if supports.SpacingMm == nil || *supports.SpacingMm != 400 || len(supports.DimensionsMm) != 3 {
		t.Fatalf("supports member drifted: %+v", supports)
	}
}

// #1330: pins authored before the envelope/BOM slices existed keep the
// truthful absence through the DTO (0 envelope → absent fields, nil BOM).
func TestToDesignAuthoringDefaultsDTOLegacyPinAbsences(t *testing.T) {
	legacy := toDesignAuthoringDefaultsDTO(domain.DesignAuthoringDefaults{
		MaterialChoices: map[string]string{},
		Opening: &domain.DesignOpeningSelection{
			System: "gola", ProfileID: "profile.gola-l.8006",
			ProfilePin: &domain.DesignOpeningProfilePin{
				ProfileCode: "GOLA-L-8006", FrontReductionMm: 38, GripClearanceMm: 2, DatasheetStatus: "verified",
			},
		},
	})
	pin := legacy.Opening.ProfilePin
	if pin.ProfileHeightMm != nil || pin.ProfileDepthMm != nil || pin.Bom != nil ||
		len(pin.BodyModifiers) != 0 || pin.DoorReductionMm != nil || len(pin.CompatiblePlacements) != 0 {
		t.Fatalf("legacy pin absences must survive the DTO: %+v", pin)
	}
	// Compile-time guard: the generated shape stays the contract's.
	var _ generated.DesignOpeningProfilePin = *pin
}
