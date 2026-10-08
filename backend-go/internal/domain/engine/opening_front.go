package engine

import "fmt"

// Opening / Front contract v1 (#1128/#1129) — the canonical declarative
// INTENT and its RESOLVED result, shared with the TS domain through
// contracts/openingFrontResolution.contract.json (one authority; Go is the
// resolve authority, TS parity only — ADR-0009).
//
// Resolution math (contract v1, deterministic, integer millimetres):
//	available = frontHeight − Σ(frontReduction + clearance of every grip)
//	height_i  = floor(available × ratio_i / Σratios)
//	remainder = available − Σheights, distributed 1 mm per zone starting at
//	the LAST zone moving up (remainderZonePolicy = "last_zone_first", fixed
//	in v1). Integer math only; canonical outputs are integer mm.
//
// Fail-closed by design: a profile whose datasheet is not verified blocks
// authoring (OPENING_PROFILE_DATASHEET_PENDING); bottom_overhang blocks on
// pending field evidence (OPENING_OVERHANG_EVIDENCE_PENDING, OQ-3). Nothing
// is invented.

const OpeningFrontContract = "granete.opening-front.v1"

// Resolution error codes — mirrored verbatim by the TS domain.
const (
	OpeningErrLayoutInvalid        = "OPENING_LAYOUT_INVALID"
	OpeningErrBoundaryInvalid      = "OPENING_BOUNDARY_INVALID"
	OpeningErrBoundaryDuplicate    = "OPENING_BOUNDARY_DUPLICATE"
	OpeningErrBoundaryUnknownZone  = "OPENING_BOUNDARY_UNKNOWN_ZONE"
	OpeningErrDatasheetPending     = "OPENING_PROFILE_DATASHEET_PENDING"
	OpeningErrProfileUnknown       = "OPENING_PROFILE_UNKNOWN"
	OpeningErrOverhangEvidencePend = "OPENING_OVERHANG_EVIDENCE_PENDING"
)

// OpeningResolutionError carries the contract's fail-closed codes.
type OpeningResolutionError struct {
	Code    string
	Message string
}

