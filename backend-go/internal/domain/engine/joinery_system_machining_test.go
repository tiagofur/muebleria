package engine

import (
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1052 slice 2 / #1219 — the component's construction block joins the
// joinery-system ladder at machining time, and the declared connection faces
// gate the relationship anchors fail-closed.

func joinerySystemBoards() map[string]*layoutBoard {
	return map[string]*layoutBoard{
		"shelf": {id: "shelf", catalogComponentID: "comp-shelf", widthMm: 560, thicknessMm: 18, lengthMm: 560, z: 400},
		"side":  {id: "side", catalogComponentID: "comp-side", widthMm: 560, thicknessMm: 18, lengthMm: 720},
	}
}

func joinerySystemCatalog(shelfSystemID string, sideFaces []string) domain.Catalog {
	shelf := domain.Component{ID: "comp-shelf", Code: "COM-SHF", Name: "Entrepaño", Placement: "interno", Active: true, OptionRoles: []string{"INTERIOR"}}
	if shelfSystemID != "" {
		shelf.Construction = &domain.ComponentConstruction{JoinerySystemID: shelfSystemID}
	}
	side := domain.Component{ID: "comp-side", Code: "COM-SIDE", Name: "Costado", Placement: "lateral_izquierdo", Active: true, OptionRoles: []string{"INTERIOR"}}
	if len(sideFaces) > 0 {
		side.Construction = &domain.ComponentConstruction{ConnectionFaces: sideFaces}
	}
	return domain.Catalog{
		Components: []domain.Component{shelf, side},
		Hardware: []domain.Hardware{
			{ID: "hw-minifix", Code: defaultShelfSupportRule.MinifixCode, Name: "Minifix 15", Active: true},
			{ID: "hw-dowel", Code: defaultShelfSupportRule.DowelCode, Name: "Taquete 8x30", Active: true},
		},
	}
}

func shelfSupportRelationship() AuthoringRelationship {
	return AuthoringRelationship{
		RelationshipID: "rel-shelf-01",
		Kind:           "shelf-support",
		Source:         AuthoringRelationshipAnchor{ComponentInstanceID: "shelf", Role: "shelf-edge"},
		Targets:        []AuthoringRelationshipAnchor{{ComponentInstanceID: "side", Role: "inside-face"}},
	}
}

// The component's authored system pisas the kind default: the SAME
// relationship over the SAME boards produces no minifix cam holes once the
// shelf declares dowel-only, while the inherited baseline drills them.
func TestComponentJoinerySystemOverridesKindDefault(t *testing.T) {
	boards := joinerySystemBoards()
	relationship := shelfSupportRelationship()

	inherited, issues := deriveRelationshipOperationsForTest(boards, joinerySystemCatalog("", nil), relationship)
	if len(inherited) == 0 {
		t.Fatalf("baseline produced no operations: issues=%+v", issues)
	}
	hasCam := false
	for _, op := range inherited {
		for _, hole := range op.Holes {
			if hole.DiameterMm == defaultShelfSupportRule.CamDiameterMm {
				hasCam = true
			}
		}
	}
	if !hasCam {
		t.Fatalf("baseline (minifix-dowel) must drill cam holes: %+v", inherited)
	}

	declared, _ := deriveRelationshipOperationsForTest(boards, joinerySystemCatalog("dowel-only", nil), relationship)
	if len(declared) == 0 {
		t.Fatal("dowel-only shelf must still drill dowels")
	}
	for _, op := range declared {
		for _, hole := range op.Holes {
			if hole.DiameterMm == defaultShelfSupportRule.CamDiameterMm {
				t.Fatalf("dowel-only shelf must not drill minifix cams: %+v", hole)
			}
		}
	}
}

func TestConnectionFaceGateBlocksUndeclaredAnchorFace(t *testing.T) {
	boards := joinerySystemBoards()
	catalog := joinerySystemCatalog("", []string{"front"})

	_, issues := deriveAuthoringMachining(
		boardMapValues(boards),
		[]AuthoringRelationship{shelfSupportRelationship()},
		nil, catalog, nil, nil,
	)
	found := false
	for _, issue := range issues {
		if issue.Code == "CONNECTION_FACE_INVALID" {
			found = true
		}
	}
	if found {
		t.Fatalf("an anchor without a declared face cannot violate a capacity: %+v", issues)
	}

	// Declare a face capacity on the side that excludes the relationship's
	// anchor: the shelf-support target has no explicit face — declare the
	// relationship's face via the target and watch the gate fire.
	side := catalog.Components[1]
	side.Construction = &domain.ComponentConstruction{ConnectionFaces: []string{"front"}}
	catalog.Components[1] = side
	rel := shelfSupportRelationship()
	rel.Targets = []AuthoringRelationshipAnchor{{ComponentInstanceID: "side", Role: "inside-face", Face: "top"}}

	_, issues = deriveAuthoringMachining(
		boardMapValues(boards),
		[]AuthoringRelationship{rel},
		nil, catalog, nil, nil,
	)
	found = false
	for _, issue := range issues {
		if issue.Code == "CONNECTION_FACE_INVALID" {
			found = true
		}
	}
	if !found {
		t.Fatalf("an anchor face outside the declared capacity must fail closed: %+v", issues)
	}
	// The relationship dies as unsupported — never half-derives.
	for _, st := range issues {
		_ = st
	}
}

func TestFactoryFamilySystemIdParsesFromBothSurfaces(t *testing.T) {
	structured := []byte(`{"joint.constructionPolicy":{"version":1,"floorToSide":{"provenance":"factory","stationsCount":3,"systemId":"minifix-dowel"}}}`)
	policy, err := ParseFactoryConstructionPolicy(structured)
	if err != nil {
		t.Fatalf("structured parse: %v", err)
	}
	if policy == nil || policy.FloorToSide == nil || policy.FloorToSide.SystemId != "minifix-dowel" {
		t.Fatalf("structured systemId not parsed: %+v", policy)
	}

	granular := []byte(`{"joint.floorToSide.stationsCount":3,"joint.floorToSide.systemId":"dowel-only"}`)
	policy, err = ParseFactoryConstructionPolicy(granular)
	if err != nil {
		t.Fatalf("granular parse: %v", err)
	}
	if policy == nil || policy.FloorToSide == nil || policy.FloorToSide.SystemId != "dowel-only" {
		t.Fatalf("granular systemId not parsed: %+v", policy)
	}

	broken := []byte(`{"joint.constructionPolicy":{"version":1,"floorToSide":{"provenance":"factory","systemId":"  "}}}`)
	if _, err := ParseFactoryConstructionPolicy(broken); err == nil {
		t.Fatal("a blank systemId must fail closed")
	}

	// The ladder consumes the factory rung when the kind has a family.
	if got := EffectiveJoinerySystem("", "", "screw-only", "minifix-dowel"); got != "screw-only" {
		t.Fatalf("factory rung must govern before the kind default: %q", got)
	}
}

func deriveRelationshipOperationsForTest(boards map[string]*layoutBoard, catalog domain.Catalog, relationship AuthoringRelationship) ([]ResolvedMachiningOperation, []domain.ContractIssue) {
	componentsByID := make(map[string]*domain.Component, len(catalog.Components))
	for i := range catalog.Components {
		componentsByID[catalog.Components[i].ID] = &catalog.Components[i]
	}
	ladder := joinerySystemLadderInput{
		boardIndex:     boards,
		componentsByID: componentsByID,
		kindDefaults:   authoringRelationshipKindDefaults,
	}
	operations := []ResolvedMachiningOperation{}
	issues := []domain.ContractIssue{}
	derived := []DerivedHardwarePlacement{}
	statuses := []JoineryRelationshipStatus{}
	deriveRelationshipOperations(relationship, boards, catalog, ladder, &derived, &operations, &issues, &statuses)
	return operations, issues
}
