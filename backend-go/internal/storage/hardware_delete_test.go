package storage_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #1615 — physical hardware delete + the unified reference guard, on a
// disposable PostgreSQL:
//   - each JSONB family (module/structure component placements, agregado
//     lines, agregado current recipe, hardware profiles) blocks delete AND
//     deactivation (regression of the placement-only gap);
//   - an option group using it as kit blocks with the group listed;
//   - membership in option groups is removed automatically and the groups'
//     versions move; the row disappears;
//   - a kit with parts: refused without deleteParts; with it, a part in use
//     aborts everything; free parts cascade together with the kit;
//   - stale If-Match → ErrVersionConflict; another organization → not found.
func TestHardwareDelete_GuardsCascadeAndMemberships(t *testing.T) {
	pool := multiOrgFreshMigrationDB(t)
	store := &storage.PostgresStore{Pool: pool}
	if err := store.RunMigrations(context.Background()); err != nil {
		t.Fatalf("run migrations: %v", err)
	}
	org := storage.InitialOrganizationID
	ctx := storage.WithOrgCtx(context.Background(), org)
	suffix := fmt.Sprintf("%d", time.Now().UnixNano())

	create := func(code string, kitID *string) *domain.Hardware {
		t.Helper()
		hw := &domain.Hardware{Code: code + "-" + suffix, Name: "Herraje " + code, Unit: domain.HardwareUnit("piece"), CostPerUnit: 10, Active: true, KitHardwareID: kitID}
		if err := store.CreateHardware(ctx, hw); err != nil {
			t.Fatalf("create hardware %s: %v", code, err)
		}
		return hw
	}
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("scaffold: %v\n%s", err, sql)
		}
	}
	del := func(hw *domain.Hardware, deleteParts bool) (*storage.DeleteHardwareResult, error) {
		return store.DeleteHardware(ctx, storage.DeleteHardwareCommand{ID: hw.ID, ExpectedVersion: hw.Version, DeleteParts: deleteParts, ActorUserID: "", RequestID: "hw-delete-test"})
	}
	exists := func(id string) bool {
		var n int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM hardwares WHERE id = $1`, id).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n == 1
	}
	expectInUse := func(hw *domain.Hardware, family string) {
		t.Helper()
		_, err := del(hw, false)
		var inUse *storage.HardwareInUseError
		if !errors.As(err, &inUse) || !strings.Contains(err.Error(), family) {
			t.Fatalf("%s: delete must be refused in use naming %q, got %v", hw.Code, family, err)
		}
		if !exists(hw.ID) {
			t.Fatalf("%s: refused delete must keep the row", hw.Code)
		}
		// The unified guard also protects deactivation (regression).
		if err := store.DeactivateHardware(ctx, hw.ID, hw.Version); !errors.Is(err, storage.ErrHardwareInUse) {
			t.Fatalf("%s: deactivation must be refused too, got %v", hw.Code, err)
		}
	}

	componentID := uuid.NewString()
	exec(`INSERT INTO components (id, code, name, placement, active, length_mm, width_mm, thickness_mm, organization_id)
		VALUES ($1, $2, 'Lateral', 'side', true, 700, 560, 18, $3)`, componentID, "ZZ-HWDEL-CMP-"+suffix, org)

	// 1. Placement on a module component (JSONB overrides only).
	hwModulePlacement := create("ZZ-HWDEL-MODPL", nil)
	moduleID := uuid.NewString()
	exec(`INSERT INTO modules (id, code, name, organization_id) VALUES ($1, $2, 'Módulo', $3)`, moduleID, "ZZ-HWDEL-MOD-"+suffix, org)
	exec(`INSERT INTO module_components (module_id, component_id, quantity, overrides, organization_id) VALUES ($1, $2, 1, $3::jsonb, $4)`,
		moduleID, componentID, fmt.Sprintf(`{"hardwarePlacements":[{"hardwareId":"%s","anchorFace":"front","relativePosition":{"x":0.5,"y":0.5}}]}`, hwModulePlacement.ID), org)
	expectInUse(hwModulePlacement, "ubicación en componentes")

	// 2. Placement on a structure component.
	hwStructurePlacement := create("ZZ-HWDEL-STPL", nil)
	structureID := uuid.NewString()
	exec(`INSERT INTO structures (id, code, name, organization_id) VALUES ($1, $2, 'Cuerpo', $3)`, structureID, "ZZ-HWDEL-ST-"+suffix, org)
	exec(`INSERT INTO structure_components (structure_id, component_id, quantity, overrides, organization_id) VALUES ($1, $2, 1, $3::jsonb, $4)`,
		structureID, componentID, fmt.Sprintf(`{"hardwarePlacements":[{"hardwareId":"%s","anchorFace":"left","relativePosition":{"x":0.1,"y":0.1}}]}`, hwStructurePlacement.ID), org)
	expectInUse(hwStructurePlacement, "ubicación en componentes")

	// 3. Agregado hardware line.
	hwAgregadoLine := create("ZZ-HWDEL-AGL", nil)
	exec(`INSERT INTO agregados (id, code, name, hardware_lines, organization_id) VALUES ($1, $2, 'Cajón', $3::jsonb, $4)`,
		"agr-line-"+suffix, "ZZ-HWDEL-AGL-"+suffix, fmt.Sprintf(`[{"hardwareId":"%s","quantity":2}]`, hwAgregadoLine.ID), org)
	expectInUse(hwAgregadoLine, "1 agregado")

	// 4. Agregado current recipe (variant set member).
	hwRecipe := create("ZZ-HWDEL-RCP", nil)
	agrID := "agr-recipe-" + suffix
	exec(`INSERT INTO agregados (id, code, name, organization_id) VALUES ($1, $2, 'Corredera', $3)`, agrID, "ZZ-HWDEL-RCP-"+suffix, org)
	revID := uuid.NewString()
	exec(`INSERT INTO agregado_revisions (id, organization_id, agregado_id, revision_number, recipe) VALUES ($1, $2, $3, 1, $4::jsonb)`,
		revID, org, agrID, fmt.Sprintf(`{"variantSets":[{"id":"vs","variants":[{"nominalDimensionMm":450,"hardwareId":"%s"}]}]}`, hwRecipe.ID))
	exec(`UPDATE agregados SET current_revision_id = $1 WHERE id = $2 AND organization_id = $3`, revID, agrID, org)
	expectInUse(hwRecipe, "1 agregado")

	// 5. Hardware profile item.
	hwProfile := create("ZZ-HWDEL-PRF", nil)
	exec(`INSERT INTO hardware_profiles (organization_id, code, name, revision, items, active) VALUES ($1, $2, 'Perfil', 'r1', $3::jsonb, true)`,
		org, "ZZ-HWDEL-PRF-"+suffix, fmt.Sprintf(`[{"hardwareId":"%s","quantity":1}]`, hwProfile.ID))
	expectInUse(hwProfile, "perfil de herraje")

	// 5b. Gola/opening profile BOM member and grip style handle (review B2).
	hwGola := create("ZZ-HWDEL-GOLA", nil)
	exec(`INSERT INTO opening_profiles (id, organization_id, code, name, grip_type, bom_members) VALUES ($1, $2, $3, 'Gola', 'gola', $4::jsonb)`,
		"op-"+suffix, org, "ZZ-HWDEL-OP-"+suffix, fmt.Sprintf(`{"profile":{"hardware_id":"%s"}}`, hwGola.ID))
	expectInUse(hwGola, "perfil de apertura (gola)")
	hwHandle := create("ZZ-HWDEL-HANDLE", nil)
	exec(`INSERT INTO grip_styles (organization_id, name, by_furniture_type) VALUES ($1, $2, $3::jsonb)`,
		org, "Estilo "+suffix, fmt.Sprintf(`{"inferior":{"kind":"handle","handleHardwareId":"%s"},"superior":{"kind":"none"},"alto":{"kind":"none"}}`, hwHandle.ID))
	expectInUse(hwHandle, "estilo de agarre")

	// 5c. An UPPERCASE id must hit the same guard (review B1): uuid::text is
	// lowercase, so an uncanonicalized id would count zero references.
	upper := *hwAgregadoLine
	upper.ID = strings.ToUpper(hwAgregadoLine.ID)
	if _, err := del(&upper, false); !errors.Is(err, storage.ErrHardwareInUse) {
		t.Fatalf("uppercase id must be refused in use, got %v", err)
	}
	if !exists(hwAgregadoLine.ID) {
		t.Fatalf("uppercase delete must keep the row")
	}
	if err := store.DeactivateHardware(ctx, strings.ToUpper(hwAgregadoLine.ID), hwAgregadoLine.Version); !errors.Is(err, storage.ErrHardwareInUse) {
		t.Fatalf("uppercase deactivation must be refused, got %v", err)
	}

	// 6. Option group using it as kit: refused, group listed.
	hwKitOfGroup := create("ZZ-HWDEL-KITG", nil)
	groupCode := "ZZ-HWDEL-G-" + suffix
	exec(`INSERT INTO option_groups (code, name, kind, required, organization_id, kit_hardware_id) VALUES ($1, 'Insertos', 'hardware', false, $2, $3)`,
		groupCode, org, hwKitOfGroup.ID)
	if _, err := del(hwKitOfGroup, false); !errors.Is(err, storage.ErrHardwareKitGroupsReferenced) || !strings.Contains(err.Error(), groupCode) {
		t.Fatalf("kit-of-group delete must list the group, got %v", err)
	}

	// 7. Free hardware member of an option group: removed from it and deleted.
	hwMember := create("ZZ-HWDEL-MEM", nil)
	memberGroupID := uuid.NewString()
	exec(`INSERT INTO option_groups (id, code, name, kind, required, organization_id) VALUES ($1, $2, 'Bisagras', 'hardware', true, $3)`,
		memberGroupID, "ZZ-HWDEL-MG-"+suffix, org)
	exec(`INSERT INTO option_group_members (option_group_id, entity_id, organization_id) VALUES ($1, $2, $3)`, memberGroupID, hwMember.ID, org)
	var groupVersionBefore int64
	if err := pool.QueryRow(ctx, `SELECT version FROM option_groups WHERE id = $1`, memberGroupID).Scan(&groupVersionBefore); err != nil {
		t.Fatal(err)
	}
	stale := *hwMember
	stale.Version--
	if _, err := del(&stale, false); !errors.Is(err, storage.ErrVersionConflict) {
		t.Fatalf("stale If-Match must conflict, got %v", err)
	}
	otherCtx := storage.WithOrgCtx(context.Background(), "20000000-0000-0000-0000-00000000000b")
	if _, err := store.DeleteHardware(otherCtx, storage.DeleteHardwareCommand{ID: hwMember.ID, ExpectedVersion: hwMember.Version}); err == nil || !strings.Contains(err.Error(), "not found") {
		t.Fatalf("another organization must get not found, got %v", err)
	}
	result, err := del(hwMember, false)
	if err != nil {
		t.Fatalf("delete free member: %v", err)
	}
	if exists(hwMember.ID) || result.RemovedFromGroups != 1 || len(result.UpdatedGroupIDs) != 1 {
		t.Fatalf("member delete result = %+v exists=%v", result, exists(hwMember.ID))
	}
	var members int
	var groupVersionAfter int64
	if err := pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM option_group_members WHERE option_group_id = $1), (SELECT version FROM option_groups WHERE id = $1)`, memberGroupID).Scan(&members, &groupVersionAfter); err != nil {
		t.Fatal(err)
	}
	if members != 0 || groupVersionAfter != groupVersionBefore+1 {
		t.Fatalf("group members=%d version %d→%d", members, groupVersionBefore, groupVersionAfter)
	}
	if _, err := store.GetHardwareByID(ctx, hwMember.ID); err == nil {
		t.Fatalf("deleted hardware must not be readable")
	}
	var audits int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM security_audit_events WHERE event_type = 'catalog_hardware_deleted' AND details->>'hardware_id' = $1`, hwMember.ID).Scan(&audits); err != nil || audits != 1 {
		t.Fatalf("delete audit = %d (%v)", audits, err)
	}

	// 8. Kit with parts.
	kit := create("ZZ-HWDEL-KIT", nil)
	partFree := create("ZZ-HWDEL-PART-A", &kit.ID)
	partBusy := create("ZZ-HWDEL-PART-B", &kit.ID)
	if _, err := del(kit, false); !errors.Is(err, storage.ErrHardwareKitHasParts) || !strings.Contains(err.Error(), partFree.Code) {
		t.Fatalf("kit without deleteParts must list parts, got %v", err)
	}
	exec(`INSERT INTO hardware_lines (module_id, quantity, option_role, hardware_id, organization_id) VALUES ($1, 1, 'FIXED', $2, $3)`, moduleID, partBusy.ID, org)
	if _, err := del(kit, true); !errors.Is(err, storage.ErrHardwareInUse) || !strings.Contains(err.Error(), partBusy.Code) {
		t.Fatalf("a part in use must abort the cascade naming it, got %v", err)
	}
	if !exists(kit.ID) || !exists(partFree.ID) || !exists(partBusy.ID) {
		t.Fatalf("aborted cascade must delete nothing")
	}
	exec(`DELETE FROM hardware_lines WHERE hardware_id = $1`, partBusy.ID)
	result, err = del(kit, true)
	if err != nil {
		t.Fatalf("cascade delete: %v", err)
	}
	if len(result.DeletedIDs) != 3 || exists(kit.ID) || exists(partFree.ID) || exists(partBusy.ID) {
		t.Fatalf("cascade result = %+v", result)
	}
}
