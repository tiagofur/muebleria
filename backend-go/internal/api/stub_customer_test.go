package api

// Contrato: stub del stubStore espejo de store_customer (store_customer.go). Los
// métodos se movieron tal cual desde handlers_test.go (Fase B #1017);
// las firmas son las de la sub-interface en store_customer.go
import (
	"context"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

func (s *stubStore) CreateCustomer(ctx context.Context, c *domain.Customer) error {
	if s.createCustomerErr != nil {
		return s.createCustomerErr
	}
	cp := *c
	s.lastCreatedCustomer = &cp
	return nil
}

func (s *stubStore) GetCustomerByID(ctx context.Context, id string) (*domain.Customer, error) {
	return s.customerReturnedByID, s.customerGetByIDErr
}

func (s *stubStore) ListCustomers(context.Context) ([]domain.Customer, error) {
	if s.listCustomers != nil {
		return s.listCustomers, nil
	}
	return []domain.Customer{}, nil
}

func (s *stubStore) UpdateCustomer(context.Context, string, *domain.Customer) error {
	return nil
}

func (s *stubStore) DeactivateCustomer(context.Context, string) error {
	return nil
}
