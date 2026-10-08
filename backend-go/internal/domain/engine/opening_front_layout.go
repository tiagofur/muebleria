package engine

import (
	"fmt"
	"strings"
)

// Opening Layout resolver (#1131) — the semantic layer of the opening/front
// contract v1 on top of ResolveOpeningFront (#1129): zones, ratios and grip
// boundaries become canonical FRONT results. Never a second resolver: the
// height math is ResolveOpeningFront's (single authority, shared fixture
// contracts/openingFrontResolution.contract.json); this layer maps the
// resolved zones onto axis-correct boxes, resolved grip data and the rules
// applied (ADR-0009).
//
// Axis mapping (pinned by the shared fixture): a `vertical` layout divides
// the cabinet front HEIGHT (zones stack top→bottom); a `horizontal` layout
// divides the front WIDTH (zones left→right). The cross axis passes through
// untouched — every zone of the layout spans it. Front offsets measure along
// the divided axis from the start of the available region, in zone order.
//
// Grip sides are resolved data (OQ-1), derived from boundary incidence:
//   - `top`    grips from ABOVE every zone it touches: ALL zones in a
//     horizontal layout (they all span the height), only the FIRST in a
//     vertical one.
//   - `bottom` grips from BELOW: ALL zones in a horizontal layout, only the
//     LAST in a vertical one.
//   - `between(a,b)` grips a from BELOW and b from ABOVE.
//
// Identity is stable because it is declared: the zone id from the authored
// layout — component names are never consulted (ADR-0009 §3).
//
// Fail-closed: unknown direction/access, non-positive front dimensions or an
// empty zone id are incompatible inputs and fail OPENING_LAYOUT_INVALID
// BEFORE the v1 math runs; every v1 error (pending datasheet, OQ-3 overhang,
// boundary problems) propagates verbatim. Nothing is invented.

// OpeningResolvedFrontGrip is the grip boundary data that grips one front,
// fully resolved (consumption included — the consumer never re-derives it).
type OpeningResolvedFrontGrip struct {
	Boundary   string `json:"boundary"`
	Side       string `json:"side"` // "above" | "below": where the grip sits relative to this front
	ProfileID  string `json:"profileId"`
	ConsumedMm int    `json:"consumedMm"`
}

// OpeningResolvedFrontRules references the rules applied to one front —
// declared inputs, never derived values.
type OpeningResolvedFrontRules struct {
	Direction       string `json:"direction"`
	Positioning     string `json:"positioning"`
	Ratio           int    `json:"ratio"`
	RatioSum        int    `json:"ratioSum"`
	RemainderTarget bool   `json:"remainderTarget"`
}

// OpeningResolvedFront is the canonical result for one zone: stable identity,
// declared access, axis-mapped box and resolved grip/rules data.
type OpeningResolvedFront struct {
	ZoneID   string                     `json:"zoneId"`
	Access   string                     `json:"access"`
	WidthMm  int                        `json:"widthMm"`
	HeightMm int                        `json:"heightMm"`
	OffsetMm int                        `json:"offsetMm"`
	Grips    []OpeningResolvedFrontGrip `json:"grips"`
	Rules    OpeningResolvedFrontRules  `json:"rules"`
}

// OpeningFrontLayout is the #1131 semantic result: the v1 resolution verbatim
// plus one front per zone.
type OpeningFrontLayout struct {
	Contract   string                 `json:"contract"`
	Resolution *OpeningResolution     `json:"resolution"`
	Fronts     []OpeningResolvedFront `json:"fronts"`
}

func openingZoneAccessKnown(access string) bool {
	switch access {
	case "hinged", "drawer", "lift_up", "fold_up", "pull_out":
		return true
	}
	return false
}

