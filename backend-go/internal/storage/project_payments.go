package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1649: append-only payment ledger of a project. Payments are retail data of
// the selling organization: only the project's owner or sales organization can
// record, void or read them; a manufacturing-only partner gets the uniform
// not-found.

var (
	// ErrProjectPaymentTargetNotFound is the uniform 404 for a project the
	// caller cannot sell (missing, foreign, or manufacturing-only).
	ErrProjectPaymentTargetNotFound = errors.New("project not found for payments")
	// ErrProjectPaymentNotFound means the payment is not part of that project.
	ErrProjectPaymentNotFound = errors.New("payment not found")
	// ErrProjectPaymentAlreadyVoided means a void already exists.
	ErrProjectPaymentAlreadyVoided = errors.New("payment already voided")
	// ErrProjectHasPayments blocks deleting a project with a payment ledger.
	ErrProjectHasPayments = errors.New("project has recorded payments")
)

// RecordProjectPaymentCommand records one payment. Payment is fully built by
// the API (server id, validated fields, server actor). DepositEvent, set for a
// deposit, is the deposit_received lifecycle event written in the same
// transaction and linked to the payment.
type RecordProjectPaymentCommand struct {
	Payment      domain.ProjectPayment
	DepositEvent *domain.ProjectEvent
	IP           string
	RequestID    string
}

// VoidProjectPaymentCommand cancels one payment. DepositVoidEvent, used when
// the payment is a deposit, is completed with the payment/event ids here.
type VoidProjectPaymentCommand struct {
	ProjectID        string
	PaymentID        string
	Reason           string
	VoidedBy         string
	DepositVoidEvent *domain.ProjectEvent
	IP               string
	RequestID        string
}

func (s *PostgresStore) inTenantTx(ctx context.Context, fn func(context.Context) error) error {
	if transactionFromContext(ctx) != nil {
		return fn(ctx)
	}
	actor, _ := TenantActorFromCtx(ctx)
	if actor.OrganizationID == "" {
		actor.OrganizationID = OrgFromCtx(ctx)
	}
	return s.WithinTenantTx(ctx, actor, fn)
}

// lockSellableProject locks the project row when the current organization is
// its owner or sales organization; returns the project currency and customer.
func (s *PostgresStore) lockSellableProject(ctx context.Context, projectID string, forUpdate bool) (currency, customerID string, err error) {
	query := `
		SELECT currency, COALESCE(customer_id::text, '')
		FROM projects
		WHERE id = $1 AND (organization_id = $2 OR sales_organization_id = $2)`
	if forUpdate {
		query += ` FOR UPDATE`
	}
	err = s.db(ctx).QueryRow(ctx, query, projectID, OrgFromCtx(ctx)).Scan(&currency, &customerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", ErrProjectPaymentTargetNotFound
	}
	if err != nil {
		return "", "", fmt.Errorf("lock project for payments: %w", err)
	}
	return currency, customerID, nil
}

func insertProjectEventRow(ctx context.Context, s *PostgresStore, ev domain.ProjectEvent) error {
	_, err := s.db(ctx).Exec(ctx, `
		INSERT INTO project_events
			(id, project_id, type, at, by_user_id, source, note, payload, organization_id)
		VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, ''), $8, $9)`,
		ev.ID, ev.ProjectID, ev.Type, ev.At, ev.ByUserID,
		string(domain.NormalizeProjectEventSource(string(ev.Source))), ev.Note,
		nullKitchenLayout(ev.Payload), OrgFromCtx(ctx))
	if err != nil {
		return fmt.Errorf("insert project event %s: %w", ev.Type, err)
	}
	return nil
}

