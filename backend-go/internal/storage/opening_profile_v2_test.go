package storage_test

// #1530 — gola profile v2 on real PostgreSQL (disposable database only):
// migration 000180 fresh + upgrade with the per-row report, down + re-apply,
// and the runtime-role contract (RLS isolation between organizations,
// If-Match concurrency, part references scoped to the caller's catalog).

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

func applyMigrationFile(t *testing.T, pool *pgxpool.Pool, name string) {
	t.Helper()
	contents, err := os.ReadFile("../../db/migration/" + name)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(context.Background(), string(contents)); err != nil {
		t.Fatalf("apply %s: %v", name, err)
	}
}

type v2Row struct {
	Material  string
	Positions []string
	Top       *int
	Between   *int
	Active    bool
	Version   int64
	Members   map[string]map[string]any
	Report    map[string]any
}

func readV2Row(t *testing.T, pool *pgxpool.Pool, id string) v2Row {
	t.Helper()
	var row v2Row
	var members, report []byte
	if err := pool.QueryRow(context.Background(), `
		SELECT COALESCE(material, ''), positions, front_discount_top_mm, front_discount_between_mm,
		       active, version, bom_members, COALESCE(v2_migration, 'null'::jsonb)
		FROM opening_profiles WHERE id = $1`, id).Scan(
		&row.Material, &row.Positions, &row.Top, &row.Between, &row.Active, &row.Version, &members, &report); err != nil {
		t.Fatalf("read %s: %v", id, err)
	}
	if err := json.Unmarshal(members, &row.Members); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(report, &row.Report); err != nil {
		t.Fatal(err)
	}
	return row
}

