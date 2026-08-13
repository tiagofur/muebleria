package domain

import "time"

// AmbientCategory is a node in a user-defined category tree (max depth 3) for
// ambient / finish materials (spec #4150 / F086).
type AmbientCategory struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	ParentID  string    `json:"parent_id,omitempty"`
	SortOrder int       `json:"sort_order"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// AmbientMaterial is a presentation-only surface/finish for the 3D scene
// (spec #4150 / design #4151 / F086). It deliberately carries NO pricing or BOM
// fields — that clean type separation is the guarantee that ambient materials
// never leak into quotes, cutlists, cost breakdowns or the Optimizer export.
//
// It mirrors the preview_* subset of MaterialBoard (color, texture, tile mm,
// PBR roughness/metalness/clearcoat) plus a surface_type discriminator and
// category_id linking into AmbientCategory.
type AmbientMaterial struct {
	ID                         string             `json:"id"`
	Code                       string             `json:"code"`
	Name                       string             `json:"name"`
	Active                     bool               `json:"active"`
	SurfaceType                AmbientSurfaceType `json:"surface_type"`
	CategoryID                 string             `json:"category_id,omitempty"`
	PreviewColor               string             `json:"preview_color,omitempty"`
	PreviewTextureURL          string             `json:"preview_texture_url,omitempty"`
	PreviewTextureTileWidthMm  *float64           `json:"preview_texture_tile_width_mm,omitempty"`
	PreviewTextureTileLengthMm *float64           `json:"preview_texture_tile_length_mm,omitempty"`
	PreviewRoughness           *float64           `json:"preview_roughness,omitempty"`
	PreviewMetalness           *float64           `json:"preview_metalness,omitempty"`
	PreviewClearcoat           *float64           `json:"preview_clearcoat,omitempty"`
}

// AmbientSurfaceType discriminates floor vs wall ambient materials. Stored as
// TEXT in Postgres and validated client-side against {floor, wall, ceiling}.
type AmbientSurfaceType string

const (
	AmbientSurfaceFloor   AmbientSurfaceType = "floor"
	AmbientSurfaceWall    AmbientSurfaceType = "wall"
	AmbientSurfaceCeiling AmbientSurfaceType = "ceiling"
)
