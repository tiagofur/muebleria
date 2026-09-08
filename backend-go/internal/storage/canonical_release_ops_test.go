package storage_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/api"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #577 / OPS-DT-1 storage proofs against real PostgreSQL: the project read
// model exposes the server-owned resolved release authority (canonical wins
// over a coexisting legacy blob; legacy-only projects keep the compatibility
// projection), and material planning derivation binds to the EXACT canonical
// release id with full provenance pins — R4 never retargets a P1-derived
// plan and the legacy blob stays null through the canonical path.

func opsDt1CreateReleaseP1(t *testing.T, fx *releaseFixture) *storage.ProductionReleaseReadback {
	t.Helper()
	actorA := fiActorA()
	var p1 *storage.ProductionReleaseReadback
	err := releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
		var err error
		p1, err = fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
			ProjectID:        fx.projectID,
			DesignRevisionID: fx.revR3,
			QuoteRevisionID:  fx.quoteQ3,
			ActorUserID:      rlsUserA,
			RequestID:        "req-opsdt1-p1",
		})
		return err
	})
	if err != nil {
		t.Fatalf("create release P1: %v", err)
	}
	return p1
}

func opsDt1DeriveFromRelease(t *testing.T, fx *releaseFixture, releaseID string, wantErr bool) *domain.MaterialPlanning {
	t.Helper()
	actorA := fiActorA()
	var planning *domain.MaterialPlanning
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		_, mErr := fx.store.MutateProjectMaterialPlanningForRelease(ctx, fx.projectID, releaseID, func(snap *domain.MaterialPlanningSnapshot) (*domain.MaterialPlanningMutation, error) {
			if snap.ProductionRelease == nil || snap.ProductionRelease.ReleaseID == "" {
				return nil, errOpsNoRelease
			}
			if snap.CanonicalReleaseExists && releaseID == "" {
				return nil, errOpsImplicitLatest
			}
			release := snap.ProductionRelease
			next := &domain.MaterialPlanning{
				ID:        domain.NewMaterialPlanningID("mplan"),
				ProjectID: fx.projectID,
				Requirements: &domain.MaterialRequirementsSnapshot{
					ReleaseID:                     release.ReleaseID,
					BomFingerprint:                release.ManufacturingFingerprint,
					SourceProductionReleaseID:     release.ReleaseID,
					SourceProductionReleaseNumber: release.ReleaseNumber,
					SourceDesignRevisionID:        release.DesignRevisionID,
					SourceDesignRevisionNumber:    release.DesignRevisionNumber,
					SourceQuoteRevisionID:         release.QuoteRevisionID,
					Lines: []domain.MaterialRequirementLine{
						{Kind: "tableros", MaterialID: releaseMaterial, Quantity: 4},
					},
				},
				Reservations: []domain.MaterialReservation{},
			}
			if err := domain.ValidateMaterialPlanningShape(next); err != nil {
				return nil, err
			}
			return &domain.MaterialPlanningMutation{Planning: next}, nil
		})
		if mErr != nil {
			return mErr
		}
		proj, pErr := fx.store.GetProjectByID(ctx, fx.projectID)
		if pErr != nil {
			return pErr
		}
		planning = proj.MaterialPlanning
		return nil
	})
	if wantErr {
		if err == nil {
			t.Fatalf("derive from release %q must fail, got success", releaseID)
		}
		return nil
	}
	if err != nil {
		t.Fatalf("derive from release %q: %v", releaseID, err)
	}
	var got *domain.MaterialPlanning
	if planning != nil && planning.Requirements != nil {
		got = planning
	}
	if got == nil {
		t.Fatalf("derive must persist requirements")
	}
	return got
}

type opsDt1Error struct{ msg string }

func (e opsDt1Error) Error() string { return e.msg }

var (
	errOpsNoRelease      = opsDt1Error{"no release authority"}
	errOpsImplicitLatest = opsDt1Error{"implicit latest rejected"}
)

