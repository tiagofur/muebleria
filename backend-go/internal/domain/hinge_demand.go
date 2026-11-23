package domain

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
)

// Door hinge DEMAND by height band (#1078).
//
// A 2100 mm pantry door and a 720 mm cabinet door cannot buy the same hinge
// count: demand DERIVES from the door's height through industry-standard
// bands (Blum/Hettich/Salice agree on the ladder), +1 Blum width surge for
// wide doors. The policy is a library default the factory overlay
// (joint.constructionPolicy.doorHingeDemand) and the per-component exception
// can override — the C3 ladder, same shape as the station patterns.
//
// Parity authorities:
//   - contracts/hingeDemandBands.contract.json pins the ladder consumed by
//     BOTH stacks (packages/domain vitest + engine go test);
//   - packages/domain/src/hingeDemand.ts owns the identical TS logic.
//
// This is DEMAND (what the quote buys). Drilling positions (TS F129,
// hingePositions) consume the same count source so cups drilled equal the
// hinges bought.

// HingeDemandRole is the option group the band demand consumes when the
// policy names no other.
const HingeDemandRole = "BISAGRA"

// HingeDemandLineDescription surfaces on band-derived resolved hardware
// lines (quotes, exports, releases) — the "banda aplicada" the UI shows.
const HingeDemandLineDescription = "Banda por altura de puerta"

// HingeDemandLinePrefix marks band-derived demand line IDs (origin marker,
// same pattern as placement-mod- for #1210).
const HingeDemandLinePrefix = "hingeband-"

// HingeDemandBand: doors up to (inclusive) UpToHeightMm buy Hinges hinges.
type HingeDemandBand struct {
	UpToHeightMm float64 `json:"upToHeightMm"`
	Hinges       int     `json:"hinges"`
}

// HingeDemandPolicy is the band ladder for one scope (library, factory or
// component). Bands must ascend by UpToHeightMm; doors taller than the last
// band clamp to it. WidthSurgeOverMm is the Blum rule:
//   - nil       → inherit the library default surge;
//   - 0         → disabled (explicit null on the wire — the parser maps
//     JSON null here, since JSON cannot distinguish absent from null);
//   - positive  → +1 hinge when the door width exceeds it (a missing width
//     never triggers the surge — never invented).
type HingeDemandPolicy struct {
	OptionRole       string            `json:"optionRole,omitempty"`
	Bands            []HingeDemandBand `json:"bands"`
	WidthSurgeOverMm *float64          `json:"widthSurgeOverMm,omitempty"`
}

// UnmarshalJSON keeps the surge tri-state honest on the wire (#1579). The
// documented contract is shared with the factory family: absent inherits the
// library default, an explicit null disables. A plain decode would collapse
// null into nil — "inherit" — which is what the hardware column reads through
// (the factory parser builds the struct by hand and never goes through here),
// so Go and TS would disagree on the same table. Marshaling never emits null
// (omitempty on the pointer, a disabled surge is a 0), so stored tables and
// release snapshots round-trip untouched.
func (p *HingeDemandPolicy) UnmarshalJSON(data []byte) error {
	type plain HingeDemandPolicy
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*p = HingeDemandPolicy(decoded)
	var keys map[string]json.RawMessage
	if err := json.Unmarshal(data, &keys); err != nil {
		return err
	}
	if raw, present := keys["widthSurgeOverMm"]; present && bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		zero := 0.0
		p.WidthSurgeOverMm = &zero
	}
	return nil
}

// DefaultHingeDemandPolicy is the library ladder (#1078 — industria:
// Blum/Hettich/Salice). The parity fixture's defaultPolicy case keeps TS and
// Go honest about this value.
func DefaultHingeDemandPolicy() HingeDemandPolicy {
	surge := 650.0
	return HingeDemandPolicy{
		Bands: []HingeDemandBand{
			{UpToHeightMm: 900, Hinges: 2},
			{UpToHeightMm: 1600, Hinges: 3},
			{UpToHeightMm: 2000, Hinges: 4},
			{UpToHeightMm: 2400, Hinges: 5},
		},
		WidthSurgeOverMm: &surge,
	}
}

// HingeCount is what one door buys under a policy, with the provenance of the
// last row (#1579). AboveLastBand is true when the door is taller than the
// table's last band: the count clamps to that row and the caller must surface
// it (the owner's rule: use the maximum, never stay silent, never block).
type HingeCount struct {
	Hinges           int
	AboveLastBand    bool
	LastBandHeightMm float64
}

// HingesForDoor returns the hinges DEMANDED by one door under the policy.
// nil policy = the whole library default (bands AND surge). A present policy
// owns its bands; an omitted surge inherits the default rule and an explicit
// zero disables it. A non-positive height demands nothing.
func HingesForDoor(doorHeightMm float64, doorWidthMm int, policy *HingeDemandPolicy) int {
	return ResolveHingeCount(doorHeightMm, doorWidthMm, policy).Hinges
}

