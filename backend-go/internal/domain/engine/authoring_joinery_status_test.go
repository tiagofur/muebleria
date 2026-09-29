package engine

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// Physical cabinet frame: floor length along X between two sides whose
// thickness spans X, length (height) spans Z, and both widths span Y (depth)
// — the same convention as the A0a synthetic fixture.
func j1bBoards() map[string]*layoutBoard {
	return map[string]*layoutBoard{
		"side-left":  {id: "side-left", widthMm: 570, thicknessMm: 18, lengthMm: 720, rotX: -90, rotZ: 90},
		"side-right": {id: "side-right", widthMm: 570, thicknessMm: 18, lengthMm: 720, x: 582, rotX: -90, rotZ: 90},
		"floor":      {id: "floor", widthMm: 570, thicknessMm: 18, lengthMm: 564, x: 18, rotY: -90},
	}
}

func j1bRelationship() AuthoringRelationship {
	return AuthoringRelationship{
		RelationshipID: "rel-floor-sides-01",
		Kind:           "floor-side",
		Source:         AuthoringRelationshipAnchor{ComponentInstanceID: "floor", Role: "floor-edge"},
		Targets: []AuthoringRelationshipAnchor{
			{ComponentInstanceID: "side-left", Role: "inside-face", Face: "back"},
			{ComponentInstanceID: "side-right", Role: "inside-face", Face: "front"},
		},
		Parameters: map[string]any{"stationCount": float64(3), "startMarginMm": float64(40), "endMarginMm": float64(40)},
	}
}

func TestFloorSideJoineryReachesProfileRequired(t *testing.T) {
	var collected []domain.ContractIssue
	status := deriveFloorSideJoinery(j1bRelationship(), j1bBoards(), &collected, nil, nil)
	if status.Stage != JoineryTechnicalProfileMissing {
		t.Fatalf("stage = %s, want TECHNICAL_PROFILE_REQUIRED (%+v)", status.Stage, status)
	}
	if len(status.Contacts) != 2 || status.Contacts[0].Status != "VALID" || status.Contacts[1].Status != "VALID" {
		t.Fatalf("contacts = %+v", status.Contacts)
	}
	if status.Contacts[0].ContactID != "rel-floor-sides-01:side-left" ||
		status.Contacts[1].ContactID != "rel-floor-sides-01:side-right" {
		t.Fatalf("contact ids = %+v", status.Contacts)
	}
	if status.Stations.Status != "PLANNED" || len(status.Stations.StationCounts) != 2 {
		t.Fatalf("stations = %+v", status.Stations)
	}
	for _, count := range status.Stations.StationCounts {
		if count.StationCount != 3 {
			t.Fatalf("station count = %+v", count)
		}
	}
	if len(status.Blockers) != 1 || status.Blockers[0] != "TECHNICAL_PROFILE_REQUIRED" {
		t.Fatalf("blockers = %+v", status.Blockers)
	}
	found := false
	for _, issue := range collected {
		if issue.Code == "TECHNICAL_PROFILE_REQUIRED" {
			found = true
		}
	}
	if !found {
		t.Fatalf("TECHNICAL_PROFILE_REQUIRED issue missing: %+v", collected)
	}
}

func TestFloorSideJoineryTerminalStatusShape(t *testing.T) {
	var collected []domain.ContractIssue
	status := deriveFloorSideJoinery(j1bRelationship(), j1bBoards(), &collected, nil, nil)
	raw, err := json.Marshal(status)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), ":null") {
		t.Fatalf("terminal status must not emit null collections: %s", raw)
	}
}

func TestFloorSideJoinerySourceFaceCodeReported(t *testing.T) {
	rel := j1bRelationship()
	rel.Source.Face = "diagonal"
	var collected []domain.ContractIssue
	status := deriveFloorSideJoinery(rel, j1bBoards(), &collected, nil, nil)
	if status.Stage != JoineryContactInvalid {
		t.Fatalf("stage = %s", status.Stage)
	}
	for _, code := range append(append([]string{}, status.Blockers...), status.Contacts[0].IssueCodes...) {
		if code == "CONTACT_FACE_REQUIRED" {
			return
		}
	}
	t.Fatalf("CONTACT_FACE_REQUIRED missing from status: %+v", status)
}

