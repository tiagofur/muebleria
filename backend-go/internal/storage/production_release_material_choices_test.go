package storage_test

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

func TestProductionRelease_SelectedMaterialAuthority(t *testing.T) {
	for _, catalog := range []struct{ table, id string }{
		{"material_boards", releaseMaterial},
		{"hardwares", "70000000-0000-0000-0000-000000000002"},
		{"edge_bands", "70000000-0000-0000-0000-000000000003"},
	} {
		for _, scenario := range []string{"valid", "empty", "missing", "foreign", "unavailable"} {
			t.Run(catalog.table+"/"+scenario, func(t *testing.T) {
				choices := map[string]string{
					"legacy-body":  releaseMaterial,
					"custom-hinge": "70000000-0000-0000-0000-000000000002",
					"EDGE":         "70000000-0000-0000-0000-000000000003",
				}
				if scenario == "empty" {
					choices = nil
				}
				fx := setupReleaseFixtureWithChoices(t, choices)
				switch scenario {
				case "missing":
					multiOrgExec(t, fx.admin, fmt.Sprintf("DELETE FROM %s WHERE id = '%s'", catalog.table, catalog.id))
				case "foreign":
					multiOrgExec(t, fx.admin, fmt.Sprintf("UPDATE %s SET organization_id = '%s' WHERE id = '%s'", catalog.table, rlsOrgB, catalog.id))
				case "unavailable":
					multiOrgExec(t, fx.admin, fmt.Sprintf("REVOKE SELECT ON %s FROM granete_app", catalog.table))
				}
				var preflight *domain.ManufacturingPreflightResult
				err := fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
					var err error
					preflight, err = fx.store.EvaluateDesignRevisionPreflight(ctx, fx.designID, fx.revR3)
					return err
				})
				valid := scenario == "valid" || scenario == "empty"
				if scenario == "unavailable" {
					if err == nil || preflight != nil {
						t.Fatalf("unavailable authority must fail: result=%+v err=%v", preflight, err)
					}
				} else {
					if err != nil {
						t.Fatal(err)
					}
					if valid && preflight.Status != domain.ManufacturingPreflightReady {
						t.Fatalf("valid choices blocked: %+v", preflight)
					}
					if !valid && (preflight.Status != domain.ManufacturingPreflightBlocked || len(preflight.Issues) == 0 || preflight.Issues[0].Code != domain.PreflightIssueInvalidMaterialUse) {
						t.Fatalf("missing/foreign choice must block: %+v", preflight)
					}
				}
				err = fiTx(t, fx.store, fiActorA(), func(ctx context.Context) error {
					_, err := fx.store.CreateProductionRelease(ctx, storage.CreateProductionReleaseCommand{
						ProjectID: fx.projectID, DesignRevisionID: fx.revR3, QuoteRevisionID: fx.quoteQ3, ActorUserID: rlsUserA,
					})
					return err
				})
				if valid && err != nil {
					t.Fatalf("valid release rejected: %v", err)
				}
				if !valid {
					if err == nil {
						t.Fatal("invalid release accepted")
					}
					var blocked *domain.ReleasePreflightBlockedError
					if scenario != "unavailable" && (!errors.As(err, &blocked) || blocked.Result.Issues[0].Code != domain.PreflightIssueInvalidMaterialUse) {
						t.Fatalf("expected material blocker, got %v", err)
					}
					var count int
					if err := fx.admin.QueryRow(context.Background(), `SELECT count(*) FROM production_releases`).Scan(&count); err != nil || count != 0 {
						t.Fatalf("rejected release persisted rows=%d err=%v", count, err)
					}
					if events := releaseAuditEvents(t, fx.admin, "production_release_created"); len(events) != 0 {
						t.Fatalf("rejected release persisted audit: %+v", events)
					}
				}
			})
		}
	}
}