func TestOpsDt1_ProjectReadModelResolvesCanonicalAuthority(t *testing.T) {
	fx := setupReleaseFixture(t)
	actorA := fiActorA()
	p1 := opsDt1CreateReleaseP1(t, fx)

	// A stale legacy OC-022 blob coexisting on the row must NEVER win the
	// projection once a canonical release exists.
	if _, err := fx.admin.Exec(context.Background(), `
		UPDATE projects SET production_release = $1 WHERE id = $2`,
		`{"id":"legacy-rel-9","project_id":"`+fx.projectID+`","project_version":9,"design_revision_id":"legacy-dr","bom_fingerprint":"legacy-fp","released_by":"legacy-user","released_at":"2026-01-01T00:00:00Z"}`,
		fx.projectID); err != nil {
		t.Fatalf("seed stale legacy blob: %v", err)
	}

	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		p, err := fx.store.GetProjectByID(ctx, fx.projectID)
		if err != nil {
			return err
		}
		if p.ResolvedProductionRelease == nil {
			return opsDt1Error{"detail read must expose the resolved authority"}
		}
		projection := p.ResolvedProductionRelease
		if projection.Source != domain.ProductionReleaseAuthorityCanonical ||
			projection.ReleaseID != p1.Release.ID ||
			projection.ReleaseNumber != 1 ||
			projection.DesignRevisionID != fx.revR3 ||
			projection.QuoteRevisionID != fx.quoteQ3 ||
			projection.Status != domain.ProductionReleaseStatusActive ||
			!strings.HasPrefix(projection.ManufacturingFingerprint, "sha256-") {
			return opsDt1Error{"canonical projection pins mismatch: " + string(projection.Source) + " " + projection.ReleaseID}
		}
		if p.ProductionRelease == nil || p.ProductionRelease.ID != "legacy-rel-9" {
			return opsDt1Error{"legacy blob must remain readable as compatibility state"}
		}

		list, err := fx.store.ListProjects(ctx)
		if err != nil {
			return err
		}
		for _, lp := range list {
			if lp.ID != fx.projectID {
				continue
			}
			if lp.ResolvedProductionRelease == nil || lp.ResolvedProductionRelease.Source != domain.ProductionReleaseAuthorityCanonical ||
				lp.ResolvedProductionRelease.ReleaseID != p1.Release.ID {
				return opsDt1Error{"list read must expose the same canonical projection"}
			}
			return nil
		}
		return opsDt1Error{"project missing from list"}
	})
	if err != nil {
		t.Fatalf("read model authority projection: %v", err)
	}
}

func TestOpsDt1_LegacyOnlyProjectKeepsCompatibilityProjection(t *testing.T) {
	fx := setupReleaseFixture(t)
	actorA := fiActorA()

	if _, err := fx.admin.Exec(context.Background(), `
		UPDATE projects SET production_release = $1 WHERE id = $2`,
		`{"id":"legacy-rel-1","project_id":"`+fx.projectID+`","project_version":3,"design_revision_id":"legacy-dr","bom_fingerprint":"legacy-fp","released_by":"legacy-user","released_at":"2026-01-01T00:00:00Z"}`,
		fx.projectID); err != nil {
		t.Fatalf("seed legacy blob: %v", err)
	}

	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		p, err := fx.store.GetProjectByID(ctx, fx.projectID)
		if err != nil {
			return err
		}
		if p.ResolvedProductionRelease == nil || p.ResolvedProductionRelease.Source != domain.ProductionReleaseAuthorityLegacy ||
			p.ResolvedProductionRelease.ReleaseID != "legacy-rel-1" ||
			p.ResolvedProductionRelease.ManufacturingFingerprint != "legacy-fp" ||
			p.ResolvedProductionRelease.ProjectVersion != 3 {
			return opsDt1Error{"legacy-only projection mismatch"}
		}
		return nil
	})
	if err != nil {
		t.Fatalf("legacy-only projection: %v", err)
	}
}

