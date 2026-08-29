package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
)

// IdempotencyRetention is a database-enforced minimum retention window.
const IdempotencyRetention = 24 * time.Hour

type IdempotencyRequest struct {
	ScopeKey    string
	Fingerprint string
}

type IdempotencyResponse struct {
	Status int
	Header http.Header
	Body   []byte
}

var (
	ErrIdempotencyConflict = errors.New("idempotency key reused with another request")
	ErrIdempotencyRollback = errors.New("idempotent command rolled back")
)

type transactionContextKey struct{}

func transactionFromContext(ctx context.Context) pgx.Tx {
	tx, _ := ctx.Value(transactionContextKey{}).(pgx.Tx)
	return tx
}

// ExecuteIdempotent serializes a scope across every replica and commits the
// business mutation and its replayable HTTP receipt atomically. A process crash
// before Commit rolls both back; a crash after Commit leaves the exact receipt.
func (s *PostgresStore) ExecuteIdempotent(
	ctx context.Context,
	req IdempotencyRequest,
	execute func(context.Context) (IdempotencyResponse, error),
) (IdempotencyResponse, bool, error) {
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return IdempotencyResponse{}, false, err
	}
	defer tx.Rollback(ctx)

	// Cleanup is opportunistic; the predicate, not cleanup timing, defines the
	// guaranteed retention boundary.
	if _, err := tx.Exec(ctx, `DELETE FROM api_idempotency_receipts WHERE expires_at <= clock_timestamp()`); err != nil {
		return IdempotencyResponse{}, false, err
	}
	commandStartedAt := time.Now()
	tag, err := tx.Exec(ctx, `
		INSERT INTO api_idempotency_receipts (scope_key, fingerprint)
		VALUES ($1, $2)
		ON CONFLICT (scope_key) DO NOTHING`, req.ScopeKey, req.Fingerprint)
	if err != nil {
		return IdempotencyResponse{}, false, err
	}
	if tag.RowsAffected() == 0 {
		var fingerprint string
		var status *int
		var headersJSON []byte
		var body []byte
		if err := tx.QueryRow(ctx, `
			SELECT fingerprint, status, headers, body, expires_at
			FROM api_idempotency_receipts
			WHERE scope_key = $1
			FOR UPDATE`, req.ScopeKey).Scan(&fingerprint, &status, &headersJSON, &body, new(time.Time)); err != nil {
			return IdempotencyResponse{}, false, err
		}
		if fingerprint != req.Fingerprint {
			return IdempotencyResponse{}, false, ErrIdempotencyConflict
		}
		if status == nil {
			return IdempotencyResponse{}, false, fmt.Errorf("incomplete idempotency receipt created at %s", commandStartedAt.UTC().Format(time.RFC3339Nano))
		}
		var header http.Header
		if err := json.Unmarshal(headersJSON, &header); err != nil {
			return IdempotencyResponse{}, false, err
		}
		if err := tx.Commit(ctx); err != nil {
			return IdempotencyResponse{}, false, err
		}
		return IdempotencyResponse{Status: *status, Header: header, Body: body}, true, nil
	}

	// Keep the receipt reservation outside the command savepoint. A handler may
	// intentionally translate a PostgreSQL error into a stable 4xx response; in
	// that case the transaction is aborted until we roll back to a savepoint.
	// Rolling back here also guarantees that no business mutation can accompany
	// a replayable client error.
	if _, err := tx.Exec(ctx, `SAVEPOINT idempotent_command`); err != nil {
		return IdempotencyResponse{}, false, err
	}

	response, err := execute(context.WithValue(ctx, transactionContextKey{}, tx))
	if err != nil || response.Status >= http.StatusInternalServerError {
		if err == nil {
			err = ErrIdempotencyRollback
		}
		return IdempotencyResponse{}, false, err
	}
	if response.Status >= http.StatusBadRequest {
		if _, err := tx.Exec(ctx, `ROLLBACK TO SAVEPOINT idempotent_command`); err != nil {
			return IdempotencyResponse{}, false, err
		}
	}
	if _, err := tx.Exec(ctx, `RELEASE SAVEPOINT idempotent_command`); err != nil {
		return IdempotencyResponse{}, false, err
	}
	headersJSON, err := json.Marshal(response.Header)
	if err != nil {
		return IdempotencyResponse{}, false, err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE api_idempotency_receipts
		SET status = $2, headers = $3::jsonb, body = $4, completed_at = clock_timestamp()
		WHERE scope_key = $1`, req.ScopeKey, response.Status, headersJSON, response.Body); err != nil {
		return IdempotencyResponse{}, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return IdempotencyResponse{}, false, err
	}
	return response, false, nil
}
