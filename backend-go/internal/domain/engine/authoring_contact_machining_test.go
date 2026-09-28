package engine

import (
	"encoding/json"
	"math"
	"os"
	"reflect"
	"slices"
	"testing"
)

type j1ContactFixture struct {
	Boards               []ContactBoard            `json:"boards"`
	Contacts             []ExplicitContact         `json:"contacts"`
	RequiredContactIDs   []string                  `json:"requiredContactIds"`
	Expected             []ResolvedContact         `json:"expected"`
	StationSpecs         []StationSpec             `json:"stationSpecs"`
	ExpectedStationPlans []StationPlan             `json:"expectedStationPlans"`
	OperationRecipes     []ContactOperationRecipe  `json:"operationRecipes"`
	ExpectedOperations   []NeutralContactOperation `json:"expectedOperations"`
}

func TestJ1PairedContactOperations(t *testing.T) {
	f := readJ1ContactFixture(t)
	resolution := resolveExplicitContacts(f.Boards, f.Contacts, f.RequiredContactIDs)
	plans := planResolvedContactStations(resolution, f.Boards, f.StationSpecs)
	if len(resolution.Issues) != 0 || len(plans.Issues) != 0 {
		t.Fatalf("invalid shared fixture: %+v %+v", resolution.Issues, plans.Issues)
	}
	for index := range resolution.Contacts {
		got := deriveResolvedContactOperationsForContact(resolution.Contacts[index], plans.Plans[index],
			f.Boards, f.StationSpecs[index], f.OperationRecipes[index])
		want := f.ExpectedOperations[:6]
		if index == 1 {
			want = f.ExpectedOperations[6:]
		}
		if len(got.Issues) != 0 || len(got.Operations) != len(want) {
			t.Fatalf("contact %d should produce complete paired operations: %+v", index, got)
		}
		ids := map[string]bool{}
		for i, operation := range got.Operations {
			if operation.OperationID == "" || ids[operation.OperationID] {
				t.Fatalf("missing or duplicate operation identity: %+v", operation)
			}
			ids[operation.OperationID] = true
			if !reflect.DeepEqual(operation, want[i]) {
				t.Fatalf("contact %d operation %d: got %+v want %+v", index, i, operation, want[i])
			}
		}
	}
	t.Run("escaped identity parity", func(t *testing.T) {
		contact := resolution.Contacts[0]
		contact.RelationshipID = "rel<>&\u2028\u2029"
		got := deriveResolvedContactOperationsForContact(contact, plans.Plans[0], f.Boards, f.StationSpecs[0], f.OperationRecipes[0])
		want := `j1:["rel\u003c\u003e\u0026\u2028\u2029","floor-left","floor-1",0,"synthetic-j1","test-1","pilot","test-1","pilot"]`
		if len(got.Issues) != 0 || len(got.Operations) == 0 || got.Operations[0].OperationID != want {
			t.Fatalf("escaped identity parity failed: got %+v, want %q", got, want)
		}
	})
	moved := readJ1ContactFixture(t)
	for i := range moved.Boards {
		moved.Boards[i].Translation[0] += 73
		moved.Boards[i].Translation[1] -= 41
		moved.Boards[i].Translation[2] += 19
	}
	movedResolution := resolveExplicitContacts(moved.Boards, moved.Contacts, moved.RequiredContactIDs)
	movedPlans := planResolvedContactStations(movedResolution, moved.Boards, moved.StationSpecs)
	for index := range movedResolution.Contacts {
		original := deriveResolvedContactOperationsForContact(resolution.Contacts[index], plans.Plans[index],
			f.Boards, f.StationSpecs[index], f.OperationRecipes[index])
		translated := deriveResolvedContactOperationsForContact(movedResolution.Contacts[index], movedPlans.Plans[index],
			moved.Boards, moved.StationSpecs[index], moved.OperationRecipes[index])
		if len(translated.Issues) != 0 || !reflect.DeepEqual(translated.Operations, original.Operations) {
			t.Fatalf("rigid translation changed local machining for contact %d: %+v", index, translated)
		}
	}
}

