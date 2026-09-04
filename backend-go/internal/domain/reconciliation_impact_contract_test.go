package domain_test

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #394 / DT-10 contract fixture: consumes the SAME
// contracts/reconciliationImpact.json that pins the demo scenario for any
// future surface. Reconciliation (#393) and impact classification (#394)
// must reproduce the pinned statuses, structured differences, impact groups
// and derived summary deterministically — a behavior change must update the
// contract consciously, never drift silently.

type reconciliationImpactContract struct {
	Input struct {
		Quote  domain.QuoteRevisionSnapshot  `json:"quote"`
		Design domain.DesignRevisionSnapshot `json:"design"`
	} `json:"input"`
	Expected struct {
		Reconciliation json.RawMessage `json:"reconciliation"`
		Classification json.RawMessage `json:"classification"`
	} `json:"expected"`
}

// canonicalize round-trips any JSON value so both fixture and actual output
// are compared under identical key ordering and number normalization.
func canonicalize(t *testing.T, raw json.RawMessage) string {
	t.Helper()
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatalf("unmarshal fixture JSON: %v", err)
	}
	out, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal canonical JSON: %v", err)
	}
	return string(out)
}

func canonicalizeValue(t *testing.T, v any) string {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal value: %v", err)
	}
	return canonicalize(t, raw)
}

func TestReconciliationImpactContract(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "reconciliationImpact.json"))
	if err != nil {
		t.Fatalf("read contracts/reconciliationImpact.json: %v", err)
	}
	var contract reconciliationImpactContract
	if err := json.Unmarshal(raw, &contract); err != nil {
		t.Fatalf("parse contracts/reconciliationImpact.json: %v", err)
	}

	run := func() (string, string) {
		recon, err := domain.Reconcile(contract.Input.Quote, contract.Input.Design)
		if err != nil {
			t.Fatalf("Reconcile: %v", err)
		}
		classification, err := domain.ClassifyReconciliation(recon)
		if err != nil {
			t.Fatalf("ClassifyReconciliation: %v", err)
		}
		return canonicalizeValue(t, recon), canonicalizeValue(t, classification)
	}

	actualReconciliation, actualClassification := run()

	if got, want := actualReconciliation, canonicalize(t, contract.Expected.Reconciliation); got != want {
		t.Errorf("reconciliation drifted from contracts/reconciliationImpact.json:\ngot:  %s\nwant: %s", got, want)
	}
	if got, want := actualClassification, canonicalize(t, contract.Expected.Classification); got != want {
		t.Errorf("impact classification drifted from contracts/reconciliationImpact.json:\ngot:  %s\nwant: %s", got, want)
	}

	// Determinism: identical inputs must reproduce byte-identical output.
	recon2, classification2 := run()
	if recon2 != actualReconciliation {
		t.Errorf("reconciliation is not deterministic across runs")
	}
	if classification2 != actualClassification {
		t.Errorf("impact classification is not deterministic across runs")
	}

	// The demo invariant: moving a unit never requires a requote. FI-003 is
	// the pure-move unit of the fixture.
	var parsed struct {
		Items []struct {
			FurnitureInstanceID string `json:"furnitureInstanceId"`
			Impact              struct {
				Commercial    bool `json:"commercial"`
				Manufacturing bool `json:"manufacturing"`
				Spatial       bool `json:"spatial"`
			} `json:"impact"`
		} `json:"items"`
	}
	if err := json.Unmarshal([]byte(actualClassification), &parsed); err != nil {
		t.Fatalf("parse classification output: %v", err)
	}
	for _, item := range parsed.Items {
		if item.Impact.Spatial && (item.Impact.Commercial || item.Impact.Manufacturing) {
			t.Errorf("item %s mixes spatial with commercial/manufacturing impact in the demo fixture", item.FurnitureInstanceID)
		}
	}
	if !bytes.Contains([]byte(actualClassification), []byte(`"requiresRequote":true`)) {
		t.Errorf("demo fixture must derive requiresRequote=true from the two commercial changes")
	}
}
