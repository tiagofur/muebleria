package application

import (
	"math/rand"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func TestCompileLibraryRelease_DeterminismUnderShuffle(t *testing.T) {
	libID := uuid.MustParse(domain.GraneteStandardLibraryID)
	relID := uuid.New()
	minPlugin := "1.0.0"

	lib := &domain.ManufacturingLibrary{
		ID:     libID,
		Code:   "0001",
		Kind:   domain.LibraryKindStandard,
		Status: "active",
	}

	rel := &domain.LibraryRelease{
		ID:               relID,
		LibraryID:        libID,
		Version:          "1.0.0",
		Status:           domain.ReleaseStatusDraft,
		SchemaVersion:    domain.LibraryManifestSchemaVersion,
		MinPluginVersion: &minPlugin,
	}

	res1 := CompilationResourceInput{
		Kind:        "furniture_definition",
		ID:          uuid.New(),
		Revision:    "rev-1",
		PackageKind: domain.PackageKindFree,
		RawJSON:     []byte(`{"name":"Gabinete Base 1P","dimensions":{"width":600,"height":720,"depth":580}}`),
		Assets: []domain.ManifestAssetRef{
			{Kind: "preview", SHA256: "sha256:1111111111111111111111111111111111111111111111111111111111111111", Size: 1024},
		},
	}

	res2 := CompilationResourceInput{
		Kind:        "furniture_definition",
		ID:          uuid.New(),
		Revision:    "rev-2",
		PackageKind: domain.PackageKindStandard,
		RawJSON:     []byte(`{"name":"Gabinete Alto 2P","dimensions":{"width":800,"height":600,"depth":320}}`),
		Assets: []domain.ManifestAssetRef{
			{Kind: "preview", SHA256: "sha256:2222222222222222222222222222222222222222222222222222222222222222", Size: 2048},
		},
	}

	res3 := CompilationResourceInput{
		Kind:        "hardware",
		ID:          uuid.New(),
		Revision:    "rev-1",
		PackageKind: domain.PackageKindFree,
		RawJSON:     []byte(`{"sku":"BIS-CLIP-110","name":"Bisagra Clip Top 110"}`),
	}

	resources := []CompilationResourceInput{res1, res2, res3}

	// First reference compilation
	refResult, err := CompileLibraryRelease(CompilationInput{
		Library:   lib,
		Release:   rel,
		Resources: resources,
	})
	if err != nil {
		t.Fatalf("reference compilation failed: %v", err)
	}

	// 50 iterations with shuffled input order
	rng := rand.New(rand.NewSource(time.Now().UnixNano()))
	for i := 0; i < 50; i++ {
		shuffled := append([]CompilationResourceInput(nil), resources...)
		rng.Shuffle(len(shuffled), func(a, b int) {
			shuffled[a], shuffled[b] = shuffled[b], shuffled[a]
		})

		res, err := CompileLibraryRelease(CompilationInput{
			Library:   lib,
			Release:   rel,
			Resources: shuffled,
		})
		if err != nil {
			t.Fatalf("iteration %d failed: %v", i, err)
		}

		if res.ManifestHash != refResult.ManifestHash {
			t.Fatalf("iteration %d produced divergent manifest hash: %s vs %s", i, res.ManifestHash, refResult.ManifestHash)
		}
		if string(res.ManifestBytes) != string(refResult.ManifestBytes) {
			t.Fatalf("iteration %d produced divergent manifest bytes", i)
		}
	}
}

func TestCompileLibraryRelease_FreeStandardHashParity(t *testing.T) {
	libID := uuid.MustParse(domain.GraneteStandardLibraryID)
	relID := uuid.New()
	sharedID := uuid.New()
	rawDefinition := []byte(`{"sku":"MOD-BASE-60","name":"Gabinete 60cm"}`)

	lib := &domain.ManufacturingLibrary{ID: libID, Code: "0001", Kind: domain.LibraryKindStandard, Status: "active"}
	rel := &domain.LibraryRelease{ID: relID, LibraryID: libID, Version: "1.0.0", Status: domain.ReleaseStatusDraft, SchemaVersion: 1}

	// Compiled as Free
	resFree, err := CompileLibraryRelease(CompilationInput{
		Library: lib,
		Release: rel,
		Resources: []CompilationResourceInput{
			{Kind: "furniture_definition", ID: sharedID, Revision: "r1", PackageKind: domain.PackageKindFree, RawJSON: rawDefinition},
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	// Compiled as Standard
	resStd, err := CompileLibraryRelease(CompilationInput{
		Library: lib,
		Release: rel,
		Resources: []CompilationResourceInput{
			{Kind: "furniture_definition", ID: sharedID, Revision: "r1", PackageKind: domain.PackageKindStandard, RawJSON: rawDefinition},
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	// The definitionHash of the resource blob must be identical regardless of package entitlement
	freeBlobHash := resFree.Blobs[0].SHA256
	stdBlobHash := resStd.Blobs[0].SHA256

	if freeBlobHash != stdBlobHash {
		t.Fatalf("expected identical definitionHash across Free and Standard for identical content, got %s vs %s", freeBlobHash, stdBlobHash)
	}
}

func TestCompileLibraryRelease_ChangeIsolation(t *testing.T) {
	libID := uuid.MustParse(domain.GraneteStandardLibraryID)
	relID := uuid.New()
	resID1 := uuid.New()
	resID2 := uuid.New()

	lib := &domain.ManufacturingLibrary{ID: libID, Code: "0001", Kind: domain.LibraryKindStandard, Status: "active"}
	rel := &domain.LibraryRelease{ID: relID, LibraryID: libID, Version: "1.0.0", Status: domain.ReleaseStatusDraft, SchemaVersion: 1}

	res1Initial := CompilationResourceInput{
		Kind: "furniture_definition", ID: resID1, Revision: "r1", PackageKind: domain.PackageKindFree,
		RawJSON: []byte(`{"name":"Module A","version":1}`),
	}
	res2Stable := CompilationResourceInput{
		Kind: "furniture_definition", ID: resID2, Revision: "r1", PackageKind: domain.PackageKindFree,
		RawJSON: []byte(`{"name":"Module B Stable","version":1}`),
	}

	c1, err := CompileLibraryRelease(CompilationInput{
		Library: lib, Release: rel, Resources: []CompilationResourceInput{res1Initial, res2Stable},
	})
	if err != nil {
		t.Fatal(err)
	}

	// Now modify only Module A
	res1Modified := CompilationResourceInput{
		Kind: "furniture_definition", ID: resID1, Revision: "r2", PackageKind: domain.PackageKindFree,
		RawJSON: []byte(`{"name":"Module A Modified","version":2}`),
	}

	c2, err := CompileLibraryRelease(CompilationInput{
		Library: lib, Release: rel, Resources: []CompilationResourceInput{res1Modified, res2Stable},
	})
	if err != nil {
		t.Fatal(err)
	}

	// Module B's definitionHash must remain unchanged
	var modBHash1, modBHash2 string
	for _, b := range c1.Blobs {
		if b.ResourceID == resID2 {
			modBHash1 = b.SHA256
		}
	}
	for _, b := range c2.Blobs {
		if b.ResourceID == resID2 {
			modBHash2 = b.SHA256
		}
	}

	if modBHash1 != modBHash2 {
		t.Fatalf("unchanged resource received new hash: %s vs %s", modBHash1, modBHash2)
	}

	// While the manifest hash overall did change
	if c1.ManifestHash == c2.ManifestHash {
		t.Fatalf("manifest hash should have changed after resource modification")
	}
}

func TestCompileLibraryRelease_ValidationFailures(t *testing.T) {
	lib := &domain.ManufacturingLibrary{ID: uuid.New(), Code: "0001", Kind: domain.LibraryKindStandard}

	t.Run("RejectsPublishedRelease", func(t *testing.T) {
		rel := &domain.LibraryRelease{Status: domain.ReleaseStatusPublished, SchemaVersion: 1, Version: "1.0.0"}
		_, err := CompileLibraryRelease(CompilationInput{Library: lib, Release: rel})
		if err != ErrReleaseNotDraft {
			t.Fatalf("expected ErrReleaseNotDraft, got %v", err)
		}
	})

	t.Run("RejectsUnsupportedSchemaVersion", func(t *testing.T) {
		rel := &domain.LibraryRelease{Status: domain.ReleaseStatusDraft, SchemaVersion: 999, Version: "1.0.0"}
		_, err := CompileLibraryRelease(CompilationInput{Library: lib, Release: rel})
		if err == nil {
			t.Fatal("expected error for schemaVersion 999")
		}
	})

	t.Run("RejectsInvalidJSONPayload", func(t *testing.T) {
		rel := &domain.LibraryRelease{Status: domain.ReleaseStatusDraft, SchemaVersion: 1, Version: "1.0.0"}
		_, err := CompileLibraryRelease(CompilationInput{
			Library: lib, Release: rel,
			Resources: []CompilationResourceInput{
				{Kind: "furniture_definition", ID: uuid.New(), Revision: "r1", PackageKind: domain.PackageKindFree, RawJSON: []byte(`{invalid-json`)},
			},
		})
		if err == nil {
			t.Fatal("expected error for invalid json payload")
		}
	})

	t.Run("RejectsDuplicateResourceID", func(t *testing.T) {
		rel := &domain.LibraryRelease{Status: domain.ReleaseStatusDraft, SchemaVersion: 1, Version: "1.0.0"}
		sameID := uuid.New()
		_, err := CompileLibraryRelease(CompilationInput{
			Library: lib, Release: rel,
			Resources: []CompilationResourceInput{
				{Kind: "furniture_definition", ID: sameID, Revision: "r1", PackageKind: domain.PackageKindFree, RawJSON: []byte(`{}`)},
				{Kind: "furniture_definition", ID: sameID, Revision: "r2", PackageKind: domain.PackageKindStandard, RawJSON: []byte(`{}`)},
			},
		})
		if err == nil {
			t.Fatal("expected error for duplicate resource id")
		}
	})
}
