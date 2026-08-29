package storage

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type dbtx interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

func (s *PostgresStore) db(ctx context.Context) dbtx {
	if tx := transactionFromContext(ctx); tx != nil {
		return tx
	}
	return s.Pool
}

func (s *PostgresStore) beginOrUseTx(ctx context.Context) (pgx.Tx, bool, error) {
	if tx := transactionFromContext(ctx); tx != nil {
		return tx, false, nil
	}
	tx, err := s.Pool.Begin(ctx)
	return tx, true, err
}

type PostgresStore struct {
	Pool *pgxpool.Pool
}

func NewPostgresStore(databaseURL string) (*PostgresStore, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("unable to parse database url: %w", err)
	}

	// Configurar pools
	config.MaxConns = 10
	config.MinConns = 2
	config.MaxConnIdleTime = 5 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("unable to create connection pool: %w", err)
	}

	// Verificar conexión
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("unable to ping database: %w", err)
	}

	log.Println("✓ Database connection established successfully")
	return &PostgresStore{Pool: pool}, nil
}

func (s *PostgresStore) Close() {
	if s.Pool != nil {
		s.Pool.Close()
		log.Println("Database connection pool closed")
	}
}

// rowScanner abstracts pgx.Row and pgx.Rows so scan logic can be shared between
// single-row queries and multi-row cursors.
type rowScanner interface {
	Scan(dest ...any) error
}
