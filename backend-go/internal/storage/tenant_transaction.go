package storage

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// ErrInvalidTenantActor rejects malformed actor context before it can reach a
// SET LOCAL boundary or become an ambiguous PostgreSQL cast failure.
var ErrInvalidTenantActor = errors.New("invalid tenant actor")

// ErrInconsistentCatalogTransaction rejects borrowed transactions without a stable source view.
var ErrInconsistentCatalogTransaction = errors.New("consistent catalog transaction requires repeatable read or serializable")

type consistentCatalogContextKey struct{}

// WithConsistentCatalogTx opts an internal caller into a coherent catalog view.
// Attach it before the tenant transaction begins; it cannot upgrade an existing transaction.
func WithConsistentCatalogTx(ctx context.Context) context.Context {
	return context.WithValue(ctx, consistentCatalogContextKey{}, true)
}

func requiresConsistentCatalog(ctx context.Context) bool {
	marked, _ := ctx.Value(consistentCatalogContextKey{}).(bool)
	return marked
}

func verifyConsistentCatalogTx(ctx context.Context, tx pgx.Tx) error {
	var isolation string
	if err := tx.QueryRow(ctx, "SHOW transaction_isolation").Scan(&isolation); err != nil {
		return fmt.Errorf("read catalog transaction isolation: %w", err)
	}
	switch isolation {
	case string(pgx.RepeatableRead), string(pgx.Serializable):
		return nil
	default:
		return ErrInconsistentCatalogTransaction
	}
}

func validateOptionalUUID(name, value string) error {
	if value == "" {
		return nil
	}
	var parsed pgtype.UUID
	if err := parsed.Scan(value); err != nil || !parsed.Valid {
		return fmt.Errorf("%w: %s", ErrInvalidTenantActor, name)
	}
	return nil
}

func validateTenantActor(actor TenantActor) error {
	for _, value := range []struct {
		name string
		id   string
	}{
		{"organization_id", actor.OrganizationID},
		{"user_id", actor.UserID},
		{"membership_id", actor.MembershipID},
		{"support_session_id", actor.SupportSessionID},
	} {
		if err := validateOptionalUUID(value.name, value.id); err != nil {
			return err
		}
	}
	if actor.OrganizationID == "" && (actor.MembershipID != "" || actor.SupportSessionID != "") {
		return fmt.Errorf("%w: scoped membership/support requires organization_id", ErrInvalidTenantActor)
	}
	for _, organizationID := range actor.AuthorizedOrganizationIDs {
		if err := validateOptionalUUID("authorized_organization_id", organizationID); err != nil {
			return err
		}
	}
	return nil
}

func authorizedOrganizations(actor TenantActor) string {
	ids := append([]string(nil), actor.AuthorizedOrganizationIDs...)
	if actor.OrganizationID != "" {
		found := false
		for _, id := range ids {
			if id == actor.OrganizationID {
				found = true
				break
			}
		}
		if !found {
			ids = append(ids, actor.OrganizationID)
		}
	}
	return strings.Join(ids, ",")
}

func setTenantContext(ctx context.Context, tx pgx.Tx, actor TenantActor) error {
	if err := validateTenantActor(actor); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `
		SELECT
			set_config('app.organization_id', $1, true),
			set_config('app.user_id', $2, true),
			set_config('app.membership_id', $3, true),
			set_config('app.support_session_id', $4, true),
			set_config('app.authorized_organization_ids', $5, true),
			set_config('row_security', 'on', true)
	`, actor.OrganizationID, actor.UserID, actor.MembershipID, actor.SupportSessionID, authorizedOrganizations(actor))
	if err != nil {
		return fmt.Errorf("setting tenant transaction context: %w", err)
	}
	return nil
}

func authorizeTenantOrganizations(ctx context.Context, ids ...string) error {
	tx := transactionFromContext(ctx)
	if tx == nil {
		return errors.New("authorized organizations require an active transaction")
	}
	for _, id := range ids {
		if err := validateOptionalUUID("authorized_organization_id", id); err != nil {
			return err
		}
	}
	_, err := tx.Exec(ctx,
		`SELECT set_config('app.authorized_organization_ids', $1, true)`,
		strings.Join(ids, ","),
	)
	return err
}

// WithinTenantTx executes one application transaction with pool-safe SET LOCAL
// actor context. Commit and rollback both discard every app.* setting.
func (s *PostgresStore) WithinTenantTx(
	ctx context.Context,
	actor TenantActor,
	execute func(context.Context) error,
) error {
	if execute == nil {
		return errors.New("tenant transaction callback is required")
	}
	if existing := transactionFromContext(ctx); existing != nil {
		if requiresConsistentCatalog(ctx) {
			if err := verifyConsistentCatalogTx(ctx, existing); err != nil {
				return err
			}
		}
		if err := setTenantContext(ctx, existing, actor); err != nil {
			return err
		}
		return execute(WithTenantActorCtx(ctx, actor))
	}

	isolation := pgx.ReadCommitted
	if requiresConsistentCatalog(ctx) {
		isolation = pgx.RepeatableRead
	}
	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: isolation})
	if err != nil {
		return fmt.Errorf("begin tenant transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	if err := setTenantContext(ctx, tx, actor); err != nil {
		return err
	}
	txCtx := context.WithValue(WithTenantActorCtx(ctx, actor), transactionContextKey{}, tx)
	if err := execute(txCtx); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit tenant transaction: %w", err)
	}
	return nil
}

// SetTenantActor updates the actor values inside an existing transaction after
// live membership validation. It never creates a session-level setting.
func (s *PostgresStore) SetTenantActor(ctx context.Context, actor TenantActor) (context.Context, error) {
	tx := transactionFromContext(ctx)
	if tx == nil {
		return ctx, errors.New("tenant actor requires an active transaction")
	}
	if err := setTenantContext(ctx, tx, actor); err != nil {
		return ctx, err
	}
	return WithTenantActorCtx(ctx, actor), nil
}
