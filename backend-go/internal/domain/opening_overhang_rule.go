package domain

// Opening overhang rule (#1138, caso C / ADR-0009 §6): the millimetres a
// v1 `bottom_overhang` selection extends the front below the body. Since
// #1531 it is projected from the workshop's grip styles
// (OpeningOverhangRuleFromGripStyles: 20 by default, A4); the overlay blob it
// used to be parsed from is retired, and the resolution no longer waits for
// field evidence.
type OpeningOverhangRule struct {
	Version int `json:"version"`
	// OverhangMm is the positive integer millimetres the front extends
	// below the body.
	OverhangMm int `json:"overhangMm"`
}
