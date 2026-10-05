package api

import (
	"context"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// Contrato: CRUD de clientes. Consumido por HandleCustomers/HandleCustomerByID.
type CustomerStore interface {
	// Customers
	ListCustomers(ctx context.Context) ([]domain.Customer, error)
	GetCustomerByID(ctx context.Context, id string) (*domain.Customer, error)
	CreateCustomer(ctx context.Context, c *domain.Customer) error
	UpdateCustomer(ctx context.Context, id string, expectedVersion int64, c *domain.Customer) error
	DeactivateCustomer(ctx context.Context, id string, expectedVersion int64) error
}