// RecordProjectPayment writes the payment (+ deposit event) and its audit row
// atomically under the project lock.
func (s *PostgresStore) RecordProjectPayment(ctx context.Context, cmd RecordProjectPaymentCommand) (*domain.ProjectPayment, error) {
	var out *domain.ProjectPayment
	err := s.inTenantTx(ctx, func(ctx context.Context) error {
		p := cmd.Payment
		if p.ID == "" || p.ProjectID == "" || p.RecordedBy == "" {
			return fmt.Errorf("payment requires id, project and server actor")
		}
		if _, _, err := s.lockSellableProject(ctx, p.ProjectID, true); err != nil {
			return err
		}
		org := OrgFromCtx(ctx)
		var eventID *string
		if cmd.DepositEvent != nil {
			if err := insertProjectEventRow(ctx, s, *cmd.DepositEvent); err != nil {
				return err
			}
			id := cmd.DepositEvent.ID
			eventID = &id
		}
		if err := s.db(ctx).QueryRow(ctx, `
			INSERT INTO project_payments
				(id, organization_id, project_id, kind, amount, currency, payment_method,
				 reference, note, received_at, recorded_by, project_event_id, origin)
			VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, ''), NULLIF($8, ''), NULLIF($9, ''), $10, $11, $12, 'command')
			RETURNING recorded_at`,
			p.ID, org, p.ProjectID, string(p.Kind), p.Amount, p.Currency, p.PaymentMethod,
			p.Reference, p.Note, p.ReceivedAt, p.RecordedBy, eventID).Scan(&p.RecordedAt); err != nil {
			return fmt.Errorf("insert payment: %w", err)
		}
		if eventID != nil {
			p.ProjectEventID = *eventID
		}
		p.OrganizationID = org
		p.Origin = "command"
		auditType := "project_payment_recorded"
		if p.Kind == domain.ProjectPaymentKindDeposit {
			auditType = "project_deposit_recorded"
		}
		if err := s.InsertSecurityAuditEvent(ctx, SecurityAuditEvent{
			EventType:      auditType,
			ActorUserID:    p.RecordedBy,
			OrganizationID: org,
			IP:             cmd.IP,
			RequestID:      cmd.RequestID,
			Details: map[string]interface{}{
				"project_id": p.ProjectID,
				"payment_id": p.ID,
				"kind":       string(p.Kind),
				"amount":     p.Amount,
				"currency":   p.Currency,
			},
		}); err != nil {
			return fmt.Errorf("audit %s: %w", auditType, err)
		}
		out = &p
		return nil
	})
	return out, err
}

// VoidProjectPayment inserts the void (+ deposit_voided event for a deposit)
// and its audit row atomically. A second void fails with
// ErrProjectPaymentAlreadyVoided; the primary key is the race arbiter.
func (s *PostgresStore) VoidProjectPayment(ctx context.Context, cmd VoidProjectPaymentCommand) (*domain.ProjectPayment, error) {
	var out *domain.ProjectPayment
	err := s.inTenantTx(ctx, func(ctx context.Context) error {
		if _, _, err := s.lockSellableProject(ctx, cmd.ProjectID, true); err != nil {
			return err
		}
		payments, err := s.listProjectPayments(ctx, cmd.ProjectID)
		if err != nil {
			return err
		}
		var target *domain.ProjectPayment
		for i := range payments {
			if payments[i].ID == cmd.PaymentID {
				target = &payments[i]
				break
			}
		}
		if target == nil {
			return ErrProjectPaymentNotFound
		}
		if target.Void != nil {
			return ErrProjectPaymentAlreadyVoided
		}
		org := OrgFromCtx(ctx)
		var voidedAt time.Time
		if err := s.db(ctx).QueryRow(ctx, `
			INSERT INTO project_payment_voids (payment_id, organization_id, reason, voided_by)
			VALUES ($1, $2, $3, $4)
			RETURNING voided_at`, cmd.PaymentID, org, cmd.Reason, cmd.VoidedBy).Scan(&voidedAt); err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23505" {
				return ErrProjectPaymentAlreadyVoided
			}
			return fmt.Errorf("insert payment void: %w", err)
		}
		target.Void = &domain.ProjectPaymentVoid{Reason: cmd.Reason, VoidedBy: cmd.VoidedBy, VoidedAt: voidedAt}
		if target.Kind == domain.ProjectPaymentKindDeposit && cmd.DepositVoidEvent != nil {
			ev := *cmd.DepositVoidEvent
			payload, err := json.Marshal(map[string]any{
				"paymentId":      target.ID,
				"depositEventId": target.ProjectEventID,
				"reason":         cmd.Reason,
			})
			if err != nil {
				return err
			}
			ev.Payload = payload
			if err := insertProjectEventRow(ctx, s, ev); err != nil {
				return err
			}
		}
		if err := s.InsertSecurityAuditEvent(ctx, SecurityAuditEvent{
			EventType:      "project_payment_voided",
			ActorUserID:    cmd.VoidedBy,
			OrganizationID: org,
			IP:             cmd.IP,
			RequestID:      cmd.RequestID,
			Details: map[string]interface{}{
				"project_id": cmd.ProjectID,
				"payment_id": cmd.PaymentID,
				"kind":       string(target.Kind),
				"reason":     cmd.Reason,
			},
		}); err != nil {
			return fmt.Errorf("audit project_payment_voided: %w", err)
		}
		out = target
		return nil
	})
	return out, err
}

