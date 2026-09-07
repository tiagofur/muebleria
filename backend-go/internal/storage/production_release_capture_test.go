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
