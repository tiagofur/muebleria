package engine

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #919 golden vertical: the engine must match expectations computed
// INDEPENDENTLY by hand (contracts/hardwareProfileVertical.golden.json).
// Every number in the fixture was derived on paper from the documented
// frame/station/rule semantics; a mismatch is a finding — the fixture is
// never regenerated from resolver output.

type verticalGolden struct {
	ContactScenario struct {
		Boards struct {
			ShelfA struct {
				WidthMm     float64 `json:"widthMm"`
				ThicknessMm float64 `json:"thicknessMm"`
				LengthMm    float64 `json:"lengthMm"`
			} `json:"shelf-A"`
			SideB struct {
				WidthMm     float64 `json:"widthMm"`
				ThicknessMm float64 `json:"thicknessMm"`
				LengthMm    float64 `json:"lengthMm"`
			} `json:"side-B"`
		} `json:"boards"`
		Contact struct {
			ContactID      string `json:"contactId"`
			RelationshipID string `json:"relationshipId"`
			ParticipantA   string `json:"participantA"`
			ParticipantB   string `json:"participantB"`
			FaceA          string `json:"faceA"`
			FaceB          string `json:"faceB"`
		} `json:"contact"`
		Frame struct {
			OriginAssemblyMm [3]float64 `json:"originAssemblyMm"`
			AxisAssembly     [3]float64 `json:"axisAssembly"`
			NormalAssembly   [3]float64 `json:"normalAssembly"`
		} `json:"frame"`
		Stations struct {
			Count         int       `json:"count"`
			StartMarginMm float64   `json:"startMarginMm"`
			EndMarginMm   float64   `json:"endMarginMm"`
			DistancesMm   []float64 `json:"distancesMm"`
		} `json:"stations"`
		Recipe struct {
			RecipeID                 string `json:"recipeId"`
			RecipeRevision           string `json:"recipeRevision"`
			TechnicalProfileID       string `json:"technicalProfileId"`
			TechnicalProfileRevision string `json:"technicalProfileRevision"`
			Rules                    []struct {
				RuleID          string     `json:"ruleId"`
				RuleRevision    string     `json:"ruleRevision"`
				ParticipantRole string     `json:"participantRole"`
				OperationRole   string     `json:"operationRole"`
				EntryFace       string     `json:"entryFace"`
				OffsetMm        [3]float64 `json:"offsetMm"`
				Axis            [3]float64 `json:"axis"`
				DiameterMm      float64    `json:"diameterMm"`
				DepthMm         float64    `json:"depthMm"`
			} `json:"rules"`
		} `json:"recipe"`
		ExpectedOperations struct {
			Operations []struct {
				Participant     string     `json:"participant"`
				EntryFace       string     `json:"entryFace"`
				CenterLocalMm   [3]float64 `json:"centerLocalMm"`
				AxisLocal       [3]float64 `json:"axisLocal"`
				DiameterMm      float64    `json:"diameterMm"`
				DepthMm         float64    `json:"depthMm"`
				StationIndex    int        `json:"stationIndex"`
				ParticipantRole string     `json:"participantRole"`
				RuleID          string     `json:"ruleId"`
			} `json:"operations"`
		} `json:"expectedOperations"`
		Mutations struct {
			Cases []struct {
				Name   string `json:"name"`
				Change struct {
					StartMarginMm            *float64 `json:"startMarginMm"`
					EndMarginMm              *float64 `json:"endMarginMm"`
					Count                    *int     `json:"count"`
					RecipeRevision           string   `json:"recipeRevision"`
					TechnicalProfileRevision string   `json:"technicalProfileRevision"`
				} `json:"change"`
				ExpectedDistancesMm []float64 `json:"expectedDistancesMm"`
				Expected            struct {
					GeometryUnchanged                  bool   `json:"geometryUnchanged"`
					IdentityChanged                    bool   `json:"identityChanged"`
					FingerprintInputChanges            bool   `json:"fingerprintInputChanges"`
					ProvenanceRecipeRevision           string `json:"provenanceRecipeRevision"`
					ProvenanceTechnicalProfileRevision string `json:"provenanceTechnicalProfileRevision"`
				} `json:"expected"`
			} `json:"cases"`
		} `json:"mutations"`
	} `json:"contactScenario"`
	DemandScenario struct {
		Profile struct {
			ID       string `json:"id"`
			Revision string `json:"revision"`
			Items    []struct {
				HardwareID string  `json:"hardwareId"`
				Quantity   float64 `json:"quantity"`
			} `json:"items"`
		} `json:"profile"`
		VerifiedContacts int `json:"verifiedContacts"`
		ExpectedDemand   []struct {
			HardwareID string  `json:"hardwareId"`
			Quantity   float64 `json:"quantity"`
		} `json:"expectedDemand"`
	} `json:"demandScenario"`
}

