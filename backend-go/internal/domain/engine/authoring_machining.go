package engine

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// Relationship→machining derivation for the authoring resolve (#477), a
// faithful Go port of the TS #356 resolver
// (packages/domain/src/sketchupRelationshipMachining.ts +
// jointDrillingRules.ts jointFastenerPositions). Parity is pinned by the
// shared contract fixture contracts/sketchupAuthoringResolve.contract.json:
// the TS side recomputes the fingerprint from the same scenario inputs and
// must equal the Go-generated response byte-for-byte on the fingerprint.
//
// Drilling coordinates are RESULTS keyed by provenance: moving a piece
// changes authoring intent, never persisted holes. Geometry comes from the
// resolved boards (server authority), never from client input.

// ShelfSupportJoineryRule mirrors TS ShelfSupportRule (sketchupJoineryCatalog.ts).
type ShelfSupportJoineryRule struct {
	JoinerySystemID string  `json:"joinerySystemId"`
	MinifixCode     string  `json:"minifixCode,omitempty"`
	DowelCode       string  `json:"dowelCode,omitempty"`
	EndMarginMm     float64 `json:"endMarginMm"`
	MaxSpacingMm    float64 `json:"maxSpacingMm"`
	GridMm          float64 `json:"gridMm"`
	WithDowels      bool    `json:"withDowels"`
	CamDiameterMm   float64 `json:"camDiameterMm"`
	CamDepthMm      float64 `json:"camDepthMm"`
	DowelDiameterMm float64 `json:"dowelDiameterMm"`
	DowelDepthMm    float64 `json:"dowelDepthMm"`
	DowelEndDepthMm float64 `json:"dowelEndDepthMm,omitempty"`
}

// ManualMachiningProfile is the versioned TECHNICAL machining rule for a
// manually placed hardware item (contract granete.machining-profile.v1).
// It is keyed by the hardware commercial code — never by preview/visual
// fields: preview geometry belongs to representation, machining truth to a
// versioned rule table. The table ships in the shared contract fixture; both
// runtimes' compiled tables are asserted equal to it by their parity tests.
// When the catalog gains a real MachiningProfile family (post-Gate A), the
// table defers to it.
type ManualMachiningProfile struct {
	ProfileID       string  `json:"profileId"`
	HoleType        string  `json:"holeType"`
	BoardFace       string  `json:"boardFace"`
	PilotDiameterMm float64 `json:"pilotDiameterMm"`
	PilotDepthMm    float64 `json:"pilotDepthMm"`
}

// ManualMachiningProfileContract identifies the versioned rule table.
const ManualMachiningProfileContract = "granete.machining-profile.v1"

// Default joinery systems — Go mirror of the TS defaults
// (DEFAULT_SHELF_SUPPORT_RULE + the dowel-only variant in the #356 fixture).
// They are compiled manufacturing truth, not client input; new systems ship
// as versioned contract data, never as ad-hoc request parameters.
var defaultShelfSupportRule = ShelfSupportJoineryRule{
	JoinerySystemID: "minifix-dowel",
	MinifixCode:     "HER-MIN-15",
	DowelCode:       "HER-TAQ-8X30",
	EndMarginMm:     50,
	MaxSpacingMm:    512,
	GridMm:          32,
	WithDowels:      true,
	CamDiameterMm:   15,
	CamDepthMm:      12.5,
	DowelDiameterMm: 8,
	DowelDepthMm:    12,
	DowelEndDepthMm: 20,
}

var authoringJoinerySystems = map[string]ShelfSupportJoineryRule{
	defaultShelfSupportRule.JoinerySystemID: defaultShelfSupportRule,
	"dowel-only": func() ShelfSupportJoineryRule {
		r := defaultShelfSupportRule
		r.JoinerySystemID = "dowel-only"
		r.MinifixCode = ""
		return r
	}(),
}

var authoringRelationshipKindDefaults = map[string]string{
	"shelf-support": defaultShelfSupportRule.JoinerySystemID,
}

// Versioned manual machining profiles keyed by hardware commercial code.
// Hinges drill their cup; hinge plates drill their fixing pilots; a bar
// pull drills its through mounting pilot. Anything without a profile rides
// the surface and drills nothing (absent profile = no machining, never a
// guessed rule). Cup/pilot values mirror each hardware's catalog machining
// footprint (hardwares.machining) at the placement anchor point.
var authoringManualMachiningProfiles = map[string]ManualMachiningProfile{
	"BIS-CL110":     {ProfileID: "hinge-cup-35", HoleType: "hinge", BoardFace: "front", PilotDiameterMm: 35, PilotDepthMm: 12.5},
	"BIS-CL100":     {ProfileID: "hinge-cup-32", HoleType: "hinge", BoardFace: "front", PilotDiameterMm: 32, PilotDepthMm: 12.5},
	"BIS-BLUM-110":  {ProfileID: "hinge-blum-110-cup", HoleType: "hinge", BoardFace: "front", PilotDiameterMm: 35, PilotDepthMm: 13},
	"HER-PLACA-BIS": {ProfileID: "hinge-plate-pilot-5", HoleType: "screw", BoardFace: "front", PilotDiameterMm: 5, PilotDepthMm: 10},
	"JAL-TUB-SAT":   {ProfileID: "pull-tub-screw-5", HoleType: "screw", BoardFace: "front", PilotDiameterMm: 5, PilotDepthMm: 12},
	"HER-TOR-3X20":  {ProfileID: "screw-pilot-3", HoleType: "screw", BoardFace: "front", PilotDiameterMm: 3, PilotDepthMm: 15},
	"HER-TAQ-8X30":  {ProfileID: "dowel-pilot-8", HoleType: "dowel", BoardFace: "front", PilotDiameterMm: 8, PilotDepthMm: 10},
}

// ResolveHole is one board-local drilling hole of a machining operation
// (TS HoleDefinition parity).
type ResolveHole struct {
	Face       string  `json:"face"`
	XMm        float64 `json:"xMm"`
	YMm        float64 `json:"yMm"`
	DiameterMm float64 `json:"diameterMm"`
	DepthMm    float64 `json:"depthMm"`
	Type       string  `json:"type"`
}

// ResolvedMachiningProvenance carries exactly one source variant
// (relationship | manualHardwarePlacement); the wire shape matches the TS
// discriminated union of the same name. Recipe operations pin the versioned
// technical identity (#874 J2-B): a recipe or profile revision bump moves
// the manufacturing fingerprint even when the geometry is identical.
type ResolvedMachiningProvenance struct {
	SourceKind               string `json:"sourceKind"`
	RelationshipID           string `json:"relationshipId,omitempty"`
	FamilyID                 string `json:"familyId,omitempty"`
	CatalogRuleID            string `json:"catalogRuleId,omitempty"`
	RecipeRevision           string `json:"recipeRevision,omitempty"`
	TechnicalProfileID       string `json:"technicalProfileId,omitempty"`
	TechnicalProfileRevision string `json:"technicalProfileRevision,omitempty"`
	HardwarePlacementID      string `json:"hardwarePlacementId,omitempty"`
}

func (p ResolvedMachiningProvenance) canonical() map[string]any {
	m := map[string]any{"sourceKind": p.SourceKind}
	if p.RelationshipID != "" {
		m["relationshipId"] = p.RelationshipID
	}
	if p.FamilyID != "" {
		m["familyId"] = p.FamilyID
	}
	if p.CatalogRuleID != "" {
		m["catalogRuleId"] = p.CatalogRuleID
	}
	if p.RecipeRevision != "" {
		m["recipeRevision"] = p.RecipeRevision
	}
	if p.TechnicalProfileID != "" {
		m["technicalProfileId"] = p.TechnicalProfileID
	}
	if p.TechnicalProfileRevision != "" {
		m["technicalProfileRevision"] = p.TechnicalProfileRevision
	}
	if p.HardwarePlacementID != "" {
		m["hardwarePlacementId"] = p.HardwarePlacementID
	}
	return m
}

