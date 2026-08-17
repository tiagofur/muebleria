package domain

/**
 * Production activity tracking — operator claim/finish/damage events.
 *
 * This extends the floor-status pipeline (productionFloorEvents.go) with
 * operator-level granularity: WHO is working on WHAT, WHEN they started,
 * WHEN they finished, and any DAMAGE reported along the way.
 *
 * Used by the Production Manager Dashboard (gerente_produccion) to show
 * real-time visibility across all areas.
 */

import "time"

// ─── Activity Types ──────────────────────────────────────────────────────────

// ProductionActivityType classifies the operator event.
type ProductionActivityType string

const (
	ActivityClaim    ProductionActivityType = "claim"    // Operator starts working
	ActivityFinish   ProductionActivityType = "finish"   // Operator completes
	ActivityPause    ProductionActivityType = "pause"    // Operator pauses
	ActivityResume   ProductionActivityType = "resume"   // Operator resumes
	ActivityDamage   ProductionActivityType = "damage"   // Damage reported
	ActivityReassign ProductionActivityType = "reassign" // Admin reassigns
)

// ProductionSector mirrors the TS ProductionSector type.
type ProductionSector string

const (
	SectorWarehouse   ProductionSector = "warehouse"
	SectorCutting     ProductionSector = "cutting"
	SectorCNC         ProductionSector = "cnc"
	SectorEdgeBanding ProductionSector = "edge_banding"
	SectorAssembly    ProductionSector = "assembly"
	SectorPackaging   ProductionSector = "packaging"
	SectorShipping    ProductionSector = "shipping"
	SectorInstall     ProductionSector = "installation"
)

// DamageType classifies the kind of damage reported.
type DamageType string

const (
	DamageCutError      DamageType = "cut_error"      // Wrong dimensions
	DamageEdgeError     DamageType = "edge_error"      // Edge banding defect
	DamageCNCEror       DamageType = "cnc_error"       // Drilling/machining error
	DamagePhysical      DamageType = "physical"         // Dent, scratch, break
	DamageMaterialWrong DamageType = "material_wrong"   // Wrong material used
	DamageOther         DamageType = "other"
)

// ─── Core Types ──────────────────────────────────────────────────────────────

// ProductionActivity is one operator action in the factory.
type ProductionActivity struct {
	ID             string               `json:"id"`
	ProjectID      string               `json:"project_id"`
	ProjectName    string               `json:"project_name,omitempty"`
	ItemID         string               `json:"item_id"`
	ModuleCode     string               `json:"module_code,omitempty"`
	ModuleName     string               `json:"module_name,omitempty"`
	Sector         ProductionSector     `json:"sector"`
	Type           ProductionActivityType `json:"type"`
	OperatorID     string               `json:"operator_id"`
	OperatorName   string               `json:"operator_name,omitempty"`
	MachineID      string               `json:"machine_id,omitempty"`
	MachineName    string               `json:"machine_name,omitempty"`
	StartedAt      *time.Time           `json:"started_at,omitempty"`
	FinishedAt     *time.Time           `json:"finished_at,omitempty"`
	DurationMillis int64                `json:"duration_ms,omitempty"`
	StatusBefore   string               `json:"status_before,omitempty"`
	StatusAfter    string               `json:"status_after,omitempty"`
	PiecesCount    int                  `json:"pieces_count,omitempty"`
	Notes          string               `json:"notes,omitempty"`
	CreatedAt      time.Time            `json:"created_at"`
}

// DamageReport is a piece damage reported by an operator.
type DamageReport struct {
	ID             string        `json:"id"`
	ProjectID      string        `json:"project_id"`
	ProjectName    string        `json:"project_name,omitempty"`
	ItemID         string        `json:"item_id"`
	ModuleCode     string        `json:"module_code,omitempty"`
	Sector         ProductionSector `json:"sector"`
	DamageType     DamageType    `json:"damage_type"`
	Description    string        `json:"description"`
	PhotoURL       string        `json:"photo_url,omitempty"`
	ReportedBy     string        `json:"reported_by"`
	ReportedByName string        `json:"reported_by_name,omitempty"`
	ReportedAt     time.Time     `json:"reported_at"`
	NeedsReplace   bool          `json:"needs_replace"`
	ReplacedBy     string        `json:"replaced_by,omitempty"` // Activity ID of replacement
	Resolved       bool          `json:"resolved"`
	ResolvedAt     *time.Time    `json:"resolved_at,omitempty"`
}

// ─── Dashboard Aggregation Types ─────────────────────────────────────────────

// SectorDashboard is one sector's summary for the Production Manager Dashboard.
type SectorDashboard struct {
	Sector            ProductionSector `json:"sector"`
	Label             string           `json:"label"`
	ActiveOperators   int              `json:"active_operators"`
	QueueLength       int              `json:"queue_length"`
	ItemsInProgress   int              `json:"items_in_progress"`
	ItemsCompletedToday int            `json:"items_completed_today"`
	AvgTimeMinutes    float64          `json:"avg_time_minutes"`
	ActiveJobs        []ActiveJob      `json:"active_jobs,omitempty"`
}

// ActiveJob shows who is working on what right now.
type ActiveJob struct {
	ActivityID   string `json:"activity_id"`
	ProjectID    string `json:"project_id"`
	ProjectName  string `json:"project_name"`
	ItemID       string `json:"item_id"`
	ModuleCode   string `json:"module_code"`
	OperatorID   string `json:"operator_id"`
	OperatorName string `json:"operator_name"`
	MachineID    string `json:"machine_id,omitempty"`
	MachineName  string `json:"machine_name,omitempty"`
	StartedAt    time.Time `json:"started_at"`
	DurationMin  float64  `json:"duration_min"`
}

// OperatorMetrics is one operator's stats for a time range.
type OperatorMetrics struct {
	OperatorID     string  `json:"operator_id"`
	OperatorName   string  `json:"operator_name"`
	Sector         ProductionSector `json:"sector"`
	JobsCompleted  int     `json:"jobs_completed"`
	TotalPieces    int     `json:"total_pieces"`
	TotalTimeMin   float64 `json:"total_time_min"`
	AvgTimePerJob  float64 `json:"avg_time_per_job"`
	DamagesCount   int     `json:"damages_count"`
}

// DashboardMetrics is the full aggregated data for the Production Manager Dashboard.
type DashboardMetrics struct {
	TotalProjects     int                `json:"total_projects"`
	TotalItems        int                `json:"total_items"`
	TotalInstalled    int                `json:"total_installed"`
	AvgProgress       float64            `json:"avg_progress"`
	Sectors           []SectorDashboard  `json:"sectors"`
	TopOperators      []OperatorMetrics  `json:"top_operators,omitempty"`
	TodayCompleted    int                `json:"today_completed"`
	TodayDamages      int                `json:"today_damages"`
	AvgTimePerProject float64            `json:"avg_time_per_project_hours"`
}