func TestJ1PairedContactNegatives(t *testing.T) {
	cases := []struct {
		name, code string
		change     func(*j1ContactFixture, *ResolvedContact, *StationPlan, *StationSpec, *ContactOperationRecipe)
	}{
		{"profile missing", "TECHNICAL_PROFILE_REQUIRED", func(_ *j1ContactFixture, _ *ResolvedContact, _ *StationPlan, _ *StationSpec, r *ContactOperationRecipe) {
			r.TechnicalProfileID = ""
		}},
		{"recipe revision missing", "OPERATION_RECIPE_INVALID", func(_ *j1ContactFixture, _ *ResolvedContact, _ *StationPlan, _ *StationSpec, r *ContactOperationRecipe) {
			r.RecipeRevision = ""
		}},
		{"participant rule missing", "OPERATION_PARTICIPANT_RULE_MISSING", func(_ *j1ContactFixture, _ *ResolvedContact, _ *StationPlan, _ *StationSpec, r *ContactOperationRecipe) {
			r.Rules = r.Rules[:1]
		}},
		{"duplicate rule", "OPERATION_RULE_INVALID", func(_ *j1ContactFixture, _ *ResolvedContact, _ *StationPlan, _ *StationSpec, r *ContactOperationRecipe) {
			r.Rules = append(r.Rules, r.Rules[0])
		}},
		{"duplicate machining with distinct rule IDs", "OPERATION_GEOMETRY_DUPLICATE", func(_ *j1ContactFixture, _ *ResolvedContact, _ *StationPlan, _ *StationSpec, r *ContactOperationRecipe) {
			copy := r.Rules[1]
			copy.RuleID = "counterbore-copy"
			r.Rules = append(r.Rules, copy)
		}},
		{"wrong entry face", "OPERATION_GEOMETRY_INVALID", func(_ *j1ContactFixture, _ *ResolvedContact, _ *StationPlan, _ *StationSpec, r *ContactOperationRecipe) {
			r.Rules[1].EntryFace = "front"
		}},
		{"outward axis", "OPERATION_GEOMETRY_INVALID", func(_ *j1ContactFixture, _ *ResolvedContact, _ *StationPlan, _ *StationSpec, r *ContactOperationRecipe) {
			r.Rules[1].Axis = [3]float64{0, 1, 0}
		}},
		{"excess depth", "OPERATION_GEOMETRY_INVALID", func(_ *j1ContactFixture, _ *ResolvedContact, _ *StationPlan, _ *StationSpec, r *ContactOperationRecipe) {
			r.Rules[1].DepthMm = 19
		}},
		{"oblique swept-cylinder edge breach", "OPERATION_GEOMETRY_INVALID", func(_ *j1ContactFixture, _ *ResolvedContact, _ *StationPlan, _ *StationSpec, r *ContactOperationRecipe) {
			r.Rules[1].OffsetMm = [3]float64{-50, 18, 0}
			r.Rules[1].Axis = [3]float64{-0.7, -math.Sqrt(0.51), 0}
			r.Rules[1].DiameterMm = 12
			r.Rules[1].DepthMm = 10
		}},
		{"nonfinite diameter", "OPERATION_RULE_INVALID", func(_ *j1ContactFixture, _ *ResolvedContact, _ *StationPlan, _ *StationSpec, r *ContactOperationRecipe) {
			r.Rules[1].DiameterMm = math.Inf(1)
		}},
		{"edge breach", "OPERATION_GEOMETRY_INVALID", func(_ *j1ContactFixture, _ *ResolvedContact, _ *StationPlan, _ *StationSpec, r *ContactOperationRecipe) {
			r.Rules[1].DiameterMm = 60
		}},
		{"nonuniform station", "OPERATION_PLAN_INVALID", func(_ *j1ContactFixture, _ *ResolvedContact, p *StationPlan, _ *StationSpec, _ *ContactOperationRecipe) {
			p.Stations[1].DistanceMm = 241
			p.Stations[1].AssemblyPointMm = [3]float64{18, 271, 27}
			p.Stations[1].ParticipantALocalMm = [3]float64{241, 9, 0}
			p.Stations[1].ParticipantBLocalMm = [3]float64{289, 18, 27}
		}},
		{"shifted endpoint", "OPERATION_PLAN_INVALID", func(_ *j1ContactFixture, _ *ResolvedContact, p *StationPlan, _ *StationSpec, _ *ContactOperationRecipe) {
			p.Stations[0].DistanceMm = 31
			p.Stations[0].AssemblyPointMm = [3]float64{18, 61, 27}
			p.Stations[0].ParticipantALocalMm = [3]float64{31, 9, 0}
			p.Stations[0].ParticipantBLocalMm = [3]float64{499, 18, 27}
		}},
		{"wrong plan identity", "OPERATION_IDENTITY_INVALID", func(_ *j1ContactFixture, _ *ResolvedContact, p *StationPlan, _ *StationSpec, _ *ContactOperationRecipe) {
			p.ContactID = "floor-right"
		}},
		{"duplicate occurrence", "OPERATION_PARTICIPANT_INVALID", func(f *j1ContactFixture, _ *ResolvedContact, _ *StationPlan, _ *StationSpec, _ *ContactOperationRecipe) {
			f.Boards = append(f.Boards, f.Boards[0])
		}},
		{"null decoded basis", "OPERATION_PARTICIPANT_INVALID", func(f *j1ContactFixture, _ *ResolvedContact, _ *StationPlan, _ *StationSpec, _ *ContactOperationRecipe) {
			f.Boards[1].Basis = LayoutBasis{}
		}},
		{"missing relationship", "OPERATION_IDENTITY_INVALID", func(_ *j1ContactFixture, c *ResolvedContact, _ *StationPlan, _ *StationSpec, _ *ContactOperationRecipe) {
			c.RelationshipID = ""
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := readJ1ContactFixture(t)
			resolved := resolveExplicitContacts(f.Boards, f.Contacts, f.RequiredContactIDs)
			plans := planResolvedContactStations(resolved, f.Boards, f.StationSpecs)
			contact, plan, spec, recipe := resolved.Contacts[0], plans.Plans[0], f.StationSpecs[0], f.OperationRecipes[0]
			tc.change(&f, &contact, &plan, &spec, &recipe)
			got := deriveResolvedContactOperationsForContact(contact, plan, f.Boards, spec, recipe)
			if len(got.Operations) != 0 || len(got.Issues) == 0 || got.Issues[0].Code != tc.code {
				t.Fatalf("expected %s with no partial operations, got %+v", tc.code, got)
			}
		})
	}
}