// ResolvedMachiningOperation is one derived machining operation with the
// board-local detail the host piece drills.
type ResolvedMachiningOperation struct {
	OperationID             string                      `json:"operationId"`
	HostComponentInstanceID string                      `json:"hostComponentInstanceId"`
	Provenance              ResolvedMachiningProvenance `json:"provenance"`
	Holes                   []ResolveHole               `json:"holes"`
}

// DerivedHardwarePlacement mirrors the TS type: a hardware placement whose
// existence derives from a relationship/joint rule.
type DerivedHardwarePlacement struct {
	DerivedHardwarePlacementID string `json:"derivedHardwarePlacementId"`
	HostComponentInstanceID    string `json:"hostComponentInstanceId"`
	Provenance                 struct {
		SourceKind     string `json:"sourceKind"`
		RelationshipID string `json:"relationshipId"`
	} `json:"provenance"`
}

// AuthoringMachining is the resolved machining section of the resolve
// response (#477): operations with provenance + the deterministic
// manufacturing fingerprint.
type AuthoringMachining struct {
	Operations                []ResolvedMachiningOperation `json:"operations"`
	DerivedHardwarePlacements []DerivedHardwarePlacement   `json:"derivedHardwarePlacements"`
	// JoineryStatuses carries the J1-B per-relationship resolution states
	// (#874); absent when no joinery-tracked relationship is declared.
	JoineryStatuses []JoineryRelationshipStatus `json:"joineryStatuses,omitempty"`
	// ManufacturingFingerprint covers the FULL manufacturing identity —
	// resolved boards (dimensions + selected materials), manual hardware
	// placements, derived placements and machining operations — so any
	// manufacturing-relevant change (a handle swap, a hardware substitution
	// with identical drilling, a material change) moves it. Parity-pinned
	// against the TS recomputation over the shared fixture.
	ManufacturingFingerprint string `json:"manufacturingFingerprint"`
	// HardwareProfileDemand is the commercial projection of the resolved
	// profiles (#917): catalog hardware ids × per-contact quantities for
	// every VERIFIED productive contact. Derived from the profile
	// resolution (assignments × pinned items) — never from hole
	// geometry — and deliberately OUTSIDE the manufacturing fingerprint
	// (commercial demand is not machining identity). Empty unless the api
	// layer loaded pinned profiles.
	HardwareProfileDemand []HardwareProfileDemandLine `json:"hardwareProfileDemand,omitempty"`
}

// HardwareProfileDemandLine aggregates one catalog hardware's consumption
// across every contact that resolved through its profile. Prices and codes
// are joined from the hardware catalog at consumption time — never carried
// here (#917).
type HardwareProfileDemandLine struct {
	HardwareID string                        `json:"hardwareId"`
	Quantity   float64                       `json:"quantity"`
	Sources    []HardwareProfileDemandSource `json:"sources"`
}

// HardwareProfileDemandSource keeps the diagnostic trail of one demand
// contribution: which profile, at which revision, through which
// relationship, over how many verified contacts and planned stations
// (#1065: the stations are what a fitter actually installs per contact).
type HardwareProfileDemandSource struct {
	TechnicalProfileID       string `json:"technicalProfileId"`
	TechnicalProfileRevision string `json:"technicalProfileRevision"`
	RecipeID                 string `json:"recipeId"`
	RecipeRevision           string `json:"recipeRevision"`
	RelationshipID           string `json:"relationshipId"`
	ContactCount             int    `json:"contactCount"`
	StationCount             int    `json:"stationCount"`
}

// snapValueTo mirrors TS snapValue (hardwarePlacement.ts): grid snapping with
// a safe non-grid fallback.
func snapValueTo(value, step float64) float64 {
	if math.IsNaN(value) {
		return 0
	}
	if math.IsNaN(step) || step <= 0 {
		return math.Round(value*100) / 100
	}
	return math.Round(value/step) * step
}

// jointFastenerPositions mirrors TS jointFastenerPositions
// (jointDrillingRules.ts): first/last at the end margin, intermediates while
// gaps exceed maxSpacing, snapped to the grid; companion dowels keep the
// exact ±grid offset from their minifix.
func jointFastenerPositions(spanMm, endMarginMm, maxSpacingMm, gridMm float64) []float64 {
	if !(spanMm > 0) || math.IsNaN(endMarginMm) || endMarginMm <= 0 {
		return nil
	}
	first := math.Min(endMarginMm, spanMm/2)
	last := spanMm - first
	if last-first < gridMm {
		return []float64{snapValueTo(spanMm/2, gridMm)}
	}
	positions := []float64{first}
	if last-first > maxSpacingMm {
		gaps := int(math.Ceil((last - first) / maxSpacingMm))
		for i := 1; i < gaps; i++ {
			raw := first + (last-first)*float64(i)/float64(gaps)
			snapped := snapValueTo(raw, gridMm)
			if snapped > first+gridMm/2 && snapped < last-gridMm/2 {
				positions = append(positions, snapped)
			}
		}
	}
	positions = append(positions, last)
	return positions
}

// resolveHardwareIDByCode mirrors TS resolveHardwareId: catalog id from a
// commercial code (trim + case-insensitive).
func resolveHardwareIDByCode(hardware []domain.Hardware, code string) string {
	if code == "" {
		return ""
	}
	target := normalizeCode(code)
	for i := range hardware {
		if normalizeCode(hardware[i].Code) == target {
			return hardware[i].ID
		}
	}
	return ""
}

func normalizeCode(s string) string {
	return strings.ToLower(strings.TrimSpace(s))
}

// effectivePlacementForMachining pairs a manual placement intent with its
// resolved host board.
type effectivePlacementForMachining struct {
	intent AuthoringManualPlacement
	board  *layoutBoard
}

// deriveAuthoringMachining derives machining operations from relationship
// intents and the effective manual placement set over the RESOLVED boards.
// Structural reference problems are expected to be caught by validation;
// derivation re-checks defensively and reports manufacturing-domain issues
// (which block preflight instead of rejecting the request).
// FamilyTechnicalProfile is the explicit technical data one operation family
// needs to emit real machining (#874 J2-A.2).
//
// TEST-ONLY SEAM — NOT the industrial recipe model. This struct exists so
// engine tests can drive the family→operation frontier end to end while the
// real versioned recipe contract (per-participant/face rules, technical
// profile id+revision, offsets, axes, entry faces, multi-operation fixings —
// the ContactOperationRecipe shape) is not yet wired to the productive
// resolver. Production NEVER supplies a resolver: without verified profiles
// the relationship stays at TECHNICAL_PROFILE_REQUIRED with zero
// operations. J2-B/J3 must consume the real recipe model — do NOT extend
// this struct with industrial semantics.
type FamilyTechnicalProfile struct {
	ProfileID  string
	DiameterMm float64
	DepthMm    float64
	HoleType   string
}

// FamilyProfileResolver maps (relationship kind, familyId) to a technical
// profile. nil or a nil result means "no verified profile".
type FamilyProfileResolver func(kind, familyID string) *FamilyTechnicalProfile

