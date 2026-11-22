package storage

// #1650 sending the exact QuoteRevision to the customer. A delivery row is
// written in the request's tenant transaction; for email the sealed outbox
// message (with the exact PDF) is enqueued in that same transaction, and the
// real send moment is recorded later by the worker through
// record_quote_delivery_outcome (000193). WhatsApp deliveries become "sent"
// only on the user's explicit confirmation.

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/tiagofur/muebles-backend/internal/mail"
)

// EmailKindQuote is the outbox kind for quote emails; ref = delivery id.
const EmailKindQuote = "quote"

// QuoteEmailsPerHour caps quote emails per organization (abuse throttle);
// QuoteEmailRepeatCooldown refuses the same revision to the same address
// again within the window (double click, impatient retry).
const (
	QuoteEmailsPerHour       = 30
	QuoteEmailRepeatCooldown = 2 * time.Minute
)

// QuoteEmailTTL bounds how long a quote email may wait in the outbox before
// the delivery is closed as failed.
const QuoteEmailTTL = 72 * time.Hour

var (
	// ErrQuoteDeliveryTargetNotFound is the uniform 404 for an unknown or
	// out-of-tenant project/revision/delivery.
	ErrQuoteDeliveryTargetNotFound = errors.New("quote delivery target not found")
	// ErrQuoteDeliveryNotSendable means the revision is a draft or superseded.
	ErrQuoteDeliveryNotSendable = errors.New("quote revision is not sendable")
	// ErrQuoteDeliveryAmountsWithheld means the caller's organization does not
	// own the retail price (manufacturing-only): it cannot send the quote.
	ErrQuoteDeliveryAmountsWithheld = errors.New("quote amounts withheld for this organization")
	// ErrQuoteDeliveryRateLimited means the organization exceeded the quote
	// email budget or repeated the same send within the cooldown.
	ErrQuoteDeliveryRateLimited = errors.New("quote delivery rate limited")
	// ErrQuoteDeliveryNotConfirmable means the delivery is not a pending
	// WhatsApp delivery of the caller's organization.
	ErrQuoteDeliveryNotConfirmable = errors.New("quote delivery not confirmable")
)

// QuoteDeliveryContext is the authoritative data a send is built from.
type QuoteDeliveryContext struct {
	ProjectID        string
	ProjectName      string
	CustomerName     string
	CustomerEmail    string
	CustomerPhone    string
	OrganizationName string
	QuoteRevisionID  string
	RevisionNumber   int
	RevisionStatus   string
	SaleTotal        float64
	Currency         string
	HasSnapshot      bool
}

// QuoteDelivery is one recorded send.
type QuoteDelivery struct {
	ID              string
	ProjectID       string
	QuoteRevisionID string
	RevisionNumber  int
	Channel         string
	Recipient       string
	Variant         string
	PDFSHA256       string
	PDFBytes        int
	PDFFileName     string
	Status          string
	RequestedBy     string
	RequestedAt     time.Time
	SentAt          *time.Time
	FailureReason   string
}

// GetQuoteDeliveryContext loads the exact revision with its project,
// customer contact and organization name, enforcing tenant scope and the
// retail-amount authority (only the owner/sales organization may send).
func (s *PostgresStore) GetQuoteDeliveryContext(ctx context.Context, projectID, quoteRevisionID string) (*QuoteDeliveryContext, error) {
	org := OrgFromCtx(ctx)
	out := QuoteDeliveryContext{ProjectID: projectID, QuoteRevisionID: quoteRevisionID}
	var projectOrgID, salesOrgID string
	var rawSnapshot []byte
	err := s.db(ctx).QueryRow(ctx, `
		SELECT p.name, p.organization_id::text, COALESCE(p.sales_organization_id::text, ''),
		       COALESCE(c.name, ''), COALESCE(c.email, ''), COALESCE(c.phone, ''),
		       COALESCE(o.name, ''),
		       q.revision_number, q.status, COALESCE(q.commercial_snapshot, 'null'::jsonb)
		  FROM quote_revisions q
		  JOIN projects p ON p.id = q.project_id
		  LEFT JOIN customers c ON c.id = p.customer_id
		  LEFT JOIN organizations o ON o.id = $3
		 WHERE q.id = $2 AND q.project_id = $1
		   AND (p.organization_id = $3 OR p.sales_organization_id = $3 OR p.manufacturing_organization_id = $3)`,
		projectID, quoteRevisionID, org).Scan(
		&out.ProjectName, &projectOrgID, &salesOrgID,
		&out.CustomerName, &out.CustomerEmail, &out.CustomerPhone,
		&out.OrganizationName, &out.RevisionNumber, &out.RevisionStatus, &rawSnapshot)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrQuoteDeliveryTargetNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("load quote delivery context: %w", err)
	}
	if projectOrgID != org && salesOrgID != org {
		return nil, ErrQuoteDeliveryAmountsWithheld
	}
	snapshot, err := parseQuoteCommercialSnapshot(rawSnapshot)
	if err != nil {
		return nil, err
	}
	if snapshot != nil {
		out.HasSnapshot = true
		out.SaleTotal = snapshot.Breakdown.SalePrice
		out.Currency = snapshot.Currency
	}
	return &out, nil
}

