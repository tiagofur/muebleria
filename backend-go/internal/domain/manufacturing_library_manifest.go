package domain

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"github.com/google/uuid"
)

// Schema version contract (LIB-2 / #773).
const LibraryManifestSchemaVersion = 1

// ManifestAssetRef represents an immutable reference to an existing canonical 3D/preview asset.
// Does NOT own a parallel asset identity; references canonical SHA-256 asset hash.
type ManifestAssetRef struct {
	Kind   string `json:"kind"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}

// ManifestResourceRef represents one canonical resource entry within the manifest.
type ManifestResourceRef struct {
	Kind           string             `json:"kind"`
	ID             uuid.UUID          `json:"id"`
	Revision       string             `json:"revision"`
	DefinitionHash string             `json:"definitionHash"`
	PackageKind    PackageKind        `json:"packageKind"` // "free" | "standard"
	Assets         []ManifestAssetRef `json:"assets,omitempty"`
}

// ManifestUpstreamRef records upstream base library info for overlays.
type ManifestUpstreamRef struct {
	LibraryID uuid.UUID `json:"libraryId"`
	ReleaseID uuid.UUID `json:"releaseId"`
	Version   string    `json:"version"`
}

// LibraryManifest is the complete, deterministic, content-addressed manifest
// describing all resources and asset references of a library release.
type LibraryManifest struct {
	SchemaVersion      int                   `json:"schemaVersion"`
	LibraryID          uuid.UUID             `json:"libraryId"`
	LibraryCode        string                `json:"libraryCode"`
	LibraryVersion     string                `json:"libraryVersion"`
	EffectiveReleaseID uuid.UUID             `json:"effectiveReleaseId"`
	MinPluginVersion   *string               `json:"minPluginVersion,omitempty"`
	Upstream           *ManifestUpstreamRef  `json:"upstream,omitempty"`
	ManifestHash       string                `json:"manifestHash"`
	Resources          []ManifestResourceRef `json:"resources"`
}

// ResourceBlob represents a content-addressed canonical JSON definition stored in PostgreSQL.
type ResourceBlob struct {
	SHA256       string          `json:"sha256"`
	ResourceKind string          `json:"resourceKind"`
	ResourceID   uuid.UUID       `json:"resourceId"`
	ContentType  string          `json:"contentType"`
	SizeBytes    int64           `json:"sizeBytes"`
	Content      json.RawMessage `json:"content"`
	CreatedAt    time.Time       `json:"createdAt"`
}

// ComputeSHA256Digest formats a SHA-256 digest in the canonical "sha256:<hex>" representation.
func ComputeSHA256Digest(data []byte) string {
	sum := sha256.Sum256(data)
	return fmt.Sprintf("sha256:%x", sum)
}

// CanonicalizeJSON ensures deterministic, whitespace-normalized JSON without HTML escaping.
func CanonicalizeJSON(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, fmt.Errorf("canonicalize json: %w", err)
	}
	return bytes.TrimSuffix(buf.Bytes(), []byte("\n")), nil
}

// SortManifestResources deterministically sorts resources by kind, then ID, then revision.
func SortManifestResources(resources []ManifestResourceRef) {
	sort.Slice(resources, func(i, j int) bool {
		if resources[i].Kind != resources[j].Kind {
			return resources[i].Kind < resources[j].Kind
		}
		if resources[i].ID != resources[j].ID {
			return resources[i].ID.String() < resources[j].ID.String()
		}
		return resources[i].Revision < resources[j].Revision
	})
	for i := range resources {
		if len(resources[i].Assets) > 1 {
			sort.Slice(resources[i].Assets, func(a, b int) bool {
				if resources[i].Assets[a].Kind != resources[i].Assets[b].Kind {
					return resources[i].Assets[a].Kind < resources[i].Assets[b].Kind
				}
				return resources[i].Assets[a].SHA256 < resources[i].Assets[b].SHA256
			})
		}
	}
}

// ComputeManifestHash computes the deterministic SHA-256 hash of the manifest,
// populates manifest.ManifestHash, and returns the hash and canonical serialized manifest.
func ComputeManifestHash(m *LibraryManifest) (string, []byte, error) {
	// Sort resources deterministically before hashing
	SortManifestResources(m.Resources)

	// Clone manifest without the manifestHash for fingerprint computation
	type manifestPayload struct {
		SchemaVersion      int                   `json:"schemaVersion"`
		LibraryID          uuid.UUID             `json:"libraryId"`
		LibraryCode        string                `json:"libraryCode"`
		LibraryVersion     string                `json:"libraryVersion"`
		EffectiveReleaseID uuid.UUID             `json:"effectiveReleaseId"`
		MinPluginVersion   *string               `json:"minPluginVersion,omitempty"`
		Upstream           *ManifestUpstreamRef  `json:"upstream,omitempty"`
		Resources          []ManifestResourceRef `json:"resources"`
	}

	payload := manifestPayload{
		SchemaVersion:      m.SchemaVersion,
		LibraryID:          m.LibraryID,
		LibraryCode:        m.LibraryCode,
		LibraryVersion:     m.LibraryVersion,
		EffectiveReleaseID: m.EffectiveReleaseID,
		MinPluginVersion:   m.MinPluginVersion,
		Upstream:           m.Upstream,
		Resources:          m.Resources,
	}

	preHashBytes, err := CanonicalizeJSON(payload)
	if err != nil {
		return "", nil, fmt.Errorf("canonicalize pre-hash manifest: %w", err)
	}

	hash := ComputeSHA256Digest(preHashBytes)
	m.ManifestHash = hash

	finalBytes, err := CanonicalizeJSON(m)
	if err != nil {
		return "", nil, fmt.Errorf("canonicalize final manifest: %w", err)
	}

	return hash, finalBytes, nil
}
