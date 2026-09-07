package storage_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/api"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

func TestProductionReleaseCaptureHTTPFrozen(t *testing.T) {
	fx := setupReleaseFixture(t)
	// This fixture's operational owner is Org A; retain Org B as a shared reader.
	multiOrgExec(t, fx.admin, `ALTER TABLE projects DISABLE TRIGGER protect_project_organization_ownership;
 UPDATE projects SET manufacturing_organization_id=organization_id WHERE id='`+fx.projectID+`';
 ALTER TABLE projects ENABLE TRIGGER protect_project_organization_ownership;`)
	ctx := context.Background()
	const secret = "release-capture-http-test-secret"
	var membership string
	var memberVersion, orgVersion int64
	if err := fx.admin.QueryRow(ctx, `SELECT m.id,m.credential_version,o.credential_version
 FROM memberships m JOIN organizations o ON o.id=m.organization_id
 WHERE m.organization_id=$1 AND m.user_id=$2`, rlsOrgA, rlsUserA).Scan(&membership, &memberVersion, &orgVersion); err != nil {
		t.Fatal(err)
	}
	token, err := auth.GenerateLegacyWebToken(rlsUserA, "rls-a@example.test", auth.TokenContext{
		Roles: []string{string(domain.RoleAdmin)}, OrgID: rlsOrgA, MembershipID: membership,
		MembershipCredentialVersion: memberVersion, OrganizationCredentialVersion: orgVersion,
	}, secret)
	if err != nil {
		t.Fatal(err)
	}
	handler := api.RegisterRoutes(api.NewServer(fx.store, secret, nil, 100, 100))
	request := func(path, key, body string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		if key != "" {
			req.Header.Set("Idempotency-Key", key)
		}
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		return rr
	}
	assertCounts := func(want int) {
		t.Helper()
		for _, table := range []string{"production_releases", "production_release_manufacturing_snapshots"} {
			var n int
			if err := fx.admin.QueryRow(ctx, "SELECT count(*) FROM "+table).Scan(&n); err != nil || n != want {
				t.Fatalf("%s count=%d want=%d err=%v", table, n, want, err)
			}
		}
	}
	releasePath := "/api/projects/" + fx.projectID + "/production-releases"
	body := fmt.Sprintf(`{"design_revision_id":%q,"quote_revision_id":%q}`, fx.revR3, fx.quoteQ3)
	// SQL failure occurs after the release INSERT. Neither row nor receipt may survive.
	multiOrgExec(t, fx.admin, `CREATE FUNCTION fail_capture_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'capture failure'; END; $$;
 CREATE TRIGGER fail_capture BEFORE INSERT ON production_release_manufacturing_snapshots FOR EACH ROW EXECUTE FUNCTION fail_capture_test();`)
	if rr := request(releasePath, "capture-idempotent-01", body); rr.Code != 500 {
		t.Fatalf("insert failure=%d %s", rr.Code, rr.Body.String())
	}
	assertCounts(0)
	multiOrgExec(t, fx.admin, `DROP TRIGGER fail_capture ON production_release_manufacturing_snapshots; DROP FUNCTION fail_capture_test();`)
	rr := request(releasePath, "capture-idempotent-01", body)
	if rr.Code != 201 {
		t.Fatalf("release=%d %s", rr.Code, rr.Body.String())
	}
	var release struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &release); err != nil {
		t.Fatal(err)
	}
	retry := request(releasePath, "capture-idempotent-01", body)
	if retry.Code != 201 || retry.Body.String() != rr.Body.String() || retry.Header().Get("Idempotency-Replayed") != "true" {
		t.Fatalf("retry differs: %d %s", retry.Code, retry.Body.String())
	}
	assertCounts(1)
	read := func(actor storage.TenantActor, project string) (*storage.ReleaseManufacturingSnapshot, error) {
		var result *storage.ReleaseManufacturingSnapshot
		err := fiTx(t, fx.store, actor, func(inner context.Context) error {
			var err error
			result, err = fx.store.GetProductionReleaseManufacturingSnapshot(inner, project, release.ID)
			return err
		})
		return result, err
	}
	frozen, err := read(fiActorA(), fx.projectID)
	if err != nil {
		t.Fatal(err)
	}
	if frozen.Release.ID != release.ID || frozen.Release.DesignRevisionID != fx.revR3 || frozen.Release.QuoteRevisionID != fx.quoteQ3 || len(frozen.Units) != 2 {
		t.Fatalf("wrong frozen pins/units: %+v", frozen)
	}
	if frozen.Units[0].Resolved.FurnitureInstanceID == frozen.Units[1].Resolved.FurnitureInstanceID {
		t.Fatal("physical units were grouped")
	}
	var items []domain.DesignRevisionItem
	if err := fiTx(t, fx.store, fiActorA(), func(inner context.Context) error {
		var err error
		items, err = fx.store.ListDesignRevisionItems(inner, fx.revR3)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	fingerprint, err := domain.ManufacturingFingerprint(items)
	if err != nil || fingerprint != frozen.Release.ManufacturingFingerprint {
		t.Fatalf("fingerprint drift: %v", err)
	}
	before, _ := json.Marshal(frozen)
	assertExecutionRoutingBlockedHTTP(t, fx, handler, token, frozen)
	for _, target := range []struct {
		actor   storage.TenantActor
		project string
	}{{fiActorB(), fx.projectID}, {fiActorA(), fiProjectAOnly}} {
		if got, err := read(target.actor, target.project); got != nil || !errors.Is(err, storage.ErrReleaseSnapshotUnavailable) {
			t.Fatalf("foreign exact read=%+v %v", got, err)
		}
	}
	if err := releaseTx(t, fx.store, fiActorB(), func(inner context.Context) error {
		_, err := fx.store.CreateProductionRelease(inner, storage.CreateProductionReleaseCommand{ProjectID: fx.projectID, DesignRevisionID: fx.revR3, ActorUserID: rlsUserB})
		return err
	}); err == nil {
		t.Fatal("foreign organization captured release")
	}
	initialDerive := request("/api/projects/"+fx.projectID+"/materials/derive", "", fmt.Sprintf(`{"production_release_id":%q,"lines":[]}`, release.ID))
	if initialDerive.Code != 200 {
		t.Fatalf("initial derive=%d %s", initialDerive.Code, initialDerive.Body.String())
	}
	// Later published manufacturing revision and mutable project/catalog never retarget P1.
	if err := fiTx(t, fx.store, fiActorA(), func(inner context.Context) error {
		_, err := fx.store.UpdateDesignWorkingCopy(inner, storage.UpdateDesignWorkingCopyCommand{DesignID: fx.designID, BaseRevisionID: &fx.revR3, SourceType: domain.DesignRevisionSourceManual, ActorUserID: rlsUserA,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{{FurnitureInstanceID: fx.fiA, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 800.0, "heightMm": 900.0, "depthMm": 560.0}, MaterialChoices: map[string]string{"BODY": releaseMaterial}}}})
		if err != nil {
			return err
		}
		_, err = fx.store.PublishDesignRevision(inner, storage.PublishDesignRevisionCommand{DesignID: fx.designID, BaseRevisionID: fx.revR3, SourceType: domain.DesignRevisionSourceManual, ActorUserID: rlsUserA})
		return err
	}); err != nil {
		t.Fatal(err)
	}
	multiOrgExec(t, fx.admin, `UPDATE project_items SET quantity=99 WHERE project_id='`+fx.projectID+`';
 UPDATE components SET length_mm=999 WHERE code='RELEASE-PANEL';
 UPDATE material_boards SET thickness_mm=30,board_price=9999 WHERE id='`+releaseMaterial+`';
 UPDATE projects SET production_release='{"id":"stale-legacy","bomFingerprint":"wrong"}' WHERE id='`+fx.projectID+`';`)
	after, err := read(fiActorA(), fx.projectID)
	afterJSON, _ := json.Marshal(after)
	if err != nil || string(before) != string(afterJSON) {
		t.Fatalf("snapshot mutated: %v", err)
	}
	// Forged client quantities cannot become canonical planning content.
	derive := request("/api/projects/"+fx.projectID+"/materials/derive", "", fmt.Sprintf(`{"production_release_id":%q,"lines":[{"kind":"tableros","material_id":%q,"quantity":999}]}`, release.ID, releaseMaterial))
	if derive.Code != 200 {
		t.Fatalf("derive=%d %s", derive.Code, derive.Body.String())
	}
	if err := fiTx(t, fx.store, fiActorA(), func(inner context.Context) error {
		project, err := fx.store.GetProjectByID(inner, fx.projectID)
		if err != nil {
			return err
		}
		if !reflect.DeepEqual(project.MaterialPlanning.Requirements.Lines, frozen.Requirements) || project.MaterialPlanning.Requirements.ReleaseID != release.ID {
			t.Fatal("planning did not consume frozen canonical content")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	assertWarehouseFrozenHTTP(t, fx, handler, request, release.ID, frozen)
	assertExecutionRoutingBlockedHTTP(t, fx, handler, token, frozen)

	// Historical canonical release without its snapshot fails closed, never legacy fallback.
	multiOrgExec(t, fx.admin, `ALTER TABLE production_release_manufacturing_snapshots DISABLE TRIGGER protect_release_manufacturing_snapshots_immutable;
 DELETE FROM production_release_manufacturing_snapshots;
 ALTER TABLE production_release_manufacturing_snapshots ENABLE TRIGGER protect_release_manufacturing_snapshots_immutable;`)
	if rr := request("/api/projects/"+fx.projectID+"/materials/derive", "", fmt.Sprintf(`{"production_release_id":%q}`, release.ID)); rr.Code != 409 {
		t.Fatalf("missing snapshot=%d %s", rr.Code, rr.Body.String())
	}
}

func TestProductionReleaseCaptureResolutionRollback(t *testing.T) {
	for _, scenario := range []string{"empty manufacture", "missing component", "unsupported version", "budget", "incoherent transaction"} {
		t.Run(scenario, func(t *testing.T) {
			fx := setupReleaseFixture(t)
			switch scenario {
			case "empty manufacture":
				multiOrgExec(t, fx.admin, `DELETE FROM structure_components;`)
			case "missing component":
				multiOrgExec(t, fx.admin, `REVOKE SELECT ON components FROM granete_app;`)
			case "budget":
				multiOrgExec(t, fx.admin, `UPDATE structure_components SET quantity=10001;`)
			case "unsupported version":
				multiOrgExec(t, fx.admin, `ALTER TABLE design_revision_items DISABLE TRIGGER USER;
     UPDATE design_revision_items SET definition_version=1;
     ALTER TABLE design_revision_items ENABLE TRIGGER USER;`)
			}
			run := releaseTx
			if scenario == "incoherent transaction" {
				run = fiTx
			}
			err := run(t, fx.store, fiActorA(), func(ctx context.Context) error {
				result, err := fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{ProjectID: fx.projectID, DesignRevisionID: fx.revR3, QuoteRevisionID: fx.quoteQ3, ActorUserID: rlsUserA})
				if result != nil {
					t.Fatal("failure returned partial release")
				}
				return err
			})
			if err == nil {
				t.Fatal("invalid capture succeeded")
			}
			var releases, snapshots int
			if err := fx.admin.QueryRow(context.Background(), `SELECT (SELECT count(*) FROM production_releases),(SELECT count(*) FROM production_release_manufacturing_snapshots)`).Scan(&releases, &snapshots); err != nil || releases != 0 || snapshots != 0 {
				t.Fatalf("partial capture %d/%d %v", releases, snapshots, err)
			}
		})
	}
}

func assertWarehouseFrozenHTTP(t *testing.T, fx *releaseFixture, handler http.Handler, request func(string, string, string) *httptest.ResponseRecorder, releaseID string, frozen *storage.ReleaseManufacturingSnapshot) {
	t.Helper()
	path := "/api/projects/" + fx.projectID + "/materials/"
	body := fmt.Sprintf(`{"production_release_id":%q}`, releaseID)
	read := func() *domain.MaterialPlanning {
		t.Helper()
		var plan *domain.MaterialPlanning
		if err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
			project, err := fx.store.GetProjectByID(ctx, fx.projectID)
			if err == nil {
				plan = project.MaterialPlanning
			}
			return err
		}); err != nil {
			t.Fatal(err)
		}
		return plan
	}
	expect := func(target, payload string, code int) *httptest.ResponseRecorder {
		t.Helper()
		rr := request(target, "", payload)
		if rr.Code != code {
			t.Fatalf("%s status=%d want=%d %s", target, rr.Code, code, rr.Body.String())
		}
		return rr
	}
	for _, command := range []string{"reserve", "release"} {
		expect(path+command, `{}`, 409)
		expect(path+command, `{"production_release_id":"70000000-0000-4000-8000-000000000099"}`, 409)
		expect("/api/projects/"+fiProjectAOnly+"/materials/"+command, body, 409)
	}
	expect(path+"reserve", fmt.Sprintf(`{"production_release_id":%q,"lines":[{"kind":"tableros","material_id":%q,"quantity":-1}]}`, releaseID, releaseMaterial), 400)
	// Org B cannot reserve or read Org A's manufacturing planning via the real router.
	var membership string
	var memberVersion, orgVersion int64
	if err := fx.admin.QueryRow(context.Background(), `SELECT m.id,m.credential_version,o.credential_version FROM memberships m JOIN organizations o ON o.id=m.organization_id WHERE m.organization_id=$1 AND m.user_id=$2`, rlsOrgB, rlsUserB).Scan(&membership, &memberVersion, &orgVersion); err != nil {
		t.Fatal(err)
	}
	token, err := auth.GenerateLegacyWebToken(rlsUserB, "rls-b@example.test", auth.TokenContext{Roles: []string{string(domain.RoleAdmin)}, OrgID: rlsOrgB, MembershipID: membership, MembershipCredentialVersion: memberVersion, OrganizationCredentialVersion: orgVersion}, "release-capture-http-test-secret")
	if err != nil {
		t.Fatal(err)
	}
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		target := strings.TrimSuffix(path, "/")
		if method == http.MethodPost {
			target += "/reserve"
		}
		req := httptest.NewRequest(method, target, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		if rr.Code != 403 && rr.Code != 404 {
			t.Fatalf("foreign %s=%d %s", method, rr.Code, rr.Body.String())
		}
	}
	// Insufficient stock is an honest audited shortage, never a successful reservation.
	expect(path+"reserve", body, 200)
	if len(read().Reservations) != 0 {
		t.Fatal("shortage created reservation")
	}
	required := frozen.Requirements[0].Quantity
	multiOrgExec(t, fx.admin, fmt.Sprintf(`INSERT INTO material_stock(kind,material_id,quantity,min_stock,organization_id) VALUES ('tableros','%s',%f,0,'%s')`, releaseMaterial, required, rlsOrgA))
	baseline, _ := json.Marshal(read())
	var eventCount int
	if err := fx.admin.QueryRow(context.Background(), `SELECT count(*) FROM project_events WHERE project_id=$1`, fx.projectID).Scan(&eventCount); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"projects", "project_events"} {
		multiOrgExec(t, fx.admin, `CREATE FUNCTION fail_warehouse_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'warehouse failure'; END; $$; CREATE TRIGGER fail_warehouse BEFORE `+map[string]string{"projects": "UPDATE", "project_events": "INSERT"}[table]+` ON `+table+` FOR EACH ROW EXECUTE FUNCTION fail_warehouse_test();`)
		expect(path+"reserve", body, 500)
		multiOrgExec(t, fx.admin, `DROP TRIGGER fail_warehouse ON `+table+`; DROP FUNCTION fail_warehouse_test();`)
		current, _ := json.Marshal(read())
		var count int
		if err := fx.admin.QueryRow(context.Background(), `SELECT count(*) FROM project_events WHERE project_id=$1`, fx.projectID).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if string(current) != string(baseline) || count != eventCount {
			t.Fatalf("%s failure survived rollback", table)
		}
	}
	// Huge repeated client lines cannot exceed frozen demand or warehouse stock.
	expect(path+"reserve", fmt.Sprintf(`{"production_release_id":%q,"lines":[{"kind":"tableros","material_id":%q,"quantity":999},{"kind":"tableros","material_id":%q,"quantity":999}]}`, releaseID, releaseMaterial, releaseMaterial), 200)
	plan := read()
	if len(plan.Reservations) != 1 || plan.Reservations[0].Quantity != required || !reflect.DeepEqual(plan.Requirements.Lines, frozen.Requirements) || plan.Requirements.SourceDesignRevisionID != frozen.Release.DesignRevisionID || plan.Requirements.BomFingerprint != frozen.Release.ManufacturingFingerprint {
		t.Fatalf("frozen reservation mismatch: %+v", plan)
	}
	retry := expect(path+"reserve", body, 200)
	if !strings.Contains(retry.Body.String(), `"events_appended":0`) || len(read().Reservations) != 1 {
		t.Fatal("reserve-all retry duplicated reservation/audit")
	}
	// Stale persisted provenance cannot be rebound silently through derive or reserve.
	saved, _ := json.Marshal(plan)
	multiOrgExec(t, fx.admin, `UPDATE projects SET material_planning=jsonb_set(material_planning,'{requirements,release_id}','"old-release"') WHERE id='`+fx.projectID+`'`)
	expect(path+"reserve", body, 409)
	expect(path+"release", body, 409)
	expect(path+"derive", body, 409)
	if _, err := fx.admin.Exec(context.Background(), `UPDATE projects SET material_planning=$2 WHERE id=$1`, fx.projectID, saved); err != nil {
		t.Fatal(err)
	}
	expect(path+"release", body, 200)
	if read().Release == nil {
		t.Fatal("release evidence absent")
	}
	expect(path+"release", body, 409)
	var payload []byte
	if err := fx.admin.QueryRow(context.Background(), `SELECT payload FROM project_events WHERE project_id=$1 AND type='materials_ready'`, fx.projectID).Scan(&payload); err != nil {
		t.Fatal(err)
	}
	var evidence map[string]any
	if err := json.Unmarshal(payload, &evidence); err != nil {
		t.Fatal(err)
	}
	if evidence["release_id"] != releaseID || evidence["design_revision_id"] != frozen.Release.DesignRevisionID || evidence["line_count"] != float64(len(frozen.Requirements)) {
		t.Fatalf("release provenance=%s", payload)
	}
	// Legacy-only project remains supported; no canonical ID inferred or required.
	multiOrgExec(t, fx.admin, `UPDATE projects SET production_release='{"id":"legacy-only","bomFingerprint":"legacy-fp"}' WHERE id='`+fiProjectAOnly+`'`)
	legacyPath := "/api/projects/" + fiProjectAOnly + "/materials/"
	expect(legacyPath+"derive", fmt.Sprintf(`{"lines":[{"kind":"tableros","material_id":%q,"quantity":1}]}`, releaseMaterial), 200)
	expect(legacyPath+"reserve", `{}`, 200)
	var legacyRaw []byte
	if err := fx.admin.QueryRow(context.Background(), `SELECT material_planning FROM projects WHERE id=$1`, fiProjectAOnly).Scan(&legacyRaw); err != nil {
		t.Fatal(err)
	}
	var legacy domain.MaterialPlanning
	if err := json.Unmarshal(legacyRaw, &legacy); err != nil {
		t.Fatal(err)
	}
	if legacy.Requirements.ReleaseID != "legacy-only" || len(legacy.Reservations) != 1 {
		t.Fatalf("legacy compatibility=%s", legacyRaw)
	}

}

