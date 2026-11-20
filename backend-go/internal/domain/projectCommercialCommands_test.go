package domain

import (
	"encoding/json"
	"errors"
	"math"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// #1647: the deposit command validation is pinned TS↔Go by the shared fixture.
func TestValidateDepositPayloadParityFixture(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "contracts", "projectDepositPayload.contract.json"))
	if err != nil {
		t.Fatalf("read contracts/projectDepositPayload.contract.json: %v", err)
	}
	var fixture struct {
		Cases []struct {
			Name  string `json:"name"`
			Input struct {
				Amount        float64 `json:"amount"`
				Currency      string  `json:"currency"`
				PaymentMethod string  `json:"paymentMethod"`
				Reference     string  `json:"reference"`
				Note          string  `json:"note"`
			} `json:"input"`
			InvalidField *string `json:"invalidField"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &fixture); err != nil {
		t.Fatalf("parse fixture: %v", err)
	}
	if len(fixture.Cases) == 0 {
		t.Fatal("fixture sin casos")
	}
	for _, tc := range fixture.Cases {
		t.Run(tc.Name, func(t *testing.T) {
			_, err := ValidateDepositPayload(DepositPayloadInput{
				Amount:        tc.Input.Amount,
				Currency:      tc.Input.Currency,
				PaymentMethod: tc.Input.PaymentMethod,
				Reference:     tc.Input.Reference,
				Note:          tc.Input.Note,
			})
			if tc.InvalidField == nil {
				if err != nil {
					t.Fatalf("expected valid, got %v", err)
				}
				return
			}
			var fieldErr *DepositFieldError
			if !errors.As(err, &fieldErr) || fieldErr.Field != *tc.InvalidField {
				t.Fatalf("expected invalid field %q, got %v", *tc.InvalidField, err)
			}
		})
	}
}

func TestValidateDepositPayloadRejectsNonFiniteAndTrims(t *testing.T) {
	for _, amount := range []float64{math.NaN(), math.Inf(1), math.Inf(-1)} {
		if _, err := ValidateDepositPayload(DepositPayloadInput{Amount: amount, Currency: "MXN"}); err == nil {
			t.Fatalf("amount %v accepted", amount)
		}
	}
	out, err := ValidateDepositPayload(DepositPayloadInput{Amount: 1, Currency: " MXN ", Reference: " r ", Note: " n "})
	if err != nil || out.Currency != "MXN" || out.Reference != "r" || out.Note != "n" {
		t.Fatalf("normalization failed: %+v %v", out, err)
	}
}

func TestValidateDepositReceivedAt(t *testing.T) {
	now := time.Date(2026, 11, 17, 12, 0, 0, 0, time.UTC)
	if err := ValidateDepositReceivedAt(now.Add(-72*time.Hour), now); err != nil {
		t.Fatalf("past date rejected: %v", err)
	}
	if err := ValidateDepositReceivedAt(now.Add(4*time.Minute), now); err != nil {
		t.Fatalf("clock skew rejected: %v", err)
	}
	if err := ValidateDepositReceivedAt(now.Add(time.Hour), now); err == nil {
		t.Fatal("future date accepted")
	}
}

func TestCommercialStatusEventTypes(t *testing.T) {
	for status, want := range map[CommercialStatus]string{
		CommercialStatusDraft: "quote_created", CommercialStatusSent: "quote_sent", CommercialStatusWon: "quote_won",
		CommercialStatusLost: "quote_lost", CommercialStatusExpired: "quote_expired", CommercialStatusCancelled: "quote_cancelled",
	} {
		got, ok := CommercialStatusEventType(status)
		if !ok || got != want || !IsValidProjectEventType(got) || !IsServerAuthoredCommercialEventType(got) {
			t.Fatalf("status %s → %q (ok=%v), want %q", status, got, ok, want)
		}
	}
	if _, ok := CommercialStatusEventType("archived"); ok {
		t.Fatal("unknown status accepted")
	}
	if !IsServerAuthoredCommercialEventType("deposit_received") || IsServerAuthoredCommercialEventType("survey_started") {
		t.Fatal("server-authored classification wrong")
	}
}
