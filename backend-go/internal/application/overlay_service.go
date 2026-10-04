package application

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #775 [P1][LIB-4]: Organization manufacturing-library overlay and 3-way rebase service.
// Coordinates overlay lifecycle, path validation, 3-way rebase execution against upstream releases,
// conflict resolution workflow, and deterministic candidate compilation.

var (
	ErrUnauthorizedOverlayAccess = errors.New("unauthorized access to library overlay")

	// ErrNoPolicyDraft: activation without a staged draft.
	ErrNoPolicyDraft = errors.New("library overlay has no policy draft to activate")

	// ErrInvalidPolicyDraft: the staged draft fails the engine's own policy
	// validation — activation refuses it with the parser's issue.
	ErrInvalidPolicyDraft           = errors.New("policy draft is not activatable")
	ErrBaseReleaseNotPublished      = errors.New("target base release must be in published status")
	ErrBaseReleaseLibraryMismatch   = errors.New("target base release does not belong to the upstream library lineage")
	ErrRebasePendingConflictsRemain = errors.New("overlay has unresolved rebase conflicts blocking activation/publication")
	ErrInvalidOverridePath          = errors.New("invalid or unauthorized override path")
	ErrInvalidResolutionAction      = errors.New("invalid conflict resolution action")
)

// OverlayStore defines the storage contract required by OverlayService.
type OverlayStore interface {
	GetOverlayByID(ctx context.Context, id uuid.UUID) (*domain.LibraryOverlay, error)
	GetActiveOverlayByLibrary(ctx context.Context, organizationID, libraryID uuid.UUID) (*domain.LibraryOverlay, error)
	CreateOverlay(ctx context.Context, overlay *domain.LibraryOverlay) (*domain.LibraryOverlay, error)
	UpdateOverlayOverrides(ctx context.Context, id uuid.UUID, expectedVersion int64, overrides json.RawMessage, customResourceIDs []uuid.UUID) error
	SavePolicyDraft(ctx context.Context, id uuid.UUID, expectedVersion int64, draft json.RawMessage) error
	ActivatePolicyDraft(ctx context.Context, id uuid.UUID, expectedVersion int64, mergedOverrides json.RawMessage) error
	UpdateOverlayStatus(ctx context.Context, id uuid.UUID, status string) error
	UpdateOverlayBaseRelease(ctx context.Context, id uuid.UUID, newBaseReleaseID uuid.UUID, overrides json.RawMessage, status string) error
	ReplaceOverlayPendingConflicts(ctx context.Context, overlayID uuid.UUID, conflicts []domain.LibraryOverlayConflict) error
	ListOverlayConflicts(ctx context.Context, overlayID uuid.UUID, statusFilter string) ([]domain.LibraryOverlayConflict, error)
	GetOverlayConflictByID(ctx context.Context, conflictID uuid.UUID) (*domain.LibraryOverlayConflict, error)
	ResolveOverlayConflict(ctx context.Context, conflictID uuid.UUID, action domain.ResolutionAction, resolvedValue any, resolvedBy *uuid.UUID) error
	CountPendingConflicts(ctx context.Context, overlayID uuid.UUID) (int, error)
	GetReleaseByID(ctx context.Context, id uuid.UUID) (*domain.LibraryRelease, error)
	GetReleaseManifest(ctx context.Context, releaseID uuid.UUID) (*domain.LibraryManifest, []byte, error)
	GetResourceBlob(ctx context.Context, sha256 string) (*domain.ResourceBlob, error)
}

// OverlayService orchestrates tenant manufacturing library overlays and safe rebase workflows.
type OverlayService struct {
	store OverlayStore
}

// NewOverlayService constructs a new OverlayService instance.
func NewOverlayService(store OverlayStore) *OverlayService {
	return &OverlayService{store: store}
}

// Permitted override path namespaces according to Granete Standard design authoring defaults.
var permittedPrefixes = []string{
	"parameters.",
	"rules.",
	"joint.",
	"construction.",
	"hardware.",
	"tolerances.",
	"finish.",
	"defaults.",
}

// ValidateOverridePaths verifies that all keys in flattened overrides belong to supported namespaces.
func ValidateOverridePaths(overrides map[string]any) error {
	for path := range overrides {
		if strings.HasPrefix(path, "id") ||
			strings.HasPrefix(path, "library") ||
			strings.HasPrefix(path, "manifest") ||
			strings.HasPrefix(path, "schemaVersion") {
			return fmt.Errorf("%w: unauthorized structural path %q", ErrInvalidOverridePath, path)
		}
		permitted := false
		for _, prefix := range permittedPrefixes {
			if strings.HasPrefix(path, prefix) {
				permitted = true
				break
			}
		}
		if !permitted {
			return fmt.Errorf("%w: path %q must belong to permitted namespaces (parameters, rules, joint, hardware, tolerances, finish)", ErrInvalidOverridePath, path)
		}
	}
	return nil
}

