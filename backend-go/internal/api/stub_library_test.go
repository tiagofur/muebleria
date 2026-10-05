package api

// Contrato: stub del stubStore espejo de store_library (store_library.go). Los
// métodos se movieron tal cual desde handlers_test.go (Fase B #1017);
// las firmas son las de la sub-interface en store_library.go
import (
	"context"
	"encoding/json"
	"github.com/google/uuid"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
	"github.com/tiagofur/muebles-backend/internal/storage"
	"time"
)

// Manufacturing library stubs (#772)
func (s *stubStore) GetStandardLibrary(_ context.Context) (*domain.ManufacturingLibrary, error) {
	s.stubNotUsed("GetStandardLibrary")
	return nil, nil
}

func (s *stubStore) ReleaseServerResolveInputs(ctx context.Context, orgID string) (*engine.ReleaseServerInputs, error) {
	return storage.ReleaseServerInputsFromStore(ctx, s, orgID)
}

func (s *stubStore) GetProductionReleaseManufacturingSnapshot(ctx context.Context, projectID, releaseID string) (*storage.ReleaseManufacturingSnapshot, error) {
	return nil, storage.ErrReleaseSnapshotUnavailable
}

func (s *stubStore) HardwareProfilesForRelease(ctx context.Context, releaseID uuid.UUID) ([]domain.HardwareProfile, error) {
	_, manifestBytes, err := s.GetReleaseManifest(ctx, releaseID)
	if err != nil {
		return nil, err
	}
	var manifest domain.LibraryManifest
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
		return nil, err
	}
	profiles := make([]domain.HardwareProfile, 0)
	for _, ref := range manifest.Resources {
		if ref.Kind != domain.HardwareProfileResourceKind {
			continue
		}
		blob, err := s.GetResourceBlob(ctx, ref.DefinitionHash)
		if err != nil {
			return nil, err
		}
		var profile domain.HardwareProfile
		if err := json.Unmarshal(blob.Content, &profile); err != nil {
			return nil, err
		}
		profiles = append(profiles, profile)
	}
	return profiles, nil
}

func (s *stubStore) GetCurrentPublishedRelease(_ context.Context, _ uuid.UUID) (*domain.LibraryRelease, error) {
	if s.currentPublishedReleaseErr != nil {
		return nil, s.currentPublishedReleaseErr
	}
	if s.currentPublishedRelease != nil {
		return s.currentPublishedRelease, nil
	}
	return nil, storage.ErrLibraryReleaseNotFound
}

func (s *stubStore) GetPublishedReleases(_ context.Context, _ uuid.UUID) ([]*domain.LibraryRelease, error) {
	if s.publishedReleasesErr != nil {
		return nil, s.publishedReleasesErr
	}
	return s.publishedReleases, nil
}

func (s *stubStore) GetDraftReleases(_ context.Context, _ uuid.UUID) ([]*domain.LibraryRelease, error) {
	if s.draftReleasesErr != nil {
		return nil, s.draftReleasesErr
	}
	return s.draftReleases, nil
}

func (s *stubStore) GetReleaseByID(_ context.Context, id uuid.UUID) (*domain.LibraryRelease, error) {
	if s.getReleaseByIDErr != nil {
		return nil, s.getReleaseByIDErr
	}
	if s.releaseByID != nil {
		if rel, ok := s.releaseByID[id]; ok {
			return rel, nil
		}
	}
	return nil, storage.ErrLibraryReleaseNotFound
}

func (s *stubStore) GetReleaseManifest(_ context.Context, releaseID uuid.UUID) (*domain.LibraryManifest, []byte, error) {
	if s.releaseManifestErr != nil {
		return nil, nil, s.releaseManifestErr
	}
	if s.releaseManifestsByID != nil {
		if m, ok := s.releaseManifestsByID[releaseID]; ok {
			raw := s.releaseManifestRawByID[releaseID]
			if raw == nil {
				raw, _ = domain.CanonicalizeJSON(m)
			}
			return m, raw, nil
		}
	}
	return nil, nil, storage.ErrManifestNotFound
}

