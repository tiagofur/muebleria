package domain

import (
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
	RoleAdmin         UserRole = "admin"
	RoleUser          UserRole = "user" // approved account without job title
	RoleVendedor      UserRole = "vendedor"
	RoleGerenteVentas UserRole = "gerente_ventas"
	RoleIngeniero     UserRole = "ingeniero"
	RoleProduccion    UserRole = "produccion"
)

// IsValidUserRole reports whether role is an allowed account role (F035 product roles).
func IsValidUserRole(role UserRole) bool {
	switch role {
	case RoleAdmin, RoleUser, RoleVendedor, RoleGerenteVentas, RoleIngeniero, RoleProduccion:
		return true
	default:
		return false
	}
}

// ErrPendingApproval is returned when a user exists but has not been approved yet.
var ErrPendingApproval = fmt.Errorf("account pending approval")

type ProjectStatus string

const (
	StatusDraft    ProjectStatus = "draft"
	StatusQuoted   ProjectStatus = "quoted"
	StatusAccepted ProjectStatus = "accepted"
	StatusProduced ProjectStatus = "produced"
)

type User struct {
	ID           string    `json:"id"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"`
	Name         string    `json:"name"`
	Role         UserRole  `json:"role"`
	Active       bool      `json:"active"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
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
	ImageURL  string    `json:"image_url,omitempty"`
	Notes     string    `json:"notes,omitempty"`
	Active    bool      `json:"active"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type EdgeBand struct {
	ID          string    `json:"id"`
	Code        string    `json:"code"`
	Name        string    `json:"name"`
	ThicknessMm int       `json:"thickness_mm"`
	CostPerMl   float64   `json:"cost_per_ml"`
	Notes       string    `json:"notes,omitempty"`
	Active      bool      `json:"active"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type Hardware struct {
	ID          string       `json:"id"`
	Code        string       `json:"code"`
	Name        string       `json:"name"`
	Unit        HardwareUnit `json:"unit"`
	CostPerUnit float64      `json:"cost_per_unit"`
	// ImageURL relative media path (F040).
	ImageURL  string    `json:"image_url,omitempty"`
	Notes     string    `json:"notes,omitempty"`
	Active    bool      `json:"active"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
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
type Structure struct {
	ID         string            `json:"id"`
	Code       string            `json:"code"`
	Name       string            `json:"name"`
	WidthMm    int               `json:"width_mm,omitempty"`
	HeightMm   int               `json:"height_mm,omitempty"`
	DepthMm    int               `json:"depth_mm,omitempty"`
	BoardParts []BoardPart       `json:"board_parts"`
	Presets    []DimensionPreset `json:"presets,omitempty"`
	Notes      string            `json:"notes,omitempty"`
	Active     bool              `json:"active"`
	CreatedAt  time.Time         `json:"created_at"`
	UpdatedAt  time.Time         `json:"updated_at"`
}

type ProjectItem struct {
	ID            string            `json:"id"`
	ModuleID      string            `json:"module_id"`
	Quantity      int               `json:"quantity"`
	OptionChoices map[string]string `json:"option_choices"` // group_code -> choice_id
}

type Project struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	CustomerID string `json:"customer_id"`
	CreatedBy  string `json:"created_by,omitempty"`
	// OwnerUserID is the portfolio owner (F034). May differ from CreatedBy after reassignment.
	OwnerUserID    string        `json:"owner_user_id,omitempty"`
	Currency       string        `json:"currency"`
	MarginFactor   float64       `json:"margin_factor"`
	LaborFixedCost float64       `json:"labor_fixed_cost"`
	Status         ProjectStatus `json:"status"`
	Items          []ProjectItem `json:"items"`
	// ProjectLevelChoices are defaults for all line items (F029 / #35).
	// Effective: item.OptionChoices[role] if set, else ProjectLevelChoices[role].
	ProjectLevelChoices map[string]string   `json:"project_level_choices,omitempty"`
	Notes               string              `json:"notes,omitempty"`
	PriceSnapshot       *QuotePriceSnapshot `json:"price_snapshot,omitempty"`
	CreatedAt           time.Time           `json:"created_at"`
	UpdatedAt           time.Time           `json:"updated_at"`
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
}


// WorkshopSettings is taller-wide defaults (F031 + F044 COST-02).
type WorkshopSettings struct {
	DefaultMarginFactor   float64 `json:"default_margin_factor"`
	DefaultLaborFixedCost float64 `json:"default_labor_fixed_cost"`
	DefaultCurrency       string  `json:"default_currency"`
	VendedorCanViewCosts  bool    `json:"vendedor_can_view_costs"`
}

// DefaultWorkshopSettings matches TS DEFAULT_WORKSHOP_SETTINGS.
func DefaultWorkshopSettings() WorkshopSettings {
	return WorkshopSettings{
		DefaultMarginFactor:   1.35,
		DefaultLaborFixedCost: 0,
		DefaultCurrency:       "MXN",
		VendedorCanViewCosts:  false,
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
