package storage_test

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #826: material choices seeding intersects the definition's consumable
// roles. Proofs against real PostgreSQL under the app role:
//  1. The working-copy write boundary CONVERGES incoming choices to the
//     consumed roles (human decision 2026-09-22: converge-at-write, never
//     block authoring — #620 ride-along and preflight-parity stay intact).
//  2. Requote freezes only consumable roles even when the accepted source
//     revision carries legacy unconsumable commercial roles.
//  3. Reconcile fills only consumable quoted roles.
// The release gate remains the only hard fail-closed check.

const (
	cs826Hardware = "94000000-0000-0000-0000-0000000000c1"
	cs826BodyMat  = "70000000-0000-0000-0000-000000000001"
)

// seed826CommercialGroups adds the org's remaining commercial groups with
// project-level defaults: FRENTES (board) and JALADERA (hardware, required).
// The CS module consumes only INTERIOR, so both defaults are unconsumable.
func seed826CommercialGroups(t *testing.T, fx *quoteLifecycleFixture) {
	t.Helper()
	multiOrgExec(t, fx.admin, `
		INSERT INTO hardwares (id, code, name, unit, cost_per_unit, organization_id)
		VALUES ('`+cs826Hardware+`', 'CS-HW', 'Jaladera CS', 'piece', 10, '`+rlsOrgA+`');
		INSERT INTO option_groups (id, code, name, kind, required, organization_id) VALUES
		 ('93000000-0000-0000-0000-0000000000d1', 'FRENTES', 'Frentes', 'board', TRUE, '`+rlsOrgA+`'),
		 ('93000000-0000-0000-0000-0000000000d2', 'JALADERA', 'Jaladeras', 'hardware', TRUE, '`+rlsOrgA+`');
		INSERT INTO option_group_members (option_group_id, entity_id, organization_id)
		SELECT og.id, v.entity_id::uuid, '`+rlsOrgA+`'::uuid
		FROM option_groups og
		CROSS JOIN (VALUES
		  ('FRENTES', '`+csMaterial2+`'),
		  ('JALADERA', '`+cs826Hardware+`')) AS v(code, entity_id)
		WHERE og.organization_id='`+rlsOrgA+`' AND og.code=v.code;
		INSERT INTO project_level_choices (project_id, option_group_code, choice_entity_id, organization_id)
		VALUES
		 ('`+csProject+`', 'FRENTES', '`+csMaterial2+`', '`+rlsOrgA+`'),
		 ('`+csProject+`', 'JALADERA', '`+cs826Hardware+`', '`+rlsOrgA+`');`)
}

// workingItemChoices reads the persisted working-item choices for one
// instance straight from the canonical table.
func workingItemChoices(t *testing.T, fx *quoteLifecycleFixture, designID, instanceID string) map[string]string {
	t.Helper()
	var raw []byte
	if err := fx.admin.QueryRow(context.Background(), `
		SELECT material_choices FROM design_working_items
		WHERE design_id = $1 AND furniture_instance_id = $2`, designID, instanceID).Scan(&raw); err != nil {
		t.Fatalf("read working item choices: %v", err)
	}
	choices := map[string]string{}
	if len(raw) > 0 && string(raw) != "null" {
		if err := json.Unmarshal(raw, &choices); err != nil {
			t.Fatal(err)
		}
	}
	return choices
}

