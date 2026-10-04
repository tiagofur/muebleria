package domain

import (
	"time"
)

// Contrato: biblioteca paramétrica — categorías, módulos, presets,
// agregados, reglas de joinery, estructuras, instancias de componente,
// placements de herraje y accesorios de puerta.
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
	// ParameterDefinitions is the authoritative typed authoring contract.
	// Legacy modules keep this empty and are projected as width/height/depth
	// definitions by the catalog adapter (#483).
	ParameterDefinitions []FurnitureParameterDefinition `json:"parameter_definitions,omitempty"`
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
	// Version is the server-owned optimistic-concurrency token (strong ETag
	// "v<N>", #497): create starts at 1 and every accepted update increments
	// it inside the update transaction. Request bodies never set it — the
	// If-Match header is the only expected-version authority.
	Version   int64     `json:"version"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
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
	GridMm      *int            `json:"gridMm,omitempty"`
	SideToFloor *PanelJointRule `json:"sideToFloor,omitempty"`
	SideToTop   *PanelJointRule `json:"sideToTop,omitempty"`
	BackPanel   *BackPanelRule  `json:"backPanel,omitempty"`
	DoorHinge   *DoorHingeRule  `json:"doorHinge,omitempty"`
}

type PanelJointRule struct {
	MinifixCode  string   `json:"minifixCode,omitempty"`
	DowelCode    string   `json:"dowelCode,omitempty"`
	EndMarginMm  *float64 `json:"endMarginMm,omitempty"`
	MaxSpacingMm *float64 `json:"maxSpacingMm,omitempty"`
	WithDowels   *bool    `json:"withDowels,omitempty"`
}

type BackPanelRule struct {
	ScrewCode    string   `json:"screwCode,omitempty"`
	InsetMm      *float64 `json:"insetMm,omitempty"`
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
	ID                      string                      `json:"id"`
	Code                    string                      `json:"code"`
	Name                    string                      `json:"name"`
	Description             string                      `json:"description,omitempty"`
	Notes                   string                      `json:"notes,omitempty"`
	WidthMm                 int                         `json:"width_mm,omitempty"`
	HeightMm                int                         `json:"height_mm,omitempty"`
	DepthMm                 int                         `json:"depth_mm,omitempty"`
	Components              []ComponentInstance         `json:"components,omitempty"`
	HardwareLines           []HardwareLine              `json:"hardware_lines,omitempty"`
	CommercialKitHardwareID *string                     `json:"commercial_kit_hardware_id,omitempty"`
	RigidMembers            []AgregadoRigidMember       `json:"rigid_members,omitempty"`
	VariantSets             []AgregadoVariantSet        `json:"variant_sets,omitempty"`
	CompatibilityRules      []AssemblyCompatibilityRule `json:"compatibility_rules,omitempty"`
	// PresentationMotion carries the #529 opening kinematics authored in the
	// catalog UI (rotate/translate/keyframes). Presentation-only pass-through:
	// the backend stores and echoes it but never interprets it — hosts replay
	// it as a transient visual pose that never touches manufacturing truth.
	PresentationMotion map[string]any `json:"presentation_motion,omitempty"`
	CurrentRevisionID  *string        `json:"current_revision_id,omitempty"`
	Active             bool           `json:"active"`
	CreatedAt          time.Time      `json:"created_at"`
	UpdatedAt          time.Time      `json:"updated_at"`
}

// HardwarePlacement attaches a visible hardware instance to a component face for
// the 3D preview (Fase 2: visible handles). Distinct from Perforation
// (CNC/machining — different lifecycle/consumers). Rides the component-instance
// overrides JSONB; no dedicated column or migration.
type HardwarePlacement struct {
	// HardwareID is the concrete catalog hardware. Optional when OptionRole is
	// set (#1046): the layout resolver substitutes the chosen catalog hardware
	// from the effective option choices, mirroring HardwareLine.HardwareID.
	// Machining/drilling/demand only ever see the resolved concrete id.
	HardwareID       string               `json:"hardwareId,omitempty"`
	// OptionRole is the option-group code (kind hardware) when the concrete
	// item is chosen later (Blum vs Hafele vs económica — #1046). Exactly one
	// of HardwareID/OptionRole must be usable; a required group without a
	// choice fails the resolve.
	OptionRole       string               `json:"optionRole,omitempty"`
	AnchorFace       string               `json:"anchorFace"` // front|back|left|right|top|bottom
	RelativePosition HardwareRelPosition  `json:"relativePosition"`
	RotationDeg      *HardwareRotationDeg `json:"rotationDeg,omitempty"`
	Scale            *float64             `json:"scale,omitempty"`
	// PartRole optionally distinguishes multi-part hardware (e.g. minifix cam vs bolt).
	PartRole string `json:"partRole,omitempty"`
	// DerivedMachining replaces the catalog technical profile for this specific
	// placement when the physical application differs from the generic
	// footprint (F129). Leave nil to use the catalog profile.
	DerivedMachining *HardwareMachiningProfile `json:"derivedMachining,omitempty"`
	// DoorAffinity groups hinges/handles by door and swing side for the
	// SketchUp inspector UI. Pure presentation metadata; never used as
	// manufacturing identity. Nil for non-door hardware.
	DoorAffinity *DoorAffinity `json:"doorAffinity,omitempty"`
}

// DoorAccessoryRole identifies a door-accessory kind in a grouped inspector view.
type DoorAccessoryRole string

const (
	DoorAccessoryHinge  DoorAccessoryRole = "hinge"
	DoorAccessoryHandle DoorAccessoryRole = "handle"
)

// DoorAffinity associates a HardwarePlacement to a specific door (by slot index)
// and identifies its role on that door — published by authoring-resolve so the
// SketchUp inspector can group accessories per-door without guessing.
type DoorAffinity struct {
	DoorSlotIndex  int               `json:"doorSlotIndex"`
	DoorLabel      string            `json:"doorLabel"`
	SwingSide      string            `json:"swingSide"` // "left" | "right"
	AccessoryRole  DoorAccessoryRole `json:"accessoryRole"`
	AccessoryIndex int               `json:"accessoryIndex"`
}

// HardwareAccessoryRow is one row-level accessory rendered inside a door group
// on the inspector card. Pure presentation shape for the Ruby→JS bridge.
type HardwareAccessoryRow struct {
	HardwarePlacementID string               `json:"hardwarePlacementId"`
	CatalogHardwareID   string               `json:"catalogHardwareId,omitempty"`
	HardwareName        string               `json:"hardwareName,omitempty"`
	AnchorFace          string               `json:"anchorFace"`
	OffsetMm            [2]float64           `json:"offsetMm"`
	PlacementKind       string               `json:"placementKind"`
	RotationDeg         *HardwareRotationDeg `json:"rotationDeg,omitempty"`
}

// DoorAccessoryGroup publishes the resolved swing side plus grouped hinge/handle
// placements for one door inside a furniture's inspector view.
type DoorAccessoryGroup struct {
	DoorSlotIndex int                    `json:"doorSlotIndex"`
	DoorLabel     string                 `json:"doorLabel"`
	SwingSide     string                 `json:"swingSide"`
	HingeFace     string                 `json:"hingeFace"`
	HandleFace    string                 `json:"handleFace"`
	Hinges        []HardwareAccessoryRow `json:"hinges"`
	Handles       []HardwareAccessoryRow `json:"handles"`
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
	Edges              []EdgeAssignment       `json:"edges,omitempty"`
	LengthFormula      string                 `json:"lengthFormula,omitempty"`
	WidthFormula       string                 `json:"widthFormula,omitempty"`
	XFormula           string                 `json:"xFormula,omitempty"`
	YFormula           string                 `json:"yFormula,omitempty"`
	ZFormula           string                 `json:"zFormula,omitempty"`
	RotateX            *int                   `json:"rotateX,omitempty"`
	RotateY            *int                   `json:"rotateY,omitempty"`
	RotateZ            *int                   `json:"rotateZ,omitempty"`
	HardwarePlacements []HardwarePlacement    `json:"hardwarePlacements,omitempty"`
	LengthRule         *AssemblyDimensionRule `json:"lengthRule,omitempty"`
	WidthRule          *AssemblyDimensionRule `json:"widthRule,omitempty"`
	PlacementRule      *AssemblyAnchorRule    `json:"placementRule,omitempty"`
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
// Mirrors the frontend Component type from @granete/domain.
type Component struct {
	ID           string             `json:"id"`
	Code         string             `json:"code"`
	Name         string             `json:"name"`
	Placement    ComponentPlacement `json:"placement"`
	GeometryKind string             `json:"geometry_kind"`
	LengthMm     int                `json:"length_mm"`
	WidthMm      int                `json:"width_mm"`
	ThicknessMm  int                `json:"thickness_mm"`
	DefaultEdges []EdgeAssignment   `json:"default_edges"`
	OptionRoles  []string           `json:"option_roles,omitempty"`
	// CompatibleHardwareCategories optionally lists the hardware categories this component can host (#350).
	CompatibleHardwareCategories []string  `json:"compatible_hardware_categories,omitempty"`
	LengthFormula                string    `json:"length_formula,omitempty"`
	WidthFormula                 string    `json:"width_formula,omitempty"`
	XFormula                     string    `json:"x_formula,omitempty"`
	YFormula                     string    `json:"y_formula,omitempty"`
	ZFormula                     string    `json:"z_formula,omitempty"`
	RotateX                      int       `json:"rotate_x,omitempty"`
	RotateY                      int       `json:"rotate_y,omitempty"`
	RotateZ                      int       `json:"rotate_z,omitempty"`
	Notes                        string    `json:"notes,omitempty"`
	Active                       bool      `json:"active"`
	CreatedAt                    time.Time `json:"created_at"`
	UpdatedAt                    time.Time `json:"updated_at"`
}

// ItemCustomDims is the free per-item dimensions override (F144 / #310), mm.
// Wins over the commercial preset; only valid for composed (parametric)
// modules. Mirrors TS ItemCustomDims.
