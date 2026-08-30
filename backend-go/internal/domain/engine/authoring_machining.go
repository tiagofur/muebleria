package engine

import (
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
// Hinges drill a pilot; pulls/knobs/slides ride the surface and drill
// nothing (absent profile = no machining, never a guessed rule).
var authoringManualMachiningProfiles = map[string]ManualMachiningProfile{
	"BIS-CL110": {ProfileID: "hinge-cup-35", HoleType: "hinge", BoardFace: "front", PilotDiameterMm: 35, PilotDepthMm: 12.5},
	"BIS-CL100": {ProfileID: "hinge-cup-32", HoleType: "hinge", BoardFace: "front", PilotDiameterMm: 32, PilotDepthMm: 12.5},
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
// discriminated union of the same name.
type ResolvedMachiningProvenance struct {
	SourceKind          string `json:"sourceKind"`
	RelationshipID      string `json:"relationshipId,omitempty"`
	CatalogRuleID       string `json:"catalogRuleId,omitempty"`
	HardwarePlacementID string `json:"hardwarePlacementId,omitempty"`
}

func (p ResolvedMachiningProvenance) canonical() map[string]any {
	m := map[string]any{"sourceKind": p.SourceKind}
	if p.RelationshipID != "" {
		m["relationshipId"] = p.RelationshipID
	}
	if p.CatalogRuleID != "" {
		m["catalogRuleId"] = p.CatalogRuleID
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
	// ManufacturingFingerprint covers the FULL manufacturing identity —
	// resolved boards (dimensions + selected materials), manual hardware
	// placements, derived placements and machining operations — so any
	// manufacturing-relevant change (a handle swap, a hardware substitution
	// with identical drilling, a material change) moves it. Parity-pinned
	// against the TS recomputation over the shared fixture.
	ManufacturingFingerprint string `json:"manufacturingFingerprint"`
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
func deriveAuthoringMachining(
	boards []layoutBoard,
	relationships []AuthoringRelationship,
	placements []effectivePlacementForMachining,
	catalog domain.Catalog,
) (AuthoringMachining, []domain.ContractIssue) {
	issues := []domain.ContractIssue{}
	operations := []ResolvedMachiningOperation{}
	derived := []DerivedHardwarePlacement{}

	boardIndex := make(map[string]*layoutBoard, len(boards))
	for i := range boards {
		boardIndex[boards[i].id] = &boards[i]
	}

	for _, relationship := range relationships {
		deriveRelationshipOperations(relationship, boardIndex, catalog, &derived, &operations, &issues)
	}
	for _, placement := range placements {
		deriveManualPlacementMachining(placement, catalog, &operations, &issues)
	}

	return AuthoringMachining{
		Operations:                operations,
		DerivedHardwarePlacements: derived,
	}, issues
}

func deriveRelationshipOperations(
	relationship AuthoringRelationship,
	boardIndex map[string]*layoutBoard,
	catalog domain.Catalog,
	derived *[]DerivedHardwarePlacement,
	operations *[]ResolvedMachiningOperation,
	issues *[]domain.ContractIssue,
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
		return
	}

	systemID := relationship.JoinerySystemID
	if systemID == "" {
		systemID = authoringRelationshipKindDefaults[relationship.Kind]
	}
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
	shelfEndHoles := []ResolveHole{}
	halfThickness := source.thicknessMm / 2
	for _, x := range positions {
		for _, face := range [2]string{"left", "right"} {
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

	holes := []ResolveHole{{
		Face:       profile.BoardFace,
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

	return fingerprintBodiesHash(boardBodies, placementBodies, placementCanonical, operationCanonical)
}

// fingerprintBodiesHash marshals the sorted canonical bodies and hashes them.
// map[string]any trees marshal with sorted keys and JS-compatible number
// formatting, matching the TS canonicalize byte-for-byte on the fixture.
func fingerprintBodiesHash(boardBodies, placementBodies, placementCanonical, operationCanonical []any) string {
	canonical := map[string]any{
		"boards":                    sortedBodies(boardBodies),
		"manualPlacements":          sortedBodies(placementBodies),
		"derivedHardwarePlacements": sortedBodies(placementCanonical),
		"operations":                sortedBodies(operationCanonical),
	}
	raw, err := json.Marshal(canonical)
	if err != nil {
		return "fnv1a-unavailable"
	}
	return fnv1aHex(string(raw))
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

// fnv1aHex ports the TS fnv1aHex (32-bit FNV-1a over UTF-16 code units —
// byte-equal for the ASCII identifiers the contract carries).
func fnv1aHex(value string) string {
	var h uint32 = 0x811c9dc5
	for i := 0; i < len(value); i++ {
		h ^= uint32(value[i])
		h *= 0x01000193
	}
	return fmt.Sprintf("fnv1a-%08x", h)
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
