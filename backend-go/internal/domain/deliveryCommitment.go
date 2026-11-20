package domain

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

// Committed delivery date (#1648). The date agreed with the customer is a
// server-authored fact: the first commitment records delivery_date_committed,
// every later change requires a reason and records delivery_date_changed.
// Estimated and actual delivery are different facts and never derive from it.

// DeliveryReasonMaxLen bounds the change reason.
const DeliveryReasonMaxLen = 500

// ErrDeliveryCommitmentUnchanged rejects a command that would not change the
// committed date (no empty events in the history).
var ErrDeliveryCommitmentUnchanged = errors.New("la fecha comprometida ya es esa")

// ErrDeliveryCommitmentClosedProject rejects committing a date on an order
// that was lost or cancelled.
var ErrDeliveryCommitmentClosedProject = errors.New("la obra está perdida o cancelada")

// DeliveryCommitmentDecision is the validated outcome of a command.
type DeliveryCommitmentDecision struct {
	Date      string
	Reason    string
	EventType string
	Previous  *string
}

// DecideDeliveryCommitment validates a set/change of the committed delivery
// date against the current state of the project. Field errors reuse
// DepositFieldError so the API answers typed fieldErrors.
func DecideDeliveryCommitment(current *string, status *CommercialStatus, date, reason string) (DeliveryCommitmentDecision, error) {
	date = strings.TrimSpace(date)
	reason = strings.TrimSpace(reason)
	out := DeliveryCommitmentDecision{Date: date, Reason: reason, Previous: current}
	parsed, err := time.Parse("2006-01-02", date)
	if err != nil {
		return out, &DepositFieldError{Field: "date", Message: "la fecha debe tener el formato AAAA-MM-DD"}
	}
	if parsed.Year() < 2000 || parsed.Year() > 2100 {
		return out, &DepositFieldError{Field: "date", Message: "la fecha está fuera de rango"}
	}
	if len([]rune(reason)) > DeliveryReasonMaxLen {
		return out, &DepositFieldError{Field: "reason", Message: fmt.Sprintf("el motivo admite hasta %d caracteres", DeliveryReasonMaxLen)}
	}
	if status != nil && (*status == CommercialStatusLost || *status == CommercialStatusCancelled) {
		return out, ErrDeliveryCommitmentClosedProject
	}
	if current == nil || *current == "" {
		out.Previous = nil
		out.EventType = "delivery_date_committed"
		return out, nil
	}
	if *current == date {
		return out, ErrDeliveryCommitmentUnchanged
	}
	if reason == "" {
		return out, &DepositFieldError{Field: "reason", Message: "indicá el motivo del cambio de fecha comprometida"}
	}
	out.EventType = "delivery_date_changed"
	return out, nil
}
