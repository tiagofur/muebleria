package storage

import (
	"context"
	"fmt"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func (s *PostgresStore) GetCustomerByID(ctx context.Context, id string) (*domain.Customer, error) {
	query := `
		SELECT id, name, email, phone, address, notes, active, owner_user_id, created_at, updated_at
		FROM customers
		WHERE id = $1 AND organization_id = $2;
	`
	row := s.db(ctx).QueryRow(ctx, query, id, OrgFromCtx(ctx))
	var c domain.Customer
	var email, phone, address, notes, ownerID *string
	err := row.Scan(&c.ID, &c.Name, &email, &phone, &address, &notes, &c.Active, &ownerID, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return nil, err
	}
	if email != nil {
		c.Email = *email
	}
	if phone != nil {
		c.Phone = *phone
	}
	if address != nil {
		c.Address = *address
	}
	if notes != nil {
		c.Notes = *notes
	}
	if ownerID != nil {
		c.OwnerUserID = *ownerID
	}
	return &c, nil
}

func (s *PostgresStore) CreateCustomer(ctx context.Context, c *domain.Customer) error {
	var owner *string
	if c.OwnerUserID != "" {
		owner = &c.OwnerUserID
	}
	if c.ID != "" {
		query := `
			INSERT INTO customers (id, name, email, phone, address, notes, active, owner_user_id, organization_id)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
			RETURNING created_at, updated_at;
		`
		err := s.db(ctx).QueryRow(ctx, query, c.ID, c.Name, c.Email, c.Phone, c.Address, c.Notes, c.Active, owner, OrgFromCtx(ctx)).
			Scan(&c.CreatedAt, &c.UpdatedAt)
		if err != nil {
			return fmt.Errorf("error creating customer: %w", err)
		}
		return nil
	}
	query := `
		INSERT INTO customers (name, email, phone, address, notes, active, owner_user_id, organization_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id, created_at, updated_at;
	`
	err := s.db(ctx).QueryRow(ctx, query, c.Name, c.Email, c.Phone, c.Address, c.Notes, c.Active, owner, OrgFromCtx(ctx)).
		Scan(&c.ID, &c.CreatedAt, &c.UpdatedAt)
	if err != nil {
		return fmt.Errorf("error creating customer: %w", err)
	}
	return nil
}

func (s *PostgresStore) UpdateCustomer(ctx context.Context, id string, c *domain.Customer) error {
	var owner *string
	if c.OwnerUserID != "" {
		owner = &c.OwnerUserID
	}
	query := `
		UPDATE customers
		SET name = $1, email = $2, phone = $3, address = $4, notes = $5, active = $6,
		    owner_user_id = $7, updated_at = CURRENT_TIMESTAMP
		WHERE id = $8 AND organization_id = $9;
	`
	result, err := s.db(ctx).Exec(ctx, query, c.Name, c.Email, c.Phone, c.Address, c.Notes, c.Active, owner, id, OrgFromCtx(ctx))
	if err != nil {
		return fmt.Errorf("error updating customer: %w", err)
	}
	if result.RowsAffected() == 0 {
		return fmt.Errorf("customer not found")
	}
	c.ID = id
	return nil
}

func (s *PostgresStore) ListCustomers(ctx context.Context) ([]domain.Customer, error) {
	query := `
		SELECT id, name, email, phone, address, notes, active, owner_user_id, created_at, updated_at
		FROM customers
		WHERE organization_id = $1
		ORDER BY name ASC;
	`
	rows, err := s.db(ctx).Query(ctx, query, OrgFromCtx(ctx))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []domain.Customer
	for rows.Next() {
		var c domain.Customer
		var email, phone, address, notes, ownerID *string
		err := rows.Scan(&c.ID, &c.Name, &email, &phone, &address, &notes, &c.Active, &ownerID, &c.CreatedAt, &c.UpdatedAt)
		if err != nil {
			return nil, err
		}
		if email != nil {
			c.Email = *email
		}
		if phone != nil {
			c.Phone = *phone
		}
		if address != nil {
			c.Address = *address
		}
		if notes != nil {
			c.Notes = *notes
		}
		if ownerID != nil {
			c.OwnerUserID = *ownerID
		}
		list = append(list, c)
	}
	if list == nil {
		list = []domain.Customer{}
	}
	return list, nil
}

func (s *PostgresStore) DeactivateCustomer(ctx context.Context, id string) error {
	query := `
		UPDATE customers
		SET active = false, updated_at = CURRENT_TIMESTAMP
		WHERE id = $1 AND organization_id = $2;
	`
	tag, err := s.db(ctx).Exec(ctx, query, id, OrgFromCtx(ctx))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("customer not found")
	}
	return nil
}
