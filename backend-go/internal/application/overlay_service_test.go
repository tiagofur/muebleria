package application_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/tiagofur/muebles-backend/internal/application"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// ─── Mock OverlayStore for Unit Testing ──────────────────────────────────────

type mockOverlayStore struct {
	overlays       map[uuid.UUID]*domain.LibraryOverlay
	conflicts      map[uuid.UUID]*domain.LibraryOverlayConflict
	releases       map[uuid.UUID]*domain.LibraryRelease
	manifests      map[uuid.UUID]*domain.LibraryManifest
	blobs          map[string]*domain.ResourceBlob
}

func newMockOverlayStore() *mockOverlayStore {
	return &mockOverlayStore{
		overlays:  make(map[uuid.UUID]*domain.LibraryOverlay),
		conflicts: make(map[uuid.UUID]*domain.LibraryOverlayConflict),
		releases:  make(map[uuid.UUID]*domain.LibraryRelease),
		manifests: make(map[uuid.UUID]*domain.LibraryManifest),
		blobs:     make(map[string]*domain.ResourceBlob),
	}
}

func (m *mockOverlayStore) GetOverlayByID(_ context.Context, id uuid.UUID) (*domain.LibraryOverlay, error) {
	o, ok := m.overlays[id]
	if !ok {
		return nil, storage.ErrOverlayNotFound
	}
	return o, nil
}

func (m *mockOverlayStore) GetActiveOverlayByLibrary(_ context.Context, orgID, libID uuid.UUID) (*domain.LibraryOverlay, error) {
	for _, o := range m.overlays {
		if o.OrganizationID == orgID && o.LibraryID == libID && o.Status == "active" {
			return o, nil
		}
	}
	return nil, storage.ErrOverlayNotFound
}

func (m *mockOverlayStore) CreateOverlay(_ context.Context, overlay *domain.LibraryOverlay) (*domain.LibraryOverlay, error) {
	m.overlays[overlay.ID] = overlay
	return overlay, nil
}

func (m *mockOverlayStore) UpdateOverlayOverrides(_ context.Context, id uuid.UUID, expectedVersion int64, overrides json.RawMessage, customResourceIDs []uuid.UUID) error {
	o, ok := m.overlays[id]
	if !ok {
		return storage.ErrOverlayNotFound
	}
	if o.Version != expectedVersion {
		return storage.ErrVersionConflict
	}
	o.Version++
	o.Overrides = overrides
	o.CustomResourceIDs = customResourceIDs
	return nil
}

func (m *mockOverlayStore) UpdateOverlayStatus(_ context.Context, id uuid.UUID, status string) error {
	o, ok := m.overlays[id]
	if !ok {
		return storage.ErrOverlayNotFound
	}
	o.Status = status
	return nil
}

func (m *mockOverlayStore) UpdateOverlayBaseRelease(_ context.Context, id uuid.UUID, newBaseReleaseID uuid.UUID, overrides json.RawMessage, status string) error {
	o, ok := m.overlays[id]
	if !ok {
		return storage.ErrOverlayNotFound
	}
	o.BaseReleaseID = newBaseReleaseID
	o.Overrides = overrides
	o.Status = status
	return nil
}

func (m *mockOverlayStore) ReplaceOverlayPendingConflicts(_ context.Context, overlayID uuid.UUID, conflicts []domain.LibraryOverlayConflict) error {
	for id, c := range m.conflicts {
		if c.OverlayID == overlayID && c.Status == "pending" {
			delete(m.conflicts, id)
		}
	}
	for _, c := range conflicts {
		copyC := c
		m.conflicts[c.ID] = &copyC
	}
	return nil
}

func (m *mockOverlayStore) ListOverlayConflicts(_ context.Context, overlayID uuid.UUID, statusFilter string) ([]domain.LibraryOverlayConflict, error) {
	var list []domain.LibraryOverlayConflict
	for _, c := range m.conflicts {
		if c.OverlayID == overlayID && (statusFilter == "" || c.Status == statusFilter) {
			list = append(list, *c)
		}
	}
	return list, nil
}

func (m *mockOverlayStore) GetOverlayConflictByID(_ context.Context, conflictID uuid.UUID) (*domain.LibraryOverlayConflict, error) {
	c, ok := m.conflicts[conflictID]
	if !ok {
		return nil, storage.ErrOverlayConflictNotFound
	}
	copyC := *c
	return &copyC, nil
}

