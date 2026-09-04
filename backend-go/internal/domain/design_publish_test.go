package domain_test

import (
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #392 / DT-8: the manifest v1 validator must accept/reject exactly the
// shared contract fixture scenarios (contracts/sketchupPublishManifest.contract.json),
// keeping the Go validator, the canonical JSON Schema and the Ruby manifest
// builder on one line. Schema validity alone never publishes: identity and
// working-copy consistency are validated server-side at prepare AND finalize.

type manifestScenario struct {
	ID       string                 `json:"id"`
	Valid    bool                   `json:"valid"`
	Manifest map[string]interface{} `json:"manifest"`
}

func TestDesignPublishManifest_ContractFixtureParity(t *testing.T) {
	raw, err := os.ReadFile("../../../contracts/sketchupPublishManifest.contract.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Scenarios []manifestScenario `json:"scenarios"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	if len(fixture.Scenarios) == 0 {
		t.Fatal("fixture must declare scenarios")
	}

	for _, scenario := range fixture.Scenarios {
		body, err := json.Marshal(scenario.Manifest)
		if err != nil {
			t.Fatalf("%s: marshal scenario: %v", scenario.ID, err)
		}
		parsed, parseErr := domain.ParseDesignPublishManifest(body)
		if scenario.Valid && parseErr != nil {
			t.Errorf("%s: expected valid, got error: %v", scenario.ID, parseErr)
		}
		if !scenario.Valid {
			if parseErr == nil {
				t.Errorf("%s: expected rejection, parsed %+v", scenario.ID, parsed)
			} else if !errors.Is(parseErr, domain.ErrPublishManifestInvalid) {
				t.Errorf("%s: error must wrap ErrPublishManifestInvalid, got %v", scenario.ID, parseErr)
			}
		}
	}
}

func TestDesignPublishManifest_CanonicalRoundTripIsStable(t *testing.T) {
	base := "53000000-0000-0000-0000-000000000001"
	m := &domain.DesignPublishManifest{
		SchemaVersion:  1,
		ProjectID:      "41000000-0000-0000-0000-000000000001",
		DesignID:       "52000000-0000-0000-0000-000000000001",
		BaseRevisionID: &base,
		Source: domain.DesignPublishManifestSource{
			Client:          "sketchup",
			SketchUpVersion: "24.0.145",
			PluginVersion:   "0.1.0",
		},
		Items: []domain.DesignPublishManifestItem{
			{
				FurnitureInstanceID: "51000000-0000-0000-0000-0000000000f1",
				TechnicalClientLocator: &domain.TechnicalClientLocator{
					Kind:  "sketchup_persistent_id",
					Value: "1234",
				},
			},
		},
	}
	first, err := domain.CanonicalDesignPublishManifestJSON(m)
	if err != nil {
		t.Fatal(err)
	}
	reparsed, err := domain.ParseDesignPublishManifest(first)
	if err != nil {
		t.Fatalf("canonical form must re-parse: %v", err)
	}
	second, err := domain.CanonicalDesignPublishManifestJSON(reparsed)
	if err != nil {
		t.Fatal(err)
	}
	if string(first) != string(second) {
		t.Fatalf("canonical form must be stable:\n%s\n%s", first, second)
	}
	// The uploaded manifest.json artifact is compared to the prepared one via
	// this canonical form: reordered keys in the same file are still equal.
	reordered := strings.Replace(string(first), `"schemaVersion":1`, `"schemaVersion": 1`, 1)
	if reordered == string(first) {
		t.Fatal("test setup failed to produce a different serialization")
	}
	reparsed2, err := domain.ParseDesignPublishManifest([]byte(reordered))
	if err != nil {
		t.Fatal(err)
	}
	again, err := domain.CanonicalDesignPublishManifestJSON(reparsed2)
	if err != nil {
		t.Fatal(err)
	}
	if string(again) != string(first) {
		t.Fatal("canonicalization must normalize formatting differences")
	}
}