func deriveAuthoringMachining(
	boards []layoutBoard,
	relationships []AuthoringRelationship,
	placements []effectivePlacementForMachining,
	catalog domain.Catalog,
	familyProfiles FamilyProfileResolver,
	// #1219: the factory construction policy — the system ladder's factory
	// rung. nil = every family inherits.
	policy *FactoryConstructionPolicy,
) (AuthoringMachining, []domain.ContractIssue) {
	issues := []domain.ContractIssue{}
	operations := []ResolvedMachiningOperation{}
	derived := []DerivedHardwarePlacement{}
	joineryStatuses := []JoineryRelationshipStatus{}

	boardIndex := make(map[string]*layoutBoard, len(boards))
	for i := range boards {
		boardIndex[boards[i].id] = &boards[i]
	}
	componentsByID := make(map[string]*domain.Component, len(catalog.Components))
	for i := range catalog.Components {
		componentsByID[catalog.Components[i].ID] = &catalog.Components[i]
	}
	ladder := joinerySystemLadderInput{
		boardIndex:     boardIndex,
		componentsByID: componentsByID,
		policy:         policy,
		kindDefaults:   authoringRelationshipKindDefaults,
	}

	for _, relationship := range relationships {
		// #1219: a declared connection capacity gates the relationship's
		// anchors BEFORE any derivation — the component's construction block
		// is a physical statement about where it can be joined.
		if anchorRole, face, violated := connectionFaceViolation(relationship, ladder); violated {
			issues = append(issues, domain.ContractIssue{
				Code: "CONNECTION_FACE_INVALID",
				Message: fmt.Sprintf("el ancla %q declara la cara %q fuera de las caras de unión declaradas por su componente",
					anchorRole, face),
				Severity:  domain.IssueSeverityError,
				EntityID:  relationship.RelationshipID,
				Path:      fmt.Sprintf("furniture.relationships[relationshipId=%s]", relationship.RelationshipID),
				Remediation: "Declara la cara en el componente o ancla la relación en una cara que el componente admita.",
				Details:   map[string]any{"anchorRole": anchorRole, "face": face},
			})
			joineryStatuses = append(joineryStatuses, JoineryRelationshipStatus{
				RelationshipID: relationship.RelationshipID, Kind: relationship.Kind,
				Stage:    JoineryRelationshipUnsupported,
				Contacts: []JoineryContactStatus{},
				Stations: JoineryStationPlanStatus{Status: "NOT_PLANNED", IssueCodes: []string{},
					StationCounts: []JoineryStationPlanCount{}, StationDistances: []JoineryStationDistances{}},
				Blockers: []string{"CONNECTION_FACE_INVALID"},
			})
			continue
		}
		if relationship.Kind == "floor-side" {
			joineryStatuses = append(joineryStatuses, deriveFloorSideJoinery(relationship, boardIndex, &issues, familyProfiles, &operations))
			continue
		}
		if relationship.Kind == "fixed-shelf-side" || relationship.Kind == "back-panel" {
			// #874 J1: the back panel joins through the SAME edge-face
			// contact class (its left/right edges meet the sides' inner
			// faces, its bottom/top edges meet the floor/top strips), so
			// verification, station planning and recipes ride the shared
			// panel-joint derivation with its own kind identity.
			joineryStatuses = append(joineryStatuses, deriveFixedShelfJoinery(relationship, boardIndex, &issues, &operations))
			continue
		}
		deriveRelationshipOperations(relationship, boardIndex, catalog, ladder, &derived, &operations, &issues, &joineryStatuses)
	}
	for _, placement := range placements {
		deriveManualPlacementMachining(placement, catalog, &operations, &issues)
	}

	detectHoleCollisions(operations, &issues)
	joineryStatuses = reconcileJoineryStatusesWithCollisions(joineryStatuses, operations, issues)

	return AuthoringMachining{
		Operations:                operations,
		DerivedHardwarePlacements: derived,
		JoineryStatuses:           joineryStatuses,
	}, issues
}

func deriveRelationshipOperations(
	relationship AuthoringRelationship,
	boardIndex map[string]*layoutBoard,
	catalog domain.Catalog,
	ladder joinerySystemLadderInput,
	derived *[]DerivedHardwarePlacement,
	operations *[]ResolvedMachiningOperation,
	issues *[]domain.ContractIssue,
	joineryStatuses *[]JoineryRelationshipStatus,
) {
	path := fmt.Sprintf("furniture.relationships[relationshipId=%s]", relationship.RelationshipID)
	addIssue := func(code, message, remediation string, details map[string]any) {
		*issues = append(*issues, domain.ContractIssue{
			Code: code, Message: message, Severity: domain.IssueSeverityError,
			EntityID: relationship.RelationshipID, Path: path, Remediation: remediation, Details: details,
		})
	}

	if relationship.Kind != "shelf-support" {
		addIssue("RELATIONSHIP_INVALID",
			fmt.Sprintf("no rule registered for relationship kind %s", relationship.Kind),
			"Use a relationship kind the manufacturing catalog resolves (v1: shelf-support).", nil)
		*joineryStatuses = append(*joineryStatuses, JoineryRelationshipStatus{
			RelationshipID: relationship.RelationshipID, Kind: relationship.Kind,
			Stage:    JoineryRelationshipUnsupported,
			Contacts: []JoineryContactStatus{},
			Stations: JoineryStationPlanStatus{Status: "NOT_PLANNED", IssueCodes: []string{},
				StationCounts: []JoineryStationPlanCount{}, StationDistances: []JoineryStationDistances{}},
			Blockers: []string{"RELATIONSHIP_INVALID"},
		})
		return
	}

	// #1219: the four-rung system ladder — authored relationship > source
	// component > factory family > kind default.
	systemID := resolveJoinerySystem(relationship, ladder)
	if systemID == "" {
		addIssue("JOINERY_SYSTEM_UNSUPPORTED",
			fmt.Sprintf("no joinery system for kind %s", relationship.Kind),
			"Register a default joinery system for this relationship kind in the catalog.", nil)
		return
	}
	rule, ok := authoringJoinerySystems[systemID]
	if !ok {
		addIssue("JOINERY_SYSTEM_UNSUPPORTED",
			fmt.Sprintf("unknown joinery system %s", systemID),
			"Request a joinery system that exists in the active catalog.", nil)
		return
	}

	source := boardIndex[relationship.Source.ComponentInstanceID]
	if source == nil {
		addIssue("RELATIONSHIP_ORPHANED",
			fmt.Sprintf("anchor references componentInstanceId %s that is not part of this snapshot", relationship.Source.ComponentInstanceID),
			"Anchor the relationship to a component instance present in the snapshot.", nil)
		return
	}

	targets := make([]*layoutBoard, 0, len(relationship.Targets))
	for _, anchor := range relationship.Targets {
		if board := boardIndex[anchor.ComponentInstanceID]; board != nil {
			targets = append(targets, board)
		}
	}
	if len(targets) == 0 {
		addIssue("RELATIONSHIP_ORPHANED",
			fmt.Sprintf("anchor references componentInstanceId %s that is not part of this snapshot", relationship.Source.ComponentInstanceID),
			"Anchor the relationship to a component instance present in the snapshot.", nil)
		return
	}
	targetGeometry := targets[0]

	// Shelf height in the assembly frame (z-up): authoring intent, the only
	// driver of where derived holes land on the sides.
	shelfZ := source.z
	sideLength := targetGeometry.lengthMm
	if shelfZ <= 0 || shelfZ >= sideLength {
		addIssue("RELATIONSHIP_INVALID",
			fmt.Sprintf("shelf at z=%.2fmm is outside the side panel height %.2fmm", shelfZ, sideLength),
			"Move the shelf so its height lies strictly inside the side panel span.",
			map[string]any{"shelfZ": shelfZ, "sideLength": sideLength})
		return
	}

	positions := jointFastenerPositions(source.widthMm, rule.EndMarginMm, rule.MaxSpacingMm, rule.GridMm)
	if len(positions) == 0 {
		addIssue("RELATIONSHIP_INVALID",
			"shelf depth cannot host any fastener under the current rule",
			"Widen the shelf beyond twice the end margin or relax the joinery rule spacing.", nil)
		return
	}

	opIndex := 0
	nextOpID := func() string {
		opIndex++
		return fmt.Sprintf("%s:op-%d", relationship.RelationshipID, opIndex)
	}
	pushOperation := func(opID string, board *layoutBoard, holes []ResolveHole) {
		*operations = append(*operations, ResolvedMachiningOperation{
			OperationID:             opID,
			HostComponentInstanceID: board.id,
			Provenance: ResolvedMachiningProvenance{
				SourceKind:     "relationship",
				RelationshipID: relationship.RelationshipID,
				CatalogRuleID:  systemID,
			},
			Holes: holes,
		})
	}
	pushPlacement := func(id string, board *layoutBoard) {
		dhp := DerivedHardwarePlacement{
			DerivedHardwarePlacementID: id,
			HostComponentInstanceID:    board.id,
		}
		dhp.Provenance.SourceKind = "relationship"
		dhp.Provenance.RelationshipID = relationship.RelationshipID
		*derived = append(*derived, dhp)
	}

	minifixID := resolveHardwareIDByCode(catalog.Hardware, rule.MinifixCode)
	dowelID := resolveHardwareIDByCode(catalog.Hardware, rule.DowelCode)

	// Side panels: cams (and companion dowels) on the inside face at shelf height.
	for _, board := range targets {
		if minifixID != "" {
			holes := make([]ResolveHole, 0, len(positions))
			for _, x := range positions {
				holes = append(holes, ResolveHole{
					Face: "front", XMm: x, YMm: shelfZ,
					DiameterMm: rule.CamDiameterMm, DepthMm: rule.CamDepthMm, Type: "minifix",
				})
			}
			pushOperation(nextOpID(), board, holes)
			pushPlacement(fmt.Sprintf("%s:dhp-side-%s", relationship.RelationshipID, board.id), board)
		}
		if rule.WithDowels && dowelID != "" {
			holes := []ResolveHole{}
			for _, x := range positions {
				for _, offset := range [2]float64{-rule.GridMm, rule.GridMm} {
					dowelX := x + offset
					if dowelX > 0 && dowelX < targetGeometry.widthMm {
						holes = append(holes, ResolveHole{
							Face: "front", XMm: dowelX, YMm: shelfZ,
							DiameterMm: rule.DowelDiameterMm, DepthMm: rule.DowelDepthMm, Type: "dowel",
						})
					}
				}
			}
			pushOperation(nextOpID(), board, holes)
			pushPlacement(fmt.Sprintf("%s:dhp-dowel-%s", relationship.RelationshipID, board.id), board)
		}
	}

	// Shelf ends: bolts and dowels along the shelf's length-axis end faces.
	// Length-axis ends are the board-local bottom/top faces (the face plane
	// is width×thickness, matching xMm=position and yMm=half-thickness; TS
	// F129 uses the same pair) — left/right would place the holes outside
	// the resolved board under the #414 local-basis frame (#470 3D proof).
	shelfEndHoles := []ResolveHole{}
	halfThickness := source.thicknessMm / 2
	for _, x := range positions {
		for _, face := range [2]string{"bottom", "top"} {
			if minifixID != "" {
				shelfEndHoles = append(shelfEndHoles, ResolveHole{
					Face: face, XMm: x, YMm: halfThickness,
					DiameterMm: rule.CamDiameterMm, DepthMm: rule.CamDepthMm, Type: "minifix",
				})
			}
			if rule.WithDowels && dowelID != "" {
				for _, offset := range [2]float64{-rule.GridMm, rule.GridMm} {
					dowelX := x + offset
					if dowelX > 0 && dowelX < source.widthMm {
						shelfEndHoles = append(shelfEndHoles, ResolveHole{
							Face: face, XMm: dowelX, YMm: halfThickness,
							DiameterMm: rule.DowelDiameterMm, DepthMm: rule.DowelEndDepthMm, Type: "dowel",
						})
					}
				}
			}
		}
	}
	if len(shelfEndHoles) > 0 {
		pushOperation(nextOpID(), source, shelfEndHoles)
		if minifixID != "" {
			pushPlacement(fmt.Sprintf("%s:dhp-shelf-%s", relationship.RelationshipID, source.id), source)
		}
	}
}