func (s *stubStore) GetResourceBlob(_ context.Context, sha256 string) (*domain.ResourceBlob, error) {
	if s.resourceBlobErr != nil {
		return nil, s.resourceBlobErr
	}
	if s.resourceBlobsByHash != nil {
		if b, ok := s.resourceBlobsByHash[sha256]; ok {
			return b, nil
		}
	}
	return nil, storage.ErrResourceBlobNotFound
}

func (s *stubStore) GetResourceBlobWithEntitlementCheck(_ context.Context, releaseID, resourceID uuid.UUID, hash string) (*domain.ResourceBlob, domain.PackageKind, error) {
	if s.resourceBlobEntitlementCheckFunc != nil {
		return s.resourceBlobEntitlementCheckFunc(releaseID, resourceID, hash)
	}
	if s.resourceBlobsByHash != nil {
		if b, ok := s.resourceBlobsByHash[hash]; ok {
			return b, domain.PackageKindFree, nil
		}
	}
	return nil, "", storage.ErrResourceNotInRelease
}

// Manufacturing library overlay stubs (#775 / LIB-4)

// Manufacturing library overlay stubs (#775 / LIB-4)
func (s *stubStore) CreateOverlay(_ context.Context, overlay *domain.LibraryOverlay) (*domain.LibraryOverlay, error) {
	if s.createOverlayErr != nil {
		return nil, s.createOverlayErr
	}
	if s.overlaysByID == nil {
		s.overlaysByID = make(map[uuid.UUID]*domain.LibraryOverlay)
	}
	s.overlaysByID[overlay.ID] = overlay
	return overlay, nil
}

func (s *stubStore) GetOverlayByID(_ context.Context, id uuid.UUID) (*domain.LibraryOverlay, error) {
	if s.getOverlayByIDErr != nil {
		return nil, s.getOverlayByIDErr
	}
	if s.overlaysByID != nil {
		if o, ok := s.overlaysByID[id]; ok {
			return o, nil
		}
	}
	return nil, storage.ErrOverlayNotFound
}

func (s *stubStore) GetActiveOverlayByLibrary(_ context.Context, orgID, libID uuid.UUID) (*domain.LibraryOverlay, error) {
	if s.getActiveOverlayErr != nil {
		return nil, s.getActiveOverlayErr
	}
	if s.overlaysByID != nil {
		for _, o := range s.overlaysByID {
			if o.OrganizationID == orgID && o.LibraryID == libID && o.Status == "active" {
				return o, nil
			}
		}
	}
	return nil, storage.ErrOverlayNotFound
}

func (s *stubStore) SavePolicyDraft(_ context.Context, id uuid.UUID, expectedVersion int64, draft json.RawMessage) error {
	if s.overlaysByID != nil {
		if o, ok := s.overlaysByID[id]; ok {
			if o.Version != expectedVersion {
				return storage.ErrVersionConflict
			}
			o.Version++
			o.PolicyDraft = draft
			return nil
		}
	}
	return storage.ErrOverlayNotFound
}

func (s *stubStore) ActivatePolicyDraft(_ context.Context, id uuid.UUID, expectedVersion int64, mergedOverrides json.RawMessage) error {
	if s.overlaysByID != nil {
		if o, ok := s.overlaysByID[id]; ok {
			if o.Version != expectedVersion {
				return storage.ErrVersionConflict
			}
			o.Version++
			o.Overrides = mergedOverrides
			o.PolicyDraft = nil
			return nil
		}
	}
	return storage.ErrOverlayNotFound
}

func (s *stubStore) UpdateOverlayOverrides(_ context.Context, id uuid.UUID, expectedVersion int64, overrides json.RawMessage, customResourceIDs []uuid.UUID) error {
	if s.updateOverlayOverridesErr != nil {
		return s.updateOverlayOverridesErr
	}
	if s.overlaysByID != nil {
		if o, ok := s.overlaysByID[id]; ok {
			o.Overrides = overrides
			o.CustomResourceIDs = customResourceIDs
			return nil
		}
	}
	return storage.ErrOverlayNotFound
}

