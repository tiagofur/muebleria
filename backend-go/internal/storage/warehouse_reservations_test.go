package storage_test

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func TestWarehouseReservationsConcurrentProjects(t *testing.T) {
	fx := setupReleaseFixture(t)
	const material = "concurrent-hardware"
	multiOrgExec(t, fx.admin, fmt.Sprintf(`INSERT INTO material_stock(kind,material_id,quantity,min_stock,organization_id) VALUES ('herrajes','%s',1,0,'%s')`, material, rlsOrgA))
	start := make(chan struct{})
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for _, projectID := range []string{fx.projectID, fiProjectAOnly} {
		wg.Add(1)
		go func(projectID string) {
			defer wg.Done()
			<-start
			results <- fx.store.WithinTenantTx(context.Background(), fiActorA(), func(ctx context.Context) error {
				_, err := fx.store.MutateProjectMaterialPlanning(ctx, projectID, func(snap *domain.MaterialPlanningSnapshot) (*domain.MaterialPlanningMutation, error) {
					// Hold the stock snapshot briefly so an unlocked second project races.
					time.Sleep(30 * time.Millisecond)
					plan := &domain.MaterialPlanning{ID: projectID, ProjectID: projectID, Requirements: &domain.MaterialRequirementsSnapshot{Lines: []domain.MaterialRequirementLine{{Kind: "herrajes", MaterialID: material, Quantity: 1}}}}
					next, _, _ := domain.PlanReservations(plan, snap.Stock, snap.AllPlannings, nil, rlsUserA, time.Now())
					return &domain.MaterialPlanningMutation{Planning: next}, nil
				})
				return err
			})
		}(projectID)
	}
	close(start)
	wg.Wait()
	close(results)
	for err := range results {
		if err != nil {
			t.Fatal(err)
		}
	}
	var total float64
	if err := fx.admin.QueryRow(context.Background(), `SELECT COALESCE(sum((reservation->>'quantity')::numeric),0) FROM projects CROSS JOIN LATERAL jsonb_array_elements(material_planning->'reservations') reservation WHERE organization_id=$1`, rlsOrgA).Scan(&total); err != nil {
		t.Fatal(err)
	}
	if total != 1 {
		t.Fatalf("concurrent projects reserved %v from stock 1", total)
	}
}