func (m *mockOverlayStore) ResolveOverlayConflict(_ context.Context, conflictID uuid.UUID, action domain.ResolutionAction, resolvedValue any, resolvedBy *uuid.UUID) error {
	c, ok := m.conflicts[conflictID]
	if !ok {
		return storage.ErrOverlayConflictNotFound
	}
	if c.Status == "resolved" {
		return storage.ErrOverlayConflictAlreadyResolved
	}
	c.Status = "resolved"
	c.ResolutionAction = &action
	c.ResolvedValue = resolvedValue
	c.ResolvedBy = resolvedBy
	now := time.Now()
	c.ResolvedAt = &now
	return nil
}

func (m *mockOverlayStore) CountPendingConflicts(_ context.Context, overlayID uuid.UUID) (int, error) {
	count := 0
	for _, c := range m.conflicts {
		if c.OverlayID == overlayID && c.Status == "pending" {
			count++
		}
	}
	return count, nil
}

func (m *mockOverlayStore) GetReleaseByID(_ context.Context, id uuid.UUID) (*domain.LibraryRelease, error) {
	r, ok := m.releases[id]
	if !ok {
		return nil, storage.ErrLibraryReleaseNotFound
	}
	return r, nil
}

func (m *mockOverlayStore) GetReleaseManifest(_ context.Context, releaseID uuid.UUID) (*domain.LibraryManifest, []byte, error) {
	man, ok := m.manifests[releaseID]
	if !ok {
		return nil, nil, storage.ErrManifestNotFound
	}
	return man, []byte("{}"), nil
}

func (m *mockOverlayStore) GetResourceBlob(_ context.Context, sha256 string) (*domain.ResourceBlob, error) {
	b, ok := m.blobs[sha256]
	if !ok {
		return nil, storage.ErrResourceBlobNotFound
	}
	return b, nil
}

// ─── Tests ───────────────────────────────────────────────────────────────────

func TestOverlayService_CreateOverlay_Validation(t *testing.T) {
	ctx := context.Background()
	store := newMockOverlayStore()
	svc := application.NewOverlayService(store)

	orgID := uuid.New()
	libID := uuid.New()
	draftRelID := uuid.New()
	pubRelID := uuid.New()

	// Seed releases
	store.releases[draftRelID] = &domain.LibraryRelease{
		ID:     draftRelID,
		Status: domain.ReleaseStatusDraft,
	}
	store.releases[pubRelID] = &domain.LibraryRelease{
		ID:     pubRelID,
		Status: domain.ReleaseStatusPublished,
	}

	// 1. Base release in draft status must be rejected
	_, err := svc.CreateOverlay(ctx, application.CreateOverlayParams{
		OrganizationID: orgID,
		LibraryID:      libID,
		BaseReleaseID:  draftRelID,
	})
	if !errors.Is(err, application.ErrBaseReleaseNotPublished) {
		t.Fatalf("expected ErrBaseReleaseNotPublished, got %v", err)
	}

	// 2. Unauthorized structural override path must be rejected
	_, err = svc.CreateOverlay(ctx, application.CreateOverlayParams{
		OrganizationID: orgID,
		LibraryID:      libID,
		BaseReleaseID:  pubRelID,
		Overrides:      json.RawMessage(`{"libraryId": "hacked-id"}`),
	})
	if !errors.Is(err, application.ErrInvalidOverridePath) {
		t.Fatalf("expected ErrInvalidOverridePath, got %v", err)
	}

	// 3. Valid parameters path succeeds
	created, err := svc.CreateOverlay(ctx, application.CreateOverlayParams{
		OrganizationID: orgID,
		LibraryID:      libID,
		BaseReleaseID:  pubRelID,
		Overrides:      json.RawMessage(`{"parameters.toeKickHeight": 120}`),
	})
	if err != nil {
		t.Fatalf("CreateOverlay failed: %v", err)
	}
	if created.Status != "active" {
		t.Fatalf("expected status 'active', got %s", created.Status)
	}
}

