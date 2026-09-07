package storage_test

import (
	"context"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #577 / OPS-DT-1 storage proofs against real PostgreSQL: the project read
// model exposes the server-owned resolved release authority (canonical wins
// over a coexisting legacy blob; legacy-only projects keep the compatibility
// projection), and material planning derivation binds to the EXACT canonical
// release id with full provenance pins — R4 never retargets a P1-derived
// plan and the legacy blob stays null through the canonical path.

func opsDt1CreateReleaseP1(t *testing.T, fx *releaseFixture) *storage.ProductionReleaseReadback {
	t.Helper()
	actorA := fiActorA()
	var p1 *storage.ProductionReleaseReadback
	err := releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		p1, err = fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
			ProjectID:        fx.projectID,
			DesignRevisionID: fx.revR3,
			QuoteRevisionID:  fx.quoteQ3,
			ActorUserID:      rlsUserA,
			RequestID:        "req-opsdt1-p1",
		})
		return err
	})
	if err != nil {
		t.Fatalf("create release P1: %v", err)
	}
	return p1
}

func opsDt1DeriveFromRelease(t *testing.T, fx *releaseFixture, releaseID string, wantErr bool) *domain.MaterialPlanning {
	t.Helper()
	actorA := fiActorA()
	var planning *domain.MaterialPlanning
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, mErr := fx.store.MutateProjectMaterialPlanningForRelease(ctx, fx.projectID, releaseID, func(snap *domain.MaterialPlanningSnapshot) (*domain.MaterialPlanningMutation, error) {
			if snap.ProductionRelease == nil || snap.ProductionRelease.ReleaseID == "" {
				return nil, errOpsNoRelease
			}
			if snap.CanonicalReleaseExists && releaseID == "" {
				return nil, errOpsImplicitLatest
			}
			release := snap.ProductionRelease
			next := &domain.MaterialPlanning{
				ID:        domain.NewMaterialPlanningID("mplan"),
				ProjectID: fx.projectID,
				Requirements: &domain.MaterialRequirementsSnapshot{
					ReleaseID:                     release.ReleaseID,
					BomFingerprint:                release.ManufacturingFingerprint,
					SourceProductionReleaseID:     release.ReleaseID,
					SourceProductionReleaseNumber: release.ReleaseNumber,
					SourceDesignRevisionID:        release.DesignRevisionID,
					SourceDesignRevisionNumber:    release.DesignRevisionNumber,
					SourceQuoteRevisionID:         release.QuoteRevisionID,
					Lines: []domain.MaterialRequirementLine{
						{Kind: "tableros", MaterialID: releaseMaterial, Quantity: 4},
					},
				},
				Reservations: []domain.MaterialReservation{},
			}
			if err := domain.ValidateMaterialPlanningShape(next); err != nil {
				return nil, err
			}
			return &domain.MaterialPlanningMutation{Planning: next}, nil
		})
		if mErr != nil {
			return mErr
		}
		proj, pErr := fx.store.GetProjectByID(ctx, fx.projectID)
		if pErr != nil {
			return pErr
		}
		planning = proj.MaterialPlanning
		return nil
	})
	if wantErr {
		if err == nil {
			t.Fatalf("derive from release %q must fail, got success", releaseID)
		}
		return nil
	}
	if err != nil {
		t.Fatalf("derive from release %q: %v", releaseID, err)
	}
	var got *domain.MaterialPlanning
	if planning != nil && planning.Requirements != nil {
		got = planning
	}
	if got == nil {
		t.Fatalf("derive must persist requirements")
	}
	return got
}

type opsDt1Error struct{ msg string }

func (e opsDt1Error) Error() string { return e.msg }

var (
	errOpsNoRelease      = opsDt1Error{"no release authority"}
	errOpsImplicitLatest = opsDt1Error{"implicit latest rejected"}
)

