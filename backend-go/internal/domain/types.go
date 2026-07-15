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
	RoleAdmin      UserRole = "admin"
	RoleUser       UserRole = "user"
	RoleVendedor   UserRole = "vendedor"
	RoleDisenador  UserRole = "disenador"
	RoleCarpintero UserRole = "carpintero"
)

// IsValidUserRole reports whether role is an allowed account role.
func IsValidUserRole(role UserRole) bool {
	switch role {
	case RoleAdmin, RoleUser, RoleVendedor, RoleDisenador, RoleCarpintero:
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
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Email     string    `json:"email,omitempty"`
	Phone     string    `json:"phone,omitempty"`
	Address   string    `json:"address,omitempty"`
	Notes     string    `json:"notes,omitempty"`
	Active    bool      `json:"active"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type MaterialBoard struct {
	ID                string    `json:"id"`
	Code              string    `json:"code"`
	Name              string    `json:"name"`
	WidthMm           int       `json:"width_mm"`
	LengthMm          int       `json:"length_mm"`
	ThicknessMm       int       `json:"thickness_mm"`
	GrainDefault      bool      `json:"grain_default"`
	BoardPrice        float64   `json:"board_price"`
	WastePercent      float64   `json:"waste_percent"`
	CostPerM2         float64   `json:"cost_per_m2"`
	// DefaultEdgeBandID links the default edge band by id (never by name).
	DefaultEdgeBandID string    `json:"default_edge_band_id,omitempty"`
	Notes             string    `json:"notes,omitempty"`
	Active            bool      `json:"active"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
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
	Notes       string       `json:"notes,omitempty"`
	Active      bool         `json:"active"`
	CreatedAt   time.Time    `json:"created_at"`
	UpdatedAt   time.Time    `json:"updated_at"`
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
	ID          string           `json:"id"`
	Code        string           `json:"code,omitempty"`
	Description string           `json:"description"`
	Quantity    int              `json:"quantity"`
	LengthMm    int              `json:"length_mm"`
	WidthMm     int              `json:"width_mm"`
	Grain       int              `json:"grain"` // 0 o 1
	Edges       []EdgeAssignment `json:"edges"`
	OptionRole  string           `json:"option_role"`
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
	ID             string         `json:"id"`
	Code           string         `json:"code"`
	Name           string         `json:"name"`
	BaseLaborCost  float64        `json:"base_labor_cost"`
	WidthMm        int            `json:"width_mm,omitempty"`
	HeightMm       int            `json:"height_mm,omitempty"`
	DepthMm        int            `json:"depth_mm,omitempty"`
	CategoryID     string         `json:"categoryId,omitempty"`
	BoardParts     []BoardPart    `json:"board_parts"`
	HardwareLines  []HardwareLine `json:"hardware_lines"`
	Notes          string         `json:"notes,omitempty"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
}

type ProjectItem struct {
	ID            string            `json:"id"`
	ModuleID      string            `json:"module_id"`
	Quantity      int               `json:"quantity"`
	OptionChoices map[string]string `json:"option_choices"` // group_code -> choice_id
}

type Project struct {
	ID             string             `json:"id"`
	Name           string             `json:"name"`
	CustomerID     string             `json:"customer_id"`
	CreatedBy      string             `json:"created_by,omitempty"`
	Currency       string             `json:"currency"`
	MarginFactor   float64            `json:"margin_factor"`
	LaborFixedCost float64            `json:"labor_fixed_cost"`
	Status         ProjectStatus      `json:"status"`
	Items          []ProjectItem      `json:"items"`
	Notes          string             `json:"notes,omitempty"`
	PriceSnapshot  *QuotePriceSnapshot `json:"price_snapshot,omitempty"`
	CreatedAt      time.Time          `json:"created_at"`
	UpdatedAt      time.Time          `json:"updated_at"`
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
	CapturedAt           time.Time          `json:"captured_at"`
	Breakdown            QuoteBreakdown     `json:"breakdown"`
	MaterialCostPerM2    map[string]float64 `json:"material_cost_per_m2,omitempty"`
	EdgeCostPerMl        map[string]float64 `json:"edge_cost_per_ml,omitempty"`
	HardwareCostPerUnit  map[string]float64 `json:"hardware_cost_per_unit,omitempty"`
}

type Catalog struct {
	Materials    []MaterialBoard   `json:"materials"`
	Edges        []EdgeBand        `json:"edges"`
	Hardware     []Hardware        `json:"hardware"`
	OptionGroups []OptionGroup     `json:"option_groups"`
	Modules      []Module          `json:"modules"`
	Categories   []ModuleCategory  `json:"categories,omitempty"`
}
