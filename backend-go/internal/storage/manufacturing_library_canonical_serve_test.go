package storage_test

// #1164: content-addressed reads must serve canonical bytes. Postgres jsonb
// preserves the logical JSON but not the original bytes, so GetReleaseManifest
// and the blob getters re-canonicalize on read and the blob getters fail
// closed unless the canonical bytes hash to the recorded content address.

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// nonCanonical bytes differ from their own canonical form in key order and
// whitespace — exactly what a publish-time canonical document looks like
// after the jsonb round-trip.
const nonCanonicalBlob = `{ "zeta": 1, "alpha": { "b": [ { "x": 2, "a": 1 } ] } }`
const canonicalBlob = `{"alpha":{"b":[{"a":1,"x":2}]},"zeta":1}`

func TestManufacturingLibrary_CanonicalBlobServe(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := context.Background()
	adminStore := &storage.PostgresStore{Pool: fx.admin}

	rel, err := adminStore.CreateDraftRelease(ctx, storage.CreateDraftReleaseParams{
		LibraryID:     uuid.MustParse(domain.GraneteStandardLibraryID),
		Version:       "9.9.9-canonical-serve",
		SchemaVersion: 1,
	})
	if err != nil {
		t.Fatalf("create draft release: %v", err)
	}

	resourceID := uuid.MustParse("b0000005-0000-0000-0000-0000000000aa")
	digest := domain.ComputeSHA256Digest([]byte(canonicalBlob))

	// The blob row stores the jsonb-round-tripped bytes (non-canonical) and
	// the recorded content address of their canonical form, exactly like a
	// real publish: sha256 is computed over canonical bytes, jsonb stores
	// the parsed document.
	if _, err := fx.admin.Exec(ctx, `
		INSERT INTO library_resource_blobs (sha256, resource_kind, resource_id, content_type, size_bytes, content)
		VALUES ($1, 'furniture_definition', $2, 'application/json', $3, $4::jsonb)
	`, digest, resourceID, len(nonCanonicalBlob), nonCanonicalBlob); err != nil {
		t.Fatalf("insert blob: %v", err)
	}
	if _, err := fx.admin.Exec(ctx, `
		INSERT INTO library_release_resource_refs
		    (release_id, resource_kind, resource_id, resource_revision, definition_hash, package_kind)
		VALUES ($1, 'furniture_definition', $2, 'v1', $3, 'free')
	`, rel.ID, resourceID, digest); err != nil {
		t.Fatalf("insert resource ref: %v", err)
	}

	blob, err := adminStore.GetResourceBlob(ctx, digest)
	if err != nil {
		t.Fatalf("get resource blob: %v", err)
	}
	if string(blob.Content) != canonicalBlob {
		t.Errorf("served bytes must be canonical:\n got  %s\n want %s", blob.Content, canonicalBlob)
	}
	if blob.SizeBytes != int64(len(canonicalBlob)) {
		t.Errorf("served size must describe the served bytes: got %d, want %d", blob.SizeBytes, len(canonicalBlob))
	}

	served, pkgKind, err := adminStore.GetResourceBlobWithEntitlementCheck(ctx, rel.ID, resourceID, digest)
	if err != nil {
		t.Fatalf("get blob with entitlement check: %v", err)
	}
	if string(served.Content) != canonicalBlob {
		t.Errorf("entitlement-checked serve must be canonical: got %s", served.Content)
	}
	if pkgKind != domain.PackageKindFree {
		t.Errorf("expected package kind free, got %q", pkgKind)
	}

	// A corrupted pointer — recorded digest that matches nothing the stored
	// document can canonicalize to — fails closed instead of serving
	// unverifiable bytes. The entitlement path needs its own ref row so the
	// release join finds the tampered blob.
	tampered := domain.ComputeSHA256Digest([]byte(`{"unrelated":true}`))
	tamperedResourceID := uuid.MustParse("b0000005-0000-0000-0000-0000000000ab")
	if _, err := fx.admin.Exec(ctx, `
		INSERT INTO library_resource_blobs (sha256, resource_kind, resource_id, content_type, size_bytes, content)
		VALUES ($1, 'hardware_profile', $2, 'application/json', $3, $4::jsonb)
	`, tampered, tamperedResourceID, len(nonCanonicalBlob), nonCanonicalBlob); err != nil {
		t.Fatalf("insert tampered blob: %v", err)
	}
	if _, err := fx.admin.Exec(ctx, `
		INSERT INTO library_release_resource_refs
		    (release_id, resource_kind, resource_id, resource_revision, definition_hash, package_kind)
		VALUES ($1, 'hardware_profile', $2, 'v1', $3, 'free')
	`, rel.ID, tamperedResourceID, tampered); err != nil {
		t.Fatalf("insert tampered ref: %v", err)
	}
	_, err = adminStore.GetResourceBlob(ctx, tampered)
	if !errors.Is(err, storage.ErrResourceBlobDigestMismatch) {
		t.Fatalf("expected ErrResourceBlobDigestMismatch for tampered blob, got: %v", err)
	}
	_, _, err = adminStore.GetResourceBlobWithEntitlementCheck(ctx, rel.ID, tamperedResourceID, tampered)
	if !errors.Is(err, storage.ErrResourceBlobDigestMismatch) {
		t.Fatalf("expected ErrResourceBlobDigestMismatch through entitlement path, got: %v", err)
	}
}

