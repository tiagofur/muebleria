package engine

import (
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// structureBoards reuses the J1 physical cabinet convention with catalog
// component ids so catalog-declared bindings can resolve participants.
func structureBoards() []layoutBoard {
	return []layoutBoard{
		{id: "side-left", catalogComponentID: "comp-side", widthMm: 570, thicknessMm: 18, lengthMm: 720, rotX: -90, rotZ: 90},
		{id: "side-right", catalogComponentID: "comp-side-r", widthMm: 570, thicknessMm: 18, lengthMm: 720, x: 582, rotX: -90, rotZ: 90},
		{id: "floor", catalogComponentID: "comp-base", widthMm: 570, thicknessMm: 18, lengthMm: 564, x: 18, rotY: -90},
	}
}

func structureDefinition() domain.FurnitureParameterDefinition {
	return domain.FurnitureParameterDefinition{
		Name: "baseJointStations", Label: "Fijaciones base por unión", Type: domain.FurnitureParameterTypeNumber,
		DefaultValue: float64(3), Required: true, Integer: true, Unit: domain.FurnitureParameterUnitCount,
		Category: domain.FurnitureParameterCategoryConfiguration,
		Binding: &domain.FurnitureParameterBinding{
			Version: 1, Kind: domain.FurnitureParameterBindingStructureRelationship, ComponentID: "comp-base",
			Relationship: &domain.FurnitureParameterRelationshipBinding{
				Kind: "floor-side", SourceRole: "floor-edge",
				Targets: []domain.FurnitureParameterRelationshipTarget{
					{ComponentID: "comp-side", Role: "inside-face", Face: "back"},
					{ComponentID: "comp-side-r", Role: "inside-face", Face: "front"},
				},
				Station: &domain.FurnitureRelationshipStationMargins{StartMarginMm: 40, EndMarginMm: 40},
			},
		},
	}
}

func TestStructureRelationshipMaterializesFromParameterValue(t *testing.T) {
	relationships := materializeBoundRelationships(
		[]domain.FurnitureParameterDefinition{structureDefinition()},
		map[string]any{"baseJointStations": float64(4)},
		structureBoards(), nil)
	if len(relationships) != 1 {
		t.Fatalf("relationships = %+v", relationships)
	}
	relationship := relationships[0]
	if relationship.RelationshipID != "parameter-baseJointStations-1" || relationship.Kind != "floor-side" {
		t.Fatalf("identity = %+v", relationship)
	}
	if relationship.Source.ComponentInstanceID != "floor" || relationship.Source.Role != "floor-edge" {
		t.Fatalf("source = %+v", relationship.Source)
	}
	if len(relationship.Targets) != 2 ||
		relationship.Targets[0].ComponentInstanceID != "side-left" || relationship.Targets[0].Face != "back" ||
		relationship.Targets[1].ComponentInstanceID != "side-right" || relationship.Targets[1].Face != "front" {
		t.Fatalf("targets = %+v", relationship.Targets)
	}
	if relationship.Parameters["stationCount"] != float64(4) ||
		relationship.Parameters["startMarginMm"] != float64(40) ||
		relationship.Parameters["endMarginMm"] != float64(40) {
		t.Fatalf("parameters = %+v", relationship.Parameters)
	}

	// The materialized relationship resolves through the honest J1 chain.
	var collected []domain.ContractIssue
	status := deriveFloorSideJoinery(relationship, boardIndexFor(structureBoards()), &collected, nil, nil)
	if status.Stage != JoineryTechnicalProfileMissing {
		t.Fatalf("stage = %s issues=%+v", status.Stage, collected)
	}
	if len(status.Stations.StationCounts) != 2 ||
		status.Stations.StationCounts[0].StationCount != 4 || status.Stations.StationCounts[1].StationCount != 4 {
		t.Fatalf("station counts = %+v", status.Stations.StationCounts)
	}
}

func TestStructureRelationshipFallsBackToDefaultCount(t *testing.T) {
	relationships := materializeBoundRelationships(
		[]domain.FurnitureParameterDefinition{structureDefinition()},
		map[string]any{}, structureBoards(), nil)
	if len(relationships) != 1 || relationships[0].Parameters["stationCount"] != float64(3) {
		t.Fatalf("default count not applied: %+v", relationships)
	}
}

func TestStructureRelationshipAuthoredEquivalentWins(t *testing.T) {
	authored := []AuthoringRelationship{{
		RelationshipID: "rel-floor-sides-01", Kind: "floor-side",
		Source: AuthoringRelationshipAnchor{ComponentInstanceID: "floor", Role: "floor-edge"},
		Targets: []AuthoringRelationshipAnchor{
			{ComponentInstanceID: "side-left", Role: "inside-face", Face: "back"},
			{ComponentInstanceID: "side-right", Role: "inside-face", Face: "front"},
		},
		Parameters: map[string]any{"stationCount": float64(2)},
	}}
	relationships := materializeBoundRelationships(
		[]domain.FurnitureParameterDefinition{structureDefinition()},
		map[string]any{"baseJointStations": float64(4)},
		structureBoards(), authored)
	if len(relationships) != 1 || relationships[0].RelationshipID != "rel-floor-sides-01" {
		t.Fatalf("authored equivalent must win over the catalog declaration: %+v", relationships)
	}
}

func TestStructureRelationshipSkipsUnusableValues(t *testing.T) {
	for name, value := range map[string]any{"string": "3", "fractional": 2.5, "negative": float64(-1), "bool": true} {
		relationships := materializeBoundRelationships(
			[]domain.FurnitureParameterDefinition{structureDefinition()},
			map[string]any{"baseJointStations": value},
			structureBoards(), nil)
		if len(relationships) != 0 {
			t.Fatalf("%s value materialized a relationship: %+v", name, relationships)
		}
	}
}

func boardIndexFor(boards []layoutBoard) map[string]*layoutBoard {
	index := make(map[string]*layoutBoard, len(boards))
	for i := range boards {
		index[boards[i].id] = &boards[i]
	}
	return index
}

// TestStructureRelationshipResolvesEndToEnd drives the full
// ResolveAuthoringLayout with a catalog-declared floor-side binding: the
// definition's structure and the binding alone must produce live joinery
// statuses without any authored relationships in the request.
func TestStructureRelationshipResolvesEndToEnd(t *testing.T) {
	module, catalog := authoringCabinetCatalog()
	definition := structureDefinition()
	// The real placement path mirrors the right side: side-left's inner face
	// is "front", side-right's is "back".
	definition.Binding.Relationship.Targets[0].Face = "front"
	definition.Binding.Relationship.Targets[1].Face = "back"
	module.ParameterDefinitions = append(module.ParameterDefinitions, definition)
	result, err := ResolveAuthoringLayout(AuthoringResolveInput{
		Module: module, Catalog: catalog, PrecisionMm: 0.01,
		EvaluatedParameters: map[string]any{"baseJointStations": float64(3)},
	})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if len(result.StructuralIssues) != 0 {
		t.Fatalf("structural issues: %+v", result.StructuralIssues)
	}
	statuses := result.Machining.JoineryStatuses
	if len(statuses) != 1 {
		t.Fatalf("joinery statuses = %+v", statuses)
	}
	status := statuses[0]
	if status.Stage != JoineryTechnicalProfileMissing || len(status.Contacts) != 2 ||
		status.Contacts[0].Status != "VALID" || status.Contacts[1].Status != "VALID" {
		t.Fatalf("status = %+v", status)
	}
	if status.RelationshipID != "parameter-baseJointStations-1" {
		t.Fatalf("relationship id = %s", status.RelationshipID)
	}
	found := false
	for _, count := range status.Stations.StationCounts {
		if count.StationCount != 3 {
			t.Fatalf("station count = %+v", count)
		}
		found = true
	}
	if !found {
		t.Fatalf("station counts missing: %+v", status)
	}
	// The materialized relationship participates in the fingerprint.
	if result.Machining.ManufacturingFingerprint == "" {
		t.Fatal("fingerprint empty")
	}
}

// TestStructureRelationshipRejectsAmbiguousCatalogBinding proves the module
// consumer validation blocks ambiguous structure targets before resolve.
func TestStructureRelationshipRejectsAmbiguousCatalogBinding(t *testing.T) {
	module, catalog := authoringCabinetCatalog()
	definition := structureDefinition()
	definition.Binding.Relationship.Targets[1] = domain.FurnitureParameterRelationshipTarget{ComponentID: "comp-side", Role: "inside-face", Face: "front"}
	module.ParameterDefinitions = append(module.ParameterDefinitions, definition)
	_, err := ResolveAuthoringLayout(AuthoringResolveInput{
		Module: module, Catalog: catalog, PrecisionMm: 0.01,
	})
	if err == nil {
		t.Fatal("ambiguous binding accepted")
	}
	var defErr *domain.FurnitureParameterDefinitionsError
	if !errorsAs(err, &defErr) {
		t.Fatalf("expected FurnitureParameterDefinitionsError, got %T: %v", err, err)
	}
}

func errorsAs(err error, target interface{}) bool {
	if defErr, ok := err.(*domain.FurnitureParameterDefinitionsError); ok {
		if t, ok := target.(**domain.FurnitureParameterDefinitionsError); ok {
			*t = defErr
			return true
		}
	}
	return false
}

// TestStructureRelationshipRejectsFacelessFloorSideTarget proves the engine
// gate blocks a floor-side binding whose target omits the declared face.
func TestStructureRelationshipRejectsFacelessFloorSideTarget(t *testing.T) {
	module, catalog := authoringCabinetCatalog()
	definition := structureDefinition()
	definition.Binding.Relationship.Targets[1].Face = ""
	module.ParameterDefinitions = append(module.ParameterDefinitions, definition)
	_, err := ResolveAuthoringLayout(AuthoringResolveInput{
		Module: module, Catalog: catalog, PrecisionMm: 0.01,
	})
	if err == nil {
		t.Fatal("faceless floor-side target accepted")
	}
}

func floorSideFamilies() []AuthoringRelationshipFamily {
	return []AuthoringRelationshipFamily{
		{FamilyID: "tornillos", Count: 4, StartMarginMm: 30, EndMarginMm: 50},
		{FamilyID: "taquetes", Count: 2, StartMarginMm: 100, EndMarginMm: 100},
	}
}

// TestFamilyPlansIndependentStations proves one joint plans each family
// independently: 4+2 stations, per-family distances, honest aggregates.
func TestFamilyPlansIndependentStations(t *testing.T) {
	relationship := j1bRelationship()
	relationship.Parameters = nil
	relationship.Families = floorSideFamilies()
	var collected []domain.ContractIssue
	status := deriveFloorSideJoinery(relationship, j1bBoards(), &collected, nil, nil)
	if status.Stage != JoineryTechnicalProfileMissing {
		t.Fatalf("stage = %s issues=%+v", status.Stage, collected)
	}
	if len(status.Stations.FamilyPlans) != 2 {
		t.Fatalf("family plans = %+v", status.Stations.FamilyPlans)
	}
	// familyPlans are sorted by familyId: "taquetes" < "tornillos".
	taquetes, tornillos := status.Stations.FamilyPlans[0], status.Stations.FamilyPlans[1]
	if tornillos.FamilyID != "tornillos" || taquetes.FamilyID != "taquetes" {
		t.Fatalf("family order = %+v", status.Stations.FamilyPlans)
	}
	for _, count := range tornillos.StationCounts {
		if count.StationCount != 4 {
			t.Fatalf("tornillos count = %+v", count)
		}
	}
	for _, count := range taquetes.StationCounts {
		if count.StationCount != 2 {
			t.Fatalf("taquetes count = %+v", count)
		}
	}
	// Aggregates are the honest union: sum of counts, ascending positions.
	for _, count := range status.Stations.StationCounts {
		if count.StationCount != 6 {
			t.Fatalf("aggregate count = %+v", count)
		}
	}
	for _, distances := range status.Stations.StationDistances {
		if len(distances.DistancesMm) != 6 {
			t.Fatalf("aggregate distances = %+v", distances)
		}
		for i := 1; i < len(distances.DistancesMm); i++ {
			if distances.DistancesMm[i] < distances.DistancesMm[i-1] {
				t.Fatalf("aggregate not ascending: %+v", distances)
			}
		}
	}
}

// TestFamilyPlansCollisionFailsWholePattern proves overlapping family
// positions fail the relationship without auto-reduction.
func TestFamilyPlansCollisionFailsWholePattern(t *testing.T) {
	relationship := j1bRelationship()
	relationship.Parameters = nil
	relationship.Families = []AuthoringRelationshipFamily{
		{FamilyID: "tornillos", Count: 4, StartMarginMm: 30, EndMarginMm: 50},
		{FamilyID: "taquetes", Count: 2, StartMarginMm: 30, EndMarginMm: 30},
	}
	var collected []domain.ContractIssue
	status := deriveFloorSideJoinery(relationship, j1bBoards(), &collected, nil, nil)
	if status.Stage != JoineryStationInvalid {
		t.Fatalf("stage = %s", status.Stage)
	}
	found := false
	for _, code := range status.Stations.IssueCodes {
		if code == "STATION_FAMILY_COLLISION" {
			found = true
		}
	}
	if !found || len(status.Stations.FamilyPlans) != 0 {
		t.Fatalf("collision status = %+v", status.Stations)
	}
}

// TestFamiliesAndStationCountAreExclusive proves the fail-closed rule.
func TestFamiliesAndStationCountAreExclusive(t *testing.T) {
	relationship := j1bRelationship()
	relationship.Families = floorSideFamilies()
	var collected []domain.ContractIssue
	status := deriveFloorSideJoinery(relationship, j1bBoards(), &collected, nil, nil)
	if status.Stage != JoineryStationInvalid {
		t.Fatalf("stage = %s", status.Stage)
	}
	if len(status.Stations.IssueCodes) != 1 || status.Stations.IssueCodes[0] != "STATION_PATTERN_INVALID" {
		t.Fatalf("issue codes = %+v", status.Stations.IssueCodes)
	}
}

// TestFamiliesEndToEndFromBinding drives the full resolve: a catalog
// binding with families materializes a relationship whose status carries
// per-family plans, without any authored relationships.
func TestFamiliesEndToEndFromBinding(t *testing.T) {
	module, catalog := authoringCabinetCatalog()
	definition := structureDefinition()
	definition.Binding.Relationship.Families = []domain.FurnitureRelationshipFamily{
		{FamilyID: "tornillos", Count: 4, StartMarginMm: 30, EndMarginMm: 50},
		{FamilyID: "taquetes", Count: 2, StartMarginMm: 100, EndMarginMm: 100},
	}
	definition.Binding.Relationship.Targets[0].Face = "front"
	definition.Binding.Relationship.Targets[1].Face = "back"
	module.ParameterDefinitions = append(module.ParameterDefinitions, definition)
	result, err := ResolveAuthoringLayout(AuthoringResolveInput{
		Module: module, Catalog: catalog, PrecisionMm: 0.01,
		EvaluatedParameters: map[string]any{"baseJointStations": float64(3)},
	})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if len(result.StructuralIssues) != 0 {
		t.Fatalf("structural: %+v", result.StructuralIssues)
	}
	statuses := result.Machining.JoineryStatuses
	if len(statuses) != 1 || len(statuses[0].Stations.FamilyPlans) != 2 {
		t.Fatalf("statuses = %+v", statuses)
	}
	// familyPlans are sorted by familyId: "taquetes" < "tornillos".
	if statuses[0].Stations.FamilyPlans[0].FamilyID != "taquetes" ||
		statuses[0].Stations.FamilyPlans[0].StationCounts[0].StationCount != 2 ||
		statuses[0].Stations.FamilyPlans[1].FamilyID != "tornillos" ||
		statuses[0].Stations.FamilyPlans[1].StationCounts[0].StationCount != 4 {
		t.Fatalf("family counts = %+v", statuses[0].Stations.FamilyPlans)
	}
}

func syntheticProfiles() FamilyProfileResolver {
	return func(kind, familyID string) *FamilyTechnicalProfile {
		if kind != "floor-side" {
			return nil
		}
		switch familyID {
		case "tornillos":
			// Fits every participant: entry faces include the 18mm-thick
			// sides, so the synthetic bore depth stays within 18mm.
			return &FamilyTechnicalProfile{ProfileID: "test:synthetic-screw-4x15", DiameterMm: 4, DepthMm: 15, HoleType: "screw"}
		case "taquetes":
			return &FamilyTechnicalProfile{ProfileID: "test:synthetic-dowel-8x15", DiameterMm: 8, DepthMm: 15, HoleType: "dowel"}
		default:
			return nil
		}
	}
}

// TestFamilyOperationsWithSyntheticProfiles: complete profiles derive real
// operations (one per family×contact×participant, one hole per station on
// the contact face) and the stage reaches MACHINING_READY.
func TestFamilyOperationsWithSyntheticProfiles(t *testing.T) {
	relationship := j1bRelationship()
	relationship.Parameters = nil
	relationship.Families = floorSideFamilies()
	var collected []domain.ContractIssue
	var operations []ResolvedMachiningOperation
	status := deriveFloorSideJoinery(relationship, j1bBoards(), &collected, syntheticProfiles(), &operations)
	if status.Stage != JoineryMachiningReady {
		t.Fatalf("stage = %s issues=%+v", status.Stage, collected)
	}
	if len(status.Blockers) != 0 {
		t.Fatalf("blockers = %+v", status.Blockers)
	}
	// 2 families × 2 contacts × 2 participants = 8 operations; every
	// operation carries family provenance and 4 or 2 holes.
	if len(operations) != 8 {
		t.Fatalf("operations = %d, want 8: %+v", len(operations), operations)
	}
	perFamily := map[string]int{}
	for _, operation := range operations {
		if operation.Provenance.SourceKind != "relationship" ||
			operation.Provenance.RelationshipID != "rel-floor-sides-01" ||
			operation.Provenance.FamilyID == "" || operation.Provenance.CatalogRuleID == "" {
			t.Fatalf("provenance = %+v", operation.Provenance)
		}
		perFamily[operation.Provenance.FamilyID]++
		expectedHoles := 4
		if operation.Provenance.FamilyID == "taquetes" {
			expectedHoles = 2
		}
		if len(operation.Holes) != expectedHoles {
			t.Fatalf("family %s holes = %d, want %d", operation.Provenance.FamilyID, len(operation.Holes), expectedHoles)
		}
		for _, hole := range operation.Holes {
			if hole.Face == "" || hole.DiameterMm <= 0 || hole.DepthMm <= 0 || hole.Type == "" {
				t.Fatalf("hole = %+v", hole)
			}
		}
	}
	if perFamily["tornillos"] != 4 || perFamily["taquetes"] != 4 {
		t.Fatalf("per-family operations = %+v", perFamily)
	}
}

// TestFamilyOperationsPartialProfilesStayBlocked: one missing profile keeps
// the honest terminal state and ZERO operations for the whole relationship.
func TestFamilyOperationsPartialProfilesStayBlocked(t *testing.T) {
	relationship := j1bRelationship()
	relationship.Parameters = nil
	relationship.Families = floorSideFamilies()
	partial := func(kind, familyID string) *FamilyTechnicalProfile {
		if familyID != "tornillos" {
			return nil
		}
		return &FamilyTechnicalProfile{ProfileID: "test:synthetic-screw-4x15", DiameterMm: 4, DepthMm: 15, HoleType: "screw"}
	}
	var collected []domain.ContractIssue
	var operations []ResolvedMachiningOperation
	status := deriveFloorSideJoinery(relationship, j1bBoards(), &collected, partial, &operations)
	if status.Stage != JoineryTechnicalProfileMissing {
		t.Fatalf("stage = %s", status.Stage)
	}
	if len(operations) != 0 {
		t.Fatalf("partial profiles emitted operations: %+v", operations)
	}
	if len(status.Stations.FamilyPlans) != 2 {
		t.Fatalf("plans should still publish: %+v", status.Stations.FamilyPlans)
	}
}

// TestFamilyOperationsProductionResolverAbsent: nil resolver (production)
// changes nothing — terminal state, zero operations, plans published.
func TestFamilyOperationsProductionResolverAbsent(t *testing.T) {
	relationship := j1bRelationship()
	relationship.Parameters = nil
	relationship.Families = floorSideFamilies()
	var collected []domain.ContractIssue
	var operations []ResolvedMachiningOperation
	status := deriveFloorSideJoinery(relationship, j1bBoards(), &collected, nil, &operations)
	if status.Stage != JoineryTechnicalProfileMissing || len(operations) != 0 {
		t.Fatalf("status = %s operations = %d", status.Stage, len(operations))
	}
}

// TestFamilyOperationsUnfitProfileFailsWholeRelationship: a profile whose
// bore is deeper than a participant's entry-face extent fails the joint
// with a structured error and ZERO operations (never an omitted hole).
func TestFamilyOperationsUnfitProfileFailsWholeRelationship(t *testing.T) {
	relationship := j1bRelationship()
	relationship.Parameters = nil
	relationship.Families = floorSideFamilies()
	unfit := func(kind, familyID string) *FamilyTechnicalProfile {
		if familyID == "tornillos" {
			// 35mm bore through the 18mm side: breakout.
			return &FamilyTechnicalProfile{ProfileID: "test:synthetic-screw-4x35", DiameterMm: 4, DepthMm: 35, HoleType: "screw"}
		}
		return &FamilyTechnicalProfile{ProfileID: "test:synthetic-dowel-8x15", DiameterMm: 8, DepthMm: 15, HoleType: "dowel"}
	}
	var collected []domain.ContractIssue
	var operations []ResolvedMachiningOperation
	status := deriveFloorSideJoinery(relationship, j1bBoards(), &collected, unfit, &operations)
	if status.Stage != JoineryMachiningInvalid {
		t.Fatalf("stage = %s", status.Stage)
	}
	if len(status.Blockers) != 1 || status.Blockers[0] != "TECHNICAL_PROFILE_INCOMPATIBLE" {
		t.Fatalf("blockers = %+v", status.Blockers)
	}
	if len(operations) != 0 {
		t.Fatalf("unfit profile emitted operations: %+v", operations)
	}
	found := false
	for _, issue := range collected {
		if issue.Code == "TECHNICAL_PROFILE_INCOMPATIBLE" {
			found = true
		}
	}
	if !found {
		t.Fatalf("structured issue missing: %+v", collected)
	}
}

// TestFamilyHoleCollisionDegradesReady: two families whose stations do NOT
// collide positionally but whose emitted holes overlap on the same face
// (Ø8 holes 2 mm apart) must degrade to MACHINING_INVALID with
// DRILLING_CONFLICT and ZERO operations — never a READY stage beside a
// global-only conflict issue.
func TestFamilyHoleCollisionDegradesReady(t *testing.T) {
	relationship := j1bRelationship()
	relationship.Parameters = nil
	// Tornillos at [50, 520], taquetes at [52, 518]: distinct station
	// positions (no STATION_FAMILY_COLLISION) but Ø8 holes 2 mm apart on
	// the same face overlap (2 < 8).
	relationship.Families = []AuthoringRelationshipFamily{
		{FamilyID: "tornillos", Count: 2, StartMarginMm: 50, EndMarginMm: 50},
		{FamilyID: "taquetes", Count: 2, StartMarginMm: 52, EndMarginMm: 52},
	}
	var collected []domain.ContractIssue
	var operations []ResolvedMachiningOperation
	status := deriveFloorSideJoinery(relationship, j1bBoards(), &collected, syntheticProfiles(), &operations)
	if status.Stage != JoineryMachiningInvalid {
		t.Fatalf("stage = %s", status.Stage)
	}
	if len(status.Blockers) != 1 || status.Blockers[0] != "DRILLING_CONFLICT" {
		t.Fatalf("blockers = %+v", status.Blockers)
	}
	if len(status.Stations.IssueCodes) != 1 || status.Stations.IssueCodes[0] != "DRILLING_CONFLICT" {
		t.Fatalf("stations issueCodes = %+v", status.Stations.IssueCodes)
	}
	if len(operations) != 0 {
		t.Fatalf("colliding joint emitted operations: %+v", operations)
	}
	found := false
	for _, issue := range collected {
		if issue.Code == "DRILLING_CONFLICT" {
			found = true
		}
	}
	if !found {
		t.Fatalf("DRILLING_CONFLICT issue missing: %+v", collected)
	}
}

// TestProfileIdentityRequired: a blank profile id or hole type is an
// invalid profile, not a ready joint.
func TestProfileIdentityRequired(t *testing.T) {
	relationship := j1bRelationship()
	relationship.Parameters = nil
	relationship.Families = floorSideFamilies()
	faceless := func(kind, familyID string) *FamilyTechnicalProfile {
		if familyID == "tornillos" {
			return &FamilyTechnicalProfile{ProfileID: "", DiameterMm: 4, DepthMm: 15, HoleType: "screw"}
		}
		return &FamilyTechnicalProfile{ProfileID: "test:synthetic-dowel-8x15", DiameterMm: 8, DepthMm: 15, HoleType: ""}
	}
	var collected []domain.ContractIssue
	var operations []ResolvedMachiningOperation
	status := deriveFloorSideJoinery(relationship, j1bBoards(), &collected, faceless, &operations)
	if status.Stage != JoineryMachiningInvalid {
		t.Fatalf("stage = %s", status.Stage)
	}
	if len(status.Blockers) != 1 || status.Blockers[0] != "TECHNICAL_PROFILE_INVALID" {
		t.Fatalf("blockers = %+v", status.Blockers)
	}
	if len(operations) != 0 {
		t.Fatalf("invalid profile emitted operations: %+v", operations)
	}
}

// TestReconcileDegradesReadyOnCrossSourceConflict: a READY status whose
// operations appear in a global DRILLING_CONFLICT (e.g. against a manual
// placement hole) is degraded — readiness may never contradict the blocked
// machining result.
func TestReconcileDegradesReadyOnCrossSourceConflict(t *testing.T) {
	statuses := []JoineryRelationshipStatus{{
		RelationshipID: "rel-1", Kind: "floor-side", Stage: JoineryMachiningReady,
		Contacts: []JoineryContactStatus{}, Stations: JoineryStationPlanStatus{Status: "PLANNED"},
	}, {
		RelationshipID: "rel-2", Kind: "floor-side", Stage: JoineryMachiningReady,
		Contacts: []JoineryContactStatus{}, Stations: JoineryStationPlanStatus{Status: "PLANNED"},
	}}
	operations := []ResolvedMachiningOperation{
		{OperationID: "op-a", HostComponentInstanceID: "b1", Provenance: ResolvedMachiningProvenance{SourceKind: "relationship", RelationshipID: "rel-1"}},
		{OperationID: "op-b", HostComponentInstanceID: "b1", Provenance: ResolvedMachiningProvenance{SourceKind: "relationship", RelationshipID: "rel-2"}},
	}
	issues := []domain.ContractIssue{{
		Code: "DRILLING_CONFLICT", Details: map[string]any{"operationId1": "op-a", "operationId2": "op-b"},
	}}
	reconciled := reconcileJoineryStatusesWithCollisions(statuses, operations, issues)
	if reconciled[0].Stage != JoineryMachiningInvalid || reconciled[1].Stage != JoineryMachiningInvalid {
		t.Fatalf("stages = %s/%s", reconciled[0].Stage, reconciled[1].Stage)
	}
	for _, status := range reconciled {
		if len(status.Blockers) != 1 || status.Blockers[0] != "DRILLING_CONFLICT" {
			t.Fatalf("blockers = %+v", status.Blockers)
		}
	}
	// No conflict → untouched.
	clean := reconcileJoineryStatusesWithCollisions(statuses, operations, nil)
	if clean[0].Stage != JoineryMachiningReady {
		t.Fatalf("clean stage = %s", clean[0].Stage)
	}
}
