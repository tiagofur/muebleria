package domain

import (
	"encoding/json"
	"testing"
	"time"
)

func TestBuildQuoteCommercialSnapshot_DeterministicOptionBytesWithoutMutatingInput(t *testing.T) {
	lineID := "62000000-0000-0000-0000-0000000000c1"
	unitID := "72000000-0000-0000-0000-0000000000c1"
	breakdown := QuoteBreakdown{MaterialsCost: 10, DirectCost: 10, LaborModular: 5, LaborFixedCost: 2, MarginFactor: 2, SalePrice: 27}
	lines := []QuoteCommercialLine{{
		QuoteLineID: lineID, Quantity: 1, FurnitureInstanceIDs: []string{unitID},
		Amounts: QuoteCommercialLineAmounts{MaterialsCost: 10, DirectCost: 10, LaborModular: 5, SalePrice: 25},
	}}
	optionA := QuoteCommercialOption{GroupCode: "A", GroupLabel: "Alpha", ChoiceID: "a", ChoiceLabel: "Choice A"}
	optionB := QuoteCommercialOption{GroupCode: "B", GroupLabel: "Beta", ChoiceID: "b", ChoiceLabel: "Choice B"}
	build := func(options []QuoteCommercialOption) []byte {
		t.Helper()
		snapshot, err := BuildQuoteCommercialSnapshot(
			time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC), "MXN",
			QuoteCommercialIdentity{ID: "customer", Name: "Customer"},
			QuoteCommercialIdentity{ID: "project", Name: "Project"}, breakdown, lines,
			[]QuoteCommercialUnit{{FurnitureInstanceID: unitID, QuoteLineID: lineID, ModuleCode: "M", ModuleName: "Module", LifecycleStatus: "active", Options: options}},
		)
		if err != nil {
			t.Fatal(err)
		}
		payload, err := json.Marshal(snapshot)
		if err != nil {
			t.Fatal(err)
		}
		return payload
	}
	reversed := []QuoteCommercialOption{optionB, optionA}
	first := build(reversed)
	second := build([]QuoteCommercialOption{optionA, optionB})
	if string(first) != string(second) {
		t.Fatalf("same options produced different frozen bytes:\n%s\n%s", first, second)
	}
	if reversed[0].GroupCode != "B" {
		t.Fatal("builder mutated caller-owned option order")
	}
}