func TestOpsDt1_ProjectReadModelResolvesCanonicalAuthority(t *testing.T) {
	fx := setupReleaseFixture(t)
	actorA := fiActorA()
	p1 := opsDt1CreateReleaseP1(t, fx)

	// A stale legacy OC-022 blob coexisting on the row must NEVER win the
	// projection once a canonical release exists.
	if _, err := fx.admin.Exec(context.Background(), `
		UPDATE projects SET production_release = $1 WHERE id = $2`,
		`{"id":"legacy-rel-9","project_id":"`+fx.projectID+`","project_version":9,"design_revision_id":"legacy-dr","bom_fingerprint":"legacy-fp","released_by":"legacy-user","released_at":"2026-01-01T00:00:00Z"}`,
		fx.projectID); err != nil {
		t.Fatalf("seed stale legacy blob: %v", err)
	}

	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		p, err := fx.store.GetProjectByID(ctx, fx.projectID)
		if err != nil {
			return err
		}
		if p.ResolvedProductionRelease == nil {
			return opsDt1Error{"detail read must expose the resolved authority"}
		}
		projection := p.ResolvedProductionRelease
		if projection.Source != domain.ProductionReleaseAuthorityCanonical ||
			projection.ReleaseID != p1.Release.ID ||
			projection.ReleaseNumber != 1 ||
			projection.DesignRevisionID != fx.revR3 ||
			projection.QuoteRevisionID != fx.quoteQ3 ||
			projection.Status != domain.ProductionReleaseStatusActive ||
			!strings.HasPrefix(projection.ManufacturingFingerprint, "sha256-") {
			return opsDt1Error{"canonical projection pins mismatch: " + string(projection.Source) + " " + projection.ReleaseID}
		}
		if p.ProductionRelease == nil || p.ProductionRelease.ID != "legacy-rel-9" {
			return opsDt1Error{"legacy blob must remain readable as compatibility state"}
		}

		list, err := fx.store.ListProjects(ctx)
		if err != nil {
			return err
		}
		for _, lp := range list {
			if lp.ID != fx.projectID {
				continue
			}
			if lp.ResolvedProductionRelease == nil || lp.ResolvedProductionRelease.Source != domain.ProductionReleaseAuthorityCanonical ||
				lp.ResolvedProductionRelease.ReleaseID != p1.Release.ID {
				return opsDt1Error{"list read must expose the same canonical projection"}
			}
			return nil
		}
		return opsDt1Error{"project missing from list"}
	})
	if err != nil {
		t.Fatalf("read model authority projection: %v", err)
	}
}

func TestOpsDt1_LegacyOnlyProjectKeepsCompatibilityProjection(t *testing.T) {
	fx := setupReleaseFixture(t)
	actorA := fiActorA()

	if _, err := fx.admin.Exec(context.Background(), `
		UPDATE projects SET production_release = $1 WHERE id = $2`,
		`{"id":"legacy-rel-1","project_id":"`+fx.projectID+`","project_version":3,"design_revision_id":"legacy-dr","bom_fingerprint":"legacy-fp","released_by":"legacy-user","released_at":"2026-01-01T00:00:00Z"}`,
		fx.projectID); err != nil {
		t.Fatalf("seed legacy blob: %v", err)
	}

	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		p, err := fx.store.GetProjectByID(ctx, fx.projectID)
		if err != nil {
			return err
		}
		if p.ResolvedProductionRelease == nil || p.ResolvedProductionRelease.Source != domain.ProductionReleaseAuthorityLegacy ||
			p.ResolvedProductionRelease.ReleaseID != "legacy-rel-1" ||
			p.ResolvedProductionRelease.ManufacturingFingerprint != "legacy-fp" ||
			p.ResolvedProductionRelease.ProjectVersion != 3 {
			return opsDt1Error{"legacy-only projection mismatch"}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("legacy-only projection: %v", err)
	}
}