func TestOverlayService_UpdateOverrides_AuthorizationAndPathCheck(t *testing.T) {
	ctx := context.Background()
	store := newMockOverlayStore()
	svc := application.NewOverlayService(store)

	orgA := uuid.New()
	orgB := uuid.New()
	overlayID := uuid.New()

	store.overlays[overlayID] = &domain.LibraryOverlay{
		ID:             overlayID,
		OrganizationID: orgA,
		Status:         "active",
		Overrides:      json.RawMessage(`{"parameters.toeKickHeight": 120}`),
		Version:        1,
	}

	// 1. Org B attempting to update Org A's overlay -> ErrUnauthorizedOverlayAccess
	err := svc.UpdateOverrides(ctx, overlayID, orgB, 1, json.RawMessage(`{"parameters.toeKickHeight": 140}`), nil)
	if !errors.Is(err, application.ErrUnauthorizedOverlayAccess) {
		t.Fatalf("expected ErrUnauthorizedOverlayAccess, got %v", err)
	}

	// 2. Org A attempting invalid namespace -> ErrInvalidOverridePath
	err = svc.UpdateOverrides(ctx, overlayID, orgA, 1, json.RawMessage(`{"arbitraryRoot": 42}`), nil)
	if !errors.Is(err, application.ErrInvalidOverridePath) {
		t.Fatalf("expected ErrInvalidOverridePath, got %v", err)
	}

	// 3. Org A updating valid path -> success
	err = svc.UpdateOverrides(ctx, overlayID, orgA, 1, json.RawMessage(`{"parameters.toeKickHeight": 150}`), nil)
	if err != nil {
		t.Fatalf("UpdateOverrides failed: %v", err)
	}

	// 4. #875 slice 4: a stale expected version conflicts — the second
	// editor's save can never silently overwrite the first one's.
	err = svc.UpdateOverrides(ctx, overlayID, orgA, 1, json.RawMessage(`{"parameters.toeKickHeight": 999}`), nil)
	if !errors.Is(err, storage.ErrVersionConflict) {
		t.Fatalf("expected ErrVersionConflict for a stale version, got %v", err)
	}
	err = svc.UpdateOverrides(ctx, overlayID, orgA, 2, json.RawMessage(`{"parameters.toeKickHeight": 999}`), nil)
	if err != nil {
		t.Fatalf("re-read + retry must land: %v", err)
	}
}

func TestOverlayService_ExecuteRebase_DisjointCleanMerge(t *testing.T) {
	ctx := context.Background()
	store := newMockOverlayStore()
	svc := application.NewOverlayService(store)

	orgID := uuid.New()
	libID := uuid.New()
	oldRelID := uuid.New()
	newRelID := uuid.New()
	overlayID := uuid.New()

	// Seed OldBase and NewBase releases
	store.releases[oldRelID] = &domain.LibraryRelease{ID: oldRelID, Status: domain.ReleaseStatusPublished}
	store.releases[newRelID] = &domain.LibraryRelease{ID: newRelID, Status: domain.ReleaseStatusPublished}

	// Manifest definitions
	oldBlobHash := "sha256:oldhash1"
	newBlobHash := "sha256:newhash1"

	store.blobs[oldBlobHash] = &domain.ResourceBlob{
		SHA256:  oldBlobHash,
		Content: json.RawMessage(`{"parameters": {"panelThickness": 18, "toeKickHeight": 100}}`),
	}
	store.blobs[newBlobHash] = &domain.ResourceBlob{
		SHA256:  newBlobHash,
		Content: json.RawMessage(`{"parameters": {"panelThickness": 15, "toeKickHeight": 100}}`), // Upstream changed panelThickness
	}

	store.manifests[oldRelID] = &domain.LibraryManifest{
		Resources: []domain.ManifestResourceRef{{Kind: "module_defaults", DefinitionHash: oldBlobHash}},
	}
	store.manifests[newRelID] = &domain.LibraryManifest{
		Resources: []domain.ManifestResourceRef{{Kind: "module_defaults", DefinitionHash: newBlobHash}},
	}

	// Customer only customized toeKickHeight
	store.overlays[overlayID] = &domain.LibraryOverlay{
		ID:             overlayID,
		OrganizationID: orgID,
		LibraryID:      libID,
		BaseReleaseID:  oldRelID,
		Status:         "active",
		Overrides:      json.RawMessage(`{"parameters.toeKickHeight": 120}`),
	}

	res, err := svc.ExecuteRebase(ctx, overlayID, orgID, newRelID)
	if err != nil {
		t.Fatalf("ExecuteRebase failed: %v", err)
	}

	if res.HasConflicts {
		t.Fatalf("expected clean merge with 0 conflicts, got %d", len(res.Conflicts))
	}
	if res.Status != "active" {
		t.Fatalf("expected status 'active', got %s", res.Status)
	}

	// Verify overlay base release was updated
	updatedOverlay := store.overlays[overlayID]
	if updatedOverlay.BaseReleaseID != newRelID {
		t.Fatalf("expected updated base release %s, got %s", newRelID, updatedOverlay.BaseReleaseID)
	}
}

