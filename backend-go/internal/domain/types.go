package domain

import (
	"encoding/json"
	"fmt"
	"time"
)

type HardwareUnit string

const (
	UnitPiece HardwareUnit = "piece"
	UnitSet   HardwareUnit = "set"
	UnitMeter HardwareUnit = "meter"
)

type UserRole string

const (
	RoleAdmin             UserRole = "admin"
	RoleUser              UserRole = "user" // approved account without job title
	RoleVendedor          UserRole = "vendedor"
	RoleGerenteVentas     UserRole = "gerente_ventas"
	RoleGerenteProduccion UserRole = "gerente_produccion"
	RoleIngeniero         UserRole = "ingeniero"
	RoleProduccion        UserRole = "produccion" // production worker, scoped by user_sectors
	RoleAlmacen           UserRole = "almacen"    // warehouse worker, scoped by user_sectors
)

// IsValidUserRole reports whether role is an allowed account role (F035 product roles).
func IsValidUserRole(role UserRole) bool {
	switch role {
	case RoleAdmin, RoleUser, RoleVendedor, RoleGerenteVentas, RoleGerenteProduccion, RoleIngeniero, RoleProduccion, RoleAlmacen:
		return true
	default:
		return false
	}
}

// ErrPendingApproval is returned when a user exists but has not been approved yet.
var ErrPendingApproval = fmt.Errorf("account pending approval")

// LicensePlan is the per-user licensing tier managed by the workshop admin.
type LicensePlan string

const (
	LicensePlanNone  LicensePlan = "none"
	LicensePlanTrial LicensePlan = "trial"
	LicensePlanPro   LicensePlan = "pro"
)

// IsValidLicensePlan reports whether plan is an allowed license tier.
func IsValidLicensePlan(plan LicensePlan) bool {
	switch plan {
	case LicensePlanNone, LicensePlanTrial, LicensePlanPro:
		return true
	default:
		return false
	}
}

// LicenseStatus is the derived, point-in-time licensing state of a user.
type LicenseStatus string

const (
	LicenseStatusNone    LicenseStatus = "none"
	LicenseStatusActive  LicenseStatus = "active"
	LicenseStatusExpired LicenseStatus = "expired"
)

// LicenseStatusAt derives the licensing state of a user at a point in time.
// A license is active when the plan is not "none" and the expiry (when set)
// is in the future. Pure function: callers pass `now` explicitly.
func LicenseStatusAt(plan LicensePlan, expiresAt *time.Time, now time.Time) LicenseStatus {
	if plan == LicensePlanNone || plan == "" {
		return LicenseStatusNone
	}
	if expiresAt != nil && !now.Before(*expiresAt) {
		return LicenseStatusExpired
	}
	return LicenseStatusActive
}

type ProjectStatus string

const (
	StatusDraft    ProjectStatus = "draft"
	StatusQuoted   ProjectStatus = "quoted"
	StatusAccepted ProjectStatus = "accepted"
	StatusProduced ProjectStatus = "produced"
)

type User struct {
	ID           string       `json:"id"`
	Email        string       `json:"email"`
	PasswordHash string       `json:"-"`
	Name         string       `json:"name"`
	Role         UserRole     `json:"role"`
	Active       bool         `json:"active"`
	LicensePlan  LicensePlan  `json:"license_plan"`
	LicenseExpiresAt *time.Time `json:"license_expires_at,omitempty"`
	CreatedAt    time.Time    `json:"created_at"`
	UpdatedAt    time.Time    `json:"updated_at"`
}

