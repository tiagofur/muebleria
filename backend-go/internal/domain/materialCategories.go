package domain

import "time"

// MaterialCategory is a node in the board-material category tree (F142
// subgrupos de tableros, mirror of AmbientCategory from F086). Max depth 3,
// same placement rules as module/ambient categories.
type MaterialCategory struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	ParentID  string    `json:"parent_id,omitempty"`
	SortOrder int       `json:"sort_order"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}