func loadVerticalGolden(t *testing.T) verticalGolden {
	t.Helper()
	raw, err := os.ReadFile("../../../../contracts/hardwareProfileVertical.golden.json")
	if err != nil {
		t.Fatalf("read golden: %v", err)
	}
	var golden verticalGolden
	if err := json.Unmarshal(raw, &golden); err != nil {
		t.Fatalf("decode golden: %v", err)
	}
	return golden
}

func verticalGoldenScenario(t *testing.T, golden verticalGolden) ([]ContactBoard, ResolvedContact, StationSpec, ContactOperationRecipe) {
	t.Helper()
	scenario := golden.ContactScenario
	zero, one := [3]float64{}, [3]float64{1, 0, 0}
	shelf := ContactBoard{
		OccurrenceID: scenario.Contact.ParticipantA,
		WidthMm:      scenario.Boards.ShelfA.WidthMm, ThicknessMm: scenario.Boards.ShelfA.ThicknessMm, LengthMm: scenario.Boards.ShelfA.LengthMm,
		Basis:       LayoutBasis{X: one, Y: [3]float64{0, 1, 0}, Z: [3]float64{0, 0, 1}},
		Translation: zero,
	}
	side := ContactBoard{
		OccurrenceID: scenario.Contact.ParticipantB,
		WidthMm:      scenario.Boards.SideB.WidthMm, ThicknessMm: scenario.Boards.SideB.ThicknessMm, LengthMm: scenario.Boards.SideB.LengthMm,
		Basis:       LayoutBasis{X: [3]float64{1, 0, 0}, Y: [3]float64{0, 0, -1}, Z: [3]float64{0, 1, 0}},
		Translation: zero,
	}
	contact := ResolvedContact{
		ExplicitContact: ExplicitContact{
			ContactID: scenario.Contact.ContactID, RelationshipID: scenario.Contact.RelationshipID,
			ParticipantA: scenario.Contact.ParticipantA, ParticipantB: scenario.Contact.ParticipantB,
			FaceA: scenario.Contact.FaceA, FaceB: scenario.Contact.FaceB,
		},
		OverlapMm: [2]float64{0, 100},
	}
	contact.Frame.OriginAssemblyMm = scenario.Frame.OriginAssemblyMm
	contact.Frame.AxisAssembly = scenario.Frame.AxisAssembly
	contact.Frame.NormalAssembly = scenario.Frame.NormalAssembly
	spec := StationSpec{ContactID: scenario.Contact.ContactID, Count: scenario.Stations.Count,
		StartMarginMm: scenario.Stations.StartMarginMm, EndMarginMm: scenario.Stations.EndMarginMm}
	recipe := ContactOperationRecipe{ContactID: scenario.Contact.ContactID,
		RecipeID: scenario.Recipe.RecipeID, RecipeRevision: scenario.Recipe.RecipeRevision,
		TechnicalProfileID: scenario.Recipe.TechnicalProfileID, TechnicalProfileRevision: scenario.Recipe.TechnicalProfileRevision}
	for _, rule := range scenario.Recipe.Rules {
		recipe.Rules = append(recipe.Rules, ContactOperationRule{
			RuleID: rule.RuleID, RuleRevision: rule.RuleRevision,
			ParticipantRole: rule.ParticipantRole, OperationRole: rule.OperationRole,
			EntryFace: rule.EntryFace, OffsetMm: rule.OffsetMm, Axis: rule.Axis,
			DiameterMm: rule.DiameterMm, DepthMm: rule.DepthMm,
		})
	}
	return []ContactBoard{shelf, side}, contact, spec, recipe
}

