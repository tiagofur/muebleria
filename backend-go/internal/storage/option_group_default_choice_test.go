package storage_test

// #1627 slice 2 — default del selector de insertos en PostgreSQL real
// (desechable): la migración 000184 deja las filas existentes en
// 'first_active' (el comportamiento de hoy), rechaza valores fuera del
// vocabulario, tiene down simétrico, y el almacenamiento guarda/lee 'none'.

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

const defChoiceOrg = "91840000-0000-0000-0000-0000000000aa"
const defChoiceGroup = "91840000-0000-0000-0000-0000000000bb"

func TestOptionGroupDefaultChoiceMigration_1627(t *testing.T) {
	ctx := context.Background()
	pool := multiOrgFreshMigrationDB(t)
	identityApplyThrough(t, pool, 183)
	if _, err := pool.Exec(ctx, `INSERT INTO organizations (id, name, slug) VALUES ($1, 'Def Choice Org', 'def-choice-org')`, defChoiceOrg); err != nil {
		t.Fatalf("seed org: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO option_groups (id, organization_id, code, name, kind, required) VALUES ($1, $2, 'DEF_G', 'Grupo', 'hardware', false)`, defChoiceGroup, defChoiceOrg); err != nil {
		t.Fatalf("seed group: %v", err)
	}
	up, err := os.ReadFile("../../db/migration/000184_option_group_default_choice.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, string(up)); err != nil {
		t.Fatalf("upgrade apply 000184: %v", err)
	}
	var value string
	if err := pool.QueryRow(ctx, `SELECT default_choice FROM option_groups WHERE id = $1`, defChoiceGroup).Scan(&value); err != nil || value != "first_active" {
		t.Fatalf("existing rows must keep the first-active default, got %q (err %v)", value, err)
	}
	if _, err := pool.Exec(ctx, `UPDATE option_groups SET default_choice = 'random' WHERE id = $1`, defChoiceGroup); err == nil {
		t.Fatal("a value outside the vocabulary must be rejected")
	}
	down, err := os.ReadFile("../../db/migration/000184_option_group_default_choice.down.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, string(down)); err != nil {
		t.Fatalf("down apply 000184: %v", err)
	}
	var exists bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='option_groups' AND column_name='default_choice')`).Scan(&exists); err != nil || exists {
		t.Fatalf("down left default_choice behind (err %v)", err)
	}
	if _, err := pool.Exec(ctx, string(up)); err != nil {
		t.Fatalf("re-apply 000184: %v", err)
	}
}

func TestOptionGroupDefaultChoiceRoundTrip_1627(t *testing.T) {
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor
	og := &domain.OptionGroup{Code: fmt.Sprintf("ZZ-DEF-%d", time.Now().UnixNano()), Name: "Insertos", Kind: "hardware", DefaultChoice: domain.OptionGroupDefaultNone}
	withinConnectStoreTenant(t, store, actor, func(ctx context.Context) error { return store.CreateOptionGroup(ctx, og) })
	t.Cleanup(func() { cleanupConnectStoreFixture(t, "DELETE FROM option_groups WHERE id = $1", og.ID) })

	got := withinConnectStoreTenantValue(t, store, actor, func(ctx context.Context) (*domain.OptionGroup, error) {
		return store.GetOptionGroupByID(ctx, og.ID)
	})
	if got.DefaultChoice != domain.OptionGroupDefaultNone {
		t.Fatalf("created default = %q, want none", got.DefaultChoice)
	}
	updated := &domain.OptionGroup{Code: og.Code, Name: "Insertos", Kind: "hardware"}
	withinConnectStoreTenant(t, store, actor, func(ctx context.Context) error {
		return store.UpdateOptionGroup(ctx, og.ID, got.Version, updated)
	})
	listed := withinConnectStoreTenantValue(t, store, actor, func(ctx context.Context) ([]domain.OptionGroup, error) {
		return store.ListOptionGroups(ctx)
	})
	for _, g := range listed {
		if g.ID == og.ID && g.DefaultChoice != domain.OptionGroupDefaultFirstActive {
			t.Fatalf("an update without default_choice stores first_active, got %q", g.DefaultChoice)
		}
	}
}
