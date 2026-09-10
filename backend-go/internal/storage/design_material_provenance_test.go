package storage_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #637 / DT-MAT: quoted-material provenance detection + explicit
// reconciliation into the mutable DesignWorkingCopy, proven on real
// PostgreSQL under the app role. The scenario reproduces the exact historical
// defect: units materialized from quote lines that carry explicit option
// choices, placed pre-#621 so their working items (and the R1..R3 revisions
// published from them) froze material_choices = {}.
//
// The matrix pins:
//   1. quoted choice exists + working choice missing → candidate detected;
//   2. authored working choice → never overwritten (even when the quote
//      disagrees);
//   3. multiple roles: missing filled, existing preserved, alias-governed
//      (ZOCLO ← authored FRENTE) left alone;
//   4. no quoted choice → nothing invented;
//   5. wrong project/design/furniture instance → fail closed;
//   6. tenant isolation (cross-org repair denied, foreign design reads 404);
//   7. retry/idempotency (second call is a no-op, no timestamp bump, no audit);
//   8. optimistic concurrency (stale expected updated_at rejects);
//   9. historical R1..R3 rows stay logically unchanged; the next publish (R4)
//      is the first revision to carry the reconciled choices.

const (
	matProvenanceFront    = "70000000-0000-0000-0000-0000000000a1" // quoted FRENTES
	matProvenanceInterior = "70000000-0000-0000-0000-0000000000a2" // quoted INTERIOR
	matProvenanceOther    = "70000000-0000-0000-0000-0000000000a3" // disagrees with authored
	matProvenanceZoclo    = "70000000-0000-0000-0000-0000000000a4" // quoted ZOCLO (alias case)
)

// designRevisionItemsSnapshot freezes the logical per-item content of one
// published revision so any post-repair mutation fails loudly.
func designRevisionItemsSnapshot(t *testing.T, pool *pgxpool.Pool, revisionID string) map[string]string {
	t.Helper()
	rows, err := pool.Query(context.Background(), `
		SELECT furniture_instance_id::text, parameters::text, material_choices::text, transform::text,
		       COALESCE(room_id, ''), created_at::text
		FROM design_revision_items
		WHERE design_revision_id = $1
		ORDER BY furniture_instance_id
	`, revisionID)
	if err != nil {
		t.Fatalf("read design revision items: %v", err)
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var fiID, params, mats, transform, room, createdAt string
		if err := rows.Scan(&fiID, &params, &mats, &transform, &room, &createdAt); err != nil {
			t.Fatalf("scan design revision item: %v", err)
		}
		out[fiID] = params + "|" + mats + "|" + transform + "|" + room + "|" + createdAt
	}
	return out
}

// seedProvenanceQuoteLine inserts one quote line with board choices and
// materializes its physical unit, returning the FurnitureInstance id.
func seedProvenanceQuoteLine(t *testing.T, fx *rlsFixture, lineID string, choices map[string]string) string {
	t.Helper()
	ctx := context.Background()
	if _, err := fx.admin.Exec(ctx, `
		INSERT INTO project_items (id, project_id, module_id, quantity, custom_dims, organization_id)
		VALUES ($1, $2, $3, 1, '{"widthMm": 600, "heightMm": 720, "depthMm": 560}', '`+rlsOrgA+`')`,
		lineID, fiSharedProject, fiModuleA); err != nil {
		t.Fatalf("seed quote line %s: %v", lineID, err)
	}
	for role, material := range choices {
		if _, err := fx.admin.Exec(ctx, `
			INSERT INTO project_item_choices (project_item_id, option_group_code, choice_entity_id, organization_id)
			VALUES ($1, $2, $3, '`+rlsOrgA+`')`, lineID, role, material); err != nil {
			t.Fatalf("seed choice %s: %v", role, err)
		}
	}
	var instanceID string
	err := fiTx(t, fx.store, fiActorA(), func(txCtx context.Context) error {
		mat, txErr := fx.store.MaterializeQuoteLine(txCtx, storage.MaterializeQuoteLineCommand{
			ProjectID:   fiSharedProject,
			QuoteLineID: lineID,
			ActorUserID: rlsUserA,
		})
		if txErr != nil {
			return txErr
		}
		if len(mat.Instances) != 1 {
			t.Fatalf("line %s: expected 1 instance, got %d", lineID, len(mat.Instances))
		}
		instanceID = mat.Instances[0].FurnitureInstanceID
		return nil
	})
	if err != nil {
		t.Fatalf("materialize line %s: %v", lineID, err)
	}
	return instanceID
}

