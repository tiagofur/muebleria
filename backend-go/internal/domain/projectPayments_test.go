package domain

import "testing"

func TestSummarizeProjectPayments(t *testing.T) {
	quote := &AcceptedQuoteAmount{QuoteRevisionID: "q1", RevisionNumber: 1, SaleTotal: 10000.10, Currency: "MXN"}
	payments := []ProjectPayment{
		{ID: "p1", Kind: ProjectPaymentKindDeposit, Amount: 5000.05, Currency: "MXN"},
		{ID: "p2", Kind: ProjectPaymentKindPayment, Amount: 1000, Currency: "MXN", Void: &ProjectPaymentVoid{Reason: "duplicado"}},
		{ID: "p3", Kind: ProjectPaymentKindPayment, Amount: 0.1, Currency: "MXN"},
		{ID: "p4", Kind: ProjectPaymentKindPayment, Amount: 50, Currency: "USD"},
	}
	s := SummarizeProjectPayments("proj", "cust", "MXN", quote, payments)
	if s.PaidTotal != 5000.15 {
		t.Fatalf("paid = %v", s.PaidTotal)
	}
	if s.Balance == nil || *s.Balance != 4999.95 {
		t.Fatalf("balance = %v", s.Balance)
	}
	if s.OtherCurrencyPayments != 1 || s.Currency != "MXN" {
		t.Fatalf("currency handling: %+v", s)
	}

	noQuote := SummarizeProjectPayments("proj", "cust", "MXN", nil, payments[:1])
	if noQuote.Balance != nil || noQuote.PaidTotal != 5000.05 {
		t.Fatalf("without accepted quote: %+v", noQuote)
	}
}

func TestValidatePaymentVoidReason(t *testing.T) {
	if _, err := ValidatePaymentVoidReason("   "); err == nil {
		t.Fatal("empty reason accepted")
	}
	long := make([]rune, PaymentVoidMaxReasonLen+1)
	for i := range long {
		long[i] = 'á'
	}
	if _, err := ValidatePaymentVoidReason(string(long)); err == nil {
		t.Fatal("long reason accepted")
	}
	if r, err := ValidatePaymentVoidReason("  cargado dos veces "); err != nil || r != "cargado dos veces" {
		t.Fatalf("normalize: %q %v", r, err)
	}
}
