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
	ScopeKey       string
	Fingerprint    string
	ActorUserID    string
	OrganizationID string
	// AfterRollback records sanitized failure evidence outside the command
	// savepoint but inside the durable receipt transaction.
	AfterRollback func(context.Context, IdempotencyResponse) error
	SealBody      func([]byte) ([]byte, error)
	OpenBody      func([]byte) ([]byte, error)
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
	tx, owned, err := s.beginOrUseTx(ctx)
	if err != nil {
		return IdempotencyResponse{}, false, err
	}
	if owned {
		defer tx.Rollback(ctx)
	}

	// Cleanup is opportunistic; the predicate, not cleanup timing, defines the
	// guaranteed retention boundary.
	if _, err := tx.Exec(ctx, `DELETE FROM api_idempotency_receipts WHERE expires_at <= clock_timestamp()`); err != nil {
		return IdempotencyResponse{}, false, err
	}
	commandStartedAt := time.Now()
	tag, err := tx.Exec(ctx, `
		INSERT INTO api_idempotency_receipts (
			scope_key, fingerprint, actor_user_id, organization_id
		)
		VALUES ($1, $2, NULLIF($3, '')::uuid, NULLIF($4, '')::uuid)
		ON CONFLICT (scope_key) DO NOTHING`,
		req.ScopeKey, req.Fingerprint, req.ActorUserID, req.OrganizationID)
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
		if owned {
			if err := tx.Commit(ctx); err != nil {
				return IdempotencyResponse{}, false, err
			}
		}
		if req.OpenBody != nil {
			body, err = req.OpenBody(body)
			if err != nil {
				return IdempotencyResponse{}, false, err
			}
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
		if req.AfterRollback != nil {
			if err := req.AfterRollback(context.WithValue(ctx, transactionContextKey{}, tx), response); err != nil {
				return IdempotencyResponse{}, false, err
			}
		}
	}
	// Public commands may acquire an identity and switch tenant context while
	// executing. Restore the receipt owner before releasing the savepoint so
	// RLS can update the row that was reserved for the original request scope.
	if err := setTenantContext(ctx, tx, TenantActor{OrganizationID: req.OrganizationID, UserID: req.ActorUserID}); err != nil {
		return IdempotencyResponse{}, false, err
	}
	if _, err := tx.Exec(ctx, `RELEASE SAVEPOINT idempotent_command`); err != nil {
		return IdempotencyResponse{}, false, err
	}
	headersJSON, err := json.Marshal(response.Header)
	if err != nil {
		return IdempotencyResponse{}, false, err
	}
	storedBody := response.Body
	if req.SealBody != nil {
		storedBody, err = req.SealBody(response.Body)
		if err != nil {
			return IdempotencyResponse{}, false, err
		}
	}
	if _, err := tx.Exec(ctx, `
		UPDATE api_idempotency_receipts
		SET status = $2, headers = $3::jsonb, body = $4, completed_at = clock_timestamp()
		WHERE scope_key = $1`, req.ScopeKey, response.Status, headersJSON, storedBody); err != nil {
		return IdempotencyResponse{}, false, err
	}
	if owned {
		if err := tx.Commit(ctx); err != nil {
			return IdempotencyResponse{}, false, err
		}
	}
	return response, false, nil
}
