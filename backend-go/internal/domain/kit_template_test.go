package domain_test

import (
	"encoding/json"
	"os"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1422 slice 2 — shared TS↔Go contract: the SAME fixture the vitest suite
// consumes pins kit-template validation (codes + paths; messages are the
// byte-identical twin text of packages/domain/src/hardwareKit.ts).
func kitTemplateFixture(t *testing.T) map[string]json.RawMessage {
	t.Helper()
	raw, err := os.ReadFile("../../../contracts/kitTemplateValidation.contract.json")
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var fixture map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("parse fixture: %v", err)
	}
	if string(fixture["schema"]) != `"granete.kit-template-validation.v1"` {
		t.Fatalf("unexpected fixture schema %s", fixture["schema"])
	}
	return fixture
}

func TestKitTemplateContractFixtureValid(t *testing.T) {
	var cases []struct {
		Case     string             `json:"case"`
		Template domain.KitTemplate `json:"template"`
	}
	if err := json.Unmarshal(kitTemplateFixture(t)["validTemplates"], &cases); err != nil {
		t.Fatalf("decode validTemplates: %v", err)
	}
	if len(cases) == 0 {
		t.Fatal("fixture carries no valid templates")
	}
	for _, testCase := range cases {
		if issues := testCase.Template.Validate(); len(issues) != 0 {
			t.Fatalf("case %s: unexpected issues %+v", testCase.Case, issues)
		}
	}
}

func TestKitTemplateContractFixtureInvalid(t *testing.T) {
	var cases []struct {
		Case               string             `json:"case"`
		Template           domain.KitTemplate `json:"template"`
		ExpectedIssueCodes []string           `json:"expectedIssueCodes"`
		ExpectedPaths      []string           `json:"expectedPaths"`
	}
	if err := json.Unmarshal(kitTemplateFixture(t)["invalidTemplates"], &cases); err != nil {
		t.Fatalf("decode invalidTemplates: %v", err)
	}
	if len(cases) == 0 {
		t.Fatal("fixture carries no invalid templates")
	}
	for _, testCase := range cases {
		issues := testCase.Template.Validate()
		if len(issues) == 0 {
			t.Fatalf("case %s: expected issues, got none", testCase.Case)
		}
		paths := map[string]bool{}
		codes := map[string]bool{}
		for _, issue := range issues {
			paths[issue.Path] = true
			codes[issue.Code] = true
			if issue.Severity != "error" {
				t.Fatalf("case %s: issue %s severity %q", testCase.Case, issue.Path, issue.Severity)
			}
		}
		for _, expected := range testCase.ExpectedIssueCodes {
			if !codes[expected] {
				t.Fatalf("case %s: expected issue code %s, got %+v", testCase.Case, expected, codes)
			}
		}
		for _, expected := range testCase.ExpectedPaths {
			if !paths[expected] {
				t.Fatalf("case %s: expected issue path %s, got %+v", testCase.Case, expected, paths)
			}
		}
	}
}