func TestManufacturingLibrary_CanonicalManifestServe(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := context.Background()
	adminStore := &storage.PostgresStore{Pool: fx.admin}

	rel, err := adminStore.CreateDraftRelease(ctx, storage.CreateDraftReleaseParams{
		LibraryID:     uuid.MustParse(domain.GraneteStandardLibraryID),
		Version:       "9.9.9-canonical-manifest",
		SchemaVersion: 1,
	})
	if err != nil {
		t.Fatalf("create draft release: %v", err)
	}

	// Materialize a manifest whose byte form is NOT canonical (as jsonb
	// stores it) and prove GetReleaseManifest serves canonical bytes.
	manifest := &domain.LibraryManifest{
		SchemaVersion:      1,
		LibraryID:          uuid.MustParse(domain.GraneteStandardLibraryID),
		LibraryCode:        "0001",
		LibraryVersion:     "9.9.9-canonical-manifest",
		EffectiveReleaseID: rel.ID,
		Resources: []domain.ManifestResourceRef{
			{Kind: "furniture_definition", ID: uuid.MustParse("b0000005-0000-0000-0000-0000000000bb"),
				Revision: "v1", DefinitionHash: domain.ComputeSHA256Digest([]byte(canonicalBlob)), PackageKind: domain.PackageKindFree},
		},
	}
	recordedHash, _, err := domain.ComputeManifestHash(manifest)
	if err != nil {
		t.Fatalf("compute manifest hash: %v", err)
	}
	// The sloppy bytes carry the SAME logical document as the canonical
	// form (all fields present) with destroyed byte shape — exactly what a
	// jsonb round-trip leaves behind: parsed and re-serialized, order and
	// whitespace lost.
	full, err := json.Marshal(manifest)
	if err != nil {
		t.Fatalf("marshal manifest: %v", err)
	}
	var doc map[string]any
	if err := json.Unmarshal(full, &doc); err != nil {
		t.Fatalf("round-trip manifest: %v", err)
	}
	sloppy, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		t.Fatalf("build sloppy manifest: %v", err)
	}
	if _, err := fx.admin.Exec(ctx, `
		INSERT INTO library_release_manifests (release_id, manifest_hash, manifest_json)
		VALUES ($1, $2, $3::jsonb)
	`, rel.ID, recordedHash, string(sloppy)); err != nil {
		t.Fatalf("insert manifest: %v", err)
	}

	_, raw, err := adminStore.GetReleaseManifest(ctx, rel.ID)
	if err != nil {
		t.Fatalf("get release manifest: %v", err)
	}
	if got := string(raw); got == string(sloppy) {
		t.Error("served manifest must not be the jsonb text form; it must be canonical")
	}
	// The logical content survives: the recorded hash recomputes from the
	// served bytes (this is the consumer-side verification contract).
	var parsed domain.LibraryManifest
	if err := json.Unmarshal(raw, &parsed); err != nil {
		t.Fatalf("parse served manifest: %v", err)
	}
	recomputed, _, err := domain.ComputeManifestHash(&parsed)
	if err != nil {
		t.Fatalf("recompute manifest hash: %v", err)
	}
	if recomputed != recordedHash {
		t.Errorf("hash recomputed from served bytes must match the recorded hash: got %s, want %s", recomputed, recordedHash)
	}
}