func deriveManualPlacementMachining(
	placement effectivePlacementForMachining,
	catalog domain.Catalog,
	operations *[]ResolvedMachiningOperation,
	issues *[]domain.ContractIssue,
) {
	hw, ok := findHardware(catalog, placement.intent.CatalogHardwareID)
	if !ok || !hw.Active {
		// Structural: validation must have caught this; skip defensively.
		return
	}
	profile, ok := authoringManualMachiningProfiles[hw.Code]
	if !ok {
		// Hardware that rides the surface (pulls, knobs, slides) drills
		// nothing: an absent TECHNICAL profile never becomes a guessed rule.
		return
	}

	// The hole enters through the PLACEMENT's anchor face (TS parity: the
	// resolver derives targetFace from placement.anchorFace, not from the
	// profile) — a screw placed on a board edge drills that edge. The
	// profile face is only the fallback for intents without an anchor.
	holeFace := placement.intent.AnchorFace
	if holeFace == "" {
		holeFace = profile.BoardFace
	}
	holes := []ResolveHole{{
		Face:       holeFace,
		XMm:        placement.intent.OffsetMm[0],
		YMm:        placement.intent.OffsetMm[1],
		DiameterMm: profile.PilotDiameterMm,
		DepthMm:    profile.PilotDepthMm,
		Type:       profile.HoleType,
	}}
	*operations = append(*operations, ResolvedMachiningOperation{
		OperationID:             fmt.Sprintf("%s:op-1", placement.intent.HardwarePlacementID),
		HostComponentInstanceID: placement.intent.HostComponentInstanceID,
		Provenance: ResolvedMachiningProvenance{
			SourceKind:          "manualHardwarePlacement",
			HardwarePlacementID: placement.intent.HardwarePlacementID,
		},
		Holes: holes,
	})

	// Compatibility (#477 scenario 6): a pilot deeper than the host board's
	// effective thickness cannot be drilled — block the resolve validation,
	// keep the operation visible with its provenance.
	if profile.PilotDepthMm > placement.board.thicknessMm {
		*issues = append(*issues, domain.ContractIssue{
			Code:        "DRILLING_CONFLICT",
			Message:     fmt.Sprintf("hardware %s pilots %.2fmm deep into a %.2fmm host board", hw.Code, profile.PilotDepthMm, placement.board.thicknessMm),
			Severity:    domain.IssueSeverityError,
			EntityID:    placement.intent.HardwarePlacementID,
			Path:        fmt.Sprintf("furniture.hardwarePlacements[hardwarePlacementId=%s]", placement.intent.HardwarePlacementID),
			Remediation: "Choose a hardware definition whose pilot fits the host board, or a thicker board for that role.",
			Details: map[string]any{
				"profileId":       profile.ProfileID,
				"pilotDepthMm":    profile.PilotDepthMm,
				"hostThicknessMm": placement.board.thicknessMm,
			},
		})
	}
}