func TestVerticalGoldenContactOperations(t *testing.T) {
	golden := loadVerticalGolden(t)
	boards, contact, spec, recipe := verticalGoldenScenario(t, golden)
	scenario := golden.ContactScenario

	// The planned stations must equal the hand-computed distances.
	planned := planResolvedContactStations(ContactResolutionResult{Contacts: []ResolvedContact{contact}},
		boards, []StationSpec{spec})
	if len(planned.Issues) != 0 || len(planned.Plans) != 1 {
		t.Fatalf("station planning failed: %+v", planned.Issues)
	}
	if len(planned.Plans[0].Stations) != len(scenario.Stations.DistancesMm) {
		t.Fatalf("station count = %d, want %d", len(planned.Plans[0].Stations), len(scenario.Stations.DistancesMm))
	}
	for i, station := range planned.Plans[0].Stations {
		if station.DistanceMm != scenario.Stations.DistancesMm[i] {
			t.Fatalf("station %d distance = %v, want %v", i, station.DistanceMm, scenario.Stations.DistancesMm[i])
		}
	}

	// The derived operations must match every hand-computed hole exactly.
	derived := deriveResolvedContactOperationsForContact(contact, planned.Plans[0], boards, spec, recipe)
	if len(derived.Issues) != 0 {
		t.Fatalf("operation derivation failed: %+v", derived.Issues)
	}
	expected := scenario.ExpectedOperations.Operations
	if len(derived.Operations) != len(expected) {
		t.Fatalf("operations = %d, want %d hand-computed holes", len(derived.Operations), len(expected))
	}
	byKey := map[string]NeutralContactOperation{}
	for _, op := range derived.Operations {
		byKey[fmt.Sprintf("%s|%s|%d", op.Provenance.ParticipantID, op.Provenance.RuleID, op.Provenance.StationIndex)] = op
	}
	for _, want := range expected {
		op, ok := byKey[fmt.Sprintf("%s|%s|%d", want.Participant, want.RuleID, want.StationIndex)]
		if !ok {
			t.Fatalf("missing hand-computed operation %s/%s/station %d", want.Participant, want.RuleID, want.StationIndex)
		}
		if op.EntryFace != want.EntryFace || op.DiameterMm != want.DiameterMm || op.DepthMm != want.DepthMm {
			t.Fatalf("operation %s/%s/%d geometry = %s d%v/%v, want %s d%v/%v",
				want.Participant, want.RuleID, want.StationIndex,
				op.EntryFace, op.DiameterMm, op.DepthMm, want.EntryFace, want.DiameterMm, want.DepthMm)
		}
		for i := range op.CenterLocalMm {
			if op.CenterLocalMm[i] != want.CenterLocalMm[i] || op.AxisLocal[i] != want.AxisLocal[i] {
				t.Fatalf("operation %s/%s/%d local = %v axis %v, want %v axis %v",
					want.Participant, want.RuleID, want.StationIndex,
					op.CenterLocalMm, op.AxisLocal, want.CenterLocalMm, want.AxisLocal)
			}
		}
		if op.TechnicalProfileID != scenario.Recipe.TechnicalProfileID ||
			op.TechnicalProfileRevision != scenario.Recipe.TechnicalProfileRevision ||
			op.Provenance.RecipeID != scenario.Recipe.RecipeID || op.Provenance.RecipeRevision != scenario.Recipe.RecipeRevision {
			t.Fatalf("provenance = %+v / profile %s@%s", op.Provenance, op.TechnicalProfileID, op.TechnicalProfileRevision)
		}
	}
}

