package storage

// #1102 frozen geometry: the pinned consumer's catalog decodes from the
// release manifest + content-addressed blobs, fail-closed on gaps.

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

type fakeContentReader struct {
	manifest    *domain.LibraryManifest
	manifestErr error
	blobs       map[string]*domain.ResourceBlob
}

func (f *fakeContentReader) GetReleaseManifest(context.Context, uuid.UUID) (*domain.LibraryManifest, []byte, error) {
	if f.manifestErr != nil {
		return nil, nil, f.manifestErr
	}
	return f.manifest, nil, nil
}

func (f *fakeContentReader) GetResourceBlob(_ context.Context, sha256 string) (*domain.ResourceBlob, error) {
	if blob, ok := f.blobs[sha256]; ok {
		return blob, nil
	}
	return nil, errors.New("blob not found")
}

func mustJSON(t *testing.T, value any) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestFrozenCatalogForRelease(t *testing.T) {
	ctx := context.Background()
	releaseID := uuid.MustParse("22222222-2222-2222-2222-999999999999")

	t.Run("decodes every geometry kind into the assembled catalog", func(t *testing.T) {
		manifest := &domain.LibraryManifest{Resources: []domain.ManifestResourceRef{
			{Kind: "module", ID: uuid.MustParse("a0000005-0000-0000-0000-000000000001"), DefinitionHash: "sha256:m1"},
			{Kind: "material", ID: uuid.MustParse("a0000001-0000-0000-0000-000000000001"), DefinitionHash: "sha256:mat1"},
			{Kind: "hardware", ID: uuid.MustParse("a0000003-0000-0000-0000-000000000012"), DefinitionHash: "sha256:hw1"},
		}}
		reader := &fakeContentReader{
			manifest: manifest,
			blobs: map[string]*domain.ResourceBlob{
				"sha256:m1":   {Content: mustJSON(t, domain.Module{ID: "a0000005-0000-0000-0000-000000000001", Code: "VIG", Name: "Vigas", WidthMm: 611})},
				"sha256:mat1": {Content: mustJSON(t, domain.MaterialBoard{ID: "a0000001-0000-0000-0000-000000000001", Code: "ROBLE"})},
				"sha256:hw1":  {Content: mustJSON(t, domain.Hardware{ID: "a0000003-0000-0000-0000-000000000012", Code: "BIS"})},
			},
		}
		catalog, materialCategories, err := FrozenCatalogForRelease(ctx, reader, releaseID)
		if err != nil {
			t.Fatal(err)
		}
		if len(catalog.Modules) != 1 || catalog.Modules[0].WidthMm != 611 {
			t.Fatalf("modules = %+v", catalog.Modules)
		}
		if len(catalog.Materials) != 1 || len(catalog.Hardware) != 1 {
			t.Fatalf("catalog = materials:%d hardware:%d", len(catalog.Materials), len(catalog.Hardware))
		}
		if len(materialCategories) != 0 {
			t.Fatalf("material categories = %+v", materialCategories)
		}
	})

	t.Run("missing blob fails closed", func(t *testing.T) {
		manifest := &domain.LibraryManifest{Resources: []domain.ManifestResourceRef{
			{Kind: "module", ID: uuid.MustParse("a0000005-0000-0000-0000-000000000001"), DefinitionHash: "sha256:gone"},
		}}
		reader := &fakeContentReader{manifest: manifest, blobs: map[string]*domain.ResourceBlob{}}
		_, _, err := FrozenCatalogForRelease(ctx, reader, releaseID)
		if !errors.Is(err, ErrFrozenCatalogIncomplete) {
			t.Fatalf("err = %v", err)
		}
	})

	t.Run("manifestless release fails closed", func(t *testing.T) {
		reader := &fakeContentReader{manifestErr: ErrManifestNotFound}
		if _, _, err := FrozenCatalogForRelease(ctx, reader, releaseID); err == nil {
			t.Fatal("expected failure without a manifest")
		}
	})
}