func TestOpeningProfileV2MigrationFreshAndUpgrade(t *testing.T) {
	ctx := context.Background()

	t.Run("fresh schema carries the v2 columns and keeps RLS", func(t *testing.T) {
		pool := multiOrgFreshMigrationDB(t)
		identityApplyThrough(t, pool, 180)
		var columns int
		if err := pool.QueryRow(ctx, `
			SELECT count(*) FROM information_schema.columns
			WHERE table_name = 'opening_profiles'
			  AND column_name IN ('material', 'positions', 'front_discount_top_mm', 'front_discount_between_mm', 'v2_migration')`).Scan(&columns); err != nil {
			t.Fatal(err)
		}
		if columns != 5 {
			t.Fatalf("expected the 5 v2 columns, got %d", columns)
		}
		var rls, forced bool
		var classification string
		if err := pool.QueryRow(ctx, `
			SELECT c.relrowsecurity, c.relforcerowsecurity, i.classification
			FROM pg_class c JOIN rls_policy_inventory i ON i.table_name = c.relname
			WHERE c.relname = 'opening_profiles'`).Scan(&rls, &forced, &classification); err != nil {
			t.Fatal(err)
		}
		if !rls || !forced || classification != "tenant-owned" {
			t.Fatalf("RLS classification drifted: rls=%v forced=%v class=%q", rls, forced, classification)
		}
		// The CHECKs: no upper bound, > 0 only, closed vocabularies.
		for _, bad := range []string{
			`INSERT INTO opening_profiles (id, organization_id, code, name, grip_type, front_discount_top_mm) VALUES ('x1', $1, 'X1', 'X', 'gola', 0)`,
			`INSERT INTO opening_profiles (id, organization_id, code, name, grip_type, material) VALUES ('x2', $1, 'X2', 'X', 'gola', 'wood')`,
			`INSERT INTO opening_profiles (id, organization_id, code, name, grip_type, positions) VALUES ('x3', $1, 'X3', 'X', 'gola', '{bottom}')`,
		} {
			if _, err := pool.Exec(ctx, bad, multiOrgInitialOrgID); err == nil {
				t.Fatalf("CHECK must reject: %s", bad)
			}
		}
		if _, err := pool.Exec(ctx, `INSERT INTO opening_profiles (id, organization_id, code, name, grip_type, front_discount_top_mm) VALUES ('x4', $1, 'X4', 'X', 'gola', 52)`, multiOrgInitialOrgID); err != nil {
			t.Fatalf("52 must be accepted: %v", err)
		}
	})

	t.Run("upgrade converts, deactivates and reports per row; down restores; re-apply is stable", func(t *testing.T) {
		pool := multiOrgFreshMigrationDB(t)
		identityApplyThrough(t, pool, 179)
		seed := `
		INSERT INTO opening_profiles (id, organization_id, code, name, grip_type, cross_section_shape,
			compatible_placements, datasheet_status, front_reduction_mm, grip_clearance_mm, door_reduction_mm, bom_members, active)
		VALUES
		('p-handle', $1, 'JAL', 'Jaladera', 'handle', NULL, '{top}', 'pending', NULL, NULL, NULL, '{}', TRUE),
		('p-reveal', $1, 'REB', 'Rebase', 'bottom_reveal', NULL, '{bottom}', 'pending', NULL, NULL, NULL, '{}', FALSE),
		('p-door',   $1, 'GOLA-L', 'Gola L', 'gola', 'L', '{top}', 'verified', 38, 2, 30, '{"profile":{"hardware_id":"hw","rule":"interior_width"}}', TRUE),
		('p-pair',   $1, 'GOLA-LC', 'Gola L+C', 'gola', 'L', '{top,between}', 'verified', 38, 2, NULL, '{}', TRUE),
		('p-bottom', $1, 'GOLA-B', 'Gola abajo', 'gola', 'L', '{bottom}', 'pending', NULL, NULL, 40, '{}', TRUE),
		('p-italia', $1, 'GOLA-IT', 'Italiana', 'gola', 'flat', '{top,between}', 'pending', NULL, NULL, 36,
			'{"tira":{"hardware_id":"","component_id":"comp","rule":"interior_width"},"rail":{"hardware_id":"hw","rule":"per_length"}}', TRUE)`
		if _, err := pool.Exec(ctx, seed, multiOrgInitialOrgID); err != nil {
			t.Fatalf("seed legacy rows: %v", err)
		}

		applyMigrationFile(t, pool, "000180_opening_profile_v2.up.sql")

		handle := readV2Row(t, pool, "p-handle")
		if handle.Active || handle.Report["action"] != "deactivated" || handle.Report["reason"] != "grip_type_not_profile" || handle.Report["was_active"] != true || handle.Version != 2 {
			t.Fatalf("handle row: %+v", handle)
		}
		if reveal := readV2Row(t, pool, "p-reveal"); reveal.Report["was_active"] != false {
			t.Fatalf("an already inactive row reports was_active=false: %+v", reveal)
		}
		door := readV2Row(t, pool, "p-door")
		if door.Material != "aluminum" || door.Top == nil || *door.Top != 30 || door.Report["discount_source"] != "door_reduction_mm" || !door.Active || door.Version != 2 {
			t.Fatalf("door_reduction row: %+v", door)
		}
		pair := readV2Row(t, pool, "p-pair")
		if pair.Top == nil || *pair.Top != 40 || pair.Between != nil || len(pair.Positions) != 2 ||
			pair.Report["discount_source"] != "front_reduction_mm+grip_clearance_mm" || pair.Report["front_discount_between_mm"] != "missing" {
			t.Fatalf("pair row: %+v", pair)
		}
		bottom := readV2Row(t, pool, "p-bottom")
		if bottom.Active || bottom.Report["reason"] != "no_v2_position" || len(bottom.Positions) != 0 {
			t.Fatalf("bottom-only row: %+v", bottom)
		}
		italia := readV2Row(t, pool, "p-italia")
		if italia.Material != "melamine" || italia.Members["strip"]["component_id"] != "comp" || italia.Members["strip"]["height_mm"] != float64(70) ||
			italia.Members["tira"] != nil || italia.Report["strip_renamed_from"] != "tira" {
			t.Fatalf("italian row: %+v", italia)
		}
		if roles, _ := italia.Report["unknown_member_roles"].([]any); len(roles) != 1 || roles[0] != "rail" {
			t.Fatalf("unknown roles must be reported, not dropped: %+v", italia.Report)
		}

		// The legacy reader still sees its columns untouched.
		var door2 int
		if err := pool.QueryRow(ctx, `SELECT door_reduction_mm FROM opening_profiles WHERE id='p-door'`).Scan(&door2); err != nil || door2 != 30 {
			t.Fatalf("legacy door_reduction_mm must stay readable: %d %v", door2, err)
		}

		// Down: rows come back, the strip key and default height are undone.
		applyMigrationFile(t, pool, "000180_opening_profile_v2.down.sql")
		var handleActive, bottomActive, revealActive bool
		var italianMembers string
		if err := pool.QueryRow(ctx, `SELECT
			(SELECT active FROM opening_profiles WHERE id='p-handle'),
			(SELECT active FROM opening_profiles WHERE id='p-bottom'),
			(SELECT active FROM opening_profiles WHERE id='p-reveal'),
			(SELECT bom_members::text FROM opening_profiles WHERE id='p-italia')`).Scan(&handleActive, &bottomActive, &revealActive, &italianMembers); err != nil {
			t.Fatal(err)
		}
		if !handleActive || !bottomActive || revealActive || !strings.Contains(italianMembers, `"tira"`) ||
			strings.Contains(italianMembers, "strip") || strings.Contains(italianMembers, "height_mm") {
			t.Fatalf("down drifted: handle=%v bottom=%v reveal=%v members=%s", handleActive, bottomActive, revealActive, italianMembers)
		}

		// Re-apply (the re-pin path): same outcome as the first upgrade.
		applyMigrationFile(t, pool, "000180_opening_profile_v2.up.sql")
		again := readV2Row(t, pool, "p-italia")
		if again.Material != "melamine" || again.Members["strip"] == nil || again.Report["action"] != "converted" {
			t.Fatalf("re-apply drifted: %+v", again)
		}
		if again := readV2Row(t, pool, "p-pair"); *again.Top != 40 {
			t.Fatalf("re-apply pair drifted: %+v", again)
		}
	})
}

