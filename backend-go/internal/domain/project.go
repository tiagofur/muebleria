package domain

import (
	"encoding/json"
	"time"
)

// Contrato: proyecto y cotización — items con dims custom, Project,
// plantillas, snapshots de precio y workshop settings.
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
	// DimsAuthoritative marks an item whose explicit CustomDims are the pricing
	// truth: measure presets are neither required nor consulted (#974). Set
	// ONLY by the design commercial projection — the placed dimensions are the
	// physical truth the estimate must price, and the SketchUp working copy
	// carries no preset field. Quotation never sets it and keeps the preset
	// gate. Not serialized: it never travels on the wire and stays out of
	// projection fingerprints.
	DimsAuthoritative bool `json:"-"`
	// FloorStatus is shop-floor progress (PROD-3.1): pending|cut|edged|assembled|installed.
	// Empty/omitted = pending. Does not affect BOM or pricing.
	FloorStatus string `json:"floor_status,omitempty"`
	// FrozenPricingContext is an internal immutable quote input. It is never
	// accepted from Project APIs; requote pricing uses it instead of mutable
	// project layout/base state.
	FrozenPricingContext *QuoteCommercialPricingContext `json:"-"`
}

type Project struct {
	ID                          string `json:"id"`
	Name                        string `json:"name"`
	CustomerID                  string `json:"customer_id"`
	OrganizationID              string `json:"organization_id,omitempty"`
	SalesOrganizationID         string `json:"sales_organization_id,omitempty"`
	ManufacturingOrganizationID string `json:"manufacturing_organization_id,omitempty"`
	CreatedBy                   string `json:"created_by,omitempty"`
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
	CutPlan json.RawMessage `json:"cut_plan,omitempty"`
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
	MaterialsRelease  json.RawMessage          `json:"materials_release,omitempty"`
	DesignRevisions   []LegacyDesignRevision   `json:"design_revisions,omitempty"`
	Approvals         []Approval               `json:"approvals,omitempty"`
	ProductionRelease *LegacyProductionRelease `json:"production_release,omitempty"`
	// ResolvedProductionRelease is the server-owned projection of the ONE
	// release authority of this project (#577 / OPS-DT-1): the canonical
	// #395 ProductionRelease when one exists (source "canonical"), else the
	// legacy OC-022 blob through the compatibility adapter (source
	// "legacy"). Computed on read (list/detail); never persisted and never
	// accepted from client writes.
	ResolvedProductionRelease *ResolvedProductionRelease `json:"resolved_production_release,omitempty"`
	// ReleaseEngineering is the server-owned projection of the durable
	// Engineering state of the RESOLVED release authority (#740): nil while
	// pending, in_progress/completed with actor + server timestamps
	// otherwise. Computed on read (list/detail); never persisted on the
	// projects row and never accepted from client writes.
	ReleaseEngineering *ReleaseEngineeringState `json:"release_engineering,omitempty"`
	// HasDigitalThreadContext is the server-owned projection that positively
	// identifies a project as participating in the Digital Thread (#697
	// review): it has at least one project-owned FurnitureInstance, quote
	// revision, DT design or canonical production release. It is the ONE signal
	// separating modern DT projects from true pre-Digital-Thread ones — legacy
	// accepted/produced status compatibility never applies to a project with
	// Digital Thread context. Computed on read (list/detail); never
	// persisted and never accepted from client writes.
	HasDigitalThreadContext bool                  `json:"has_digital_thread_context"`
	ChangeOrders            []ChangeOrder         `json:"change_orders,omitempty"`
	PartInstances           []PartInstance        `json:"part_instances,omitempty"`
	ModuleUnits             []ModuleUnitExecution `json:"module_units,omitempty"`
	// Installation is the installation job (visits, field issues, punch,
	// closeout — OC-070..OC-074). Server-authoritative: only mutated through
	// the dedicated installation endpoints, never through the project PUT.
	Installation *InstallationJob `json:"installation,omitempty"`
	// MaterialPlanning is the MRP subprocess of the obra: requirements from
	// the released BOM, reservations and the evidence-backed release
	// (OC-050..OC-054, #302). Server-authoritative via the materials endpoints.
	MaterialPlanning *MaterialPlanning `json:"material_planning,omitempty"`
	// Quality is the quality subprocess of the obra: issues, rework actions
	// and per-unit QC records (OC-060..OC-062, #302).
	Quality *QualityJob `json:"quality,omitempty"`
	// Costing is the job costing subprocess of the obra: baseline frozen from
	// quote snapshot + release, time entries and other actual costs
	// (OC-080..OC-084, #304). Material actuals derive from stock movements
	// assigned to the obra. Server-authoritative via the costing endpoints.
	Costing *JobCosting `json:"costing,omitempty"`
	// SiteSurvey is the structured site survey of the obra: spaces with field
	// measurements, openings/obstacles, utilities and explicit capture/verify
	// authorship (OC-040/OC-041, #305). Server-authoritative via the survey
	// endpoints; hardens the survey_verified release gate when present.
	SiteSurvey    *SiteSurvey         `json:"site_survey,omitempty"`
	FloorEvents   []FloorStatusEvent  `json:"floor_events,omitempty"`
	Events        []ProjectEvent      `json:"events,omitempty"`
	Notes         string              `json:"notes,omitempty"`
	PriceSnapshot *QuotePriceSnapshot `json:"price_snapshot,omitempty"`
	CreatedAt     time.Time           `json:"created_at"`
	UpdatedAt     time.Time           `json:"updated_at"`
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

type ProjectPicking struct {
	ProjectID    string     `json:"project_id"`
	Material     string     `json:"material"`
	Status       string     `json:"status"`
	MarkedAt     *time.Time `json:"marked_at,omitempty"`
	MarkedBy     *string    `json:"marked_by,omitempty"`
	MarkedByName *string    `json:"marked_by_name,omitempty"`
}
