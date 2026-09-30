package domain

import (
	"testing"

	"github.com/google/uuid"
)

func TestLibraryManifest_DeterministicHashing(t *testing.T) {
	libID := uuid.MustParse(GraneteStandardLibraryID)
	relID := uuid.New()
	resID1 := uuid.New()
	resID2 := uuid.New()
	minPlugin := "1.0.0"

	m1 := &LibraryManifest{
		SchemaVersion:      LibraryManifestSchemaVersion,
		LibraryID:          libID,
		LibraryCode:        "0001",
		LibraryVersion:     "1.0.0",
		EffectiveReleaseID: relID,
		MinPluginVersion:   &minPlugin,
		Resources: []ManifestResourceRef{
			{
				Kind:           "furniture_definition",
				ID:             resID2,
				Revision:       "rev-2",
				DefinitionHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
				PackageKind:    PackageKindFree,
			},
			{
				Kind:           "furniture_definition",
				ID:             resID1,
				Revision:       "rev-1",
				DefinitionHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
				PackageKind:    PackageKindStandard,
			},
		},
	}

	m2 := &LibraryManifest{
		SchemaVersion:      LibraryManifestSchemaVersion,
		LibraryID:          libID,
		LibraryCode:        "0001",
		LibraryVersion:     "1.0.0",
		EffectiveReleaseID: relID,
		MinPluginVersion:   &minPlugin,
		Resources: []ManifestResourceRef{
			// Reverse order to verify deterministic sorting
			{
				Kind:           "furniture_definition",
				ID:             resID1,
				Revision:       "rev-1",
				DefinitionHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
				PackageKind:    PackageKindStandard,
			},
			{
				Kind:           "furniture_definition",
				ID:             resID2,
				Revision:       "rev-2",
				DefinitionHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
				PackageKind:    PackageKindFree,
			},
		},
	}

	hash1, bytes1, err := ComputeManifestHash(m1)
	if err != nil {
		t.Fatalf("ComputeManifestHash(m1) failed: %v", err)
	}

	hash2, bytes2, err := ComputeManifestHash(m2)
	if err != nil {
		t.Fatalf("ComputeManifestHash(m2) failed: %v", err)
	}

	if hash1 != hash2 {
		t.Fatalf("hashes differ despite identical input: %s vs %s", hash1, hash2)
	}
	if string(bytes1) != string(bytes2) {
		t.Fatalf("serialized bytes differ despite identical input:\n%s\nvs\n%s", string(bytes1), string(bytes2))
	}
}

func TestLibraryManifest_HashChangesOnAnyField(t *testing.T) {
	libID := uuid.MustParse(GraneteStandardLibraryID)
	relID := uuid.New()
	resID := uuid.New()

	base := &LibraryManifest{
		SchemaVersion:      LibraryManifestSchemaVersion,
		LibraryID:          libID,
		LibraryCode:        "0001",
		LibraryVersion:     "1.0.0",
		EffectiveReleaseID: relID,
		Resources: []ManifestResourceRef{
			{
				Kind:           "furniture_definition",
				ID:             resID,
				Revision:       "rev-1",
				DefinitionHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
				PackageKind:    PackageKindFree,
			},
		},
	}
	baseHash, _, _ := ComputeManifestHash(base)

	modified := &LibraryManifest{
		SchemaVersion:      LibraryManifestSchemaVersion,
		LibraryID:          libID,
		LibraryCode:        "0001",
		LibraryVersion:     "1.0.1", // changed version
		EffectiveReleaseID: relID,
		Resources: []ManifestResourceRef{
			{
				Kind:           "furniture_definition",
				ID:             resID,
				Revision:       "rev-1",
				DefinitionHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
				PackageKind:    PackageKindFree,
			},
		},
	}
	modHash, _, _ := ComputeManifestHash(modified)

	if baseHash == modHash {
		t.Fatalf("expected different hashes after version change, got %s", baseHash)
	}
}
