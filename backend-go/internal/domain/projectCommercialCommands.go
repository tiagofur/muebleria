package domain

import (
	"fmt"
	"math"
	"regexp"
	"strings"
	"time"
)

// Project commercial commands (#1647). Deposits and commercial-status changes
// are server-authored: the API validates the payload, stamps the actor and
// persists the event (plus the commercial_status column) in one transaction.
// The validation rules are pinned TS↔Go by contracts/projectDepositPayload.contract.json
// (packages/domain/src/projectLifecycle.ts → validateDepositPayload).

// Deposit payload limits shared with the TypeScript validator.
const (
	DepositMaxAmount       = 1e12
	DepositMaxReferenceLen = 120
	DepositMaxNoteLen      = 500
	// DepositMaxFutureSkew bounds a client-declared receivedAt: the real
	// payment date can be in the past, never meaningfully in the future.
	DepositMaxFutureSkew = 5 * time.Minute
)

var depositCurrencyPattern = regexp.MustCompile(`^[A-Z]{3}$`)

// DepositPaymentMethods is the closed vocabulary for paymentMethod.
var DepositPaymentMethods = map[string]struct{}{
	"cash":     {},
	"transfer": {},
	"card":     {},
	"check":    {},
	"other":    {},
}

// DepositPayloadInput is the command input before validation.
type DepositPayloadInput struct {
	Amount        float64
	Currency      string
	PaymentMethod string
	Reference     string
	Note          string
}

// DepositFieldError names the offending field so the API can return typed
// fieldErrors instead of a generic message.
type DepositFieldError struct {
	Field   string
	Message string
}

func (e *DepositFieldError) Error() string { return e.Field + ": " + e.Message }

// ValidateDepositPayload checks a deposit command and returns the normalized
// payload (trimmed strings). The rules mirror validateDepositPayload in TS.
func ValidateDepositPayload(in DepositPayloadInput) (DepositPayloadInput, error) {
	out := DepositPayloadInput{
		Amount:        in.Amount,
		Currency:      strings.TrimSpace(in.Currency),
		PaymentMethod: strings.TrimSpace(in.PaymentMethod),
		Reference:     strings.TrimSpace(in.Reference),
		Note:          strings.TrimSpace(in.Note),
	}
	if math.IsNaN(out.Amount) || math.IsInf(out.Amount, 0) || out.Amount <= 0 {
		return out, &DepositFieldError{Field: "amount", Message: "el monto del anticipo debe ser mayor a cero"}
	}
	if out.Amount > DepositMaxAmount {
		return out, &DepositFieldError{Field: "amount", Message: "el monto del anticipo excede el máximo permitido"}
	}
	if !depositCurrencyPattern.MatchString(out.Currency) {
		return out, &DepositFieldError{Field: "currency", Message: "la moneda debe ser un código ISO de tres letras (p. ej. MXN)"}
	}
	if out.PaymentMethod != "" {
		if _, ok := DepositPaymentMethods[out.PaymentMethod]; !ok {
			return out, &DepositFieldError{Field: "paymentMethod", Message: "medio de pago desconocido"}
		}
	}
	if len([]rune(out.Reference)) > DepositMaxReferenceLen {
		return out, &DepositFieldError{Field: "reference", Message: fmt.Sprintf("la referencia admite hasta %d caracteres", DepositMaxReferenceLen)}
	}
	if len([]rune(out.Note)) > DepositMaxNoteLen {
		return out, &DepositFieldError{Field: "note", Message: fmt.Sprintf("la nota admite hasta %d caracteres", DepositMaxNoteLen)}
	}
	return out, nil
}

// ValidateDepositReceivedAt rejects a declared payment date in the future.
func ValidateDepositReceivedAt(receivedAt, now time.Time) error {
	if receivedAt.After(now.Add(DepositMaxFutureSkew)) {
		return &DepositFieldError{Field: "receivedAt", Message: "la fecha del anticipo no puede ser futura"}
	}
	return nil
}

// commercialStatusEventTypes maps each commercial status to the lifecycle
// event that records it (parity with setProjectCommercialStatus in TS).
var commercialStatusEventTypes = map[CommercialStatus]string{
	CommercialStatusDraft:     "quote_created",
	CommercialStatusSent:      "quote_sent",
	CommercialStatusWon:       "quote_won",
	CommercialStatusLost:      "quote_lost",
	CommercialStatusExpired:   "quote_expired",
	CommercialStatusCancelled: "quote_cancelled",
}

// CommercialStatusEventType returns the lifecycle event type recording the
// given status, and false for an unknown status.
func CommercialStatusEventType(status CommercialStatus) (string, bool) {
	t, ok := commercialStatusEventTypes[status]
	return t, ok
}

// IsServerAuthoredCommercialEventType reports whether a lifecycle event type
// may only be created by the commercial commands (#1647), never appended as a
// new event through the generic project aggregate PUT.
func IsServerAuthoredCommercialEventType(eventType string) bool {
	if eventType == "deposit_received" || eventType == "deposit_voided" ||
		eventType == "delivery_date_committed" || eventType == "delivery_date_changed" {
		return true
	}
	for _, t := range commercialStatusEventTypes {
		if t == eventType {
			return true
		}
	}
	return false
}
