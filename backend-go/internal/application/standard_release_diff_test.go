package application

// #1102 Slice C: the publish-confirmation diff — draft vs published release,
// compared by content hash per resource.

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

type stubDiffStore struct {
	release    *domain.LibraryRelease
	published  *domain.LibraryRelease
	manifests  map[uuid.UUID]*domain.LibraryManifest
	blobs      map[string]*domain.ResourceBlob
	hardware   []domain.Hardware
	profiles   []domain.HardwareProfile
	releaseErr error
}

func (s *stubDiffStore) GetReleaseByID(context.Context, uuid.UUID) (*domain.LibraryRelease, error) {
	if s.releaseErr != nil {
		return nil, s.releaseErr
	}
	if s.release == nil {
		return nil, storage.ErrLibraryReleaseNotFound
	}
	return s.release, nil
}

func (s *stubDiffStore) GetCurrentPublishedRelease(context.Context, uuid.UUID) (*domain.LibraryRelease, error) {
	if s.published == nil {
		return nil, storage.ErrLibraryReleaseNotFound
	}
	return s.published, nil
}

func (s *stubDiffStore) GetReleaseManifest(_ context.Context, releaseID uuid.UUID) (*domain.LibraryManifest, []byte, error) {
	if m, ok := s.manifests[releaseID]; ok {
		return m, nil, nil
	}
	return nil, nil, errors.New("manifest not found")
}

func (s *stubDiffStore) GetResourceBlob(_ context.Context, sha256 string) (*domain.ResourceBlob, error) {
	if b, ok := s.blobs[sha256]; ok {
		return b, nil
	}
	return nil, errors.New("blob not found")
}

func (s *stubDiffStore) ListHardwares(context.Context) ([]domain.Hardware, error) {
	return s.hardware, nil
}

func (s *stubDiffStore) GetFullCatalog(context.Context) (domain.Catalog, error) {
	return domain.Catalog{Hardware: s.hardware}, nil
}

func (s *stubDiffStore) ListMaterialCategories(context.Context) ([]domain.MaterialCategory, error) {
	return nil, nil
}

func (s *stubDiffStore) ListActiveHardwareProfilesAnyOrg(context.Context) ([]domain.HardwareProfile, error) {
	return s.profiles, nil
}

func diffTestHardware(id, code string) domain.Hardware {
	return domain.Hardware{ID: id, Code: code, Name: "Bisagra " + code, Unit: "unidad", Active: true}
}

