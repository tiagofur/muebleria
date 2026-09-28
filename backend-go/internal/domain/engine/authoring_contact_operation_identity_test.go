package engine

import (
	"encoding/json"
	"os"
	"testing"
)

func TestJ1ContactOperationIdentity(t *testing.T) {
	raw, err := os.ReadFile("../../../../contracts/j1ContactOperationIdentity.contract.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Cases []struct {
			Provenance  ContactOperationProvenance `json:"provenance"`
			OperationID string                     `json:"operationId"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	for _, item := range fixture.Cases {
		if got := ContactOperationID(item.Provenance); got != item.OperationID {
			t.Fatalf("identity parity: got %q want %q", got, item.OperationID)
		}
	}
	base := fixture.Cases[0].Provenance
	ids := map[string]bool{ContactOperationID(base): true}
	mutations := []func(*ContactOperationProvenance){
		func(p *ContactOperationProvenance) { p.RelationshipID += "!" },
		func(p *ContactOperationProvenance) { p.ContactID += "!" },
		func(p *ContactOperationProvenance) { p.ParticipantID += "!" },
		func(p *ContactOperationProvenance) { p.StationIndex++ },
		func(p *ContactOperationProvenance) { p.RecipeID += "!" },
		func(p *ContactOperationProvenance) { p.RecipeRevision += "!" },
		func(p *ContactOperationProvenance) { p.RuleID += "!" },
		func(p *ContactOperationProvenance) { p.RuleRevision += "!" },
		func(p *ContactOperationProvenance) { p.OperationRole += "!" },
	}
	for _, mutate := range mutations {
		changed := base
		mutate(&changed)
		ids[ContactOperationID(changed)] = true
	}
	if len(ids) != len(mutations)+1 {
		t.Fatalf("an identity-dependent field was omitted: %v", ids)
	}
}