// UserSector maps an operator to one or more production sectors.
type UserSector struct {
	UserID    string    `json:"user_id"`
	Sector    string    `json:"sector"`
	SubSector string    `json:"sub_sector,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

// ProjectPicking is one project × material picking state (Fase 3 — Compras/Almacén).
// Status is "pendiente" or "despachado"; MarkedAt/MarkedBy are stamped by the
// server on despacho (who/when traceability). MarkedByName is the joined user
// display name for the list response.
type ProjectPicking struct {
	ProjectID    string     `json:"project_id"`
	Material     string     `json:"material"`
	Status       string     `json:"status"`
	MarkedAt     *time.Time `json:"marked_at,omitempty"`
	MarkedBy     *string    `json:"marked_by,omitempty"`
	MarkedByName *string    `json:"marked_by_name,omitempty"`
}

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
	ID           string  `json:"id"`
	Code         string  `json:"code"`
	Name         string  `json:"name"`
	Manufacturer string  `json:"manufacturer"`
	// CategoryID links the board into the MaterialCategory tree (F142 subgrupos).
	CategoryID    string  `json:"category_id,omitempty"`
	WidthMm       int     `json:"width_mm"`
	LengthMm      int     `json:"length_mm"`
	ThicknessMm   int     `json:"thickness_mm"`
	GrainDefault  bool    `json:"grain_default"`
	BoardPrice    float64 `json:"board_price"`
	WastePercent  float64 `json:"waste_percent"`
	CostPerM2     float64 `json:"cost_per_m2"`
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
	ID          string  `json:"id"`
	Code        string  `json:"code"`
	Name        string  `json:"name"`
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
	// Machining is the CNC drilling footprint (F127): operations per structural
	// part, in the part-local frame of the placement anchor. Nil = cost-only.
	Machining *HardwareMachiningProfile `json:"machining,omitempty"`
	Active    bool                      `json:"active"`
	CreatedAt time.Time                 `json:"created_at"`
	UpdatedAt time.Time                 `json:"updated_at"`
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
	ID                  string `json:"id"`
	Quantity            int    `json:"quantity"`
	DescriptionOverride string `json:"description_override,omitempty"`
	OptionRole          string `json:"option_role"`
	HardwareID          string `json:"hardware_id,omitempty"`
}

// ModuleCategory is a node in a user-defined tree (max depth 3).
type ModuleCategory struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	ParentID  string    `json:"parentId,omitempty"`
	SortOrder int       `json:"sortOrder"`
	CreatedAt time.Time `json:"created_at,omitempty"`
	UpdatedAt time.Time `json:"updated_at,omitempty"`
}

type Module struct {
	ID            string  `json:"id"`
	Code          string  `json:"code"`
	Name          string  `json:"name"`
	BaseLaborCost float64 `json:"base_labor_cost"`
	WidthMm       int     `json:"width_mm,omitempty"`
	HeightMm      int     `json:"height_mm,omitempty"`
	DepthMm       int     `json:"depth_mm,omitempty"`
	CategoryID    string  `json:"categoryId,omitempty"`
	// StructureID references an engineering body for composed modules (F054 / #102).
	// Empty for legacy/flat modules.
	StructureID string `json:"structure_id,omitempty"`
	// FurnitureType is the fundamental furniture type for project measure
	// defaults (#109 / H14): "inferior" | "superior" | "alto". Empty = inferior
	// (legacy default).
	FurnitureType string `json:"furniture_type,omitempty"`
	// BaseMode: none | plinth_board | plinth_strip | legs (zoclo / patas).
	// Empty = none.
	BaseMode string `json:"base_mode,omitempty"`
	// BaseClearanceMm is default plinth/legs height B (mm). Nil = domain default.
	BaseClearanceMm *int `json:"base_clearance_mm,omitempty"`
	// Presets are commercial measure options for sales (H09 / #104).
	Presets []DimensionPreset `json:"presets,omitempty"`
	// Components are module-level component instances (doors, shelves, …) for
	// composed modules, beyond those inherited from StructureID.
	Components []ComponentInstance `json:"components,omitempty"`
	// Agregados are module-level sub-assemblies (doors, drawers, …) attached to the module.
	Agregados []ModuleAgregadoInstance `json:"agregados,omitempty"`
	// ImageURL relative media path for sales showcase (F040).
	ImageURL      string         `json:"image_url,omitempty"`
	BoardParts    []BoardPart    `json:"board_parts"`
	HardwareLines []HardwareLine `json:"hardware_lines"`
	Notes         string         `json:"notes,omitempty"`
	CreatedAt     time.Time      `json:"created_at"`
	UpdatedAt     time.Time      `json:"updated_at"`
}

type DimensionPreset struct {
	ID       string `json:"id"`
	Name     string `json:"name,omitempty"`
	WidthMm  int    `json:"width_mm"`
	HeightMm int    `json:"height_mm"`
	DepthMm  int    `json:"depth_mm"`
}

// Structure is a reusable engineering body (cuerpo) — F049 / #99.
// Not composed into modules until H07; dual path keeps fixed modules working.
//
// #108 (Slice 2): Structures are versioned. Each edit bumps Revision and
// pushes an immutable snapshot of the previous BOM-relevant fields onto
// History. The zero value (Revision == 0) is treated as DEFAULT (1) by the
// engine helpers so legacy rows keep working.
type AgregadoPosition struct {
	XFormula string `json:"x_formula,omitempty"`
	YFormula string `json:"y_formula,omitempty"`
	ZFormula string `json:"z_formula,omitempty"`
}

type AgregadoDimensions struct {
	WidthFormula  string `json:"width_formula,omitempty"`
	HeightFormula string `json:"height_formula,omitempty"`
	DepthFormula  string `json:"depth_formula,omitempty"`
}

type ModuleAgregadoInstance struct {
	ID              string              `json:"id,omitempty"`
	AgregadoID      string              `json:"agregado_id"`
	Name            string              `json:"name,omitempty"`
	Quantity        int                 `json:"quantity"`
	LayoutDirection string              `json:"layout_direction,omitempty"`
	GapMm           float64             `json:"gap_mm,omitempty"`
	Position        *AgregadoPosition   `json:"position,omitempty"`
	Dimensions      *AgregadoDimensions `json:"dimensions,omitempty"`
	Mirrored        bool                `json:"mirrored,omitempty"`
	OptionOverrides map[string]string   `json:"option_overrides,omitempty"`
}

// JointDrillingRules mirrors the TS domain shape (F129) — camelCase keys so
// the JSONB column round-trips through the API without rewriting.
type JointDrillingRules struct {
	GridMm      *int             `json:"gridMm,omitempty"`
	SideToFloor *PanelJointRule  `json:"sideToFloor,omitempty"`
	SideToTop   *PanelJointRule  `json:"sideToTop,omitempty"`
	BackPanel   *BackPanelRule   `json:"backPanel,omitempty"`
	DoorHinge   *DoorHingeRule   `json:"doorHinge,omitempty"`
}

type PanelJointRule struct {
	MinifixCode string   `json:"minifixCode,omitempty"`
	DowelCode   string   `json:"dowelCode,omitempty"`
	EndMarginMm *float64 `json:"endMarginMm,omitempty"`
	MaxSpacingMm *float64 `json:"maxSpacingMm,omitempty"`
	WithDowels  *bool    `json:"withDowels,omitempty"`
}

type BackPanelRule struct {
	ScrewCode   string   `json:"screwCode,omitempty"`
	InsetMm     *float64 `json:"insetMm,omitempty"`
	MaxSpacingMm *float64 `json:"maxSpacingMm,omitempty"`
}

type DoorHingeRule struct {
	HingeCode    string   `json:"hingeCode,omitempty"`
	PlateCode    string   `json:"plateCode,omitempty"`
	CupInsetMm   *float64 `json:"cupInsetMm,omitempty"`
	SystemLineMm *float64 `json:"systemLineMm,omitempty"`
	EndMarginMm  *float64 `json:"endMarginMm,omitempty"`
}

type Structure struct {
	ID         string                   `json:"id"`
	Code       string                   `json:"code"`
	Name       string                   `json:"name"`
	WidthMm    int                      `json:"width_mm,omitempty"`
	HeightMm   int                      `json:"height_mm,omitempty"`
	DepthMm    int                      `json:"depth_mm,omitempty"`
	Components []ComponentInstance      `json:"components,omitempty"`
	Agregados  []ModuleAgregadoInstance `json:"agregados,omitempty"`
	Presets    []DimensionPreset        `json:"presets,omitempty"`
	Notes      string                   `json:"notes,omitempty"`
	Active     bool                     `json:"active"`
	// JointDrillingRules overrides the workshop defaults (F129). Nil = defaults.
	// Sub-struct json tags are camelCase to mirror the TS shape stored in JSONB.
	JointDrillingRules *JointDrillingRules `json:"joint_drilling_rules,omitempty"`
	// Revision is the monotonic version of the structure's BOM-relevant fields.
	// Starts at 1 (DEFAULT_STRUCTURE_REVISION); legacy rows (0 / missing) are
	// normalised to 1 by the engine helpers.
	Revision int `json:"revision,omitempty"`
	// History holds immutable snapshots of superseded revisions (newest-first),
	// mirroring the TS `history` field. Loaded lazily by storage when needed.
	History   []StructureRevision `json:"history,omitempty"`
	CreatedAt time.Time           `json:"created_at"`
	UpdatedAt time.Time           `json:"updated_at"`
}

// StructureRevision is an immutable snapshot of a Structure's BOM-relevant
// fields at a given revision (#108). It mirrors the TS StructureRevision type:
// only the fields that affect ResolveBom are captured (notes/active/history are
// intentionally dropped).
type StructureRevision struct {
	Revision   int                      `json:"revision"`
	Code       string                   `json:"code"`
	Name       string                   `json:"name"`
	WidthMm    int                      `json:"width_mm,omitempty"`
	HeightMm   int                      `json:"height_mm,omitempty"`
	DepthMm    int                      `json:"depth_mm,omitempty"`
	Components []ComponentInstance      `json:"components,omitempty"`
	Agregados  []ModuleAgregadoInstance `json:"agregados,omitempty"`
	Presets    []DimensionPreset        `json:"presets,omitempty"`
}

// ComponentInstance is a reference to a reusable component placed in a structure or module.
type ComponentInstance struct {
	ComponentID       string              `json:"componentId"`
	Quantity          int                 `json:"quantity"`
	PlacementOverride *ComponentPlacement `json:"placementOverride,omitempty"`
	// Overrides allow per-instance edge/formula overrides (mirrors TS overrides).
	Overrides *ComponentInstanceOverrides `json:"overrides,omitempty"`
}

// Agregado is a reusable sub-assembly catalog entity composed of ComponentInstances.
// Examples: a drawer assembly, a door with hinges and handle, a divider panel group.
type Agregado struct {
	ID            string              `json:"id"`
	Code          string              `json:"code"`
	Name          string              `json:"name"`
	Description   string              `json:"description,omitempty"`
	Notes         string              `json:"notes,omitempty"`
	WidthMm       int                 `json:"width_mm,omitempty"`
	HeightMm      int                 `json:"height_mm,omitempty"`
	DepthMm       int                 `json:"depth_mm,omitempty"`
	Components    []ComponentInstance `json:"components,omitempty"`
	HardwareLines []HardwareLine      `json:"hardware_lines,omitempty"`
	Active        bool                `json:"active"`
	CreatedAt     time.Time           `json:"created_at"`
	UpdatedAt     time.Time           `json:"updated_at"`
}

// HardwarePlacement attaches a visible hardware instance to a component face for
// the 3D preview (Fase 2: visible handles). Distinct from Perforation
// (CNC/machining — different lifecycle/consumers). Rides the component-instance
// overrides JSONB; no dedicated column or migration.
type HardwarePlacement struct {
	HardwareID       string               `json:"hardwareId"`
	AnchorFace       string               `json:"anchorFace"` // front|back|left|right|top|bottom
	RelativePosition HardwareRelPosition  `json:"relativePosition"`
	RotationDeg      *HardwareRotationDeg `json:"rotationDeg,omitempty"`
	Scale            *float64             `json:"scale,omitempty"`
}

// HardwareRelPosition is the 2D position on the face plane (mm or formula).
type HardwareRelPosition struct {
	XMm      float64 `json:"xMm"`
	YMm      float64 `json:"yMm"`
	XFormula string  `json:"xFormula,omitempty"`
	YFormula string  `json:"yFormula,omitempty"`
	XPercent float64 `json:"xPercent,omitempty"`
	YPercent float64 `json:"yPercent,omitempty"`
}

// HardwareRotationDeg is an optional per-axis rotation in degrees (board frame).
type HardwareRotationDeg struct {
	X float64 `json:"x,omitempty"`
	Y float64 `json:"y,omitempty"`
	Z float64 `json:"z,omitempty"`
}

// ComponentInstanceOverrides mirrors ModuleComponentInstance.overrides from TS.
type ComponentInstanceOverrides struct {
	Edges              []EdgeAssignment    `json:"edges,omitempty"`
	LengthFormula      string              `json:"lengthFormula,omitempty"`
	WidthFormula       string              `json:"widthFormula,omitempty"`
	XFormula           string              `json:"xFormula,omitempty"`
	YFormula           string              `json:"yFormula,omitempty"`
	ZFormula           string              `json:"zFormula,omitempty"`
	RotateX            *int                `json:"rotateX,omitempty"`
	RotateY            *int                `json:"rotateY,omitempty"`
	RotateZ            *int                `json:"rotateZ,omitempty"`
	HardwarePlacements []HardwarePlacement `json:"hardwarePlacements,omitempty"`
}

// ComponentPlacement represents where a component goes in the cabinet structure.
type ComponentPlacement string

const (
	PlacementBase             ComponentPlacement = "base"
	PlacementSuperior         ComponentPlacement = "superior"
	PlacementLateralIzquierdo ComponentPlacement = "lateral_izquierdo"
	PlacementLateralDerecho   ComponentPlacement = "lateral_derecho"
	PlacementFrontal          ComponentPlacement = "frontal"
	PlacementTrasera          ComponentPlacement = "trasera"
	PlacementInterno          ComponentPlacement = "interno"
	PlacementPuerta           ComponentPlacement = "puerta"
	PlacementFrenteCajon      ComponentPlacement = "frente_cajon"
	PlacementCustom           ComponentPlacement = "custom"
)

// Component is a reusable engineering component (carcasa piece).
// Mirrors the frontend Component type from @muebles/domain.
type Component struct {
	ID            string             `json:"id"`
	Code          string             `json:"code"`
	Name          string             `json:"name"`
	Placement     ComponentPlacement `json:"placement"`
	GeometryKind  string             `json:"geometry_kind"`
	LengthMm      int                `json:"length_mm"`
	WidthMm       int                `json:"width_mm"`
	ThicknessMm   int                `json:"thickness_mm"`
	DefaultEdges  []EdgeAssignment   `json:"default_edges"`
	OptionRoles   []string           `json:"option_roles,omitempty"`
	LengthFormula string             `json:"length_formula,omitempty"`
	WidthFormula  string             `json:"width_formula,omitempty"`
	XFormula      string             `json:"x_formula,omitempty"`
	YFormula      string             `json:"y_formula,omitempty"`
	ZFormula      string             `json:"z_formula,omitempty"`
	RotateX       int                `json:"rotate_x,omitempty"`
	RotateY       int                `json:"rotate_y,omitempty"`
	RotateZ       int                `json:"rotate_z,omitempty"`
	Notes         string             `json:"notes,omitempty"`
	Active        bool               `json:"active"`
	CreatedAt     time.Time          `json:"created_at"`
	UpdatedAt     time.Time          `json:"updated_at"`
}

// ItemCustomDims is the free per-item dimensions override (F144 / #310), mm.
// Wins over the commercial preset; only valid for composed (parametric)
// modules. Mirrors TS ItemCustomDims.
type ItemCustomDims struct {
	WidthMm  int `json:"widthMm"`
	HeightMm int `json:"heightMm"`
	DepthMm  int `json:"depthMm"`
}

type ProjectItem struct {
	ID            string            `json:"id"`
	ModuleID      string            `json:"module_id"`
	Quantity      int               `json:"quantity"`
	OptionChoices map[string]string `json:"option_choices"` // group_code -> choice_id
	// MeasurePresetID selects Module.Presets entry for quotation (H09 / #104).
	MeasurePresetID string `json:"measure_preset_id,omitempty"`
	// CustomDims is the free per-item W/H/D override (F144 / #310). nil = preset.
	// Persisted as project_items.custom_dims JSONB; without it a web save would
	// silently drop the "a medida" chosen in Proyectar.
	CustomDims *ItemCustomDims `json:"custom_dims,omitempty"`
	// BaseMode is the line's base treatment override (F087):
	// none|plinth_board|plinth_strip|legs. Empty = module default.
	BaseMode string `json:"base_mode,omitempty"`
	// StructureRevisionPin freezes the structure revision used by this line item
	// (#108). nil = live (current revision). Pinned at close time so the BOM of
	// a closed quote is not silently mutated by later structure edits.
	StructureRevisionPin *int `json:"structure_revision_pin,omitempty"`
	// FloorStatus is shop-floor progress (PROD-3.1): pending|cut|edged|assembled|installed.
	// Empty/omitted = pending. Does not affect BOM or pricing.
	FloorStatus string `json:"floor_status,omitempty"`
}

type Project struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	CustomerID string `json:"customer_id"`
	CreatedBy  string `json:"created_by,omitempty"`
	// OwnerUserID is the portfolio owner (F034). May differ from CreatedBy after reassignment.
	OwnerUserID string `json:"owner_user_id,omitempty"`
	// AssignedEngineerID is the technical / production engineer in charge (CRM Phase 2).
	AssignedEngineerID string `json:"assigned_engineer_id,omitempty"`
	// TechnicalStatus is the technical lifecycle status (CRM Phase 2).
	TechnicalStatus string `json:"technical_status,omitempty"`
	// SurveyCompletedAt is the timestamp when on-site measurements were taken.
	SurveyCompletedAt *time.Time `json:"survey_completed_at,omitempty"`
	// InstallationScheduledDate is the planned date for site installation (YYYY-MM-DD).
	InstallationScheduledDate *string `json:"installation_scheduled_date,omitempty"`
	Currency                  string  `json:"currency"`

	MarginFactor     float64           `json:"margin_factor"`
	LaborFixedCost   float64           `json:"labor_fixed_cost"`
	Status           ProjectStatus     `json:"status"`
	CommercialStatus *CommercialStatus `json:"commercial_status,omitempty"`
	Items            []ProjectItem     `json:"items"`
	// ProjectLevelChoices are defaults for all line items (F029 / #35).
	// Effective: item.OptionChoices[role] if set, else ProjectLevelChoices[role].
	ProjectLevelChoices map[string]string `json:"project_level_choices,omitempty"`
	// MeasureDefaults are project-level measure defaults keyed by furniture type
	// (#109 / H14). At add-item time the closest module preset for the module's
	// furnitureType is pre-selected. Per-line MeasurePresetID always wins.
	// Shape: { "inferior"|"superior"|"alto": { "depth": 560, "height": 720 } }.
	// nil/empty = no project defaults.
	MeasureDefaults json.RawMessage `json:"measure_defaults,omitempty"`
	// KitchenLayout is optional walls+placements plan (#133). JSON object or null.
	KitchenLayout json.RawMessage `json:"kitchen_layout,omitempty"`
	// PlanEditSession soft-locks Proyectar for multi-user collaboration.
	// Shape: { "user_id", "user_name", "expires_at" }.
	PlanEditSession       json.RawMessage `json:"plan_edit_session,omitempty"`
	InstallationChecklist json.RawMessage `json:"installation_checklist,omitempty"`
	NestingImport         json.RawMessage `json:"nesting_import,omitempty"`
	// CutPlan is the 2D Guillotine Cut Plan for sheet cutting & warehouse requisition (F115).
	CutPlan               json.RawMessage `json:"cut_plan,omitempty"`
	// Production is OP revision / export tracking (PROD-3.2). Opaque JSON blob.
	// Shape: { revision, revision_at, fingerprint, last_export_* }.
	Production json.RawMessage `json:"production,omitempty"`
	// EngineeringLog is the engineering lifecycle log (roadmap-screens 2a).
	// Opaque JSON blob: { started_by, started_at, generated_by, generated_at,
	// sent_to_production_by, sent_to_production_at, revision }.
	EngineeringLog json.RawMessage `json:"engineering_log,omitempty"`
	// MaterialsRelease is Almacén's "materials complete" stamp (process stage
	// gating). Opaque JSON blob: { released_by, released_at }. NULL = the
	// project is still in the warehouse queue.
	MaterialsRelease  json.RawMessage     `json:"materials_release,omitempty"`
	DesignRevisions   []DesignRevision    `json:"design_revisions,omitempty"`
	Approvals         []Approval          `json:"approvals,omitempty"`
	ProductionRelease *ProductionRelease  `json:"production_release,omitempty"`
	ChangeOrders      []ChangeOrder       `json:"change_orders,omitempty"`
	PartInstances     []PartInstance      `json:"part_instances,omitempty"`
	ModuleUnits       []ModuleUnitExecution `json:"module_units,omitempty"`
	// Installation is the installation job (visits, field issues, punch,
	// closeout — OC-070..OC-074). Server-authoritative: only mutated through
	// the dedicated installation endpoints, never through the project PUT.
	Installation     *InstallationJob   `json:"installation,omitempty"`
	// MaterialPlanning is the MRP subprocess of the obra: requirements from
	// the released BOM, reservations and the evidence-backed release
	// (OC-050..OC-054, #302). Server-authoritative via the materials endpoints.
	MaterialPlanning *MaterialPlanning `json:"material_planning,omitempty"`
	// Quality is the quality subprocess of the obra: issues, rework actions
	// and per-unit QC records (OC-060..OC-062, #302).
	Quality          *QualityJob       `json:"quality,omitempty"`
	// Costing is the job costing subprocess of the obra: baseline frozen from
	// quote snapshot + release, time entries and other actual costs
	// (OC-080..OC-084, #304). Material actuals derive from stock movements
	// assigned to the obra. Server-authoritative via the costing endpoints.
	Costing          *JobCosting       `json:"costing,omitempty"`
	// SiteSurvey is the structured site survey of the obra: spaces with field
	// measurements, openings/obstacles, utilities and explicit capture/verify
	// authorship (OC-040/OC-041, #305). Server-authoritative via the survey
	// endpoints; hardens the survey_verified release gate when present.
	SiteSurvey       *SiteSurvey       `json:"site_survey,omitempty"`
	FloorEvents       []FloorStatusEvent  `json:"floor_events,omitempty"`
	Events            []ProjectEvent      `json:"events,omitempty"`
	Notes             string              `json:"notes,omitempty"`
	PriceSnapshot     *QuotePriceSnapshot `json:"price_snapshot,omitempty"`
	CreatedAt         time.Time           `json:"created_at"`
	UpdatedAt         time.Time           `json:"updated_at"`
}

// ProjectTemplate is a reusable project recipe (#110 / H15). Slimmed Project:
// no customer, status, priceSnapshot, owner, or runtime-only fields. "Crear
// desde plantilla" clones a fresh draft Project from one of these (the clone
// logic lives in the TS domain; Go only persists CRUD).
type ProjectTemplate struct {
	ID                  string            `json:"id"`
	Name                string            `json:"name"`
	Currency            string            `json:"currency"`
	MarginFactor        float64           `json:"margin_factor"`
	LaborFixedCost      float64           `json:"labor_fixed_cost"`
	Items               []ProjectItem     `json:"items"`
	ProjectLevelChoices map[string]string `json:"project_level_choices,omitempty"`
	// MeasureDefaults / KitchenLayout / InstallationChecklist are JSON blobs
	// mirroring the Project fields of the same names.
	MeasureDefaults       json.RawMessage `json:"measure_defaults,omitempty"`
	KitchenLayout         json.RawMessage `json:"kitchen_layout,omitempty"`
	InstallationChecklist json.RawMessage `json:"installation_checklist,omitempty"`
	Notes                 string          `json:"notes,omitempty"`
	CreatedAt             time.Time       `json:"created_at"`
	UpdatedAt             time.Time       `json:"updated_at"`
}

type QuoteBreakdown struct {
	MaterialsCost  float64 `json:"materials_cost"`
	EdgeTotal      float64 `json:"edge_total"`
	HardwareTotal  float64 `json:"hardware_total"`
	DirectCost     float64 `json:"direct_cost"`
	LaborModular   float64 `json:"labor_modular"`
	LaborFixedCost float64 `json:"labor_fixed_cost"`
	MarginFactor   float64 `json:"margin_factor"`
	SalePrice      float64 `json:"sale_price"`
}

type QuotePriceSnapshot struct {
	CapturedAt          time.Time          `json:"captured_at"`
	Breakdown           QuoteBreakdown     `json:"breakdown"`
	MaterialCostPerM2   map[string]float64 `json:"material_cost_per_m2,omitempty"`
	EdgeCostPerMl       map[string]float64 `json:"edge_cost_per_ml,omitempty"`
	HardwareCostPerUnit map[string]float64 `json:"hardware_cost_per_unit,omitempty"`
}

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
type WorkshopSettings struct {
	DefaultMarginFactor   float64 `json:"default_margin_factor"`
	DefaultLaborFixedCost float64 `json:"default_labor_fixed_cost"`
	DefaultCurrency       string  `json:"default_currency"`
	VendedorCanViewCosts  bool    `json:"vendedor_can_view_costs"`
	// DefaultCutStrategy seeds the Optimización tab for projects without a
	// generated plan yet (F133): '' | 'saw-guillotine' | 'cnc-nesting'.
	// Empty/invalid falls back to saw-guillotine; the per-project plan wins.
	DefaultCutStrategy string `json:"default_cut_strategy,omitempty"`
	// NavMode is the navigation surface by workshop size (OC-092, #305):
	// 'simplified' reduces the sidebar for small shops; 'departmental' keeps
	// the full surface. Presentation only — RBAC keeps filtering on top.
	NavMode string `json:"nav_mode,omitempty"`
}

// DefaultWorkshopSettings matches TS DEFAULT_WORKSHOP_SETTINGS.
func DefaultWorkshopSettings() WorkshopSettings {
	return WorkshopSettings{
		DefaultMarginFactor:   1.35,
		DefaultLaborFixedCost: 0,
		DefaultCurrency:       "MXN",
		VendedorCanViewCosts:  false,
		DefaultCutStrategy:    "saw-guillotine",
		NavMode:               "departmental",
	}
}

// Grain is 0|1 for Optimizer export (inherited from material.GrainDefault).
type Grain int

const (
	GrainNone Grain = 0
	GrainYes  Grain = 1
)

// ResolvedBoardPart is a board part with concrete material/edge/grain (TS parity).
type ResolvedBoardPart struct {
	ID          string           `json:"id"`
	Code        string           `json:"code,omitempty"`
	Description string           `json:"description"`
	Quantity    int              `json:"quantity"`
	LengthMm    int              `json:"length_mm"`
	WidthMm     int              `json:"width_mm"`
	Grain       Grain            `json:"grain"`
	Edges       []EdgeAssignment `json:"edges"`
	OptionRole  string           `json:"option_role"`
	MaterialID  string           `json:"material_id"`
	EdgeBandID  string           `json:"edge_band_id,omitempty"`
}

// ResolvedHardwareLine is a hardware line with concrete hardware id.
type ResolvedHardwareLine struct {
	ID                  string `json:"id"`
	Quantity            int    `json:"quantity"`
	DescriptionOverride string `json:"description_override,omitempty"`
	OptionRole          string `json:"option_role"`
	HardwareID          string `json:"hardware_id"`
}

// ResolvedBom is the fully resolved module BOM.
type ResolvedBom struct {
	BoardParts    []ResolvedBoardPart    `json:"board_parts"`
	HardwareLines []ResolvedHardwareLine `json:"hardware_lines"`
}

// ProductionCutRow is a flat Optimizer cut-list row (columns A–J).
// Description includes part/module codes (F048) for workshop identification.
type ProductionCutRow struct {
	Quantity     int    `json:"quantity"`
	LengthMm     int    `json:"length_mm"`
	WidthMm      int    `json:"width_mm"`
	Description  string `json:"description"`
	MaterialName string `json:"material_name"`
	Grain        Grain  `json:"grain"`
	L1           int    `json:"L1"` // 0|1
	L2           int    `json:"L2"`
	W1           int    `json:"W1"`
	W2           int    `json:"W2"`
	PartName     string `json:"part_name,omitempty"`
	PartCode     string `json:"part_code,omitempty"`
	ModuleCode   string `json:"module_code,omitempty"`
	LabelRef     string `json:"label_ref,omitempty"`
}

// HardwarePurchaseRow is an aggregated hardware purchase line (EXP-08).
type HardwarePurchaseRow struct {
	HardwareID  string       `json:"hardware_id"`
	Code        string       `json:"code"`
	Description string       `json:"description"`
	Unit        HardwareUnit `json:"unit"`
	Quantity    int          `json:"quantity"`
	CostPerUnit float64      `json:"cost_per_unit"`
	LineCost    float64      `json:"line_cost"`
}

// ProjectPhotoStage represents the lifecycle stage of a project photo.
type ProjectPhotoStage string

const (
	ProjectPhotoStageSurvey          ProjectPhotoStage = "survey"
	ProjectPhotoStageInWorkshop      ProjectPhotoStage = "in_workshop"
	ProjectPhotoStageInstalled       ProjectPhotoStage = "installed"
	ProjectPhotoStageDeliveryReceipt ProjectPhotoStage = "delivery_receipt"
)

// ProjectPhoto is a photo attached to a project across its lifecycle.
type ProjectPhoto struct {
	ID           string            `json:"id"`
	ProjectID    string            `json:"project_id"`
	Stage        ProjectPhotoStage `json:"stage"`
	URL          string            `json:"url"`
	ThumbnailURL string            `json:"thumbnail_url,omitempty"`
	Caption      string            `json:"caption,omitempty"`
	IsShowcase   bool              `json:"is_showcase"`
	CreatedBy    string            `json:"created_by,omitempty"`
	CreatedAt    time.Time         `json:"created_at"`
	UpdatedAt    time.Time         `json:"updated_at"`
}

// ShowcasePhotoItem is a photo enriched with project and customer names for commercial portfolio presentation.
type ShowcasePhotoItem struct {
	ID           string            `json:"id"`
	ProjectID    string            `json:"project_id"`
	ProjectName  string            `json:"project_name"`
	CustomerName string            `json:"customer_name,omitempty"`
	Stage        ProjectPhotoStage `json:"stage"`
	URL          string            `json:"url"`
	ThumbnailURL string            `json:"thumbnail_url,omitempty"`
	Caption      string            `json:"caption,omitempty"`
	IsShowcase   bool              `json:"is_showcase"`
	CreatedAt    time.Time         `json:"created_at"`
}

// TechnicalStatus represents the engineering and production stage of a project.
type TechnicalStatus string

const (
	TechStatusPendingAssignment     TechnicalStatus = "pending_assignment"
	TechStatusInReview              TechnicalStatus = "in_review"
	TechStatusChangesRequested      TechnicalStatus = "changes_requested"
	TechStatusApprovedForProduction TechnicalStatus = "approved_for_production"
	TechStatusInWorkshop            TechnicalStatus = "in_workshop"
	TechStatusReadyToInstall        TechnicalStatus = "ready_to_install"
	TechStatusInstalled             TechnicalStatus = "installed"
	TechStatusCompleted             TechnicalStatus = "completed"
)

// ProjectInternalMessageType classifies internal communications between sales, engineering and workshop.
type ProjectInternalMessageType string

const (
	InternalMsgComment         ProjectInternalMessageType = "comment"
	InternalMsgTechnicalQuery  ProjectInternalMessageType = "technical_query"
	InternalMsgQueryResponse   ProjectInternalMessageType = "query_response"
	InternalMsgDesignChange    ProjectInternalMessageType = "design_change"
	InternalMsgProductionAlert ProjectInternalMessageType = "production_alert"
	InternalMsgGateApproval    ProjectInternalMessageType = "gate_approval"
)

// ProjectInternalMessage is an internal message or query in a project collaboration thread.
type ProjectInternalMessage struct {
	ID          string                     `json:"id"`
	ProjectID   string                     `json:"project_id"`
	SenderID    string                     `json:"sender_id,omitempty"`
	SenderName  string                     `json:"sender_name"`
	MessageType ProjectInternalMessageType `json:"message_type"`
	Content     string                     `json:"content"`
	IsResolved  bool                       `json:"is_resolved"`
	Attachments json.RawMessage            `json:"attachments,omitempty"`
	CreatedAt   time.Time                  `json:"created_at"`
}

// WarrantyCategory classifies the nature of a warranty ticket.
type WarrantyCategory string

const (
	WarrantyCategoryHardwareAdjustment WarrantyCategory = "hardware_adjustment"
	WarrantyCategoryDamagedPart        WarrantyCategory = "damaged_part"
	WarrantyCategoryFinishingDefect    WarrantyCategory = "finishing_defect"
	WarrantyCategoryInstallationIssue  WarrantyCategory = "installation_issue"
	WarrantyCategoryOther              WarrantyCategory = "other"
)

// WarrantyPriority indicates the urgency of a warranty ticket.
type WarrantyPriority string

const (
	WarrantyPriorityLow    WarrantyPriority = "low"
	WarrantyPriorityNormal WarrantyPriority = "normal"
	WarrantyPriorityUrgent WarrantyPriority = "urgent"
)

// WarrantyStatus represents the lifecycle of a warranty ticket.
type WarrantyStatus string

const (
	WarrantyStatusOpen           WarrantyStatus = "open"
	WarrantyStatusVisitScheduled WarrantyStatus = "visit_scheduled"
	WarrantyStatusInProgress     WarrantyStatus = "in_progress"
	WarrantyStatusResolved       WarrantyStatus = "resolved"
	WarrantyStatusCancelled      WarrantyStatus = "cancelled"
)

// WarrantyPhotoKind classifies the reason for a warranty photo.
type WarrantyPhotoKind string

const (
	WarrantyPhotoIssueReport     WarrantyPhotoKind = "issue_report"
	WarrantyPhotoResolutionProof WarrantyPhotoKind = "resolution_proof"
)

// WarrantyRefabricationPiece is a single piece from a project cut list marked for re-cutting.
type WarrantyRefabricationPiece struct {
	PieceDescription string `json:"piece_description"`
	MaterialName     string `json:"material_name"`
	LengthMm         int    `json:"length_mm"`
	WidthMm          int    `json:"width_mm"`
	Quantity         int    `json:"quantity"`
	Grain            Grain  `json:"grain"`
	L1               int    `json:"L1"`
	L2               int    `json:"L2"`
	W1               int    `json:"W1"`
	W2               int    `json:"W2"`
	Notes            string `json:"notes,omitempty"`
}

// WarrantyTicketPhoto is a photo attached to a warranty ticket.
type WarrantyTicketPhoto struct {
	ID           string            `json:"id"`
	TicketID     string            `json:"ticket_id"`
	Kind         WarrantyPhotoKind `json:"kind"`
	URL          string            `json:"url"`
	ThumbnailURL string            `json:"thumbnail_url"`
	Caption      string            `json:"caption,omitempty"`
	CreatedAt    time.Time         `json:"created_at"`
}

// WarrantyTicket is a post-sale warranty or repair ticket.
type WarrantyTicket struct {
	ID                   string                       `json:"id"`
	TicketNumber         string                       `json:"ticket_number"`
	ProjectID            string                       `json:"project_id"`
	CustomerID           *string                      `json:"customer_id,omitempty"`
	Title                string                       `json:"title"`
	Description          string                       `json:"description"`
	Category             WarrantyCategory             `json:"category"`
	Priority             WarrantyPriority             `json:"priority"`
	Status               WarrantyStatus               `json:"status"`
	AssignedTechnicianID *string                      `json:"assigned_technician_id,omitempty"`
	ScheduledDate        *string                      `json:"scheduled_date,omitempty"`
	ResolvedAt           *time.Time                   `json:"resolved_at,omitempty"`
	ResolutionNotes      string                       `json:"resolution_notes,omitempty"`
	RefabricationPieces  []WarrantyRefabricationPiece `json:"refabrication_pieces"`
	Photos               []WarrantyTicketPhoto        `json:"photos,omitempty"`
	CreatedAt            time.Time                    `json:"created_at"`
	UpdatedAt            time.Time                    `json:"updated_at"`
}