func TestVerticalGoldenMutations(t *testing.T) {
	golden := loadVerticalGolden(t)
	for _, mutation := range golden.ContactScenario.Mutations.Cases {
		t.Run(mutation.Name, func(t *testing.T) {
			boards, contact, spec, recipe := verticalGoldenScenario(t, golden)
			if mutation.Change.StartMarginMm != nil {
				spec.StartMarginMm = *mutation.Change.StartMarginMm
			}
			if mutation.Change.EndMarginMm != nil {
				spec.EndMarginMm = *mutation.Change.EndMarginMm
			}
			if mutation.Change.Count != nil {
				spec.Count = *mutation.Change.Count
			}
			if mutation.Change.RecipeRevision != "" {
				recipe.RecipeRevision = mutation.Change.RecipeRevision
			}
			if mutation.Change.TechnicalProfileRevision != "" {
				recipe.TechnicalProfileRevision = mutation.Change.TechnicalProfileRevision
			}
			planned := planResolvedContactStations(ContactResolutionResult{Contacts: []ResolvedContact{contact}},
				boards, []StationSpec{spec})
			if len(planned.Issues) != 0 || len(planned.Plans) != 1 {
				t.Fatalf("planning failed: %+v", planned.Issues)
			}
			if mutation.ExpectedDistancesMm != nil {
				if len(planned.Plans[0].Stations) != len(mutation.ExpectedDistancesMm) {
					t.Fatalf("stations = %d, want %d", len(planned.Plans[0].Stations), len(mutation.ExpectedDistancesMm))
				}
				for i, station := range planned.Plans[0].Stations {
					if station.DistanceMm != mutation.ExpectedDistancesMm[i] {
						t.Fatalf("station %d = %v, want %v", i, station.DistanceMm, mutation.ExpectedDistancesMm[i])
					}
				}
			}
			derived := deriveResolvedContactOperationsForContact(contact, planned.Plans[0], boards, spec, recipe)
			if len(derived.Issues) != 0 {
				t.Fatalf("derivation failed: %+v", derived.Issues)
			}
			if mutation.Expected.GeometryUnchanged {
				base, _, baseSpec, baseRecipe := verticalGoldenScenario(t, golden)
				basePlanned := planResolvedContactStations(ContactResolutionResult{Contacts: []ResolvedContact{contact}},
					base, []StationSpec{baseSpec})
				baseDerived := deriveResolvedContactOperationsForContact(contact, basePlanned.Plans[0], base, baseSpec, baseRecipe)
				if len(baseDerived.Operations) != len(derived.Operations) {
					t.Fatalf("geometry must not change: %d vs %d operations", len(baseDerived.Operations), len(derived.Operations))
				}
				for i, op := range derived.Operations {
					if op.CenterLocalMm != baseDerived.Operations[i].CenterLocalMm ||
						op.DiameterMm != baseDerived.Operations[i].DiameterMm || op.DepthMm != baseDerived.Operations[i].DepthMm {
						t.Fatalf("geometry must not change at operation %d", i)
					}
					// The declared identity contract: a RECIPE revision bump
					// moves the technical identity of EVERY operation; a
					// PROFILE revision bump keeps it (recipe-scoped identity)
					// while the fingerprint input still carries the profile.
					if mutation.Expected.IdentityChanged && op.OperationID == baseDerived.Operations[i].OperationID {
						t.Fatalf("revision bump must change the technical operation identity at operation %d", i)
					}
					if mutation.Change.TechnicalProfileRevision != "" && op.OperationID != baseDerived.Operations[i].OperationID {
						t.Fatalf("profile revision bump must NOT change the recipe-scoped operation identity at operation %d", i)
					}
				}
			}
			if mutation.Expected.ProvenanceRecipeRevision != "" {
				if derived.Operations[0].Provenance.RecipeRevision != mutation.Expected.ProvenanceRecipeRevision {
					t.Fatalf("recipe revision provenance = %q", derived.Operations[0].Provenance.RecipeRevision)
				}
			}
			if mutation.Expected.ProvenanceTechnicalProfileRevision != "" {
				if derived.Operations[0].TechnicalProfileRevision != mutation.Expected.ProvenanceTechnicalProfileRevision {
					t.Fatalf("profile revision provenance = %q", derived.Operations[0].TechnicalProfileRevision)
				}
			}
		})
	}
}