// CreateOverlayParams contains parameters to create a new organization overlay.
type CreateOverlayParams struct {
	OrganizationID    uuid.UUID
	LibraryID         uuid.UUID
	BaseReleaseID     uuid.UUID
	Overrides         json.RawMessage
	CustomResourceIDs []uuid.UUID
}

// CreateOverlay validates the base release and establishes a new lightweight organization overlay.
func (s *OverlayService) CreateOverlay(ctx context.Context, params CreateOverlayParams) (*domain.LibraryOverlay, error) {
	// Validate base release exists
	baseRel, err := s.store.GetReleaseByID(ctx, params.BaseReleaseID)
	if err != nil {
		return nil, fmt.Errorf("validate base release %s: %w", params.BaseReleaseID, err)
	}
	if baseRel.Status != domain.ReleaseStatusPublished {
		return nil, fmt.Errorf("%w: status is %s", ErrBaseReleaseNotPublished, baseRel.Status)
	}

	// Validate overrides paths
	if len(params.Overrides) > 0 && string(params.Overrides) != "{}" {
		var rawMap map[string]any
		if err := json.Unmarshal(params.Overrides, &rawMap); err != nil {
			return nil, fmt.Errorf("invalid overrides JSON: %w", err)
		}
		flattened := make(map[string]any)
		domain.FlattenMap("", rawMap, flattened)
		if err := ValidateOverridePaths(flattened); err != nil {
			return nil, err
		}
	}

	overlay := &domain.LibraryOverlay{
		ID:                uuid.New(),
		OrganizationID:    params.OrganizationID,
		LibraryID:         params.LibraryID,
		BaseReleaseID:     params.BaseReleaseID,
		Status:            "active",
		Overrides:         params.Overrides,
		CustomResourceIDs: params.CustomResourceIDs,
	}

	return s.store.CreateOverlay(ctx, overlay)
}

// GetActiveOverlay retrieves the organization's active overlay for the specified library.
func (s *OverlayService) GetActiveOverlay(ctx context.Context, orgID, libraryID uuid.UUID) (*domain.LibraryOverlay, error) {
	return s.store.GetActiveOverlayByLibrary(ctx, orgID, libraryID)
}

// UpdateOverrides updates an organization's overrides and custom resource
// references under OPTIMISTIC CONCURRENCY (#875 slice 4): `expectedVersion`
// must still be the overlay's current version, or the write is refused so a
// second editor's save can never silently overwrite the first one's.
func (s *OverlayService) UpdateOverrides(
	ctx context.Context,
	overlayID uuid.UUID,
	orgID uuid.UUID,
	expectedVersion int64,
	overrides json.RawMessage,
	customResourceIDs []uuid.UUID,
) error {
	overlay, err := s.store.GetOverlayByID(ctx, overlayID)
	if err != nil {
		return err
	}
	if overlay.OrganizationID != orgID {
		return ErrUnauthorizedOverlayAccess
	}

	if len(overrides) > 0 && string(overrides) != "{}" {
		var rawMap map[string]any
		if err := json.Unmarshal(overrides, &rawMap); err != nil {
			return fmt.Errorf("invalid overrides JSON: %w", err)
		}
		flattened := make(map[string]any)
		domain.FlattenMap("", rawMap, flattened)
		if err := ValidateOverridePaths(flattened); err != nil {
			return err
		}
	}

	if overlay.Version != expectedVersion {
		return storage.ErrVersionConflict
	}
	return s.store.UpdateOverlayOverrides(ctx, overlayID, expectedVersion, overrides, customResourceIDs)
}

// policyDraftOwnedKeyPrefixes/policyDraftOwnedKeys mirror the TS client's
// CONSTRUCTION_POLICY_OWNED_KEY_PREFIXES/KEYS (factoryConstructionPolicy.ts):
// activation replaces EXACTLY these keys in the active overrides — foreign
// `joint.*` overrides (e.g. component exceptions) and `parameters.*` survive.
var policyDraftOwnedKeyPrefixes = []string{
	"joint.floorToSide.", "joint.topToSide.", "joint.shelfToSide.", "joint.backPanel.",
}

const policyDraftOwnedKeyBlob = "joint.constructionPolicy"

