package engine

import (
	"encoding/json"
	"os"
	"reflect"
	"slices"
	"testing"
)

type j1ContactFixture struct {
	Boards             []ContactBoard    `json:"boards"`
	Contacts           []ExplicitContact `json:"contacts"`
	RequiredContactIDs []string          `json:"requiredContactIds"`
	Expected           []ResolvedContact `json:"expected"`
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
