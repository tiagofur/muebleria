package domain

/**
 * Shop-floor transition log (F092, parity with TS
 * packages/domain/src/productionFloorEvents.ts). One immutable row per
 * floor status change answering who/when/how.
 */

import "time"

// FloorEventSource tells how a transition was performed.
type FloorEventSource string

const (
	FloorEventSourceScan     FloorEventSource = "scan"
	FloorEventSourceManual   FloorEventSource = "manual"
	FloorEventSourceDispatch FloorEventSource = "dispatch"
	FloorEventSourceAPI      FloorEventSource = "api"
)

// NormalizeFloorEventSource coerces unknown values to "api".
func NormalizeFloorEventSource(s string) FloorEventSource {
	switch FloorEventSource(s) {
	case FloorEventSourceScan, FloorEventSourceManual, FloorEventSourceDispatch:
		return FloorEventSource(s)
	default:
		return FloorEventSourceAPI
	}
}

// FloorStatusEvent is one entry of the shop-floor log. IDs come from the
// writer (server for scans/patches; client UUIDs for web saves) and are
// deduplicated on insert.
type FloorStatusEvent struct {
	ID        string           `json:"id"`
	ProjectID string           `json:"project_id"`
	ItemID    string           `json:"item_id"`
	From      string           `json:"from_status"`
	To        string           `json:"to_status"`
	At        time.Time        `json:"at"`
	ByUserID  string           `json:"by_user_id,omitempty"`
	ByName    string           `json:"by_name,omitempty"`
	Source    FloorEventSource `json:"source"`
	Note      string           `json:"note,omitempty"`
}

// FloorEventJumpNote builds the audit note for non-adjacent transitions
// (dispatch loading jumps, supervisor corrections). Mirrors the TS helper.
func FloorEventJumpNote(note, from, to string) string {
	skip := "salto " + from + " → " + to
	if note != "" {
		return note + " (" + skip + ")"
	}
	return skip
}
