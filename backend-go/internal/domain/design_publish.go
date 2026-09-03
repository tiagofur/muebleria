package domain

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"time"
)

// #392 / DT-8: staged publish sessions, semantic manifest v1 and design
// revision artifacts (ADR-0003, digital-thread §§17-18, 21, 26, 28).

var manifestUUIDPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func isValidManifestUUID(v string) bool {
	return manifestUUIDPattern.MatchString(v)
}

// DesignPublishArtifactKind enumerates the required artifacts of a publish.
type DesignPublishArtifactKind string

const (
	DesignPublishArtifactModel    DesignPublishArtifactKind = "model"
	DesignPublishArtifactManifest DesignPublishArtifactKind = "manifest"
	DesignPublishArtifactPreview DesignPublishArtifactKind = "preview"
)

// RequiredDesignPublishArtifacts is the exact set finalize demands. A
// revision is only published when every one of them is present and hashed.
var RequiredDesignPublishArtifacts = []DesignPublishArtifactKind{
	DesignPublishArtifactModel,
	DesignPublishArtifactManifest,
	DesignPublishArtifactPreview,
}

func IsValidDesignPublishArtifactKind(kind DesignPublishArtifactKind) bool {
	switch kind {
	case DesignPublishArtifactModel, DesignPublishArtifactManifest, DesignPublishArtifactPreview:
		return true
	default:
		return false
	}
}

var (
	ErrPublishSessionNotFound            = errors.New("design publish session not found")
	ErrPublishSessionNotPrepared         = errors.New("design publish session is not prepared")
	ErrPublishArtifactMissing            = errors.New("design publish artifact missing")
	ErrPublishManifestInvalid            = errors.New("design publish manifest is invalid")
	ErrPublishManifestWorkingCopyMismatch = errors.New("design publish manifest does not match the working copy")
	ErrPublishArtifactHashMismatch       = errors.New("design publish artifact hash mismatch")
)

// DesignPublishManifestSource records the authoring client that produced the
// published state (issue #392 metadata requirements).
type DesignPublishManifestSource struct {
	Client          string `json:"client"`
	SketchUpVersion string `json:"sketchupVersion"`
	PluginVersion   string `json:"pluginVersion"`
}

// DesignPublishManifestItem is one managed FurnitureInstance in the
// manifest. Unmanaged geometry never appears here (negative proof B).
type DesignPublishManifestItem struct {
	FurnitureInstanceID    string                  `json:"furnitureInstanceId"`
	TechnicalClientLocator *TechnicalClientLocator `json:"technicalClientLocator,omitempty"`
}

// DesignPublishManifest is the versioned semantic companion of a publish
// (manifest v1). It describes what was published; the relational
// DesignRevisionItem snapshot — always derived from the working copy —
// remains the authoritative indexed truth (§4 of the DT-8 contract).
type DesignPublishManifest struct {
	SchemaVersion  int                        `json:"schemaVersion"`
	ProjectID      string                     `json:"projectId"`
	DesignID       string                     `json:"designId"`
	BaseRevisionID *string                    `json:"baseRevisionId,omitempty"`
	Source         DesignPublishManifestSource `json:"source"`
	Items          []DesignPublishManifestItem `json:"items"`
}

// DesignPublishManifestSchemaVersion pins manifest v1. Revisions keep their
// stored manifest bytes forever; a future v2 must not rewrite them.
const DesignPublishManifestSchemaVersion = 1

// CanonicalDesignPublishManifestJSON serializes a parsed manifest back to its
// canonical wire form. The uploaded manifest.json artifact must be semantically
// identical to the manifest accepted at prepare; canonical JSON comparison
// makes that check byte-exact and order-insensitive at the field level.
func CanonicalDesignPublishManifestJSON(m *DesignPublishManifest) ([]byte, error) {
	out, err := json.Marshal(m)
	if err != nil {
		return nil, fmt.Errorf("%w: manifest canonicalization: %v", ErrSerializationFailed, err)
	}
	return out, nil
}

// ParseDesignPublishManifest strictly decodes manifest v1. Unknown fields,
// wrong schema versions, non-UUID identities, duplicate items and malformed
// sources are rejected fail-closed — a manifest is never accepted merely for
// being valid JSON.
func ParseDesignPublishManifest(raw []byte) (*DesignPublishManifest, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	var m DesignPublishManifest
	if err := dec.Decode(&m); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrPublishManifestInvalid, err)
	}
	if err := validateDesignPublishManifest(&m); err != nil {
		return nil, err
	}
	return &m, nil
}