// Both calls bracket later revision publication plus project/catalog/legacy drift.
// No synthetic CNC/no-CNC receipt is inserted into the immutable snapshot.
func assertExecutionRoutingBlockedHTTP(t *testing.T, fx *releaseFixture, handler http.Handler, token string, frozen *storage.ReleaseManufacturingSnapshot) {
	t.Helper()
	path := "/api/projects/" + fx.projectID
	request := func(method, target, credential, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, target, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+credential)
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		return rr
	}
	read := func() string {
		rr := request(http.MethodGet, path+"/part-executions", token, "")
		if rr.Code != 200 {
			t.Fatalf("execution read=%d %s", rr.Code, rr.Body.String())
		}
		return rr.Body.String()
	}
	persisted := func() string {
		var state string
		if err := fx.admin.QueryRow(context.Background(), `SELECT jsonb_build_array(part_instances,module_units,quality,
 (SELECT count(*) FROM project_item_floor_events WHERE project_id=$1),
 (SELECT count(*) FROM project_events WHERE project_id=$1))::text FROM projects WHERE id=$1`, fx.projectID).Scan(&state); err != nil {
			t.Fatal(err)
		}
		return state
	}
	beforeState := persisted()
	before := read()
	// Client geometry, identity and claimed routes never establish authority.
	for _, identity := range []struct{ project, release, item string }{
		{fx.projectID, frozen.Release.ID, fx.fiA},
		{fiProjectAOnly, frozen.Release.ID, fx.fiA},
		{fx.projectID, "wrong-release", fx.fiA},
		{fx.projectID, frozen.Release.DesignRevisionID, fx.fiA},
		{fx.projectID, "rev-1", fx.fiA},
		{fx.projectID, frozen.Release.ID, "foreign-furniture"},
	} {
		body := fmt.Sprintf(`{"force":true,"part_instances":[{"id":"forged-part","project_id":%q,"project_item_id":%q,"production_revision":%q,"length_mm":999,"required_operations":[{"type":"cut"}]}],"module_units":[{"id":"forged-unit","project_id":%q,"project_item_id":%q,"production_revision":%q}]}`,
			identity.project, identity.item, identity.release, identity.project, identity.item, identity.release)
		for retry := 0; retry < 2; retry++ {
			rr := request(http.MethodPut, path+"/part-executions", token, body)
			if rr.Code != 409 || !strings.Contains(rr.Body.String(), "evidencia congelada de rutas y maquinados") {
				t.Fatalf("forged execution=%d %s", rr.Code, rr.Body.String())
			}
		}
	}
	for _, command := range []struct{ suffix, body string }{
		{"/parts/forged-part/advance", `{"advance":true}`},
		{"/parts/forged-part/rework", `{"action":"rework","reason":"must not bypass"}`},
		{"/parts/forged-part/rework", `{"action":"refabricate","reason":"must not bypass"}`},
		{"/units/forged-unit/advance", `{"advance":true}`},
		{"/units/forged-unit/assembly-override", `{"reason":"must not bypass"}`},
	} {
		rr := request(http.MethodPost, path+command.suffix, token, command.body)
		if rr.Code != 409 || !strings.Contains(rr.Body.String(), "evidencia congelada de rutas y maquinados") {
			t.Fatalf("station %s=%d %s", command.suffix, rr.Code, rr.Body.String())
		}
	}
	if after := read(); after != before {
		t.Fatalf("rejected commands changed executions: %s", after)
	}
	if persisted() != beforeState {
		t.Fatal("rejected commands changed physical state or emitted business events")
	}
	// A correct P1 token also cannot authorize a different project's URL.
	foreignPath := "/api/projects/" + fiProjectAOnly + "/part-executions"
	rr := request(http.MethodPut, foreignPath, token, fmt.Sprintf(`{"part_instances":[{"production_revision":%q}],"module_units":[{"production_revision":%q}]}`, frozen.Release.ID, frozen.Release.ID))
	if rr.Code != 409 {
		t.Fatalf("foreign project path=%d %s", rr.Code, rr.Body.String())
	}
	// Shared Org B cannot read or invoke this owner's execution context.
	var membership string
	var memberVersion, orgVersion int64
	if err := fx.admin.QueryRow(context.Background(), `SELECT m.id,m.credential_version,o.credential_version
 FROM memberships m JOIN organizations o ON o.id=m.organization_id
 WHERE m.organization_id=$1 AND m.user_id=$2`, rlsOrgB, rlsUserB).Scan(&membership, &memberVersion, &orgVersion); err != nil {
		t.Fatal(err)
	}
	foreignToken, err := auth.GenerateLegacyWebToken(rlsUserB, "rls-b@example.test", auth.TokenContext{
		Roles: []string{string(domain.RoleAdmin)}, OrgID: rlsOrgB, MembershipID: membership,
		MembershipCredentialVersion: memberVersion, OrganizationCredentialVersion: orgVersion,
	}, "release-capture-http-test-secret")
	if err != nil {
		t.Fatal(err)
	}
	for _, method := range []string{http.MethodGet, http.MethodPut, http.MethodPost} {
		target := path + "/part-executions"
		if method == http.MethodPost {
			target = path + "/units/forged-unit/assembly-override"
		}
		rr := request(method, target, foreignToken, `{"reason":"foreign","part_instances":[{}],"module_units":[{}]}`)
		if rr.Code != 403 && rr.Code != 404 {
			t.Fatalf("foreign %s=%d %s", method, rr.Code, rr.Body.String())
		}
	}
}
