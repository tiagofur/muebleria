package domain

import ()

// Contrato: BOM resuelta y proyección de producción — Grain,
// ResolvedBoardPart/HardwareLine/Bom, filas de corte y compra.
type Grain int

const (
	GrainNone Grain = 0
	GrainYes  Grain = 1
)

// ResolvedBoardPart is a board part with concrete material/edge/grain (TS parity).
type ResolvedBoardPart struct {
	ID          string `json:"id"`
	Code        string `json:"code,omitempty"`
	Description string `json:"description"`
	Quantity    int    `json:"quantity"`
	LengthMm    int    `json:"length_mm"`
	WidthMm     int    `json:"width_mm"`
	// ThicknessMm is the effective board thickness that produced this piece:
	// the selected MaterialBoard.thicknessMm (#402 / MT-1), same as TS
	// ResolvedBoardPart.thicknessMm.
	ThicknessMm int              `json:"thickness_mm"`
	Grain       Grain            `json:"grain"`
	Edges       []EdgeAssignment `json:"edges"`
	OptionRole  string           `json:"option_role"`
	MaterialID  string           `json:"material_id"`
	// #793 — industrial identity frozen at resolve time from the same catalog
	// read that produced the release snapshot. Older snapshot payloads decode
	// with these empty: consumers that need frozen identity (the r5 PTX
	// label route) fail closed instead of re-reading the live catalog.
	MaterialCode string `json:"material_code,omitempty"`
	EdgeBandID   string `json:"edge_band_id,omitempty"`
	EdgeBandCode string `json:"edge_band_code,omitempty"`
}

// ResolvedHardwareLine is a hardware line with concrete hardware id.
type ResolvedHardwareLine struct {
	ID string `json:"id"`
	// Quantity is float64 (#442): fractional meters for ZOCLO_PERFIL lines
	// (TS parity — consumed ml, purchase-bar rounding happens at export).
	Quantity            float64 `json:"quantity"`
	DescriptionOverride string  `json:"description_override,omitempty"`
	OptionRole          string  `json:"option_role"`
	HardwareID          string  `json:"hardware_id"`
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
// Mirrors TS HardwarePurchaseRow (#442): quantity is net consumption
// (fractional meters for strip profiles); purchaseQuantity applies package
// rounding and lineCost prices what is actually bought.
type HardwarePurchaseRow struct {
	HardwareID       string       `json:"hardware_id"`
	Code             string       `json:"code"`
	Description      string       `json:"description"`
	Unit             HardwareUnit `json:"unit"`
	Quantity         float64      `json:"quantity"`
	PurchaseQuantity float64      `json:"purchase_quantity"`
	// PurchasePackages is set only when the hardware defines a package size.
	PurchasePackages *int     `json:"purchase_packages,omitempty"`
	PackageSize      *float64 `json:"package_size,omitempty"`
	CostPerUnit      float64  `json:"cost_per_unit"`
	LineCost         float64  `json:"line_cost"`
}

// ProjectPhotoStage represents the lifecycle stage of a project photo.