func policyDraftOwnsKey(key string) bool {
	if key == policyDraftOwnedKeyBlob {
		return true
	}
	for _, prefix := range policyDraftOwnedKeyPrefixes {
		if strings.HasPrefix(key, prefix) {
			return true
		}
	}
	return false
}

// SavePolicyDraft stages the construction policy draft (#875 slice 5). The
// draft must be a JSON object of construction-policy-owned keys (structural
// scoping only — this endpoint is the POLICY draft, not a shadow overlay
// writer); VALUES are intentionally unvalidated so an incomplete draft can
// persist per the issue contract. Validation belongs to activation.
func (s *OverlayService) SavePolicyDraft(
	ctx context.Context,
	overlayID uuid.UUID,
	orgID uuid.UUID,
	expectedVersion int64,
	draft json.RawMessage,
) error {
	overlay, err := s.store.GetOverlayByID(ctx, overlayID)
	if err != nil {
		return err
	}
	if overlay.OrganizationID != orgID {
		return ErrUnauthorizedOverlayAccess
	}
	if overlay.Version != expectedVersion {
		return storage.ErrVersionConflict
	}
	var keys map[string]any
	if err := json.Unmarshal(draft, &keys); err != nil {
		return fmt.Errorf("%w: draft must be a JSON object: %v", ErrInvalidPolicyDraft, err)
	}
	for key := range keys {
		if !policyDraftOwnsKey(key) {
			return fmt.Errorf("%w: key %q is outside the construction policy namespace", ErrInvalidPolicyDraft, key)
		}
	}
	return s.store.SavePolicyDraft(ctx, overlayID, expectedVersion, draft)
}

// ActivatePolicyDraft promotes the staged draft (#875 slice 5): the stored
// draft is validated with the ENGINE'S OWN policy parser — the honest gate,
// activatable exactly when the resolver can consume it — then merged into the
// active overrides (owned keys only) and cleared in one atomic write under
// the same optimistic-concurrency token. The merged result is recomputed from
// the row the version precondition still guards, so a concurrent writer can
// never be silently overwritten.
func (s *OverlayService) ActivatePolicyDraft(
	ctx context.Context,
	overlayID uuid.UUID,
	orgID uuid.UUID,
	expectedVersion int64,
) error {
	overlay, err := s.store.GetOverlayByID(ctx, overlayID)
	if err != nil {
		return err
	}
	if overlay.OrganizationID != orgID {
		return ErrUnauthorizedOverlayAccess
	}
	if overlay.Version != expectedVersion {
		return storage.ErrVersionConflict
	}
	if len(overlay.PolicyDraft) == 0 {
		return ErrNoPolicyDraft
	}
	if _, err := engine.ParseFactoryConstructionPolicy(overlay.PolicyDraft); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidPolicyDraft, err)
	}

	var active, draft map[string]any
	if err := json.Unmarshal(overlay.Overrides, &active); err != nil {
		return fmt.Errorf("decode active overrides: %w", err)
	}
	if active == nil {
		active = map[string]any{}
	}
	if err := json.Unmarshal(overlay.PolicyDraft, &draft); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidPolicyDraft, err)
	}
	merged := make(map[string]any, len(active)+len(draft))
	for key, value := range active {
		if policyDraftOwnsKey(key) {
			continue
		}
		merged[key] = value
	}
	for key, value := range draft {
		merged[key] = value
	}
	mergedJSON, err := json.Marshal(merged)
	if err != nil {
		return fmt.Errorf("merge policy draft: %w", err)
	}
	return s.store.ActivatePolicyDraft(ctx, overlayID, expectedVersion, mergedJSON)
}

// RebaseResult models the outcome returned to caller following a 3-way rebase pass.
type RebaseResult struct {
	OverlayID        uuid.UUID                       `json:"overlayId"`
	OldBaseReleaseID uuid.UUID                       `json:"oldBaseReleaseId"`
	NewBaseReleaseID uuid.UUID                       `json:"newBaseReleaseId"`
	HasConflicts     bool                            `json:"hasConflicts"`
	Conflicts        []domain.LibraryOverlayConflict `json:"conflicts,omitempty"`
	Status           string                          `json:"status"` // "active" (merged cleanly) or "rebase_conflict"
}

