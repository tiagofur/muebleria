package engine

import (
	"encoding/json"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// Contract parity for the authoring-resolve closed issue-code set (#1493
// follow-up): every ContractIssue Code literal the backend engine emits MUST
// be a member of the closed enum in contracts/sketchupAuthoringResolve.schema.json
// — the same enum the TS list (AUTHORING_RESOLVE_ISSUE_CODES) and the Ruby
// whitelist (AuthoringIssueParsing::ISSUE_CODES) assert against. A code the
// engine invents without registering drifts all three clients into
// "unknown stable code" failures on the wire (seen live 2026-11-04:
// MEMBER_HOST_PLACEMENT_MISSING was missing from the whitelists).
func TestEngineContractIssueCodesAreRegistered(t *testing.T) {
	schemaRaw, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "contracts", "sketchupAuthoringResolve.schema.json"))
	if err != nil {
		t.Fatalf("read schema: %v", err)
	}
	var schema struct {
		Defs struct {
			Issue struct {
				Properties struct {
					Code struct {
						Enum []string `json:"enum"`
					} `json:"code"`
				} `json:"properties"`
			} `json:"issue"`
		} `json:"$defs"`
	}
	if err := json.Unmarshal(schemaRaw, &schema); err != nil {
		t.Fatalf("unmarshal schema: %v", err)
	}
	registered := make(map[string]bool, len(schema.Defs.Issue.Properties.Code.Enum))
	for _, code := range schema.Defs.Issue.Properties.Code.Enum {
		registered[code] = true
	}

	// Walk the ONLY two source trees that feed the authoring-resolve wire
	// (engine derivations + the API handlers), recursively. Both shapes:
	// exported-field `Code: "X"` and struct-literal lowercase `code: "X"`
	// (review #1501 B1: the design-opening failures assign lowercase and
	// were invisible to the first regex). Other internal packages
	// (hardware-profiles, machine-output) speak different contracts — their
	// codes are out of scope here.
	literalExported := regexp.MustCompile(`Code:\s+"([A-Z][A-Z0-9_]+)"`)
	literalLower := regexp.MustCompile(`\bcode:\s+"([A-Z][A-Z0-9_]+)"`)
	// #1503 review B-A: codes injected by IDENTIFIER (opening constants) —
	// capture the constant declarations so the closed set covers them.
	constantDecl := regexp.MustCompile(`Opening(?:Err|Reason)[A-Za-z]+\s*=\s*"([A-Z][A-Z0-9_]+)"`)
	roots := []string{".", filepath.Join("..", "..", "api")}
	emitted := make(map[string]string) // code -> first file that emits it
	for _, root := range roots {
		walkErr := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
				return nil
			}
			raw, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			patterns := []*regexp.Regexp{literalExported, literalLower}
			if strings.Contains(filepath.Base(path), "opening_") {
				patterns = append(patterns, constantDecl)
			}
			for _, re := range patterns {
				for _, m := range re.FindAllStringSubmatch(string(raw), -1) {
					code := m[1]
					if _, seen := emitted[code]; !seen {
						emitted[code] = path
					}
				}
			}
			return nil
		})
		if walkErr != nil {
			t.Fatalf("walk %s: %v", root, walkErr)
		}
	}

	unregistered := make([]string, 0)
	for code, file := range emitted {
		if !registered[code] {
			unregistered = append(unregistered, code+" ("+file+")")
		}
	}
	if len(unregistered) > 0 {
		sort.Strings(unregistered)
		t.Fatalf("the engine emits ContractIssue codes absent from contracts/sketchupAuthoringResolve.schema.json (add them to the schema enum, the TS AUTHORING_RESOLVE_ISSUE_CODES and the Ruby ISSUE_CODES): %s",
			strings.Join(unregistered, ", "))
	}

	// And the three #1429 codes this fix registers must actually be emitted
	// (guards against whitelist-only registration without an emitter).
	for _, want := range []string{"MEMBER_HOST_PLACEMENT_MISSING", "MEMBER_HOST_PROFILE_REQUIRED", "MEMBER_HOST_BASIS_UNSUPPORTED"} {
		if _, ok := emitted[want]; !ok {
			t.Errorf("expected the engine to emit %s somewhere in the sources", want)
		}
		if !registered[want] {
			t.Errorf("%s is emitted but missing from the schema enum", want)
		}
	}
}