func TestDesignMaterialProvenance_DetectReconcileAndPreserveHistory(t *testing.T) {
	fx := setupDesignsTestFixture(t)
	actorA := fiActorA()
	ctx := context.Background()

	// Catalog boards for every quoted/authored material id.
	for _, board := range []struct {
		id   string
		code string
	}{{matProvenanceFront, "PROV-FRONT"}, {matProvenanceInterior, "PROV-INT"}, {matProvenanceOther, "PROV-OTHER"}, {matProvenanceZoclo, "PROV-ZOCLO"}} {
		if _, err := fx.admin.Exec(ctx, `
			INSERT INTO material_boards (id, code, name, width_mm, length_mm, thickness_mm, board_price, organization_id)
			VALUES ($1, $2, $3, 1830, 2440, 18, 1000, $4)`, board.id, board.code, board.code, rlsOrgA); err != nil {
			t.Fatalf("seed board %s: %v", board.code, err)
		}
	}

	// Three connected units:
	//   fiHist  — quote {FRENTES, INTERIOR}, working {} (the historical bug);
	//   fiMixed — quote {FRENTES: other, INTERIOR}, working {FRENTES: authored}
	//             (authored wins, INTERIOR is the fill candidate);
	//   fiAlias — quote {FRENTES: other, ZOCLO}, working {FRENTE: authored}
	//             (ZOCLO is alias-governed by authored FRENTE — NOT a candidate).
	fiHist := seedProvenanceQuoteLine(t, fx, "60000000-0000-0000-0000-000000000b01", map[string]string{
		"FRENTES":  matProvenanceFront,
		"INTERIOR": matProvenanceInterior,
	})
	fiMixed := seedProvenanceQuoteLine(t, fx, "60000000-0000-0000-0000-000000000b02", map[string]string{
		"FRENTES":  matProvenanceOther,
		"INTERIOR": matProvenanceInterior,
	})
	fiAlias := seedProvenanceQuoteLine(t, fx, "60000000-0000-0000-0000-000000000b03", map[string]string{
		"FRENTES": matProvenanceOther,
		"ZOCLO":   matProvenanceZoclo,
	})
	// A quoted unit that was never placed: proves no-candidate never invents.
	fiUnplaced := seedProvenanceQuoteLine(t, fx, "60000000-0000-0000-0000-000000000b04", map[string]string{
		"FRENTES": matProvenanceFront,
	})
	// A unit of ANOTHER (org-A-visible) project for the cross-project
	// fail-closed proof; an org-B-private unit is additionally invisible to
	// actor A under RLS and must read as not found.
	fiForeign := "51000000-0000-0000-0000-000000000bb1"
	if _, err := fx.admin.Exec(ctx, `
		INSERT INTO furniture_instances (id, project_id, organization_id, origin)
		VALUES ($1, $2, '`+rlsOrgA+`', 'manual')`, fiForeign, fiProjectAOnly); err != nil {
		t.Fatalf("seed foreign instance: %v", err)
	}
	fiInvisible := "51000000-0000-0000-0000-000000000bb2"
	if _, err := fx.admin.Exec(ctx, `
		INSERT INTO furniture_instances (id, project_id, organization_id, origin)
		VALUES ($1, $2, '`+rlsOrgB+`', 'manual')`, fiInvisible, fiProjectB); err != nil {
		t.Fatalf("seed invisible instance: %v", err)
	}

	var designID string
	err := fiTx(t, fx.store, actorA, func(txCtx context.Context) error {
		d, txErr := fx.store.CreateDesign(txCtx, storage.CreateDesignCommand{
			ProjectID:   fiSharedProject,
			Name:        "Cocina histórica",
			ActorUserID: rlsUserA,
		})
		if txErr != nil {
			return txErr
		}
		designID = d.ID

		// The pre-#621 working copy: explicit choices lost ({}), authored
		// FRENTE on fiAlias, authored FRENTES on fiMixed.
		_, txErr = fx.store.UpdateDesignWorkingCopy(txCtx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:   designID,
			SourceType: domain.DesignRevisionSourceSketchup,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{FurnitureInstanceID: fiHist, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 600.0}, MaterialChoices: map[string]string{}, Transform: domain.Transform3D{TranslationMm: [3]float64{0, 0, 0}}},
				{FurnitureInstanceID: fiMixed, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 600.0}, MaterialChoices: map[string]string{"FRENTES": matProvenanceFront}, Transform: domain.Transform3D{TranslationMm: [3]float64{600, 0, 0}}},
				{FurnitureInstanceID: fiAlias, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 600.0}, MaterialChoices: map[string]string{"FRENTE": matProvenanceFront}, Transform: domain.Transform3D{TranslationMm: [3]float64{1200, 0, 0}}},
			},
			ActorUserID: rlsUserA,
		})
		if txErr != nil {
			return txErr
		}
		return nil
	})
	if err != nil {
		t.Fatalf("seed design: %v", err)
	}

	// Publish R1..R3 the way history did: transform-only churn, choices stay
	// frozen at their (possibly empty) working values. Every publish after R1
	// chains its exact base revision.
	revisions := make([]string, 0, 3)
	for i := 0; i < 3; i++ {
		var baseRevisionID string
		if len(revisions) > 0 {
			baseRevisionID = revisions[len(revisions)-1]
		}
		err = fiTx(t, fx.store, actorA, func(txCtx context.Context) error {
			wc, txErr := fx.store.GetDesignWorkingCopy(txCtx, designID)
			if txErr != nil {
				return txErr
			}
			items := make([]storage.UpdateDesignWorkingCopyItemCommand, 0, len(wc.Items))
			for _, item := range wc.Items {
				item.Transform.TranslationMm[0] += 10
				items = append(items, storage.UpdateDesignWorkingCopyItemCommand{
					FurnitureInstanceID:   item.FurnitureInstanceID,
					FurnitureDefinitionID: item.FurnitureDefinitionID,
					DefinitionVersion:     item.DefinitionVersion,
					Parameters:            item.Parameters,
					MaterialChoices:       item.MaterialChoices,
					Transform:             *item.Transform,
				})
			}
			if _, txErr = fx.store.UpdateDesignWorkingCopy(txCtx, storage.UpdateDesignWorkingCopyCommand{
				DesignID: designID, SourceType: domain.DesignRevisionSourceSketchup,
				Items: items, ActorUserID: rlsUserA,
			}); txErr != nil {
				return txErr
			}
			rev, txErr := fx.store.PublishDesignRevision(txCtx, storage.PublishDesignRevisionCommand{
				DesignID: designID, BaseRevisionID: baseRevisionID,
				SourceType: domain.DesignRevisionSourceSketchup, ActorUserID: rlsUserA,
			})
			if txErr != nil {
				return txErr
			}
			revisions = append(revisions, rev.ID)
			return nil
		})
		if err != nil {
			t.Fatalf("publish revision %d: %v", i+1, err)
		}
	}
	frozenHistory := map[string]map[string]string{}
	for i, revID := range revisions {
		frozenHistory[revID] = designRevisionItemsSnapshot(t, fx.admin, revID)
		if got := frozenHistory[revID][fiHist]; got == "" || !strings.Contains(got, "{}") {
			t.Fatalf("R%d historical snapshot for fiHist must carry empty material_choices, got %q", i+1, got)
		}
	}

	// ── Detection (read-only): candidates are exactly the lost quoted roles.
	prov, err := fiTxAnd(t, fx, actorA, func(txCtx context.Context) (*storage.DesignWorkingCopyMaterialProvenance, error) {
		return fx.store.GetDesignWorkingCopyMaterialProvenance(txCtx, designID)
	})
	if err != nil {
		t.Fatalf("provenance read: %v", err)
	}
	byInstance := map[string]storage.DesignWorkingItemMaterialProvenance{}
	for _, item := range prov.Items {
		byInstance[item.FurnitureInstanceID] = item
	}
	rolesOf := func(instanceID string) map[string]storageRoleView {
		out := map[string]storageRoleView{}
		for _, r := range byInstance[instanceID].Roles {
			out[r.Role] = storageRoleView{working: r.WorkingChoice, quoted: r.QuotedChoice, effective: r.EffectiveChoice, provenance: string(r.Provenance)}
		}
		return out
	}
	if !byInstance[fiHist].Reconcilable {
		t.Fatalf("fiHist must be a reconciliation candidate")
	}
	hist := rolesOf(fiHist)
	if p := hist["FRENTES"]; p.provenance != "quoted_missing_from_working" || p.quoted != matProvenanceFront || p.working != "" {
		t.Fatalf("fiHist FRENTES = %+v, want quoted_missing_from_working with the quoted finish", p)
	}
	if p := hist["INTERIOR"]; p.provenance != "quoted_missing_from_working" || p.quoted != matProvenanceInterior {
		t.Fatalf("fiHist INTERIOR = %+v, want quoted_missing_from_working", p)
	}
	mixed := rolesOf(fiMixed)
	if !byInstance[fiMixed].Reconcilable {
		t.Fatalf("fiMixed must be a candidate for INTERIOR")
	}
	if p := mixed["FRENTES"]; p.provenance != "authored" || p.working != matProvenanceFront || p.effective != matProvenanceFront {
		t.Fatalf("fiMixed FRENTES = %+v, want authored preserved", p)
	}
	if p := mixed["INTERIOR"]; p.provenance != "quoted_missing_from_working" {
		t.Fatalf("fiMixed INTERIOR = %+v, want candidate", p)
	}
	alias := rolesOf(fiAlias)
	if !byInstance[fiAlias].Reconcilable {
		t.Fatalf("fiAlias must be a candidate: FRENTES is a distinct role from authored FRENTE")
	}
	if p := alias["FRENTE"]; p.provenance != "authored" || p.working != matProvenanceFront {
		t.Fatalf("fiAlias FRENTE = %+v, want authored", p)
	}
	if p := alias["ZOCLO"]; p.provenance != "inherited_default" || p.effective != matProvenanceFront || p.quoted != matProvenanceZoclo {
		t.Fatalf("fiAlias ZOCLO = %+v, want inherited_default from authored FRENTE", p)
	}

	// Reading never mutates history.
	if snap := designRevisionItemsSnapshot(t, fx.admin, revisions[2]); len(snap) != 3 {
		t.Fatalf("provenance read must not alter history")
	}

	// ── Repair 1 (fiHist): fills exactly the lost quoted roles.
	repair := func(instanceID string, expected *time.Time) (*storage.DesignWorkingMaterialsReconciliation, error) {
		return fiTxAnd(t, fx, actorA, func(txCtx context.Context) (*storage.DesignWorkingMaterialsReconciliation, error) {
			return fx.store.ReconcileDesignWorkingMaterials(txCtx, storage.ReconcileDesignWorkingMaterialsCommand{
				DesignID:            designID,
				FurnitureInstanceID: instanceID,
				ExpectedUpdatedAt:   expected,
				ActorUserID:         rlsUserA,
				IP:                  "203.0.113.20",
				RequestID:           "dt-mat-reconcile-0001",
			})
		})
	}
	res1, err := repair(fiHist, nil)
	if err != nil {
		t.Fatalf("repair fiHist: %v", err)
	}
	if len(res1.FilledChoices) != 2 || res1.FilledChoices["FRENTES"] != matProvenanceFront || res1.FilledChoices["INTERIOR"] != matProvenanceInterior {
		t.Fatalf("fiHist filled = %v, want FRENTES+INTERIOR quoted finishes", res1.FilledChoices)
	}

	// ── Repair 2 (fiMixed): INTERIOR filled, authored FRENTES preserved.
	res2, err := repair(fiMixed, nil)
	if err != nil {
		t.Fatalf("repair fiMixed: %v", err)
	}
	if len(res2.FilledChoices) != 1 || res2.FilledChoices["INTERIOR"] != matProvenanceInterior {
		t.Fatalf("fiMixed filled = %v, want only INTERIOR", res2.FilledChoices)
	}
	if res2.PreservedChoices["FRENTES"] != matProvenanceFront {
		t.Fatalf("fiMixed preserved = %v, want authored FRENTES", res2.PreservedChoices)
	}

	// ── Repair 3 (fiAlias): FRENTES ≠ FRENTE (distinct role codes), so the
	// missing quoted FRENTES is a genuine candidate; ZOCLO is protected by the
	// authored FRENTE alias and must stay unfilled.
	res3, err := repair(fiAlias, nil)
	if err != nil {
		t.Fatalf("repair fiAlias: %v", err)
	}
	if res3.FilledChoices["FRENTES"] != matProvenanceOther {
		t.Fatalf("fiAlias filled = %v, want FRENTES (distinct role from authored FRENTE)", res3.FilledChoices)
	}
	if _, filledZoclo := res3.FilledChoices["ZOCLO"]; filledZoclo {
		t.Fatalf("fiAlias ZOCLO must NOT be filled: authored FRENTE governs it (inherited)")
	}
	if res3.PreservedChoices["ZOCLO"] != matProvenanceFront {
		t.Fatalf("fiAlias preserved = %v, want ZOCLO inherited from authored FRENTE", res3.PreservedChoices)
	}

	// ── Idempotency: the exact retry is an honest no-op (no mutation, no
	// timestamp bump, no audit row) and the working copy holds the repairs.
	before := workingCopyState(t, fx, designID)
	resRetry, err := repair(fiHist, nil)
	if err != nil {
		t.Fatalf("retry repair fiHist: %v", err)
	}
	if len(resRetry.FilledChoices) != 0 {
		t.Fatalf("retry filled = %v, want empty no-op", resRetry.FilledChoices)
	}
	after := workingCopyState(t, fx, designID)
	if before != after {
		t.Fatalf("retry mutated the working copy: before=%q after=%q", before, after)
	}

	// ── No invention: a quoted-but-unplaced unit and an instance without any
	// quoted line produce no explicit choices anywhere.
	prov2, err := fiTxAnd(t, fx, actorA, func(txCtx context.Context) (*storage.DesignWorkingCopyMaterialProvenance, error) {
		return fx.store.GetDesignWorkingCopyMaterialProvenance(txCtx, designID)
	})
	if err != nil {
		t.Fatalf("provenance re-read: %v", err)
	}
	for _, item := range prov2.Items {
		if item.Reconcilable {
			t.Fatalf("after repair %+v still reconcilable", item.FurnitureInstanceID)
		}
		for _, role := range item.Roles {
			if role.Provenance == "missing_unresolved" && role.WorkingChoice != "" {
				t.Fatalf("invented explicit choice for unresolved role %+v", role)
			}
		}
	}

	// ── Fail-closed: foreign instance (other project), an RLS-invisible
	// org-B instance, unplaced unit and an unknown design.
	_, err = repair(fiForeign, nil)
	if !errors.Is(err, domain.ErrCrossProjectFurnitureInstance) {
		t.Fatalf("cross-project repair err = %v, want ErrCrossProjectFurnitureInstance", err)
	}
	_, err = repair(fiInvisible, nil)
	if !errors.Is(err, storage.ErrFurnitureInstanceNotFound) {
		t.Fatalf("invisible repair err = %v, want ErrFurnitureInstanceNotFound (uniform not found)", err)
	}
	_, err = repair(fiUnplaced, nil)
	if !errors.Is(err, domain.ErrWorkingItemNotFound) {
		t.Fatalf("unplaced repair err = %v, want ErrWorkingItemNotFound", err)
	}
	err = fiTx(t, fx.store, actorA, func(txCtx context.Context) error {
		_, txErr := fx.store.ReconcileDesignWorkingMaterials(txCtx, storage.ReconcileDesignWorkingMaterialsCommand{
			DesignID:            "7fffffff-0000-0000-0000-0000000000f1",
			FurnitureInstanceID: fiHist,
		})
		if !errors.Is(txErr, domain.ErrDesignNotFound) {
			t.Errorf("random design err = %v, want ErrDesignNotFound", txErr)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("random design tx: %v", err)
	}

	// ── Tenant isolation: org B (manufacturing partner on the shared project)
	// cannot repair the owner's working copy — the design row is not visible
	// FOR UPDATE under its RLS UPDATE policy, so the command fails closed.
	err = fiTx(t, fx.store, fiActorB(), func(txCtx context.Context) error {
		_, txErr := fx.store.ReconcileDesignWorkingMaterials(txCtx, storage.ReconcileDesignWorkingMaterialsCommand{
			DesignID: designID, FurnitureInstanceID: fiHist,
		})
		if !errors.Is(txErr, domain.ErrDesignNotFound) && !errors.Is(txErr, domain.ErrFurnitureInstanceProjectNotWritable) {
			t.Errorf("org B repair err = %v, want a fail-closed denial", txErr)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("org B isolation tx: %v", err)
	}
	err = fiTx(t, fx.store, fiActorB(), func(txCtx context.Context) error {
		_, txErr := fx.store.GetDesignWorkingCopyMaterialProvenance(txCtx, "7fffffff-0000-0000-0000-0000000000f2")
		if !errors.Is(txErr, domain.ErrDesignNotFound) {
			t.Errorf("unknown design provenance err = %v, want ErrDesignNotFound", txErr)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("unknown design tx: %v", err)
	}

	// ── Optimistic concurrency: a stale expected updated_at rejects.
	stale := prov2.WorkingCopyUpdatedAt.Add(-time.Minute)
	if _, err = repair(fiHist, &stale); !errors.Is(err, storage.ErrVersionConflict) {
		t.Fatalf("stale expected err = %v, want ErrVersionConflict", err)
	}

	// ── Durable audit: exactly one reconciliation event per real mutation.
	var auditCount int
	if err := fx.admin.QueryRow(ctx, `
		SELECT count(*) FROM security_audit_events
		WHERE event_type = 'design_working_copy_materials_reconciled'
		  AND details->>'furniture_instance_id' = $1`, fiHist).Scan(&auditCount); err != nil {
		t.Fatalf("audit read: %v", err)
	}
	if auditCount != 1 {
		t.Fatalf("audit events for fiHist = %d, want exactly 1 (retry must not audit)", auditCount)
	}

	// ── Historical proof: R1..R3 stay logically unchanged…
	for i, revID := range revisions {
		if got := designRevisionItemsSnapshot(t, fx.admin, revID); len(got) != len(frozenHistory[revID]) {
			t.Fatalf("R%d item count changed", i+1)
		} else {
			for fiID, frozen := range frozenHistory[revID] {
				if got[fiID] != frozen {
					t.Fatalf("R%d history mutated for %s:\nfrozen=%q\ngot   =%q", i+1, fiID, frozen, got[fiID])
				}
			}
		}
	}

	// …and the NEXT publish (R4) is the first revision carrying the choices.
	var revR4ID string
	err = fiTx(t, fx.store, actorA, func(txCtx context.Context) error {
		rev, txErr := fx.store.PublishDesignRevision(txCtx, storage.PublishDesignRevisionCommand{
			DesignID: designID, BaseRevisionID: revisions[len(revisions)-1],
			SourceType: domain.DesignRevisionSourceSketchup, ActorUserID: rlsUserA,
		})
		if txErr != nil {
			return txErr
		}
		if rev.RevisionNumber != 4 {
			t.Fatalf("expected R4, got %d", rev.RevisionNumber)
		}
		revR4ID = rev.ID
		return nil
	})
	if err != nil {
		t.Fatalf("publish R4: %v", err)
	}
	r4 := designRevisionItemsSnapshot(t, fx.admin, revR4ID)
	if !strings.Contains(r4[fiHist], matProvenanceFront) || !strings.Contains(r4[fiHist], matProvenanceInterior) {
		t.Fatalf("R4 fiHist must carry the reconciled choices, got %q", r4[fiHist])
	}
	// Final negative: R1..R3 STILL unchanged after the R4 publish.
	for i, revID := range revisions {
		got := designRevisionItemsSnapshot(t, fx.admin, revID)
		for fiID, frozen := range frozenHistory[revID] {
			if got[fiID] != frozen {
				t.Fatalf("post-R4: R%d history mutated for %s", i+1, fiID)
			}
		}
	}
}

// fiTxAnd runs a store read inside one tenant transaction and returns the value.
func fiTxAnd[T any](t *testing.T, fx *rlsFixture, actor storage.TenantActor, run func(ctx context.Context) (T, error)) (T, error) {
	t.Helper()
	var out T
	err := fiTx(t, fx.store, actor, func(ctx context.Context) error {
		value, txErr := run(ctx)
		if txErr == nil {
			out = value
		}
		return txErr
	})
	return out, err
}

func workingCopyState(t *testing.T, fx *rlsFixture, designID string) string {
	t.Helper()
	var items string
	if err := fx.admin.QueryRow(context.Background(), `
		SELECT string_agg(furniture_instance_id::text || '=' || material_choices::text, ',' ORDER BY furniture_instance_id)
		FROM design_working_items WHERE design_id = $1`, designID).Scan(&items); err != nil {
		t.Fatalf("read working copy items: %v", err)
	}
	// The header carries the working-copy version: a no-op retry must leave
	// updated_at/updated_by untouched too, not only the item rows.
	var header string
	if err := fx.admin.QueryRow(context.Background(), `
		SELECT updated_at::text || '/' || updated_by
		FROM design_working_copies WHERE design_id = $1`, designID).Scan(&header); err != nil {
		t.Fatalf("read working copy header: %v", err)
	}
	return items + "@" + header
}

type storageRoleView struct {
	working, quoted, effective, provenance string
}