// QuoteDeliverySendable reports whether a revision status may be sent to
// the customer: published or accepted (a draft is not final, a superseded
// revision was replaced).
func QuoteDeliverySendable(status string) bool {
	return status == "published" || status == "accepted"
}

// CreateQuoteDeliveryCommand records a send request. Email carries the
// rendered message (with the exact PDF) to enqueue in the same transaction.
type CreateQuoteDeliveryCommand struct {
	Delivery  QuoteDelivery
	Email     *mail.Message
	IP        string
	RequestID string
}

// CreateQuoteDelivery inserts the delivery, its audit row and (email) the
// sealed outbox message atomically. It must run inside the request's tenant
// transaction.
func (s *PostgresStore) CreateQuoteDelivery(ctx context.Context, cmd CreateQuoteDeliveryCommand) (*QuoteDelivery, error) {
	if transactionFromContext(ctx) == nil {
		var out *QuoteDelivery
		actor, _ := TenantActorFromCtx(ctx)
		if actor.OrganizationID == "" {
			actor.OrganizationID = OrgFromCtx(ctx)
		}
		err := s.WithinTenantTx(ctx, actor, func(txCtx context.Context) error {
			var inner error
			out, inner = s.CreateQuoteDelivery(txCtx, cmd)
			return inner
		})
		return out, err
	}
	d := cmd.Delivery
	if d.ID == "" {
		d.ID = uuid.NewString()
	}
	org := OrgFromCtx(ctx)
	if d.Channel == "email" {
		// Abuse throttle: the platform's sender must not become a bulk mailer.
		// Serialized per organization so concurrent requests cannot both pass.
		if _, err := s.db(ctx).Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('granete:quote-email:' || $1))`, org); err != nil {
			return nil, fmt.Errorf("quote email throttle lock: %w", err)
		}
		var lastHour, sameRecent int
		if err := s.db(ctx).QueryRow(ctx, `
			SELECT count(*) FILTER (WHERE requested_at > NOW() - interval '1 hour'),
			       count(*) FILTER (WHERE requested_at > NOW() - make_interval(secs => $4)
			                          AND quote_revision_id = $2 AND recipient = $3)
			  FROM quote_deliveries
			 WHERE organization_id = $1 AND channel = 'email' AND status <> 'failed'`,
			org, d.QuoteRevisionID, d.Recipient, int(QuoteEmailRepeatCooldown.Seconds())).Scan(&lastHour, &sameRecent); err != nil {
			return nil, fmt.Errorf("quote email throttle: %w", err)
		}
		if lastHour >= QuoteEmailsPerHour || sameRecent > 0 {
			return nil, ErrQuoteDeliveryRateLimited
		}
	}
	switch d.Channel {
	case "email":
		if cmd.Email == nil {
			return nil, errors.New("quote email delivery requires the message")
		}
		d.Status = "queued"
	case "whatsapp":
		d.Status = "prepared"
	default:
		return nil, fmt.Errorf("unknown quote delivery channel %q", d.Channel)
	}
	if err := s.db(ctx).QueryRow(ctx, `
		INSERT INTO quote_deliveries
			(id, organization_id, project_id, quote_revision_id, revision_number, channel, recipient,
			 variant, pdf_sha256, pdf_bytes, pdf_file_name, status, requested_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, NULLIF($8,''), NULLIF($9,''), NULLIF($10,0), NULLIF($11,''), $12, $13)
		RETURNING requested_at`,
		d.ID, org, d.ProjectID, d.QuoteRevisionID, d.RevisionNumber, d.Channel, d.Recipient,
		d.Variant, d.PDFSHA256, d.PDFBytes, d.PDFFileName, d.Status, d.RequestedBy).Scan(&d.RequestedAt); err != nil {
		return nil, fmt.Errorf("insert quote delivery: %w", err)
	}
	if cmd.Email != nil {
		if _, err := s.EnqueueEmail(ctx, OutboundEmail{
			Kind:           EmailKindQuote,
			OrganizationID: org,
			Ref:            d.ID,
			Message:        *cmd.Email,
			ExpiresAt:      time.Now().Add(QuoteEmailTTL),
		}); err != nil {
			return nil, err
		}
	}
	details := map[string]interface{}{
		"delivery_id":       d.ID,
		"project_id":        d.ProjectID,
		"quote_revision_id": d.QuoteRevisionID,
		"revision_number":   d.RevisionNumber,
		"channel":           d.Channel,
	}
	if d.PDFSHA256 != "" {
		details["pdf_sha256"] = d.PDFSHA256
	}
	if err := s.InsertSecurityAuditEvent(ctx, SecurityAuditEvent{
		EventType: "quote_delivery_requested", SchemaVersion: 1, RequestID: cmd.RequestID,
		ActorUserID: d.RequestedBy, OrganizationID: org, IP: cmd.IP, Details: details,
	}); err != nil {
		return nil, fmt.Errorf("audit quote delivery: %w", err)
	}
	return &d, nil
}

// ConfirmQuoteDelivery records the user's confirmation that the prepared
// WhatsApp message was actually sent. Must run in the tenant transaction.
func (s *PostgresStore) ConfirmQuoteDelivery(ctx context.Context, projectID, deliveryID string) (*QuoteDelivery, error) {
	var ok bool
	if err := s.db(ctx).QueryRow(ctx, `SELECT confirm_quote_delivery($1, $2)`, projectID, deliveryID).Scan(&ok); err != nil {
		return nil, fmt.Errorf("confirm quote delivery: %w", err)
	}
	if !ok {
		return nil, ErrQuoteDeliveryNotConfirmable
	}
	d, err := s.getQuoteDelivery(ctx, projectID, deliveryID)
	if err != nil {
		return nil, err
	}
	return d, nil
}

const quoteDeliveryColumns = `id::text, project_id::text, quote_revision_id::text, revision_number, channel, recipient,
	COALESCE(variant,''), COALESCE(pdf_sha256,''), COALESCE(pdf_bytes,0), COALESCE(pdf_file_name,''), status,
	requested_by::text, requested_at, sent_at, COALESCE(failure_reason,'')`

func scanQuoteDelivery(row pgx.Row) (*QuoteDelivery, error) {
	var d QuoteDelivery
	if err := row.Scan(&d.ID, &d.ProjectID, &d.QuoteRevisionID, &d.RevisionNumber, &d.Channel, &d.Recipient,
		&d.Variant, &d.PDFSHA256, &d.PDFBytes, &d.PDFFileName, &d.Status,
		&d.RequestedBy, &d.RequestedAt, &d.SentAt, &d.FailureReason); err != nil {
		return nil, err
	}
	return &d, nil
}

func (s *PostgresStore) getQuoteDelivery(ctx context.Context, projectID, deliveryID string) (*QuoteDelivery, error) {
	d, err := scanQuoteDelivery(s.db(ctx).QueryRow(ctx, `SELECT `+quoteDeliveryColumns+`
		FROM quote_deliveries WHERE id = $1 AND project_id = $2 AND organization_id = $3`, deliveryID, projectID, OrgFromCtx(ctx)))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrQuoteDeliveryTargetNotFound
	}
	return d, err
}

// ListQuoteDeliveries returns the caller organization's sends for a project,
// newest first.
func (s *PostgresStore) ListQuoteDeliveries(ctx context.Context, projectID string) ([]QuoteDelivery, error) {
	if transactionFromContext(ctx) == nil {
		var out []QuoteDelivery
		actor, _ := TenantActorFromCtx(ctx)
		if actor.OrganizationID == "" {
			actor.OrganizationID = OrgFromCtx(ctx)
		}
		err := s.WithinTenantTx(ctx, actor, func(txCtx context.Context) error {
			var inner error
			out, inner = s.ListQuoteDeliveries(txCtx, projectID)
			return inner
		})
		return out, err
	}
	rows, err := s.db(ctx).Query(ctx, `SELECT `+quoteDeliveryColumns+`
		FROM quote_deliveries WHERE project_id = $1 AND organization_id = $2
		ORDER BY requested_at DESC, id DESC LIMIT 200`, projectID, OrgFromCtx(ctx))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []QuoteDelivery{}
	for rows.Next() {
		d, err := scanQuoteDelivery(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *d)
	}
	return out, rows.Err()
}

// ProjectCustomerContact is the stored contact the sends are addressed to.
type ProjectCustomerContact struct {
	Name  string
	Email string
	Phone string
}

// GetProjectCustomerContact returns the project's customer contact for the
// caller's owner/sales organization (manufacturing-only callers cannot send).
func (s *PostgresStore) GetProjectCustomerContact(ctx context.Context, projectID string) (*ProjectCustomerContact, error) {
	if transactionFromContext(ctx) == nil {
		var out *ProjectCustomerContact
		actor, _ := TenantActorFromCtx(ctx)
		if actor.OrganizationID == "" {
			actor.OrganizationID = OrgFromCtx(ctx)
		}
		err := s.WithinTenantTx(ctx, actor, func(txCtx context.Context) error {
			var inner error
			out, inner = s.GetProjectCustomerContact(txCtx, projectID)
			return inner
		})
		return out, err
	}
	org := OrgFromCtx(ctx)
	var out ProjectCustomerContact
	var projectOrgID, salesOrgID string
	err := s.db(ctx).QueryRow(ctx, `
		SELECT p.organization_id::text, COALESCE(p.sales_organization_id::text, ''),
		       COALESCE(c.name, ''), COALESCE(c.email, ''), COALESCE(c.phone, '')
		  FROM projects p LEFT JOIN customers c ON c.id = p.customer_id
		 WHERE p.id = $1
		   AND (p.organization_id = $2 OR p.sales_organization_id = $2 OR p.manufacturing_organization_id = $2)`,
		projectID, org).Scan(&projectOrgID, &salesOrgID, &out.Name, &out.Email, &out.Phone)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrQuoteDeliveryTargetNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("load project customer contact: %w", err)
	}
	if projectOrgID != org && salesOrgID != org {
		return nil, ErrQuoteDeliveryAmountsWithheld
	}
	return &out, nil
}