func TestDiffStandardDraft(t *testing.T) {
	ctx := context.Background()
	releaseID := uuid.MustParse(domain.GraneteStandardDraftReleaseID)

	draftRelease := func() *domain.LibraryRelease {
		return &domain.LibraryRelease{
			ID:            releaseID,
			LibraryID:     uuid.MustParse(domain.GraneteStandardLibraryID),
			Version:       "0.4.0",
			Status:        domain.ReleaseStatusDraft,
			SchemaVersion: domain.LibraryManifestSchemaVersion,
		}
	}
	validProfiles := func() []domain.HardwareProfile {
		return []domain.HardwareProfile{validProfile()}
	}

	// digestOf mirrors the compiler's content identity: canonicalize + sha256.
	digestOf := func(t *testing.T, payload any) string {
		t.Helper()
		raw, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		var unmarshaled any
		if err := json.Unmarshal(raw, &unmarshaled); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		canonical, err := domain.CanonicalizeJSON(unmarshaled)
		if err != nil {
			t.Fatalf("canonicalize: %v", err)
		}
		return domain.ComputeSHA256Digest(canonical)
	}

	t.Run("without a published base everything is added and labeled", func(t *testing.T) {
		store := &stubDiffStore{
			release:  draftRelease(),
			profiles: validProfiles(),
			hardware: []domain.Hardware{diffTestHardware("a0000003-0000-0000-0000-000000000012", "BIS-CL110")},
		}
		diff, err := DiffStandardDraft(ctx, store, releaseID)
		if err != nil {
			t.Fatalf("diff: %v", err)
		}
		if diff.Base != nil {
			t.Fatalf("base must be nil without a published release: %+v", diff.Base)
		}
		if len(diff.Added) != 2 || len(diff.Modified) != 0 || len(diff.Removed) != 0 {
			t.Fatalf("diff = added:%d modified:%d removed:%d", len(diff.Added), len(diff.Modified), len(diff.Removed))
		}
		codes := map[string]bool{}
		for _, change := range diff.Added {
			codes[change.Code] = true
		}
		if !codes["BIS-CL110"] || !codes["PERF-X"] {
			t.Fatalf("labels missing from added: %+v", diff.Added)
		}
	})

	t.Run("classifies added, modified, removed and unchanged against the base", func(t *testing.T) {
		kept := diffTestHardware("a0000003-0000-0000-0000-000000000012", "BIS-CL110")
		changed := diffTestHardware("a0000003-0000-0000-0000-000000000013", "BIS-CL200")
		changed.Name = "Bisagra CL200 renovada"
		removedRef := domain.ManifestResourceRef{
			Kind:           HardwareResourceKind,
			ID:             uuid.MustParse("a0000003-0000-0000-0000-000000000099"),
			Revision:       "rev-0",
			DefinitionHash: "sha256:removed",
			PackageKind:    domain.PackageKindFree,
		}
		keptHash := digestOf(t, kept)
		base := &domain.LibraryRelease{ID: uuid.MustParse("00000000-0000-0000-0003-000000000001"), Version: "0.3.4"}
		store := &stubDiffStore{
			release:   draftRelease(),
			published: base,
			manifests: map[uuid.UUID]*domain.LibraryManifest{
				base.ID: {Resources: []domain.ManifestResourceRef{
					{Kind: HardwareResourceKind, ID: uuid.MustParse(kept.ID), Revision: "rev-0", DefinitionHash: keptHash, PackageKind: domain.PackageKindFree},
					// Same resource as the draft's `changed`, stale hash → modified.
					{Kind: HardwareResourceKind, ID: uuid.MustParse(changed.ID), Revision: "rev-0", DefinitionHash: "sha256:stale", PackageKind: domain.PackageKindFree},
					removedRef,
				}},
			},
			blobs: map[string]*domain.ResourceBlob{
				"sha256:removed": func() *domain.ResourceBlob {
					raw, _ := json.Marshal(diffTestHardware(removedRef.ID.String(), "BIS-VIEJA"))
					return &domain.ResourceBlob{SHA256: "sha256:removed", Content: raw}
				}(),
			},
			profiles: validProfiles(),
			hardware: []domain.Hardware{kept, changed},
		}

		diff, err := DiffStandardDraft(ctx, store, releaseID)
		if err != nil {
			t.Fatalf("diff: %v", err)
		}
		if diff.Base == nil || diff.Base.Version != "0.3.4" {
			t.Fatalf("base = %+v", diff.Base)
		}
		if len(diff.Added) != 1 || diff.Added[0].Code != "PERF-X" {
			t.Fatalf("added = %+v", diff.Added)
		}
		if len(diff.Modified) != 1 || diff.Modified[0].Code != "BIS-CL200" {
			t.Fatalf("modified = %+v", diff.Modified)
		}
		if len(diff.Removed) != 1 || diff.Removed[0].Code != "BIS-VIEJA" {
			t.Fatalf("removed = %+v (esperaba label desde el blob)", diff.Removed)
		}
		if diff.Unchanged != 1 {
			t.Fatalf("unchanged = %d", diff.Unchanged)
		}
	})

	t.Run("guards mirror publish: unknown, foreign library and not-draft", func(t *testing.T) {
		if _, err := DiffStandardDraft(ctx, &stubDiffStore{}, releaseID); !errors.Is(err, storage.ErrLibraryReleaseNotFound) {
			t.Fatalf("unknown release err = %v", err)
		}
		foreign := draftRelease()
		foreign.LibraryID = uuid.MustParse("00000000-0000-0000-0002-000000000099")
		if _, err := DiffStandardDraft(ctx, &stubDiffStore{release: foreign}, releaseID); !errors.Is(err, ErrStandardLibraryNotFound) {
			t.Fatalf("foreign library err = %v", err)
		}
		published := draftRelease()
		published.Status = domain.ReleaseStatusPublished
		if _, err := DiffStandardDraft(ctx, &stubDiffStore{release: published}, releaseID); !errors.Is(err, ErrReleaseNotDraft) {
			t.Fatalf("not-draft err = %v", err)
		}
	})
}