// ResolveOpeningFrontLayout resolves an opening intent into semantic fronts.
// Pure, deterministic, integer millimetres; identical to the TS domain
// through the shared fixture. Shape errors fail closed before the v1 math;
// v1 errors propagate verbatim.
func ResolveOpeningFrontLayout(
	intent OpeningIntent,
	cabinetFrontWidthMm, cabinetFrontHeightMm int,
	profiles []OpeningProfileData,
) (*OpeningFrontLayout, *OpeningResolutionError) {
	if intent.Layout.Direction != "vertical" && intent.Layout.Direction != "horizontal" {
		return nil, openingFail(OpeningErrLayoutInvalid,
			fmt.Sprintf("dirección de layout desconocida %s", intent.Layout.Direction))
	}
	if cabinetFrontWidthMm <= 0 || cabinetFrontHeightMm <= 0 {
		return nil, openingFail(OpeningErrLayoutInvalid,
			"las dimensiones del frente deben ser mayores a 0")
	}
	for _, zone := range intent.Layout.Zones {
		if strings.TrimSpace(zone.ID) == "" {
			return nil, openingFail(OpeningErrLayoutInvalid,
				"toda zona necesita un id declarado para tener identidad estable")
		}
		if !openingZoneAccessKnown(zone.Access) {
			return nil, openingFail(OpeningErrLayoutInvalid,
				fmt.Sprintf("la zona %s tiene un access desconocido %s", zone.ID, zone.Access))
		}
	}

	// Single math authority: the v1 resolver over the divided axis.
	dividedAxisMm := cabinetFrontHeightMm
	if intent.Layout.Direction == "horizontal" {
		dividedAxisMm = cabinetFrontWidthMm
	}
	resolution, resErr := ResolveOpeningFront(intent, dividedAxisMm, profiles)
	if resErr != nil {
		return nil, resErr
	}

	crossMm := cabinetFrontWidthMm
	if intent.Layout.Direction == "horizontal" {
		crossMm = cabinetFrontHeightMm
	}
	consumedByBoundary := map[string]int{}
	for _, boundary := range resolution.Boundaries {
		consumedByBoundary[boundary.Boundary] = boundary.ConsumedMm
	}
	ratioSum := 0
	for _, zone := range intent.Layout.Zones {
		ratioSum += zone.Ratio
	}

	fronts := make([]OpeningResolvedFront, 0, len(resolution.Zones))
	for i, resolvedZone := range resolution.Zones {
		zone := intent.Layout.Zones[i]
		widthMm := crossMm
		heightMm := resolvedZone.HeightMm
		if intent.Layout.Direction == "horizontal" {
			widthMm = resolvedZone.HeightMm
			heightMm = crossMm
		}
		fronts = append(fronts, OpeningResolvedFront{
			ZoneID:   resolvedZone.ID,
			Access:   zone.Access,
			WidthMm:  widthMm,
			HeightMm: heightMm,
			OffsetMm: resolvedZone.OffsetFromStartMm,
			Grips:    openingFrontGrips(intent, resolvedZone.ID, consumedByBoundary),
			Rules: OpeningResolvedFrontRules{
				Direction:       intent.Layout.Direction,
				Positioning:     intent.Positioning,
				Ratio:           zone.Ratio,
				RatioSum:        ratioSum,
				RemainderTarget: resolvedZone.ID == resolution.RemainderZoneID,
			},
		})
	}

	return &OpeningFrontLayout{
		Contract:   OpeningFrontContract,
		Resolution: resolution,
		Fronts:     fronts,
	}, nil
}

// openingFrontGrips attaches the declared grips to one zone as resolved data:
// top/bottom boundaries grip by edge incidence (direction-dependent);
// between boundaries grip their two named zones. Order follows the intent's
// grip declaration.
func openingFrontGrips(
	intent OpeningIntent,
	zoneID string,
	consumedByBoundary map[string]int,
) []OpeningResolvedFrontGrip {
	grips := []OpeningResolvedFrontGrip{}
	for _, grip := range intent.Grips {
		key := openingGripBoundaryKey(grip)
		switch grip.Boundary {
		case "top":
			if !openingEdgeTouchesZone(intent, grip.Boundary, zoneID) {
				continue
			}
			grips = append(grips, OpeningResolvedFrontGrip{
				Boundary: key, Side: "above",
				ProfileID: grip.ProfileID, ConsumedMm: consumedByBoundary[key],
			})
		case "bottom":
			if !openingEdgeTouchesZone(intent, grip.Boundary, zoneID) {
				continue
			}
			grips = append(grips, OpeningResolvedFrontGrip{
				Boundary: key, Side: "below",
				ProfileID: grip.ProfileID, ConsumedMm: consumedByBoundary[key],
			})
		case "between":
			if grip.AboveZone == zoneID {
				grips = append(grips, OpeningResolvedFrontGrip{
					Boundary: key, Side: "below",
					ProfileID: grip.ProfileID, ConsumedMm: consumedByBoundary[key],
				})
			}
			if grip.BelowZone == zoneID {
				grips = append(grips, OpeningResolvedFrontGrip{
					Boundary: key, Side: "above",
					ProfileID: grip.ProfileID, ConsumedMm: consumedByBoundary[key],
				})
			}
		}
	}
	return grips
}

// openingEdgeTouchesZone resolves edge incidence: in a vertical layout the
// top edge only touches the first zone and the bottom edge only the last;
// in a horizontal layout every zone spans the full cross axis, so both edges
// touch every zone.
func openingEdgeTouchesZone(intent OpeningIntent, boundary, zoneID string) bool {
	zones := intent.Layout.Zones
	if len(zones) == 0 {
		return false
	}
	if boundary == "top" {
		if intent.Layout.Direction == "vertical" {
			return zones[0].ID == zoneID
		}
		for _, zone := range zones {
			if zone.ID == zoneID {
				return true
			}
		}
		return false
	}
	if boundary == "bottom" {
		if intent.Layout.Direction == "vertical" {
			return zones[len(zones)-1].ID == zoneID
		}
		for _, zone := range zones {
			if zone.ID == zoneID {
				return true
			}
		}
		return false
	}
	return false
}
