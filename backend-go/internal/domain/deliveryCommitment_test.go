package domain

import (
	"errors"
	"testing"
)

func TestDecideDeliveryCommitment(t *testing.T) {
	won := CommercialStatusWon
	lost := CommercialStatusLost
	cancelled := CommercialStatusCancelled
	prev := "2026-12-10"

	d, err := DecideDeliveryCommitment(nil, &won, " 2026-12-10 ", "")
	if err != nil || d.EventType != "delivery_date_committed" || d.Date != "2026-12-10" || d.Previous != nil {
		t.Fatalf("first commitment: %+v %v", d, err)
	}
	empty := ""
	if d, err := DecideDeliveryCommitment(&empty, nil, "2026-12-10", ""); err != nil || d.EventType != "delivery_date_committed" {
		t.Fatalf("empty current is a first commitment: %+v %v", d, err)
	}
	d, err = DecideDeliveryCommitment(&prev, &won, "2026-12-20", " proveedor atrasado ")
	if err != nil || d.EventType != "delivery_date_changed" || d.Reason != "proveedor atrasado" || *d.Previous != prev {
		t.Fatalf("change: %+v %v", d, err)
	}

	var fe *DepositFieldError
	if _, err := DecideDeliveryCommitment(&prev, &won, "2026-12-20", "  "); !errors.As(err, &fe) || fe.Field != "reason" {
		t.Fatalf("change without reason: %v", err)
	}
	if _, err := DecideDeliveryCommitment(&prev, &won, "2026-12-10", "x"); !errors.Is(err, ErrDeliveryCommitmentUnchanged) {
		t.Fatalf("unchanged: %v", err)
	}
	for _, bad := range []string{"", "10/12/2026", "2026-02-30", "1999-12-31", "2101-01-01"} {
		if _, err := DecideDeliveryCommitment(nil, nil, bad, ""); !errors.As(err, &fe) || fe.Field != "date" {
			t.Fatalf("date %q: %v", bad, err)
		}
	}
	long := make([]rune, DeliveryReasonMaxLen+1)
	for i := range long {
		long[i] = 'a'
	}
	if _, err := DecideDeliveryCommitment(&prev, nil, "2026-12-11", string(long)); !errors.As(err, &fe) || fe.Field != "reason" {
		t.Fatalf("long reason: %v", err)
	}
	for _, st := range []*CommercialStatus{&lost, &cancelled} {
		if _, err := DecideDeliveryCommitment(nil, st, "2026-12-11", ""); !errors.Is(err, ErrDeliveryCommitmentClosedProject) {
			t.Fatalf("closed %s: %v", *st, err)
		}
	}
	if !IsServerAuthoredCommercialEventType("delivery_date_changed") || !IsValidProjectEventType("delivery_date_committed") {
		t.Fatal("delivery events must be canonical and server-authored")
	}
}
