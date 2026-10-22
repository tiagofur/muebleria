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

// moduleChildRowConflict reports whether a duplicate-key error comes from one
// of a module's child row primary keys (#1398). A client that clones another
// module as a template without dropping its preset / hardware line / board
// part ids collides there; the honest answer names those rows instead of the
// module code.
func moduleChildRowConflict(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.ConstraintName {
		case "module_presets_pkey", "hardware_lines_pkey", "board_parts_pkey":
			return true
		}
	}
	return false
}