// authoringManufacturingFingerprint hashes the FULL manufacturing identity of
// a resolved authoring state: boards (occurrence identity + dimensions +
// selected material), manual hardware placements, derived placements and
// machining operations, canonicalized with sorted keys so Go and TS derive
// the same string from the same fixture. Swapping a handle, substituting
// hardware with identical drilling or changing a material all move it.
func authoringManufacturingFingerprint(
	layout FurnitureLayout,
	boards []layoutBoard,
	placements []effectivePlacementForMachining,
	derived []DerivedHardwarePlacement,
	operations []ResolvedMachiningOperation,
	joineryStatuses []JoineryRelationshipStatus,
) string {
	catalogComponentByBoard := make(map[string]string, len(boards))
	for i := range boards {
		catalogComponentByBoard[boards[i].id] = boards[i].catalogComponentID
	}

	boardBodies := make([]any, 0, len(layout.Components))
	for _, component := range layout.Components {
		body := map[string]any{
			"id":          component.ComponentInstanceID,
			"defId":       component.ComponentDefinitionID,
			"role":        component.Role,
			"lengthMm":    component.LengthMm,
			"widthMm":     component.WidthMm,
			"thicknessMm": component.ThicknessMm,
		}
		if catalogComponent := catalogComponentByBoard[component.ComponentInstanceID]; catalogComponent != "" {
			body["catalogComponentId"] = catalogComponent
		}
		if component.MaterialID != "" {
			body["materialId"] = component.MaterialID
		}
		boardBodies = append(boardBodies, map[string]any{
			"sort": component.ComponentInstanceID, "body": body,
		})
	}

	placementBodies := make([]any, 0, len(placements))
	for _, placement := range placements {
		intent := placement.intent
		placementBodies = append(placementBodies, map[string]any{
			"sort": intent.HardwarePlacementID,
			"body": map[string]any{
				"id":         intent.HardwarePlacementID,
				"hardwareId": intent.CatalogHardwareID,
				"host":       intent.HostComponentInstanceID,
				"anchorFace": intent.AnchorFace,
				"offsetMm":   [2]float64{intent.OffsetMm[0], intent.OffsetMm[1]},
			},
		})
	}

	placementCanonical := make([]any, 0, len(derived))
	for _, d := range derived {
		placementCanonical = append(placementCanonical, map[string]any{
			"sort": d.DerivedHardwarePlacementID,
			"body": map[string]any{
				"id":   d.DerivedHardwarePlacementID,
				"host": d.HostComponentInstanceID,
				"prov": map[string]any{
					"sourceKind":     d.Provenance.SourceKind,
					"relationshipId": d.Provenance.RelationshipID,
				},
			},
		})
	}

	operationCanonical := make([]any, 0, len(operations))
	for _, o := range operations {
		holes := make([]any, 0, len(o.Holes))
		for _, h := range o.Holes {
			holes = append(holes, map[string]any{
				"face": h.Face, "xMm": h.XMm, "yMm": h.YMm,
				"diameterMm": h.DiameterMm, "depthMm": h.DepthMm, "type": h.Type,
			})
		}
		operationCanonical = append(operationCanonical, map[string]any{
			"sort": o.OperationID,
			"body": map[string]any{
				"id":    o.OperationID,
				"host":  o.HostComponentInstanceID,
				"prov":  o.Provenance.canonical(),
				"holes": holes,
			},
		})
	}

	// Joinery states join the manufacturing identity only when a J1-tracked
	// relationship exists, so their absence leaves every stored fingerprint
	// byte-identical (release continuity). RELATIONSHIP_UNSUPPORTED bodies
	// carry no manufacturing semantics (pure error echo) and stay out.
	// Bodies are map trees (not structs) and every list is keyed by
	// contactId, so both runtimes marshal identical bytes and the DECLARED
	// target order never moves the manufacturing identity.
	joineryBodies := make([]any, 0, len(joineryStatuses))
	for _, status := range joineryStatuses {
		if status.Stage == JoineryRelationshipUnsupported {
			continue
		}
		contacts := append([]JoineryContactStatus(nil), status.Contacts...)
		sort.Slice(contacts, func(i, j int) bool { return contacts[i].ContactID < contacts[j].ContactID })
		contactBodies := make([]any, 0, len(contacts))
		for _, contact := range contacts {
			issueCodes := contact.IssueCodes
			if issueCodes == nil {
				issueCodes = []string{}
			}
			contactBodies = append(contactBodies, map[string]any{
				"contactId": contact.ContactID, "status": contact.Status, "issueCodes": issueCodes,
			})
		}
		counts := append([]JoineryStationPlanCount(nil), status.Stations.StationCounts...)
		sort.Slice(counts, func(i, j int) bool { return counts[i].ContactID < counts[j].ContactID })
		countBodies := make([]any, 0, len(counts))
		for _, count := range counts {
			countBodies = append(countBodies, map[string]any{
				"contactId": count.ContactID, "stationCount": count.StationCount,
			})
		}
		distances := append([]JoineryStationDistances(nil), status.Stations.StationDistances...)
		sort.Slice(distances, func(i, j int) bool { return distances[i].ContactID < distances[j].ContactID })
		distanceBodies := make([]any, 0, len(distances))
		for _, distance := range distances {
			values := distance.DistancesMm
			if values == nil {
				values = []float64{}
			}
			distanceBodies = append(distanceBodies, map[string]any{
				"contactId": distance.ContactID, "distancesMm": values,
			})
		}
		stationIssueCodes := status.Stations.IssueCodes
		if stationIssueCodes == nil {
			stationIssueCodes = []string{}
		}
		blockers := status.Blockers
		if blockers == nil {
			blockers = []string{}
		}
		stationsBody := map[string]any{
			"status":           status.Stations.Status,
			"issueCodes":       stationIssueCodes,
			"stationCounts":    countBodies,
			"stationDistances": distanceBodies,
		}
		// Family plans join the hashed body only when declared (#874 J2-A):
		// absence keeps every existing fingerprint byte-identical.
		if len(status.Stations.FamilyPlans) > 0 {
			familyPlans := append([]JoineryFamilyPlan(nil), status.Stations.FamilyPlans...)
			sort.Slice(familyPlans, func(i, j int) bool { return familyPlans[i].FamilyID < familyPlans[j].FamilyID })
			familyBodies := make([]any, 0, len(familyPlans))
			for _, plan := range familyPlans {
				planCounts := append([]JoineryStationPlanCount(nil), plan.StationCounts...)
				sort.Slice(planCounts, func(i, j int) bool { return planCounts[i].ContactID < planCounts[j].ContactID })
				planCountBodies := make([]any, 0, len(planCounts))
				for _, count := range planCounts {
					planCountBodies = append(planCountBodies, map[string]any{
						"contactId": count.ContactID, "stationCount": count.StationCount,
					})
				}
				planDistances := append([]JoineryStationDistances(nil), plan.StationDistances...)
				sort.Slice(planDistances, func(i, j int) bool { return planDistances[i].ContactID < planDistances[j].ContactID })
				planDistanceBodies := make([]any, 0, len(planDistances))
				for _, distance := range planDistances {
					values := distance.DistancesMm
					if values == nil {
						values = []float64{}
					}
					planDistanceBodies = append(planDistanceBodies, map[string]any{
						"contactId": distance.ContactID, "distancesMm": values,
					})
				}
				familyBodies = append(familyBodies, map[string]any{
					"familyId":         plan.FamilyID,
					"stationCounts":    planCountBodies,
					"stationDistances": planDistanceBodies,
				})
			}
			stationsBody["familyPlans"] = familyBodies
		}
		joineryBodies = append(joineryBodies, map[string]any{
			"sort": status.RelationshipID,
			"body": map[string]any{
				"relationshipId": status.RelationshipID,
				"kind":           status.Kind,
				"stage":          status.Stage,
				"contacts":       contactBodies,
				"stations":       stationsBody,
				"blockers":       blockers,
			},
		})
	}
	return fingerprintBodiesHash(boardBodies, placementBodies, placementCanonical, operationCanonical, joineryBodies)
}

// fingerprintBodiesHash marshals the sorted canonical bodies and hashes them.
// map[string]any trees marshal with sorted keys and JS-compatible number
// formatting, matching the TS canonicalize byte-for-byte on the fixture.
func fingerprintBodiesHash(boardBodies, placementBodies, placementCanonical, operationCanonical, joineryBodies []any) string {
	canonical := map[string]any{
		"boards":                    sortedBodies(boardBodies),
		"manualPlacements":          sortedBodies(placementBodies),
		"derivedHardwarePlacements": sortedBodies(placementCanonical),
		"operations":                sortedBodies(operationCanonical),
	}
	if len(joineryBodies) > 0 {
		canonical["joineryStatuses"] = sortedBodies(joineryBodies)
	}
	raw, err := json.Marshal(canonical)
	if err != nil {
		return "sha256-unavailable"
	}
	sum := sha256.Sum256(raw)
	return fmt.Sprintf("sha256-%x", sum)
}

// sortedBodies strips the sort wrappers in ascending id order.
func sortedBodies(entries []any) []any {
	sort.SliceStable(entries, func(i, j int) bool {
		return entries[i].(map[string]any)["sort"].(string) < entries[j].(map[string]any)["sort"].(string)
	})
	out := make([]any, 0, len(entries))
	for _, entry := range entries {
		out = append(out, entry.(map[string]any)["body"])
	}
	return out
}

// AuthoringIndustrialRulesRevision pins every compiled industrial rule that
// can affect an authoring resolve. The workshop catalog revision incorporates
// this value, so a deploy that changes drilling or joinery truth invalidates
// old request pins instead of producing a different result under the same
// catalogRevision.
func AuthoringIndustrialRulesRevision() string {
	payload := struct {
		JoinerySystems    map[string]ShelfSupportJoineryRule `json:"joinerySystems"`
		RelationshipKinds map[string]string                  `json:"relationshipKinds"`
		MachiningProfiles map[string]ManualMachiningProfile  `json:"machiningProfiles"`
		ProfileContract   string                             `json:"machiningProfileContract"`
	}{
		JoinerySystems:    authoringJoinerySystems,
		RelationshipKinds: authoringRelationshipKindDefaults,
		MachiningProfiles: authoringManualMachiningProfiles,
		ProfileContract:   ManualMachiningProfileContract,
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return "sha256-unavailable"
	}
	sum := sha256.Sum256(raw)
	return fmt.Sprintf("sha256-%x", sum)
}

