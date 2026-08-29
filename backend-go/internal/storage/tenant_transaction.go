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
		if err := setTenantContext(ctx, existing, actor); err != nil {
			return err
		}
		return execute(WithTenantActorCtx(ctx, actor))
	}

	tx, err := s.Pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
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
