package storage_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/tiagofur/muebles-backend/internal/api"
	"github.com/tiagofur/muebles-backend/internal/application"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #995 K1: the frozen manufacturing routing program leaves the server through
// an authorized, tenant-safe endpoint so the production pack exports the
// EXACT holes the release gates validated — with provenance — instead of the
// legacy heuristic chain. The governed world is the freeze test's: two units,
// one governed shelf joint, factory policy 4 ⇒ per unit 2 contacts × 4
// stations ⇒ 8 holes of Ø15 and 8 of Ø8.
func TestProductionManufacturingSnapshotEndpointServesFrozenRouting(t *testing.T) {
	const (
		sideL   = "78000000-0000-0000-0000-0000000000a1"
		sideR   = "78000000-0000-0000-0000-0000000000a2"
		shelf   = "78000000-0000-0000-0000-0000000000a3"
		hwA     = "78000000-0000-0000-0000-0000000000a4"
		profA   = "78000000-0000-0000-0000-0000000000a5"
		binding = `[{"name":"shelfJoints","label":"Fijaciones de entrepaño","type":"number","defaultValue":3,"required":true,"integer":true,"unit":"count","category":"configuration","binding":{"version":1,"kind":"structureRelationship","componentId":"` + shelf + `","relationship":{"kind":"fixed-shelf-side","sourceRole":"shelf-edge","targets":[{"componentId":"` + sideL + `","role":"side","face":"front"},{"componentId":"` + sideR + `","role":"side","face":"back"}],"station":{"startMarginMm":40,"endMarginMm":40}}}}]`
		recipe  = `{"recipeId":"k1:minifix","recipeRevision":"rev-1","variants":[
			{"targetFace":"front","rules":[
				{"ruleId":"k1-cam","ruleRevision":"rev-1","participantRole":"A","operationRole":"housing","entryFace":"bottom","offsetMm":[0,0,0],"axis":[0,-1,0],"diameterMm":15,"depthMm":13},
				{"ruleId":"k1-dowel","ruleRevision":"rev-1","participantRole":"B","operationRole":"dowel","entryFace":"back","offsetMm":[0,18,0],"axis":[0,-1,0],"diameterMm":8,"depthMm":17}]},
			{"targetFace":"back","rules":[
				{"ruleId":"k1-cam","ruleRevision":"rev-1","participantRole":"A","operationRole":"housing","entryFace":"top","offsetMm":[0,0,0],"axis":[0,-1,0],"diameterMm":15,"depthMm":13},
				{"ruleId":"k1-dowel","ruleRevision":"rev-1","participantRole":"B","operationRole":"dowel","entryFace":"front","offsetMm":[0,18,0],"axis":[0,-1,0],"diameterMm":8,"depthMm":17}]}]}`
	)

	fx := setupReleaseFixtureWithOptions(t, releaseFixtureOptions{
		choices: map[string]string{"BODY": releaseMaterial},
		seedCatalog: func(t *testing.T, admin *pgxpool.Pool) {
			t.Helper()
			statements := []string{
				`INSERT INTO components (id, code, name, placement, length_mm, width_mm, length_formula, width_formula, thickness_mm, option_roles, organization_id) VALUES
				 ('` + sideL + `', 'K1-LAT', 'K1 lateral izq', 'lateral_izquierdo', 684, 560, 'PH - 2*T', 'PD', 18, '{BODY}', '` + rlsOrgA + `'),
				 ('` + sideR + `', 'K1-LATD', 'K1 lateral der', 'lateral_derecho', 684, 560, 'PH - 2*T', 'PD', 18, '{BODY}', '` + rlsOrgA + `'),
				 ('` + shelf + `', 'K1-ENTRE', 'K1 entrepaño', 'interno', 564, 542, 'PW - 2*T', 'PD - T', 18, '{BODY}', '` + rlsOrgA + `')`,
				`INSERT INTO structure_components (structure_id, component_id, quantity, organization_id) VALUES
				 ('71000000-0000-0000-0000-000000000001', '` + sideL + `', 1, '` + rlsOrgA + `'),
				 ('71000000-0000-0000-0000-000000000001', '` + sideR + `', 1, '` + rlsOrgA + `'),
				 ('71000000-0000-0000-0000-000000000001', '` + shelf + `', 1, '` + rlsOrgA + `')`,
				`UPDATE modules SET parameter_definitions = '` + binding + `'::jsonb WHERE id='` + fiModuleA + `'`,
				`INSERT INTO hardwares (id, code, name, unit, cost_per_unit, organization_id)
				 VALUES ('` + hwA + `', 'K1-MINIFIX', 'Minifix K1', 'piece', 10, '` + rlsOrgA + `')`,
				`INSERT INTO hardware_profiles (id, organization_id, code, name, revision, items, recipe_ref, recipe, active)
				 VALUES ('` + profA + `', '` + rlsOrgA + `', 'PERF-K1', 'Unión K1', 'rev-1',
				 '[{"hardwareId":"` + hwA + `","quantity":1,"applicationRole":"cam"}]'::jsonb,
				 '{"recipeId":"k1:minifix","recipeRevision":"rev-1"}'::jsonb,
				 '` + recipe + `'::jsonb, TRUE)`,
			}
			for _, statement := range statements {
				if _, err := admin.Exec(context.Background(), statement); err != nil {
					t.Fatalf("seed governed catalog: %v", err)
				}
			}
			draftID := uuid.MustParse(domain.GraneteStandardDraftReleaseID)
			if _, err := admin.Exec(context.Background(), `UPDATE library_releases SET version = '0.1.0-k1' WHERE id = $1`, draftID); err != nil {
				t.Fatalf("retarget draft: %v", err)
			}
			if _, err := application.PublishStandardRelease(storage.WithOrgCtx(context.Background(), rlsOrgA), &storage.PostgresStore{Pool: admin}, draftID, uuid.MustParse(rlsUserA)); err != nil {
				t.Fatalf("publish: %v", err)
			}
		},
	})
	actorA := fiActorA()

	// Assignments + factory policy 4: the routing program freezes the
	// 4-station pattern exactly like the freeze test's R1.
	err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		for _, pair := range [][2]string{{sideL, "front"}, {sideR, "back"}} {
			if err := fx.store.SetComponentSideAssignment(ctx, &domain.ComponentSideAssignment{
				ComponentID: pair[0], Side: pair[1], ProfileID: profA,
			}); err != nil {
				return err
			}
		}
		overrides, _ := json.Marshal(map[string]any{
			"joint.shelfToSide.systemId":      "minifix-dowel",
			"joint.shelfToSide.stationsCount": 4,
			"joint.shelfToSide.startMarginMm": 40,
			"joint.shelfToSide.endMarginMm":   40,
		})
		release, err := fx.store.GetCurrentPublishedRelease(ctx, uuid.MustParse(domain.GraneteStandardLibraryID))
		if err != nil {
			return err
		}
		_, err = fx.store.CreateOverlay(ctx, &domain.LibraryOverlay{
			OrganizationID: uuid.MustParse(rlsOrgA), LibraryID: uuid.MustParse(domain.GraneteStandardLibraryID),
			BaseReleaseID: release.ID, Status: "active", Overrides: overrides,
		})
		return err
	})
	if err != nil {
		t.Fatalf("governed fixture state: %v", err)
	}

	var readback *storage.ProductionReleaseReadback
	err = releaseTx(t, fx.store, actorA, func(ctx context.Context) error {
		var innerErr error
		readback, innerErr = fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
			ProjectID:        fx.projectID,
			DesignRevisionID: fx.revR3,
			QuoteRevisionID:  fx.quoteQ3,
			ActorUserID:      rlsUserA,
		})
		return innerErr
	})
	if err != nil {
		t.Fatalf("create release: %v", err)
	}

	server := &api.Server{Store: fx.store}
	callSnapshot := func(t *testing.T, claims *auth.Claims) *httptest.ResponseRecorder {
		t.Helper()
		var body []byte
		if err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
			req := httptest.NewRequest(http.MethodGet,
				"/api/projects/"+fx.projectID+"/production-releases/"+readback.Release.ID+"/manufacturing-snapshot", nil)
			req.SetPathValue("projectId", fx.projectID)
			req.SetPathValue("releaseId", readback.Release.ID)
			req = req.WithContext(context.WithValue(ctx, api.UserContextKey, claims))
			rr := httptest.NewRecorder()
			server.HandleProjectProductionManufacturingSnapshot(rr, req)
			body = rr.Body.Bytes()
			if rr.Code != http.StatusOK {
				t.Fatalf("snapshot status = %d (body=%s)", rr.Code, rr.Body.String())
			}
			return nil
		}); err != nil {
			t.Fatalf("tenant tx: %v", err)
		}
		rr := httptest.NewRecorder()
		rr.WriteHeader(http.StatusOK)
		rr.Write(body)
		return rr
	}
	adminClaims := func() *auth.Claims {
		return &auth.Claims{UserID: rlsUserA, Role: string(domain.RoleAdmin), Roles: []string{string(domain.RoleAdmin)}}
	}

	rr := callSnapshot(t, adminClaims())
	var snapshot struct {
		SchemaVersion int `json:"schemaVersion"`
		Release       struct {
			ID                       string `json:"id"`
			ReleaseNumber            int    `json:"releaseNumber"`
			ManufacturingFingerprint string `json:"manufacturingFingerprint"`
		} `json:"release"`
		Routing struct {
			Contract string `json:"contract"`
			Units    []struct {
				FurnitureInstanceID string `json:"furnitureInstanceId"`
				Parts               []struct {
					PartID      string `json:"partId"`
					CncRequired bool   `json:"cncRequired"`
					Operations  []struct {
						Operation  string `json:"operation"`
						Provenance struct {
							SourceKind               string  `json:"sourceKind"`
							TechnicalProfileID       *string `json:"technicalProfileId"`
							TechnicalProfileRevision *string `json:"technicalProfileRevision"`
							RelationshipID           *string `json:"relationshipId"`
						} `json:"provenance"`
						Holes []struct {
							Face       string  `json:"face"`
							DiameterMm float64 `json:"diameterMm"`
						} `json:"holes"`
					} `json:"operations"`
				} `json:"parts"`
			} `json:"units"`
		} `json:"routing"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &snapshot); err != nil {
		t.Fatalf("decode snapshot: %v", err)
	}
	if snapshot.SchemaVersion != 2 || snapshot.Release.ID != readback.Release.ID ||
		snapshot.Release.ReleaseNumber != 1 || snapshot.Release.ManufacturingFingerprint != readback.Release.ManufacturingFingerprint {
		t.Fatalf("snapshot identity mismatch: %+v", snapshot.Release)
	}
	if snapshot.Routing.Contract != "granete.release-manufacturing-program.v1" {
		t.Fatalf("routing contract = %q", snapshot.Routing.Contract)
	}
	if len(snapshot.Routing.Units) != 2 {
		t.Fatalf("units = %d want 2 (the fixture's two physical units)", len(snapshot.Routing.Units))
	}
	d15, d8, drillOps, withProfile := 0, 0, 0, 0
	for _, unit := range snapshot.Routing.Units {
		for _, part := range unit.Parts {
			for _, operation := range part.Operations {
				if operation.Operation != "drill" || len(operation.Holes) == 0 {
					continue
				}
				drillOps++
				if operation.Provenance.TechnicalProfileID != nil && *operation.Provenance.TechnicalProfileID == profA {
					withProfile++
				}
				for _, hole := range operation.Holes {
					switch hole.DiameterMm {
					case 15:
						d15++
					case 8:
						d8++
					}
				}
			}
		}
	}
	// 2 units × 2 contacts × 4 stations, per recipe rule diameter.
	if d15 != 16 || d8 != 16 {
		t.Fatalf("frozen holes = d15:%d d8:%d, want the 4-station pattern 16/16", d15, d8)
	}
	if drillOps == 0 || withProfile != drillOps {
		t.Fatalf("drill operations = %d with provenance %d — every frozen drill must carry the profile trail", drillOps, withProfile)
	}

	// A release that does not exist answers the typed unavailable error.
	if err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		req := httptest.NewRequest(http.MethodGet,
			"/api/projects/"+fx.projectID+"/production-releases/"+uuid.NewString()+"/manufacturing-snapshot", nil)
		req.SetPathValue("projectId", fx.projectID)
		req.SetPathValue("releaseId", uuid.NewString())
		req = req.WithContext(context.WithValue(ctx, api.UserContextKey, adminClaims()))
		rec := httptest.NewRecorder()
		server.HandleProjectProductionManufacturingSnapshot(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("missing release status = %d want 404", rec.Code)
		}
		if want := "release_snapshot_unavailable"; !strings.Contains(rec.Body.String(), want) {
			t.Fatalf("missing release body missing blocker %q: %s", want, rec.Body.String())
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	// A caller without the industrial-preparation role is rejected.
	vendedor := &auth.Claims{UserID: rlsUserA, Role: string(domain.RoleVendedor), Roles: []string{string(domain.RoleVendedor)}}
	if err := fiTx(t, fx.store, actorA, func(ctx context.Context) error {
		req := httptest.NewRequest(http.MethodGet,
			"/api/projects/"+fx.projectID+"/production-releases/"+readback.Release.ID+"/manufacturing-snapshot", nil)
		req.SetPathValue("projectId", fx.projectID)
		req.SetPathValue("releaseId", readback.Release.ID)
		req = req.WithContext(context.WithValue(ctx, api.UserContextKey, vendedor))
		rec := httptest.NewRecorder()
		server.HandleProjectProductionManufacturingSnapshot(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("vendedor status = %d want 403", rec.Code)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}
