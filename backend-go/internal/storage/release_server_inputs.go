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
	GetReleaseByID(ctx context.Context, releaseID uuid.UUID) (*domain.LibraryRelease, error)
	HardwareProfilesForRelease(ctx context.Context, releaseID uuid.UUID) ([]domain.HardwareProfile, error)
	ListAllComponentSideAssignments(ctx context.Context) ([]domain.ComponentSideAssignment, error)
	GetActiveOverlayByLibrary(ctx context.Context, organizationID, libraryID uuid.UUID) (*domain.LibraryOverlay, error)
}

// ReleaseServerResolveInputs delegates to the shared orchestration over the
// store itself: inputs pinned to the CURRENT published release (the implicit
// contract pre-#1102, kept for callers that do not declare a pin).
// GetFactoryConstructionPolicy parses the organization's active standard-library
// overlay into the engine policy (#1078): nil = no active overlay and the
// library ladder governs. The ONE load+parse contract behind the live catalog,
// the release freeze and the catalog API read — a broken overlay fails closed
// everywhere the same way.
func (s *PostgresStore) GetFactoryConstructionPolicy(ctx context.Context) (*engine.FactoryConstructionPolicy, error) {
	orgUUID, err := uuid.Parse(OrgFromCtx(ctx))
	if err != nil {
		return nil, fmt.Errorf("factory construction policy org: %w", err)
	}
	overlay, err := s.GetActiveOverlayByLibrary(ctx, orgUUID, uuid.MustParse(domain.GraneteStandardLibraryID))
	if err != nil {
		if errors.Is(err, ErrOverlayNotFound) {
			return nil, nil
		}
		return nil, fmt.Errorf("factory construction policy overlay: %w", err)
	}
	policy, err := engine.ParseFactoryConstructionPolicy(overlay.Overrides)
	if err != nil {
		return nil, fmt.Errorf("factory construction policy: %w", err)
	}
	return policy, nil
}

// GetOpeningCapabilities parses the organization's active standard-library
// overlay into the opening capabilities (#1134): nil = no active overlay and
// the library ladder governs new authoring. Same ONE load+parse contract and
// fail-closed broken-overlay behavior as the construction policy — available
// governs offering, never the validity of existing designs.
func (s *PostgresStore) GetOpeningCapabilities(ctx context.Context) (*domain.OpeningCapabilities, error) {
	orgUUID, err := uuid.Parse(OrgFromCtx(ctx))
	if err != nil {
		return nil, fmt.Errorf("opening capabilities org: %w", err)
	}
	overlay, err := s.GetActiveOverlayByLibrary(ctx, orgUUID, uuid.MustParse(domain.GraneteStandardLibraryID))
	if err != nil {
		if errors.Is(err, ErrOverlayNotFound) {
			return nil, nil
		}
		return nil, fmt.Errorf("opening capabilities overlay: %w", err)
	}
	capabilities, err := engine.ParseOpeningCapabilities(overlay.Overrides)
	if err != nil {
		return nil, fmt.Errorf("opening capabilities: %w", err)
	}
	return capabilities, nil
}

func (s *PostgresStore) ReleaseServerResolveInputs(ctx context.Context, orgID string) (*engine.ReleaseServerInputs, error) {
	return ReleaseServerInputsFromStore(ctx, s, orgID)
}

// ErrReleaseNotPublished is returned when a consumer pins an exact release
// that is not published: the pin means exactly that release, so serving
// anything else (current, draft) would break the #1102 consumer contract.
var ErrReleaseNotPublished = errors.New("library release is not published")

// ReleaseServerInputsForRelease (#1102 Slice D) assembles the shared resolve
// inputs pinned to ONE explicitly declared release — the consumer-side
// contract: the caller declares which release it consumes and the inputs
// come from that release's frozen blobs, never from current or live rows.
func ReleaseServerInputsForRelease(ctx context.Context, store ReleaseServerInputsReader, orgID string, releaseID uuid.UUID) (*engine.ReleaseServerInputs, error) {
	release, err := store.GetReleaseByID(ctx, releaseID)
	if err != nil {
		return nil, fmt.Errorf("load pinned release: %w", err)
	}
	if release.Status != domain.ReleaseStatusPublished {
		return nil, fmt.Errorf("%w: %s is %s", ErrReleaseNotPublished, releaseID, release.Status)
	}
	return assembleReleaseInputs(ctx, store, release, orgID)
}

// ReleaseServerInputsFromStore is the shared inputs orchestration.
func ReleaseServerInputsFromStore(ctx context.Context, store ReleaseServerInputsReader, orgID string) (*engine.ReleaseServerInputs, error) {
	release, err := store.GetCurrentPublishedRelease(ctx, uuid.MustParse(domain.GraneteStandardLibraryID))
	if err != nil {
		if !errors.Is(err, ErrLibraryReleaseNotFound) {
			slog.Error("release server inputs: profile pin load failed", "error", err)
		}
		return &engine.ReleaseServerInputs{
			ProfilesByID: map[string]domain.HardwareProfile{},
		}, nil
	}
	if release == nil {
		return &engine.ReleaseServerInputs{
			ProfilesByID: map[string]domain.HardwareProfile{},
		}, nil
	}
	return assembleReleaseInputs(ctx, store, release, orgID)
}

// assembleReleaseInputs builds the shared inputs from one exact release:
// pinned profiles from its content-addressed blobs, synthesized side recipes
// and the organization's factory construction policy.
func assembleReleaseInputs(ctx context.Context, store ReleaseServerInputsReader, release *domain.LibraryRelease, orgID string) (*engine.ReleaseServerInputs, error) {
	inputs := &engine.ReleaseServerInputs{
		ProfilesByID: map[string]domain.HardwareProfile{},
	}
	inputs.LibraryReleaseID = release.ID.String()

	profiles, err := store.HardwareProfilesForRelease(ctx, release.ID)
	if err != nil {
		// Honest degradation (#875/#916 contract): a release whose pinned
		// blobs cannot load resolves with EMPTY profile inputs (relationships
		// surface TECHNICAL_PROFILE_REQUIRED) — never with live rows instead.
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

// DeriveLiveProfileDemand derives the per-item profile hardware demand matrix
// for one live project's pricing (#986) — the estimate path. Same derivation
// contract as the commercial snapshots: the shared org inputs feed the release
// freeze's derivation; units outside the release-unit contract contribute no
// demand, units inside it fail closed on resolve errors.
func (s *PostgresStore) DeriveLiveProfileDemand(ctx context.Context, project *domain.Project, catalog domain.Catalog) ([][]engine.HardwareProfileDemandLine, error) {
	if project == nil {
		return nil, nil
	}
	inputs, err := s.ReleaseServerResolveInputs(ctx, OrgFromCtx(ctx))
	if err != nil {
		return nil, err
	}
	return engine.DeriveProjectProfileDemand(project.Items, catalog, inputs)
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
