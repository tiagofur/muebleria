package storage_test

import (
	"context"
	"fmt"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/storage"
)

func TestConsistentCatalogTx_RuntimeTenantIsolation(t *testing.T) {
	fx := newRLSFixture(t)
	ctx := storage.WithConsistentCatalogTx(context.Background())
	for _, tc := range []struct{ org, user, name string }{
		{rlsOrgA, rlsUserA, "Customer A"},
		{rlsOrgB, rlsUserB, "Customer B"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			actor := storage.TenantActor{OrganizationID: tc.org, UserID: tc.user}
			err := fx.store.WithinTenantTx(ctx, actor, func(txCtx context.Context) error {
				return fx.store.WithinTenantTx(txCtx, actor, func(borrowed context.Context) error {
					customers, err := fx.store.ListCustomers(borrowed)
					if err != nil {
						return err
					}
					if len(customers) != 1 || customers[0].Name != tc.name {
						return fmt.Errorf("coherent borrowed tenant read leaked: %v", customers)
					}
					return nil
				})
			})
			if err != nil {
				t.Fatal(err)
			}
		})
	}
}
