package domain

// Opening capabilities (#1134, épica #1128 / ADR-0009 §7-§8): the factory's
// self-service overlay for OPENING availability — what a factory OFFERS for
// new authoring, per grip system and per furniture type. Available and valid
// are distinct concepts: a capability enables offering; whether a concrete
// furniture/profile/layout combination resolves is the resolver's business
// (#1131) against the profile's pinned release (#1130). Disabling a
// capability hides/blocks NEW selection only — it never rewrites or
// invalidates existing designs, which keep resolving against their pinned
// release.
//
// The overlay carries NO dimensions: every millimetre belongs to the
// OpeningProfile datasheet. The parsers (engine Go + TS domain, one shared
// fixture) reject unknown keys, so dimensional payloads fail closed instead
// of riding in as "capabilities".
//
// Data structs live in domain (mirrors #1078: the catalog bakes the parsed
// capabilities into reads); the engine owns parsing + validation.

// Opening grip-system vocabulary (ADR-0009 §3/§7). "none" (no grip system)
// is the absence of a selection, not a capability entry.
const (
	OpeningGripSystemHandle         = "handle"
	OpeningGripSystemGola           = "gola"
	OpeningGripSystemBottomOverhang = "bottom_overhang"
)

// OpeningCapabilities is the parsed `opening.capabilities` overlay blob.
type OpeningCapabilities struct {
	Version int                              `json:"version"`
	Grips   map[string]OpeningGripCapability `json:"grips"`
	// ByFurnitureType carries per-type restrictions/defaults; a type absent
	// from the map inherits the base grips untouched.
	ByFurnitureType map[string]OpeningFurnitureTypeCapabilities `json:"byFurnitureType,omitempty"`
}

// OpeningGripCapability is one system's factory offering.
type OpeningGripCapability struct {
	Enabled bool `json:"enabled"`
	// Default marks the preselected system for new authoring; at most one
	// system may carry it (parser-enforced).
	Default bool `json:"default,omitempty"`
	// Profiles curates WHICH opening profiles the factory offers for gola
	// (exact library ids). Absent/empty = curation pending; never a
	// wildcard — the consumer resolves against exact ids only.
	Profiles []string `json:"profiles,omitempty"`
}

// OpeningFurnitureTypeCapabilities is one furniture type's restrictions and
// defaults.
type OpeningFurnitureTypeCapabilities struct {
	Grips map[string]OpeningFurnitureTypeGrip `json:"grips,omitempty"`
}

// OpeningFurnitureTypeGrip restricts one system on one furniture type.
type OpeningFurnitureTypeGrip struct {
	// Placements restricts where the system may mount for this type
	// (top | between | bottom). Absent = the profile's own compatible
	// placements govern.
	Placements []string `json:"placements,omitempty"`
	// Default overrides the base default for this type (pointer: absent ≠
	// false).
	Default *bool `json:"default,omitempty"`
}
