package storage_test

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

const pairingOrganizationRepairIndex = "idx_design_pairing_grants_organization_created"

func pairingOrganizationIndexMigrationSQL(t *testing.T, suffix string) string {
	t.Helper()
	contents, err := os.ReadFile("../../db/migration/000126_design_pairing_grant_organization_index." + suffix + ".sql")
	if err != nil {
		t.Fatal(err)
	}
	return string(contents)
}

func assertPairingOrganizationFirstIndex(t *testing.T, pool *pgxpool.Pool, indexName string, want bool) {
	t.Helper()
	var exists bool
	if err := pool.QueryRow(context.Background(), `
		SELECT EXISTS (
			SELECT 1
			FROM pg_index i
			JOIN pg_class idx ON idx.oid = i.indexrelid
			JOIN pg_attribute a
			  ON a.attrelid = i.indrelid
			 AND a.attnum = (i.indkey::smallint[])[0]
			WHERE i.indrelid = 'design_pairing_grants'::regclass
			  AND idx.relname = $1
			  AND a.attname = 'organization_id'
		)`, indexName).Scan(&exists); err != nil {
		t.Fatal(err)
	}
	if exists != want {
		t.Fatalf("organization-first index %s exists=%v, want %v", indexName, exists, want)
	}
}

func TestDesignPairingGrantOrganizationIndexMigrationFreshAndUpgrade(t *testing.T) {
	ctx := context.Background()

	fresh := multiOrgFreshDB(t)
	identityApplyThrough(t, fresh, 126)
	assertPairingOrganizationFirstIndex(t, fresh, pairingOrganizationRepairIndex, true)
	if _, err := fresh.Exec(ctx, pairingOrganizationIndexMigrationSQL(t, "down")); err != nil {
		t.Fatalf("down 000126: %v", err)
	}
	assertPairingOrganizationFirstIndex(t, fresh, pairingOrganizationRepairIndex, false)
	assertPairingOrganizationFirstIndex(t, fresh, "idx_design_pairing_grants_organization", true)
	fresh.Close()

	upgrade := multiOrgFreshDB(t)
	identityApplyThrough(t, upgrade, 125)
	if _, err := upgrade.Exec(ctx, `DROP INDEX idx_design_pairing_grants_organization`); err != nil {
		t.Fatalf("simulate original 000124 without organization-first index: %v", err)
	}
	assertPairingOrganizationFirstIndex(t, upgrade, "idx_design_pairing_grants_organization", false)

	if _, err := upgrade.Exec(ctx, pairingOrganizationIndexMigrationSQL(t, "up")); err != nil {
		t.Fatalf("apply 000126 upgrade repair: %v", err)
	}
	assertPairingOrganizationFirstIndex(t, upgrade, pairingOrganizationRepairIndex, true)
}