func TestOpsDt1_MaterialDeriveBindsExactCanonicalRelease(t *testing.T) {
	fx := setupReleaseFixture(t)
	actorA := fiActorA()
	p1 := opsDt1CreateReleaseP1(t, fx)

	// 1. Exact P1 derivation stamps the full provenance pins.
	planning := opsDt1DeriveFromRelease(t, fx, p1.Release.ID, false)
	req := planning.Requirements
	if req.SourceProductionReleaseID != p1.Release.ID ||
		req.SourceProductionReleaseNumber != 1 ||
		req.SourceDesignRevisionID != fx.revR3 ||
		req.SourceQuoteRevisionID != fx.quoteQ3 ||
		req.BomFingerprint != p1.Release.ManufacturingFingerprint {
		t.Fatalf("requirements provenance mismatch: %+v", req)
	}

	// 2. Foreign release id is rejected (missing and cross-project are the
	// same answer).
	opsDt1DeriveFromRelease(t, fx, "7fffffff-0000-0000-0000-000000000099", true)

	// 3. The canonical negative proof: publish R4 with a manufacturing change
	// — deriving from P1 again keeps the R3 pins; nothing retargets.
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		if _, err := fx.store.UpdateDesignWorkingCopy(ctx, storage.UpdateDesignWorkingCopyCommand{
			DesignID:   fx.designID,
			SourceType: domain.DesignRevisionSourceSketchup,
			Items: []storage.UpdateDesignWorkingCopyItemCommand{
				{FurnitureInstanceID: fx.fiA, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 650.0, "heightMm": 720.0, "depthMm": 560.0}, MaterialChoices: map[string]string{"BODY": releaseMaterial}},
				{FurnitureInstanceID: fx.fiB, FurnitureDefinitionID: fiModuleA, Parameters: map[string]any{"widthMm": 600.0, "heightMm": 720.0, "depthMm": 560.0}, MaterialChoices: map[string]string{"BODY": releaseMaterial}},
			},
			ActorUserID: rlsUserA,
		}); err != nil {
			return err
		}
		_, err := fx.store.PublishDesignRevision(ctx, storage.PublishDesignRevisionCommand{
			DesignID:       fx.designID,
			BaseRevisionID: fx.revR3,
			SourceType:     domain.DesignRevisionSourceSketchup,
			ActorUserID:    rlsUserA,
		})
		return err
	})
	if err != nil {
		t.Fatalf("publish R4: %v", err)
	}

	afterR4 := opsDt1DeriveFromRelease(t, fx, p1.Release.ID, false)
	if afterR4.Requirements.SourceDesignRevisionID != fx.revR3 ||
		afterR4.Requirements.BomFingerprint != p1.Release.ManufacturingFingerprint {
		t.Fatalf("R4 must not retarget a P1-derived plan: %+v", afterR4.Requirements)
	}

	// 4. Legacy blob stays null through the whole canonical path — no second,
	// legacy release is ever needed (critical negative proof).
	var legacyNull bool
	if err := fx.admin.QueryRow(context.Background(),
		`SELECT production_release IS NULL FROM projects WHERE id = $1`, fx.projectID).Scan(&legacyNull); err != nil {
		t.Fatalf("read legacy blob state: %v", err)
	}
	if !legacyNull {
		t.Fatalf("canonical flow must leave projects.production_release null")
	}
}

