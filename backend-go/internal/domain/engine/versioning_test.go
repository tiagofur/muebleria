package engine

import (
	"errors"
	"reflect"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// TestStructureRevisionNumber_LegacyDefaults verifies that revision 0
// (missing in legacy data) is treated as DefaultStructureRevision.
func TestStructureRevisionNumber_LegacyDefaults(t *testing.T) {
	if got := StructureRevisionNumber(domain.Structure{}); got != DefaultStructureRevision {
		t.Errorf("legacy revision: got %d want %d", got, DefaultStructureRevision)
	}
	if got := StructureRevisionNumber(domain.Structure{Revision: 5}); got != 5 {
		t.Errorf("explicit revision: got %d want 5", got)
	}
}

// TestBumpStructureRevision increments revision and prepends the snapshot of
// the previous state (newest-first), mirroring the TS helper.
func TestBumpStructureRevision(t *testing.T) {
	current := domain.Structure{
		ID: "st-1", Code: "OLD", Name: "Old",
		Revision: 2,
		Components: []domain.ComponentInstance{{ComponentID: "c1", Quantity: 1}},
		History: []domain.StructureRevision{
			{Revision: 1, Code: "v1"},
		},
	}
	draft := domain.Structure{
		Code: "NEW", Name: "New",
		Components: []domain.ComponentInstance{{ComponentID: "c1", Quantity: 3}},
		// Draft smuggling attempts — must be ignored (parity with TS).
		Revision: 999, ID: "smuggled-id",
	}

	got := BumpStructureRevision(current, draft)
	if got.ID != "st-1" {
		t.Errorf("ID: got %q want st-1 (draft smuggle ignored)", got.ID)
	}
	if got.Revision != 3 {
		t.Errorf("Revision: got %d want 3", got.Revision)
	}
	if got.Code != "NEW" || got.Name != "New" {
		t.Errorf("draft fields not applied: code=%q name=%q", got.Code, got.Name)
	}
	if len(got.History) != 2 {
		t.Fatalf("History len: got %d want 2", len(got.History))
	}
	if got.History[0].Revision != 2 || got.History[0].Code != "OLD" {
		t.Errorf("history[0] (newest snapshot): got %+v want rev=2 code=OLD", got.History[0])
	}
	if got.History[1].Revision != 1 {
		t.Errorf("history[1]: got rev=%d want 1", got.History[1].Revision)
	}
}

// TestBumpStructureRevision_LegacyNormalised covers the case where the
// previous revision is missing (0) — bump must start from 1.
func TestBumpStructureRevision_LegacyNormalised(t *testing.T) {
	current := domain.Structure{ID: "st-x", Code: "X", Name: "X"}
	draft := domain.Structure{Code: "X2", Name: "X2"}
	got := BumpStructureRevision(current, draft)
	if got.Revision != 2 {
		t.Errorf("Revision from legacy: got %d want 2", got.Revision)
	}
	if len(got.History) != 1 || got.History[0].Revision != 1 {
		t.Errorf("History should contain normalised rev 1 snapshot, got %+v", got.History)
	}
}

func TestResolveStructureRevision(t *testing.T) {
	st := domain.Structure{
		ID: "st-1", Code: "CUR", Name: "Current",
		Revision: 3,
		History: []domain.StructureRevision{
			{Revision: 2, Code: "v2", Name: "Two"},
			{Revision: 1, Code: "v1", Name: "One"},
		},
	}

	t.Run("nil pin returns current", func(t *testing.T) {
		got, err := ResolveStructureRevision(st, nil)
		if err != nil {
			t.Fatal(err)
		}
		if got.Revision != 3 || got.Code != "CUR" {
			t.Errorf("got %+v want current", got)
		}
	})

	t.Run("pin == current returns current", func(t *testing.T) {
		cur := 3
		got, err := ResolveStructureRevision(st, &cur)
		if err != nil {
			t.Fatal(err)
		}
		if got.Revision != 3 {
			t.Errorf("got rev %d want 3", got.Revision)
		}
	})

	t.Run("pin in history returns frozen snapshot", func(t *testing.T) {
		pin := 1
		got, err := ResolveStructureRevision(st, &pin)
		if err != nil {
			t.Fatal(err)
		}
		if got.Revision != 1 || got.Code != "v1" || got.Name != "One" {
			t.Errorf("got %+v want rev=1/code=v1/name=One", got)
		}
	})

	t.Run("unknown pin returns StructureRevisionError with context", func(t *testing.T) {
		pin := 42
		_, err := ResolveStructureRevision(st, &pin)
		if err == nil {
			t.Fatal("expected error for unknown pin")
		}
		var sre *StructureRevisionError
		if !errors.As(err, &sre) {
			t.Fatalf("expected *StructureRevisionError, got %T (%v)", err, err)
		}
		if sre.Pin != 42 || sre.CurrentRevision != 3 || sre.StructureID != "st-1" {
			t.Errorf("error context wrong: %+v", sre)
		}
		// available revisions must be sorted ascending and include current + history.
		want := []int{1, 2, 3}
		if !reflect.DeepEqual(sre.AvailableRevisions, want) {
			t.Errorf("available: got %v want %v", sre.AvailableRevisions, want)
		}
	})
}

// TestResolveStructureForPin_ReifiesStructure checks the returned Structure is
// shape-complete and uses the snapshot fields for BOM resolution.
func TestResolveStructureForPin_ReifiesStructure(t *testing.T) {
	st := domain.Structure{
		ID: "st-1", Code: "CUR", Name: "Current", WidthMm: 600, HeightMm: 720, DepthMm: 560,
		Revision: 2,
		Components: []domain.ComponentInstance{{ComponentID: "c-cur", Quantity: 2}},
		History: []domain.StructureRevision{
			{
				Revision: 1, Code: "v1", Name: "One",
				Components: []domain.ComponentInstance{{ComponentID: "c-v1", Quantity: 5}},
			},
		},
	}
	pin := 1
	got, err := ResolveStructureForPin(st, &pin)
	if err != nil {
		t.Fatal(err)
	}
	if got.Revision != 1 || got.Code != "v1" {
		t.Errorf("revision/code: got %d/%q want 1/v1", got.Revision, got.Code)
	}
	if len(got.Components) != 1 || got.Components[0].ComponentID != "c-v1" || got.Components[0].Quantity != 5 {
		t.Errorf("components not reified from snapshot: %+v", got.Components)
	}
	// Shape-complete: id carried over even though it does not affect BOM.
	if got.ID != "st-1" {
		t.Errorf("ID should be carried over: got %q", got.ID)
	}
}

// TestCaptureProjectItemStructurePins covers the close-time pinning and the
// no-op paths (items without structure / structure missing from catalog).
func TestCaptureProjectItemStructurePins(t *testing.T) {
	st := domain.Structure{ID: "st-1", Revision: 4}
	modWithStructure := domain.Module{ID: "mod-st", StructureID: "st-1"}
	modFlat := domain.Module{ID: "mod-flat"} // no structure
	modMissingStructure := domain.Module{ID: "mod-missing", StructureID: "st-ghost"}

	catalog := domain.Catalog{
		Modules:    []domain.Module{modWithStructure, modFlat, modMissingStructure},
		Structures: []domain.Structure{st},
	}

	items := []domain.ProjectItem{
		{ID: "i1", ModuleID: "mod-st"},
		{ID: "i2", ModuleID: "mod-flat"},
		{ID: "i3", ModuleID: "mod-missing"},
		{ID: "i4", ModuleID: "mod-unknown"}, // module not in catalog
		{ID: "i5", ModuleID: "mod-st", StructureRevisionPin: intPtr(1)}, // stale pin should be overwritten
	}

	got := CaptureProjectItemStructurePins(items, catalog)

	if got[0].StructureRevisionPin == nil || *got[0].StructureRevisionPin != 4 {
		t.Errorf("i1 (mod-st): pin = %v want 4", pinVal(got[0].StructureRevisionPin))
	}
	if got[1].StructureRevisionPin != nil {
		t.Errorf("i2 (flat module): pin should be nil, got %v", pinVal(got[1].StructureRevisionPin))
	}
	if got[2].StructureRevisionPin != nil {
		t.Errorf("i3 (missing structure): pin should be nil, got %v", pinVal(got[2].StructureRevisionPin))
	}
	if got[3].StructureRevisionPin != nil {
		t.Errorf("i4 (unknown module): pin should be nil, got %v", pinVal(got[3].StructureRevisionPin))
	}
	if got[4].StructureRevisionPin == nil || *got[4].StructureRevisionPin != 4 {
		t.Errorf("i5 (stale pin): should be overwritten to 4, got %v", pinVal(got[4].StructureRevisionPin))
	}
}

func intPtr(v int) *int { return &v }

func pinVal(p *int) interface{} {
	if p == nil {
		return nil
	}
	return *p
}
