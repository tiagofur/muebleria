package engine

import (
	"fmt"
	"math"
	"sort"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// Versioned rich authoring resolve (#477): the stateless boundary that turns
// a semantic furniture authoring snapshot (occurrences, relationship/joint
// intent, manual hardware placements) into the authoritative resolved result
// — #415 native layout, machining with provenance, deterministic
// fingerprint, structured preflight issues. Nothing here persists business
// state: identical inputs resolve to identical outputs, and client occurrence
// IDs stay authoring-scoped (never promoted to Project identity).
//
// Contract: granete.sketchup-authoring-resolve.v1
// Fixture:  contracts/sketchupAuthoringResolve.contract.json (Go is the
// golden author; TS/Ruby consume it for parity).

const (
	// AuthoringResolveSchemaName/Version/ID are the compound schema identity
	// every request must carry exactly (#477: unknown version fails closed).
	AuthoringResolveSchemaName    = "granete.sketchup-authoring-resolve"
	AuthoringResolveSchemaVersion = "1.0"
	AuthoringResolveSchemaID      = AuthoringResolveSchemaName + ".v1"
)

// Resolve-scoped validation of the accepted intent. This is deliberately
// NOT the #347 manufacturing preflight verdict: it never claims fabrication
// readiness, and the full preflight contract is published as the link to
// obtain the authoritative result (#347 owns that model).
const (
	AuthoringValidationScope       = "authoring-resolve-subset"
	AuthoringValidationClear       = "clear"
	AuthoringValidationBlocked     = "blocked"
	ManufacturingPreflightContract = "granete.manufacturing-preflight.v1"
)

// AuthoringOccurrenceTransform carries authoring intent for an occurrence.
// v1 supports a translation in the assembly (furniture) frame only; the
// server resolves everything else (orientation, thickness, geometry).
type AuthoringOccurrenceTransform struct {
	Frame         string     `json:"frame"`
	TranslationMm [3]float64 `json:"translationMm"`
}

// AuthoringOccurrence is one concrete component occurrence of the authoring
// snapshot (#346 identity semantics: componentInstanceId is the only valid
// anchor/host target; componentDefinitionId may be shared by many copies).
type AuthoringOccurrence struct {
	ComponentInstanceID   string                        `json:"componentInstanceId"`
	ComponentDefinitionID string                        `json:"componentDefinitionId,omitempty"`
	CatalogComponentID    string                        `json:"catalogComponentId,omitempty"`
	Role                  string                        `json:"role,omitempty"`
	Transform             *AuthoringOccurrenceTransform `json:"transform,omitempty"`
}

// AuthoringRelationshipAnchor mirrors the TS RelationshipAnchor.
type AuthoringRelationshipAnchor struct {
	ComponentInstanceID string `json:"componentInstanceId"`
	Role                string `json:"role"`
	Face                string `json:"face,omitempty"`
	Reference           string `json:"reference,omitempty"`
}

// AuthoringRelationship mirrors the TS PartRelationshipIntent: constructive
// intent, never final perforations.
type AuthoringRelationship struct {
	RelationshipID  string                        `json:"relationshipId"`
	Kind            string                        `json:"kind"`
	Source          AuthoringRelationshipAnchor   `json:"source"`
	Targets         []AuthoringRelationshipAnchor `json:"targets"`
	JoinerySystemID string                        `json:"joinerySystemId,omitempty"`
	Parameters      map[string]any                `json:"parameters,omitempty"`
}

// AuthoringManualPlacement is the resolve-scoped manual placement intent.
// v1 carries no rotationDeg/handedness: fields that do not drive resolution
// are not accepted (an apparent capability is worse than an absent one);
// #468 adds them together with their resolution semantics.
type AuthoringManualPlacement struct {
	HardwarePlacementID     string     `json:"hardwarePlacementId"`
	CatalogHardwareID       string     `json:"catalogHardwareId"`
	HostComponentInstanceID string     `json:"hostComponentInstanceId"`
	AnchorFace              string     `json:"anchorFace"`
	OffsetMm                [2]float64 `json:"offsetMm"`
}

// NormalizedAuthoringComponent is the server-normalized occurrence echo.
type NormalizedAuthoringComponent struct {
	ComponentInstanceID   string                        `json:"componentInstanceId"`
	ComponentDefinitionID string                        `json:"componentDefinitionId"`
	CatalogComponentID    string                        `json:"catalogComponentId"`
	Role                  string                        `json:"role"`
	Transform             *AuthoringOccurrenceTransform `json:"transform,omitempty"`
}

// NormalizedAuthoringIntent is the stateless mutation receipt: the complete
// effective authoring state the server accepted. Clients echo it as the base
// of the next snapshot; resolved data (layout, machining) never re-enters it.
type NormalizedAuthoringIntent struct {
	Parameters         map[string]any                 `json:"parameters"`
	MaterialChoices    map[string]string              `json:"materialChoices"`
	Components         []NormalizedAuthoringComponent `json:"components"`
	Relationships      []AuthoringRelationship        `json:"relationships"`
	HardwarePlacements []AuthoringManualPlacement     `json:"hardwarePlacements"`
}

// AuthoringResolveInput is everything the stateless resolve needs. Occurrences
// nil = definition default occurrence set (GET layout parity); ManualPlacementsPresent
// distinguishes "not authoring hardware" from "authored an empty set".
type AuthoringResolveInput struct {
	Module                  domain.Module
	Catalog                 domain.Catalog
	Dims                    *LayoutDims
	OptionChoices           map[string]string
	PrecisionMm             float64
	Occurrences             []AuthoringOccurrence
	Relationships           []AuthoringRelationship
	ManualPlacements        []AuthoringManualPlacement
	ManualPlacementsPresent bool
	EvaluatedParameters     map[string]any
}

// AuthoringResolveResult carries the accepted resolve. StructuralIssues
// non-empty means the snapshot was rejected (no resolved result is usable).
type AuthoringResolveResult struct {
	Layout           FurnitureLayout
	Normalized       NormalizedAuthoringIntent
	Machining        AuthoringMachining
	ValidationStatus string
	ValidationIssues []domain.ContractIssue
	StructuralIssues []domain.ContractIssue
}

// plannedCopy is one occurrence slot of a planned template.
type plannedCopy struct {
	instanceID  string
	translation *[3]float64
}

// authoringPlan maps template definition ID → ordered copies. Copy order is
// deterministic and request-order-insensitive: un-authored occurrences
// (sorted by ID) take the default pose slots first, authored ones (sorted by
// ID) follow with their own translations.
type authoringPlan struct {
	active    bool
	templates map[string][]plannedCopy
	emitted   map[string]bool
}

// authoringTemplateIndex is the definition's default expansion shape the
// snapshot is validated against (collected via a dry-run expansion).
type authoringTemplateIndex struct {
	entries map[string]*authoringTemplateInfo
}

type authoringTemplateInfo struct {
	defID              string
	catalogComponentID string
	placement          string
	defaultCount       int
	entryCount         int
	agregado           bool
}

func (idx *authoringTemplateIndex) note(defID, catalogComponentID, placement string, quantity int, agregado bool) {
	if idx.entries == nil {
		idx.entries = map[string]*authoringTemplateInfo{}
	}
	info, ok := idx.entries[defID]
	if !ok {
		info = &authoringTemplateInfo{defID: defID, catalogComponentID: catalogComponentID, placement: placement, agregado: agregado}
		idx.entries[defID] = info
	}
	if quantity < 0 {
		quantity = 0
	}
	info.defaultCount += quantity
	info.entryCount++
}

// ResolveAuthoringLayout resolves a rich authoring snapshot against the
// authoritative module definition. Pure and deterministic: the same input
// always produces the same result; no business records are created.
func ResolveAuthoringLayout(input AuthoringResolveInput) (*AuthoringResolveResult, error) {
	structural := []domain.ContractIssue{}
	manufacturing := []domain.ContractIssue{}

	if input.PrecisionMm <= 0 || math.IsNaN(input.PrecisionMm) || math.IsInf(input.PrecisionMm, 0) {
		input.PrecisionMm = 0.01
	}

	// 1. Dry-run the default expansion to collect the template index the
	// snapshot must map onto (structure/module/agregado walk, same code path
	// as the real resolve).
	templateIndex := &authoringTemplateIndex{}
	if _, _, err := resolveFurnitureLayoutOpts(input.Module, input.Catalog, input.Dims, input.OptionChoices, resolveOptions{templateCollector: templateIndex}); err != nil {
		return nil, err
	}

	// 2. Validate + plan the occurrence snapshot.
	plan := &authoringPlan{templates: map[string][]plannedCopy{}, emitted: map[string]bool{}}
	if input.Occurrences != nil {
		plan.active = true
		planOccurrences(plan, input.Occurrences, templateIndex, &structural)
	}

	// 3. Resolve the layout with the plan (nil plan = default expansion).
	var opts resolveOptions
	if plan.active {
		opts.plan = plan
	}
	if input.ManualPlacementsPresent {
		opts.manualPlacements = &input.ManualPlacements
	}
	layout, boards, err := resolveFurnitureLayoutOpts(input.Module, input.Catalog, input.Dims, input.OptionChoices, opts)
	if err != nil {
		return nil, err
	}
	if len(structural) > 0 {
		return &AuthoringResolveResult{Layout: layout, StructuralIssues: structural}, nil
	}

	// 4. Effective manual placement set: authored placements replace the
	// definition defaults; absent placements materialize the defaults as
	// intents so the normalized snapshot is always the complete state.
	effectivePlacements, placementIssues := effectiveManualPlacements(boards, input.ManualPlacements, input.ManualPlacementsPresent, input.Catalog)
	structural = append(structural, placementIssues...)

	// 5. Relationship anchors must resolve inside the effective occurrence set.
	relationshipIssues := validateRelationships(input.Relationships, boards)
	structural = append(structural, relationshipIssues...)

	if len(structural) > 0 {
		return &AuthoringResolveResult{Layout: layout, StructuralIssues: structural}, nil
	}

	// 6. Derive machining (Go port of the #356 resolver over resolved boards).
	machiningForPlacements := make([]effectivePlacementForMachining, 0, len(effectivePlacements))
	for _, p := range effectivePlacements {
		machiningForPlacements = append(machiningForPlacements, effectivePlacementForMachining{intent: p.intent, board: p.board})
	}
	machining, machiningIssues := deriveAuthoringMachining(boards, input.Relationships, machiningForPlacements, input.Catalog)
	manufacturing = append(manufacturing, machiningIssues...)
	machining.ManufacturingFingerprint = authoringManufacturingFingerprint(
		layout, boards, machiningForPlacements, machining.DerivedHardwarePlacements, machining.Operations)

	// 7. Normalized snapshot (stateless receipt).
	normalized := buildNormalizedIntent(input, layout, boards, effectivePlacements)

	return &AuthoringResolveResult{
		Layout:           layout,
		Normalized:       normalized,
		Machining:        machining,
		ValidationStatus: validationStatusFor(manufacturing),
		ValidationIssues: manufacturing,
	}, nil
}

// planOccurrences validates the snapshot against the template index and
// builds the deterministic copy plan.
func planOccurrences(plan *authoringPlan, occurrences []AuthoringOccurrence, index *authoringTemplateIndex, issues *[]domain.ContractIssue) {
	seen := map[string]bool{}
	grouped := map[string][]AuthoringOccurrence{}

	for i, occurrence := range occurrences {
		path := fmt.Sprintf("furniture.components[%d]", i)
		if occurrence.ComponentInstanceID == "" {
			*issues = append(*issues, domain.ContractIssue{
				Code: "REQUEST_INVALID", Message: "componentInstanceId is required",
				Severity: domain.IssueSeverityError, Path: path + ".componentInstanceId",
			})
			continue
		}
		if seen[occurrence.ComponentInstanceID] {
			*issues = append(*issues, domain.ContractIssue{
				Code:     "OCCURRENCE_DUPLICATE_ID",
				Message:  fmt.Sprintf("componentInstanceId %s appears more than once", occurrence.ComponentInstanceID),
				Severity: domain.IssueSeverityError, EntityID: occurrence.ComponentInstanceID,
				Path:        path + ".componentInstanceId",
				Remediation: "Every concrete occurrence needs its own componentInstanceId; a shared componentDefinitionId is the reusable part.",
			})
			continue
		}
		seen[occurrence.ComponentInstanceID] = true

		if occurrence.ComponentDefinitionID == "" {
			*issues = append(*issues, domain.ContractIssue{
				Code:     "REQUEST_INVALID",
				Message:  fmt.Sprintf("occurrence %s carries no componentDefinitionId; the snapshot maps occurrences onto the definition's templates by that ID", occurrence.ComponentInstanceID),
				Severity: domain.IssueSeverityError, EntityID: occurrence.ComponentInstanceID,
				Path:        path + ".componentDefinitionId",
				Remediation: "Echo the componentDefinitionId the resolve response returned for this occurrence.",
			})
			continue
		}
		template, ok := index.entries[occurrence.ComponentDefinitionID]
		if !ok {
			*issues = append(*issues, domain.ContractIssue{
				Code:     "OCCURRENCE_UNKNOWN_TEMPLATE",
				Message:  fmt.Sprintf("componentDefinitionId %s is not part of this furniture definition's composition", occurrence.ComponentDefinitionID),
				Severity: domain.IssueSeverityError, EntityID: occurrence.ComponentInstanceID,
				Path:        path + ".componentDefinitionId",
				Remediation: "Occurrences must map onto a component the definition already instantiates; new component classes are not authoring input in v1.",
			})
			continue
		}
		if occurrence.CatalogComponentID != "" && occurrence.CatalogComponentID != template.catalogComponentID {
			*issues = append(*issues, domain.ContractIssue{
				Code:     "CATALOG_REFERENCE_MISSING",
				Message:  fmt.Sprintf("catalogComponentId %s does not match the catalog component behind %s", occurrence.CatalogComponentID, template.defID),
				Severity: domain.IssueSeverityError, EntityID: occurrence.ComponentInstanceID,
				Path: path + ".catalogComponentId",
			})
			continue
		}
		if occurrence.Transform != nil {
			if occurrence.Transform.Frame != "assembly" {
				*issues = append(*issues, domain.ContractIssue{
					Code: "TRANSFORM_INVALID", Message: "occurrence transform frame must be assembly",
					Severity: domain.IssueSeverityError, EntityID: occurrence.ComponentInstanceID,
					Path: path + ".transform.frame",
				})
				continue
			}
			t := occurrence.Transform.TranslationMm
			if math.IsNaN(t[0]) || math.IsInf(t[0], 0) || math.IsNaN(t[1]) || math.IsInf(t[1], 0) || math.IsNaN(t[2]) || math.IsInf(t[2], 0) {
				*issues = append(*issues, domain.ContractIssue{
					Code: "TRANSFORM_INVALID", Message: "translationMm must be three finite millimeters",
					Severity: domain.IssueSeverityError, EntityID: occurrence.ComponentInstanceID,
					Path: path + ".transform.translationMm",
				})
				continue
			}
		}
		grouped[occurrence.ComponentDefinitionID] = append(grouped[occurrence.ComponentDefinitionID], occurrence)
	}

	// Full-snapshot completeness: every structural template of the default
	// expansion must keep at least one occurrence. Movable internals (interno
	// placement, single definition entry) may reach zero — removing every
	// movable internal occurrence is valid authoring, and the normalized
	// echo makes an accidental drop immediately visible. When #384 persisted
	// working copies exist, the stricter #346 tombstone policy takes over.
	for defID, template := range index.entries {
		count := len(grouped[defID])
		movable := !template.agregado && template.placement == string(domain.PlacementInterno) && template.entryCount <= 1
		if count == 0 {
			if movable {
				continue
			}
			*issues = append(*issues, domain.ContractIssue{
				Code:     "SNAPSHOT_INCOMPLETE",
				Message:  fmt.Sprintf("the snapshot omits every occurrence of %s; a full snapshot must keep at least one or remove them through the template's occurrence count", defID),
				Severity: domain.IssueSeverityError, Path: "furniture.components",
				Remediation: "Echo the full occurrence set of the last resolve and express deletions by dropping that occurrence.",
			})
			continue
		}
		if template.entryCount > 1 {
			// Multiple definition entries may carry different formulas and
			// overrides per copy; grouping them under one template would
			// silently honor only the first entry. Fail closed instead.
			*issues = append(*issues, domain.ContractIssue{
				Code:     "OCCURRENCE_COUNT_UNSUPPORTED",
				Message:  fmt.Sprintf("template %s is instantiated by multiple definition entries; its occurrences cannot be authoring-planned", defID),
				Severity: domain.IssueSeverityError, Path: "furniture.components",
				Remediation: "Authoring v1 plans templates backed by exactly one definition entry.",
			})
			continue
		}
		if count != template.defaultCount && !movable {
			*issues = append(*issues, domain.ContractIssue{
				Code:     "OCCURRENCE_COUNT_UNSUPPORTED",
				Message:  fmt.Sprintf("template %s authors %d occurrences, the definition instantiates %d", defID, count, template.defaultCount),
				Severity: domain.IssueSeverityError, Path: "furniture.components",
				Remediation: "v1 lets authoring change the occurrence count of movable internals (interno placement) backed by a single definition entry; agregados and structural templates keep the definition count.",
			})
			continue
		}
	}

	// Deterministic, order-insensitive copy order per template: un-authored
	// occurrences (by ID) take default pose slots, authored ones (by ID)
	// follow with their own translations.
	for defID, group := range grouped {
		unauthored := make([]AuthoringOccurrence, 0, len(group))
		authored := make([]AuthoringOccurrence, 0, len(group))
		for _, occurrence := range group {
			if occurrence.Transform != nil {
				authored = append(authored, occurrence)
			} else {
				unauthored = append(unauthored, occurrence)
			}
		}
		sortByID := func(list []AuthoringOccurrence) {
			sort.Slice(list, func(i, j int) bool { return list[i].ComponentInstanceID < list[j].ComponentInstanceID })
		}
		sortByID(unauthored)
		sortByID(authored)

		copies := make([]plannedCopy, 0, len(unauthored)+len(authored))
		for _, occurrence := range unauthored {
			copies = append(copies, plannedCopy{instanceID: occurrence.ComponentInstanceID})
		}
		for _, occurrence := range authored {
			t := occurrence.Transform.TranslationMm
			copies = append(copies, plannedCopy{instanceID: occurrence.ComponentInstanceID, translation: &t})
		}
		plan.templates[defID] = copies
	}
}

// effectiveManualPlacement pairs an intent with its resolved host board.
type effectiveManualPlacement struct {
	intent AuthoringManualPlacement
	board  *layoutBoard
}

// effectiveManualPlacements computes the complete manual placement set: the
// authored set when present, or the definition defaults materialized as
// intents (with their deterministic server-issued placement IDs).
func effectiveManualPlacements(boards []layoutBoard, authored []AuthoringManualPlacement, present bool, catalog domain.Catalog) ([]effectiveManualPlacement, []domain.ContractIssue) {
	issues := []domain.ContractIssue{}
	boardIndex := make(map[string]*layoutBoard, len(boards))
	for i := range boards {
		boardIndex[boards[i].id] = &boards[i]
	}

	if !present {
		// Materialize the definition defaults: every placement rides a board
		// copy; formula offsets resolve against that board's environment.
		out := make([]effectiveManualPlacement, 0)
		for i := range boards {
			board := &boards[i]
			for hi, hp := range board.hardware {
				intent := AuthoringManualPlacement{
					HardwarePlacementID:     fmt.Sprintf("%s-hw-%d", board.id, hi),
					CatalogHardwareID:       hp.HardwareID,
					HostComponentInstanceID: board.id,
					AnchorFace:              hp.AnchorFace,
					OffsetMm:                resolveFacePlaneOffsets(board, hp),
				}
				out = append(out, effectiveManualPlacement{intent: intent, board: board})
			}
		}
		return out, issues
	}

	out := make([]effectiveManualPlacement, 0, len(authored))
	seen := map[string]bool{}
	for _, intent := range authored {
		path := fmt.Sprintf("furniture.hardwarePlacements[hardwarePlacementId=%s]", intent.HardwarePlacementID)
		if intent.HardwarePlacementID == "" {
			issues = append(issues, domain.ContractIssue{
				Code: "REQUEST_INVALID", Message: "hardwarePlacementId is required",
				Severity: domain.IssueSeverityError, Path: "furniture.hardwarePlacements",
			})
			continue
		}
		if seen[intent.HardwarePlacementID] {
			issues = append(issues, domain.ContractIssue{
				Code:     "REQUEST_INVALID",
				Message:  fmt.Sprintf("hardwarePlacementId %s appears more than once", intent.HardwarePlacementID),
				Severity: domain.IssueSeverityError, EntityID: intent.HardwarePlacementID, Path: path,
			})
			continue
		}
		seen[intent.HardwarePlacementID] = true

		hw, ok := findHardware(catalog, intent.CatalogHardwareID)
		if !ok || !hw.Active {
			issues = append(issues, domain.ContractIssue{
				Code:     "HARDWARE_REFERENCE_INVALID",
				Message:  fmt.Sprintf("catalog hardware %s does not exist or is inactive", intent.CatalogHardwareID),
				Severity: domain.IssueSeverityError, EntityID: intent.HardwarePlacementID, Path: path + ".catalogHardwareId",
				Remediation: "Choose an active hardware definition from the catalog.",
			})
			continue
		}
		board := boardIndex[intent.HostComponentInstanceID]
		if board == nil {
			issues = append(issues, domain.ContractIssue{
				Code:     "HARDWARE_HOST_INVALID",
				Message:  fmt.Sprintf("placement %s hosts on %s which is not part of this snapshot", intent.HardwarePlacementID, intent.HostComponentInstanceID),
				Severity: domain.IssueSeverityError, EntityID: intent.HardwarePlacementID, Path: path + ".hostComponentInstanceId",
				Remediation: "Host the placement on a component instance present in the snapshot.",
			})
			continue
		}
		if !validHardwareAnchorFace(intent.AnchorFace) {
			issues = append(issues, domain.ContractIssue{
				Code:     "HARDWARE_PLACEMENT_INVALID",
				Message:  fmt.Sprintf("placement %s has unknown anchorFace %s", intent.HardwarePlacementID, intent.AnchorFace),
				Severity: domain.IssueSeverityError, EntityID: intent.HardwarePlacementID, Path: path + ".anchorFace",
			})
			continue
		}
		out = append(out, effectiveManualPlacement{intent: intent, board: board})
	}
	return out, issues
}

// validateRelationships checks anchors against the effective occurrence set
// (structural: orphaned anchors reject the request — #477 scenario 7).
func validateRelationships(relationships []AuthoringRelationship, boards []layoutBoard) []domain.ContractIssue {
	issues := []domain.ContractIssue{}
	ids := make(map[string]bool, len(boards))
	for i := range boards {
		ids[boards[i].id] = true
	}
	seen := map[string]bool{}
	for _, relationship := range relationships {
		path := fmt.Sprintf("furniture.relationships[relationshipId=%s]", relationship.RelationshipID)
		if relationship.RelationshipID == "" {
			issues = append(issues, domain.ContractIssue{
				Code: "REQUEST_INVALID", Message: "relationshipId is required",
				Severity: domain.IssueSeverityError, Path: "furniture.relationships",
			})
			continue
		}
		if seen[relationship.RelationshipID] {
			issues = append(issues, domain.ContractIssue{
				Code:     "REQUEST_INVALID",
				Message:  fmt.Sprintf("relationshipId %s appears more than once", relationship.RelationshipID),
				Severity: domain.IssueSeverityError, EntityID: relationship.RelationshipID, Path: path,
			})
			continue
		}
		seen[relationship.RelationshipID] = true

		if relationship.Kind == "" {
			issues = append(issues, domain.ContractIssue{
				Code: "RELATIONSHIP_INVALID", Message: fmt.Sprintf("relationship %s has no kind", relationship.RelationshipID),
				Severity: domain.IssueSeverityError, EntityID: relationship.RelationshipID, Path: path + ".kind",
			})
			continue
		}
		if !ids[relationship.Source.ComponentInstanceID] {
			issues = append(issues, domain.ContractIssue{
				Code:     "RELATIONSHIP_ORPHANED",
				Message:  fmt.Sprintf("anchor references componentInstanceId %s that is not part of this snapshot", relationship.Source.ComponentInstanceID),
				Severity: domain.IssueSeverityError, EntityID: relationship.RelationshipID, Path: path,
				Remediation: "Anchor the relationship to a component instance present in the snapshot.",
			})
			continue
		}
		if len(relationship.Targets) == 0 {
			issues = append(issues, domain.ContractIssue{
				Code:     "RELATIONSHIP_INVALID",
				Message:  fmt.Sprintf("relationship %s has no target anchors", relationship.RelationshipID),
				Severity: domain.IssueSeverityError, EntityID: relationship.RelationshipID, Path: path + ".targets",
			})
			continue
		}
		parameterKeys := make([]string, 0, len(relationship.Parameters))
		for key := range relationship.Parameters {
			parameterKeys = append(parameterKeys, key)
		}
		sort.Strings(parameterKeys)
		for _, key := range parameterKeys {
			value := relationship.Parameters[key]
			valid := false
			switch typed := value.(type) {
			case string, bool:
				valid = true
			case float64:
				valid = !math.IsNaN(typed) && !math.IsInf(typed, 0)
			}
			if !valid {
				issues = append(issues, domain.ContractIssue{
					Code: "RELATIONSHIP_INVALID", Message: fmt.Sprintf("relationship parameter %s must be a finite scalar", key),
					Severity: domain.IssueSeverityError, EntityID: relationship.RelationshipID, Path: path + ".parameters." + key,
				})
			}
		}
		for _, anchor := range relationship.Targets {
			// Every target must resolve: accepting a relationship because at
			// least one target exists would silently drop the invalid rest.
			if !ids[anchor.ComponentInstanceID] {
				issues = append(issues, domain.ContractIssue{
					Code:     "RELATIONSHIP_ORPHANED",
					Message:  fmt.Sprintf("anchor references componentInstanceId %s that is not part of this snapshot", anchor.ComponentInstanceID),
					Severity: domain.IssueSeverityError, EntityID: relationship.RelationshipID, Path: path,
					Remediation: "Anchor the relationship to component instances present in the snapshot.",
				})
			}
		}
	}
	return issues
}

func validHardwareAnchorFace(face string) bool {
	switch face {
	case "front", "back", "left", "right", "top", "bottom":
		return true
	}
	return false
}

// resolveFacePlaneOffsets resolves a definition placement's face-plane
// offsets (mm or formula) against its board environment — the numeric echo
// the normalized snapshot carries.
func resolveFacePlaneOffsets(board *layoutBoard, hp domain.HardwarePlacement) [2]float64 {
	boardEnv := formulaDims{
		W: int(math.Round(board.widthMm)), H: int(math.Round(board.lengthMm)), D: int(math.Round(board.lengthMm)),
		PW: int(math.Round(board.widthMm)), PH: int(math.Round(board.lengthMm)), PD: int(math.Round(board.lengthMm)),
		T: int(math.Round(board.thicknessMm)), HW: int(math.Round(defaultHardwareSizeMm)),
	}
	xMm := hp.RelativePosition.XMm
	if hp.RelativePosition.XFormula != "" {
		if v, err := evaluatePartFormula(hp.RelativePosition.XFormula, boardEnv); err == nil {
			xMm = float64(v)
		}
	}
	yMm := hp.RelativePosition.YMm
	if hp.RelativePosition.YFormula != "" {
		if v, err := evaluatePartFormula(hp.RelativePosition.YFormula, boardEnv); err == nil {
			yMm = float64(v)
		}
	}
	return [2]float64{xMm, yMm}
}

// buildNormalizedIntent echoes the complete effective authoring state with
// server-filled identity fields and transport-rounded millimeters.
func buildNormalizedIntent(input AuthoringResolveInput, layout FurnitureLayout, boards []layoutBoard, placements []effectiveManualPlacement) NormalizedAuthoringIntent {
	parameters := make(map[string]any, len(input.EvaluatedParameters))
	for name, value := range input.EvaluatedParameters {
		parameters[name] = value
	}
	for index, name := range []string{"widthMm", "heightMm", "depthMm"} {
		if _, declared := parameters[name]; declared {
			parameters[name] = layout.DimensionsMm[index]
		}
	}
	choices := map[string]string{}
	for role, material := range input.OptionChoices {
		choices[role] = material
	}

	components := make([]NormalizedAuthoringComponent, 0, len(boards))
	authoredByID := map[string]*[3]float64{}
	if plan := input.Occurrences; plan != nil {
		for _, occurrence := range plan {
			if occurrence.Transform != nil {
				t := occurrence.Transform.TranslationMm
				authoredByID[occurrence.ComponentInstanceID] = &t
			}
		}
	}
	for i := range boards {
		board := &boards[i]
		component := NormalizedAuthoringComponent{
			ComponentInstanceID:   board.id,
			ComponentDefinitionID: board.defID,
			CatalogComponentID:    board.catalogComponentID,
			Role:                  board.optionRole,
		}
		if t, ok := authoredByID[board.id]; ok {
			rounded := &AuthoringOccurrenceTransform{Frame: "assembly"}
			rounded.TranslationMm = [3]float64{
				roundToPrecision(t[0], input.PrecisionMm),
				roundToPrecision(t[1], input.PrecisionMm),
				roundToPrecision(t[2], input.PrecisionMm),
			}
			component.Transform = rounded
		}
		components = append(components, component)
	}

	relationships := make([]AuthoringRelationship, 0, len(input.Relationships))
	relationships = append(relationships, input.Relationships...)

	hardware := make([]AuthoringManualPlacement, 0, len(placements))
	for _, p := range placements {
		intent := p.intent
		intent.OffsetMm = [2]float64{
			roundToPrecision(intent.OffsetMm[0], input.PrecisionMm),
			roundToPrecision(intent.OffsetMm[1], input.PrecisionMm),
		}
		hardware = append(hardware, intent)
	}

	return NormalizedAuthoringIntent{
		Parameters:         parameters,
		MaterialChoices:    choices,
		Components:         components,
		Relationships:      relationships,
		HardwarePlacements: hardware,
	}
}

func roundToPrecision(value, precisionMm float64) float64 {
	if precisionMm <= 0 || math.IsNaN(precisionMm) {
		return value
	}
	// precisionMm is a STEP, not a number of decimal places. This handles
	// non-decimal steps such as 0.25 correctly. The final normalization only
	// removes binary floating-point residue from JSON-visible values.
	snapped := math.Round(value/precisionMm) * precisionMm
	return math.Round(snapped*1e9) / 1e9
}

func validationStatusFor(issues []domain.ContractIssue) string {
	for _, issue := range issues {
		if issue.Severity == domain.IssueSeverityError {
			return AuthoringValidationBlocked
		}
	}
	return AuthoringValidationClear
}
