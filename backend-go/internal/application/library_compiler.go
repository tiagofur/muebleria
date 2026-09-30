package application

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

var (
	ErrReleaseNotDraft          = errors.New("only draft releases can be compiled")
	ErrUnsupportedSchemaVersion = errors.New("unsupported library manifest schema version")
	ErrEmptyLibraryVersion      = errors.New("library release version cannot be empty")
	ErrInvalidResourceData      = errors.New("invalid canonical resource definition data")
	ErrDuplicateResource        = errors.New("duplicate resource reference in release")
)

// CompilationResourceInput represents one canonical resource to be compiled into the release.
type CompilationResourceInput struct {
	Kind        string                    `json:"kind"`
	ID          uuid.UUID                 `json:"id"`
	Revision    string                    `json:"revision"`
	PackageKind domain.PackageKind        `json:"packageKind"`
	RawJSON     []byte                    `json:"rawJson"`
	Assets      []domain.ManifestAssetRef `json:"assets,omitempty"`
}

// CompilationInput contains all authoritative inputs required to build an immutable release manifest.
type CompilationInput struct {
	Library   *domain.ManufacturingLibrary
	Release   *domain.LibraryRelease
	Resources []CompilationResourceInput
}

// CompilationResult holds the deterministic manifest and content-addressed blobs.
type CompilationResult struct {
	Manifest      *domain.LibraryManifest
	ManifestBytes []byte
	ManifestHash  string
	Blobs         []domain.ResourceBlob
}

// CompileLibraryRelease performs pure, deterministic compilation of a draft release into its
// canonical manifest and content-addressed JSON definition blobs.
func CompileLibraryRelease(input CompilationInput) (*CompilationResult, error) {
	if input.Release == nil || input.Library == nil {
		return nil, errors.New("library and release must not be nil")
	}
	if input.Release.Status != domain.ReleaseStatusDraft {
		return nil, ErrReleaseNotDraft
	}
	if input.Release.SchemaVersion != domain.LibraryManifestSchemaVersion {
		return nil, fmt.Errorf("%w: %d (supported: %d)", ErrUnsupportedSchemaVersion, input.Release.SchemaVersion, domain.LibraryManifestSchemaVersion)
	}
	if input.Release.Version == "" {
		return nil, ErrEmptyLibraryVersion
	}

	seen := make(map[string]bool)
	manifestRefs := make([]domain.ManifestResourceRef, 0, len(input.Resources))
	blobs := make([]domain.ResourceBlob, 0, len(input.Resources))

	for _, res := range input.Resources {
		key := fmt.Sprintf("%s:%s", res.Kind, res.ID.String())
		if seen[key] {
			return nil, fmt.Errorf("%w: %s", ErrDuplicateResource, key)
		}
		seen[key] = true

		if len(res.RawJSON) == 0 {
			return nil, fmt.Errorf("%w: resource %s has empty payload", ErrInvalidResourceData, key)
		}

		// Validate raw JSON syntax and canonicalize it deterministically
		var unmarshaled any
		if err := json.Unmarshal(res.RawJSON, &unmarshaled); err != nil {
			return nil, fmt.Errorf("%w: resource %s contains invalid JSON: %v", ErrInvalidResourceData, key, err)
		}

		canonicalBytes, err := domain.CanonicalizeJSON(unmarshaled)
		if err != nil {
			return nil, fmt.Errorf("canonicalize resource %s: %w", key, err)
		}

		defHash := domain.ComputeSHA256Digest(canonicalBytes)

		blobs = append(blobs, domain.ResourceBlob{
			SHA256:       defHash,
			ResourceKind: res.Kind,
			ResourceID:   res.ID,
			ContentType:  "application/json",
			SizeBytes:    int64(len(canonicalBytes)),
			Content:      canonicalBytes,
		})

		manifestRefs = append(manifestRefs, domain.ManifestResourceRef{
			Kind:           res.Kind,
			ID:             res.ID,
			Revision:       res.Revision,
			DefinitionHash: defHash,
			PackageKind:    res.PackageKind,
			Assets:         res.Assets,
		})
	}

	// Sort manifest resources deterministically
	domain.SortManifestResources(manifestRefs)

	manifest := &domain.LibraryManifest{
		SchemaVersion:      input.Release.SchemaVersion,
		LibraryID:          input.Library.ID,
		LibraryCode:        input.Library.Code,
		LibraryVersion:     input.Release.Version,
		EffectiveReleaseID: input.Release.ID,
		MinPluginVersion:   input.Release.MinPluginVersion,
		Resources:          manifestRefs,
	}

	if input.Release.BaseReleaseID != nil {
		manifest.Upstream = &domain.ManifestUpstreamRef{
			ReleaseID: *input.Release.BaseReleaseID,
		}
	}

	manifestHash, manifestBytes, err := domain.ComputeManifestHash(manifest)
	if err != nil {
		return nil, fmt.Errorf("compute manifest hash: %w", err)
	}

	return &CompilationResult{
		Manifest:      manifest,
		ManifestBytes: manifestBytes,
		ManifestHash:  manifestHash,
		Blobs:         blobs,
	}, nil
}
