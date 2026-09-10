package storage_test

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	migrationQuoteOrg            = "a1000000-0000-0000-0000-000000000001"
	migrationQuoteCustomer       = "a2000000-0000-0000-0000-000000000001"
	migrationQuoteProject        = "a3000000-0000-0000-0000-000000000001"
	validQuoteCommercialEnvelope = `{"schema":"granete.quote-commercial-snapshot.v1","capturedAt":"2026-09-10T12:00:00Z","currency":"MXN","customer":{"id":"c","name":"Customer"},"project":{"id":"p","name":"Project"},"breakdown":{"materials_cost":10,"edge_total":2,"hardware_total":3,"direct_cost":15,"labor_modular":5,"labor_fixed_cost":7,"margin_factor":1.5,"sale_price":27},"lines":[{"quoteLineId":"62000000-0000-0000-0000-000000000001","quantity":1,"furnitureInstanceIds":["72000000-0000-0000-0000-000000000001"],"amounts":{"materialsCost":10,"edgeTotal":2,"hardwareTotal":3,"directCost":15,"laborModular":5,"salePrice":20}}],"units":[{"furnitureInstanceId":"72000000-0000-0000-0000-000000000001","quoteLineId":"62000000-0000-0000-0000-000000000001","moduleCode":"M","moduleName":"Module","lifecycleStatus":"active","options":[]}]}`
)

func applyQuoteCommercial130(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	up, err := os.ReadFile("../../db/migration/000130_quote_commercial_snapshot.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(context.Background(), string(up)); err != nil {
		t.Fatalf("apply migration 130: %v", err)
	}
}

func seedQuoteMigrationProject(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	multiOrgExec(t, pool, `
		INSERT INTO organizations (id, name, slug, status) VALUES ('`+migrationQuoteOrg+`', 'Mig Org', 'mig-org', 'provisioning');
		INSERT INTO customers (id, name, organization_id) VALUES ('`+migrationQuoteCustomer+`', 'Mig Customer', '`+migrationQuoteOrg+`');
		INSERT INTO projects (id, name, customer_id, status, organization_id) VALUES ('`+migrationQuoteProject+`', 'Mig Project', '`+migrationQuoteCustomer+`', 'draft', '`+migrationQuoteOrg+`');`)
}

