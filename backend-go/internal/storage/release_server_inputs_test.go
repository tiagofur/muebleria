package storage

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

type fakeInputsReader struct {
	release     *domain.LibraryRelease
	releaseErr  error
	pinned      *domain.LibraryRelease
	profiles    []domain.HardwareProfile
	assignments []domain.ComponentSideAssignment
	overlay     *domain.LibraryOverlay
	overlayErr  error
}

func (f *fakeInputsReader) GetCurrentPublishedRelease(context.Context, uuid.UUID) (*domain.LibraryRelease, error) {
	return f.release, f.releaseErr
}

func (f *fakeInputsReader) GetReleaseByID(_ context.Context, id uuid.UUID) (*domain.LibraryRelease, error) {
	if f.pinned == nil || f.pinned.ID != id {
		return nil, ErrLibraryReleaseNotFound
	}
	return f.pinned, nil
}

func (f *fakeInputsReader) HardwareProfilesForRelease(context.Context, uuid.UUID) ([]domain.HardwareProfile, error) {
	return f.profiles, nil
}

func (f *fakeInputsReader) ListAllComponentSideAssignments(context.Context) ([]domain.ComponentSideAssignment, error) {
	return f.assignments, nil
}

func (f *fakeInputsReader) GetActiveOverlayByLibrary(context.Context, uuid.UUID, uuid.UUID) (*domain.LibraryOverlay, error) {
	if f.overlayErr != nil {
		return nil, f.overlayErr
	}
	if f.overlay == nil {
		return nil, ErrOverlayNotFound
	}
	return f.overlay, nil
}

func TestReleaseServerInputsFromStore(t *testing.T) {
	orgID := "11111111-1111-1111-1111-111111111111"
	profile := domain.HardwareProfile{ID: "prof-1", Revision: "r1", Active: true,
		Recipe: &domain.ProfileRecipeBody{RecipeID: "rec", RecipeRevision: "rr1", Variants: []domain.ProfileRecipeVariant{{
			TargetFace: "back",
			Rules:      []domain.ProfileRuleSpec{{RuleID: "rule-1", RuleRevision: "1", OperationRole: "drill"}},
		}}},
		Items: []domain.HardwareProfileItem{{HardwareID: "hw-1", Quantity: 2}},
	}

	t.Run("happy path assembles every governed input", func(t *testing.T) {
		reader := &fakeInputsReader{
			release:     &domain.LibraryRelease{ID: uuid.MustParse("22222222-2222-2222-2222-222222222222")},
			profiles:    []domain.HardwareProfile{profile},
			assignments: []domain.ComponentSideAssignment{{ComponentID: "comp-1", ProfileID: "prof-1", Side: "back"}},
			overlay:     &domain.LibraryOverlay{Overrides: json.RawMessage(`{"joint.floorToSide.systemId": "screw-only", "joint.floorToSide.stationsCount": 4}`)},
		}
		inputs, err := ReleaseServerInputsFromStore(context.Background(), reader, orgID)
		if err != nil {
			t.Fatal(err)
		}
		if inputs.LibraryReleaseID != "22222222-2222-2222-2222-222222222222" {
			t.Fatalf("release pin = %q", inputs.LibraryReleaseID)
		}
		if len(inputs.SideRecipes) != 1 || inputs.SideRecipes[0].CatalogComponentID != "comp-1" || inputs.SideRecipes[0].Side != "back" {
			t.Fatalf("side recipes = %+v", inputs.SideRecipes)
		}
		if inputs.Policy == nil || inputs.Policy.FloorToSide == nil || inputs.Policy.FloorToSide.StationsCount != 4 {
			t.Fatalf("factory policy = %+v", inputs.Policy)
		}
		if inputs.ProfilesByID["prof-1"].ID != "prof-1" {
			t.Fatalf("profiles by id = %+v", inputs.ProfilesByID)
		}
	})

	t.Run("no published release degrades to empty inputs", func(t *testing.T) {
		reader := &fakeInputsReader{releaseErr: ErrLibraryReleaseNotFound}
		inputs, err := ReleaseServerInputsFromStore(context.Background(), reader, orgID)
		if err != nil {
			t.Fatalf("absent release must degrade, not fail: %v", err)
		}
		if inputs.LibraryReleaseID != "" || len(inputs.SideRecipes) != 0 || inputs.Policy != nil {
			t.Fatalf("inputs = %+v", inputs)
		}
	})

	t.Run("no overlay inherits", func(t *testing.T) {
		reader := &fakeInputsReader{release: &domain.LibraryRelease{ID: uuid.New()}}
		inputs, err := ReleaseServerInputsFromStore(context.Background(), reader, orgID)
		if err != nil || inputs.Policy != nil {
			t.Fatalf("absent overlay must inherit: %+v, %v", inputs.Policy, err)
		}
	})

	t.Run("explicitly overridden unusable policy fails closed", func(t *testing.T) {
		reader := &fakeInputsReader{
			release: &domain.LibraryRelease{ID: uuid.New()},
			overlay: &domain.LibraryOverlay{Overrides: json.RawMessage(`{"joint.floorToSide.stationsCount": 1}`)},
		}
		if _, err := ReleaseServerInputsFromStore(context.Background(), reader, orgID); err == nil {
			t.Fatalf("unusable explicit factory policy must fail the loader")
		}
	})

	t.Run("assignment without recipe face synthesizes nothing", func(t *testing.T) {
		reader := &fakeInputsReader{
			release:     &domain.LibraryRelease{ID: uuid.New()},
			profiles:    []domain.HardwareProfile{profile},
			assignments: []domain.ComponentSideAssignment{{ComponentID: "comp-1", ProfileID: "prof-1", Side: "front"}},
		}
		inputs, err := ReleaseServerInputsFromStore(context.Background(), reader, orgID)
		if err != nil || len(inputs.SideRecipes) != 0 {
			t.Fatalf("unmatched side must synthesize no recipe: %+v, %v", inputs.SideRecipes, err)
		}
	})

	t.Run("overlay lookup error is typed", func(t *testing.T) {
		reader := &fakeInputsReader{overlayErr: errors.New("db down")}
		if _, err := ReleaseServerInputsFromStore(context.Background(), reader, "not-a-uuid"); err != nil {
			t.Fatalf("unparseable org must degrade: %v", err)
		}
	})
}

