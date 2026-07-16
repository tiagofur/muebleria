package storage

import (
	"context"
	"fmt"
	"log"

	"github.com/tiagofur/muebles-backend/db"
)

// schemaMigrationsTable records which migration versions have been applied.
// Each row is inserted inside the migration's own transaction, so a partially
// applied migration rolls back together with its tracking row.
const schemaMigrationsTable = "schema_migrations"

// RunMigrations applies every pending migration from db.EmbeddedMigrations in
// version order. It is idempotent: a migration whose version is already
// recorded in schema_migrations is skipped. Because all bundled migrations use
// IF EXISTS / IF NOT EXISTS, re-applying them on a fresh database that was set
// up manually (without a tracking table) is safe.
//
// It is meant to run once at server startup, after the pool is ready and
// before the HTTP server starts serving. A failure aborts startup.
func (s *PostgresStore) RunMigrations(ctx context.Context) error {
	migrations, err := db.EmbeddedMigrations()
	if err != nil {
		return fmt.Errorf("loading embedded migrations: %w", err)
	}
	if len(migrations) == 0 {
		return fmt.Errorf("no embedded migrations found")
	}

	// Ensure the tracking table exists (its own transaction; idempotent).
	if _, err := s.Pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS `+schemaMigrationsTable+` (
			version INTEGER PRIMARY KEY,
			name    TEXT NOT NULL,
			applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
	`); err != nil {
		return fmt.Errorf("creating %s table: %w", schemaMigrationsTable, err)
	}

	applied, err := s.appliedVersions(ctx)
	if err != nil {
		return err
	}

	for _, m := range migrations {
		if applied[m.Version] {
			continue
		}
		if err := s.applyOne(ctx, m); err != nil {
			return err
		}
		log.Printf("✓ Applied migration %05d_%s", m.Version, m.Name)
	}
	return nil
}

func (s *PostgresStore) appliedVersions(ctx context.Context) (map[int]bool, error) {
	rows, err := s.Pool.Query(ctx, `SELECT version FROM `+schemaMigrationsTable)
	if err != nil {
		return nil, fmt.Errorf("querying %s: %w", schemaMigrationsTable, err)
	}
	defer rows.Close()

	out := make(map[int]bool)
	for rows.Next() {
		var v int
		if err := rows.Scan(&v); err != nil {
			return nil, fmt.Errorf("scanning applied version: %w", err)
		}
		out[v] = true
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating applied versions: %w", err)
	}
	return out, nil
}

// applyOne runs a single migration inside a transaction and records its
// version. If the SQL fails the transaction rolls back (no partial apply, no
// tracking row).
func (s *PostgresStore) applyOne(ctx context.Context, m db.Migration) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx for migration %05d: %w", m.Version, err)
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, m.SQL); err != nil {
		return fmt.Errorf("migration %05d_%s: %w", m.Version, m.Name, err)
	}

	// Record the version only after the body succeeded, inside the same tx.
	if _, err := tx.Exec(ctx,
		`INSERT INTO `+schemaMigrationsTable+` (version, name) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING`,
		m.Version, m.Name,
	); err != nil {
		return fmt.Errorf("recording migration %05d: %w", m.Version, err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit migration %05d: %w", m.Version, err)
	}
	return nil
}

// AppliedVersions is exported for tests/diagnostics that want to inspect the
// tracking table without re-running migrations.
func (s *PostgresStore) AppliedVersions(ctx context.Context) ([]int, error) {
	set, err := s.appliedVersions(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]int, 0, len(set))
	for v := range set {
		out = append(out, v)
	}
	return out, nil
}
