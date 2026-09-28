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
	Boards               []ContactBoard    `json:"boards"`
	Contacts             []ExplicitContact `json:"contacts"`
	RequiredContactIDs   []string          `json:"requiredContactIds"`
	Expected             []ResolvedContact `json:"expected"`
	StationSpecs         []StationSpec     `json:"stationSpecs"`
	ExpectedStationPlans []StationPlan     `json:"expectedStationPlans"`
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
		{"inverse mismatch", "STATION_POINT_INVALID", func(f *j1ContactFixture) { f.Expected[0].Frame.OriginAssemblyMm = [3]float64{19, 30, 27} }},
		{"A0a ambiguity", "CONTACT_AMBIGUOUS", func(f *j1ContactFixture) { f.Contacts = append(f.Contacts, f.Contacts[0]) }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := readJ1ContactFixture(t)
			resolved := resolveExplicitContacts(f.Boards, f.Contacts, f.RequiredContactIDs)
			tc.change(&f)
			if tc.name == "bad interval" || tc.name == "station out of bounds" || tc.name == "inverse mismatch" {
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