func TestWorkingCopy_ConvergesUnconsumedChoiceRoles(t *testing.T) {
	fx := setupCommercialSnapshotFixture(t)
	seed826CommercialGroups(t, fx)

	var fi *domain.FurnitureInstance
	var design *domain.Design
	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		var txErr error
		fi, txErr = fx.store.CreateFurnitureInstance(ctx, storage.CreateFurnitureInstanceCommand{
			ProjectID: csProject, Origin: domain.FurnitureInstanceOriginManual, ActorUserID: rlsUserA,
		})
		if txErr != nil {
			return txErr
		}
		design, txErr = fx.store.CreateDesign(ctx, storage.CreateDesignCommand{
			ProjectID: csProject, Name: "826 converge", ActorUserID: rlsUserA,
		})
		return txErr
	})
	if err != nil {
		t.Fatal(err)
	}
	wc, err := fiTxAnd(t, fx.rlsFixture, fiActorA(), func(ctx context.Context) (*domain.DesignWorkingCopy, error) {
		return fx.store.GetDesignWorkingCopy(ctx, design.ID)
	})
	if err != nil {
		t.Fatal(err)
	}

	// The full commercial seed (6-group style) against a module consuming
	// only INTERIOR converges to the consumed map on write. Authoring is
	// never blocked — the release gate stays the only hard failure.
	seedChoices := map[string]string{
		"INTERIOR": csMaterial, "FRENTES": csMaterial2, "JALADERA": cs826Hardware,
		"BISAGRA": cs826Hardware, "CORREDERA": cs826Hardware, "ZOCLO": csMaterial2,
	}
	if _, err := fiTxAnd(t, fx.rlsFixture, fiActorA(), func(ctx context.Context) (*domain.DesignWorkingCopy, error) {
		return fx.store.UpdateDesignWorkingCopy(ctx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:               design.ID,
			ExpectedWorkingVersion: &wc.UpdatedAt,
			SourceType:             domain.DesignRevisionSourceSketchup,
			ActorUserID:            rlsUserA,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{{
				FurnitureInstanceID:   fi.ID,
				FurnitureDefinitionID: csModule,
				MaterialChoices:       seedChoices,
			}},
		})
	}); err != nil {
		t.Fatalf("placement with polluted seed must not be blocked: %v", err)
	}
	// ZOCLO survives (base-treatment roles are never dropped); the rest of
	// the unconsumable commercial roles converge away.
	want := map[string]string{"INTERIOR": csMaterial, "ZOCLO": csMaterial2}
	if got := workingItemChoices(t, fx, design.ID, fi.ID); !reflect.DeepEqual(want, got) {
		t.Fatalf("working item must converge to consumed + base-treatment roles, got %v want %v", got, want)
	}
}