// ExecuteRebase runs a deterministic 3-way merge between OldBase, NewBase, and customer overrides.
func (s *OverlayService) ExecuteRebase(
	ctx context.Context,
	overlayID uuid.UUID,
	orgID uuid.UUID,
	targetReleaseID uuid.UUID,
) (*RebaseResult, error) {
	overlay, err := s.store.GetOverlayByID(ctx, overlayID)
	if err != nil {
		return nil, err
	}
	if overlay.OrganizationID != orgID {
		return nil, ErrUnauthorizedOverlayAccess
	}

	if overlay.BaseReleaseID == targetReleaseID {
		return &RebaseResult{
			OverlayID:        overlay.ID,
			OldBaseReleaseID: overlay.BaseReleaseID,
			NewBaseReleaseID: targetReleaseID,
			HasConflicts:     false,
			Status:           overlay.Status,
		}, nil
	}

	// Validate target release exists and is published
	targetRel, err := s.store.GetReleaseByID(ctx, targetReleaseID)
	if err != nil {
		return nil, fmt.Errorf("validate target release: %w", err)
	}
	if targetRel.Status != domain.ReleaseStatusPublished {
		return nil, fmt.Errorf("%w: status is %s", ErrBaseReleaseNotPublished, targetRel.Status)
	}

	// Load OldBase and NewBase manifests
	oldManifest, _, err := s.store.GetReleaseManifest(ctx, overlay.BaseReleaseID)
	if err != nil {
		return nil, fmt.Errorf("load old base manifest: %w", err)
	}
	newManifest, _, err := s.store.GetReleaseManifest(ctx, targetReleaseID)
	if err != nil {
		return nil, fmt.Errorf("load new base manifest: %w", err)
	}

	// Extract flattened parameter values
	oldBaseValues := s.extractManifestValues(ctx, oldManifest)
	newBaseValues := s.extractManifestValues(ctx, newManifest)

	// Flatten customer overrides
	customValues := make(map[string]any)
	if len(overlay.Overrides) > 0 && string(overlay.Overrides) != "{}" {
		var rawMap map[string]any
		if err := json.Unmarshal(overlay.Overrides, &rawMap); err == nil {
			domain.FlattenMap("", rawMap, customValues)
		}
	}

	input := domain.ThreeWayRebaseInput{
		OverlayID:         overlay.ID,
		OrganizationID:    overlay.OrganizationID,
		OldBaseReleaseID:  overlay.BaseReleaseID,
		NewBaseReleaseID:  targetReleaseID,
		OldBaseValues:     oldBaseValues,
		NewBaseValues:     newBaseValues,
		CustomValues:      customValues,
		CustomResourceIDs: overlay.CustomResourceIDs,
	}

	result := domain.ExecuteThreeWayRebase(input)

	if result.HasConflicts {
		// Record conflicts in storage and set overlay status to rebase_conflict
		if err := s.store.ReplaceOverlayPendingConflicts(ctx, overlay.ID, result.Conflicts); err != nil {
			return nil, fmt.Errorf("store rebase conflicts: %w", err)
		}
		if err := s.store.UpdateOverlayStatus(ctx, overlay.ID, "rebase_conflict"); err != nil {
			return nil, fmt.Errorf("update overlay status to rebase_conflict: %w", err)
		}

		return &RebaseResult{
			OverlayID:        overlay.ID,
			OldBaseReleaseID: overlay.BaseReleaseID,
			NewBaseReleaseID: targetReleaseID,
			HasConflicts:     true,
			Conflicts:        result.Conflicts,
			Status:           "rebase_conflict",
		}, nil
	}

	// No conflicts: merge cleanly
	unflattened := domain.UnflattenMap(result.MergedOverrides)
	mergedJSON, err := json.Marshal(unflattened)
	if err != nil {
		return nil, fmt.Errorf("marshal merged overrides: %w", err)
	}

	if err := s.store.UpdateOverlayBaseRelease(ctx, overlay.ID, targetReleaseID, mergedJSON, "active"); err != nil {
		return nil, fmt.Errorf("update overlay base release: %w", err)
	}
	if err := s.store.ReplaceOverlayPendingConflicts(ctx, overlay.ID, nil); err != nil {
		return nil, fmt.Errorf("clear resolved conflicts: %w", err)
	}

	return &RebaseResult{
		OverlayID:        overlay.ID,
		OldBaseReleaseID: overlay.BaseReleaseID,
		NewBaseReleaseID: targetReleaseID,
		HasConflicts:     false,
		Status:           "active",
	}, nil
}

// ResolveConflictParams contains data to resolve a single rebase collision.
type ResolveConflictParams struct {
	OverlayID   uuid.UUID
	ConflictID  uuid.UUID
	OrgID       uuid.UUID
	Action      domain.ResolutionAction
	CustomValue any
	ResolvedBy  *uuid.UUID
}