func TestJ1MalformedContactVectorsRejectedByGoDecoder(t *testing.T) {
	var nullBasis ContactBoard
	if err := json.Unmarshal([]byte(`{"basis":null}`), &nullBasis); err != nil || nullBasis.Basis != (LayoutBasis{}) {
		t.Fatalf("Go decoder did not produce an invalid zero basis from null: %+v, %v", nullBasis, err)
	}
	for _, payload := range []string{`{"frame":{"originAssemblyMm":1}}`, `{"frame":{"axisAssembly":1}}`,
		`{"frame":{"normalAssembly":1}}`} {
		var contact ResolvedContact
		if err := json.Unmarshal([]byte(payload), &contact); err == nil {
			t.Fatalf("Go decoder accepted malformed contact vector: %s", payload)
		}
	}
	for _, payload := range []string{`{"translationMm":1}`, `{"basis":{"x":1}}`} {
		var board ContactBoard
		if err := json.Unmarshal([]byte(payload), &board); err == nil {
			t.Fatalf("Go decoder accepted malformed participant vector: %s", payload)
		}
	}
}

func TestJ1PairedContactRuleOrder(t *testing.T) {
	f := readJ1ContactFixture(t)
	resolved := resolveExplicitContacts(f.Boards, f.Contacts, f.RequiredContactIDs)
	plans := planResolvedContactStations(resolved, f.Boards, f.StationSpecs)
	recipe := f.OperationRecipes[0]
	extra := recipe.Rules[1]
	extra.RuleID, extra.OperationRole = "Z-copy", "counterbore-alt"
	extra.OffsetMm = [3]float64{0, 18, 10}
	recipe.Rules = append(recipe.Rules, extra)
	got := deriveResolvedContactOperationsForContact(resolved.Contacts[0], plans.Plans[0], f.Boards, f.StationSpecs[0], recipe)
	if len(got.Issues) != 0 || len(got.Operations) != 9 {
		t.Fatalf("expected ordered complete operation set, got %+v", got)
	}
	if got.Operations[0].Provenance.RuleID != "pilot" || got.Operations[1].Provenance.RuleID != "Z-copy" ||
		got.Operations[2].Provenance.RuleID != "counterbore" {
		t.Fatalf("rule order must use codepoint IDs, got %+v", got.Operations[:3])
	}
}

