package application

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/google/uuid"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// Demo seed (#955): the first REAL Granete-authored hardware profile with
// an embedded recipe body, published into the seeded Standard draft
// release through the real compiler — so the demo chain (create/assign in
// the UI → resolve → perforations + demand) walks on real manifests and
// content-addressed blobs instead of the browser gate's placeholder hash.
//
// Dimensions are DEMO-GRADE until supplier-verified specs replace them:
// bumping the profile revision with the real numbers is the documented
// path (the #918 pinning semantics keep history stable across the bump).
//
// Idempotency: an existing profile row is never touched, and a published
// release is never recompiled. Runs under the seed organization context
// (OrgFromCtx fallback), exactly like SeedCatalog.

// Stable seed UUIDs (a0000010 range, clear of SeedCatalog's ranges).
const (
	SeedDemoProfileID = "a0000010-0000-0000-0000-000000000001"
	seedDemoMinifixID = "a0000003-0000-0000-0000-000000000012" // HER-MIN-15 (SeedCatalog)
	seedDemoTaqueteID = "a0000003-0000-0000-0000-000000000011" // HER-TAQ-8X30 (SeedCatalog)
)

// SeedDemoStandardRelease ensures the demo profile exists and publishes
// the seeded Standard draft release through the real compiler.
func SeedDemoStandardRelease(ctx context.Context, store StandardReleaseStore) error {
	// 1. Demo profile (skip when present).
	if _, err := store.GetHardwareProfileByID(ctx, SeedDemoProfileID); err != nil {
		if !strings.Contains(err.Error(), "not found") {
			return fmt.Errorf("demo profile check: %w", err)
		}
		profile := demoProfile()
		if err := store.CreateHardwareProfile(ctx, profile); err != nil {
			return fmt.Errorf("demo profile create: %w", err)
		}
		slog.Info("demo hardware profile seeded", "code", profile.Code, "revision", profile.Revision)
	}

	// 2. Publish the seeded Standard draft release through the real
	// compiler (skip when already published or absent).
	releaseID := uuid.MustParse(domain.GraneteStandardDraftReleaseID)
	release, err := store.GetReleaseByID(ctx, releaseID)
	if err != nil {
		if errors.Is(err, storage.ErrLibraryReleaseNotFound) {
			return nil // no seeded draft in this database: nothing to do
		}
		return fmt.Errorf("demo release load: %w", err)
	}
	if release.Status != domain.ReleaseStatusDraft {
		return nil // already published (or withdrawn): never recompile
	}
	publisherID, err := store.EnsureSeedPlatformUser(ctx)
	if err != nil {
		return fmt.Errorf("demo publisher: %w", err)
	}
	if _, err := PublishStandardRelease(ctx, store, releaseID, uuid.MustParse(publisherID)); err != nil {
		return fmt.Errorf("demo release publish: %w", err)
	}
	slog.Info("demo standard release published", "release", releaseID.String())
	return nil
}

// demoProfile builds the seeded Granete demo profile: minifix + tarugo per
// contact over the fixed-shelf contact classes (target faces front/back;
// cam housing on the fixed panel, dowel bore through the side's outer
// face). Geometrically it mirrors the verified #911/#916 recipe shapes.
func demoProfile() *domain.HardwareProfile {
	return &domain.HardwareProfile{
		ID:          SeedDemoProfileID,
		Code:        "PERF-DEMO-MINIFIX-TAQUETE",
		Name:        "Unión fija minifix + tarugo (demo)",
		Description: "Perfil demo Granete: minifix 15 + tarugo 8x30 por contacto. Dimensiones demo hasta reemplazar por specs de proveedor verificadas (bump de revisión).",
		Revision:    "demo-1",
		Items: []domain.HardwareProfileItem{
			{HardwareID: seedDemoMinifixID, Quantity: 1, ApplicationRole: "cam"},
			{HardwareID: seedDemoTaqueteID, Quantity: 1, ApplicationRole: "dowel"},
		},
		RecipeRef: &domain.ProfileRecipeRef{RecipeID: "demo:minifix-tarugo-fijo", RecipeRevision: "demo-1"},
		Recipe: &domain.ProfileRecipeBody{
			RecipeID:       "demo:minifix-tarugo-fijo",
			RecipeRevision: "demo-1",
			Variants: []domain.ProfileRecipeVariant{
				{
					TargetFace: "front",
					Rules: []domain.ProfileRuleSpec{
						{RuleID: "cam-housing", RuleRevision: "demo-1", ParticipantRole: "A", OperationRole: "housing",
							EntryFace: "bottom", OffsetMm: [3]float64{0, 0, 0}, Axis: [3]float64{0, -1, 0}, DiameterMm: 15, DepthMm: 13},
						{RuleID: "dowel-bore", RuleRevision: "demo-1", ParticipantRole: "B", OperationRole: "dowel",
							EntryFace: "back", OffsetMm: [3]float64{0, 18, 0}, Axis: [3]float64{0, -1, 0}, DiameterMm: 8, DepthMm: 21},
					},
				},
				{
					TargetFace: "back",
					Rules: []domain.ProfileRuleSpec{
						{RuleID: "cam-housing", RuleRevision: "demo-1", ParticipantRole: "A", OperationRole: "housing",
							EntryFace: "top", OffsetMm: [3]float64{0, 0, 0}, Axis: [3]float64{0, -1, 0}, DiameterMm: 15, DepthMm: 13},
						{RuleID: "dowel-bore", RuleRevision: "demo-1", ParticipantRole: "B", OperationRole: "dowel",
							EntryFace: "front", OffsetMm: [3]float64{0, 18, 0}, Axis: [3]float64{0, -1, 0}, DiameterMm: 8, DepthMm: 21},
					},
				},
			},
		},
		Active: true,
	}
}