func TestOverlayService_ExecuteRebase_CollisionDetectionAndResolutionWorkflow(t *testing.T) {
	ctx := context.Background()
	store := newMockOverlayStore()
	svc := application.NewOverlayService(store)

	orgID := uuid.New()
	libID := uuid.New()
	oldRelID := uuid.New()
	newRelID := uuid.New()
	overlayID := uuid.New()

	store.releases[oldRelID] = &domain.LibraryRelease{ID: oldRelID, Status: domain.ReleaseStatusPublished}
	store.releases[newRelID] = &domain.LibraryRelease{ID: newRelID, Status: domain.ReleaseStatusPublished}

	oldBlobHash := "sha256:oldhash2"
	newBlobHash := "sha256:newhash2"

	store.blobs[oldBlobHash] = &domain.ResourceBlob{
		SHA256:  oldBlobHash,
		Content: json.RawMessage(`{"parameters": {"panelThickness": 18}}`),
	}
	store.blobs[newBlobHash] = &domain.ResourceBlob{
		SHA256:  newBlobHash,
		Content: json.RawMessage(`{"parameters": {"panelThickness": 15}}`), // Upstream changed to 15
	}

	store.manifests[oldRelID] = &domain.LibraryManifest{
		Resources: []domain.ManifestResourceRef{{Kind: "module_defaults", DefinitionHash: oldBlobHash}},
	}
	store.manifests[newRelID] = &domain.LibraryManifest{
		Resources: []domain.ManifestResourceRef{{Kind: "module_defaults", DefinitionHash: newBlobHash}},
	}

	// Customer also customized panelThickness to 19 (COLLISION!)
	store.overlays[overlayID] = &domain.LibraryOverlay{
		ID:             overlayID,
		OrganizationID: orgID,
		LibraryID:      libID,
		BaseReleaseID:  oldRelID,
		Status:         "active",
		Overrides:      json.RawMessage(`{"parameters.panelThickness": 19}`),
	}

	// 1. Run rebase: must detect conflict and block activation
	res, err := svc.ExecuteRebase(ctx, overlayID, orgID, newRelID)
	if err != nil {
		t.Fatalf("ExecuteRebase failed: %v", err)
	}

	if !res.HasConflicts {
		t.Fatal("expected collision on parameters.panelThickness, got 0 conflicts")
	}
	if len(res.Conflicts) != 1 {
		t.Fatalf("expected 1 conflict, got %d", len(res.Conflicts))
	}
	if res.Status != "rebase_conflict" {
		t.Fatalf("expected status 'rebase_conflict', got %s", res.Status)
	}

	conflict := res.Conflicts[0]
	if conflict.Path != "parameters.panelThickness" {
		t.Fatalf("expected conflict on parameters.panelThickness, got %s", conflict.Path)
	}

	// 2. Resolve conflict choosing keep_custom
	user := uuid.New()
	resolved, err := svc.ResolveConflict(ctx, application.ResolveConflictParams{
		OverlayID:   overlayID,
		ConflictID:  conflict.ID,
		OrgID:       orgID,
		Action:      domain.ResolutionKeepCustom,
		ResolvedBy:  &user,
	})
	if err != nil {
		t.Fatalf("ResolveConflict failed: %v", err)
	}
	if resolved.Status != "resolved" {
		t.Fatalf("expected status 'resolved', got %s", resolved.Status)
	}

	// 3. Since all conflicts are resolved, overlay must be automatically reactivated on new base
	updatedOverlay := store.overlays[overlayID]
	if updatedOverlay.Status != "active" {
		t.Fatalf("expected overlay reactivated to 'active', got %s", updatedOverlay.Status)
	}
	if updatedOverlay.BaseReleaseID != newRelID {
		t.Fatalf("expected base release updated to %s, got %s", newRelID, updatedOverlay.BaseReleaseID)
	}
}

