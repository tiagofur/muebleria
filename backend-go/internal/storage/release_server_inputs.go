package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/google/uuid"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
)

// Release server-resolved inputs (#875 slice 2): the ONE loader both resolve
// surfaces share. The #477 authoring resolve and the #577/#727 release gates
// consume the SAME pinned profiles, synthesized side recipes and factory
// construction policy, so a factory's configuration can never mean one thing
// in the designer and another in fabrication.
//
// Degradation is honest and explicit, mirroring the #916 recipe precedent:
//   - no published Standard release / no manifest -> empty inputs (profiles
//     unavailable; unauthored relationships stay at the
//     TECHNICAL_PROFILE_REQUIRED terminal, releases keep their
//     definition-default patterns);
//   - assignment pointing at a missing/inactive profile or a profile
//     without a recipe body for that face -> that key synthesizes no recipe;
//   - no active overlay -> no factory policy (library defaults govern).
//
// Incidents (DB down) are logged and degrade the same way. The ONE error this
// loader returns is a factory policy the organization EXPLICITLY overrode
// with an unusable pattern: silently ignoring an explicit factory decision
// would resolve or freeze furniture against a construction the workshop
// never chose.
// ReleaseServerInputsReader is the minimal surface the shared inputs
// orchestration needs; satisfied by *storage.PostgresStore and by handler
// test stubs, so tests exercise the SAME loading rules production runs.
type ReleaseServerInputsReader interface {
	GetCurrentPublishedRelease(ctx context.Context, libraryID uuid.UUID) (*domain.LibraryRelease, error)
	HardwareProfilesForRelease(ctx context.Context, releaseID uuid.UUID) ([]domain.HardwareProfile, error)
	ListAllComponentSideAssignments(ctx context.Context) ([]domain.ComponentSideAssignment, error)
	GetActiveOverlayByLibrary(ctx context.Context, organizationID, libraryID uuid.UUID) (*domain.LibraryOverlay, error)
}

// ReleaseServerResolveInputs delegates to the shared orchestration over the
// store itself.
func (s *PostgresStore) ReleaseServerResolveInputs(ctx context.Context, orgID string) (*engine.ReleaseServerInputs, error) {
	return ReleaseServerInputsFromStore(ctx, s, orgID)
}

// ReleaseServerInputsFromStore is the shared inputs orchestration.
func ReleaseServerInputsFromStore(ctx context.Context, store ReleaseServerInputsReader, orgID string) (*engine.ReleaseServerInputs, error) {
	inputs := &engine.ReleaseServerInputs{
		ProfilesByID: map[string]domain.HardwareProfile{},
	}
	release, err := store.GetCurrentPublishedRelease(ctx, uuid.MustParse(domain.GraneteStandardLibraryID))
	if err != nil {
		if !errors.Is(err, ErrLibraryReleaseNotFound) {
			slog.Error("release server inputs: profile pin load failed", "error", err)
		}
		return inputs, nil
	}
	if release == nil {
		return inputs, nil
	}
	inputs.LibraryReleaseID = release.ID.String()

	profiles, err := store.HardwareProfilesForRelease(ctx, release.ID)
	if err != nil {
		slog.Error("release server inputs: pinned profile load failed", "release", release.ID, "error", err)
		return inputs, nil
	}
	for _, profile := range profiles {
		inputs.ProfilesByID[profile.ID] = profile
	}

	assignments, err := store.ListAllComponentSideAssignments(ctx)
	if err != nil {
		slog.Error("release server inputs: side assignment load failed", "error", err)
		return inputs, nil
	}
	inputs.SideRecipes = engine.SynthesizeResolvedSideRecipes(assignments, inputs.ProfilesByID)

	orgUUID, err := uuid.Parse(orgID)
	if err != nil {
		return inputs, nil
	}
	overlay, err := store.GetActiveOverlayByLibrary(ctx, orgUUID, uuid.MustParse(domain.GraneteStandardLibraryID))
	if err != nil {
		if !errors.Is(err, ErrOverlayNotFound) {
			slog.Error("release server inputs: factory policy load failed", "error", err)
		}
		return inputs, nil
	}
	policy, err := engine.ParseFactoryConstructionPolicy(overlay.Overrides)
	if err != nil {
		return nil, err
	}
	inputs.Policy = policy
	return inputs, nil
}

// HardwareProfilesForRelease resolves the pinned hardware profiles of one
// exact release — the authoritative pinned read (#918), moved from the
// application layer so storage's release inputs loader shares the ONE decode:
// kind hardware_profile manifest refs are resolved to their content-addressed
// blobs and decoded with the frozen #912 contract. There is no "latest"
// variant on purpose: callers pass the release id explicitly.
func (s *PostgresStore) HardwareProfilesForRelease(ctx context.Context, releaseID uuid.UUID) ([]domain.HardwareProfile, error) {
	_, manifestBytes, err := s.GetReleaseManifest(ctx, releaseID)
	if err != nil {
		if errors.Is(err, ErrManifestNotFound) {
			return nil, fmt.Errorf("release %s has no manifest; it is not a published release", releaseID)
		}
		return nil, fmt.Errorf("load release manifest: %w", err)
	}
	var manifest domain.LibraryManifest
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
		return nil, fmt.Errorf("decode release manifest: %w", err)
	}
	profiles := make([]domain.HardwareProfile, 0)
	for _, ref := range manifest.Resources {
		if ref.Kind != domain.HardwareProfileResourceKind {
			continue
		}
		blob, err := s.GetResourceBlob(ctx, ref.DefinitionHash)
		if err != nil {
			return nil, fmt.Errorf("load pinned profile blob %s: %w", ref.DefinitionHash, err)
		}
		var profile domain.HardwareProfile
		if err := json.Unmarshal(blob.Content, &profile); err != nil {
			return nil, fmt.Errorf("decode pinned profile %s: %w", ref.ID, err)
		}
		if strings.TrimSpace(profile.Revision) == "" {
			return nil, fmt.Errorf("pinned profile %s has no revision: fail closed", ref.ID)
		}
		profiles = append(profiles, profile)
	}
	return profiles, nil
}