func validateDesignPublishManifest(m *DesignPublishManifest) error {
	if m.SchemaVersion != DesignPublishManifestSchemaVersion {
		return fmt.Errorf("%w: schemaVersion must be %d", ErrPublishManifestInvalid, DesignPublishManifestSchemaVersion)
	}
	if !isValidManifestUUID(m.ProjectID) {
		return fmt.Errorf("%w: projectId must be a UUID", ErrPublishManifestInvalid)
	}
	if !isValidManifestUUID(m.DesignID) {
		return fmt.Errorf("%w: designId must be a UUID", ErrPublishManifestInvalid)
	}
	if m.BaseRevisionID != nil && (len(*m.BaseRevisionID) == 0 || !isValidManifestUUID(*m.BaseRevisionID)) {
		return fmt.Errorf("%w: baseRevisionId must be a UUID or null", ErrPublishManifestInvalid)
	}
	// v1 manifests exist exactly for the SketchUp authoring client; a new
	// client means a new manifest version, never a silent widening.
	if m.Source.Client != "sketchup" {
		return fmt.Errorf("%w: source.client must be \"sketchup\" in v1", ErrPublishManifestInvalid)
	}
	if v := m.Source.SketchUpVersion; len(v) < 1 || len(v) > 64 {
		return fmt.Errorf("%w: source.sketchupVersion must be 1-64 chars", ErrPublishManifestInvalid)
	}
	if v := m.Source.PluginVersion; len(v) < 1 || len(v) > 64 {
		return fmt.Errorf("%w: source.pluginVersion must be 1-64 chars", ErrPublishManifestInvalid)
	}
	seen := make(map[string]struct{}, len(m.Items))
	for i, item := range m.Items {
		if !isValidManifestUUID(item.FurnitureInstanceID) {
			return fmt.Errorf("%w: items[%d].furnitureInstanceId must be a UUID", ErrPublishManifestInvalid, i)
		}
		if _, dup := seen[item.FurnitureInstanceID]; dup {
			return fmt.Errorf("%w: items[%d] duplicates furniture instance %s", ErrPublishManifestInvalid, i, item.FurnitureInstanceID)
		}
		seen[item.FurnitureInstanceID] = struct{}{}
		if item.TechnicalClientLocator != nil {
			k := item.TechnicalClientLocator.Kind
			v := item.TechnicalClientLocator.Value
			if len(k) < 1 || len(k) > 32 || len(v) < 1 || len(v) > 256 {
				return fmt.Errorf("%w: items[%d].technicalClientLocator has invalid kind/value", ErrPublishManifestInvalid, i)
			}
		}
	}
	return nil
}

// ManifestInstanceIDs returns the manifest's furniture instance IDs in
// declared order.
func (m *DesignPublishManifest) ManifestInstanceIDs() []string {
	ids := make([]string, 0, len(m.Items))
	for _, item := range m.Items {
		ids = append(ids, item.FurnitureInstanceID)
	}
	return ids
}

// DesignPublishSession is the staging row of one prepare → upload → finalize
// publication. BaseRevisionID is the exact base the client prepared against;
// finalize re-validates it under the design lock.
type DesignPublishSession struct {
	ID                    string            `json:"id"`
	OrganizationID        string            `json:"-"`
	ProjectID             string            `json:"project_id"`
	DesignID              string            `json:"design_id"`
	BaseRevisionID        *string           `json:"base_revision_id,omitempty"`
	Source                DesignPublishManifestSource `json:"-"`
	Manifest              *DesignPublishManifest      `json:"-"`
	Status                string            `json:"status"`
	CreatedBy             string            `json:"-"`
	CreatedAt             time.Time         `json:"created_at"`
	ExpiresAt             time.Time         `json:"expires_at"`
	FinalizedAt           *time.Time        `json:"finalized_at,omitempty"`
	FinalizedRevisionID   *string           `json:"finalized_revision_id,omitempty"`
}

// DesignRevisionArtifact is the persisted metadata of one published artifact.
// Bytes live on the filesystem under the organization media namespace; the
// storage key is server-generated and never client-supplied.
type DesignRevisionArtifact struct {
	ID               string    `json:"id"`
	OrganizationID   string    `json:"-"`
	ProjectID        string    `json:"project_id"`
	DesignRevisionID string    `json:"design_revision_id"`
	Kind             DesignPublishArtifactKind `json:"kind"`
	StorageKey       string    `json:"-"`
	ContentType      string    `json:"content_type"`
	SizeBytes        int64     `json:"size_bytes"`
	SHA256           string    `json:"sha256"`
	UploadedBy       string    `json:"uploaded_by,omitempty"`
	CreatedAt        time.Time `json:"created_at"`
}
