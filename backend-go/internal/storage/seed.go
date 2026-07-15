package storage

import (
	"context"
	"errors"
	"log"

	"github.com/jackc/pgx/v5"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

const adminEmail = "tiagofur@gmail.com"
const adminPassword = "asd123"
const adminName = "Tiago (Admin)"

// EnsureAdminExists creates the admin user if it doesn't exist yet.
// Called once at server startup.
func (s *PostgresStore) EnsureAdminExists(ctx context.Context) {
	row := s.Pool.QueryRow(ctx, `SELECT id FROM users WHERE email = $1`, adminEmail)
	var id string
	if err := row.Scan(&id); err == nil {
		log.Printf("✓ Admin user already exists: %s", adminEmail)
		return
	} else if !errors.Is(err, pgx.ErrNoRows) {
		log.Printf("⚠ Could not check for admin user: %v", err)
		return
	}

	hash, err := auth.HashPassword(adminPassword)
	if err != nil {
		log.Printf("⚠ Could not hash admin password: %v", err)
		return
	}

	u := &domain.User{
		Email:        adminEmail,
		PasswordHash: hash,
		Name:         adminName,
		Role:         domain.RoleAdmin,
		Active:       true,
	}

	if err := s.CreateUser(ctx, u); err != nil {
		log.Printf("⚠ Could not create admin user: %v", err)
		return
	}

	log.Printf("✓ Admin user created: %s", adminEmail)
}
