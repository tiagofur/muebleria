package storage_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #1215: deactivating (active→false, via PUT or soft DELETE) a hardware that
// still has live references must be refused with a count-carrying "in use"
// error — the engine fail-closes on inactive hardware, so the references would
// turn every design using the item into a 400 at calculate. Reactivation
// (false→true) and updates without a transition stay allowed.
//
// The four reference surfaces mirror clean_demo.go's protection on physical
// delete: module template hardware lines, item-level quote choices,
// project-level quote choices and design-revision hardware assets.
func TestHardware_InUseDeactivationBlocked(t *testing.T) {
	pool := multiOrgFreshMigrationDB(t)
	store := &storage.PostgresStore{Pool: pool}
	if err := store.RunMigrations(context.Background()); err != nil {
		t.Fatalf("run migrations: %v", err)
	}
	org := storage.InitialOrganizationID
	ctx := storage.WithOrgCtx(context.Background(), org)

	createHardware := func(code string) *domain.Hardware {
		t.Helper()
		hw := &domain.Hardware{
			Code:        code,
			Name:        "Herraje guard " + code,
			Unit:        domain.HardwareUnit("piece"),
			CostPerUnit: 10,
			Active:      true,
		}
		if err := store.CreateHardware(ctx, hw); err != nil {
			t.Fatalf("create hardware %s: %v", code, err)
		}
		return hw
	}
	hwInUse := createHardware(fmt.Sprintf("ZZ-HWGUARD-INUSE-%d", time.Now().UnixNano()))
	hwFree := createHardware(fmt.Sprintf("ZZ-HWGUARD-FREE-%d", time.Now().UnixNano()))

	// Scaffold one live reference per surface, all pinning hwInUse.
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("scaffold: %v", err)
		}
	}
	scanID := func(sql string, args ...any) string {
		t.Helper()
		var id string
		if err := pool.QueryRow(ctx, sql, args...).Scan(&id); err != nil {
			t.Fatalf("scaffold scan: %v", err)
		}
		return id
	}

	// 1. Module template line (hardware_lines).
	moduleID := scanID(`
		INSERT INTO modules (code, name, organization_id)
		VALUES ('ZZ-HWGUARD-MOD', 'Módulo guard', $1) RETURNING id::text`, org)
	exec(`
		INSERT INTO hardware_lines (module_id, quantity, option_role, hardware_id, organization_id)
		VALUES ($1, 2, 'FIXED', $2, $3)`, moduleID, hwInUse.ID, org)

	// 2. Item-level quote choice (project_item_choices).
	customerID := scanID(`
		INSERT INTO customers (organization_id, name, active)
		VALUES ($1, 'Cliente guard', true) RETURNING id::text`, org)
	projectID := scanID(`
		INSERT INTO projects (organization_id, name, customer_id, currency, margin_factor, labor_fixed_cost, status)
		VALUES ($1, 'Obra guard', $2, 'MXN', 1.35, 0, 'draft') RETURNING id::text`, org, customerID)
	itemID := scanID(`
		INSERT INTO project_items (organization_id, project_id, module_id, quantity)
		VALUES ($1, $2, $3, 1) RETURNING id::text`, org, projectID, moduleID)
	exec(`
		INSERT INTO project_item_choices (organization_id, project_item_id, option_group_code, choice_entity_id)
		VALUES ($1, $2, 'BISAGRA', $3)`, org, itemID, hwInUse.ID)

	// 3. Project-level quote choice (project_level_choices, VARCHAR column).
	exec(`
		INSERT INTO project_level_choices (organization_id, project_id, option_group_code, choice_entity_id)
		VALUES ($1, $2, 'BISAGRA-NIVEL-OBRA', $3)`, org, projectID, hwInUse.ID)

	// 4. Design-revision hardware asset (design_revision_hardware_assets).
	guardSHA := "sha256-" + strings.Repeat("ab", 32)
	assetID := scanID(`
		INSERT INTO hardware_assets (organization_id, display_name)
		VALUES ($1, 'Activo guard') RETURNING id::text`, org)
	revisionID := scanID(`
		INSERT INTO hardware_asset_revisions (organization_id, asset_id, revision_number, representation, storage_key, content_type, size_bytes, sha256, integrity_verified_at)
		VALUES ($1, $2, 1, 'glb', 'guard/key.glb', 'model/gltf-binary', 1, $3, now()) RETURNING id::text`, org, assetID, guardSHA)
	designID := scanID(`
		INSERT INTO designs (organization_id, project_id, name)
		VALUES ($1, $2, 'Diseño guard') RETURNING id::text`, org, projectID)
	designRevisionID := scanID(`
		INSERT INTO design_revisions (organization_id, project_id, design_id, revision_number, source_type)
		VALUES ($1, $2, $3, 1, 'system') RETURNING id::text`, org, projectID, designID)
	exec(`
		INSERT INTO design_revision_hardware_assets (organization_id, project_id, design_revision_id, hardware_id, asset_id, asset_revision_id, representation, sha256)
		VALUES ($1, $2, $3, $4, $5, $6, 'glb', $7)`,
		org, projectID, designRevisionID, hwInUse.ID, assetID, revisionID, guardSHA)

	inUseErr := func(err error) {
		t.Helper()
		if !errors.Is(err, storage.ErrHardwareInUse) {
			t.Fatalf("esperaba ErrHardwareInUse, hubo: %v", err)
		}
		// El mensaje nombra las familias con conteos: 1 línea de plantilla,
		// 2 elecciones (item + proyecto) y 1 activo de diseño.
		for _, want := range []string{"1 línea", "2 elección", "1 activo"} {
			if !strings.Contains(err.Error(), want) {
				t.Fatalf("mensaje sin conteo %q: %v", want, err)
			}
		}
	}

	// PUT path: transition active→false is refused while referenced.
	stale := *hwInUse
	stale.Active = false
	inUseErr(store.UpdateHardware(ctx, hwInUse.ID, hwInUse.Version, &stale))

	// Soft DELETE path: refused too.
	inUseErr(store.DeactivateHardware(ctx, hwInUse.ID, hwInUse.Version))

	// The refused writes changed nothing (version intact, still active).
	var stillActive bool
	var stillVersion int64
	if err := pool.QueryRow(ctx,
		`SELECT active, version FROM hardwares WHERE id = $1`, hwInUse.ID,
	).Scan(&stillActive, &stillVersion); err != nil {
		t.Fatal(err)
	}
	if !stillActive || stillVersion != hwInUse.Version {
		t.Fatalf("la escritura rechazada mutó la fila: active=%v version=%d (quería active=true version=%d)",
			stillActive, stillVersion, hwInUse.Version)
	}

	// Unreferenced hardware: deactivates and reactivates freely.
	if err := store.DeactivateHardware(ctx, hwFree.ID, hwFree.Version); err != nil {
		t.Fatalf("desactivar herraje sin referencias: %v", err)
	}
	var freeActive bool
	if err := pool.QueryRow(ctx,
		`SELECT active FROM hardwares WHERE id = $1`, hwFree.ID,
	).Scan(&freeActive); err != nil {
		t.Fatal(err)
	}
	if freeActive {
		t.Fatal("herraje sin referencias quedó activo tras DeactivateHardware")
	}

	// PUT without an active transition (false→false) does not trip the guard.
	freeRow := *hwFree
	freeRow.Active = false
	freeRow.Name = "Herraje guard renombrado"
	if err := store.UpdateHardware(ctx, hwFree.ID, hwFree.Version+1, &freeRow); err != nil {
		t.Fatalf("update sin transición de active: %v", err)
	}

	// Reactivation (false→true) is never blocked.
	freeRow.Active = true
	if err := store.UpdateHardware(ctx, hwFree.ID, freeRow.Version, &freeRow); err != nil {
		t.Fatalf("reactivar herraje: %v", err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT active FROM hardwares WHERE id = $1`, hwFree.ID,
	).Scan(&freeActive); err != nil {
		t.Fatal(err)
	}
	if !freeActive {
		t.Fatal("reactivación no persistió active=true")
	}
}