func TestRequote_FreezesOnlyConsumableRolesFromPoisonedSource(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	actorA := fiActorA()

	// A legacy quote line whose quoted choices carry an unconsumable role
	// (FRENTES on fiModuleA, which consumes BODY only) — the exact shape of
	// the 2026-09-22 demo blocker.
	const poisonedLine = "60000000-0000-0000-0000-0000000000d9"
	multiOrgExec(t, fx.admin, `
		INSERT INTO project_items (id, project_id, module_id, quantity, custom_dims, organization_id)
		VALUES ('`+poisonedLine+`', '`+fiSharedProject+`', '`+fiModuleA+`', 1, '{"widthMm": 600, "heightMm": 720, "depthMm": 560}', '`+rlsOrgA+`');
		INSERT INTO project_item_choices (project_item_id, option_group_code, choice_entity_id, organization_id)
		VALUES
		 ('`+poisonedLine+`', 'BODY', '`+cs826BodyMat+`', '`+rlsOrgA+`'),
		 ('`+poisonedLine+`', 'FRENTES', '`+cs826BodyMat+`', '`+rlsOrgA+`');`)

	poisonedChoices := map[string]string{"BODY": cs826BodyMat, "FRENTES": cs826BodyMat}
	qxFixture := &quoteLifecycleFixture{rlsFixture: fx, projectID: fiSharedProject}
	var instanceID string
	var design *domain.Design
	var quoteRevID, designRevID string
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		var txErr error
		design, txErr = fx.store.CreateDesign(ctx, storage.CreateDesignCommand{
			ProjectID: fiSharedProject, Name: "826 requote", ActorUserID: rlsUserA,
		})
		if txErr != nil {
			return txErr
		}
		matRes, txErr := fx.store.MaterializeQuoteLine(ctx, storage.MaterializeQuoteLineCommand{
			ProjectID: fiSharedProject, QuoteLineID: poisonedLine, ActorUserID: rlsUserA,
		})
		if txErr != nil {
			return txErr
		}
		instanceID = matRes.Instances[0].FurnitureInstanceID

		// Legacy Q1 freezes the poisoned choices verbatim (quote-first #620).
		qRev, txErr := createPublishedFixtureQuoteRevision(ctx, fx.store, storage.CreateQuoteRevisionCommand{
			ProjectID: fiSharedProject,
			Notes:     "Q1 poisoned",
			Items: []storage.CreateQuoteRevisionItemCommand{{
				FurnitureInstanceID: instanceID, FurnitureDefinitionID: fiModuleA,
				Parameters:      map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0},
				MaterialChoices: poisonedChoices, LifecycleStatus: "active",
			}},
		})
		if txErr != nil {
			return txErr
		}
		quoteRevID = qRev.ID

		// The designer re-places the unit (width change = commercial delta);
		// even a still-polluted overlay converges on write.
		if _, txErr = UpdateWorkingCopyCurrent(ctx, fx.store, storage.UpdateDesignWorkingCopyCommand{
			DesignID: design.ID, SourceType: domain.DesignRevisionSourceSketchup, ActorUserID: rlsUserA,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{{
				FurnitureInstanceID: instanceID, FurnitureDefinitionID: fiModuleA,
				Parameters:      map[string]any{"widthMm": 650.0, "heightMm": 720.0, "depthMm": 560.0},
				MaterialChoices: poisonedChoices,
			}},
		}); txErr != nil {
			return txErr
		}
		rev, txErr := fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID: design.ID, SourceType: domain.DesignRevisionSourceSketchup, ActorUserID: rlsUserA,
		})
		if txErr != nil {
			return txErr
		}
		designRevID = rev.ID
		_, txErr = fx.store.UpdateQuoteRevisionStatus(ctx, storage.UpdateQuoteRevisionStatusCommand{
			QuoteRevisionID: quoteRevID, Status: "accepted",
		})
		return txErr
	})
	if err != nil {
		t.Fatal(err)
	}

	// The working copy already converged: only BODY survives there.
	if got := workingItemChoices(t, qxFixture, design.ID, instanceID); !reflect.DeepEqual(map[string]string{"BODY": cs826BodyMat}, got) {
		t.Fatalf("working copy must converge before publish, got %v", got)
	}

	result, err := fiTxAnd(t, fx, actorA, func(ctx context.Context) (*storage.RequoteProjectQuoteResult, error) {
		return fx.store.RequoteProjectQuote(ctx, storage.RequoteProjectQuoteCommand{
			ProjectID: fiSharedProject, BaseQuoteRevisionID: quoteRevID, DesignRevisionID: designRevID,
			ActorUserID: rlsUserA,
		})
	})
	if err != nil {
		t.Fatalf("RequoteProjectQuote: %v", err)
	}

	// The requote draft freezes only the consumable role: the poisoned
	// FRENTES from the source snapshot does not propagate to Q2.
	var raw []byte
	if err := fx.admin.QueryRow(context.Background(), `
		SELECT material_choices FROM quote_revision_items
		WHERE quote_revision_id = $1 AND furniture_instance_id = $2`, result.Revision.ID, instanceID).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	draftChoices := map[string]string{}
	if err := json.Unmarshal(raw, &draftChoices); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(map[string]string{"BODY": cs826BodyMat}, draftChoices) {
		t.Fatalf("requote draft must freeze only consumable roles, got %s", raw)
	}
	if got := workingItemChoices(t, qxFixture, design.ID, instanceID); !reflect.DeepEqual(map[string]string{"BODY": cs826BodyMat}, got) {
		t.Fatalf("source working copy must stay converged, got %v", got)
	}
}

