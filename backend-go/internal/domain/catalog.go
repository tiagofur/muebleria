package domain

import (
	"time"
)

// Contrato: catálogo comercial — unidades de herraje, clientes, tableros,
// cantos, herrajes con mecanizado, option groups, BoardPart/HardwareLine y
// el agregado Catalog.
type HardwareUnit string

const (
	UnitPiece HardwareUnit = "piece"
	UnitSet   HardwareUnit = "set"
	UnitMeter HardwareUnit = "meter"
)

type Customer struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Email   string `json:"email,omitempty"`
	Phone   string `json:"phone,omitempty"`
	Address string `json:"address,omitempty"`
	Notes   string `json:"notes,omitempty"`
	Active  bool   `json:"active"`
	// OwnerUserID is the portfolio owner (F034 / OWN-*). Vendedor-scoped lists use this.
	OwnerUserID string    `json:"owner_user_id,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type MaterialBoard struct {
	ID           string `json:"id"`
	Code         string `json:"code"`
	Name         string `json:"name"`
	Manufacturer string `json:"manufacturer"`
	// CategoryID links the board into the MaterialCategory tree (F142 subgrupos).
	CategoryID   string  `json:"category_id,omitempty"`
	WidthMm      int     `json:"width_mm"`
	LengthMm     int     `json:"length_mm"`
	ThicknessMm  int     `json:"thickness_mm"`
	GrainDefault bool    `json:"grain_default"`
	BoardPrice   float64 `json:"board_price"`
	WastePercent float64 `json:"waste_percent"`
	CostPerM2    float64 `json:"cost_per_m2"`
	// DefaultEdgeBandID links the default edge band by id (never by name).
	DefaultEdgeBandID string `json:"default_edge_band_id,omitempty"`
	// ImageURL is a relative media path (e.g. /api/media/xxx.webp), never base64.
	ImageURL string `json:"image_url,omitempty"`
	// PreviewColor is #RRGGBB for 3D / color-only client preview.
	PreviewColor string `json:"preview_color,omitempty"`
	// PreviewTextureURL optional relative media path for textured 3D (color mode ignores it).
	PreviewTextureURL string `json:"preview_texture_url,omitempty"`
	// PreviewTextureTileWidthMm is the real-world mm of one texture image across
	// board width (U). 0 = use client default tile.
	PreviewTextureTileWidthMm float64 `json:"preview_texture_tile_width_mm,omitempty"`
	// PreviewTextureTileLengthMm is the real-world mm of one texture image along
	// grain / board length (V). 0 = use client default tile.
	PreviewTextureTileLengthMm float64   `json:"preview_texture_tile_length_mm,omitempty"`
	PreviewRoughness           *float64  `json:"preview_roughness,omitempty"`
	PreviewMetalness           *float64  `json:"preview_metalness,omitempty"`
	PreviewClearcoat           *float64  `json:"preview_clearcoat,omitempty"`
	Notes                      string    `json:"notes,omitempty"`
	Active                     bool      `json:"active"`
	CreatedAt                  time.Time `json:"created_at"`
	UpdatedAt                  time.Time `json:"updated_at"`
}

type EdgeBand struct {
	ID   string `json:"id"`
	Code string `json:"code"`
	Name string `json:"name"`
	// ThicknessMm float64 (F116 C3): real edge bands are 0.4/0.5/0.8 mm —
	// decoding into int rejected the TS default 0.5 with an opaque 400.
	ThicknessMm float64 `json:"thickness_mm"`
	CostPerMl   float64 `json:"cost_per_ml"`
	Notes       string  `json:"notes,omitempty"`
	Active      bool    `json:"active"`
	// PreviewColor is #RRGGBB for swatches ("metros por color" summaries —
	// F095/D10), same hex path as MaterialBoard.PreviewColor.
	PreviewColor *string   `json:"preview_color,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type Hardware struct {
	ID          string       `json:"id"`
	Code        string       `json:"code"`
	Name        string       `json:"name"`
	Unit        HardwareUnit `json:"unit"`
	CostPerUnit float64      `json:"cost_per_unit"`
	// PackageSize is commercial pack size in the same unit (e.g. 4 for 4 m bars).
	// Nil = no purchase rounding.
	PackageSize *float64 `json:"package_size,omitempty"`
	// ImageURL relative media path (F040).
	ImageURL string `json:"image_url,omitempty"`
	Notes    string `json:"notes,omitempty"`
	// Preview geometry for the 3D renderer (Fase 2: visible handles). All
	// optional; nil = cost-only hardware (no mesh rendered). Pointer types so
	// metalness/clearcoat 0.0 round-trips (never nullIfZeroFloat).
	PreviewShape        *string  `json:"preview_shape,omitempty"`
	PreviewSizeMm       *float64 `json:"preview_size_mm,omitempty"`
	PreviewProjectionMm *float64 `json:"preview_projection_mm,omitempty"`
	PreviewDiameterMm   *float64 `json:"preview_diameter_mm,omitempty"`
	PreviewColor        *string  `json:"preview_color,omitempty"`
	PreviewRoughness    *float64 `json:"preview_roughness,omitempty"`
	PreviewMetalness    *float64 `json:"preview_metalness,omitempty"`
	PreviewClearcoat    *float64 `json:"preview_clearcoat,omitempty"`
	// PartFinishes maps a structural part role (body/base/grip) to a finish
	// preset id (F080). Nil/empty = every part uses the global preview finish.
	PartFinishes map[string]string `json:"part_finishes,omitempty"`
	// Category is the HardwareCategory from #350 ("hinge", "slide", "handle", "connector", "shelf_pin", "leg", etc.).
	Category string `json:"category,omitempty"`
	// CompatibleRoles optionally lists component roles or placements this hardware can mount on.
	CompatibleRoles []string `json:"compatible_roles,omitempty"`
	// Machining is the CNC drilling footprint (F127): operations per structural
	// part, in the part-local frame of the placement anchor. Nil = cost-only.
	Machining *HardwareMachiningProfile `json:"machining,omitempty"`
	// VisualAsset is the exact versioned 3D asset revision bound to this
	// hardware (#667 M1). Client payloads carry identifiers only;
	// representation, digest and validation state are resolved server-side.
	// Nil = no exact model associated (generic procedural preview).
	VisualAsset *HardwareVisualAssetBinding `json:"visual_asset,omitempty"`
	Active      bool                        `json:"active"`
	CreatedAt   time.Time                   `json:"created_at"`
	UpdatedAt   time.Time                   `json:"updated_at"`
}