func TestOpsDt1_ExecutionMutationFrozenRoutingGate(t *testing.T) {
	fx := setupReleaseFixture(t)
	p1 := opsDt1CreateReleaseP1(t, fx)
	// Current quote quantity cannot become released physical membership.
	if _, err := fx.admin.Exec(context.Background(), `UPDATE project_items SET quantity = 9 WHERE project_id = $1`, fx.projectID); err != nil {
		t.Fatal(err)
	}
	// Frozen v2 routing authorizes the station mutation — with membership
	// still the frozen revision's, never the editable quote's.
	stationRan := false
	err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		frozen, err := fx.store.GetProductionReleaseManufacturingSnapshot(ctx, fx.projectID, p1.Release.ID)
		if err != nil || len(frozen.Units) != 2 || frozen.Units[0].Resolved.FurnitureInstanceID == frozen.Units[1].Resolved.FurnitureInstanceID {
			t.Fatalf("released physical membership changed: %+v %v", frozen, err)
		}
		if frozen.SchemaVersion != 2 || frozen.Routing == nil || len(frozen.Routing.Units) != 2 {
			t.Fatalf("P1 must freeze schema-v2 routing evidence: %+v", frozen)
		}
		_, err = fx.store.MutateProjectPartExecutions(ctx, fx.projectID, func(snap *domain.PartExecutionsSnapshot) (*domain.PartExecutionsMutation, error) {
			stationRan = true
			return &domain.PartExecutionsMutation{Parts: snap.Parts, Units: snap.Units, ItemStatuses: snap.ItemStatuses}, nil
		})
		return err
	})
	if err != nil || !stationRan {
		t.Fatalf("station mutation must run with frozen v2 routing evidence (err=%v)", err)
	}

	// Historical schema-v1 snapshot keeps failing closed for EVERY station
	// command — missing machining evidence is never a no-CNC verdict.
	multiOrgExec(t, fx.admin, `ALTER TABLE production_release_manufacturing_snapshots DISABLE TRIGGER protect_release_manufacturing_snapshots_immutable`)
	t.Cleanup(func() {
		multiOrgExec(t, fx.admin, `ALTER TABLE production_release_manufacturing_snapshots ENABLE TRIGGER protect_release_manufacturing_snapshots_immutable`)
	})
	if _, err := fx.admin.Exec(context.Background(), `
		UPDATE production_release_manufacturing_snapshots
		SET schema_version = 1,
		    payload = (payload - 'routing') || '{"schemaVersion":1}'::jsonb
		WHERE release_id = $1`, p1.Release.ID); err != nil {
		t.Fatalf("simulate historical v1 snapshot: %v", err)
	}
	err = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
		_, err := fx.store.MutateProjectPartExecutions(ctx, fx.projectID, func(snap *domain.PartExecutionsSnapshot) (*domain.PartExecutionsMutation, error) {
			t.Fatal("no station callback may run without frozen routing evidence")
			return nil, nil
		})
		return err
	})
	if !errors.Is(err, storage.ErrReleaseRoutingUnavailable) {
		t.Fatalf("want frozen routing blocker, got %v", err)
	}
}