func TestVerticalGoldenDemand(t *testing.T) {
	golden := loadVerticalGolden(t)
	demand := golden.DemandScenario

	// One governed relationship, two VERIFIED contacts, one operation whose
	// provenance names the pinned profile (#917: the demand source is the
	// profile RESOLUTION, never the drilling output).
	machining := &AuthoringMachining{
		Operations: []ResolvedMachiningOperation{{
			OperationID: "golden-op-1",
			Provenance: ResolvedMachiningProvenance{
				SourceKind: "relationship", RelationshipID: "golden-relationship-1",
				TechnicalProfileID: demand.Profile.ID,
			},
		}},
		JoineryStatuses: []JoineryRelationshipStatus{{
			RelationshipID: "golden-relationship-1", Stage: JoineryMachiningReady,
			Contacts: []JoineryContactStatus{{Status: "VALID"}, {Status: "VALID"}},
		}},
	}
	profiles := map[string]domain.HardwareProfile{
		demand.Profile.ID: {
			ID: demand.Profile.ID, Revision: demand.Profile.Revision, Active: true,
			Items: func() []domain.HardwareProfileItem {
				items := make([]domain.HardwareProfileItem, 0, len(demand.Profile.Items))
				for _, item := range demand.Profile.Items {
					items = append(items, domain.HardwareProfileItem{HardwareID: item.HardwareID, Quantity: item.Quantity})
				}
				return items
			}(),
		},
	}

	lines := DeriveHardwareProfileDemand(machining, profiles)
	if len(lines) != len(demand.ExpectedDemand) {
		t.Fatalf("demand lines = %d, want %d", len(lines), len(demand.ExpectedDemand))
	}
	byHardware := map[string]float64{}
	for _, line := range lines {
		byHardware[line.HardwareID] = line.Quantity
	}
	for _, want := range demand.ExpectedDemand {
		if byHardware[want.HardwareID] != want.Quantity {
			t.Fatalf("demand %s = %v, want %v (items x %d verified contacts)",
				want.HardwareID, byHardware[want.HardwareID], want.Quantity, demand.VerifiedContacts)
		}
	}
}

func TestVerticalGoldenFailClosedWithoutProfile(t *testing.T) {
	golden := loadVerticalGolden(t)
	boards, contact, spec, recipe := verticalGoldenScenario(t, golden)
	// The scenario without a verified technical profile is no-fabricable.
	recipe.TechnicalProfileID = ""
	recipe.TechnicalProfileRevision = ""
	planned := planResolvedContactStations(ContactResolutionResult{Contacts: []ResolvedContact{contact}},
		boards, []StationSpec{spec})
	derived := deriveResolvedContactOperationsForContact(contact, planned.Plans[0], boards, spec, recipe)
	if len(derived.Operations) != 0 {
		t.Fatalf("ungoverned joint must fabricate nothing, got %d operations", len(derived.Operations))
	}
	codes := map[string]bool{}
	for _, issue := range derived.Issues {
		codes[issue.Code] = true
	}
	if !codes["TECHNICAL_PROFILE_REQUIRED"] {
		t.Fatalf("ungoverned joint must carry TECHNICAL_PROFILE_REQUIRED, got %+v", derived.Issues)
	}
}