func TestFloorSideJoineryNegatives(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(rel AuthoringRelationship, boards map[string]*layoutBoard)
		stage  JoineryResolutionStage
		code   string
	}{
		{"missing target face", func(rel AuthoringRelationship, _ map[string]*layoutBoard) {
			rel.Targets[0].Face = ""
		}, JoineryContactInvalid, "CONTACT_FACE_REQUIRED"},
		{"non touching side", func(_ AuthoringRelationship, boards map[string]*layoutBoard) {
			boards["side-right"].x = 700
		}, JoineryContactInvalid, "CONTACT_FACE_REQUIRED"},
		{"orphan anchor", func(rel AuthoringRelationship, _ map[string]*layoutBoard) {
			rel.Targets[0].ComponentInstanceID = "ghost"
		}, JoineryContactInvalid, "RELATIONSHIP_ORPHANED"},
		{"count below two", func(rel AuthoringRelationship, _ map[string]*layoutBoard) {
			rel.Parameters["stationCount"] = float64(1)
		}, JoineryStationInvalid, "STATION_PATTERN_INVALID"},
		{"fractional count", func(rel AuthoringRelationship, _ map[string]*layoutBoard) {
			rel.Parameters["stationCount"] = 2.5
		}, JoineryStationInvalid, "STATION_PATTERN_INVALID"},
		{"missing count", func(rel AuthoringRelationship, _ map[string]*layoutBoard) {
			delete(rel.Parameters, "stationCount")
		}, JoineryStationInvalid, "STATION_PATTERN_INVALID"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rel := j1bRelationship()
			boards := j1bBoards()
			tc.mutate(rel, boards)
			var collected []domain.ContractIssue
			status := deriveFloorSideJoinery(rel, boards, &collected, nil, nil)
			if status.Stage != tc.stage {
				t.Fatalf("stage = %s, want %s (%+v)", status.Stage, tc.stage, status)
			}
			found := false
			for _, blocker := range status.Blockers {
				if blocker == tc.code {
					found = true
				}
			}
			for _, issue := range collected {
				if issue.Code == tc.code {
					found = true
				}
			}
			if !found {
				t.Fatalf("code %s missing; blockers=%+v issues=%+v", tc.code, status.Blockers, collected)
			}
		})
	}
}

func TestFloorSideJoineryFingerprintMovesWithSemantics(t *testing.T) {
	base := func() []JoineryRelationshipStatus {
		var collected []domain.ContractIssue
		return []JoineryRelationshipStatus{deriveFloorSideJoinery(j1bRelationship(), j1bBoards(), &collected, nil, nil)}
	}
	changed := func() []JoineryRelationshipStatus {
		rel := j1bRelationship()
		rel.Parameters["stationCount"] = float64(4)
		var collected []domain.ContractIssue
		return []JoineryRelationshipStatus{deriveFloorSideJoinery(rel, j1bBoards(), &collected, nil, nil)}
	}
	empty := FurnitureLayout{}
	boards := []layoutBoard{}
	a := authoringManufacturingFingerprint(empty, boards, nil, nil, nil, base())
	b := authoringManufacturingFingerprint(empty, boards, nil, nil, nil, changed())
	if a == b {
		t.Fatal("station pattern change must move the manufacturing fingerprint")
	}
	if !strings.HasPrefix(a, "sha256-") {
		t.Fatalf("fingerprint format = %q", a)
	}
	// Reordering two distinct-relationship statuses must not change the hash.
	first := base()
	var collected []domain.ContractIssue
	relRight := j1bRelationship()
	relRight.RelationshipID = "rel-floor-sides-02"
	relRight.Parameters["stationCount"] = float64(4)
	first = append(first, deriveFloorSideJoinery(relRight, j1bBoards(), &collected, nil, nil))
	second := []JoineryRelationshipStatus{first[1], first[0]}
	x := authoringManufacturingFingerprint(empty, boards, nil, nil, nil, first)
	y := authoringManufacturingFingerprint(empty, boards, nil, nil, nil, second)
	if x != y {
		t.Fatalf("status order must not move the fingerprint: %q vs %q", x, y)
	}
	if x == a {
		t.Fatal("adding a second relationship must move the fingerprint")
	}
}
