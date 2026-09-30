package domain

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func hardwareProfileFixture(t *testing.T) map[string]any {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "hardwareProfile.contract.json"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var fixture map[string]any
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("decode fixture: %v", err)
	}
	return fixture
}

func fixtureProfiles(t *testing.T) []HardwareProfile {
	t.Helper()
	raw, err := json.Marshal(hardwareProfileFixture(t)["profiles"])
	if err != nil {
		t.Fatalf("marshal profiles: %v", err)
	}
	var profiles []HardwareProfile
	if err := json.Unmarshal(raw, &profiles); err != nil {
		t.Fatalf("decode profiles: %v", err)
	}
	return profiles
}

func fixtureAssignments(t *testing.T) []ComponentSideAssignment {
	t.Helper()
	raw, err := json.Marshal(hardwareProfileFixture(t)["assignments"])
	if err != nil {
		t.Fatalf("marshal assignments: %v", err)
	}
	var assignments []ComponentSideAssignment
	if err := json.Unmarshal(raw, &assignments); err != nil {
		t.Fatalf("decode assignments: %v", err)
	}
	return assignments
}

// TestHardwareProfileContractFixtureValid: every profile and assignment in
// the shared fixture validates clean — the TS twin consumes the same file.
func TestHardwareProfileContractFixtureValid(t *testing.T) {
	for _, profile := range fixtureProfiles(t) {
		if issues := profile.Validate(); len(issues) != 0 {
			t.Fatalf("profile %s: unexpected issues %+v", profile.Code, issues)
		}
	}
	for _, assignment := range fixtureAssignments(t) {
		if issues := assignment.Validate(); len(issues) != 0 {
			t.Fatalf("assignment %s/%s: unexpected issues %+v", assignment.ComponentID, assignment.Side, issues)
		}
	}
}

// TestHardwareProfileContractFixtureInvalid: every fail-closed case in the
// shared fixture produces exactly its expected issue codes and paths.
func TestHardwareProfileContractFixtureInvalid(t *testing.T) {
	raw, err := json.Marshal(hardwareProfileFixture(t)["invalidProfiles"])
	if err != nil {
		t.Fatalf("marshal invalid profiles: %v", err)
	}
	var cases []struct {
		Case               string          `json:"case"`
		Profile            HardwareProfile `json:"profile"`
		ExpectedIssueCodes []string        `json:"expectedIssueCodes"`
		ExpectedPaths      []string        `json:"expectedPaths"`
	}
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatalf("decode invalid profiles: %v", err)
	}
	for _, testCase := range cases {
		issues := testCase.Profile.Validate()
		codes := map[string]int{}
		paths := map[string]bool{}
		for _, issue := range issues {
			codes[issue.Code]++
			paths[issue.Path] = true
		}
		for _, expected := range testCase.ExpectedIssueCodes {
			if codes[expected] == 0 {
				t.Fatalf("%s: expected issue code %s, got %+v", testCase.Case, expected, issues)
			}
		}
		for _, expected := range testCase.ExpectedPaths {
			if !paths[expected] {
				t.Fatalf("%s: expected issue path %s, got %+v", testCase.Case, expected, issues)
			}
		}
		for _, issue := range issues {
			if issue.Severity != IssueSeverityError {
				t.Fatalf("%s: contract violations are errors, got %s", testCase.Case, issue.Severity)
			}
		}
	}
}

func TestComponentSideAssignmentFixtureInvalid(t *testing.T) {
	raw, err := json.Marshal(hardwareProfileFixture(t)["invalidAssignments"])
	if err != nil {
		t.Fatalf("marshal invalid assignments: %v", err)
	}
	var cases []struct {
		Case               string                  `json:"case"`
		Assignment         ComponentSideAssignment `json:"assignment"`
		ExpectedIssueCodes []string                `json:"expectedIssueCodes"`
		ExpectedPaths      []string                `json:"expectedPaths"`
	}
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatalf("decode invalid assignments: %v", err)
	}
	for _, testCase := range cases {
		issues := testCase.Assignment.Validate()
		if len(issues) == 0 {
			t.Fatalf("%s: expected issues, got none", testCase.Case)
		}
		for _, expected := range testCase.ExpectedPaths {
			found := false
			for _, issue := range issues {
				if strings.HasSuffix(issue.Path, expected) {
					found = true
				}
			}
			if !found {
				t.Fatalf("%s: expected issue path suffix %s, got %+v", testCase.Case, expected, issues)
			}
		}
	}
}

// TestIsBoardFace pins the six-face vocabulary a side assignment uses: no
// L1/W1 aliases, no placement names — those are different concepts (#912).
func TestIsBoardFace(t *testing.T) {
	for _, face := range []string{"front", "back", "left", "right", "top", "bottom"} {
		if !IsBoardFace(face) {
			t.Fatalf("%s must be a board face", face)
		}
	}
	for _, notFace := range []string{"L1", "W1", "base", "interno", "lateral_izquierdo", ""} {
		if IsBoardFace(notFace) {
			t.Fatalf("%q must not be a board face", notFace)
		}
	}
}
