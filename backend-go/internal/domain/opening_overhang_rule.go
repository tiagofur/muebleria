package domain

// Opening overhang rule (#1138, caso C / ADR-0009 §6): the factory's BACKED
// rule for the `bottom_overhang` positioning — the one declared millimetre
// the front extends below the body bottom. Same overlay mechanism as
// `opening.capabilities` (#1134), as a SIBLING blob: #1134 pinned that the
// capabilities blob carries NO dimensions (unknown keys fail closed so
// millimetres can never ride in as "capabilities"), and case C consumes no
// OpeningProfile (no grip hardware) — the rule is the third legitimate home
// of declared millimetres: profile datasheets, profile body modifiers, and
// this versioned factory rule.
//
// Absent blob = no backed rule: the resolution stays BLOCKED
// (OPENING_OVERHANG_EVIDENCE_PENDING, the truthful #1135 state). The overlay
// composes into pinned releases (#1193), so a rule arriving later never
// rewrites historical pinned designs.

// OpeningOverhangRuleBlobKey is the overlay overrides key of the case C rule.
const OpeningOverhangRuleBlobKey = "opening.bottom-overhang"

// OpeningOverhangRule is the parsed `opening.bottom-overhang` overlay blob.
type OpeningOverhangRule struct {
	Version int `json:"version"`
	// OverhangMm is the positive integer millimetres the front extends
	// below the body.
	OverhangMm int `json:"overhangMm"`
}