// ResolveConflict applies an explicit resolution action to a recorded collision.
func (s *OverlayService) ResolveConflict(ctx context.Context, params ResolveConflictParams) (*domain.LibraryOverlayConflict, error) {
	conflict, err := s.store.GetOverlayConflictByID(ctx, params.ConflictID)
	if err != nil {
		return nil, err
	}
	if conflict.OverlayID != params.OverlayID || conflict.OrganizationID != params.OrgID {
		return nil, ErrUnauthorizedOverlayAccess
	}

	// Apply pure resolution calculation
	var actorID uuid.UUID
	if params.ResolvedBy != nil {
		actorID = *params.ResolvedBy
	}
	if err := domain.ApplyConflictResolution(conflict, params.Action, params.CustomValue, actorID); err != nil {
		return nil, fmt.Errorf("apply resolution: %w", err)
	}

	// Store resolution in database
	if err := s.store.ResolveOverlayConflict(ctx, params.ConflictID, params.Action, conflict.ResolvedValue, params.ResolvedBy); err != nil {
		return nil, fmt.Errorf("store resolution: %w", err)
	}

	// Check if all conflicts for this overlay have been resolved
	pendingCount, err := s.store.CountPendingConflicts(ctx, params.OverlayID)
	if err != nil {
		return nil, fmt.Errorf("count pending conflicts: %w", err)
	}

	if pendingCount == 0 {
		// All conflicts resolved! Consolidate merged overrides and reactivate overlay.
		overlay, err := s.store.GetOverlayByID(ctx, params.OverlayID)
		if err != nil {
			return nil, fmt.Errorf("get overlay: %w", err)
		}

		allResolved, err := s.store.ListOverlayConflicts(ctx, params.OverlayID, "resolved")
		if err != nil {
			return nil, fmt.Errorf("list resolved conflicts: %w", err)
		}

		flattened := make(map[string]any)
		if len(overlay.Overrides) > 0 && string(overlay.Overrides) != "{}" {
			var rawMap map[string]any
			if err := json.Unmarshal(overlay.Overrides, &rawMap); err == nil {
				domain.FlattenMap("", rawMap, flattened)
			}
		}

		for _, rc := range allResolved {
			if rc.ResolutionAction != nil && *rc.ResolutionAction == domain.ResolutionAdoptUpstream {
				delete(flattened, rc.Path)
			} else if rc.ResolvedValue != nil {
				flattened[rc.Path] = rc.ResolvedValue
			}
		}

		unflattened := domain.UnflattenMap(flattened)
		mergedJSON, err := json.Marshal(unflattened)
		if err != nil {
			return nil, fmt.Errorf("marshal consolidated overrides: %w", err)
		}

		if err := s.store.UpdateOverlayBaseRelease(ctx, overlay.ID, conflict.NewBaseReleaseID, mergedJSON, "active"); err != nil {
			return nil, fmt.Errorf("activate resolved overlay: %w", err)
		}
	}

	return conflict, nil
}

// extractManifestValues parses definition blobs for resources in a release manifest to extract key-value parameters.
func (s *OverlayService) extractManifestValues(ctx context.Context, manifest *domain.LibraryManifest) map[string]any {
	values := make(map[string]any)
	if manifest == nil {
		return values
	}

	for _, ref := range manifest.Resources {
		if ref.DefinitionHash == "" {
			continue
		}
		blob, err := s.store.GetResourceBlob(ctx, ref.DefinitionHash)
		if err != nil || blob == nil || len(blob.Content) == 0 {
			continue
		}

		var parsed map[string]any
		if err := json.Unmarshal(blob.Content, &parsed); err != nil {
			continue
		}

		// If blob contains nested parameters/rules, flatten them
		if params, ok := parsed["parameters"].(map[string]any); ok {
			domain.FlattenMap("parameters", params, values)
		}
		if rules, ok := parsed["rules"].(map[string]any); ok {
			domain.FlattenMap("rules", rules, values)
		}
		if joint, ok := parsed["joint"].(map[string]any); ok {
			domain.FlattenMap("joint", joint, values)
		}
		if hardware, ok := parsed["hardware"].(map[string]any); ok {
			domain.FlattenMap("hardware", hardware, values)
		}
		// Also flatten root keys if not structured in namespaces
		for k, v := range parsed {
			if k != "parameters" && k != "rules" && k != "joint" && k != "hardware" && k != "id" && k != "code" {
				if childMap, ok := v.(map[string]any); ok {
					domain.FlattenMap(k, childMap, values)
				} else {
					values[k] = v
				}
			}
		}
	}

	return values
}