func TestOpsDt1_MaterialDeriveBindsExactCanonicalRelease(t *testing.T) {
	fx := setupReleaseFixture(t)
	actorA := fiActorA()
	p1 := opsDt1CreateReleaseP1(t, fx)

	// 1. Exact P1 derivation stamps the full provenance pins.
	planning := opsDt1DeriveFromRelease(t, fx, p1.Release.ID, false)
	req := planning.Requirements
	if req.SourceProductionReleaseID != p1.Release.ID ||
		req.SourceProductionReleaseNumber != 1 ||
		req.SourceDesignRevisionID != fx.revR3 ||
		req.SourceQuoteRevisionID != fx.quoteQ3 ||
		req.BomFingerprint != p1.Release.ManufacturingFingerprint {
		t.Fatalf("requirements provenance mismatch: %+v", req)
	}

	// 2. Foreign release id is rejected (missing and cross-project are the
	// same answer).
	opsDt1DeriveFromRelease(t, fx, "7fffffff-0000-0000-0000-000000000099", true)

	// 3. The canonical negative proof: publish R4 with a manufacturing change
	// — deriving from P1 again keeps the R3 pins; nothing retargets.
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		if _, err := fx.store.UpdateDesignWorkingCopy(ctx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:   fx.designID,
			SourceType: domain.DesignRevisionSourceSketchup,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{FurnitureInstanceID: fx.fiA, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 650.0, "heightMm": 720.0, "depthMm": 560.0}, MaterialChoices: map[string]string{"BODY": releaseMaterial}},
				{FurnitureInstanceID: fx.fiB, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0}, MaterialChoices: map[string]string{"BODY": releaseMaterial}},
			},
			ActorUserID: rlsUserA,
		}); err != nil {
			return err
		}
		_, err := fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID:       fx.designID,
			BaseRevisionID: fx.revR3,
			SourceType:     domain.DesignRevisionSourceSketchup,
			ActorUserID:    rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("publish R4: %v", err)
	}

	afterR4 := opsDt1DeriveFromRelease(t, fx, p1.Release.ID, false)
	if afterR4.Requirements.SourceDesignRevisionID != fx.revR3 ||
		afterR4.Requirements.BomFingerprint != p1.Release.ManufacturingFingerprint {
		t.Fatalf("R4 must not retarget a P1-derived plan: %+v", afterR4.Requirements)
	}

	// 4. Legacy blob stays null through the whole canonical path — no second,
	// legacy release is ever needed (critical negative proof).
	var legacyNull bool
	if err := fx.admin.QueryRow(context.Background(),
		`SELECT production_release IS NULL FROM projects WHERE id = $1`, fx.projectID).Scan(&legacyNull); err != nil {
		t.Fatalf("read legacy blob state: %v", err)
	}
	if !legacyNull {
		t.Fatalf("canonical flow must leave projects.production_release null")
	}
}

func TestOpsDt1_ExecutionMembershipUsesReleasedFurniture(t *testing.T) {
	fx := setupReleaseFixture(t)
	p1 := opsDt1CreateReleaseP1(t, fx)
	// The live quote quantity is not the released physical membership.
	if _, err := fx.admin.Exec(context.Background(), `UPDATE project_items SET quantity = 9 WHERE project_id = $1`, fx.projectID); err != nil {
		t.Fatal(err)
	}
	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		_, err := fx.store.MutateProjectPartExecutions(ctx, fx.projectID, func(snap *domain.PartExecutionsSnapshot) (*domain.PartExecutionsMutation, error) {
			if len(snap.ItemQuantities) != 2 || snap.ItemQuantities[fx.fiA] != 1 || snap.ItemQuantities[fx.fiB] != 1 {
				t.Fatalf("release %s must validate its two physical identities, not live quote quantities: %+v", p1.Release.ID, snap.ItemQuantities)
			}
			return &domain.PartExecutionsMutation{Parts: snap.Parts, Units: snap.Units}, nil
		})
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
}
