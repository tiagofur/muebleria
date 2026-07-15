package domain

import "testing"

func sampleCats() []ModuleCategory {
	return []ModuleCategory{
		{ID: "c1", Name: "Cocina"},
		{ID: "c1a", Name: "Alacenas", ParentID: "c1"},
		{ID: "c1a1", Name: "Esquineras", ParentID: "c1a"},
		{ID: "c2", Name: "Dormitorio"},
	}
}

func TestCategoryDepth(t *testing.T) {
	cats := sampleCats()
	if CategoryDepth("c1", cats) != 1 {
		t.Fatalf("root depth want 1")
	}
	if CategoryDepth("c1a", cats) != 2 {
		t.Fatalf("mid depth want 2")
	}
	if CategoryDepth("c1a1", cats) != 3 {
		t.Fatalf("leaf depth want 3")
	}
}

func TestValidateCategoryPlacementRejectsFourthLevel(t *testing.T) {
	cats := sampleCats()
	if err := ValidateCategoryPlacement("c1a1", cats, ""); err == nil {
		t.Fatal("expected error creating under depth-3 node")
	}
	if err := ValidateCategoryPlacement("c1a", cats, ""); err != nil {
		t.Fatalf("create under mid should be ok: %v", err)
	}
}

func TestValidateCategoryPlacementMove(t *testing.T) {
	cats := sampleCats()
	// move c2 under leaf → depth 4 invalid
	if err := ValidateCategoryPlacement("c1a1", cats, "c2"); err == nil {
		t.Fatal("expected move under leaf to fail")
	}
	// move leaf under c2 → ok
	if err := ValidateCategoryPlacement("c2", cats, "c1a1"); err != nil {
		t.Fatalf("move leaf under root sibling should be ok: %v", err)
	}
	// cannot move under self descendant
	if err := ValidateCategoryPlacement("c1a1", cats, "c1"); err == nil {
		t.Fatal("expected cycle/descendant error")
	}
}

func TestSubtreeHeight(t *testing.T) {
	cats := sampleCats()
	if SubtreeHeight("c1", cats) != 3 {
		t.Fatalf("want height 3 got %d", SubtreeHeight("c1", cats))
	}
	if SubtreeHeight("c1a1", cats) != 1 {
		t.Fatalf("leaf height want 1")
	}
}
