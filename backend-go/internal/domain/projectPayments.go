package domain

import (
	"strings"
	"time"
)

// Project payments (#1649): the append-only money ledger of a project. The
// balance is server-computed from the exact accepted QuoteRevision snapshot
// (breakdown.sale_price) minus the non-voided payments in the same currency.

// ProjectPaymentKind distinguishes the deposit from later payments.
type ProjectPaymentKind string

const (
	ProjectPaymentKindDeposit ProjectPaymentKind = "deposit"
	ProjectPaymentKindPayment ProjectPaymentKind = "payment"
)

// PaymentVoidMaxReasonLen bounds the mandatory void reason.
const PaymentVoidMaxReasonLen = 500

// ProjectPaymentVoid is the cancellation of one payment.
type ProjectPaymentVoid struct {
	Reason   string
	VoidedBy string
	VoidedAt time.Time
}

// ProjectPayment is one amount the customer paid.
type ProjectPayment struct {
	ID             string
	OrganizationID string
	ProjectID      string
	Kind           ProjectPaymentKind
	Amount         float64
	Currency       string
	PaymentMethod  string
	Reference      string
	Note           string
	ReceivedAt     time.Time
	RecordedAt     time.Time
	// RecordedBy is empty only for payments migrated from legacy events
	// whose author was never recorded.
	RecordedBy     string
	ProjectEventID string
	Origin         string
	Void           *ProjectPaymentVoid
}

// AcceptedQuoteAmount is the frozen sale total of the exact accepted
// QuoteRevision the balance is computed against.
type AcceptedQuoteAmount struct {
	QuoteRevisionID string
	RevisionNumber  int64
	SaleTotal       float64
	Currency        string
	AcceptedAt      *time.Time
}

// ProjectPaymentSummary is the server-owned payment state of one project.
type ProjectPaymentSummary struct {
	ProjectID     string
	CustomerID    string
	Currency      string
	AcceptedQuote *AcceptedQuoteAmount
	Payments      []ProjectPayment
	// PaidTotal sums non-voided payments in Currency.
	PaidTotal float64
	// Balance is nil without an accepted quote (nothing owed yet).
	Balance *float64
	// OtherCurrencyPayments counts non-voided payments in another currency,
	// excluded from the balance instead of being silently converted.
	OtherCurrencyPayments int
}

// ValidatePaymentVoidReason normalizes and checks a void reason.
func ValidatePaymentVoidReason(reason string) (string, error) {
	r := strings.TrimSpace(reason)
	if r == "" {
		return r, &DepositFieldError{Field: "reason", Message: "indicá el motivo de la anulación"}
	}
	if len([]rune(r)) > PaymentVoidMaxReasonLen {
		return r, &DepositFieldError{Field: "reason", Message: "el motivo admite hasta 500 caracteres"}
	}
	return r, nil
}

// SummarizeProjectPayments computes paid total and balance. Amounts are
// rounded to cents so float sums never drift from the NUMERIC(14,2) ledger.
func SummarizeProjectPayments(projectID, customerID, projectCurrency string, quote *AcceptedQuoteAmount, payments []ProjectPayment) ProjectPaymentSummary {
	currency := projectCurrency
	if quote != nil && quote.Currency != "" {
		currency = quote.Currency
	}
	summary := ProjectPaymentSummary{
		ProjectID:     projectID,
		CustomerID:    customerID,
		Currency:      currency,
		AcceptedQuote: quote,
		Payments:      payments,
	}
	var paidCents int64
	for _, p := range payments {
		if p.Void != nil {
			continue
		}
		if p.Currency != currency {
			summary.OtherCurrencyPayments++
			continue
		}
		paidCents += toCents(p.Amount)
	}
	summary.PaidTotal = float64(paidCents) / 100
	if quote != nil {
		balance := float64(toCents(quote.SaleTotal)-paidCents) / 100
		summary.Balance = &balance
	}
	return summary
}

func toCents(v float64) int64 {
	if v >= 0 {
		return int64(v*100 + 0.5)
	}
	return int64(v*100 - 0.5)
}
