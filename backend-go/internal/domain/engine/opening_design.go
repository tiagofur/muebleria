package engine

import (
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// Design opening resolution (#1137) — the server-side resolve of a persisted
// design opening selection: fronts and grip consumption from the #1131
// layout resolver over the design's front dimensions. The plugin sends the
// intent and renders the result; NOTHING here is computed client-side and
// no BOM/machining derives locally.
//
// Layout v1: a single zone with ratio 1 — the pilot resolves ONE front
// region per furniture; the zone editor over agregado composition is
// explicit later scope (ADR-0009 §10 keeps the Inspector free of layout
// math, and §4 keeps first slices at one module).
//
// Historical rule (same discipline as #1135): a PERSISTED selection resolves
// regardless of today's factory capabilities — capabilities govern NEW
// selection at the write endpoint, never the resolution of existing
// designs. Pending evidence blocks honestly: bottom_overhang reports
// OPENING_OVERHANG_EVIDENCE_PENDING (OQ-3) and a datasheet-pending profile
// reports OPENING_PROFILE_DATASHEET_PENDING — states, never invented dims.
//
// Dimensions come from the design's furniture (explicit item parameters),
// passed by the API layer; the engine never loads the catalog or the design.

// DesignOpeningResolvedState values.
const (
	DesignOpeningStateResolved = "resolved"
	DesignOpeningStateBlocked  = "blocked"
)

// DesignOpeningResolution is the resolve result for one design's opening:
// the read-only derived data the Inspector renders.
type DesignOpeningResolution struct {
	State  string                 `json:"state"`
	Reason string                 `json:"reason,omitempty"`
	Fronts []OpeningResolvedFront `json:"fronts,omitempty"`
}

// ResolveDesignOpening resolves the persisted selection over the design's
// front dimensions. widthMm/heightMm must be positive — the caller passes
// the furniture dims it resolved (nil selection returns nil: no intent, no
// resolution). overhangMm (#1138) is the factory's BACKED case C rule parsed
// from the versioned `opening.bottom-overhang` blob; nil = no backed rule,
// which keeps bottom_overhang BLOCKED verbatim.
func ResolveDesignOpening(
	widthMm, heightMm int,
	selection *domain.DesignOpeningSelection,
	profiles []OpeningProfileData,
	overhangMm *int,
) (*DesignOpeningResolution, *OpeningResolutionError) {
	if selection == nil {
		return nil, nil
	}
	if widthMm <= 0 || heightMm <= 0 {
		return nil, openingFail(OpeningErrLayoutInvalid,
			"las dimensiones del mueble deben ser mayores a 0 para resolver la apertura")
	}
	intent := OpeningIntent{
		Layout: OpeningLayout{Direction: "vertical", Zones: []OpeningZone{
			{ID: "z1", Access: "hinged", Ratio: 1},
		}},
		Positioning: "overlay",
	}
	switch selection.System {
	case domain.OpeningGripSystemGola:
		// B3 (review of the review): v1 resolves ONE front region — a
		// persisted `between` (only possible in pre-fix rows) is a truthful
		// blocked state, never a silent reinterpretation as top.
		for _, placement := range selection.Placements {
			if placement == "between" {
				return &DesignOpeningResolution{
					State:  DesignOpeningStateBlocked,
					Reason: OpeningReasonPlacementIncompatible,
				}, nil
			}
		}
		intent.Grips = []OpeningGrip{{Boundary: "top", ProfileID: selection.ProfileID}}
		for _, placement := range selection.Placements {
			if placement == "bottom" {
				intent.Grips = []OpeningGrip{{Boundary: "bottom", ProfileID: selection.ProfileID}}
			}
		}
	case domain.OpeningGripSystemBottomOverhang:
		intent.Positioning = "bottom_overhang"
	case domain.OpeningGripSystemHandle:
		// A handled front consumes nothing: the baseline resolution.
	}

	layout, resErr := ResolveOpeningFrontLayout(intent, widthMm, heightMm, profiles, overhangMm)
	if resErr != nil {
		// Pending evidence (OQ-3) and pending datasheets are truthful
		// blocked states; anything else is a shape the write path should
		// have rejected — surfaced verbatim either way.
		return &DesignOpeningResolution{State: DesignOpeningStateBlocked, Reason: resErr.Code}, nil
	}
	return &DesignOpeningResolution{
		State:  DesignOpeningStateResolved,
		Fronts: layout.Fronts,
	}, nil
}