// #826 review case 2 at the full affected path (real PostgreSQL + RLS under
// the app role): a module whose entire BOM is one FIXED-ID hardware line
// consumes no choice role, so a seeded surplus role must converge on write
// and the published revision must clear the release gate — not be blocked by
// release_snapshot_resolution.
func TestReleaseGate_HardwareOnlyModuleSurplusChoicesConverge(t *testing.T) {
	fx := setupCommercialSnapshotFixture(t)

	const hwOnlyModule = "52000000-0000-0000-0000-0000000000d2"
	multiOrgExec(t, fx.admin, `
		INSERT INTO hardwares (id, code, name, unit, cost_per_unit, organization_id)
		VALUES ('`+cs826Hardware+`', 'CS-HW', 'Jaladera CS', 'piece', 10, '`+rlsOrgA+`');
		INSERT INTO modules (id, code, name, base_labor_cost, width_mm, height_mm, depth_mm, organization_id)
		VALUES ('`+hwOnlyModule+`', 'CS-HW-ONLY', 'Modulo solo herraje fijo', 0, 600, 720, 560, '`+rlsOrgA+`');
		INSERT INTO hardware_lines (module_id, option_role, hardware_id, quantity, organization_id)
		VALUES ('`+hwOnlyModule+`', 'FIXED', '`+cs826Hardware+`', 4, '`+rlsOrgA+`');`)

	var fi *domain.FurnitureInstance
	var design *domain.Design
	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		var txErr error
		fi, txErr = fx.store.CreateFurnitureInstance(ctx, storage.CreateFurnitureInstanceCommand{
			ProjectID: csProject, FurnitureDefinitionID: hwOnlyModule,
			Origin: domain.FurnitureInstanceOriginDesign, ActorUserID: rlsUserA,
		})
		if txErr != nil {
			return txErr
		}
		design, txErr = fx.store.CreateDesign(ctx, storage.CreateDesignCommand{
			ProjectID: csProject, Name: "826 hw-only gate", ActorUserID: rlsUserA,
		})
		return txErr
	})
	if err != nil {
		t.Fatal(err)
	}
	wc, err := fiTxAnd(t, fx.rlsFixture, fiActorA(), func(ctx context.Context) (*domain.DesignWorkingCopy, error) {
		return fx.store.GetDesignWorkingCopy(ctx, design.ID)
	})
	if err != nil {
		t.Fatal(err)
	}

	var revisionID string
	err = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		if _, txErr := fx.store.UpdateDesignWorkingCopy(ctx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:               design.ID,
			ExpectedWorkingVersion: &wc.UpdatedAt,
			SourceType:             domain.DesignRevisionSourceSketchup,
			ActorUserID:            rlsUserA,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{{
				FurnitureInstanceID:   fi.ID,
				FurnitureDefinitionID: hwOnlyModule,
				MaterialChoices:       map[string]string{"JALADERA": cs826Hardware, "CORREDERA": cs826Hardware},
			}},
		}); txErr != nil {
			return txErr
		}
		rev, txErr := fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID: design.ID, SourceType: domain.DesignRevisionSourceSketchup, ActorUserID: rlsUserA,
		})
		if txErr != nil {
			return txErr
		}
		revisionID = rev.ID
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	// Convergence happened on write: the hardware-only definition consumes no
	// role, so the surplus seed left the persisted working item empty.
	if got := workingItemChoices(t, fx, design.ID, fi.ID); len(got) != 0 {
		t.Fatalf("surplus choices must converge away for a hardware-only module, got %v", got)
	}

	// The release gate (the same evaluation the release command runs) accepts
	// the published revision: hardware demand exists and choices ≡ consumed.
	preflight, err := fiTxAnd(t, fx.rlsFixture, fiActorA(), func(ctx context.Context) (*domain.ManufacturingPreflightResult, error) {
		return fx.store.EvaluateDesignRevisionPreflight(ctx, design.ID, revisionID)
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, issue := range preflight.Issues {
		if issue.Code == domain.PreflightIssueSnapshotResolution {
			t.Fatalf("hardware-only revision must not hit the snapshot-resolution gate, issues: %+v", preflight.Issues)
		}
	}
	if preflight.Status != domain.ManufacturingPreflightReady {
		t.Fatalf("hardware-only revision must clear the release gate, got %s: %+v", preflight.Status, preflight.Issues)
	}
}

func TestReconcile_DoesNotFillUnconsumableRoles(t *testing.T) {
	fx := setupCommercialSnapshotFixture(t)
	seed826CommercialGroups(t, fx)

	// Legacy-style quoted line carrying an unconsumable role (FRENTES).
	const legacyLine = "62000000-0000-0000-0000-0000000000d1"
	multiOrgExec(t, fx.admin, `
		INSERT INTO project_items (id, project_id, module_id, quantity, organization_id)
		VALUES ('`+legacyLine+`', '`+csProject+`', '`+csModule+`', 1, '`+rlsOrgA+`');
		INSERT INTO project_item_choices (project_item_id, option_group_code, choice_entity_id, organization_id)
		VALUES
		 ('`+legacyLine+`', 'INTERIOR', '`+csMaterial+`', '`+rlsOrgA+`'),
		 ('`+legacyLine+`', 'FRENTES', '`+csMaterial2+`', '`+rlsOrgA+`');`)

	var instanceID string
	err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		mat, txErr := fx.store.MaterializeQuoteLine(txCtx, storage.MaterializeQuoteLineCommand{
			ProjectID: csProject, QuoteLineID: legacyLine, ActorUserID: rlsUserA,
		})
		if txErr != nil {
			return txErr
		}
		instanceID = mat.Instances[0].FurnitureInstanceID
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	var design *domain.Design
	err = fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		var txErr error
		design, txErr = fx.store.CreateDesign(txCtx, storage.CreateDesignCommand{
			ProjectID: csProject, Name: "826 reconcile", ActorUserID: rlsUserA,
		})
		return txErr
	})
	if err != nil {
		t.Fatal(err)
	}
	wc, err := fiTxAnd(t, fx.rlsFixture, fiActorA(), func(txCtx context.Context) (*domain.DesignWorkingCopy, error) {
		return fx.store.GetDesignWorkingCopy(txCtx, design.ID)
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fiTxAnd(t, fx.rlsFixture, fiActorA(), func(txCtx context.Context) (*domain.DesignWorkingCopy, error) {
		return fx.store.UpdateDesignWorkingCopy(txCtx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:               design.ID,
			ExpectedWorkingVersion: &wc.UpdatedAt,
			ActorUserID:            rlsUserA,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{{
				FurnitureInstanceID:   instanceID,
				FurnitureDefinitionID: csModule,
			}},
		})
	}); err != nil {
		t.Fatal(err)
	}

	reconciled, err := fiTxAnd(t, fx.rlsFixture, fiActorA(), func(txCtx context.Context) (*storage.DesignWorkingMaterialsReconciliation, error) {
		return fx.store.ReconcileDesignWorkingMaterials(txCtx, storage.ReconcileDesignWorkingMaterialsCommand{
			DesignID: design.ID, FurnitureInstanceID: instanceID, ActorUserID: rlsUserA,
		})
	})
	if err != nil {
		t.Fatal(err)
	}
	// INTERIOR is quoted-missing and consumable → filled. FRENTES is quoted
	// but unconsumable by the CS module → NOT re-seeded (#826).
	if !reflect.DeepEqual(map[string]string{"INTERIOR": csMaterial}, reconciled.FilledChoices) {
		t.Fatalf("reconcile must fill only consumable quoted roles, got %+v", reconciled.FilledChoices)
	}
}