func gola2Profile(id, code, hardwareID string) *domain.OpeningProfile {
	height, depth, top := 56.5, 27.2, 40
	return &domain.OpeningProfile{
		ID: id, Code: code, Name: "Gola L v2",
		Material: domain.GolaMaterialAluminum, CrossSectionShape: "L",
		Positions:          []string{domain.GolaPositionTop, domain.GolaPositionBetween},
		ProfileHeightMm:    &height,
		ProfileDepthMm:     &depth,
		FrontDiscountTopMm: &top,
		BOMMembers: map[string]domain.OpeningBOMMember{
			domain.GolaRoleProfile: {HardwareID: hardwareID, Rule: "interior_width", Unit: "meter"},
		},
		Active: true,
	}
}

func TestOpeningProfileV2RuntimeRLSAndIfMatch(t *testing.T) {
	fixture := runtimeIsolationSetup(t)
	store, orgA, orgB := fixture.store, fixture.orgA, fixture.orgB

	hwA := createHardwareProfileFixtureHardware(t, store, fixture.actorA, uniqueID("HW-GOLA"))
	hwB := createHardwareProfileFixtureHardware(t, store, fixture.actorB, uniqueID("HW-GOLA"))
	profile := gola2Profile(uniqueID("op-v2"), uniqueID("GOLA-V2"), hwA.ID)
	if err := isolationFamilyError(t, fixture, orgA, func(txCtx context.Context) error {
		return store.CreateOpeningProfile(txCtx, profile)
	}); err != nil {
		t.Fatalf("create under the runtime role: %v", err)
	}
	t.Cleanup(func() { cleanupConnectStoreFixture(t, `DELETE FROM opening_profiles WHERE id = $1`, profile.ID) })

	// Read back under the runtime role: v2 fields, the legacy mirror and usage.
	read := isolationFamilyValue(t, fixture, orgA, func(txCtx context.Context) (*domain.OpeningProfile, error) {
		return store.GetOpeningProfileByID(txCtx, profile.ID)
	})
	if read.Material != "aluminum" || *read.FrontDiscountTopMm != 40 || read.DoorReductionMm == nil || *read.DoorReductionMm != 40 ||
		read.GripType != "gola" || !read.Usage["top"].Usable || read.Usage["between"].Usable ||
		read.Usage["between"].Missing[0] != "front_discount_between_mm" {
		t.Fatalf("runtime readback: %+v usage=%+v", read, read.Usage)
	}

	// Org B never lists, reads or writes org A's profile.
	for _, listed := range isolationFamilyValue(t, fixture, orgB, func(txCtx context.Context) ([]domain.OpeningProfile, error) {
		return store.ListOpeningProfiles(txCtx)
	}) {
		if listed.ID == profile.ID {
			t.Fatalf("org B listed org A profile")
		}
	}
	if err := isolationFamilyError(t, fixture, orgB, func(txCtx context.Context) error {
		_, err := store.GetOpeningProfileByID(txCtx, profile.ID)
		return err
	}); err == nil {
		t.Fatal("org B read org A profile")
	}
	crossWrite := gola2Profile(profile.ID, profile.Code, hwB.ID)
	if err := isolationFamilyError(t, fixture, orgB, func(txCtx context.Context) error {
		return store.UpdateOpeningProfile(txCtx, profile.ID, read.Version, crossWrite)
	}); !errors.Is(err, storage.ErrOpeningProfileNotFound) {
		t.Fatalf("org B update err = %v, want not found", err)
	}

	// Org B cannot reference org A's hardware: the catalog check is RLS-scoped.
	foreign := gola2Profile(uniqueID("op-v2b"), uniqueID("GOLA-V2B"), hwA.ID)
	if err := isolationFamilyError(t, fixture, orgB, func(txCtx context.Context) error {
		return store.CreateOpeningProfile(txCtx, foreign)
	}); err == nil || !domain.IsOpeningProfileValidationError(err) {
		t.Fatalf("org B must not reference org A hardware: %v", err)
	}
	// A component id under a hardware role is not a hardware row either.
	wrongKind := gola2Profile(uniqueID("op-v2c"), uniqueID("GOLA-V2C"), "00000000-0000-0000-0000-00000000dead")
	if err := isolationFamilyError(t, fixture, orgA, func(txCtx context.Context) error {
		return store.CreateOpeningProfile(txCtx, wrongKind)
	}); err == nil || !strings.Contains(err.Error(), "no existe en el catálogo") {
		t.Fatalf("unknown hardware must be rejected: %v", err)
	}

	// If-Match concurrency: two writers on the same version — exactly one wins.
	var wg sync.WaitGroup
	results := make([]error, 2)
	for i, between := range []int{36, 38} {
		wg.Add(1)
		go func(i, between int) {
			defer wg.Done()
			update := gola2Profile(profile.ID, profile.Code, hwA.ID)
			update.FrontDiscountBetweenMm = &between
			results[i] = isolationFamilyError(t, fixture, orgA, func(txCtx context.Context) error {
				return store.UpdateOpeningProfile(txCtx, profile.ID, read.Version, update)
			})
		}(i, between)
	}
	wg.Wait()
	wins, conflicts := 0, 0
	for _, err := range results {
		switch {
		case err == nil:
			wins++
		case errors.Is(err, storage.ErrVersionConflict):
			conflicts++
		default:
			t.Fatalf("unexpected concurrent write error: %v", err)
		}
	}
	if wins != 1 || conflicts != 1 {
		t.Fatalf("If-Match: wins=%d conflicts=%d, want 1/1", wins, conflicts)
	}
	final := isolationFamilyValue(t, fixture, orgA, func(txCtx context.Context) (*domain.OpeningProfile, error) {
		return store.GetOpeningProfileByID(txCtx, profile.ID)
	})
	if final.Version != read.Version+1 || final.FrontDiscountBetweenMm == nil || !final.Usage["between"].Usable {
		t.Fatalf("winner must land once: %+v", final)
	}

	// A legacy-shaped write (the #1526 editor) keeps the between discount it
	// cannot express, and mirrors door_reduction_mm into the top discount.
	thirtyTwo := 32
	legacy := &domain.OpeningProfile{
		ID: profile.ID, Code: profile.Code, Name: "Gola L editada", GripType: "gola", CrossSectionShape: "L",
		CompatiblePlacements: []string{"top", "between"}, DatasheetStatus: "pending",
		ProfileHeightMm: final.ProfileHeightMm, ProfileDepthMm: final.ProfileDepthMm,
		DoorReductionMm: &thirtyTwo, BOMMembers: final.BOMMembers, Active: true,
	}
	if err := isolationFamilyError(t, fixture, orgA, func(txCtx context.Context) error {
		return store.UpdateOpeningProfile(txCtx, profile.ID, final.Version, legacy)
	}); err != nil {
		t.Fatalf("legacy-shaped update: %v", err)
	}
	if legacy.Material != "aluminum" || *legacy.FrontDiscountTopMm != 32 || legacy.FrontDiscountBetweenMm == nil ||
		*legacy.FrontDiscountBetweenMm != *final.FrontDiscountBetweenMm {
		t.Fatalf("legacy update must keep the v2-only values: %+v", legacy)
	}
}