func (e *OpeningResolutionError) Error() string {
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

type OpeningZone struct {
	ID     string `json:"id"`
	Access string `json:"access"`
	Ratio  int    `json:"ratio"`
}

type OpeningLayout struct {
	Direction string        `json:"direction"`
	Zones     []OpeningZone `json:"zones"`
}

type OpeningGrip struct {
	Boundary  string `json:"boundary"`
	AboveZone string `json:"aboveZone,omitempty"`
	BelowZone string `json:"belowZone,omitempty"`
	ProfileID string `json:"profileId"`
}

type OpeningIntent struct {
	Layout      OpeningLayout `json:"layout"`
	Grips       []OpeningGrip `json:"grips"`
	Positioning string        `json:"positioning"`
}

// OpeningProfileData is the library profile data the resolution consumes —
// datasheet-backed (#1130 owns the entity); anything but "verified" blocks.
type OpeningProfileData struct {
	ProfileID        string `json:"profileId"`
	DatasheetStatus  string `json:"datasheetStatus"`
	FrontReductionMm int    `json:"frontReductionMm"`
	GripClearanceMm  int    `json:"gripClearanceMm"`
}

type OpeningResolvedZone struct {
	ID                string `json:"id"`
	HeightMm          int    `json:"heightMm"`
	OffsetFromStartMm int    `json:"offsetFromStartMm"`
}

type OpeningResolvedBoundary struct {
	Boundary   string `json:"boundary"`
	ConsumedMm int    `json:"consumedMm"`
}

type OpeningResolution struct {
	AvailableFrontHeightMm int                       `json:"availableFrontHeightMm"`
	Zones                  []OpeningResolvedZone     `json:"zones"`
	Boundaries             []OpeningResolvedBoundary `json:"boundaries"`
	RemainderZoneID        string                    `json:"remainderZoneId"`
}

func openingFail(code, message string) *OpeningResolutionError {
	return &OpeningResolutionError{Code: code, Message: message}
}

func openingGripBoundaryKey(grip OpeningGrip) string {
	if grip.Boundary == "between" {
		return fmt.Sprintf("between:%s:%s", grip.AboveZone, grip.BelowZone)
	}
	return grip.Boundary
}

// ResolveOpeningFront resolves the front heights of an opening intent. Pure,
// deterministic, integer millimetres; identical to the TS domain through the
// shared fixture. Never mutates, never invents: blocked evidence → blocked
// result.
func ResolveOpeningFront(
	intent OpeningIntent,
	cabinetFrontHeightMm int,
	profiles []OpeningProfileData,
) (*OpeningResolution, *OpeningResolutionError) {
	zones := intent.Layout.Zones
	if len(zones) == 0 {
		return nil, openingFail(OpeningErrLayoutInvalid, "la composición de frentes no tiene zonas")
	}
	seen := map[string]bool{}
	zoneIndex := map[string]int{}
	for i, zone := range zones {
		if seen[zone.ID] {
			return nil, openingFail(OpeningErrLayoutInvalid, fmt.Sprintf("zona duplicada %s", zone.ID))
		}
		seen[zone.ID] = true
		if zone.Ratio <= 0 {
			return nil, openingFail(OpeningErrLayoutInvalid, fmt.Sprintf("la zona %s tiene un ratio inválido", zone.ID))
		}
		zoneIndex[zone.ID] = i
	}

	if intent.Positioning == "bottom_overhang" {
		// OQ-3: overhang value and body interaction lack field evidence — the
		// intent is valid, the resolution is blocked, nothing is invented.
		return nil, openingFail(OpeningErrOverhangEvidencePend,
			"el rebase inferior espera evidencia de campo (OQ-3)")
	}

	boundaryKeys := map[string]bool{}
	consumed := 0
	boundaries := []OpeningResolvedBoundary{}
	for _, grip := range intent.Grips {
		key := openingGripBoundaryKey(grip)
		if boundaryKeys[key] {
			return nil, openingFail(OpeningErrBoundaryDuplicate, fmt.Sprintf("frontera duplicada %s", key))
		}
		boundaryKeys[key] = true
		if grip.Boundary == "between" {
			above, aboveOK := zoneIndex[grip.AboveZone]
			below, belowOK := zoneIndex[grip.BelowZone]
			if !aboveOK || !belowOK {
				return nil, openingFail(OpeningErrBoundaryUnknownZone,
					fmt.Sprintf("frontera %s referencia una zona desconocida", key))
			}
			if below != above+1 {
				return nil, openingFail(OpeningErrBoundaryInvalid,
					fmt.Sprintf("frontera %s entre zonas no adyacentes", key))
			}
		}
		profile, found := func() (*OpeningProfileData, bool) {
			for i := range profiles {
				if profiles[i].ProfileID == grip.ProfileID {
					return &profiles[i], true
				}
			}
			return nil, false
		}()
		if !found {
			return nil, openingFail(OpeningErrProfileUnknown, fmt.Sprintf("perfil desconocido %s", grip.ProfileID))
		}
		if profile.DatasheetStatus != "verified" {
			return nil, openingFail(OpeningErrDatasheetPending,
				fmt.Sprintf("el perfil %s espera ficha técnica", grip.ProfileID))
		}
		take := profile.FrontReductionMm + profile.GripClearanceMm
		consumed += take
		boundaries = append(boundaries, OpeningResolvedBoundary{Boundary: key, ConsumedMm: take})
	}

	available := cabinetFrontHeightMm - consumed
	if available <= 0 {
		return nil, openingFail(OpeningErrLayoutInvalid, "los grips consumen más que la altura del frente")
	}
	ratioSum := 0
	for _, zone := range zones {
		ratioSum += zone.Ratio
	}

	// Integer math only: floors + explicit remainder distribution.
	heights := make([]int, len(zones))
	used := 0
	for i, zone := range zones {
		heights[i] = available * zone.Ratio / ratioSum
		used += heights[i]
	}
	remainder := available - used
	remainderZoneID := zones[len(zones)-1].ID
	for i := len(zones) - 1; i >= 0 && remainder > 0; i-- {
		heights[i]++
		remainder--
	}

	resolvedZones := make([]OpeningResolvedZone, 0, len(zones))
	offset := 0
	for i, zone := range zones {
		resolvedZones = append(resolvedZones, OpeningResolvedZone{
			ID: zone.ID, HeightMm: heights[i], OffsetFromStartMm: offset,
		})
		offset += heights[i]
	}

	return &OpeningResolution{
		AvailableFrontHeightMm: available,
		Zones:                  resolvedZones,
		Boundaries:             boundaries,
		RemainderZoneID:        remainderZoneID,
	}, nil
}
