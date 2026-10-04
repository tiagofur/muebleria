package engine

import (
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

type j2FixedShelfFixture struct {
	Boards             []ContactBoard               `json:"boards"`
	Relationship       AuthoringRelationship        `json:"relationship"`
	ExpectedStatus     JoineryRelationshipStatus    `json:"expectedStatus"`
	ExpectedOperations []ResolvedMachiningOperation `json:"expectedOperations"`
}

func readJ2FixedShelfFixture(t *testing.T) j2FixedShelfFixture {
	t.Helper()
	raw, err := os.ReadFile("../../../../contracts/j2FixedShelfOperations.contract.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture j2FixedShelfFixture
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	return fixture
}

// TestJ2FixedShelfFixtureOperations proves the pure J2-B derivation against
// the SHARED contract fixture with hand-computed expectations (both runtimes
// consume the same file): 2 contacts × 2 participants × 2 rules × 3 stations
// collapse into four productive operations with stable identity and holes.
func TestJ2FixedShelfFixtureOperations(t *testing.T) {
	fixture := readJ2FixedShelfFixture(t)
	var collected []domain.ContractIssue
	var operations []ResolvedMachiningOperation
	status := deriveFixedShelfOperations(fixture.Relationship, fixture.Boards, &collected, &operations)
	if len(collected) != 0 {
		t.Fatalf("issues = %+v", collected)
	}
	if !reflect.DeepEqual(status, fixture.ExpectedStatus) {
		t.Fatalf("status mismatch:\ngot  %+v\nwant %+v", status, fixture.ExpectedStatus)
	}
	if len(operations) != len(fixture.ExpectedOperations) {
		t.Fatalf("operations = %d, want %d: %+v", len(operations), len(fixture.ExpectedOperations), operations)
	}
	for index := range operations {
		if !reflect.DeepEqual(operations[index], fixture.ExpectedOperations[index]) {
			t.Fatalf("operation %d mismatch:\ngot  %+v\nwant %+v", index, operations[index], fixture.ExpectedOperations[index])
		}
	}
}

// j2ShelfBoards extends the pinned j1b cabinet with a fixed shelf: the floor
// board's orientation translated to z=400 (sides' inner faces are X-planes,
// so the contact topology is height-invariant).
func j2ShelfBoards() map[string]*layoutBoard {
	boards := j1bBoards()
	boards["shelf"] = &layoutBoard{id: "shelf", widthMm: 570, thicknessMm: 18, lengthMm: 564, x: 18, z: 400, rotY: -90}
	return boards
}

// j2ShelfRelationship is the authored fixed-shelf-side relationship over the
// j1b cabinet with the versioned per-contact recipes. The shelf meets
// side-left through its TOP end face and side-right through its BOTTOM end
// face; the sides are counterbored from their OUTER faces (side-left front,
// side-right back) — the pinned j1b bases decide the concrete face names.
func j2ShelfRelationship() AuthoringRelationship {
	recipe := func(contactID, pilotFace, counterboreFace string) ContactOperationRecipe {
		return ContactOperationRecipe{
			ContactID: contactID, RecipeID: "test:synthetic-fixed-shelf", RecipeRevision: "test-1",
			TechnicalProfileID: "test:synthetic-shelf-profile", TechnicalProfileRevision: "test-1",
			Rules: []ContactOperationRule{
				{RuleID: "pilot", RuleRevision: "test-1", ParticipantRole: "A", OperationRole: "pilot",
					EntryFace: pilotFace, OffsetMm: [3]float64{0, 0, 0}, Axis: [3]float64{0, -1, 0}, DiameterMm: 3, DepthMm: 12},
				{RuleID: "counterbore", RuleRevision: "test-1", ParticipantRole: "B", OperationRole: "counterbore",
					EntryFace: counterboreFace, OffsetMm: [3]float64{0, 18, 0}, Axis: [3]float64{0, -1, 0}, DiameterMm: 6, DepthMm: 9},
			},
		}
	}
	return AuthoringRelationship{
		RelationshipID: "rel-fixed-shelf-01",
		Kind:           "fixed-shelf-side",
		Source:         AuthoringRelationshipAnchor{ComponentInstanceID: "shelf", Role: "shelf-edge"},
		Targets: []AuthoringRelationshipAnchor{
			{ComponentInstanceID: "side-left", Role: "inside-face", Face: "back"},
			{ComponentInstanceID: "side-right", Role: "inside-face", Face: "front"},
		},
		Parameters: map[string]any{"stationCount": float64(3), "startMarginMm": float64(40), "endMarginMm": float64(40)},
		Recipes: []ContactOperationRecipe{
			recipe("rel-fixed-shelf-01:side-left", "top", "front"),
			recipe("rel-fixed-shelf-01:side-right", "bottom", "back"),
		},
	}
}

func operationsByRelationship(operations []ResolvedMachiningOperation, relationshipID string) []ResolvedMachiningOperation {
	out := []ResolvedMachiningOperation{}
	for _, operation := range operations {
		if operation.Provenance.RelationshipID == relationshipID {
			out = append(out, operation)
		}
	}
	return out
}

// TestJ2FixedShelfMutationsIsolateFloorSide proves the four mutation
// semantics over the productive resolver (#874 acceptance): add/move/delete/
// duplicate change ONLY the shelf's own contacts, stations and operations —
// the coexisting floor-side machining (families + profiles, READY) stays
// byte-identical through every mutation.
func TestJ2FixedShelfMutationsIsolateFloorSide(t *testing.T) {
	floorRelationship := j1bRelationship()
	floorRelationship.Parameters = nil
	floorRelationship.Families = floorSideFamilies()
	shelfRelationship := func() AuthoringRelationship { return j2ShelfRelationship() }
	resolve := func(boards map[string]*layoutBoard, relationships []AuthoringRelationship) AuthoringMachining {
		machining, _ := deriveAuthoringMachining(boardMapValues(boards), relationships, nil, domain.Catalog{}, syntheticProfiles())
		return machining
	}
	floorOps := func(machining AuthoringMachining) []ResolvedMachiningOperation {
		return operationsByRelationship(machining.Operations, "rel-floor-sides-01")
	}
	shelfOps := func(machining AuthoringMachining) []ResolvedMachiningOperation {
		return operationsByRelationship(machining.Operations, "rel-fixed-shelf-01")
	}

	// Baseline: floor-side READY (8 operations) + fixed shelf READY (4).
	base := resolve(j2ShelfBoards(), []AuthoringRelationship{floorRelationship, shelfRelationship()})
	if len(floorOps(base)) != 8 {
		t.Fatalf("floor-side operations = %d, want 8", len(floorOps(base)))
	}
	baselineShelf := shelfOps(base)
	baselineFloor := floorOps(base)
	if len(baselineShelf) != 4 {
		t.Fatalf("shelf operations = %d, want 4: %+v", len(baselineShelf), baselineShelf)
	}
	for _, status := range base.JoineryStatuses {
		if status.Stage != JoineryMachiningReady {
			t.Fatalf("relationship %s stage = %s, want MACHINING_READY", status.RelationshipID, status.Stage)
		}
	}
	// The shelf's own machining is board-local: 3 holes per operation.
	for _, operation := range baselineShelf {
		if len(operation.Holes) != 3 {
			t.Fatalf("operation %s holes = %d, want 3", operation.OperationID, len(operation.Holes))
		}
	}

	// ADD: without the shelf the floor-side result is byte-identical.
	before := resolve(j1bBoards(), []AuthoringRelationship{floorRelationship})
	if !reflect.DeepEqual(floorOps(before), baselineFloor) {
		t.Fatalf("adding the shelf changed floor-side machining")
	}

	// MOVE (z 400→500): only the shelf's dependent machining changes. The
	// shelf's own operations keep byte-identical holes (local invariance);
	// the sides' counterbores move with the shelf; the floor-side stays.
	movedBoards := j2ShelfBoards()
	movedBoards["shelf"].z = 500
	moved := resolve(movedBoards, []AuthoringRelationship{floorRelationship, shelfRelationship()})
	if !reflect.DeepEqual(floorOps(moved), baselineFloor) {
		t.Fatalf("moving the shelf changed floor-side machining")
	}
	movedShelf := shelfOps(moved)
	if len(movedShelf) != 4 {
		t.Fatalf("moved shelf operations = %d, want 4", len(movedShelf))
	}
	for _, operation := range movedShelf {
		if operation.HostComponentInstanceID == "shelf" {
			baseline := operationsByID(baselineShelf, operation.OperationID)
			if baseline == nil || !reflect.DeepEqual(operation.Holes, baseline.Holes) {
				t.Fatalf("shelf-local operation %s changed under rigid translation: %+v", operation.OperationID, operation.Holes)
			}
		} else {
			baseline := operationsByID(baselineShelf, operation.OperationID)
			if baseline != nil && reflect.DeepEqual(operation.Holes, baseline.Holes) {
				t.Fatalf("side operation %s did not move with the shelf", operation.OperationID)
			}
		}
	}
	// The sides' holes sit at the shelf's new mid-thickness height (509mm).
	for _, operation := range movedShelf {
		if operation.HostComponentInstanceID != "shelf" && len(operation.Holes) > 0 && operation.Holes[0].YMm != 509 {
			t.Fatalf("side hole height = %v, want 509", operation.Holes[0].YMm)
		}
	}

	// DELETE: the shelf's occurrences and operations vanish; floor-side stays.
	deleted := resolve(j1bBoards(), []AuthoringRelationship{floorRelationship})
	if len(operationsByRelationship(deleted.Operations, "rel-fixed-shelf-01")) != 0 {
		t.Fatalf("deleted shelf left operations behind")
	}
	if !reflect.DeepEqual(floorOps(deleted), baselineFloor) {
		t.Fatalf("deleting the shelf changed floor-side machining")
	}

	// DUPLICATE: a second shelf occurrence gets its own relationship with
	// independent contact IDs and provenance; the floor-side stays.
	duplicate := j2ShelfRelationship()
	duplicate.RelationshipID = "rel-fixed-shelf-02"
	duplicate.Recipes = []ContactOperationRecipe{
		{ContactID: "rel-fixed-shelf-02:side-left", RecipeID: "test:synthetic-fixed-shelf", RecipeRevision: "test-1",
			TechnicalProfileID: "test:synthetic-shelf-profile", TechnicalProfileRevision: "test-1",
			Rules: []ContactOperationRule{
				{RuleID: "pilot", RuleRevision: "test-1", ParticipantRole: "A", OperationRole: "pilot",
					EntryFace: "top", OffsetMm: [3]float64{0, 0, 0}, Axis: [3]float64{0, -1, 0}, DiameterMm: 3, DepthMm: 12},
				{RuleID: "counterbore", RuleRevision: "test-1", ParticipantRole: "B", OperationRole: "counterbore",
					EntryFace: "front", OffsetMm: [3]float64{0, 18, 0}, Axis: [3]float64{0, -1, 0}, DiameterMm: 6, DepthMm: 9},
			}},
		{ContactID: "rel-fixed-shelf-02:side-right", RecipeID: "test:synthetic-fixed-shelf", RecipeRevision: "test-1",
			TechnicalProfileID: "test:synthetic-shelf-profile", TechnicalProfileRevision: "test-1",
			Rules: []ContactOperationRule{
				{RuleID: "pilot", RuleRevision: "test-1", ParticipantRole: "A", OperationRole: "pilot",
					EntryFace: "bottom", OffsetMm: [3]float64{0, 0, 0}, Axis: [3]float64{0, -1, 0}, DiameterMm: 3, DepthMm: 12},
				{RuleID: "counterbore", RuleRevision: "test-1", ParticipantRole: "B", OperationRole: "counterbore",
					EntryFace: "back", OffsetMm: [3]float64{0, 18, 0}, Axis: [3]float64{0, -1, 0}, DiameterMm: 6, DepthMm: 9},
			}},
	}
	duplicatedBoards := j2ShelfBoards()
	duplicatedBoards["shelf-2"] = &layoutBoard{id: "shelf-2", widthMm: 570, thicknessMm: 18, lengthMm: 564, x: 18, z: 430, rotY: -90}
	duplicate.Source.ComponentInstanceID = "shelf-2"
	duplicated := resolve(duplicatedBoards, []AuthoringRelationship{floorRelationship, shelfRelationship(), duplicate})
	if !reflect.DeepEqual(floorOps(duplicated), baselineFloor) {
		t.Fatalf("duplicating the shelf changed floor-side machining")
	}
	if !reflect.DeepEqual(operationsByRelationship(duplicated.Operations, "rel-fixed-shelf-01"), baselineShelf) {
		t.Fatalf("duplicating the shelf changed the first shelf's machining")
	}
	second := operationsByRelationship(duplicated.Operations, "rel-fixed-shelf-02")
	if len(second) != 4 {
		t.Fatalf("duplicate shelf operations = %d, want 4", len(second))
	}
	for _, operation := range second {
		if operation.Provenance.RelationshipID != "rel-fixed-shelf-02" {
			t.Fatalf("duplicate operation provenance = %+v", operation.Provenance)
		}
	}

	// REORDER: reversed targets and reversed relationship order produce the
	// same operations and statuses (identity is keyed, never positional).
	reorderedShelf := j2ShelfRelationship()
	reorderedShelf.Targets = []AuthoringRelationshipAnchor{
		{ComponentInstanceID: "side-right", Role: "inside-face", Face: "front"},
		{ComponentInstanceID: "side-left", Role: "inside-face", Face: "back"},
	}
	reordered := resolve(j2ShelfBoards(), []AuthoringRelationship{reorderedShelf, floorRelationship})
	if !reflect.DeepEqual(floorOps(reordered), baselineFloor) {
		t.Fatalf("reordering changed floor-side machining")
	}
	if !equalOperationSets(shelfOps(reordered), baselineShelf) {
		t.Fatalf("reordering changed the shelf machining set")
	}
}

func operationsByID(operations []ResolvedMachiningOperation, operationID string) *ResolvedMachiningOperation {
	for index := range operations {
		if operations[index].OperationID == operationID {
			return &operations[index]
		}
	}
	return nil
}

func equalOperationSets(a, b []ResolvedMachiningOperation) bool {
	if len(a) != len(b) {
		return false
	}
	index := map[string]ResolvedMachiningOperation{}
	for _, operation := range a {
		index[operation.OperationID] = operation
	}
	for _, operation := range b {
		other, found := index[operation.OperationID]
		if !found || !reflect.DeepEqual(operation, other) {
			return false
		}
	}
	return true
}

// boardMapValues converts the board map to the slice the resolver consumes.
func boardMapValues(boards map[string]*layoutBoard) []layoutBoard {
	out := make([]layoutBoard, 0, len(boards))
	for _, board := range boards {
		out = append(out, *board)
	}
	return out
}

// TestJ2FixedShelfNegatives proves the fail-closed paths: no recipe keeps
// the honest terminal; a recipe that does not fit fails the WHOLE
// relationship with zero operations; structural recipe defects surface the
// A1a/A1b codes as blockers.
func TestJ2FixedShelfNegatives(t *testing.T) {
	terminal := func(t *testing.T) {
		t.Helper()
		relationship := j2ShelfRelationship()
		relationship.Recipes = nil
		var collected []domain.ContractIssue
		var operations []ResolvedMachiningOperation
		status := deriveFixedShelfJoinery(relationship, j2ShelfBoards(), &collected, &operations)
		if status.Stage != JoineryTechnicalProfileMissing || len(operations) != 0 {
			t.Fatalf("stage = %s operations = %d, want TECHNICAL_PROFILE_REQUIRED/0", status.Stage, len(operations))
		}
		if status.Stations.Status != "PLANNED" || len(status.Stations.StationCounts) != 2 {
			t.Fatalf("terminal must publish plans: %+v", status.Stations)
		}
		if len(status.Blockers) != 1 || status.Blockers[0] != "TECHNICAL_PROFILE_REQUIRED" {
			t.Fatalf("blockers = %+v", status.Blockers)
		}
	}
	t.Run("no recipe stays terminal", terminal)

	t.Run("unfit recipe fails whole relationship", func(t *testing.T) {
		relationship := j2ShelfRelationship()
		for i := range relationship.Recipes {
			for j := range relationship.Recipes[i].Rules {
				if relationship.Recipes[i].Rules[j].OperationRole == "counterbore" {
					// 35mm counterbore through the 18mm side: breakout.
					relationship.Recipes[i].Rules[j].DepthMm = 35
				}
			}
		}
		var collected []domain.ContractIssue
		var operations []ResolvedMachiningOperation
		status := deriveFixedShelfJoinery(relationship, j2ShelfBoards(), &collected, &operations)
		if status.Stage != JoineryMachiningInvalid || len(operations) != 0 {
			t.Fatalf("stage = %s operations = %d, want MACHINING_INVALID/0", status.Stage, len(operations))
		}
		if len(status.Blockers) != 1 || status.Blockers[0] != "OPERATION_GEOMETRY_INVALID" {
			t.Fatalf("blockers = %+v", status.Blockers)
		}
	})

	t.Run("missing participant role rule", func(t *testing.T) {
		relationship := j2ShelfRelationship()
		for i := range relationship.Recipes {
			rules := []ContactOperationRule{}
			for _, rule := range relationship.Recipes[i].Rules {
				if rule.ParticipantRole == "B" {
					continue
				}
				rules = append(rules, rule)
			}
			relationship.Recipes[i].Rules = rules
		}
		var collected []domain.ContractIssue
		var operations []ResolvedMachiningOperation
		status := deriveFixedShelfJoinery(relationship, j2ShelfBoards(), &collected, &operations)
		if status.Stage != JoineryMachiningInvalid || len(operations) != 0 {
			t.Fatalf("stage = %s operations = %d", status.Stage, len(operations))
		}
		if status.Blockers[0] != "OPERATION_PARTICIPANT_RULE_MISSING" {
			t.Fatalf("blockers = %+v", status.Blockers)
		}
	})

	t.Run("duplicate rule geometry", func(t *testing.T) {
		relationship := j2ShelfRelationship()
		for i := range relationship.Recipes {
			for _, rule := range relationship.Recipes[i].Rules {
				if rule.ParticipantRole == "B" {
					duplicate := rule
					duplicate.RuleID = "counterbore-copy"
					duplicate.OperationRole = "counterbore-copy"
					relationship.Recipes[i].Rules = append(relationship.Recipes[i].Rules, duplicate)
				}
			}
		}
		var collected []domain.ContractIssue
		var operations []ResolvedMachiningOperation
		status := deriveFixedShelfJoinery(relationship, j2ShelfBoards(), &collected, &operations)
		if status.Stage != JoineryMachiningInvalid || len(operations) != 0 {
			t.Fatalf("stage = %s operations = %d", status.Stage, len(operations))
		}
		if status.Blockers[0] != "OPERATION_GEOMETRY_DUPLICATE" {
			t.Fatalf("blockers = %+v", status.Blockers)
		}
	})

	t.Run("families rejected on fixed-shelf-side", func(t *testing.T) {
		relationship := j2ShelfRelationship()
		relationship.Families = floorSideFamilies()
		var collected []domain.ContractIssue
		var operations []ResolvedMachiningOperation
		status := deriveFixedShelfJoinery(relationship, j2ShelfBoards(), &collected, &operations)
		if status.Stage != JoineryStationInvalid || len(operations) != 0 {
			t.Fatalf("stage = %s operations = %d", status.Stage, len(operations))
		}
		if status.Blockers[0] != "STATION_PATTERN_INVALID" {
			t.Fatalf("blockers = %+v", status.Blockers)
		}
	})
}

// TestJ2FixedShelfWireValidation proves the authored-wire gate: recipes are
// fixed-shelf-side only, contactIds must be the relationship's own contacts,
// coverage must be complete, and the recipe shape is closed.
func TestJ2FixedShelfWireValidation(t *testing.T) {
	assertCode := func(t *testing.T, relationship AuthoringRelationship, wantMessagePart string) {
		t.Helper()
		issues := validateRelationshipRecipes(relationship)
		if len(issues) == 0 {
			t.Fatalf("expected issues for %q", wantMessagePart)
		}
		found := false
		for _, issue := range issues {
			if issue.Code == "RELATIONSHIP_INVALID" && strings.Contains(issue.Message, wantMessagePart) {
				found = true
			}
		}
		if !found {
			t.Fatalf("issue %q missing: %+v", wantMessagePart, issues)
		}
	}
	t.Run("valid relationship passes", func(t *testing.T) {
		if issues := validateRelationshipRecipes(j2ShelfRelationship()); len(issues) != 0 {
			t.Fatalf("issues = %+v", issues)
		}
	})
	t.Run("no recipes passes", func(t *testing.T) {
		relationship := j2ShelfRelationship()
		relationship.Recipes = nil
		if issues := validateRelationshipRecipes(relationship); len(issues) != 0 {
			t.Fatalf("issues = %+v", issues)
		}
	})
	t.Run("kind gate", func(t *testing.T) {
		relationship := j2ShelfRelationship()
		relationship.Kind = "floor-side"
		assertCode(t, relationship, "only valid on fixed-shelf-side")
	})
	t.Run("foreign contact id", func(t *testing.T) {
		relationship := j2ShelfRelationship()
		relationship.Recipes[0].ContactID = "rel-fixed-shelf-01:ghost"
		assertCode(t, relationship, "not a contact of this relationship")
	})
	t.Run("partial coverage", func(t *testing.T) {
		relationship := j2ShelfRelationship()
		relationship.Recipes = relationship.Recipes[:1]
		assertCode(t, relationship, "coverage must be complete")
	})
	t.Run("blank technical profile", func(t *testing.T) {
		relationship := j2ShelfRelationship()
		relationship.Recipes[0].TechnicalProfileID = ""
		assertCode(t, relationship, "technicalProfileId")
	})
	t.Run("families exclusivity", func(t *testing.T) {
		relationship := j2ShelfRelationship()
		relationship.Families = floorSideFamilies()
		assertCode(t, relationship, "mutually exclusive")
	})
	t.Run("bad rule shape", func(t *testing.T) {
		relationship := j2ShelfRelationship()
		relationship.Recipes[0].Rules[0].EntryFace = "diagonal"
		assertCode(t, relationship, "invalid rule")
		relationship = j2ShelfRelationship()
		relationship.Recipes[0].Rules[0].Axis = [3]float64{1, 1, 0}
		assertCode(t, relationship, "invalid rule")
	})
}

// fixedShelfBindingDefinition declares a fixed-shelf-side structure
// relationship the way the catalog would (#874 J2-B D1): the shelf component
// is the source, the sides are face-declared targets, the parameter value
// drives the station count. Bindings carry NO recipes in this slice — no
// verified production profile exists, so the materialized joint stays at the
// honest terminal.
func fixedShelfBindingDefinition() domain.FurnitureParameterDefinition {
	return domain.FurnitureParameterDefinition{
		Name: "fixedShelfJoints", Label: "Fijaciones entrepaño fijo", Type: domain.FurnitureParameterTypeNumber,
		DefaultValue: float64(3), Required: true, Integer: true, Unit: domain.FurnitureParameterUnitCount,
		Category: domain.FurnitureParameterCategoryConfiguration,
		Binding: &domain.FurnitureParameterBinding{
			Version: 1, Kind: domain.FurnitureParameterBindingStructureRelationship, ComponentID: "comp-shelf",
			Relationship: &domain.FurnitureParameterRelationshipBinding{
				Kind: "fixed-shelf-side", SourceRole: "shelf-edge",
				Targets: []domain.FurnitureParameterRelationshipTarget{
					{ComponentID: "comp-side", Role: "inside-face", Face: "back"},
					{ComponentID: "comp-side-r", Role: "inside-face", Face: "front"},
				},
				Station: &domain.FurnitureRelationshipStationMargins{StartMarginMm: 40, EndMarginMm: 40},
			},
		},
	}
}

// TestFixedShelfBindingRequiresTargetFaces: the persisted binding gate
// rejects a fixed-shelf-side target without a declared contact face — same
// rule as floor-side.
func TestFixedShelfBindingRequiresTargetFaces(t *testing.T) {
	definition := fixedShelfBindingDefinition()
	definition.Binding.Relationship.Targets[1].Face = ""
	issues := domain.ValidatePersistedFurnitureParameterDefinitions([]domain.FurnitureParameterDefinition{definition})
	found := false
	for _, issue := range issues {
		if issue.Field == "binding.relationship.targets" && strings.Contains(issue.Message, "concrete contact face") {
			found = true
		}
	}
	if !found {
		t.Fatalf("faceless fixed-shelf-side target accepted: %+v", issues)
	}
	if issues := domain.ValidatePersistedFurnitureParameterDefinitions(
		[]domain.FurnitureParameterDefinition{fixedShelfBindingDefinition()}); len(issues) != 0 {
		t.Fatalf("valid definition rejected: %+v", issues)
	}
}

// TestFixedShelfBindingMaterializesPerOccurrence: the catalog binding
// materializes one fixed-shelf-side relationship per shelf occurrence (the
// add/duplicate mechanics), each resolving through the honest terminal chain
// with zero operations.
// TestAuthoredFixedShelfRecipeReplacesShelfSupportBinding: an authored
// fixed-shelf-side relationship sourced on a panel replaces the legacy
// shelf-support parameter binding for that panel — one panel end carries
// one joint system, and drilling the recipe pilot and the minifix cam on
// the same face is a physical contradiction, not a resolvable conflict
// (#939). Panels without an authored recipe keep the binding.
func TestAuthoredFixedShelfRecipeReplacesShelfSupportBinding(t *testing.T) {
	boards := []layoutBoard{
		{id: "side-left", catalogComponentID: "comp-side", widthMm: 570, thicknessMm: 18, lengthMm: 720, rotX: -90, rotZ: 90},
		{id: "side-right", catalogComponentID: "comp-side-r", widthMm: 570, thicknessMm: 18, lengthMm: 720, x: 582, rotX: -90, rotZ: 90},
		{id: "shelf-1", catalogComponentID: "comp-shelf", widthMm: 570, thicknessMm: 18, lengthMm: 564, x: 18, z: 400, rotY: -90},
		{id: "shelf-2", catalogComponentID: "comp-shelf", widthMm: 570, thicknessMm: 18, lengthMm: 564, x: 18, z: 430, rotY: -90},
	}
	definition := domain.FurnitureParameterDefinition{
		Name: "shelfCount", Label: "Shelf count", Type: domain.FurnitureParameterTypeNumber,
		DefaultValue: float64(2), Required: true, Integer: true, Unit: domain.FurnitureParameterUnitCount,
		Category: domain.FurnitureParameterCategoryConfiguration,
		Binding: &domain.FurnitureParameterBinding{
			Version: 1, Kind: domain.FurnitureParameterBindingComponentQuantity, ComponentID: "comp-shelf",
			Relationship: &domain.FurnitureParameterRelationshipBinding{
				Kind: "shelf-support", SourceRole: "shelf-edge",
				Targets: []domain.FurnitureParameterRelationshipTarget{
					{ComponentID: "comp-side", Role: "inside-face"},
					{ComponentID: "comp-side-r", Role: "inside-face"},
				},
			},
		},
	}
	authored := []AuthoringRelationship{{
		RelationshipID: "rel-fixed-shelf-01",
		Kind:           "fixed-shelf-side",
		Source:         AuthoringRelationshipAnchor{ComponentInstanceID: "shelf-1", Role: "shelf-edge"},
		Targets: []AuthoringRelationshipAnchor{
			{ComponentInstanceID: "side-left", Role: "side", Face: "front"},
			{ComponentInstanceID: "side-right", Role: "side", Face: "back"},
		},
	}}
	relationships := materializeBoundRelationships(
		[]domain.FurnitureParameterDefinition{definition},
		map[string]any{"shelfCount": float64(2)}, boards, authored, nil)
	for _, relationship := range relationships {
		if relationship.Kind == "shelf-support" && relationship.Source.ComponentInstanceID == "shelf-1" {
			t.Fatalf("authored fixed-shelf source must not keep the shelf-support binding: %+v", relationships)
		}
	}
	found := false
	for _, relationship := range relationships {
		if relationship.Kind == "shelf-support" && relationship.Source.ComponentInstanceID == "shelf-2" {
			found = true
		}
	}
	if !found {
		t.Fatalf("shelf-2 without an authored recipe must keep its binding: %+v", relationships)
	}
}

func TestFixedShelfBindingMaterializesPerOccurrence(t *testing.T) {
	boards := []layoutBoard{
		{id: "side-left", catalogComponentID: "comp-side", widthMm: 570, thicknessMm: 18, lengthMm: 720, rotX: -90, rotZ: 90},
		{id: "side-right", catalogComponentID: "comp-side-r", widthMm: 570, thicknessMm: 18, lengthMm: 720, x: 582, rotX: -90, rotZ: 90},
		{id: "shelf-1", catalogComponentID: "comp-shelf", widthMm: 570, thicknessMm: 18, lengthMm: 564, x: 18, z: 400, rotY: -90},
		{id: "shelf-2", catalogComponentID: "comp-shelf", widthMm: 570, thicknessMm: 18, lengthMm: 564, x: 18, z: 430, rotY: -90},
	}
	relationships := materializeBoundRelationships(
		[]domain.FurnitureParameterDefinition{fixedShelfBindingDefinition()},
		map[string]any{"fixedShelfJoints": float64(3)}, boards, nil, nil)
	if len(relationships) != 2 {
		t.Fatalf("relationships = %d, want 2 (one per shelf occurrence): %+v", len(relationships), relationships)
	}
	ids := map[string]bool{}
	for _, relationship := range relationships {
		if relationship.Kind != "fixed-shelf-side" || relationship.Source.ComponentInstanceID == "" ||
			len(relationship.Targets) != 2 || relationship.Recipes != nil {
			t.Fatalf("materialized relationship = %+v", relationship)
		}
		ids[relationship.RelationshipID] = true
		var collected []domain.ContractIssue
		var operations []ResolvedMachiningOperation
		status := deriveFixedShelfJoinery(relationship, boardIndexFor(boards), &collected, &operations)
		if status.Stage != JoineryTechnicalProfileMissing || len(operations) != 0 {
			t.Fatalf("binding path must stay terminal: stage = %s operations = %d", status.Stage, len(operations))
		}
	}
	if !ids["parameter-fixedShelfJoints-1"] || !ids["parameter-fixedShelfJoints-2"] {
		t.Fatalf("per-occurrence identities missing: %+v", ids)
	}
}

// TestFixedShelfMaxSpacingDerivesCountFromSpan (#1065): a maxSpacingMm
// station pattern derives its count from each contact's real usable span —
// the same relationship scales with the furniture's dimensions. Reuses the
// shared J1 contact fixture geometry (floor-left overlap 0..500).
func TestFixedShelfMaxSpacingDerivesCountFromSpan(t *testing.T) {
	f := readJ1ContactFixture(t)
	resolution := resolveExplicitContacts(f.Boards, f.Contacts, f.RequiredContactIDs)
	if len(resolution.Issues) != 0 {
		t.Fatalf("invalid shared fixture: %+v", resolution.Issues)
	}
	// floor-left: overlap 0..500, márgenes 30/50 → útil 420; maxSpacing 250 → 2.
	specs := []StationSpec{{ContactID: "floor-left", MaxSpacingMm: 250, StartMarginMm: 30, EndMarginMm: 50},
		{ContactID: "floor-right", Count: 2, StartMarginMm: 40, EndMarginMm: 60}}
	plans := planResolvedContactStations(resolution, f.Boards, specs)
	if len(plans.Issues) != 0 {
		t.Fatalf("spacing plan failed: %+v", plans.Issues)
	}
	byContact := map[string]int{}
	for _, plan := range plans.Plans {
		byContact[plan.ContactID] = len(plan.Stations)
	}
	if got := byContact["floor-left"]; got != 2 {
		t.Fatalf("420mm usable at maxSpacing 250 should derive 2 stations, got %d", got)
	}
	if got := byContact["floor-right"]; got != 2 {
		t.Fatalf("explicit count contact should keep its 2 stations, got %d", got)
	}
	// maxSpacing 120 sobre el mismo útil 420 → floor(420/120)+1 = 4.
	specs[0].MaxSpacingMm = 120
	plans = planResolvedContactStations(resolution, f.Boards, specs)
	if len(plans.Issues) != 0 {
		t.Fatalf("tight spacing plan failed: %+v", plans.Issues)
	}
	for _, plan := range plans.Plans {
		if plan.ContactID == "floor-left" && len(plan.Stations) != 4 {
			t.Fatalf("420mm usable at maxSpacing 120 should derive 4 stations, got %d", len(plan.Stations))
		}
	}
	// stationCount + maxSpacing juntos es patrón inválido.
	bad := []StationSpec{{ContactID: "floor-left", Count: 3, MaxSpacingMm: 250, StartMarginMm: 30, EndMarginMm: 50},
		{ContactID: "floor-right", Count: 2, StartMarginMm: 40, EndMarginMm: 60}}
	issues := planResolvedContactStations(resolution, f.Boards, bad)
	if len(issues.Issues) == 0 || issues.Issues[0].Code != "STATION_PATTERN_INVALID" {
		t.Fatalf("count+maxSpacing must fail with STATION_PATTERN_INVALID, got %+v", issues.Issues)
	}
}