func TestJ1PairedContactUnicodeRuleOrder(t *testing.T) {
	f := readJ1ContactFixture(t)
	resolved := resolveExplicitContacts(f.Boards, f.Contacts, f.RequiredContactIDs)
	plans := planResolvedContactStations(resolved, f.Boards, f.StationSpecs)
	recipe := f.OperationRecipes[0]
	for _, item := range []struct {
		id, role string
		offset   float64
	}{{"😀", "supplementary", 10}, {"\uE000", "bmp", 20}} {
		rule := recipe.Rules[1]
		rule.RuleID, rule.OperationRole, rule.OffsetMm = item.id, item.role, [3]float64{0, 18, item.offset}
		recipe.Rules = append(recipe.Rules, rule)
	}
	got := deriveResolvedContactOperationsForContact(resolved.Contacts[0], plans.Plans[0], f.Boards, f.StationSpecs[0], recipe)
	if len(got.Issues) != 0 || len(got.Operations) != 12 {
		t.Fatalf("expected complete Unicode rule set, got %+v", got)
	}
	want := []string{"pilot", "counterbore", "\uE000", "😀"}
	for i, ruleID := range want {
		if got.Operations[i].Provenance.RuleID != ruleID {
			t.Fatalf("Unicode scalar rule order: got %+v want %+v", got.Operations[:4], want)
		}
	}
}

func TestJ1StationPlans(t *testing.T) {
	f := readJ1ContactFixture(t)
	resolved := resolveExplicitContacts(f.Boards, f.Contacts, f.RequiredContactIDs)
	result := planResolvedContactStations(resolved, f.Boards, f.StationSpecs)
	if len(result.Issues) != 0 || !reflect.DeepEqual(result.Plans, f.ExpectedStationPlans) {
		t.Fatalf("shared independent station distances/assembly/both locals: got=%+v want=%+v", result, f.ExpectedStationPlans)
	}
	neighbor := f.Boards[1]
	neighbor.OccurrenceID = "unanchored-neighbor"
	boards := append(f.Boards, neighbor)
	slices.Reverse(boards)
	contacts := append([]ExplicitContact(nil), f.Contacts...)
	slices.Reverse(contacts)
	reordered := planResolvedContactStations(resolveExplicitContacts(boards, contacts, f.RequiredContactIDs), boards, f.StationSpecs)
	if !reflect.DeepEqual(reordered, result) {
		t.Fatalf("reorder/neighbor changed stations: %+v", reordered)
	}
}

func TestJ1UnicodeContactAndStationOrder(t *testing.T) {
	f := readJ1ContactFixture(t)
	ids := []string{"😀", "\uE000"}
	for i := range f.Contacts {
		f.Contacts[i].ContactID = ids[i]
		f.StationSpecs[i].ContactID = ids[i]
	}
	resolved := resolveExplicitContacts(f.Boards, f.Contacts, ids)
	if len(resolved.Issues) != 0 || len(resolved.Contacts) != 2 || resolved.Contacts[0].ContactID != "\uE000" || resolved.Contacts[1].ContactID != "😀" {
		t.Fatalf("Unicode scalar contact order diverged: %+v", resolved)
	}
	planned := planResolvedContactStations(resolved, f.Boards, f.StationSpecs)
	if len(planned.Issues) != 0 || len(planned.Plans) != 2 || planned.Plans[0].ContactID != "\uE000" || planned.Plans[1].ContactID != "😀" {
		t.Fatalf("Unicode scalar station order diverged: %+v", planned)
	}
}

