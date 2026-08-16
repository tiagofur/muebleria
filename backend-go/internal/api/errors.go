package api

import (
	"errors"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
)

// isDuplicateKey reports whether err represents a Postgres unique-constraint
// violation (SQLSTATE 23505) or duplicate key error.
func isDuplicateKey(err error) bool {
	if err == nil {
		return false
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23505"
	}
	msg := err.Error()
	return strings.Contains(msg, "duplicate key") || strings.Contains(msg, "unique constraint")
}

// isForeignKeyViolation reports whether err represents a Postgres foreign-key
// constraint violation (SQLSTATE 23503).
func isForeignKeyViolation(err error) bool {
	if err == nil {
		return false
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23503"
	}
	return strings.Contains(err.Error(), "foreign key")
}