// AuthoringManualMachiningProfiles returns the versioned manual machining
// table keyed by hardware commercial code (copy). The shared contract
// fixture ships this table and the parity tests assert both runtimes match
// it — one technical rule set, no parallel copies.
func AuthoringManualMachiningProfiles() map[string]ManualMachiningProfile {
	out := make(map[string]ManualMachiningProfile, len(authoringManualMachiningProfiles))
	for code, profile := range authoringManualMachiningProfiles {
		out[code] = profile
	}
	return out
}

// AuthoringJoinerySystems returns the compiled joinery systems (copy) for
// the shared contract fixture.
func AuthoringJoinerySystems() map[string]ShelfSupportJoineryRule {
	out := make(map[string]ShelfSupportJoineryRule, len(authoringJoinerySystems))
	for id, rule := range authoringJoinerySystems {
		out[id] = rule
	}
	return out
}

// detectHoleCollisions checks for physical overlap between hole pairs on the same host board face
// (parity with TS sketchupPreflight §5 and sketchupHardwareSync).
func detectHoleCollisions(operations []ResolvedMachiningOperation, issues *[]domain.ContractIssue) {
	for _, collision := range findHoleCollisions(operations) {
		*issues = append(*issues, *collision)
	}
}

// firstHoleCollision reports the first hole collision, if any — the
// relationship-scoped probe used before a joint may declare MACHINING_READY.
func firstHoleCollision(operations []ResolvedMachiningOperation) *domain.ContractIssue {
	if collisions := findHoleCollisions(operations); len(collisions) > 0 {
		return collisions[0]
	}
	return nil
}

// findHoleCollisions returns every pair of same-host same-face holes whose
// centers sit closer than the sum of their radii (#874 joint collisions are
// structured errors).
func findHoleCollisions(operations []ResolvedMachiningOperation) []*domain.ContractIssue {
	type holeWithOp struct {
		hostID      string
		operationID string
		hole        ResolveHole
	}
	collisions := []*domain.ContractIssue{}
	byHost := make(map[string][]holeWithOp)
	for _, op := range operations {
		for _, hole := range op.Holes {
			byHost[op.HostComponentInstanceID] = append(byHost[op.HostComponentInstanceID], holeWithOp{
				hostID:      op.HostComponentInstanceID,
				operationID: op.OperationID,
				hole:        hole,
			})
		}
	}
	for hostID, holes := range byHost {
		for i := 0; i < len(holes); i++ {
			for j := i + 1; j < len(holes); j++ {
				h1 := holes[i].hole
				h2 := holes[j].hole
				if h1.Face != h2.Face {
					continue
				}
				dist := math.Hypot(h1.XMm-h2.XMm, h1.YMm-h2.YMm)
				minDist := (h1.DiameterMm + h2.DiameterMm) / 2
				if dist < minDist {
					collision := domain.ContractIssue{
						Code:        "DRILLING_CONFLICT",
						Message:     fmt.Sprintf("Hole collision on host %s (%s Ø%.1f at [%.1f, %.1f] collides with %s Ø%.1f at [%.1f, %.1f])", hostID, h1.Type, h1.DiameterMm, h1.XMm, h1.YMm, h2.Type, h2.DiameterMm, h2.XMm, h2.YMm),
						Severity:    domain.IssueSeverityError,
						EntityID:    hostID,
						Path:        fmt.Sprintf("resolved.machining.operations[host=%s]", hostID),
						Remediation: "Shift conflicting shelf position or hardware offset to ensure minimum clearance.",
						Details: map[string]any{
							"hostComponentInstanceId": hostID,
							"operationId1":            holes[i].operationID,
							"operationId2":            holes[j].operationID,
							"distanceMm":              dist,
							"minDistanceMm":           minDist,
						},
					}
					collisions = append(collisions, &collision)
				}
			}
		}
	}
	return collisions
}

// reconcileJoineryStatusesWithCollisions degrades every MACHINING_READY
// status whose operations appear in a DRILLING_CONFLICT: the relationship
// state may never claim readiness while the machining result is blocked
// (#874). The conflicting operations stay in the global stream (the issue
// is the truth); only the readiness claim is corrected.
func reconcileJoineryStatusesWithCollisions(statuses []JoineryRelationshipStatus, operations []ResolvedMachiningOperation, issues []domain.ContractIssue) []JoineryRelationshipStatus {
	conflicted := map[string]bool{}
	for _, issue := range issues {
		if issue.Code != "DRILLING_CONFLICT" {
			continue
		}
		details := issue.Details
		if details == nil {
			continue
		}
		for _, key := range []string{"operationId1", "operationId2"} {
			id, _ := details[key].(string)
			for _, op := range operations {
				if op.OperationID == id && op.Provenance.SourceKind == "relationship" {
					conflicted[op.Provenance.RelationshipID] = true
				}
			}
		}
	}
	if len(conflicted) == 0 {
		return statuses
	}
	// Deep copy before degrading: the caller's statuses — including their
	// inner slices — stay untouched (appending to a shared backing array
	// would silently write through).
	degraded := make([]JoineryRelationshipStatus, len(statuses))
	for i := range statuses {
		blockers := make([]string, len(statuses[i].Blockers))
		copy(blockers, statuses[i].Blockers)
		issueCodes := make([]string, len(statuses[i].Stations.IssueCodes))
		copy(issueCodes, statuses[i].Stations.IssueCodes)
		stations := statuses[i].Stations
		stations.IssueCodes = issueCodes
		degraded[i] = statuses[i]
		degraded[i].Blockers = blockers
		degraded[i].Stations = stations
	}
	for i := range degraded {
		if degraded[i].Stage != JoineryMachiningReady || !conflicted[degraded[i].RelationshipID] {
			continue
		}
		degraded[i].Stage = JoineryMachiningInvalid
		degraded[i].Blockers = append(degraded[i].Blockers, "DRILLING_CONFLICT")
		degraded[i].Stations.IssueCodes = append(degraded[i].Stations.IssueCodes, "DRILLING_CONFLICT")
	}
	return degraded
}

// J1-A0a contact resolution stays with the #356 authoring machining owner.
// Productive relationship resolution does not select or invoke it yet.
type ContactBoard struct {
	// OccurrenceID identifies one concrete board, never a component definition.
	OccurrenceID string      `json:"occurrenceId"`
	WidthMm      float64     `json:"widthMm"`
	ThicknessMm  float64     `json:"thicknessMm"`
	LengthMm     float64     `json:"lengthMm"`
	Translation  [3]float64  `json:"translationMm"`
	Basis        LayoutBasis `json:"basis"`
}

type ExplicitContact struct {
	RelationshipID string `json:"relationshipId"`
	ContactID      string `json:"contactId"`
	ParticipantA   string `json:"participantA"`
	ParticipantB   string `json:"participantB"`
	FaceA          string `json:"faceA"`
	FaceB          string `json:"faceB"`
}

type ResolvedContact struct {
	ExplicitContact
	Frame struct {
		OriginAssemblyMm [3]float64 `json:"originAssemblyMm"`
		AxisAssembly     [3]float64 `json:"axisAssembly"`
		NormalAssembly   [3]float64 `json:"normalAssembly"`
	} `json:"frame"`
	// OverlapMm is measured from the frame origin along its axis.
	OverlapMm [2]float64 `json:"overlapMm"`
}

type ContactResolutionResult struct {
	Contacts []ResolvedContact      `json:"contacts"`
	Issues   []domain.ContractIssue `json:"issues"`
}

