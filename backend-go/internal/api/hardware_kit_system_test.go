package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #1553 — the drawer-system endpoint is the transactional surface of the M4
// wizard. These tests run against a REAL throwaway PostgreSQL and replicate
// the auth middleware's tenant-transaction envelope (buffered response,
// rollback on ≥500, commit otherwise): atomicity, the typed 409/422s and the
// SQL-level rollback proof are the issue's acceptance.

const kitSysActor = "21000000-0000-0000-0000-0000000000e3"
const kitSysMembership = "23000000-0000-0000-0000-0000000000e3"

type kitSysE2E struct {
	server *Server
	store  *storage.PostgresStore
	pool   *pgxpool.Pool
	org    string
}

func kitSystemE2EStore(t *testing.T) *kitSysE2E {
	t.Helper()
	adminDSN := storage.TestAdminDatabaseURL(t)
	dbName := "hwassets_api_e2e_" + fmt.Sprint(time.Now().UnixNano()%1000000)
	admin, err := pgxpool.New(context.Background(), adminDSN)
	if err != nil {
		t.Skipf("no db: %v", err)
	}
	if _, err := admin.Exec(context.Background(), fmt.Sprintf(`DROP DATABASE IF EXISTS %s WITH (FORCE)`, dbName)); err != nil {
		admin.Close()
		t.Skipf("drop throwaway db: %v", err)
	}
	if _, err := admin.Exec(context.Background(), fmt.Sprintf(`CREATE DATABASE %s`, dbName)); err != nil {
		admin.Close()
		t.Skipf("create throwaway db: %v", err)
	}
	migrationPool, err := pgxpool.New(context.Background(), storage.TestMigrationDatabaseURL(t, dbName))
	if err != nil {
		t.Fatalf("connect migration db: %v", err)
	}
	t.Cleanup(func() {
		migrationPool.Close()
		if os.Getenv("TEST_KEEP_DB") == "1" {
			t.Logf("TEST_KEEP_DB=1: keeping throwaway database %s", dbName)
			return
		}
		_, _ = admin.Exec(context.Background(), fmt.Sprintf(`DROP DATABASE IF EXISTS %s WITH (FORCE)`, dbName))
		admin.Close()
	})
	migrationStore := &storage.PostgresStore{Pool: migrationPool}
	if err := migrationStore.RunMigrations(context.Background()); err != nil {
		t.Fatalf("migrations: %v", err)
	}
	org := "22000000-0000-0000-0000-0000000000e3"
	seedStmts := []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO users (id, email, password_hash, name, account_status, normalized_email)
		  VALUES ($1, 'kit-system-e2e@test.local', 'x', 'Kit System E2E', 'active', 'kit-system-e2e@test.local')
		  ON CONFLICT (id) DO NOTHING`, []any{kitSysActor}},
		{`INSERT INTO organizations (id, name, slug, type)
		  VALUES ($1, 'Kit System E2E', 'kit-system-e2e', 'factory')
		  ON CONFLICT (id) DO NOTHING`, []any{org}},
		{`INSERT INTO memberships (id, organization_id, user_id, roles)
		  VALUES ('23000000-0000-0000-0000-0000000000e3', $1, $2, ARRAY['admin'])
		  ON CONFLICT (user_id, organization_id) DO NOTHING`, []any{org, kitSysActor}},
		// The SKP asset the fixture pieces bind to (identifiers-only on the
		// wire; the handler resolves the facts through the same authority as
		// the regular hardware write).
		{`INSERT INTO hardware_assets (id, organization_id, display_name, status, created_by)
		  VALUES ('74000000-0000-0000-0000-000000000001', $1, 'Lateral e2e', 'active', $2)
		  ON CONFLICT (id) DO NOTHING`, []any{org, kitSysActor}},
		{`INSERT INTO hardware_asset_revisions
		  (id, organization_id, asset_id, revision_number, representation, storage_key, content_type,
		   size_bytes, sha256, integrity_verified_at, created_by)
		  VALUES ('75000000-0000-0000-0000-000000000001', $1, '74000000-0000-0000-0000-000000000001',
		  1, 'skp', 'e2e/kit-system/lateral.skp', 'application/octet-stream',
		  1024, 'sha256-6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b', NOW(), $2)
		  ON CONFLICT (id) DO NOTHING`, []any{org, kitSysActor}},
	}
	for _, stmt := range seedStmts {
		if _, err := migrationPool.Exec(context.Background(), stmt.sql, stmt.args...); err != nil {
			t.Fatalf("seed kit-system e2e identity: %v", err)
		}
	}
	runtimeURL, err := url.Parse(os.Getenv("DATABASE_URL"))
	if err != nil {
		t.Fatalf("parse DATABASE_URL: %v", err)
	}
	runtimeURL.Path = "/" + dbName
	if err := storage.ValidateTestDatabaseURL(runtimeURL.String()); err != nil {
		t.Fatalf("kitSystemE2EStore rejected unsafe runtime database: %v", err)
	}
	runtimePool, err := pgxpool.New(context.Background(), runtimeURL.String())
	if err != nil {
		t.Fatalf("connect runtime db: %v", err)
	}
	t.Cleanup(runtimePool.Close)
	store := &storage.PostgresStore{Pool: runtimePool}
	return &kitSysE2E{server: &Server{Store: store}, store: store, pool: runtimePool, org: org}
}

// runKitSystemRequest replicates the auth middleware's envelope: the handler
// runs inside the actor's tenant transaction, a ≥500 response forces the
// rollback and anything else commits — so the tests exercise the REAL
// atomicity the production request gets.
func (e *kitSysE2E) run(t *testing.T, body string) *httptest.ResponseRecorder {
	t.Helper()
	actor := storage.TenantActor{OrganizationID: e.org, UserID: kitSysActor}
	// The request context carries the claims (withClaims); the tenant
	// transaction builds on top of it so the handler sees BOTH — the actor
	// (not the withClaims org) governs the app.* tenant scope, exactly like
	// the auth middleware does.
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/hardware-kit-systems", strings.NewReader(body)), kitSysActor, string(domain.RoleAdmin))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	err := e.store.WithinTenantTx(req.Context(), actor, func(txCtx context.Context) error {
		e.server.HandleHardwareKitSystemCreate(rec, req.WithContext(txCtx))
		if rec.Code >= http.StatusInternalServerError {
			return errTenantHandlerFailure
		}
		return nil
	})
	if err != nil && rec.Code < http.StatusInternalServerError {
		t.Fatalf("tenant tx failed but handler buffered %d: %v", rec.Code, err)
	}
	return rec
}

// sqlCount counts rows by code under the actor's tenant context — the
// acceptance's readback authority (rollback is proven by SQL, never by the
// absence of an error). The read runs on an EXPLICIT transaction with the
// app.* GUCs set (B1 del review #1561): a bare pool connection carries no
// tenant GUCs and RLS (role granete_app, NOBYPASSRLS) would hide every row —
// making the "zero rows" assertions pass vacuously.
func (e *kitSysE2E) sqlCount(t *testing.T, table string, codes []string) int {
	t.Helper()
	ctx := context.Background()
	tx, err := e.pool.Begin(ctx)
	if err != nil {
		t.Fatalf("readback begin: %v", err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		SELECT set_config('app.organization_id', $1, true),
		       set_config('app.user_id', $2, true),
		       set_config('app.membership_id', $3, true),
		       set_config('app.authorized_organization_ids', $1, true)`,
		e.org, kitSysActor, kitSysMembership); err != nil {
		t.Fatalf("readback tenant GUCs: %v", err)
	}
	total := 0
	for _, code := range codes {
		var n int
		if err := tx.QueryRow(ctx,
			fmt.Sprintf(`SELECT count(*) FROM %s WHERE code = $1`, table), code).Scan(&n); err != nil {
			t.Fatalf("sql readback: %v", err)
		}
		total += n
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("readback commit: %v", err)
	}
	return total
}

