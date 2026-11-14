package storage_test

// #1627 slice 1 — orden declarado de las opciones de un grupo, en PostgreSQL
// real (desechable): la migración 000183 no cambia el orden de los grupos
// existentes (fresh + upgrade + down) y el almacenamiento devuelve las
// opciones en el orden en que se guardaron, también al reordenar.

import (
	"context"
	"fmt"
	"os"
	"reflect"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

const posMigOrg = "91830000-0000-0000-0000-0000000000aa"
const posMigGroup = "91830000-0000-0000-0000-0000000000bb"

func TestOptionGroupMemberPositionMigration_1627(t *testing.T) {
	ctx := context.Background()
	// Three members whose UUID order differs from insertion order.
	members := []string{
		"91830000-0000-0000-0000-00000000000c",
		"91830000-0000-0000-0000-00000000000a",
		"91830000-0000-0000-0000-00000000000b",
	}
	uuidOrder := []string{members[1], members[2], members[0]}

	posPool := multiOrgFreshMigrationDB(t)
	readOrder := func(t *testing.T, q string) []string {
		t.Helper()
		rows, err := posPool.Query(ctx, q, posMigGroup)
		if err != nil {
			t.Fatalf("read order: %v", err)
		}
		defer rows.Close()
		var out []string
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				t.Fatal(err)
			}
			out = append(out, id)
		}
		return out
	}

	identityApplyThrough(t, posPool, 182)
	if _, err := posPool.Exec(ctx, `INSERT INTO organizations (id, name, slug) VALUES ($1, 'Pos Migr Org', 'pos-migr-org')`, posMigOrg); err != nil {
		t.Fatalf("seed org: %v", err)
	}
	if _, err := posPool.Exec(ctx, `INSERT INTO option_groups (id, organization_id, code, name, kind, required) VALUES ($1, $2, 'POS_G', 'Grupo', 'hardware', false)`, posMigGroup, posMigOrg); err != nil {
		t.Fatalf("seed group: %v", err)
	}
	for _, m := range members {
		if _, err := posPool.Exec(ctx, `INSERT INTO option_group_members (option_group_id, entity_id, organization_id) VALUES ($1, $2, $3)`, posMigGroup, m, posMigOrg); err != nil {
			t.Fatalf("seed member: %v", err)
		}
	}
	before := readOrder(t, `SELECT entity_id FROM option_group_members WHERE option_group_id = $1 ORDER BY entity_id ASC`)

	up, err := os.ReadFile("../../db/migration/000183_option_group_member_position.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := posPool.Exec(ctx, string(up)); err != nil {
		t.Fatalf("upgrade apply 000183: %v", err)
	}
	after := readOrder(t, `SELECT entity_id FROM option_group_members WHERE option_group_id = $1 ORDER BY position ASC, entity_id ASC`)
	if !reflect.DeepEqual(before, after) || !reflect.DeepEqual(after, uuidOrder) {
		t.Fatalf("the migration must keep today's order: before %v, after %v", before, after)
	}
	if _, err := posPool.Exec(ctx, `UPDATE option_group_members SET position = -1 WHERE option_group_id = $1`, posMigGroup); err == nil {
		t.Fatal("a negative position must be rejected by the check constraint")
	}

	down, err := os.ReadFile("../../db/migration/000183_option_group_member_position.down.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := posPool.Exec(ctx, string(down)); err != nil {
		t.Fatalf("down apply 000183: %v", err)
	}
	var exists bool
	if err := posPool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='option_group_members' AND column_name='position')`).Scan(&exists); err != nil || exists {
		t.Fatalf("down left the position column behind (err %v)", err)
	}
	if _, err := posPool.Exec(ctx, string(up)); err != nil {
		t.Fatalf("re-apply 000183: %v", err)
	}

	// Fresh: the column exists straight through 183.
	fresh := multiOrgFreshMigrationDB(t)
	identityApplyThrough(t, fresh, 183)
	if err := fresh.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='option_group_members' AND column_name='position')`).Scan(&exists); err != nil || !exists {
		t.Fatalf("fresh through 183 lacks option_group_members.position (err %v)", err)
	}
}

func TestOptionGroupMembersKeepSavedOrder_1627(t *testing.T) {
	store, _ := migratedConnectStore(t)
	actor := connectStoreInitialActor
	unique := fmt.Sprintf("ZZ-POS-%d", time.Now().UnixNano())
	a, b, c := "91830000-0000-0000-0000-0000000000a1", "91830000-0000-0000-0000-0000000000b1", "91830000-0000-0000-0000-0000000000c1"

	og := &domain.OptionGroup{Code: unique, Name: "Insertos", Kind: "hardware", OptionIDs: []string{c, a, b}}
	withinConnectStoreTenant(t, store, actor, func(ctx context.Context) error { return store.CreateOptionGroup(ctx, og) })
	t.Cleanup(func() { cleanupConnectStoreFixture(t, "DELETE FROM option_groups WHERE id = $1", og.ID) })

	read := func() []string {
		got := withinConnectStoreTenantValue(t, store, actor, func(ctx context.Context) (*domain.OptionGroup, error) {
			return store.GetOptionGroupByID(ctx, og.ID)
		})
		listed := withinConnectStoreTenantValue(t, store, actor, func(ctx context.Context) ([]domain.OptionGroup, error) {
			return store.ListOptionGroups(ctx)
		})
		for _, g := range listed {
			if g.ID == og.ID && !reflect.DeepEqual(g.OptionIDs, got.OptionIDs) {
				t.Fatalf("list and get disagree on the order: %v vs %v", g.OptionIDs, got.OptionIDs)
			}
		}
		return got.OptionIDs
	}
	if got := read(); !reflect.DeepEqual(got, []string{c, a, b}) {
		t.Fatalf("created order = %v, want the saved order [c a b]", got)
	}

	version := withinConnectStoreTenantValue(t, store, actor, func(ctx context.Context) (int64, error) {
		g, err := store.GetOptionGroupByID(ctx, og.ID)
		if err != nil {
			return 0, err
		}
		return g.Version, nil
	})
	reordered := &domain.OptionGroup{Code: unique, Name: "Insertos", Kind: "hardware", OptionIDs: []string{b, c, a}}
	withinConnectStoreTenant(t, store, actor, func(ctx context.Context) error {
		return store.UpdateOptionGroup(ctx, og.ID, version, reordered)
	})
	if got := read(); !reflect.DeepEqual(got, []string{b, c, a}) {
		t.Fatalf("reordered = %v, want [b c a]", got)
	}
}