func contactAdd(a, b [3]float64, n float64) [3]float64 {
	return [3]float64{a[0] + n*b[0], a[1] + n*b[1], a[2] + n*b[2]}
}
func contactDelta(a, b [3]float64) [3]float64 {
	return [3]float64{a[0] - b[0], a[1] - b[1], a[2] - b[2]}
}
func (b ContactBoard) valid() bool {
	if b.WidthMm <= 0 || b.ThicknessMm <= 0 || b.LengthMm <= 0 ||
		!isFiniteVec3(b.Translation) || math.IsNaN(b.WidthMm) || math.IsInf(b.WidthMm, 0) ||
		math.IsNaN(b.ThicknessMm) || math.IsInf(b.ThicknessMm, 0) ||
		math.IsNaN(b.LengthMm) || math.IsInf(b.LengthMm, 0) {
		return false
	}
	return validateLayoutBasis(b.Basis) == nil
}
func (b ContactBoard) toAssembly(p [3]float64) [3]float64 {
	return contactAdd(contactAdd(contactAdd(b.Translation, b.Basis.X, p[0]), b.Basis.Y, p[1]), b.Basis.Z, p[2])
}
func (b ContactBoard) surface(face string) ([][3]float64, [3]float64) {
	dims := [3]float64{b.WidthMm, b.ThicknessMm, b.LengthMm}
	axes := [3][3]float64{b.Basis.X, b.Basis.Y, b.Basis.Z}
	axis, high := 2, face == "top"
	if face == "left" || face == "right" {
		axis, high = 0, face == "right"
	}
	if face == "front" || face == "back" {
		axis, high = 1, face == "front"
	}
	other := []int{}
	for i := 0; i < 3; i++ {
		if i != axis {
			other = append(other, i)
		}
	}
	corners := make([][3]float64, 4)
	for i := range corners {
		var local [3]float64
		if high {
			local[axis] = dims[axis]
		}
		if i&1 != 0 {
			local[other[0]] = dims[other[0]]
		}
		if i&2 != 0 {
			local[other[1]] = dims[other[1]]
		}
		corners[i] = b.toAssembly(local)
	}
	if !high {
		return corners, negVec3(axes[axis])
	}
	return corners, axes[axis]
}

// resolveExplicitContacts validates only declared occurrence contacts and
// returns their directed frames and useful overlaps for A0b station planning.
func resolveExplicitContacts(boards []ContactBoard, intents []ExplicitContact, required []string) ContactResolutionResult {
	result := ContactResolutionResult{Contacts: []ResolvedContact{}, Issues: []domain.ContractIssue{}}
	byID := map[string]ContactBoard{}
	counts := map[string]int{}
	for _, board := range boards {
		byID[board.OccurrenceID] = board
		counts[board.OccurrenceID]++
	}
	fail := func(id, code string) {
		result.Issues = append(result.Issues, domain.ContractIssue{Code: code, Message: code,
			Severity: domain.IssueSeverityError, EntityID: id})
	}
	for _, id := range required {
		found := false
		for _, intent := range intents {
			if intent.ContactID == id {
				found = true
			}
		}
		if !found {
			fail(id, "CONTACT_REQUIRED_MISSING")
		}
	}
	ordered := append([]ExplicitContact(nil), intents...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].ContactID < ordered[j].ContactID })
	contactCounts := map[string]int{}
	for _, intent := range intents {
		contactCounts[intent.ContactID]++
	}
	seen := map[string]bool{}
	for _, intent := range ordered {
		if seen[intent.ContactID] {
			continue
		}
		seen[intent.ContactID] = true
		if contactCounts[intent.ContactID] > 1 {
			fail(intent.ContactID, "CONTACT_AMBIGUOUS")
			continue
		}
		if strings.TrimSpace(intent.ContactID) == "" || strings.TrimSpace(intent.RelationshipID) == "" ||
			strings.TrimSpace(intent.ParticipantA) == "" || strings.TrimSpace(intent.ParticipantB) == "" {
			fail(intent.ContactID, "CONTACT_IDENTITY_INVALID")
			continue
		}
		a, aOK := byID[intent.ParticipantA]
		b, bOK := byID[intent.ParticipantB]
		if !aOK || !bOK || a.OccurrenceID == b.OccurrenceID {
			fail(intent.ContactID, "CONTACT_PARTICIPANT_MISSING")
			continue
		}
		if counts[a.OccurrenceID] != 1 || counts[b.OccurrenceID] != 1 {
			fail(intent.ContactID, "CONTACT_AMBIGUOUS")
			continue
		}
		if !a.valid() || !b.valid() {
			fail(intent.ContactID, "CONTACT_FRAME_INVALID")
			continue
		}
		// Two verified contact classes (#874 J2): participant A meets
		// participant B through B's thickness face either with A's
		// length-axis END face (floor/shelf edges) or — the back-panel class
		// — with A's width-axis EDGE face (a vertical panel's left/right
		// edge against the sides' inner faces). Anything else stays
		// CONTACT_FACE_INCOMPATIBLE: the vocabulary is closed, never grown
		// by proximity.
		faceAlongLength := intent.FaceA == "bottom" || intent.FaceA == "top"
		faceAlongWidth := intent.FaceA == "left" || intent.FaceA == "right"
		if (!faceAlongLength && !faceAlongWidth) || (intent.FaceB != "front" && intent.FaceB != "back") {
			fail(intent.ContactID, "CONTACT_FACE_INCOMPATIBLE")
			continue
		}
		ac, an := a.surface(intent.FaceA)
		bc, bn := b.surface(intent.FaceB)
		if math.Abs(dot3(an, bn)+1) > 1e-6 || math.Abs(dot3(contactDelta(ac[0], bc[0]), an)) > 1e-6 {
			fail(intent.ContactID, "CONTACT_FACE_INCOMPATIBLE")
			continue
		}
		var spanAxis, crossAxis [3]float64
		if faceAlongLength {
			// Two source orientations: a HORIZONTAL source (floor/shelf)
			// runs its width parallel to B's width with its thickness along
			// B's length; a VERTICAL source (#874 back-panel) runs its width
			// along B's length with its thickness along B's width. Either
			// way the span is A's width axis — the run the stations follow.
			horizontalSource := math.Abs(math.Abs(dot3(a.Basis.X, b.Basis.X))-1) <= 1e-6 &&
				math.Abs(math.Abs(dot3(a.Basis.Y, b.Basis.Z))-1) <= 1e-6
			verticalSource := math.Abs(math.Abs(dot3(a.Basis.X, b.Basis.Z))-1) <= 1e-6 &&
				math.Abs(math.Abs(dot3(a.Basis.Y, b.Basis.X))-1) <= 1e-6
			if !horizontalSource && !verticalSource {
				fail(intent.ContactID, "CONTACT_FACE_INCOMPATIBLE")
				continue
			}
			spanAxis, crossAxis = a.Basis.X, a.Basis.Y
		} else {
			// A's thickness strip is parallel to B's width; the two panels
			// stand along the same length axis.
			if math.Abs(math.Abs(dot3(a.Basis.Y, b.Basis.X))-1) > 1e-6 ||
				math.Abs(math.Abs(dot3(a.Basis.Z, b.Basis.Z))-1) > 1e-6 {
				fail(intent.ContactID, "CONTACT_FACE_INCOMPATIBLE")
				continue
			}
			spanAxis, crossAxis = a.Basis.Z, a.Basis.Y
		}
		overlap := func(direction [3]float64) (float64, float64) {
			alo, ahi, blo, bhi := math.Inf(1), math.Inf(-1), math.Inf(1), math.Inf(-1)
			for _, p := range ac {
				v := dot3(p, direction)
				alo = math.Min(alo, v)
				ahi = math.Max(ahi, v)
			}
			for _, p := range bc {
				v := dot3(p, direction)
				blo = math.Min(blo, v)
				bhi = math.Max(bhi, v)
			}
			return math.Max(alo, blo), math.Min(ahi, bhi)
		}
		start, end := overlap(spanAxis)
		crossStart, crossEnd := overlap(crossAxis)
		if end-start <= 1e-6 || crossEnd-crossStart <= 1e-6 {
			fail(intent.ContactID, "CONTACT_NO_OVERLAP")
			continue
		}
		origin := contactAdd(contactAdd(ac[0], spanAxis, start-dot3(ac[0], spanAxis)),
			crossAxis, (crossStart+crossEnd)/2-dot3(ac[0], crossAxis))
		resolved := ResolvedContact{ExplicitContact: intent, OverlapMm: [2]float64{0, end - start}}
		resolved.Frame.OriginAssemblyMm, resolved.Frame.AxisAssembly, resolved.Frame.NormalAssembly = origin, spanAxis, an
		result.Contacts = append(result.Contacts, resolved)
	}
	return result
}