// #919 acceptance: mutation ISOLATION — mutating one contact's pattern must
// leave an unrelated contact's operations untouched, and a recipe-revision
// bump must change the technical operation identity (the fingerprint input)
// without moving any geometry. The second contact is the same governed joint
// against a second side panel: B2 intentionally shares B's assembly
// geometry, because this test validates INDEPENDENT CONTACT STATE (own spec
// entry, own frame instance, own recipes) — never collision detection.
func TestVerticalGoldenMutationIsolationAndIdentity(t *testing.T) {
	golden := loadVerticalGolden(t)
	boards, contact, spec, recipe := verticalGoldenScenario(t, golden)

	// B2 coincides with B in assembly space on purpose: this layer has no
	// collision authority, and the isolation test needs an INDEPENDENT
	// contact state (own spec entry, own frame instance, own recipes), not
	// distinct geometry.
	sideB2 := boards[1]
	sideB2.OccurrenceID = "side-B2"
	boards = append(boards, sideB2)

	unrelated := ResolvedContact{
		ExplicitContact: ExplicitContact{
			ContactID: "golden-contact-2", RelationshipID: contact.RelationshipID,
			ParticipantA: contact.ParticipantA, ParticipantB: "side-B2",
			FaceA: "bottom", FaceB: "back",
		},
		OverlapMm: [2]float64{0, 100},
	}
	unrelated.Frame.OriginAssemblyMm = [3]float64{0, 9, 0}
	unrelated.Frame.AxisAssembly = [3]float64{1, 0, 0}
	unrelated.Frame.NormalAssembly = [3]float64{0, 0, -1}

	specs := []StationSpec{spec,
		{ContactID: unrelated.ContactID, Count: 2, StartMarginMm: 20, EndMarginMm: 20}}
	recipes := []ContactOperationRecipe{recipe,
		{ContactID: unrelated.ContactID, RecipeID: recipe.RecipeID, RecipeRevision: recipe.RecipeRevision,
			TechnicalProfileID: recipe.TechnicalProfileID, TechnicalProfileRevision: recipe.TechnicalProfileRevision,
			Rules: recipe.Rules}}

	planned := planResolvedContactStations(
		ContactResolutionResult{Contacts: []ResolvedContact{contact, unrelated}}, boards, specs)
	if len(planned.Issues) != 0 || len(planned.Plans) != 2 {
		t.Fatalf("two-contact planning failed: %+v", planned.Issues)
	}
	derived := deriveResolvedContactOperations(
		ContactResolutionResult{Contacts: []ResolvedContact{contact, unrelated}}, planned, boards, specs, recipes)
	if len(derived.Issues) != 0 {
		t.Fatalf("two-contact derivation failed: %+v", derived.Issues)
	}
	opsByContact := map[string][]NeutralContactOperation{}
	for _, op := range derived.Operations {
		opsByContact[op.Provenance.ContactID] = append(opsByContact[op.Provenance.ContactID], op)
	}
	if len(opsByContact[contact.ContactID]) != 4 || len(opsByContact[unrelated.ContactID]) != 4 {
		t.Fatalf("each governed contact must keep its own 4 operations: %+v", opsByContact)
	}

	// Mutate ONLY the first contact's margins; the second must be untouched.
	specs[0].StartMarginMm, specs[0].EndMarginMm = 10, 30
	plannedMutated := planResolvedContactStations(
		ContactResolutionResult{Contacts: []ResolvedContact{contact, unrelated}}, boards, specs)
	derivedMutated := deriveResolvedContactOperations(
		ContactResolutionResult{Contacts: []ResolvedContact{contact, unrelated}}, plannedMutated, boards, specs, recipes)
	if len(derivedMutated.Issues) != 0 {
		t.Fatalf("mutated derivation failed: %+v", derivedMutated.Issues)
	}
	untouched := map[string][]NeutralContactOperation{}
	for _, op := range derivedMutated.Operations {
		untouched[op.Provenance.ContactID] = append(untouched[op.Provenance.ContactID], op)
	}
	if len(untouched[unrelated.ContactID]) != 4 {
		t.Fatalf("the unrelated contact must keep all its operations")
	}
	for i, op := range untouched[unrelated.ContactID] {
		if op != opsByContact[unrelated.ContactID][i] {
			t.Fatalf("unrelated contact operation %d changed under an unrelated mutation", i)
		}
	}
	if len(untouched[contact.ContactID]) != 4 {
		t.Fatalf("the mutated contact must keep its operation count")
	}

	// Recipe-revision bump: geometry identical, technical identity changes
	// (the operation ID is the fingerprint input that moves).
	bumped := recipe
	bumped.RecipeRevision = "golden-2"
	derivedBumped := deriveResolvedContactOperationsForContact(contact, planned.Plans[0], boards, spec, bumped)
	base := deriveResolvedContactOperationsForContact(contact, planned.Plans[0], boards, spec, recipe)
	if len(derivedBumped.Operations) != len(base.Operations) {
		t.Fatalf("revision bump must not change the geometry count")
	}
	for i, op := range derivedBumped.Operations {
		if op.CenterLocalMm != base.Operations[i].CenterLocalMm || op.DepthMm != base.Operations[i].DepthMm {
			t.Fatalf("revision bump must not move geometry at operation %d", i)
		}
		if op.OperationID == base.Operations[i].OperationID {
			t.Fatalf("revision bump must change the technical operation identity at operation %d", i)
		}
	}
}