// kitSystemUUID derives a deterministic valid UUID from a small seed (the
// columns are UUID-typed; row identity stays client-owned per #1398).
func kitSystemUUID(seed int) string {
	return fmt.Sprintf("aaaaaaaa-0000-0000-0000-%012d", seed)
}

// kitSystemPayload builds a full valid plan keyed by a client UUID seed.
// brokenFijID (default "") swaps the SECOND hardware row's id for an invalid
// value: the kit row inserts first and the FIJ insert fails mid-transaction —
// the deterministic injected failure the rollback test needs.
func kitSystemPayload(code string, seed int, brokenFijID string) string {
	kitID := kitSystemUUID(seed*10 + 1)
	fijID := orString(brokenFijID, kitSystemUUID(seed*10+2))
	movID := kitSystemUUID(seed*10 + 3)
	agrID := kitSystemUUID(seed*10 + 4)
	grpID := kitSystemUUID(seed*10 + 5)
	pieces := `[{"anchor":"left","asset":{"assetId":"74000000-0000-0000-0000-000000000001","assetRevisionId":"75000000-0000-0000-0000-000000000001"}},{"anchor":"right"}]`
	fij := func(kitCode, kitID string, rowID string) string {
		return fmt.Sprintf(`{"id":%q,"code":%q,"name":"Fija %s","unit":"piece","cost_per_unit":0,"active":true,"kit_hardware_id":%q,"pieces":%s}`,
			rowID, kitCode+"-FIJ", kitCode, kitID, pieces)
	}
	mov := func(kitCode, kitID, rowID string) string {
		return fmt.Sprintf(`{"id":%q,"code":"%s-MOV","name":"Móvil %s","unit":"piece","cost_per_unit":0,"active":true,"kit_hardware_id":%q}`,
			rowID, kitCode, kitCode, kitID)
	}
	return fmt.Sprintf(`{
		"expected_existing_codes": [],
		"hardware": [
			{"id":%q,"code":"%s","name":"Kit %s","unit":"set","cost_per_unit":420,"active":true},
			%s,
			%s
		],
		"agregado": {
			"id":%q,"code":"%s-CAJON","name":"Cajón %s","active":true,
			"width_mm":570,"height_mm":209,"depth_mm":530,
			"commercial_kit_hardware_id":%q,
			"presentation_motion": {"kind":"translate","axis":{"x":0,"y":1,"z":0},"distanceMm":424},
			"variant_sets": [{
				"id":"",
				"dimension":"height",
				"variants":[{"nominalDimensionMm":209,"hardwareId":%q,"commercialKitHardwareId":%q}]
			}]
		},
		"option_group": {
			"id":%q,"code":"%s_LATERAL_E","name":"Lateral superior E","kind":"hardware",
			"required":false,"option_ids":[%q],"kit_hardware_id":%q
		}
	}`,
		kitID, code, code,
		fij(code, kitID, fijID),
		mov(code, kitID, movID),
		agrID, code, code, kitID,
		kitID, kitID,
		grpID, code, fijID, kitID)
}