// StationSpec is neutral policy; one station needs an explicit anchor not supplied here.
type StationSpec struct {
	ContactID     string  `json:"contactId"`
	Count         int     `json:"count"`
	StartMarginMm float64 `json:"startMarginMm"`
	EndMarginMm   float64 `json:"endMarginMm"`
	// MaxSpacingMm derives Count from each contact's usable span
	// (#1065): count = floor(usable/maxSpacing)+1, minimum 2. Zero means
	// the explicit Count governs; both set is a spec error.
	MaxSpacingMm float64 `json:"maxSpacingMm,omitempty"`
}

type ContactStation struct {
	DistanceMm          float64    `json:"distanceMm"`
	AssemblyPointMm     [3]float64 `json:"assemblyPointMm"`
	ParticipantALocalMm [3]float64 `json:"participantALocalMm"`
	ParticipantBLocalMm [3]float64 `json:"participantBLocalMm"`
}

type StationPlan struct {
	ContactID string           `json:"contactId"`
	Stations  []ContactStation `json:"stations"`
}

type StationPlanResult struct {
	Plans  []StationPlan          `json:"plans"`
	Issues []domain.ContractIssue `json:"issues"`
}

func (b ContactBoard) toLocal(point [3]float64) [3]float64 {
	delta := contactDelta(point, b.Translation)
	return [3]float64{dot3(delta, b.Basis.X), dot3(delta, b.Basis.Y), dot3(delta, b.Basis.Z)}
}

// planResolvedContactStations plans once in the declared contact frame, then
// inverts each assembly point into both concrete occurrence-local frames.
func planResolvedContactStations(resolution ContactResolutionResult, boards []ContactBoard, specs []StationSpec) StationPlanResult {
	result := StationPlanResult{Plans: []StationPlan{}, Issues: []domain.ContractIssue{}}
	if len(resolution.Issues) != 0 {
		result.Issues = resolution.Issues
		return result
	}
	fail := func(id, code string) {
		result.Issues = append(result.Issues, domain.ContractIssue{Code: code, Message: code,
			Severity: domain.IssueSeverityError, EntityID: id})
	}
	boardCounts := map[string]int{}
	boardByID := map[string]ContactBoard{}
	for _, board := range boards {
		boardCounts[board.OccurrenceID]++
		boardByID[board.OccurrenceID] = board
	}
	specCounts := map[string]int{}
	specByID := map[string]StationSpec{}
	for _, spec := range specs {
		specCounts[spec.ContactID]++
		specByID[spec.ContactID] = spec
	}
	contactCounts := map[string]int{}
	for _, contact := range resolution.Contacts {
		contactCounts[contact.ContactID]++
	}
	for _, spec := range specs {
		if contactCounts[spec.ContactID] == 0 {
			fail(spec.ContactID, "STATION_CONTACT_UNKNOWN")
		}
	}
	contacts := append([]ResolvedContact(nil), resolution.Contacts...)
	sort.Slice(contacts, func(i, j int) bool { return contacts[i].ContactID < contacts[j].ContactID })
	for _, contact := range contacts {
		id := contact.ContactID
		if contactCounts[id] != 1 {
			fail(id, "STATION_CONTACT_AMBIGUOUS")
			continue
		}
		if specCounts[id] == 0 {
			fail(id, "STATION_SPEC_MISSING")
			continue
		}
		if specCounts[id] != 1 {
			fail(id, "STATION_SPEC_AMBIGUOUS")
			continue
		}
		spec := specByID[id]
		if spec.Count != 0 && spec.MaxSpacingMm > 0 {
			fail(id, "STATION_PATTERN_INVALID")
			continue
		}
		if math.IsNaN(spec.StartMarginMm) || math.IsInf(spec.StartMarginMm, 0) || spec.StartMarginMm < 0 ||
			math.IsNaN(spec.EndMarginMm) || math.IsInf(spec.EndMarginMm, 0) || spec.EndMarginMm < 0 {
			fail(id, "STATION_MARGIN_INVALID")
			continue
		}
		lo, hi := contact.OverlapMm[0], contact.OverlapMm[1]
		if spec.MaxSpacingMm > 0 {
			// Spacing-driven count (#1065): derive from THIS contact's
			// usable span, so the furniture's dimensions scale the
			// fastener count. Fail-closed on a degenerate span or spacing.
			if math.IsNaN(spec.MaxSpacingMm) || math.IsInf(spec.MaxSpacingMm, 0) {
				fail(id, "STATION_PATTERN_INVALID")
				continue
			}
			first, last := lo+spec.StartMarginMm, hi-spec.EndMarginMm
			if first >= last {
				fail(id, "STATION_SPAN_INVALID")
				continue
			}
			spec.Count = int(math.Floor((last-first)/spec.MaxSpacingMm)) + 1
			if spec.Count < 2 {
				spec.Count = 2
			}
		}
		if spec.Count < 2 {
			fail(id, "STATION_COUNT_INVALID")
			continue
		}
		origin, axis, normal := contact.Frame.OriginAssemblyMm, contact.Frame.AxisAssembly, contact.Frame.NormalAssembly
		if math.IsNaN(lo) || math.IsInf(lo, 0) || math.IsNaN(hi) || math.IsInf(hi, 0) || lo != 0 || hi <= 0 ||
			!isFiniteVec3(origin) || !isFiniteVec3(axis) || !isFiniteVec3(normal) ||
			math.Abs(dot3(axis, axis)-1) > 1e-6 || math.Abs(dot3(normal, normal)-1) > 1e-6 ||
			math.Abs(dot3(axis, normal)) > 1e-6 {
			fail(id, "STATION_FRAME_INVALID")
			continue
		}
		first, last := lo+spec.StartMarginMm, hi-spec.EndMarginMm
		if math.IsNaN(first) || math.IsInf(first, 0) || math.IsNaN(last) || math.IsInf(last, 0) ||
			first >= last || first < lo || last > hi {
			fail(id, "STATION_SPAN_INVALID")
			continue
		}
		a, aOK := boardByID[contact.ParticipantA]
		b, bOK := boardByID[contact.ParticipantB]
		if !aOK || !bOK || a.OccurrenceID == b.OccurrenceID || boardCounts[a.OccurrenceID] != 1 ||
			boardCounts[b.OccurrenceID] != 1 || !a.valid() || !b.valid() {
			fail(id, "STATION_PARTICIPANT_INVALID")
			continue
		}
		plan := StationPlan{ContactID: id, Stations: []ContactStation{}}
		for index := 0; index < spec.Count; index++ {
			distance := first + float64(index)*(last-first)/float64(spec.Count-1)
			if index == spec.Count-1 {
				distance = last
			}
			point := contactAdd(origin, axis, distance)
			localA, localB := a.toLocal(point), b.toLocal(point)
			validPoint := func(board ContactBoard, local [3]float64) bool {
				dims := [3]float64{board.WidthMm, board.ThicknessMm, board.LengthMm}
				if !isFiniteVec3(local) {
					return false
				}
				for i, value := range local {
					if value < -1e-6 || value > dims[i]+1e-6 {
						return false
					}
				}
				for _, delta := range contactDelta(board.toAssembly(local), point) {
					if math.Abs(delta) > 1e-6 {
						return false
					}
				}
				return true
			}
			if math.IsNaN(distance) || math.IsInf(distance, 0) || distance < lo || distance > hi ||
				!validPoint(a, localA) || !validPoint(b, localB) {
				fail(id, "STATION_POINT_INVALID")
				break
			}
			plan.Stations = append(plan.Stations, ContactStation{DistanceMm: distance,
				AssemblyPointMm: point, ParticipantALocalMm: localA, ParticipantBLocalMm: localB})
		}
		if len(plan.Stations) == spec.Count {
			result.Plans = append(result.Plans, plan)
		}
	}
	if len(result.Issues) != 0 {
		result.Plans = []StationPlan{}
	}
	return result
}
