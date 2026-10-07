package domain

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

// HingesForDoor returns the hinges DEMANDED by one door under the policy.
// nil policy = the whole library default (bands AND surge). A present policy
// owns its bands; an omitted surge inherits the default rule and an explicit
// zero disables it. A non-positive height demands nothing.
func HingesForDoor(doorHeightMm, doorWidthMm int, policy *HingeDemandPolicy) int {
	if doorHeightMm <= 0 {
		return 0
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
		if float64(doorHeightMm) <= band.UpToHeightMm {
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
	return hinges
}

// HingeDemandEffectiveRole resolves the option group a policy consumes
// (BISAGRA default).
func HingeDemandEffectiveRole(policy *HingeDemandPolicy) string {
	if policy != nil && policy.OptionRole != "" {
		return policy.OptionRole
	}
	return HingeDemandRole
}