// TestReleaseServerInputsForRelease (#1102 Slice D): the consumer-declared
// pin — inputs from exactly that release, fail-closed on anything else.
func TestReleaseServerInputsForRelease(t *testing.T) {
	ctx := context.Background()
	orgID := "11111111-1111-1111-1111-111111111111"
	pinID := uuid.MustParse("22222222-2222-2222-2222-222222222222")

	t.Run("assembles inputs from exactly the pinned published release", func(t *testing.T) {
		publishedAt := time.Now()
		reader := &fakeInputsReader{
			pinned:   &domain.LibraryRelease{ID: pinID, Status: domain.ReleaseStatusPublished, PublishedAt: &publishedAt},
			profiles: []domain.HardwareProfile{{ID: "prof-pin", Revision: "r1", Active: true}},
		}
		inputs, err := ReleaseServerInputsForRelease(ctx, reader, orgID, pinID)
		if err != nil {
			t.Fatal(err)
		}
		if inputs.LibraryReleaseID != pinID.String() {
			t.Fatalf("release pin = %q", inputs.LibraryReleaseID)
		}
		if inputs.ProfilesByID["prof-pin"].ID != "prof-pin" {
			t.Fatalf("profiles = %+v", inputs.ProfilesByID)
		}
	})

	t.Run("pin to a draft fails closed with ErrReleaseNotPublished", func(t *testing.T) {
		reader := &fakeInputsReader{
			pinned: &domain.LibraryRelease{ID: pinID, Status: domain.ReleaseStatusDraft},
		}
		_, err := ReleaseServerInputsForRelease(ctx, reader, orgID, pinID)
		if !errors.Is(err, ErrReleaseNotPublished) {
			t.Fatalf("err = %v", err)
		}
	})

	t.Run("pin to an unknown release fails closed", func(t *testing.T) {
		reader := &fakeInputsReader{}
		_, err := ReleaseServerInputsForRelease(ctx, reader, orgID, pinID)
		if !errors.Is(err, ErrLibraryReleaseNotFound) {
			t.Fatalf("err = %v", err)
		}
	})
}
