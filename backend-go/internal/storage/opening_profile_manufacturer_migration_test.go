package storage_test

import (
	"context"
	"os"
	"testing"
)

// #1345 — 000163 added manufacturer as a NULLABLE column while the domain
// field is a plain string: every profile authored BEFORE the migration holds
// NULL and the scan refused it (the picker's 500 on any dev DB upgraded in
// place — the fresh-DB test suites never saw it). 000164 aligns the column
// with the domain's absence semantics ('' = not declared): backfill, then
// NOT NULL DEFAULT '' so direct SQL can never reintroduce the broken state.
//
// Migrations are a one-way tape (later ones rebuild earlier tables), so the
// upgrade leg replays to the 163 state on its OWN fresh pool and applies
// ONLY 000164's file — the identity/migration-test contract.
func TestOpeningProfileManufacturerMigrationUpgradesLegacyRows(t *testing.T) {
	ctx := context.Background()

	// Fresh side: the column contract at the latest state.
	fresh := multiOrgFreshMigrationDB(t)
	identityApplyThrough(t, fresh, 164)
	var columnDefault, isNullable string
	if err := fresh.QueryRow(ctx, `
		SELECT column_default, is_nullable FROM information_schema.columns
		WHERE table_name = 'opening_profiles' AND column_name = 'manufacturer'
	`).Scan(&columnDefault, &isNullable); err != nil {
		t.Fatalf("read column contract at 164: %v", err)
	}
	// PG normalizes the default with an explicit cast ("''::text").
	if columnDefault != "''" && columnDefault != "''::text" {
		t.Fatalf("column contract drifted: default=%q nullable=%q", columnDefault, isNullable)
	}
	if isNullable != "NO" {
		t.Fatalf("the column must be NOT NULL after 000164: %q", isNullable)
	}

	// Upgrade side: the exact pre-#1345 state — nullable column, a legacy
	// row with NULL (every profile on a dev DB authored before #1343).
	upgrade := multiOrgFreshMigrationDB(t)
	identityApplyThrough(t, upgrade, 163)
	const profileID = "f13450000-0000-0000-0000-000000000001"
	if _, err := upgrade.Exec(ctx, `
		INSERT INTO opening_profiles (id, organization_id, code, name, grip_type)
		VALUES ($1, $2, 'GOLA-L-8006', 'Gola L Cymisa 8006', 'gola')
	`, profileID, multiOrgInitialOrgID); err != nil {
		t.Fatalf("seed legacy profile: %v", err)
	}
	var nullable string
	if err := upgrade.QueryRow(ctx, `
		SELECT is_nullable FROM information_schema.columns
		WHERE table_name = 'opening_profiles' AND column_name = 'manufacturer'
	`).Scan(&nullable); err != nil {
		t.Fatalf("read column contract at 163: %v", err)
	}
	if nullable != "YES" {
		t.Fatalf("the 163-state column must be nullable (the broken state), got %q", nullable)
	}

	contents, err := os.ReadFile("../../db/migration/000164_opening_profile_manufacturer_not_null.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := upgrade.Exec(ctx, string(contents)); err != nil {
		t.Fatalf("apply 000164: %v", err)
	}

	// The legacy row reads back the truthful absence — the LIST/GET scan
	// never sees NULL again.
	var code, manufacturer string
	if err := upgrade.QueryRow(ctx, `
		SELECT code, manufacturer FROM opening_profiles WHERE id = $1
	`, profileID).Scan(&code, &manufacturer); err != nil {
		t.Fatalf("read upgraded profile: %v", err)
	}
	if code != "GOLA-L-8006" || manufacturer != "" {
		t.Fatalf("legacy row drifted: code=%q manufacturer=%q", code, manufacturer)
	}

	// And a direct-SQL insert without the column lands '' (never NULL) —
	// the default keeps absence truthful for every future writer.
	const bareID = "f13450000-0000-0000-0000-000000000002"
	if _, err := upgrade.Exec(ctx, `
		INSERT INTO opening_profiles (id, organization_id, code, name, grip_type)
		VALUES ($1, $2, 'GOLA-C-ALU', 'Gola C aluminio', 'gola')
	`, bareID, multiOrgInitialOrgID); err != nil {
		t.Fatalf("direct insert without manufacturer: %v", err)
	}
	var bareManufacturer string
	if err := upgrade.QueryRow(ctx, `
		SELECT manufacturer FROM opening_profiles WHERE id = $1
	`, bareID).Scan(&bareManufacturer); err != nil {
		t.Fatalf("read bare insert: %v", err)
	}
	if bareManufacturer != "" {
		t.Fatalf("the column default must keep absence truthful: %q", bareManufacturer)
	}
}