func orString(v, fallback string) string {
	if v != "" {
		return v
	}
	return fallback
}

func decodeKitSystemResponse(rec *httptest.ResponseRecorder) openapi.HardwareKitSystemCreated {
	var created openapi.HardwareKitSystemCreated
	_ = json.Unmarshal(rec.Body.Bytes(), &created)
	return created
}

func TestHardwareKitSystem_HappyPathPersistsEverything_1553(t *testing.T) {
	e := kitSystemE2EStore(t)
	rec := e.run(t, kitSystemPayload("SYS-A", 1, ""))
	if rec.Code != http.StatusCreated {
		t.Fatalf("happy path = %d %s", rec.Code, rec.Body.String())
	}
	created := decodeKitSystemResponse(rec)
	// SQL readback of EVERY entity the plan creates.
	codes := []string{"SYS-A", "SYS-A-FIJ", "SYS-A-MOV"}
	if got := e.sqlCount(t, "hardwares", codes); got != 3 {
		t.Fatalf("hardware rows persisted = %d, want 3", got)
	}
	if got := e.sqlCount(t, "agregados", []string{"SYS-A-CAJON"}); got != 1 {
		t.Fatalf("agregado persisted = %d, want 1", got)
	}
	if got := e.sqlCount(t, "option_groups", []string{"SYS-A_LATERAL_E"}); got != 1 {
		t.Fatalf("option group persisted = %d, want 1", got)
	}
	// The variant set id is SERVER-ASSIGNED: non-empty and NOT the historical
	// `${code}-heights` derived id.
	if len(created.VariantSetIds) != 1 || created.VariantSetIds[0] == "" || created.VariantSetIds[0] == "SYS-A-heights" {
		t.Fatalf("variant set ids must be server-assigned: %v", created.VariantSetIds)
	}
	if len(created.CreatedCodes) != 3 || len(created.ReusedCodes) != 0 {
		t.Fatalf("created/reused codes = %v / %v", created.CreatedCodes, created.ReusedCodes)
	}
	if created.AgregadoCode != "SYS-A-CAJON" || created.AgregadoID != kitSystemUUID(14) {
		t.Fatalf("agregado echo = %+v", created)
	}
}

