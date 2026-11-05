package domain

import "time"

// HardwareCategory is a node in the hardware category tree (#1507 subgrupos
// de herrajes, mirror of MaterialCategory from F142). Max depth 3, same
// placement rules as module/ambient/material categories.
type HardwareCategory struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	ParentID  string    `json:"parent_id,omitempty"`
	SortOrder int       `json:"sort_order"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	// Version is server-owned optimistic-concurrency state (#443/#448):
	// writes carry the expected version as If-Match and the server bumps it.
	Version int64 `json:"version"`
}