func TestOverlayService_ResolveConflict_AdoptUpstream(t *testing.T) {
	ctx := context.Background()
	store := newMockOverlayStore()
	svc := application.NewOverlayService(store)

	orgID := uuid.New()
	oldRelID := uuid.New()
	newRelID := uuid.New()
	overlayID := uuid.New()

	store.releases[oldRelID] = &domain.LibraryRelease{ID: oldRelID, Status: domain.ReleaseStatusPublished}
	store.releases[newRelID] = &domain.LibraryRelease{ID: newRelID, Status: domain.ReleaseStatusPublished}

	oldBlobHash := "sha256:oldhash3"
	newBlobHash := "sha256:newhash3"

	store.blobs[oldBlobHash] = &domain.ResourceBlob{
		SHA256:  oldBlobHash,
		Content: json.RawMessage(`{"parameters": {"panelThickness": 18, "toeKick": 100}}`),
	}
	store.blobs[newBlobHash] = &domain.ResourceBlob{
		SHA256:  newBlobHash,
		Content: json.RawMessage(`{"parameters": {"panelThickness": 15, "toeKick": 100}}`),
	}

	store.manifests[oldRelID] = &domain.LibraryManifest{
		Resources: []domain.ManifestResourceRef{{Kind: "module_defaults", DefinitionHash: oldBlobHash}},
	}
	store.manifests[newRelID] = &domain.LibraryManifest{
		Resources: []domain.ManifestResourceRef{{Kind: "module_defaults", DefinitionHash: newBlobHash}},
	}

	store.overlays[overlayID] = &domain.LibraryOverlay{
		ID:             overlayID,
		OrganizationID: orgID,
		BaseReleaseID:  oldRelID,
		Status:         "active",
		Overrides:      json.RawMessage(`{"parameters.panelThickness": 19, "parameters.toeKick": 120}`),
	}

	res, err := svc.ExecuteRebase(ctx, overlayID, orgID, newRelID)
	if err != nil {
		t.Fatalf("ExecuteRebase failed: %v", err)
	}
	if !res.HasConflicts {
		t.Fatal("expected collision")
	}

	// Resolve with adopt_upstream: panelThickness override should be dropped, leaving toeKick = 120
	user := uuid.New()
	_, err = svc.ResolveConflict(ctx, application.ResolveConflictParams{
		OverlayID:  overlayID,
		ConflictID: res.Conflicts[0].ID,
		OrgID:      orgID,
		Action:     domain.ResolutionAdoptUpstream,
		ResolvedBy: &user,
	})
	if err != nil {
		t.Fatalf("ResolveConflict failed: %v", err)
	}

	updatedOverlay := store.overlays[overlayID]
	if updatedOverlay.Status != "active" {
		t.Fatalf("expected status 'active', got %s", updatedOverlay.Status)
	}

	var overrides map[string]any
	if err := json.Unmarshal(updatedOverlay.Overrides, &overrides); err != nil {
		t.Fatalf("unmarshal overrides: %v", err)
	}
	flattened := make(map[string]any)
	domain.FlattenMap("", overrides, flattened)

	if _, exists := flattened["parameters.panelThickness"]; exists {
		t.Fatalf("expected parameters.panelThickness removed after adopt_upstream, but still present: %v", flattened)
	}
	if val, ok := flattened["parameters.toeKick"]; !ok || val != float64(120) {
		t.Fatalf("expected parameters.toeKick = 120 preserved, got %v", val)
	}
}

func TestOverlayService_ExecuteRebase_TargetReleaseMustBePublished(t *testing.T) {
	ctx := context.Background()
	store := newMockOverlayStore()
	svc := application.NewOverlayService(store)

	orgID := uuid.New()
	oldRelID := uuid.New()
	targetDraftID := uuid.New()
	overlayID := uuid.New()

	store.releases[oldRelID] = &domain.LibraryRelease{ID: oldRelID, Status: domain.ReleaseStatusPublished}
	store.releases[targetDraftID] = &domain.LibraryRelease{ID: targetDraftID, Status: domain.ReleaseStatusDraft}

	store.overlays[overlayID] = &domain.LibraryOverlay{
		ID:             overlayID,
		OrganizationID: orgID,
		BaseReleaseID:  oldRelID,
		Status:         "active",
	}

	_, err := svc.ExecuteRebase(ctx, overlayID, orgID, targetDraftID)
	if !errors.Is(err, application.ErrBaseReleaseNotPublished) {
		t.Fatalf("expected ErrBaseReleaseNotPublished, got %v", err)
	}
}