func TestHardwareKitSystem_MidFailureRollsBackEverything_1553(t *testing.T) {
	e := kitSystemE2EStore(t)
	// Late row carries a NON-UUID id: the DB rejects the INSERT after the
	// earlier kit row was already written inside the transaction — the
	// rollback must discard it (verified by SQL, not by status code alone).
	rec := e.run(t, kitSystemPayload("SYS-B", 2, "not-a-uuid"))
	if rec.Code < http.StatusInternalServerError {
		t.Fatalf("mid-failure = %d (want ≥500 so the tx rolls back): %s", rec.Code, rec.Body.String())
	}
	codes := []string{"SYS-B", "SYS-B-FIJ", "SYS-B-MOV"}
	if got := e.sqlCount(t, "hardwares", codes); got != 0 {
		t.Fatalf("rollback leaked %d hardware rows", got)
	}
	if got := e.sqlCount(t, "agregados", []string{"SYS-B-CAJON"}); got != 0 {
		t.Fatalf("rollback leaked the agregado")
	}
	if got := e.sqlCount(t, "option_groups", []string{"SYS-B_LATERAL_E"}); got != 0 {
		t.Fatalf("rollback leaked the option group")
	}
}

func TestHardwareKitSystem_ConcurrentSamePlanExactlyOneWins_1553(t *testing.T) {
	e := kitSystemE2EStore(t)
	payload := kitSystemPayload("SYS-C", 3, "")
	var wg sync.WaitGroup
	results := make([]*httptest.ResponseRecorder, 2)
	for i := range results {
		wg.Add(1)
		go func(slot int) {
			defer wg.Done()
			results[slot] = e.run(t, payload)
		}(i)
	}
	wg.Wait()
	createdCount, conflictCount := 0, 0
	for _, rec := range results {
		switch rec.Code {
		case http.StatusCreated:
			createdCount++
		case http.StatusConflict:
			conflictCount++
			var payload map[string]any
			_ = json.Unmarshal(rec.Body.Bytes(), &payload)
			if payload["code"] != "HARDWARE_KIT_SYSTEM_CODE_TAKEN" {
				t.Fatalf("loser conflict code = %v", payload["code"])
			}
		default:
			t.Fatalf("unexpected concurrent status %d: %s", rec.Code, rec.Body.String())
		}
	}
	if createdCount != 1 || conflictCount != 1 {
		t.Fatalf("concurrent plan: created=%d conflict=%d (want 1/1)", createdCount, conflictCount)
	}
	if got := e.sqlCount(t, "hardwares", []string{"SYS-C", "SYS-C-FIJ", "SYS-C-MOV"}); got != 3 {
		t.Fatalf("exactly one creation must persist 3 rows, got %d", got)
	}
	if got := e.sqlCount(t, "agregados", []string{"SYS-C-CAJON"}); got != 1 {
		t.Fatalf("exactly one agregado, got %d", got)
	}
}

