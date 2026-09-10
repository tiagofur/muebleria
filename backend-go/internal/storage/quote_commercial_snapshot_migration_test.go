package storage_test

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func mutateQuoteCommercialEnvelope(t *testing.T, mutate func(map[string]any)) string {
	t.Helper()
	var payload map[string]any
	if err := json.Unmarshal([]byte(validQuoteCommercialEnvelope), &payload); err != nil {
		t.Fatal(err)
	}
	mutate(payload)
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	return string(encoded)
}

func assertAppRoleQuoteSnapshotInsertRejected(t *testing.T, pool *pgxpool.Pool, id string, revision int, payload string) {
	t.Helper()
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
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
		VALUES ($1,$2,$3,$4,'draft',$5::jsonb)`, id, migrationQuoteOrg, migrationQuoteProject, revision, payload)
	if err == nil || !strings.Contains(err.Error(), "not a valid") {
		t.Fatalf("app-role invalid canonical snapshot insert must be rejected, got %v", err)
	}
}

func assertAppRoleQuoteSnapshotPublishRejected(t *testing.T, pool *pgxpool.Pool, id string) {
	t.Helper()
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
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
	_, err = tx.Exec(ctx, `UPDATE quote_revisions SET status='published', published_at=NOW() WHERE id=$1`, id)
	if err == nil || !strings.Contains(err.Error(), "valid commercial_snapshot") {
		t.Fatalf("app-role corrupt draft publish must fail closed, got %v", err)
	}
}

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

	invalidSnapshots := []struct {
		name     string
		id       string
		revision int
		payload  string
	}{
		{
			name: "quantity two with one active unit", id: "a4000000-0000-0000-0000-000000000021", revision: 21,
			payload: mutateQuoteCommercialEnvelope(t, func(payload map[string]any) {
				payload["lines"].([]any)[0].(map[string]any)["quantity"] = float64(2)
			}),
		},
		{
			name: "duplicate quote line identity", id: "a4000000-0000-0000-0000-000000000022", revision: 22,
			payload: mutateQuoteCommercialEnvelope(t, func(payload map[string]any) {
				line := payload["lines"].([]any)[0].(map[string]any)
				payload["lines"] = append(payload["lines"].([]any), line)
			}),
		},
		{
			name: "duplicate furniture instance identity", id: "a4000000-0000-0000-0000-000000000023", revision: 23,
			payload: mutateQuoteCommercialEnvelope(t, func(payload map[string]any) {
				unit := payload["units"].([]any)[0].(map[string]any)
				payload["units"] = append(payload["units"].([]any), unit)
			}),
		},
		{
			name: "duplicate furniture identity inside line", id: "a4000000-0000-0000-0000-000000000028", revision: 28,
			payload: mutateQuoteCommercialEnvelope(t, func(payload map[string]any) {
				line := payload["lines"].([]any)[0].(map[string]any)
				line["furnitureInstanceIds"] = append(line["furnitureInstanceIds"].([]any), line["furnitureInstanceIds"].([]any)[0])
			}),
		},
		{
			name: "unit bound to unknown quote line", id: "a4000000-0000-0000-0000-000000000024", revision: 24,
			payload: mutateQuoteCommercialEnvelope(t, func(payload map[string]any) {
				payload["units"].([]any)[0].(map[string]any)["quoteLineId"] = "62000000-0000-0000-0000-000000000099"
			}),
		},
		{
			name: "incomplete option descriptor", id: "a4000000-0000-0000-0000-000000000025", revision: 25,
			payload: mutateQuoteCommercialEnvelope(t, func(payload map[string]any) {
				payload["units"].([]any)[0].(map[string]any)["options"] = []any{map[string]any{
					"groupCode": "FRONT", "groupLabel": "Front", "choiceId": "82000000-0000-0000-0000-000000000001",
				}}
			}),
		},
		{
			name: "non-canonical option order", id: "a4000000-0000-0000-0000-000000000026", revision: 26,
			payload: mutateQuoteCommercialEnvelope(t, func(payload map[string]any) {
				payload["units"].([]any)[0].(map[string]any)["options"] = []any{
					map[string]any{"groupCode": "INTERIOR", "groupLabel": "Interior", "choiceId": "82000000-0000-0000-0000-000000000002", "choiceLabel": "White"},
					map[string]any{"groupCode": "FRONT", "groupLabel": "Front", "choiceId": "82000000-0000-0000-0000-000000000001", "choiceLabel": "Oak"},
				}
			}),
		},
		{
			name: "uuid option label fallback", id: "a4000000-0000-0000-0000-000000000029", revision: 29,
			payload: mutateQuoteCommercialEnvelope(t, func(payload map[string]any) {
				payload["units"].([]any)[0].(map[string]any)["options"] = []any{map[string]any{
					"groupCode": "FRONT", "groupLabel": "Front", "choiceId": "82000000-0000-0000-0000-000000000001", "choiceLabel": "82000000-0000-0000-0000-000000000001",
				}}
			}),
		},
		{
			name: "missing option choice identity", id: "a4000000-0000-0000-0000-000000000032", revision: 32,
			payload: mutateQuoteCommercialEnvelope(t, func(payload map[string]any) {
				payload["units"].([]any)[0].(map[string]any)["options"] = []any{map[string]any{
					"groupCode": "FRONT", "groupLabel": "Front", "choiceLabel": "Oak",
				}}
			}),
		},
		{
			name: "invalid captured timestamp", id: "a4000000-0000-0000-0000-000000000033", revision: 33,
			payload: mutateQuoteCommercialEnvelope(t, func(payload map[string]any) {
				payload["capturedAt"] = "not-a-timestamp"
			}),
		},
		{
			name: "zero captured timestamp", id: "a4000000-0000-0000-0000-000000000034", revision: 34,
			payload: mutateQuoteCommercialEnvelope(t, func(payload map[string]any) {
				payload["capturedAt"] = "0001-01-01T00:00:00Z"
			}),
		},
	}
	for _, test := range invalidSnapshots {
		t.Run(test.name, func(t *testing.T) {
			assertAppRoleQuoteSnapshotInsertRejected(t, pool, test.id, test.revision, test.payload)
		})
	}

	// A canonical draft created by the runtime role remains publishable: the
	// database backstop rejects corruption without shadowing the valid lifecycle.
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
	if _, err := tx.Exec(ctx, `INSERT INTO quote_revisions (id, organization_id, project_id, revision_number, status, commercial_snapshot)
		VALUES ('a4000000-0000-0000-0000-000000000027',$1,$2,27,'draft',$3::jsonb)`, migrationQuoteOrg, migrationQuoteProject, validQuoteCommercialEnvelope); err != nil {
		t.Fatalf("insert canonical draft: %v", err)
	}
	if _, err := tx.Exec(ctx, `UPDATE quote_revisions SET status='published', published_at=NOW()
		WHERE id='a4000000-0000-0000-0000-000000000027'`); err != nil {
		t.Fatalf("publish canonical draft: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	var status string
	var publishedAt time.Time
	if err := pool.QueryRow(ctx, `SELECT status,published_at FROM quote_revisions WHERE id='a4000000-0000-0000-0000-000000000027'`).Scan(&status, &publishedAt); err != nil || status != "published" || publishedAt.IsZero() {
		t.Fatalf("canonical draft publication status=%q publishedAt=%s err=%v", status, publishedAt, err)
	}

	terminalEnvelope := mutateQuoteCommercialEnvelope(t, func(payload map[string]any) {
		payload["lines"].([]any)[0].(map[string]any)["quantity"] = float64(0)
		payload["units"].([]any)[0].(map[string]any)["lifecycleStatus"] = "removed"
	})
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
	if _, err := tx.Exec(ctx, `INSERT INTO quote_revisions (id, organization_id, project_id, revision_number, status, commercial_snapshot)
		VALUES ('a4000000-0000-0000-0000-000000000030',$1,$2,30,'draft',$3::jsonb)`, migrationQuoteOrg, migrationQuoteProject, terminalEnvelope); err != nil {
		t.Fatalf("insert terminal-only canonical draft: %v", err)
	}
	if _, err := tx.Exec(ctx, `UPDATE quote_revisions SET status='published', published_at=NOW()
		WHERE id='a4000000-0000-0000-0000-000000000030'`); err != nil {
		t.Fatalf("publish terminal-only canonical draft: %v", err)
	}
	if _, err := tx.Exec(ctx, `UPDATE quote_revisions SET status='superseded'
		WHERE id='a4000000-0000-0000-0000-000000000030'`); err != nil {
		t.Fatalf("supersede terminal-only canonical revision: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	var frozenQuantity int
	var frozenLifecycle string
	if err := pool.QueryRow(ctx, `SELECT (commercial_snapshot#>>'{lines,0,quantity}')::int,
		commercial_snapshot#>>'{units,0,lifecycleStatus}' FROM quote_revisions
		WHERE id='a4000000-0000-0000-0000-000000000030'`).Scan(&frozenQuantity, &frozenLifecycle); err != nil || frozenQuantity != 0 || frozenLifecycle != "removed" {
		t.Fatalf("superseded terminal history quantity=%d lifecycle=%q err=%v", frozenQuantity, frozenLifecycle, err)
	}

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
	missingChoiceEnvelope := mutateQuoteCommercialEnvelope(t, func(payload map[string]any) {
		payload["units"].([]any)[0].(map[string]any)["options"] = []any{map[string]any{
			"groupCode": "FRONT", "groupLabel": "Front", "choiceLabel": "Oak",
		}}
	})
	if _, err := pool.Exec(ctx, `INSERT INTO quote_revisions (id,organization_id,project_id,revision_number,status,commercial_snapshot)
		VALUES ('a4000000-0000-0000-0000-000000000031',$1,$2,31,'draft',$3::jsonb)`, migrationQuoteOrg, migrationQuoteProject, missingChoiceEnvelope); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `ALTER TABLE quote_revisions ENABLE TRIGGER protect_quote_revisions_immutable`); err != nil {
		t.Fatal(err)
	}
	assertAppRoleQuoteSnapshotPublishRejected(t, pool, "a4000000-0000-0000-0000-000000000004")
	assertAppRoleQuoteSnapshotPublishRejected(t, pool, "a4000000-0000-0000-0000-000000000031")
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
