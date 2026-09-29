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
	status := deriveFloorSideJoinery(relationship, boardIndexFor(structureBoards()), &collected)
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
	status := deriveFloorSideJoinery(relationship, j1bBoards(), &collected)
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
	status := deriveFloorSideJoinery(relationship, j1bBoards(), &collected)
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
	status := deriveFloorSideJoinery(relationship, j1bBoards(), &collected)
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