func assertQuoteCommercial130Posture(t *testing.T, pool *pgxpool.Pool) int {
	t.Helper()
	ctx := context.Background()
	for _, column := range []string{"commercial_snapshot", "published_at", "accepted_at"} {
		var exists bool
		if err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='quote_revisions' AND column_name=$1)`, column).Scan(&exists); err != nil || !exists {
			t.Fatalf("missing quote_revisions.%s: %v", column, err)
		}
	}
	var rationale string
	var version int
	if err := pool.QueryRow(ctx, `SELECT rationale, policy_version FROM rls_policy_inventory WHERE table_name='quote_revisions'`).Scan(&rationale, &version); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(rationale, "#642") || !strings.Contains(rationale, "commercial authority") {
		t.Fatalf("policy rationale=%q", rationale)
	}
	var rls, forced bool
	if err := pool.QueryRow(ctx, `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='quote_revisions'`).Scan(&rls, &forced); err != nil || !rls || !forced {
		t.Fatalf("RLS=%v FORCE=%v err=%v", rls, forced, err)
	}
	return version
}

func TestQuoteCommercialSnapshotMigrationFreshAndDirectSQLValidation(t *testing.T) {
	pool := multiOrgFreshDB(t)
	identityApplyThrough(t, pool, 130)
	assertQuoteCommercial130Posture(t, pool)
	seedQuoteMigrationProject(t, pool)
	ctx := context.Background()

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `SET LOCAL ROLE granete_app`); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `SELECT set_config('app.organization_id',$1,true), set_config('app.user_id',$2,true)`, migrationQuoteOrg, "a5000000-0000-0000-0000-000000000001"); err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(ctx, `INSERT INTO quote_revisions (id, organization_id, project_id, revision_number, status)
		VALUES ('a4000000-0000-0000-0000-000000000001',$1,$2,1,'draft')`, migrationQuoteOrg, migrationQuoteProject)
	if err == nil || !strings.Contains(err.Error(), "requires commercial_snapshot") {
		t.Fatalf("app-role post-migration NULL insert must be rejected, got %v", err)
	}
	_ = tx.Rollback(ctx)

	tx, err = pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `SET LOCAL ROLE granete_app`); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `SELECT set_config('app.organization_id',$1,true), set_config('app.user_id',$2,true)`, migrationQuoteOrg, "a5000000-0000-0000-0000-000000000001"); err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(ctx, `INSERT INTO quote_revisions (id, organization_id, project_id, revision_number, status, commercial_snapshot)
		VALUES ('a4000000-0000-0000-0000-000000000002',$1,$2,2,'draft','{"schema":"wrong"}'::jsonb)`, migrationQuoteOrg, migrationQuoteProject)
	if err == nil || !strings.Contains(err.Error(), "not a valid") {
		t.Fatalf("app-role malformed insert must be rejected, got %v", err)
	}
	_ = tx.Rollback(ctx)

	tx, err = pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SET LOCAL ROLE granete_app`); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `SELECT set_config('app.organization_id',$1,true), set_config('app.user_id',$2,true)`, migrationQuoteOrg, "a5000000-0000-0000-0000-000000000001"); err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(ctx, `INSERT INTO quote_revisions (id, organization_id, project_id, revision_number, status, commercial_snapshot)
		VALUES ('a4000000-0000-0000-0000-000000000003',$1,$2,3,'accepted',$3::jsonb)`, migrationQuoteOrg, migrationQuoteProject, validQuoteCommercialEnvelope)
	if err == nil || !strings.Contains(err.Error(), "must be inserted as draft") {
		t.Fatalf("app-role invalid canonical lifecycle insert must be rejected, got %v", err)
	}
	_ = tx.Rollback(ctx)

	// Simulate corrupt at-rest bytes from a privileged restore. Even if such a
	// row bypassed INSERT protection, the app role cannot publish it.
	if _, err := pool.Exec(ctx, `ALTER TABLE quote_revisions DISABLE TRIGGER protect_quote_revisions_immutable`); err != nil {
		t.Fatal(err)
	}
	corruptEnvelope := strings.Replace(validQuoteCommercialEnvelope,
		`"breakdown":{"materials_cost":10,"edge_total":2,"hardware_total":3,"direct_cost":15,"labor_modular":5,"labor_fixed_cost":7,"margin_factor":1.5,"sale_price":27}`,
		`"breakdown":{}`, 1)
	if _, err := pool.Exec(ctx, `INSERT INTO quote_revisions (id,organization_id,project_id,revision_number,status,commercial_snapshot)
		VALUES ('a4000000-0000-0000-0000-000000000004',$1,$2,4,'draft',$3::jsonb)`, migrationQuoteOrg, migrationQuoteProject, corruptEnvelope); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `ALTER TABLE quote_revisions ENABLE TRIGGER protect_quote_revisions_immutable`); err != nil {
		t.Fatal(err)
	}

	tx, err = pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SET LOCAL ROLE granete_app`); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `SELECT set_config('app.organization_id',$1,true), set_config('app.user_id',$2,true)`, migrationQuoteOrg, "a5000000-0000-0000-0000-000000000001"); err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(ctx, `UPDATE quote_revisions SET status='published', published_at=NOW()
		WHERE id='a4000000-0000-0000-0000-000000000004'`)
	if err == nil || !strings.Contains(err.Error(), "valid commercial_snapshot") {
		t.Fatalf("app-role corrupt draft publish must fail closed, got %v", err)
	}
}

func TestQuoteCommercialSnapshotMigrationUpgradePreservesLegacyRowsDownAndReplay(t *testing.T) {
	pool := multiOrgFreshDB(t)
	identityApplyThrough(t, pool, 129)
	seedQuoteMigrationProject(t, pool)
	ctx := context.Background()
	ids := []string{
		"a4000000-0000-0000-0000-000000000011",
		"a4000000-0000-0000-0000-000000000012",
		"a4000000-0000-0000-0000-000000000013",
	}
	statuses := []string{"draft", "published", "accepted"}
	created := make([]time.Time, len(ids))
	for i := range ids {
		if err := pool.QueryRow(ctx, `INSERT INTO quote_revisions (id,organization_id,project_id,revision_number,status) VALUES ($1,$2,$3,$4,$5) RETURNING created_at`, ids[i], migrationQuoteOrg, migrationQuoteProject, i+1, statuses[i]).Scan(&created[i]); err != nil {
			t.Fatalf("seed legacy %s: %v", statuses[i], err)
		}
	}

	applyQuoteCommercial130(t, pool)
	upVersion := assertQuoteCommercial130Posture(t, pool)
	assertPreserved := func(stage string) {
		t.Helper()
		for i := range ids {
			var status string
			var gotCreated time.Time
			var snapshot, publishedAt, acceptedAt any
			if err := pool.QueryRow(ctx, `SELECT status,created_at,commercial_snapshot,published_at,accepted_at FROM quote_revisions WHERE id=$1`, ids[i]).Scan(&status, &gotCreated, &snapshot, &publishedAt, &acceptedAt); err != nil {
				t.Fatalf("%s read: %v", stage, err)
			}
			if status != statuses[i] || !gotCreated.Equal(created[i]) || snapshot != nil || publishedAt != nil || acceptedAt != nil {
				t.Fatalf("%s changed legacy row %d: status=%s created=%s snapshot=%v published=%v accepted=%v", stage, i, status, gotCreated, snapshot, publishedAt, acceptedAt)
			}
		}
	}
	assertPreserved("upgrade")

	// Legacy NULL snapshots remain honestly readable but cannot cross draft -> published.
	if _, err := pool.Exec(ctx, `UPDATE quote_revisions SET status='published' WHERE id=$1`, ids[0]); err == nil || !strings.Contains(err.Error(), "commercial_snapshot") {
		t.Fatalf("legacy draft publish must fail closed, got %v", err)
	}
	// FORCE RLS still hides all owner-A rows from an unrelated app-role tenant.
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SET LOCAL ROLE granete_app`); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `SELECT set_config('app.organization_id',$1,true), set_config('app.user_id',$2,true)`, "b1000000-0000-0000-0000-000000000001", "b5000000-0000-0000-0000-000000000001"); err != nil {
		t.Fatal(err)
	}
	var visible int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM quote_revisions WHERE project_id=$1`, migrationQuoteProject).Scan(&visible); err != nil || visible != 0 {
		t.Fatalf("cross-org direct SQL visible=%d err=%v", visible, err)
	}
	if err := tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}

	down, err := os.ReadFile("../../db/migration/000130_quote_commercial_snapshot.down.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, string(down)); err != nil {
		t.Fatalf("down: %v", err)
	}
	var exists bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='quote_revisions' AND column_name='commercial_snapshot')`).Scan(&exists); err != nil || exists {
		t.Fatalf("down left column: %v", err)
	}
	var downVersion int
	if err := pool.QueryRow(ctx, `SELECT policy_version FROM rls_policy_inventory WHERE table_name='quote_revisions'`).Scan(&downVersion); err != nil || downVersion != upVersion-1 {
		t.Fatalf("down policy version=%d err=%v", downVersion, err)
	}
	for i := range ids {
		var status string
		var gotCreated time.Time
		if err := pool.QueryRow(ctx, `SELECT status,created_at FROM quote_revisions WHERE id=$1`, ids[i]).Scan(&status, &gotCreated); err != nil || status != statuses[i] || !gotCreated.Equal(created[i]) {
			t.Fatalf("down changed row %d status=%s err=%v", i, status, err)
		}
	}
	applyQuoteCommercial130(t, pool)
	assertQuoteCommercial130Posture(t, pool)
	assertPreserved("replay")
}