// MachiningOperation is one drill entry a hardware part requires (F127).
// JSON casing matches the TS domain shape so the JSONB column round-trips
// through the API without key rewriting.
type MachiningOperation struct {
	ID              string   `json:"id"`
	Kind            string   `json:"kind"`
	DiameterMm      float64  `json:"diameterMm"`
	DepthMm         *float64 `json:"depthMm,omitempty"`
	InnerDiameterMm *float64 `json:"innerDiameterMm,omitempty"`
	XMm             float64  `json:"xMm"`
	YMm             float64  `json:"yMm"`
	Face            string   `json:"face"`
	Label           string   `json:"label,omitempty"`
}

// HardwareMachiningPart groups the operations of one structural part of a
// hardware set (e.g. minifix = cam part + bolt part).
type HardwareMachiningPart struct {
	ID         string               `json:"id"`
	Role       string               `json:"role"`
	Operations []MachiningOperation `json:"operations"`
}

type HardwareMachiningProfile struct {
	Parts []HardwareMachiningPart `json:"parts"`
}

type OptionGroup struct {
	ID        string   `json:"id"`
	Code      string   `json:"code"`
	Name      string   `json:"name"`
	Kind      string   `json:"kind"`
	Required  bool     `json:"required"`
	OptionIDs []string `json:"option_ids"`
}

type EdgeAssignment struct {
	Side    string `json:"side"` // L1, L2, W1, W2
	Enabled bool   `json:"enabled"`
}

type BoardPart struct {
	ID          string `json:"id"`
	Code        string `json:"code,omitempty"`
	Description string `json:"description"`
	Quantity    int    `json:"quantity"`
	LengthMm    int    `json:"length_mm"`
	WidthMm     int    `json:"width_mm"`
	// Grain (veta) is inherited from the resolved material's GrainDefault —
	// never set per piece. Mirrors how edge band is resolved from material.
	Edges         []EdgeAssignment `json:"edges"`
	OptionRole    string           `json:"option_role"`
	LengthFormula string           `json:"length_formula,omitempty"`
	WidthFormula  string           `json:"width_formula,omitempty"`
}

type HardwareLine struct {
	ID string `json:"id"`
	// Quantity is float64 (#442): the zoclo strip profile is consumed in
	// fractional meters (e.g. 0.6 ml for a 600 mm front) — pieces stay
	// integral. Mirrors TS HardwareLine.quantity: number.
	Quantity            float64 `json:"quantity"`
	DescriptionOverride string  `json:"description_override,omitempty"`
	OptionRole          string  `json:"option_role"`
	HardwareID          string  `json:"hardware_id,omitempty"`
}

// ModuleCategory is a node in a user-defined tree (max depth 3).
type Catalog struct {
	Materials    []MaterialBoard  `json:"materials"`
	Edges        []EdgeBand       `json:"edges"`
	Hardware     []Hardware       `json:"hardware"`
	OptionGroups []OptionGroup    `json:"option_groups"`
	Modules      []Module         `json:"modules"`
	Structures   []Structure      `json:"structures,omitempty"`
	Categories   []ModuleCategory `json:"categories,omitempty"`
	Components   []Component      `json:"components,omitempty"`
	Agregados    []Agregado       `json:"agregados,omitempty"`
}

// WorkshopSettings is taller-wide defaults (F031 + F044 COST-02).