func TestJ1StationRigidFramesAndOccurrences(t *testing.T) {
	f := readJ1ContactFixture(t)
	for _, tc := range []struct {
		name      string
		transform func([3]float64) [3]float64
	}{
		{"translation", func(v [3]float64) [3]float64 { return [3]float64{v[0] + 73, v[1] - 41, v[2] + 19} }},
		{"rotation", func(v [3]float64) [3]float64 { return [3]float64{-v[1], v[0], v[2]} }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			boards := append([]ContactBoard(nil), f.Boards...)
			zero := tc.transform([3]float64{})
			for i := range boards {
				b := &boards[i]
				b.Translation = tc.transform(b.Translation)
				b.Basis.X = contactDelta(tc.transform(b.Basis.X), zero)
				b.Basis.Y = contactDelta(tc.transform(b.Basis.Y), zero)
				b.Basis.Z = contactDelta(tc.transform(b.Basis.Z), zero)
			}
			result := planResolvedContactStations(resolveExplicitContacts(boards, f.Contacts, f.RequiredContactIDs), boards, f.StationSpecs)
			if len(result.Issues) != 0 || len(result.Plans) != len(f.ExpectedStationPlans) {
				t.Fatalf("rigid frame: %+v", result)
			}
			for i, p := range result.Plans {
				for j, s := range p.Stations {
					want := f.ExpectedStationPlans[i].Stations[j]
					if s.DistanceMm != want.DistanceMm || s.ParticipantALocalMm != want.ParticipantALocalMm || s.ParticipantBLocalMm != want.ParticipantBLocalMm || s.AssemblyPointMm != tc.transform(want.AssemblyPointMm) {
						t.Fatalf("station changed: %+v want transformed %+v", s, want)
					}
				}
			}
		})
	}
	boards := append([]ContactBoard(nil), f.Boards...)
	contacts := append([]ExplicitContact(nil), f.Contacts...)
	specs := append([]StationSpec(nil), f.StationSpecs...)
	for _, b := range f.Boards {
		b.OccurrenceID = "second:" + b.OccurrenceID
		b.Translation[0] += 1000
		boards = append(boards, b)
	}
	for _, c := range f.Contacts {
		c.RelationshipID = "second:" + c.RelationshipID
		c.ContactID = "second:" + c.ContactID
		c.ParticipantA = "second:" + c.ParticipantA
		c.ParticipantB = "second:" + c.ParticipantB
		contacts = append(contacts, c)
	}
	for _, s := range f.StationSpecs {
		s.ContactID = "second:" + s.ContactID
		specs = append(specs, s)
	}
	result := planResolvedContactStations(resolveExplicitContacts(boards, contacts, nil), boards, specs)
	if len(result.Issues) != 0 || len(result.Plans) != 4 {
		t.Fatalf("separate occurrence plans: %+v", result)
	}
	for i, p := range result.Plans[2:] {
		for j, s := range p.Stations {
			want := f.ExpectedStationPlans[i].Stations[j]
			want.AssemblyPointMm[0] += 1000
			if s.DistanceMm != want.DistanceMm || s.AssemblyPointMm != want.AssemblyPointMm || s.ParticipantALocalMm != want.ParticipantALocalMm || s.ParticipantBLocalMm != want.ParticipantBLocalMm {
				t.Fatalf("second occurrence mixed: %+v", s)
			}
		}
	}
}

func TestJ1StationNegatives(t *testing.T) {
	cases := []struct {
		name, code string
		change     func(*j1ContactFixture)
	}{
		{"zero count", "STATION_COUNT_INVALID", func(f *j1ContactFixture) { f.StationSpecs[0].Count = 0 }},
		{"single without anchor", "STATION_COUNT_INVALID", func(f *j1ContactFixture) { f.StationSpecs[0].Count = 1 }},
		{"negative count", "STATION_COUNT_INVALID", func(f *j1ContactFixture) { f.StationSpecs[0].Count = -1 }},
		{"negative margin", "STATION_MARGIN_INVALID", func(f *j1ContactFixture) { f.StationSpecs[0].StartMarginMm = -1 }},
		{"nonfinite margin", "STATION_MARGIN_INVALID", func(f *j1ContactFixture) { f.StationSpecs[0].EndMarginMm = math.NaN() }},
		{"consumed span", "STATION_SPAN_INVALID", func(f *j1ContactFixture) { f.StationSpecs[0].StartMarginMm = 250; f.StationSpecs[0].EndMarginMm = 250 }},
		{"beyond span", "STATION_SPAN_INVALID", func(f *j1ContactFixture) { f.StationSpecs[0].StartMarginMm = 501 }},
		{"missing policy", "STATION_SPEC_MISSING", func(f *j1ContactFixture) { f.StationSpecs = f.StationSpecs[1:] }},
		{"duplicate policy", "STATION_SPEC_AMBIGUOUS", func(f *j1ContactFixture) { f.StationSpecs = append(f.StationSpecs, f.StationSpecs[0]) }},
		{"missing participant", "STATION_PARTICIPANT_INVALID", func(f *j1ContactFixture) { f.Boards = f.Boards[1:] }},
		{"bad basis", "STATION_PARTICIPANT_INVALID", func(f *j1ContactFixture) { f.Boards[0].Basis.X = [3]float64{} }},
		{"bad interval", "STATION_FRAME_INVALID", func(f *j1ContactFixture) { f.Expected[0].OverlapMm = [2]float64{0, math.Inf(1)} }},
		{"station out of bounds", "STATION_POINT_INVALID", func(f *j1ContactFixture) { f.Expected[0].OverlapMm = [2]float64{0, 900} }},
		{"inverse mismatch", "STATION_POINT_INVALID", func(f *j1ContactFixture) { f.Boards[1].Basis.X = [3]float64{0, -1, 9e-7} }},
		{"A0a ambiguity", "CONTACT_AMBIGUOUS", func(f *j1ContactFixture) { f.Contacts = append(f.Contacts, f.Contacts[0]) }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := readJ1ContactFixture(t)
			resolved := resolveExplicitContacts(f.Boards, f.Contacts, f.RequiredContactIDs)
			tc.change(&f)
			if tc.name == "bad interval" || tc.name == "station out of bounds" {
				resolved.Contacts[0] = f.Expected[0]
			}
			if tc.name == "A0a ambiguity" {
				resolved = resolveExplicitContacts(f.Boards, f.Contacts, f.RequiredContactIDs)
			}
			result := planResolvedContactStations(resolved, f.Boards, f.StationSpecs)
			found := false
			for _, issue := range result.Issues {
				found = found || issue.Code == tc.code
			}
			if !found || len(result.Plans) != 0 {
				t.Fatalf("want fail-closed %s: %+v", tc.code, result)
			}
		})
	}
}

