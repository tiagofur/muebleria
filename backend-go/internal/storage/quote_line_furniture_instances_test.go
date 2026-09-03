package storage_test

import (
	"context"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #386 / DT-2: QuoteLine ↔ FurnitureInstance relation against real
// PostgreSQL under the app role. These tests pin the issue contract:
//
//   - quantity is commercial grouping, NEVER physical identity: qty 3 must
//     materialize 3 UNIQUE FurnitureInstance IDs (the negative proof — an
//     implementation reusing the line id for all units fails here);
//   - materialization is idempotent and convergent: retries (same or new
//     idempotency key) never duplicate units, concurrent commands still
//     converge to exactly `quantity`;
//   - draft increase adds only the delta and preserves existing identities;
//   - draft decrease retires the newest surplus units terminally
//     ('cancelled') and never recycles IDs (increase after decrease creates
//     NEW identities);
//   - accepted/produced quotes are immutable: materialization changes fail
//     typed (and RLS blocks direct SQL on the link table);
//   - cross-project links are structurally impossible (composite FKs);
//   - dropping a materialized quote line through the generic project edit
//     fails loud with a typed error (deferred FK as backstop);
//   - durable audit: materialization events commit with the mutation.

const (
	qlfiLineQty1     = "60000000-0000-0000-0000-000000000012"
	qlfiLineQty3     = "60000000-0000-0000-0000-000000000011"
	qlfiLineDynamic  = "60000000-0000-0000-0000-000000000013"
	qlfiAcceptedLine = "60000000-0000-0000-0000-000000000014"
	qlfiAcceptedProj = "40000000-0000-0000-0000-0000000000a1"
	qlfiProjectB     = "40000000-0000-0000-0000-000000000002" // owner org B (mirrors #385)
)

func quoteLineFurnitureMigrationSQL(t *testing.T) string {
	t.Helper()
	contents, err := os.ReadFile("../../db/migration/000112_quote_line_furniture_instances.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	return string(contents)
}

// The relation migration must apply both on a fresh database and on top of
// the #385 schema (upgrade fixture), with RLS, the deferred quote-line FK and
// the runtime grants from the first migration.
func TestQuoteLineFurniture_MigrationFreshAndUpgrade(t *testing.T) {
	ctx := context.Background()

	fresh := multiOrgFreshDB(t)
	identityApplyThrough(t, fresh, 112)
	assertQuoteLineFurnitureSchema(t, fresh)

	upgrade := multiOrgFreshDB(t)
	identityApplyThrough(t, upgrade, 111)
	if _, err := upgrade.Exec(ctx, quoteLineFurnitureMigrationSQL(t)); err != nil {
		t.Fatalf("upgrade apply 000112: %v", err)
	}
	assertQuoteLineFurnitureSchema(t, upgrade)
}

func assertQuoteLineFurnitureSchema(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()

	var classification, readScope, writeScope string
	if err := pool.QueryRow(ctx,
		`SELECT classification, read_scope, write_scope FROM rls_policy_inventory WHERE table_name='quote_line_furniture_instances'`,
	).Scan(&classification, &readScope, &writeScope); err != nil {
		t.Fatalf("inventory row: %v", err)
	}
	if classification != "explicitly-shared" || readScope != "project-organizations" ||
		writeScope != "owner-organization-while-draft-or-quoted" {
		t.Fatalf("inventory = (%q,%q,%q), want explicitly-shared owner-organization-while-draft-or-quoted",
			classification, readScope, writeScope)
	}

	var rls, forced bool
	if err := pool.QueryRow(ctx,
		`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='quote_line_furniture_instances'`,
	).Scan(&rls, &forced); err != nil {
		t.Fatalf("pg_class lookup: %v", err)
	}
	if !rls || !forced {
		t.Fatalf("RLS enabled=%v forced=%v, want both true", rls, forced)
	}

	policies := map[string]bool{}
	rows, err := pool.Query(ctx, `
		SELECT policyname FROM pg_policies
		WHERE schemaname='public' AND tablename='quote_line_furniture_instances'`)
	if err != nil {
		t.Fatalf("query policies: %v", err)
	}
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		policies[name] = true
	}
	rows.Close()
	for _, needed := range []string{"quote_line_furniture_read", "quote_line_furniture_insert", "quote_line_furniture_delete"} {
		if !policies[needed] {
			t.Fatalf("missing policy %s (have %v)", needed, policies)
		}
	}

	// The quote-line FK must be deferrable so replaceProjectItemsTx
	// (delete + re-insert with the same ids inside one transaction) keeps
	// working while still failing loud at COMMIT when a materialized line
	// disappears for good.
	var deferrable, deferred bool
	if err := pool.QueryRow(ctx, `
		SELECT condeferrable, condeferred FROM pg_constraint
		WHERE conrelid='quote_line_furniture_instances'::regclass
		  AND conname='fk_quote_line_furniture_instances_line'`).Scan(&deferrable, &deferred); err != nil {
		t.Fatalf("deferred FK lookup: %v", err)
	}
	if !deferrable || !deferred {
		t.Fatalf("quote-line FK deferrable=%v deferred=%v, want both true", deferrable, deferred)
	}

	// Composite anchors make cross-project links structurally impossible.
	for _, index := range []string{
		"uq_project_items_id_project",
		"uq_furniture_instances_id_project",
		"uq_quote_line_furniture_instances_instance",
	} {
		var exists bool
		if err := pool.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname=$1)`, index).Scan(&exists); err != nil || !exists {
			t.Fatalf("index %s exists=%v err=%v", index, exists, err)
		}
	}

	var executable bool
	if err := pool.QueryRow(ctx,
		`SELECT has_function_privilege('granete_app', 'app_project_quote_mutable(uuid)', 'EXECUTE')`).Scan(&executable); err != nil || !executable {
		t.Fatalf("app_project_quote_mutable executable by granete_app=%v err=%v", executable, err)
	}

	privileges := map[string]bool{}
	rows, err = pool.Query(ctx, `
		SELECT privilege_type FROM information_schema.table_privileges
		WHERE table_name='quote_line_furniture_instances' AND grantee='granete_app'`)
	if err != nil {
		t.Fatalf("query privileges: %v", err)
	}
	for rows.Next() {
		var privilege string
		if err := rows.Scan(&privilege); err != nil {
			t.Fatal(err)
		}
		privileges[privilege] = true
	}
	rows.Close()
	for _, needed := range []string{"SELECT", "INSERT", "DELETE"} {
		if !privileges[needed] {
			t.Fatalf("granete_app missing %s on quote_line_furniture_instances: %v", needed, privileges)
		}
	}
	// Links are immutable facts: no UPDATE grant at all.
	if privileges["UPDATE"] {
		t.Fatal("granete_app must not hold UPDATE on quote_line_furniture_instances")
	}
}

func seedQuoteLines(t *testing.T, fx *rlsFixture, projectID string, lines map[string]int) {
	t.Helper()
	ctx := context.Background()
	for lineID, quantity := range lines {
		if _, err := fx.admin.Exec(ctx, `
			INSERT INTO project_items (id, project_id, module_id, quantity, organization_id)
			VALUES ($1, $2, $3, $4, '`+rlsOrgA+`')`,
			lineID, projectID, fiModuleA, quantity); err != nil {
			t.Fatalf("seed quote line %s: %v", lineID, err)
		}
	}
}

func materialize(t *testing.T, fx *rlsFixture, actor storage.TenantActor, projectID, lineID string) (*domain.QuoteLineMaterialization, error) {
	t.Helper()
	var result *domain.QuoteLineMaterialization
	err := fiTx(t, fx.store, actor, func(ctx context.Context) error {
		var txErr error
		result, txErr = fx.store.MaterializeQuoteLine(ctx, storage.MaterializeQuoteLineCommand{
			ProjectID:   projectID,
			QuoteLineID: lineID,
			ActorUserID: actor.UserID,
			IP:          "203.0.113.20",
			RequestID:   "qlfi-test-" + lineID,
		})
		return txErr
	})
	return result, err
}

func listLinks(t *testing.T, fx *rlsFixture, actor storage.TenantActor, projectID, lineID string) ([]domain.QuoteLineFurnitureInstance, error) {
	t.Helper()
	var links []domain.QuoteLineFurnitureInstance
	err := fiTx(t, fx.store, actor, func(ctx context.Context) error {
		var txErr error
		links, txErr = fx.store.ListQuoteLineFurnitureInstances(ctx, projectID, lineID)
		return txErr
	})
	return links, err
}

func linkInstanceIDs(links []domain.QuoteLineFurnitureInstance) map[string]bool {
	ids := map[string]bool{}
	for _, link := range links {
		ids[link.FurnitureInstanceID] = true
	}
	return ids
}

func setLineQuantity(t *testing.T, fx *rlsFixture, lineID string, quantity int) {
	t.Helper()
	if _, err := fx.admin.Exec(context.Background(),
		`UPDATE project_items SET quantity=$1 WHERE id=$2`, quantity, lineID); err != nil {
		t.Fatal(err)
	}
}

func instanceLifecycle(t *testing.T, fx *rlsFixture, instanceID string) (string, int64) {
	t.Helper()
	var status string
	var version int64
	if err := fx.admin.QueryRow(context.Background(),
		`SELECT lifecycle_status, version FROM furniture_instances WHERE id=$1`, instanceID,
	).Scan(&status, &version); err != nil {
		t.Fatal(err)
	}
	return status, version
}

func TestQuoteLineFurniture_MaterializationLifecycleAndAudit(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := context.Background()
	if _, err := fx.admin.Exec(ctx, `
		INSERT INTO projects (id, name, customer_id, status, organization_id, sales_organization_id, manufacturing_organization_id)
		VALUES ('`+fiProjectAOnly+`', 'Org A private project', '30000000-0000-0000-0000-00000000000a', 'draft',
			'`+rlsOrgA+`', '`+rlsOrgA+`', '`+rlsOrgA+`')`); err != nil {
		t.Fatal(err)
	}
	seedQuoteLines(t, fx, fiSharedProject, map[string]int{
		qlfiLineQty3:    3,
		qlfiLineQty1:    1,
		qlfiLineDynamic: 2,
	})
	expectedAuditEvents := 0
	expectedInstanceCreations := 0

	// I2 — quantity is grouping, not identity: qty 3 must materialize THREE
	// UNIQUE physical identities, each linked explicitly to the line. An
	// implementation that represents the line with one shared identity (or
	// that derives identity from the line id / quantity / definition) fails
	// the distinctness assertion below.
	qty3, err := materialize(t, fx, fiActorA(), fiSharedProject, qlfiLineQty3)
	if err != nil {
		t.Fatalf("materialize qty3: %v", err)
	}
	if qty3.Quantity != 3 || len(qty3.Instances) != 3 || len(qty3.CreatedInstanceIDs) != 3 {
		t.Fatalf("qty3 result: quantity=%d instances=%d created=%d", qty3.Quantity, len(qty3.Instances), len(qty3.CreatedInstanceIDs))
	}
	if len(linkInstanceIDs(qty3.Instances)) != 3 {
		t.Fatalf("qty3 collapsed physical identities: %v", linkInstanceIDs(qty3.Instances))
	}
	for _, link := range qty3.Instances {
		instance := link.FurnitureInstance
		if link.QuoteLineID != qlfiLineQty3 || link.FurnitureInstanceID != instance.ID {
			t.Fatalf("link shape: %+v", link)
		}
		if instance.ProjectID != fiSharedProject || instance.OrganizationID != rlsOrgA ||
			instance.Origin != domain.FurnitureInstanceOriginQuote ||
			instance.FurnitureDefinitionID != fiModuleA ||
			instance.LifecycleStatus != domain.FurnitureInstanceLifecycleActive || instance.Version != 1 {
			t.Fatalf("materialized instance state: %+v", instance)
		}
	}
	qty3IDs := linkInstanceIDs(qty3.Instances)
	expectedAuditEvents++
	expectedInstanceCreations += 3

	// Idempotency (convergence): a second run is a no-op — same identities,
	// nothing created/cancelled/unlinked.
	replay, err := materialize(t, fx, fiActorA(), fiSharedProject, qlfiLineQty3)
	if err != nil {
		t.Fatalf("materialize replay: %v", err)
	}
	if len(replay.CreatedInstanceIDs) != 0 || len(replay.CancelledInstanceIDs) != 0 || len(replay.UnlinkedInstanceIDs) != 0 {
		t.Fatalf("replay mutated: created=%v cancelled=%v unlinked=%v",
			replay.CreatedInstanceIDs, replay.CancelledInstanceIDs, replay.UnlinkedInstanceIDs)
	}
	if len(linkInstanceIDs(replay.Instances)) != 3 {
		t.Fatalf("replay instances: %v", linkInstanceIDs(replay.Instances))
	}
	for id := range linkInstanceIDs(replay.Instances) {
		if !qty3IDs[id] {
			t.Fatalf("replay replaced identity %s", id)
		}
	}

	// qty 1 → exactly one identity, distinct from the qty-3 ones.
	qty1, err := materialize(t, fx, fiActorA(), fiSharedProject, qlfiLineQty1)
	if err != nil {
		t.Fatalf("materialize qty1: %v", err)
	}
	if len(qty1.Instances) != 1 || len(qty1.CreatedInstanceIDs) != 1 {
		t.Fatalf("qty1 instances=%d created=%d, want 1/1", len(qty1.Instances), len(qty1.CreatedInstanceIDs))
	}
	if qty3IDs[qty1.Instances[0].FurnitureInstanceID] {
		t.Fatal("qty1 identity collides with qty3 line identities")
	}
	expectedAuditEvents++
	expectedInstanceCreations++

	// The line must belong to the requested project; a random or foreign
	// line is indistinguishable from a missing one.
	if _, err := materialize(t, fx, fiActorA(), fiProjectAOnly, qlfiLineQty3); !errors.Is(err, storage.ErrQuoteLineNotFound) {
		t.Fatalf("wrong project err=%v, want ErrQuoteLineNotFound", err)
	}
	if _, err := materialize(t, fx, fiActorA(), fiSharedProject, "6ffffff0-0000-0000-0000-000000000f0f"); !errors.Is(err, storage.ErrQuoteLineNotFound) {
		t.Fatalf("random line err=%v, want ErrQuoteLineNotFound", err)
	}

	// Explicitly-shared read scope: the manufacturing organization (B) of the
	// shared project reads the relation, but materialization stays with the
	// owning organization (A).
	linksB, err := listLinks(t, fx, fiActorB(), fiSharedProject, qlfiLineQty3)
	if err != nil || len(linksB) != 3 {
		t.Fatalf("manufacturing org list: (%d, %v), want 3 links", len(linksB), err)
	}
	if _, err := materialize(t, fx, fiActorB(), fiSharedProject, qlfiLineQty3); !errors.Is(err, domain.ErrFurnitureInstanceProjectNotWritable) {
		t.Fatalf("non-owner materialize err=%v, want ErrFurnitureInstanceProjectNotWritable", err)
	}

	// Draft increase 2 → 4: existing identities preserved, only the delta
	// (2 new) materialized.
	increase, err := materialize(t, fx, fiActorA(), fiSharedProject, qlfiLineDynamic)
	if err != nil {
		t.Fatalf("materialize dynamic initial: %v", err)
	}
	expectedAuditEvents++
	expectedInstanceCreations += 2
	beforeIncrease := linkInstanceIDs(increase.Instances)
	if len(beforeIncrease) != 2 {
		t.Fatalf("dynamic initial instances=%d, want 2", len(beforeIncrease))
	}

	setLineQuantity(t, fx, qlfiLineDynamic, 4)
	increased, err := materialize(t, fx, fiActorA(), fiSharedProject, qlfiLineDynamic)
	if err != nil {
		t.Fatalf("materialize increase: %v", err)
	}
	if len(increased.CreatedInstanceIDs) != 2 || len(increased.Instances) != 4 {
		t.Fatalf("increase created=%d instances=%d, want 2/4", len(increased.CreatedInstanceIDs), len(increased.Instances))
	}
	if increased.Instances[0].FurnitureInstanceID != increase.Instances[0].FurnitureInstanceID ||
		increased.Instances[1].FurnitureInstanceID != increase.Instances[1].FurnitureInstanceID {
		t.Fatalf("increase did not preserve the earliest identities: %v", linkInstanceIDs(increased.Instances))
	}
	for _, id := range increased.CreatedInstanceIDs {
		if beforeIncrease[id] {
			t.Fatalf("increase re-linked existing identity %s", id)
		}
	}
	increaseNewIDs := append([]string{}, increased.CreatedInstanceIDs...)
	expectedAuditEvents++
	expectedInstanceCreations += 2

	// Draft decrease 4 → 2: the NEWEST surplus units are retired terminally
	// ('cancelled', never deleted) and unlinked; the earliest identities
	// survive in place.
	setLineQuantity(t, fx, qlfiLineDynamic, 2)
	decreased, err := materialize(t, fx, fiActorA(), fiSharedProject, qlfiLineDynamic)
	if err != nil {
		t.Fatalf("materialize decrease: %v", err)
	}
	if len(decreased.CancelledInstanceIDs) != 2 || len(decreased.Instances) != 2 {
		t.Fatalf("decrease cancelled=%d instances=%d, want 2/2", len(decreased.CancelledInstanceIDs), len(decreased.Instances))
	}
	cancelledSet := map[string]bool{}
	for _, id := range decreased.CancelledInstanceIDs {
		cancelledSet[id] = true
	}
	for _, id := range increaseNewIDs {
		if !cancelledSet[id] {
			t.Fatalf("decrease retired a pre-existing identity %s instead of the newest surplus", id)
		}
	}
	if decreased.Instances[0].FurnitureInstanceID != increase.Instances[0].FurnitureInstanceID ||
		decreased.Instances[1].FurnitureInstanceID != increase.Instances[1].FurnitureInstanceID {
		t.Fatalf("decrease changed surviving identities: %v", linkInstanceIDs(decreased.Instances))
	}
	for _, id := range decreased.CancelledInstanceIDs {
		status, version := instanceLifecycle(t, fx, id)
		if status != string(domain.FurnitureInstanceLifecycleCancelled) || version != 2 {
			t.Fatalf("cancelled identity %s: status=%s version=%d, want cancelled/2", id, status, version)
		}
	}
	expectedAuditEvents++

	// Identity is never recycled: increasing again creates NEW identities —
	// the cancelled IDs may never reappear.
	setLineQuantity(t, fx, qlfiLineDynamic, 4)
	recycled, err := materialize(t, fx, fiActorA(), fiSharedProject, qlfiLineDynamic)
	if err != nil {
		t.Fatalf("materialize after decrease: %v", err)
	}
	if len(recycled.CreatedInstanceIDs) != 2 {
		t.Fatalf("post-decrease increase created=%d, want 2", len(recycled.CreatedInstanceIDs))
	}
	for _, link := range recycled.Instances {
		if cancelledSet[link.FurnitureInstanceID] {
			t.Fatalf("cancelled identity %s was recycled", link.FurnitureInstanceID)
		}
	}
	expectedAuditEvents++
	expectedInstanceCreations += 2

	// A linked instance removed explicitly (:remove) no longer represents a
	// quoted unit: the stale link is unlinked and the quantity covered again
	// with a NEW identity (the removed one is terminal, never reused).
	removedID := recycled.Instances[0].FurnitureInstanceID
	if _, err := fx.admin.Exec(ctx,
		`UPDATE furniture_instances SET lifecycle_status='removed', version=version+1 WHERE id=$1`, removedID); err != nil {
		t.Fatal(err)
	}
	afterRemove, err := materialize(t, fx, fiActorA(), fiSharedProject, qlfiLineDynamic)
	if err != nil {
		t.Fatalf("materialize after explicit remove: %v", err)
	}
	unlinkedSet := map[string]bool{}
	for _, id := range afterRemove.UnlinkedInstanceIDs {
		unlinkedSet[id] = true
	}
	if !unlinkedSet[removedID] {
		t.Fatalf("stale link to removed instance not unlinked: %v", afterRemove.UnlinkedInstanceIDs)
	}
	if len(afterRemove.Instances) != 4 {
		t.Fatalf("instances after remove-cleanup: %d, want 4", len(afterRemove.Instances))
	}
	for _, link := range afterRemove.Instances {
		if link.FurnitureInstanceID == removedID {
			t.Fatal("removed instance still represents a quoted unit")
		}
	}
	expectedAuditEvents++
	expectedInstanceCreations++

	// Accepted quote immutability (I3): once the project's commercial truth is
	// pinned (accepted, and likewise produced), materialization changes fail
	// typed in BOTH directions — later changes require a new revision.
	if _, err := fx.admin.Exec(ctx, `
		INSERT INTO projects (id, name, customer_id, status, organization_id, sales_organization_id, manufacturing_organization_id)
		VALUES ('`+qlfiAcceptedProj+`', 'Accepted A', '30000000-0000-0000-0000-00000000000a', 'draft',
			'`+rlsOrgA+`', '`+rlsOrgA+`', '`+rlsOrgA+`')`); err != nil {
		t.Fatal(err)
	}
	seedQuoteLines(t, fx, qlfiAcceptedProj, map[string]int{qlfiAcceptedLine: 2})
	if _, err := materialize(t, fx, fiActorA(), qlfiAcceptedProj, qlfiAcceptedLine); err != nil {
		t.Fatalf("materialize accepted-project line while draft: %v", err)
	}
	expectedAuditEvents++
	for _, status := range []string{"accepted", "produced"} {
		if _, err := fx.admin.Exec(ctx, `UPDATE projects SET status=$1 WHERE id=$2`, status, qlfiAcceptedProj); err != nil {
			t.Fatal(err)
		}
		setLineQuantity(t, fx, qlfiAcceptedLine, 1) // would be a decrease
		if _, err := materialize(t, fx, fiActorA(), qlfiAcceptedProj, qlfiAcceptedLine); !errors.Is(err, domain.ErrQuoteRevisionAccepted) {
			t.Fatalf("accepted decrease err=%v, want ErrQuoteRevisionAccepted", err)
		}
		setLineQuantity(t, fx, qlfiAcceptedLine, 3) // would be an increase
		if _, err := materialize(t, fx, fiActorA(), qlfiAcceptedProj, qlfiAcceptedLine); !errors.Is(err, domain.ErrQuoteRevisionAccepted) {
			t.Fatalf("accepted increase err=%v, want ErrQuoteRevisionAccepted", err)
		}
	}
	// The accepted revision's link state stays intact: 2 units, still linked.
	acceptedLinks, err := listLinks(t, fx, fiActorA(), qlfiAcceptedProj, qlfiAcceptedLine)
	if err != nil || len(acceptedLinks) != 2 {
		t.Fatalf("accepted links: (%d, %v), want 2 intact", len(acceptedLinks), err)
	}

	// A quote line that still represents materialized units cannot be
	// deleted or dropped by a generic project edit: fail loud, typed.
	err = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		return fx.store.RemoveProjectItem(ctx, fiSharedProject, qlfiLineQty3)
	})
	if !errors.Is(err, domain.ErrQuoteLineStillMaterialized) {
		t.Fatalf("remove materialized item err=%v, want ErrQuoteLineStillMaterialized", err)
	}
	err = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		project, getErr := fx.store.GetProjectByID(ctx, fiSharedProject)
		if getErr != nil {
			return getErr
		}
		// Same payload (same item ids): the deferred FK keeps the replace
		// working — materialized lines survive a normal project edit.
		if err := fx.store.UpdateProject(ctx, fiSharedProject, project); err != nil {
			return err
		}
		// Dropping the materialized line from the payload: typed conflict.
		kept := project.Items[:0]
		for _, item := range project.Items {
			if item.ID != qlfiLineQty3 {
				kept = append(kept, item)
			}
		}
		project.Items = kept
		return fx.store.UpdateProject(ctx, fiSharedProject, project)
	})
	if !errors.Is(err, domain.ErrQuoteLineStillMaterialized) {
		t.Fatalf("replace dropping materialized line err=%v, want ErrQuoteLineStillMaterialized", err)
	}
	// The line and its links are intact after the rejected edits.
	linksAfterEdit, err := listLinks(t, fx, fiActorA(), fiSharedProject, qlfiLineQty3)
	if err != nil || len(linksAfterEdit) != 3 {
		t.Fatalf("links after rejected edits: (%d, %v), want 3 intact", len(linksAfterEdit), err)
	}

	// Deferred-FK backstop (direct SQL, admin): delete + re-insert with the
	// same id inside one transaction passes; delete without re-insert fails
	// at COMMIT — links can never dangle silently.
	tx, err := fx.admin.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM project_items WHERE id=$1`, qlfiLineQty1); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO project_items (id, project_id, module_id, quantity, organization_id)
		VALUES ($1, $2, $3, 1, $4)`, qlfiLineQty1, fiSharedProject, fiModuleA, rlsOrgA); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("same-id replace must pass the deferred FK: %v", err)
	}
	tx, err = fx.admin.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM project_items WHERE id=$1`, qlfiLineQty1); err != nil {
		t.Fatal(err)
	}
	commitErr := tx.Commit(ctx)
	if commitErr == nil || !strings.Contains(commitErr.Error(), "fk_quote_line_furniture_instances_line") {
		t.Fatalf("dropping a materialized line must fail at COMMIT, got: %v", commitErr)
	}

	// Cross-project links are structurally impossible (composite FKs): a
	// line of project A can never be paired with project B's row, and an
	// instance of another project can never be linked to this line.
	var foreignInstance string
	if err := fx.admin.QueryRow(ctx, `
		INSERT INTO furniture_instances (organization_id, project_id, furniture_definition_id, origin)
		VALUES ($1, $2, $3, 'manual')
		RETURNING id::text`, rlsOrgA, fiProjectAOnly, fiModuleA).Scan(&foreignInstance); err != nil {
		t.Fatal(err)
	}
	if _, err := fx.admin.Exec(ctx, `
		INSERT INTO quote_line_furniture_instances (organization_id, project_id, quote_line_id, furniture_instance_id)
		VALUES ($1, $2, $3, $4)`, rlsOrgA, fiProjectAOnly, qlfiLineQty3, qty3.Instances[0].FurnitureInstanceID); err == nil {
		t.Fatal("line of another project must fail the composite FK")
	}
	if _, err := fx.admin.Exec(ctx, `
		INSERT INTO quote_line_furniture_instances (organization_id, project_id, quote_line_id, furniture_instance_id)
		VALUES ($1, $2, $3, $4)`, rlsOrgA, fiSharedProject, qlfiLineQty3, foreignInstance); err == nil {
		t.Fatal("instance of another project must fail the composite FK")
	}

	// Durable audit: every mutating materialization wrote its event in the
	// same tenant transaction, with actor/org and exact id lists.
	rows, err := fx.admin.Query(ctx, `
		SELECT event_type, details->>'quote_line_id', actor_user_id::text, organization_id::text
		FROM security_audit_events
		WHERE event_type = 'quote_line_furniture_materialized'
		ORDER BY created_at, id`)
	if err != nil {
		t.Fatalf("query audit: %v", err)
	}
	defer rows.Close()
	events := 0
	for rows.Next() {
		var eventType, lineID, actorID, orgID string
		if err := rows.Scan(&eventType, &lineID, &actorID, &orgID); err != nil {
			t.Fatal(err)
		}
		events++
		if !isValidTestUUID(lineID) || actorID != rlsUserA || orgID != rlsOrgA {
			t.Fatalf("audit event fields: line=%s actor=%s org=%s", lineID, actorID, orgID)
		}
	}
	if events != expectedAuditEvents {
		t.Fatalf("quote_line_furniture_materialized events=%d, want %d", events, expectedAuditEvents)
	}
	var createdEvents int
	if err := fx.admin.QueryRow(ctx, `
		SELECT count(*) FROM security_audit_events
		WHERE event_type='furniture_instance_created'
		  AND details->>'project_id' = $1`, fiSharedProject).Scan(&createdEvents); err != nil {
		t.Fatal(err)
	}
	if createdEvents != expectedInstanceCreations {
		t.Fatalf("furniture_instance_created events=%d, want %d (one per materialized unit)", createdEvents, expectedInstanceCreations)
	}
}