// ResolveHingeCount is HingesForDoor with the last-band provenance (#1579).
// One implementation serves both, so the numeric half can never drift from
// the TS mirror (contracts/hingeDemandBands.contract.json).
func ResolveHingeCount(doorHeightMm float64, doorWidthMm int, policy *HingeDemandPolicy) HingeCount {
	if doorHeightMm <= 0 {
		return HingeCount{}
	}
	def := DefaultHingeDemandPolicy()
	bands := def.Bands
	surge := def.WidthSurgeOverMm
	if policy != nil {
		if len(policy.Bands) > 0 {
			bands = policy.Bands
		}
		surge = policy.WidthSurgeOverMm
		if surge == nil {
			surge = def.WidthSurgeOverMm
		}
	}
	hinges := 0
	matched := false
	for _, band := range bands {
		if doorHeightMm <= band.UpToHeightMm {
			if band.Hinges > 0 {
				hinges = band.Hinges
			}
			matched = true
			break
		}
	}
	if !matched {
		last := bands[len(bands)-1]
		if last.Hinges > 0 {
			hinges = last.Hinges
		}
	}
	if surge != nil && *surge > 0 && doorWidthMm > 0 && float64(doorWidthMm) > *surge {
		hinges += 1
	}
	return HingeCount{
		Hinges:           hinges,
		AboveLastBand:    !matched,
		LastBandHeightMm: bands[len(bands)-1].UpToHeightMm,
	}
}

// HingeDemandAboveLastBandMessage is the visible warning for a door taller
// than the table's last row (#1579, owner decision 3): the maximum applies
// and the quote says so instead of clamping silently. TS mirrors the copy
// (hingeDemandNotice) character for character — the parity fixture pins the
// sentence on both stacks — so millimetres print the same way on each: the
// shortest exact form, never a rounded one (2600, 2600.5).
func HingeDemandAboveLastBandMessage(doorHeightMm float64, count HingeCount) string {
	if !count.AboveLastBand {
		return ""
	}
	return fmt.Sprintf(
		"La puerta mide %s mm: supera la última banda de la tabla (%s mm). Se aplican %d bisagras por puerta.",
		strconv.FormatFloat(doorHeightMm, 'f', -1, 64),
		strconv.FormatFloat(count.LastBandHeightMm, 'f', -1, 64),
		count.Hinges,
	)
}

// HingeDemandTableMin/MaxHinges bound the quantity a hinge may declare per
// band (#1579: "de 2 hasta 5 es la cantidad patrón"). The factory policy keeps
// its wider 1..20 bound — it is an organization override, not a product spec.
const (
	HingeDemandTableMinHinges = 2
	HingeDemandTableMaxHinges = 5
)

// ValidateHingeDemandTable validates the table a hinge declares on write
// (#1579): the factory family's band rules (non-empty, ascending positive
// heights, non-negative surge) tightened to 2..5 hinges. optionRole has no
// meaning on a hinge's own table — the hinge IS the chosen hardware — so a
// declared role is refused rather than ignored. nil is valid (no table).
func ValidateHingeDemandTable(policy *HingeDemandPolicy) error {
	if policy == nil {
		return nil
	}
	if strings.TrimSpace(policy.OptionRole) != "" {
		return fmt.Errorf("la tabla de bisagras por altura de un herraje no admite optionRole")
	}
	if len(policy.Bands) == 0 {
		return fmt.Errorf("la tabla de bisagras por altura debe tener al menos una banda")
	}
	previous := 0.0
	for i, band := range policy.Bands {
		path := fmt.Sprintf("bands[%d]", i)
		if math.IsNaN(band.UpToHeightMm) || math.IsInf(band.UpToHeightMm, 0) || band.UpToHeightMm <= 0 || band.UpToHeightMm <= previous {
			return fmt.Errorf("%s.upToHeightMm debe ser positivo y ascendente (anterior %v)", path, previous)
		}
		previous = band.UpToHeightMm
		if band.Hinges < HingeDemandTableMinHinges || band.Hinges > HingeDemandTableMaxHinges {
			return fmt.Errorf("%s.hinges debe ser un entero entre %d y %d", path, HingeDemandTableMinHinges, HingeDemandTableMaxHinges)
		}
	}
	if surge := policy.WidthSurgeOverMm; surge != nil && (math.IsNaN(*surge) || math.IsInf(*surge, 0) || *surge < 0) {
		return fmt.Errorf("widthSurgeOverMm debe ser un número no negativo")
	}
	return nil
}

// HingeDemandEffectiveRole resolves the option group a policy consumes
// (BISAGRA default).
func HingeDemandEffectiveRole(policy *HingeDemandPolicy) string {
	if policy != nil && policy.OptionRole != "" {
		return policy.OptionRole
	}
	return HingeDemandRole
}