func readJ1ContactFixture(t *testing.T) j1ContactFixture {
	t.Helper()
	raw, err := os.ReadFile("../../../../contracts/j1ContactMachining.contract.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture j1ContactFixture
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	return fixture
}

func TestJ1ExplicitContacts(t *testing.T) {
	fixture := readJ1ContactFixture(t)
	result := resolveExplicitContacts(fixture.Boards, fixture.Contacts, fixture.RequiredContactIDs)
	if len(result.Issues) != 0 || !reflect.DeepEqual(result.Contacts, fixture.Expected) {
		t.Fatalf("asymmetric directed contact parity: got=%+v, want=%+v", result, fixture.Expected)
	}

	other := fixture.Boards[1]
	other.OccurrenceID = "unrelated-neighbor"
	fixture.Boards = append(fixture.Boards, other)
	slices.Reverse(fixture.Boards)
	slices.Reverse(fixture.Contacts)
	reordered := resolveExplicitContacts(fixture.Boards, fixture.Contacts, fixture.RequiredContactIDs)
	if !reflect.DeepEqual(reordered, result) {
		t.Fatalf("order or unanchored neighbor changed contacts: %+v", reordered)
	}
}

func TestJ1RigidTranslationPreservesLocalOverlap(t *testing.T) {
	fixture := readJ1ContactFixture(t)
	delta := [3]float64{73, -41, 19}
	neighbor := fixture.Boards[1]
	neighbor.OccurrenceID = "unanchored-neighbor"
	fixture.Boards = append(fixture.Boards, neighbor)
	for i := range fixture.Boards {
		for axis := range delta {
			fixture.Boards[i].Translation[axis] += delta[axis]
		}
	}
	want := append([]ResolvedContact(nil), fixture.Expected...)
	want[0].Frame.OriginAssemblyMm = [3]float64{91, -11, 46}
	want[1].Frame.OriginAssemblyMm = [3]float64{655, 39, 46}
	result := resolveExplicitContacts(fixture.Boards, fixture.Contacts, fixture.RequiredContactIDs)
	if len(result.Issues) != 0 || !reflect.DeepEqual(result.Contacts, want) {
		t.Fatalf("translated contacts must retain IDs, axes, normals, and local intervals without unanchored neighbors: got=%+v want=%+v", result, want)
	}
}

func TestJ1RigidRotationPreservesLocalOverlap(t *testing.T) {
	fixture := readJ1ContactFixture(t)
	rotate := func(v [3]float64) [3]float64 { return [3]float64{-v[1], v[0], v[2]} }
	for i := range fixture.Boards {
		board := &fixture.Boards[i]
		board.Translation = rotate(board.Translation)
		board.Basis.X = rotate(board.Basis.X)
		board.Basis.Y = rotate(board.Basis.Y)
		board.Basis.Z = rotate(board.Basis.Z)
	}
	want := append([]ResolvedContact(nil), fixture.Expected...)
	want[0].Frame.OriginAssemblyMm, want[0].Frame.AxisAssembly, want[0].Frame.NormalAssembly =
		[3]float64{-30, 18, 27}, [3]float64{-1, 0, 0}, [3]float64{0, -1, 0}
	want[1].Frame.OriginAssemblyMm, want[1].Frame.AxisAssembly, want[1].Frame.NormalAssembly =
		[3]float64{-80, 582, 27}, [3]float64{-1, 0, 0}, [3]float64{0, 1, 0}
	result := resolveExplicitContacts(fixture.Boards, fixture.Contacts, fixture.RequiredContactIDs)
	if len(result.Issues) != 0 || !reflect.DeepEqual(result.Contacts, want) {
		t.Fatalf("rotation must transform frames while retaining local intervals: got=%+v want=%+v", result, want)
	}
}

func TestJ1ContactNegatives(t *testing.T) {
	cases := []struct {
		name, code string
		change     func(*j1ContactFixture)
	}{
		{"required contact missing", "CONTACT_REQUIRED_MISSING", func(f *j1ContactFixture) { f.Contacts = f.Contacts[:1] }},
		{"participant missing", "CONTACT_PARTICIPANT_MISSING", func(f *j1ContactFixture) { f.Contacts[0].ParticipantB = "ghost" }},
		{"ambiguous contact", "CONTACT_AMBIGUOUS", func(f *j1ContactFixture) { f.Contacts = append(f.Contacts, f.Contacts[0]) }},
		{"ambiguous occurrence", "CONTACT_AMBIGUOUS", func(f *j1ContactFixture) { f.Boards = append(f.Boards, f.Boards[0]) }},
		{"no useful overlap", "CONTACT_NO_OVERLAP", func(f *j1ContactFixture) { f.Boards[2].Translation = [3]float64{600, 600, 0} }},
		{"incompatible face", "CONTACT_FACE_INCOMPATIBLE", func(f *j1ContactFixture) { f.Contacts[1].FaceB = "back" }},
		{"separated planes", "CONTACT_FACE_INCOMPATIBLE", func(f *j1ContactFixture) { f.Boards[2].Translation = [3]float64{601, 80, 0} }},
		{"invalid local basis", "CONTACT_FRAME_INVALID", func(f *j1ContactFixture) { f.Boards[1].Basis.X = [3]float64{} }},
		{"skewed contact face", "CONTACT_FACE_INCOMPATIBLE", func(f *j1ContactFixture) {
			f.Boards[1].Basis.X = [3]float64{0, -0.7071067811865476, 0.7071067811865476}
			f.Boards[1].Basis.Z = [3]float64{0, 0.7071067811865476, 0.7071067811865476}
		}},
		{"blank contact identity", "CONTACT_IDENTITY_INVALID", func(f *j1ContactFixture) { f.Contacts[0].ContactID = "" }},
		{"blank relationship identity", "CONTACT_IDENTITY_INVALID", func(f *j1ContactFixture) { f.Contacts[0].RelationshipID = "" }},
		{"blank occurrence identity", "CONTACT_IDENTITY_INVALID", func(f *j1ContactFixture) {
			f.Boards[0].OccurrenceID = ""
			f.Contacts[0].ParticipantA = ""
			f.Contacts[1].ParticipantA = ""
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			fixture := readJ1ContactFixture(t)
			tc.change(&fixture)
			result := resolveExplicitContacts(fixture.Boards, fixture.Contacts, fixture.RequiredContactIDs)
			found := false
			for _, issue := range result.Issues {
				if issue.Code == tc.code {
					found = true
				}
			}
			if !found {
				t.Fatalf("want %s, got issues %+v", tc.code, result.Issues)
			}
		})
	}
}

func TestJ1ConflictingSameIDContactsOmitted(t *testing.T) {
	fixture := readJ1ContactFixture(t)
	conflicting := fixture.Contacts[0]
	conflicting.ParticipantB = "side-right-1"
	conflicting.FaceA = "top"
	for _, duplicates := range [][]ExplicitContact{
		{fixture.Contacts[0], conflicting}, {conflicting, fixture.Contacts[0]},
	} {
		intents := append(duplicates, fixture.Contacts[1])
		result := resolveExplicitContacts(fixture.Boards, intents, fixture.RequiredContactIDs)
		found := false
		for _, issue := range result.Issues {
			found = found || issue.Code == "CONTACT_AMBIGUOUS"
		}
		if !found || !reflect.DeepEqual(result.Contacts, fixture.Expected[1:]) {
			t.Fatalf("conflicting contact must be omitted in both orders: %+v", result)
		}
	}
}