func TestHardwareKitSystem_InvalidPlansFailClosedWithoutWrites_1553(t *testing.T) {
	e := kitSystemE2EStore(t)
	cases := []struct {
		name    string
		code    string
		seed    int
		mutate  func(string, string) string
		wantSub string
	}{
		{
			name: "variant set id no vacío (el servidor lo asigna)",
			code: "SYS-D1", seed: 41,
			mutate: func(p, _ string) string {
				return strings.Replace(p, `"id":""`, `"id":"SYS-D1-heights"`, 1)
			},
			wantSub: "servidor lo asigna",
		},
		{
			name: "variante referencia kit inexistente en el payload",
			code: "SYS-D2", seed: 42,
			mutate: func(p, _ string) string {
				return strings.Replace(p, `"hardwareId":"`+kitSystemUUID(421)+`"`, `"hardwareId":"otro-kit"`, 1)
			},
			wantSub: "fila kit",
		},
		{
			name: "código repetido en el payload",
			code: "SYS-D3", seed: 43,
			mutate: func(p, code string) string {
				return strings.Replace(p, fmt.Sprintf(`"code":"%s-FIJ"`, code), fmt.Sprintf(`"code":"%s"`, code), 1)
			},
			wantSub: "repetido",
		},
		{
			name: "expected_existing_codes con código inexistente",
			code: "SYS-D4", seed: 44,
			mutate: func(p, _ string) string {
				return strings.Replace(p, `"expected_existing_codes": []`, `"expected_existing_codes": ["NO-EXISTE"]`, 1)
			},
			wantSub: "REFERENCE_MISSING",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := e.run(t, tc.mutate(kitSystemPayload(tc.code, tc.seed, ""), tc.code))
			if rec.Code != http.StatusUnprocessableEntity {
				t.Fatalf("invalid plan = %d (want 422): %s", rec.Code, rec.Body.String())
			}
			body := rec.Body.String()
			if !strings.Contains(body, tc.wantSub) {
				t.Fatalf("422 body missing %q: %s", tc.wantSub, body)
			}
			codes := []string{tc.code, tc.code + "-FIJ", tc.code + "-MOV"}
			if got := e.sqlCount(t, "hardwares", codes); got != 0 {
				t.Fatalf("invalid plan wrote %d hardware rows", got)
			}
			if got := e.sqlCount(t, "agregados", []string{tc.code + "-CAJON"}); got != 0 {
				t.Fatalf("invalid plan wrote the agregado")
			}
		})
	}
}

func TestHardwareKitSystem_TakenCodeNamesConflictingRows_1553(t *testing.T) {
	e := kitSystemE2EStore(t)
	// Seed a colliding code with the regular hardware endpoint's storage path.
	actor := storage.TenantActor{OrganizationID: e.org, UserID: kitSysActor}
	ctx := storage.WithOrgCtx(context.Background(), e.org)
	err := e.store.WithinTenantTx(ctx, actor, func(txCtx context.Context) error {
		hw := &domain.Hardware{ID: "44444444-4444-4444-4444-444444444444", Code: "SYS-E", Name: "Ocupado", Unit: domain.UnitSet, CostPerUnit: 1, Active: true}
		return e.store.CreateHardware(txCtx, hw)
	})
	if err != nil {
		t.Fatalf("seed colliding code: %v", err)
	}
	rec := e.run(t, kitSystemPayload("SYS-E", 5, ""))
	if rec.Code != http.StatusConflict {
		t.Fatalf("taken code = %d (want 409): %s", rec.Code, rec.Body.String())
	}
	var payload struct {
		Code    string   `json:"code"`
		Details struct {
			Codes []string `json:"codes"`
		} `json:"details"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode 409: %v (%s)", err, rec.Body.String())
	}
	if payload.Code != "HARDWARE_KIT_SYSTEM_CODE_TAKEN" || len(payload.Details.Codes) == 0 {
		t.Fatalf("409 must be typed and name rows: %+v", payload)
	}
	// Nothing from the losing plan persisted.
	if got := e.sqlCount(t, "hardwares", []string{"SYS-E-FIJ", "SYS-E-MOV"}); got != 0 {
		t.Fatalf("taken-code plan leaked %d rows", got)
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte("SYS-E")) {
		t.Fatalf("409 must name the conflicting code: %s", rec.Body.String())
	}
}