// Concurrent materializations of the same line (different idempotency keys,
// so the HTTP layer cannot dedupe them) must still converge to exactly
// `quantity` units: the advisory transaction lock serializes the command.
func TestQuoteLineFurniture_ConcurrentMaterializationConverges(t *testing.T) {
	fx := newRLSFixture(t)
	seedQuoteLines(t, fx, fiSharedProject, map[string]int{qlfiLineQty3: 3})

	var wg sync.WaitGroup
	results := make([]*domain.QuoteLineMaterialization, 2)
	errs := make([]error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(slot int) {
			defer wg.Done()
			results[slot], errs[slot] = materialize(t, fx, fiActorA(), fiSharedProject, qlfiLineQty3)
		}(i)
	}
	wg.Wait()
	for slot, err := range errs {
		if err != nil {
			t.Fatalf("concurrent materialize %d: %v", slot, err)
		}
	}
	createdTotal := len(results[0].CreatedInstanceIDs) + len(results[1].CreatedInstanceIDs)
	if createdTotal != 3 {
		t.Fatalf("concurrent runs created %d units, want exactly 3", createdTotal)
	}
	var activeLinks int
	if err := fx.admin.QueryRow(context.Background(), `
		SELECT count(*) FROM quote_line_furniture_instances qli
		JOIN furniture_instances fi ON fi.id = qli.furniture_instance_id
		WHERE qli.quote_line_id = $1 AND fi.lifecycle_status = 'active'`, qlfiLineQty3).Scan(&activeLinks); err != nil {
		t.Fatal(err)
	}
	if activeLinks != 3 {
		t.Fatalf("active links after concurrent runs=%d, want exactly 3", activeLinks)
	}
}

