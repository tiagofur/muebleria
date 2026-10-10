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
	// BOM carries the resolved profile/accessory lines (#1263) when the
	// caller provided a body context. Nil with a BOMReason is the truthful
	// absence — never a guessed run length or member count.
	BOM []OpeningResolvedBOMLine `json:"bom,omitempty"`
	// BOMReason reports why the BOM is absent for a gola selection (pin slice
	// predating #1263, body context not derivable, or a fail-closed BOM error).
	BOMReason string `json:"bomReason,omitempty"`
	// BOMEnds mirrors the end conditions the BOM was resolved with — the v1
	// declared default is visible to the caller, never silent.
	BOMEnds *OpeningBOMEndConditions `json:"bomEnds,omitempty"`
}

// DesignOpeningBOMContext is the body context the BOM resolution needs (#1263):
// the run's physical inputs the DESIGN-level surfaces own — the cabinet
// interior width (an input the #1133 contract refuses to derive here) and the
// profile BOM data (pinned first, live catalog only for pre-pin rows).
type DesignOpeningBOMContext struct {
	CabinetInteriorWidthMm int
	Ends                   OpeningBOMEndConditions
	Profiles               []OpeningProfileBOMData
}

// ResolveDesignOpening resolves the persisted selection over the design's
// front dimensions. widthMm/heightMm must be positive — the caller passes
// the furniture dims it resolved (nil selection returns nil: no intent, no
// resolution). overhangMm (#1138) is the factory's BACKED case C rule parsed
// from the versioned `opening.bottom-overhang` blob; nil = no backed rule,
// which keeps bottom_overhang BLOCKED verbatim. bomCtx (#1263) enables the
// BOM resolution for gola selections; nil keeps the fronts-only behavior.
func ResolveDesignOpening(
	widthMm, heightMm int,
	selection *domain.DesignOpeningSelection,
	profiles []OpeningProfileData,
	overhangMm *int,
	bomCtx *DesignOpeningBOMContext,
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
	resolution := &DesignOpeningResolution{
		State:  DesignOpeningStateResolved,
		Fronts: layout.Fronts,
	}
	if bomCtx != nil && selection.System == domain.OpeningGripSystemGola {
		resolution.BOMEnds = &bomCtx.Ends
		bomData, bomReason := designOpeningBOMData(selection, bomCtx)
		if bomReason != "" {
			resolution.BOMReason = bomReason
		} else if bomCtx.CabinetInteriorWidthMm <= 0 {
			resolution.BOMReason = OpeningReasonBOMBodyContextMissing
		} else if lines, bomErr := ResolveOpeningBOM(layout, bomCtx.CabinetInteriorWidthMm, bomCtx.Ends, []OpeningProfileBOMData{bomData}); bomErr != nil {
			// Corrupt declared data is reported verbatim; the fronts stay
			// resolved — the BOM never blocks the presentation of fronts.
			resolution.BOMReason = bomErr.Code
		} else {
			resolution.BOM = lines
		}
	}
	return resolution, nil
}

// designOpeningBOMData picks the BOM slice the historical design owns: the
// pin freezes revision + members at validation time; the live catalog only
// feeds rows authored before the pin existed (same fallback rule as fronts).
func designOpeningBOMData(selection *domain.DesignOpeningSelection, bomCtx *DesignOpeningBOMContext) (OpeningProfileBOMData, string) {
	if pin := selection.ProfilePin; pin != nil {
		if pin.BOM == nil {
			// Pre-#1263 pin: the frozen slice never included the BOM — the
			// truthful absence, never a live-catalog fallback.
			return OpeningProfileBOMData{}, OpeningReasonBOMPinSliceMissing
		}
		members := make(map[string]OpeningContractBOMMember, len(pin.BOM.Members))
		for key, member := range pin.BOM.Members {
			members[key] = openingContractBOMMember(member)
		}
		return OpeningProfileBOMData{
			ProfileID:  selection.ProfileID,
			Version:    pin.BOM.ProfileVersion,
			BOMMembers: members,
		}, ""
	}
	for _, profile := range bomCtx.Profiles {
		if profile.ProfileID == selection.ProfileID {
			return profile, ""
		}
	}
	return OpeningProfileBOMData{}, OpeningErrProfileUnknown
}
