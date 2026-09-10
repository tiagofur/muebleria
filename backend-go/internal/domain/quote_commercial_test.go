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
	optionA := QuoteCommercialOption{GroupCode: "A", GroupLabel: "Alpha", ChoiceID: "82000000-0000-0000-0000-000000000001", ChoiceLabel: "Choice A"}
	optionB := QuoteCommercialOption{GroupCode: "B", GroupLabel: "Beta", ChoiceID: "82000000-0000-0000-0000-000000000002", ChoiceLabel: "Choice B"}
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

func TestValidateQuoteCommercialSnapshot_RejectsInvalidCanonicalBindings(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*QuoteCommercialSnapshot)
	}{
		{"duplicate unit identity", func(snapshot *QuoteCommercialSnapshot) { snapshot.Units = append(snapshot.Units, snapshot.Units[0]) }},
		{"missing unit descriptor", func(snapshot *QuoteCommercialSnapshot) {
			snapshot.Lines[0].FurnitureInstanceIDs = append(snapshot.Lines[0].FurnitureInstanceIDs, "72000000-0000-0000-0000-0000000000c2")
		}},
		{"bad line binding", func(snapshot *QuoteCommercialSnapshot) {
			snapshot.Units[0].QuoteLineID = "62000000-0000-0000-0000-0000000000c2"
		}},
		{"uuid module fallback", func(snapshot *QuoteCommercialSnapshot) {
			snapshot.Units[0].ModuleName = snapshot.Units[0].FurnitureInstanceID
		}},
		{"uuid option label fallback", func(snapshot *QuoteCommercialSnapshot) {
			snapshot.Units[0].Options[0].ChoiceLabel = snapshot.Units[0].Options[0].ChoiceID
		}},
		{"invalid choice identity", func(snapshot *QuoteCommercialSnapshot) { snapshot.Units[0].Options[0].ChoiceID = "choice" }},
		{"duplicate option group", func(snapshot *QuoteCommercialSnapshot) {
			snapshot.Units[0].Options = append(snapshot.Units[0].Options, QuoteCommercialOption{GroupCode: "A", GroupLabel: "Alpha", ChoiceID: "82000000-0000-0000-0000-000000000002", ChoiceLabel: "Other"})
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			snapshot := validCommercialSnapshotForValidation()
			test.mutate(snapshot)
			if err := ValidateQuoteCommercialSnapshot(snapshot); err == nil {
				t.Fatal("expected invalid canonical snapshot")
			}
		})
	}
}

func TestValidateQuoteCommercialSnapshot_AllowsTerminalOnlyZeroQuantity(t *testing.T) {
	snapshot := validCommercialSnapshotForValidation()
	snapshot.Lines[0].Quantity = 0
	snapshot.Units[0].LifecycleStatus = "removed"
	if err := ValidateQuoteCommercialSnapshot(snapshot); err != nil {
		t.Fatalf("terminal-only commercial history must remain representable: %v", err)
	}
}

func validCommercialSnapshotForValidation() *QuoteCommercialSnapshot {
	lineID := "62000000-0000-0000-0000-0000000000c1"
	unitID := "72000000-0000-0000-0000-0000000000c1"
	return &QuoteCommercialSnapshot{
		Schema: QuoteCommercialSnapshotSchema, CapturedAt: time.Date(2026, 9, 10, 12, 0, 0, 0, time.UTC), Currency: "MXN",
		Customer: QuoteCommercialIdentity{ID: "customer", Name: "Customer"}, Project: QuoteCommercialIdentity{ID: "project", Name: "Project"},
		Breakdown: QuoteBreakdown{MaterialsCost: 10, DirectCost: 10, LaborModular: 5, LaborFixedCost: 2, MarginFactor: 2, SalePrice: 27},
		Lines:     []QuoteCommercialLine{{QuoteLineID: lineID, Quantity: 1, FurnitureInstanceIDs: []string{unitID}, Amounts: QuoteCommercialLineAmounts{MaterialsCost: 10, DirectCost: 10, LaborModular: 5, SalePrice: 25}}},
		Units:     []QuoteCommercialUnit{{FurnitureInstanceID: unitID, QuoteLineID: lineID, ModuleCode: "M", ModuleName: "Module", LifecycleStatus: "active", Options: []QuoteCommercialOption{{GroupCode: "A", GroupLabel: "Alpha", ChoiceID: "82000000-0000-0000-0000-000000000001", ChoiceLabel: "Choice A"}}}},
	}
}