// TestTenantRLS_QuoteLineFurnitureDirectSQLCrossOrg pins the #386 negative
// proofs at the storage boundary: with the real app DB role, a deliberately
// unfiltered query cannot read or mutate another organization's links, links
// of an accepted project are immutable even by direct SQL, and link
// mutations stay with the owning organization (not the manufacturing
// counterpart).
func TestTenantRLS_QuoteLineFurnitureDirectSQLCrossOrg(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := context.Background()

	seed := []string{
		`INSERT INTO projects (id, name, customer_id, status, organization_id, sales_organization_id, manufacturing_organization_id)
		 VALUES
			('` + qlfiProjectB + `', 'Org B own project', '30000000-0000-0000-0000-00000000000b', 'draft',
			 '` + rlsOrgB + `', '` + rlsOrgB + `', '` + rlsOrgB + `'),
			('` + qlfiAcceptedProj + `', 'Accepted A', '30000000-0000-0000-0000-00000000000a', 'accepted',
			 '` + rlsOrgA + `', '` + rlsOrgA + `', '` + rlsOrgA + `')`,
		`INSERT INTO modules (id, code, name, organization_id) VALUES
			('50000000-0000-0000-0000-000000000002', 'RLS-MODULE-B', 'RLS module B', '` + rlsOrgB + `')`,
		`INSERT INTO project_items (id, project_id, module_id, quantity, organization_id) VALUES
			('` + qlfiAcceptedLine + `', '` + qlfiAcceptedProj + `', '` + fiModuleA + `', 1, '` + rlsOrgA + `'),
			('60000000-0000-0000-0000-000000000021', '` + qlfiProjectB + `', '50000000-0000-0000-0000-000000000002', 1, '` + rlsOrgB + `')`,
		`INSERT INTO furniture_instances (id, organization_id, project_id, origin) VALUES
			('51000000-0000-0000-0000-000000000021', '` + rlsOrgA + `', '` + qlfiAcceptedProj + `', 'quote'),
			('51000000-0000-0000-0000-000000000022', '` + rlsOrgA + `', '` + fiSharedProject + `', 'quote'),
			('51000000-0000-0000-0000-000000000023', '` + rlsOrgB + `', '` + qlfiProjectB + `', 'quote')`,
		`INSERT INTO quote_line_furniture_instances (organization_id, project_id, quote_line_id, furniture_instance_id) VALUES
			('` + rlsOrgA + `', '` + qlfiAcceptedProj + `', '` + qlfiAcceptedLine + `', '51000000-0000-0000-0000-000000000021'),
			('` + rlsOrgA + `', '` + fiSharedProject + `', '60000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000022'),
			('` + rlsOrgB + `', '` + qlfiProjectB + `', '60000000-0000-0000-0000-000000000021', '51000000-0000-0000-0000-000000000023')`,
	}
	for _, statement := range seed {
		if _, err := fx.admin.Exec(ctx, statement); err != nil {
			t.Fatalf("seed: %v\n%s", err, statement)
		}
	}

	withRLSActor(t, fx.app, rlsOrgA, rlsUserA, func(tx pgx.Tx) {
		// PostgreSQL aborts a transaction after a failed statement, so every
		// expected-failure probe runs inside its own savepoint.
		expectFail := func(label, sql string, args ...any) {
			t.Helper()
			if _, err := tx.Exec(ctx, `SAVEPOINT qlfi_expect_fail`); err != nil {
				t.Fatalf("%s: savepoint: %v", label, err)
			}
			if _, err := tx.Exec(ctx, sql, args...); err == nil {
				t.Fatalf("%s: expected RLS rejection, got success", label)
			}
			if _, err := tx.Exec(ctx, `ROLLBACK TO SAVEPOINT qlfi_expect_fail`); err != nil {
				t.Fatalf("%s: rollback to savepoint: %v", label, err)
			}
		}

		// Deliberately unfiltered SELECT: RLS keeps org B's link invisible;
		// org A sees its own projects (shared draft + accepted) only.
		var ids []string
		rows, err := tx.Query(ctx, `SELECT quote_line_id::text FROM quote_line_furniture_instances ORDER BY quote_line_id`)
		if err != nil {
			t.Fatalf("unfiltered select: %v", err)
		}
		for rows.Next() {
			var id string
			_ = rows.Scan(&id)
			ids = append(ids, id)
		}
		rows.Close()
		if len(ids) != 2 {
			t.Fatalf("unfiltered SELECT leaked foreign links: %v", ids)
		}

		// Accepted quote immutability at the storage boundary: no link rows
		// may be added to or removed from the accepted project, even by the
		// owning organization's app role.
		expectFail("insert into accepted project", `
			INSERT INTO quote_line_furniture_instances (organization_id, project_id, quote_line_id, furniture_instance_id)
			VALUES ($1, $2, $3, $4)`,
			rlsOrgA, qlfiAcceptedProj, qlfiAcceptedLine, "51000000-0000-0000-0000-000000000021")
		if tag, err := tx.Exec(ctx,
			`DELETE FROM quote_line_furniture_instances WHERE quote_line_id=$1`, qlfiAcceptedLine,
		); err != nil || tag.RowsAffected() != 0 {
			t.Fatalf("delete on accepted project: rows=%d err=%v, want 0 (immutable quote)", tag.RowsAffected(), err)
		}

		// Cross-org: inserting into org B's project or mis-owning a row in a
		// visible shared project fails the WITH CHECK.
		expectFail("insert into foreign-org project", `
			INSERT INTO quote_line_furniture_instances (organization_id, project_id, quote_line_id, furniture_instance_id)
			VALUES ($1, $2, $3, $4)`,
			rlsOrgA, qlfiProjectB, "60000000-0000-0000-0000-000000000021", "51000000-0000-0000-0000-000000000023")
		expectFail("insert with wrong owning organization", `
			INSERT INTO quote_line_furniture_instances (organization_id, project_id, quote_line_id, furniture_instance_id)
			VALUES ($1, $2, $3, $4)`,
			rlsOrgB, fiSharedProject, "60000000-0000-0000-0000-000000000001", "51000000-0000-0000-0000-000000000022")
		// UPDATE is not granted at all: links are immutable facts.
		expectFail("update link", `UPDATE quote_line_furniture_instances SET quote_line_id=$1`, qlfiAcceptedLine)
		// Cross-org DELETE touches nothing even without a tenant filter.
		if tag, err := tx.Exec(ctx,
			`DELETE FROM quote_line_furniture_instances WHERE quote_line_id=$1`, "60000000-0000-0000-0000-000000000021",
		); err != nil || tag.RowsAffected() != 0 {
			t.Fatalf("cross-org delete: rows=%d err=%v, want 0", tag.RowsAffected(), err)
		}

		// The owner-org draft path stays open: link a freshly created
		// instance inside the same transaction (rolled back by the fixture).
		var fresh string
		if err := tx.QueryRow(ctx, `
			INSERT INTO furniture_instances (organization_id, project_id, origin)
			VALUES ($1, $2, 'quote')
			RETURNING id::text`, rlsOrgA, fiSharedProject).Scan(&fresh); err != nil {
			t.Fatalf("owner draft insert instance: %v", err)
		}
		if tag, err := tx.Exec(ctx, `
			INSERT INTO quote_line_furniture_instances (organization_id, project_id, quote_line_id, furniture_instance_id)
			VALUES ($1, $2, $3, $4)`,
			rlsOrgA, fiSharedProject, "60000000-0000-0000-0000-000000000001", fresh); err != nil || tag.RowsAffected() != 1 {
			t.Fatalf("owner draft link insert: rows=%d err=%v, want 1", tag.RowsAffected(), err)
		}
	})

	// The manufacturing organization (B) of the shared project READS the
	// relation but can neither delete nor add links (owner-only mutations).
	withRLSActor(t, fx.app, rlsOrgB, rlsUserB, func(tx pgx.Tx) {
		var count int
		if err := tx.QueryRow(ctx,
			`SELECT count(*) FROM quote_line_furniture_instances`).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count < 1 {
			t.Fatalf("manufacturing org must read the shared project links, saw %d", count)
		}
		if tag, err := tx.Exec(ctx,
			`DELETE FROM quote_line_furniture_instances WHERE project_id=$1`, fiSharedProject,
		); err != nil || tag.RowsAffected() != 0 {
			t.Fatalf("non-owner delete: rows=%d err=%v, want 0", tag.RowsAffected(), err)
		}
		if _, err := tx.Exec(ctx, `SAVEPOINT qlfi_expect_fail`); err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO quote_line_furniture_instances (organization_id, project_id, quote_line_id, furniture_instance_id)
			VALUES ($1, $2, $3, $4)`,
			rlsOrgA, fiSharedProject, "60000000-0000-0000-0000-000000000001", "51000000-0000-0000-0000-000000000022"); err == nil {
			t.Fatal("non-owner insert into shared project must fail RLS WITH CHECK")
		}
		if _, err := tx.Exec(ctx, `ROLLBACK TO SAVEPOINT qlfi_expect_fail`); err != nil {
			t.Fatal(err)
		}
	})
}