func (s *stubStore) UpdateOverlayStatus(_ context.Context, id uuid.UUID, status string) error {
	if s.updateOverlayStatusErr != nil {
		return s.updateOverlayStatusErr
	}
	if s.overlaysByID != nil {
		if o, ok := s.overlaysByID[id]; ok {
			o.Status = status
			return nil
		}
	}
	return storage.ErrOverlayNotFound
}

func (s *stubStore) UpdateOverlayBaseRelease(_ context.Context, id uuid.UUID, newBaseReleaseID uuid.UUID, overrides json.RawMessage, status string) error {
	if s.updateOverlayBaseReleaseErr != nil {
		return s.updateOverlayBaseReleaseErr
	}
	if s.overlaysByID != nil {
		if o, ok := s.overlaysByID[id]; ok {
			o.BaseReleaseID = newBaseReleaseID
			o.Overrides = overrides
			o.Status = status
			return nil
		}
	}
	return storage.ErrOverlayNotFound
}

func (s *stubStore) ReplaceOverlayPendingConflicts(_ context.Context, overlayID uuid.UUID, conflicts []domain.LibraryOverlayConflict) error {
	if s.replaceOverlayPendingConflictsErr != nil {
		return s.replaceOverlayPendingConflictsErr
	}
	if s.overlayConflictsByID == nil {
		s.overlayConflictsByID = make(map[uuid.UUID]*domain.LibraryOverlayConflict)
	}
	for id, c := range s.overlayConflictsByID {
		if c.OverlayID == overlayID && c.Status == "pending" {
			delete(s.overlayConflictsByID, id)
		}
	}
	for _, c := range conflicts {
		copyC := c
		s.overlayConflictsByID[c.ID] = &copyC
	}
	return nil
}

func (s *stubStore) ListOverlayConflicts(_ context.Context, overlayID uuid.UUID, statusFilter string) ([]domain.LibraryOverlayConflict, error) {
	if s.listOverlayConflictsErr != nil {
		return nil, s.listOverlayConflictsErr
	}
	var list []domain.LibraryOverlayConflict
	if s.overlayConflictsByID != nil {
		for _, c := range s.overlayConflictsByID {
			if c.OverlayID == overlayID && (statusFilter == "" || c.Status == statusFilter) {
				list = append(list, *c)
			}
		}
	}
	return list, nil
}

func (s *stubStore) GetOverlayConflictByID(_ context.Context, conflictID uuid.UUID) (*domain.LibraryOverlayConflict, error) {
	if s.getOverlayConflictByIDErr != nil {
		return nil, s.getOverlayConflictByIDErr
	}
	if s.overlayConflictsByID != nil {
		if c, ok := s.overlayConflictsByID[conflictID]; ok {
			copyC := *c
			return &copyC, nil
		}
	}
	return nil, storage.ErrOverlayConflictNotFound
}

func (s *stubStore) ResolveOverlayConflict(_ context.Context, conflictID uuid.UUID, action domain.ResolutionAction, resolvedValue any, resolvedBy *uuid.UUID) error {
	if s.resolveOverlayConflictErr != nil {
		return s.resolveOverlayConflictErr
	}
	if s.overlayConflictsByID != nil {
		if c, ok := s.overlayConflictsByID[conflictID]; ok {
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
	}
	return storage.ErrOverlayConflictNotFound
}

func (s *stubStore) CountPendingConflicts(_ context.Context, overlayID uuid.UUID) (int, error) {
	if s.countPendingConflictsErr != nil {
		return 0, s.countPendingConflictsErr
	}
	count := 0
	if s.overlayConflictsByID != nil {
		for _, c := range s.overlayConflictsByID {
			if c.OverlayID == overlayID && c.Status == "pending" {
				count++
			}
		}
	}
	return count, nil
}

// Compras/Almacén picking stubs (Fase 3)