func (s *PostgresStore) listProjectPayments(ctx context.Context, projectID string) ([]domain.ProjectPayment, error) {
	rows, err := s.db(ctx).Query(ctx, `
		SELECT p.id::text, p.organization_id::text, p.project_id::text, p.kind, p.amount::float8, p.currency,
		       COALESCE(p.payment_method, ''), COALESCE(p.reference, ''), COALESCE(p.note, ''),
		       p.received_at, p.recorded_at, COALESCE(p.recorded_by::text, ''),
		       COALESCE(p.project_event_id, ''), p.origin,
		       v.reason, COALESCE(v.voided_by::text, ''), v.voided_at
		FROM project_payments p
		LEFT JOIN project_payment_voids v ON v.payment_id = p.id
		WHERE p.project_id = $1 AND p.organization_id = $2
		ORDER BY p.received_at ASC, p.recorded_at ASC, p.id ASC`, projectID, OrgFromCtx(ctx))
	if err != nil {
		return nil, fmt.Errorf("list payments: %w", err)
	}
	defer rows.Close()
	out := []domain.ProjectPayment{}
	for rows.Next() {
		var p domain.ProjectPayment
		var kind string
		var voidReason *string
		var voidedBy string
		var voidedAt *time.Time
		if err := rows.Scan(&p.ID, &p.OrganizationID, &p.ProjectID, &kind, &p.Amount, &p.Currency,
			&p.PaymentMethod, &p.Reference, &p.Note, &p.ReceivedAt, &p.RecordedAt, &p.RecordedBy,
			&p.ProjectEventID, &p.Origin, &voidReason, &voidedBy, &voidedAt); err != nil {
			return nil, fmt.Errorf("scan payment: %w", err)
		}
		p.Kind = domain.ProjectPaymentKind(kind)
		if voidReason != nil && voidedAt != nil {
			p.Void = &domain.ProjectPaymentVoid{Reason: *voidReason, VoidedBy: voidedBy, VoidedAt: *voidedAt}
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// acceptedQuoteAmount reads the frozen sale total of the exact accepted
// QuoteRevision (nil without one or for a legacy revision without snapshot).
func (s *PostgresStore) acceptedQuoteAmount(ctx context.Context, projectID string) (*domain.AcceptedQuoteAmount, error) {
	var (
		id         string
		number     int64
		acceptedAt *time.Time
		raw        []byte
	)
	err := s.db(ctx).QueryRow(ctx, `
		SELECT id::text, revision_number, accepted_at, COALESCE(commercial_snapshot, 'null'::jsonb)
		FROM quote_revisions
		WHERE project_id = $1 AND status = 'accepted'`, projectID).Scan(&id, &number, &acceptedAt, &raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("load accepted quote: %w", err)
	}
	snapshot, err := parseQuoteCommercialSnapshot(raw)
	if err != nil {
		return nil, err
	}
	if snapshot == nil {
		return nil, nil
	}
	return &domain.AcceptedQuoteAmount{
		QuoteRevisionID: id,
		RevisionNumber:  number,
		SaleTotal:       snapshot.Breakdown.SalePrice,
		Currency:        snapshot.Currency,
		AcceptedAt:      acceptedAt,
	}, nil
}

// GetProjectPaymentSummary returns the payments and server-computed balance.
func (s *PostgresStore) GetProjectPaymentSummary(ctx context.Context, projectID string) (*domain.ProjectPaymentSummary, error) {
	var out *domain.ProjectPaymentSummary
	err := s.inTenantTx(ctx, func(ctx context.Context) error {
		currency, customerID, err := s.lockSellableProject(ctx, projectID, false)
		if err != nil {
			return err
		}
		payments, err := s.listProjectPayments(ctx, projectID)
		if err != nil {
			return err
		}
		quote, err := s.acceptedQuoteAmount(ctx, projectID)
		if err != nil {
			return err
		}
		summary := domain.SummarizeProjectPayments(projectID, customerID, currency, quote, payments)
		out = &summary
		return nil
	})
	return out, err
}

// ProjectReceivable is one accepted project of the selling organization with
// its server-computed balance.
type ProjectReceivable struct {
	Summary   domain.ProjectCommercialSummary
	PaidTotal float64
	Balance   float64
}

// ListProjectReceivables returns accepted projects whose sale total the caller
// may see, with paid total and balance (one batch query for the payments).
func (s *PostgresStore) ListProjectReceivables(ctx context.Context) ([]ProjectReceivable, error) {
	summaries, err := s.ListProjectCommercialSummaries(ctx)
	if err != nil {
		return nil, err
	}
	ids := []string{}
	for _, sm := range summaries {
		if sm.QuoteStatus == domain.ProjectCommercialQuoteStatusAccepted && sm.SaleTotal != nil {
			ids = append(ids, sm.ProjectID)
		}
	}
	paid := map[string]map[string]float64{}
	if len(ids) > 0 {
		rows, err := s.db(ctx).Query(ctx, `
			SELECT p.project_id::text, p.currency, SUM(p.amount)::float8
			FROM project_payments p
			LEFT JOIN project_payment_voids v ON v.payment_id = p.id
			WHERE p.project_id = ANY($1::uuid[]) AND p.organization_id = $2 AND v.payment_id IS NULL
			GROUP BY p.project_id, p.currency`, ids, OrgFromCtx(ctx))
		if err != nil {
			return nil, fmt.Errorf("sum payments: %w", err)
		}
		for rows.Next() {
			var projectID, currency string
			var total float64
			if err := rows.Scan(&projectID, &currency, &total); err != nil {
				rows.Close()
				return nil, err
			}
			if paid[projectID] == nil {
				paid[projectID] = map[string]float64{}
			}
			paid[projectID][currency] = total
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}
	out := []ProjectReceivable{}
	for _, sm := range summaries {
		if sm.QuoteStatus != domain.ProjectCommercialQuoteStatusAccepted || sm.SaleTotal == nil {
			continue
		}
		paidTotal := float64(toCentsStorage(paid[sm.ProjectID][sm.Currency])) / 100
		balance := float64(toCentsStorage(*sm.SaleTotal)-toCentsStorage(paidTotal)) / 100
		out = append(out, ProjectReceivable{Summary: sm, PaidTotal: paidTotal, Balance: balance})
	}
	return out, nil
}

func toCentsStorage(v float64) int64 {
	if v >= 0 {
		return int64(v*100 + 0.5)
	}
	return int64(v*100 - 0.5)
}

// IsProjectPaymentsDeleteBlock reports the explicit refusal raised by
// delete_project_tree (migration 000187) for a project with payments.
func IsProjectPaymentsDeleteBlock(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23001" && strings.Contains(pgErr.Message, "recorded payments")
}