// #577 frozen-routing golden path: P1 freezes the schema-v2 neutral routing
// program; the program survives later revisions and catalog/project mutation
// byte-for-byte; canonical executions derive EXCLUSIVELY server-side (empty
// request body) with exact release-scoped identities; retry is idempotent;
// the routing blocker disappears from readiness; a historical schema-v1
// snapshot keeps the generation fail-closed.
func TestOpsDt1_CanonicalExecutionFromFrozenRouting(t *testing.T) {
	fx := setupReleaseFixture(t)
	// This fixture's operational owner is Org A; retain Org B as a shared reader.
	multiOrgExec(t, fx.admin, `ALTER TABLE projects DISABLE TRIGGER protect_project_organization_ownership;
 UPDATE projects SET manufacturing_organization_id=organization_id WHERE id='`+fx.projectID+`';
 ALTER TABLE projects ENABLE TRIGGER protect_project_organization_ownership;`)
	p1 := opsDt1CreateReleaseP1(t, fx)
	ctx := context.Background()

	// 1. Frozen evidence: schema v2 with complete neutral provenance.
	frozen := func() *storage.ReleaseManufacturingSnapshot {
		var snap *storage.ReleaseManufacturingSnapshot
		if err := fiTx(t, fx.store, fiActorA(), func(inner context.Context) error {
			var err error
			snap, err = fx.store.GetProductionReleaseManufacturingSnapshot(inner, fx.projectID, p1.Release.ID)
			return err
		}); err != nil {
			t.Fatalf("read frozen snapshot: %v", err)
		}
		return snap
	}
	before := frozen()
	if before.SchemaVersion != 2 || before.Routing == nil {
		t.Fatalf("P1 must freeze schema-v2 routing evidence, got v%d routing=%v", before.SchemaVersion, before.Routing != nil)
	}
	if len(before.Routing.Units) != len(before.Units) {
		t.Fatalf("routing covers %d units, snapshot froze %d", len(before.Routing.Units), len(before.Units))
	}
	coverage := map[string]bool{fx.fiA: false, fx.fiB: false}
	for _, unit := range before.Routing.Units {
		if unit.MachiningFingerprint == "" {
			t.Fatalf("routing unit %s carries no machining fingerprint", unit.FurnitureInstanceID)
		}
		for _, part := range unit.Parts {
			if !part.Cut || part.CncRequired != (len(part.Operations) > 0) {
				t.Fatalf("routing part %s lost its resolved verdict", part.PartID)
			}
		}
		if _, ok := coverage[unit.FurnitureInstanceID]; ok {
			coverage[unit.FurnitureInstanceID] = true
		}
	}
	for instance, covered := range coverage {
		if !covered {
			t.Fatalf("routing does not cover furniture instance %s", instance)
		}
	}

	// 2. Frozen invariant: a later published revision plus project/catalog
	// mutation never touches the frozen routing bytes.
	if err := fiTx(t, fx.store, fiActorA(), func(inner context.Context) error {
		_, err := fx.store.PublishDesignRevision(inner, storage.PublishDesignRevisionCommand{
			DesignID:       fx.designID,
			BaseRevisionID: fx.revR3,
			SourceType:     domain.DesignRevisionSourceManual,
			ActorUserID:    rlsUserA,
		})
		return err
	}); err != nil {
		t.Fatalf("publish R4: %v", err)
	}
	multiOrgExec(t, fx.admin, `UPDATE project_items SET quantity=99 WHERE project_id='`+fx.projectID+`';
 UPDATE components SET length_mm=999 WHERE code='RELEASE-PANEL';
 UPDATE material_boards SET thickness_mm=30 WHERE code='RELEASE-BOARD';`)
	after := frozen()
	beforeJSON, _ := json.Marshal(before.Routing)
	afterJSON, _ := json.Marshal(after.Routing)
	if string(beforeJSON) != string(afterJSON) {
		t.Fatal("frozen routing program mutated after revision/catalog changes")
	}

	// 3. Server-derived canonical generation over HTTP (empty body).
	const secret = "opsdt1-frozen-routing-http-test-secret-0123456789"
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
	call := func(method, target, credential, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, target, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+credential)
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		return rr
	}
	executionsPath := "/api/projects/" + fx.projectID + "/part-executions"
	rr := call(http.MethodPut, executionsPath, token, `{}`)
	if rr.Code != 200 {
		t.Fatalf("canonical generation=%d %s", rr.Code, rr.Body.String())
	}
	var generated struct {
		Parts []domain.PartInstance        `json:"part_instances"`
		Units []domain.ModuleUnitExecution `json:"module_units"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &generated); err != nil {
		t.Fatal(err)
	}
	if len(generated.Units) != 2 || len(generated.Parts) == 0 {
		t.Fatalf("derived executions units=%d parts=%d", len(generated.Units), len(generated.Parts))
	}
	instanceByID := map[string]bool{fx.fiA: true, fx.fiB: true}
	for _, part := range generated.Parts {
		if part.ProductionRevision != p1.Release.ID || !strings.HasPrefix(part.ID, p1.Release.ID+":") ||
			!instanceByID[part.ProjectItemID] || part.Status != domain.PartInstanceStatusPending {
			t.Fatalf("part identity/stamp drifted: %+v", part)
		}
		if len(part.RequiredOperations) == 0 || part.RequiredOperations[0].Type != domain.PartOperationCut {
			t.Fatalf("route must start at cut: %+v", part)
		}
	}
	for _, unit := range generated.Units {
		if unit.ProductionRevision != p1.Release.ID || !instanceByID[unit.ProjectItemID] ||
			unit.Status != domain.ModuleUnitStatusAwaitingParts {
			t.Fatalf("unit identity/stamp drifted: %+v", unit)
		}
	}

	// 4. Retry is idempotent: same derived content, no duplicates persisted.
	retry := call(http.MethodPut, executionsPath, token, `{}`)
	if retry.Code != 200 {
		t.Fatalf("canonical retry=%d %s", retry.Code, retry.Body.String())
	}
	var retried struct {
		Parts []domain.PartInstance        `json:"part_instances"`
		Units []domain.ModuleUnitExecution `json:"module_units"`
	}
	if err := json.Unmarshal(retry.Body.Bytes(), &retried); err != nil {
		t.Fatal(err)
	}
	if len(retried.Parts) != len(generated.Parts) || len(retried.Units) != len(generated.Units) {
		t.Fatalf("retry derived different content: %d/%d vs %d/%d",
			len(retried.Parts), len(retried.Units), len(generated.Parts), len(generated.Units))
	}
	var storedParts int
	if err := fx.admin.QueryRow(ctx,
		`SELECT jsonb_array_length(part_instances) FROM projects WHERE id=$1`, fx.projectID).Scan(&storedParts); err != nil {
		t.Fatal(err)
	}
	if storedParts != len(generated.Parts) {
		t.Fatalf("persisted parts=%d want %d (duplicate artifacts?)", storedParts, len(generated.Parts))
	}

	// 5. Readiness no longer carries the routing blocker; the projection
	// exposes frozen_routing=true.
	readiness := call(http.MethodGet, executionsPath, token, "")
	if readiness.Code != 200 || strings.Contains(readiness.Body.String(), "rutas y maquinados") {
		t.Fatalf("v2 readiness must drop the routing blocker: %d %s", readiness.Code, readiness.Body.String())
	}
	projectRR := call(http.MethodGet, "/api/projects/"+fx.projectID, token, "")
	if projectRR.Code != 200 || !strings.Contains(projectRR.Body.String(), `"frozen_routing":true`) {
		t.Fatalf("projection must expose frozen_routing=true: %d %s", projectRR.Code, projectRR.Body.String())
	}

	// 6. Shared org B cannot invoke the owner's canonical generation.
	var membershipB string
	var memberVersionB, orgVersionB int64
	if err := fx.admin.QueryRow(ctx, `SELECT m.id,m.credential_version,o.credential_version
 FROM memberships m JOIN organizations o ON o.id=m.organization_id
 WHERE m.organization_id=$1 AND m.user_id=$2`, rlsOrgB, rlsUserB).Scan(&membershipB, &memberVersionB, &orgVersionB); err != nil {
		t.Fatal(err)
	}
	foreignToken, err := auth.GenerateLegacyWebToken(rlsUserB, "rls-b@example.test", auth.TokenContext{
		Roles: []string{string(domain.RoleAdmin)}, OrgID: rlsOrgB, MembershipID: membershipB,
		MembershipCredentialVersion: memberVersionB, OrganizationCredentialVersion: orgVersionB,
	}, secret)
	if err != nil {
		t.Fatal(err)
	}
	if rr := call(http.MethodPut, "/api/projects/"+fiProjectAOnly+"/part-executions", foreignToken, `{}`); rr.Code != 403 && rr.Code != 404 {
		t.Fatalf("foreign canonical generation=%d %s", rr.Code, rr.Body.String())
	}

	// 7. Historical schema-v1 snapshot: canonical generation keeps failing
	// closed with the frozen routing blocker.
	multiOrgExec(t, fx.admin, `ALTER TABLE production_release_manufacturing_snapshots DISABLE TRIGGER protect_release_manufacturing_snapshots_immutable;
 UPDATE production_release_manufacturing_snapshots SET schema_version=1, payload=(payload - 'routing') || '{"schemaVersion":1}'::jsonb;
 ALTER TABLE production_release_manufacturing_snapshots ENABLE TRIGGER protect_release_manufacturing_snapshots_immutable;`)
	if rr := call(http.MethodPut, executionsPath, token, `{}`); rr.Code != 409 ||
		!strings.Contains(rr.Body.String(), "rutas y maquinados") {
		t.Fatalf("v1 canonical generation=%d %s", rr.Code, rr.Body.String())
	}
}
