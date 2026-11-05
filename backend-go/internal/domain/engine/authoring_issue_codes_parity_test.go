package engine

import (
	"encoding/json"
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

	// Walk the engine + API sources for ContractIssue Code literals.
	literal := regexp.MustCompile(`Code:\s+"([A-Z][A-Z0-9_]+)"`)
	roots := []string{".", filepath.Join("..", "..", "api")}
	emitted := make(map[string]string) // code -> first file that emits it
	for _, root := range roots {
		entries, err := os.ReadDir(root)
		if err != nil {
			t.Fatalf("read dir %s: %v", root, err)
		}
		for _, e := range entries {
			name := e.Name()
			if e.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
				continue
			}
			raw, err := os.ReadFile(filepath.Join(root, name))
			if err != nil {
				t.Fatalf("read %s: %v", name, err)
			}
			for _, m := range literal.FindAllStringSubmatch(string(raw), -1) {
				code := m[1]
				if _, seen := emitted[code]; !seen {
					emitted[code] = filepath.Join(root, name)
				}
			}
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