// #919 acceptance: price per unit comes from the Hardware rows; the golden's
// demand arithmetic (items x contacts) prices out exactly as documented.
func TestVerticalGoldenDemandCost(t *testing.T) {
	golden := loadVerticalGolden(t)
	goldenBytes, err := json.Marshal(golden)
	if err != nil {
		t.Fatalf("re-encode golden: %v", err)
	}
	var raw struct {
		BomScenario struct {
			Hardware []struct {
				ID          string  `json:"id"`
				Code        string  `json:"code"`
				CostPerUnit float64 `json:"costPerUnit"`
			} `json:"hardware"`
			ExpectedHardwareDemand struct {
				Lines []struct {
					HardwareID string  `json:"hardwareId"`
					Quantity   float64 `json:"quantity"`
					UnitCost   float64 `json:"unitCost"`
					LineCost   float64 `json:"lineCost"`
				} `json:"lines"`
				TotalCost float64 `json:"totalCost"`
			} `json:"expectedHardwareDemand"`
		} `json:"bomScenario"`
	}
	if err := json.Unmarshal(goldenBytes, &raw); err != nil {
		t.Fatalf("decode bom scenario: %v", err)
	}
	prices := map[string]float64{}
	for _, hw := range raw.BomScenario.Hardware {
		prices[hw.ID] = hw.CostPerUnit
	}
	total := 0.0
	for _, line := range raw.BomScenario.ExpectedHardwareDemand.Lines {
		unit, ok := prices[line.HardwareID]
		if !ok {
			t.Fatalf("demand line %s has no Hardware row", line.HardwareID)
		}
		if unit != line.UnitCost || line.Quantity*unit != line.LineCost {
			t.Fatalf("line %s: qty %v x unit %v must equal line cost %v", line.HardwareID, line.Quantity, unit, line.LineCost)
		}
		total += line.LineCost
	}
	if total != raw.BomScenario.ExpectedHardwareDemand.TotalCost {
		t.Fatalf("total cost = %v, want %v (no double counting)", total, raw.BomScenario.ExpectedHardwareDemand.TotalCost)
	}
}

// #919 review pass: the machining fingerprint INPUT carries the technical
// profile identity — a profile revision bump moves the fingerprint even
// though the recipe-scoped OperationID stays stable.
func TestVerticalGoldenFingerprintInputCarriesProfileRevision(t *testing.T) {
	golden := loadVerticalGolden(t)
	base := ResolvedMachiningProvenance{SourceKind: "relationship", RelationshipID: "golden-relationship-1",
		RecipeRevision:     golden.ContactScenario.Recipe.RecipeRevision,
		TechnicalProfileID: golden.ContactScenario.Recipe.TechnicalProfileID, TechnicalProfileRevision: "rev-1"}
	bumped := base
	bumped.TechnicalProfileRevision = "rev-2"
	baseJSON, err := json.Marshal(base.canonical())
	if err != nil {
		t.Fatal(err)
	}
	bumpedJSON, err := json.Marshal(bumped.canonical())
	if err != nil {
		t.Fatal(err)
	}
	if string(baseJSON) == string(bumpedJSON) {
		t.Fatalf("the fingerprint input must carry the technical profile revision: %s", baseJSON)
	}
	if !containsField(baseJSON, "technicalProfileRevision") {
		t.Fatalf("fingerprint input drops technicalProfileRevision: %s", baseJSON)
	}
}

func containsField(raw []byte, field string) bool {
	return len(raw) > 0 && strings.Contains(string(raw), `"`+field+`"`)
}
