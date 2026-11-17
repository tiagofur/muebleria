package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

const paymentTestID = "56000000-0000-4000-8000-000000001649"

func paymentRequest(t *testing.T, method, path, role, userID, body string) *http.Request {
	t.Helper()
	req := withClaims(httptest.NewRequest(method, path, strings.NewReader(body)), userID, role)
	req.SetPathValue("projectId", commercialTestProjectID)
	req.SetPathValue("paymentId", paymentTestID)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	return req
}

func TestRecordProjectPayment_ServerAuthoredLaterPayment(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	rr := httptest.NewRecorder()
	srv.HandleRecordProjectPayment(rr, paymentRequest(t, http.MethodPost, "/api/projects/x/payments", string(domain.RoleVendedor), "user-1649",
		`{"amount":1500.5,"currency":"MXN","paymentMethod":"cash","note":"saldo parcial"}`))
	if rr.Code != http.StatusCreated {
		t.Fatalf("status %d: %s", rr.Code, rr.Body.String())
	}
	cmd := store.paymentCommands[0]
	if cmd.DepositEvent != nil || cmd.Payment.Kind != domain.ProjectPaymentKindPayment || cmd.Payment.RecordedBy != "user-1649" || cmd.Payment.Amount != 1500.5 {
		t.Fatalf("payment command: %+v", cmd)
	}
	var dto openapi.ProjectPayment
	if err := json.Unmarshal(rr.Body.Bytes(), &dto); err != nil || dto.Kind != "payment" || dto.PaymentMethod == nil || *dto.PaymentMethod != "cash" {
		t.Fatalf("dto %+v err=%v", dto, err)
	}

	rr = httptest.NewRecorder()
	srv.HandleRecordProjectPayment(rr, paymentRequest(t, http.MethodPost, "/api/projects/x/payments", string(domain.RoleIngeniero), "user-1649", `{"amount":10,"currency":"MXN"}`))
	if rr.Code != http.StatusForbidden || len(store.paymentCommands) != 1 {
		t.Fatalf("role without commercial authority: %d", rr.Code)
	}
}

func TestVoidProjectPayment_RequiresReasonAndBuildsDepositVoidEvent(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	rr := httptest.NewRecorder()
	srv.HandleVoidProjectPayment(rr, paymentRequest(t, http.MethodPost, "/api/projects/x/payments/y/void", string(domain.RoleAdmin), "admin-1", `{"reason":"   "}`))
	if rr.Code != http.StatusBadRequest || len(store.voidCommands) != 0 {
		t.Fatalf("blank reason: %d %s", rr.Code, rr.Body.String())
	}
	rr = httptest.NewRecorder()
	srv.HandleVoidProjectPayment(rr, paymentRequest(t, http.MethodPost, "/api/projects/x/payments/y/void", string(domain.RoleAdmin), "admin-1", `{"reason":" cargado dos veces "}`))
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rr.Code, rr.Body.String())
	}
	cmd := store.voidCommands[0]
	if cmd.Reason != "cargado dos veces" || cmd.VoidedBy != "admin-1" || cmd.PaymentID != paymentTestID {
		t.Fatalf("void command: %+v", cmd)
	}
	if cmd.DepositVoidEvent == nil || cmd.DepositVoidEvent.Type != "deposit_voided" || *cmd.DepositVoidEvent.ByUserID != "admin-1" {
		t.Fatalf("deposit void event: %+v", cmd.DepositVoidEvent)
	}

	for err, want := range map[error]int{
		storage.ErrProjectPaymentAlreadyVoided:  http.StatusConflict,
		storage.ErrProjectPaymentNotFound:       http.StatusNotFound,
		storage.ErrProjectPaymentTargetNotFound: http.StatusNotFound,
	} {
		store := &stubStore{paymentErr: err}
		srv := &Server{Store: store}
		rr := httptest.NewRecorder()
		srv.HandleVoidProjectPayment(rr, paymentRequest(t, http.MethodPost, "/x", string(domain.RoleAdmin), "admin-1", `{"reason":"error"}`))
		if rr.Code != want {
			t.Fatalf("%v: status %d want %d", err, rr.Code, want)
		}
	}
}

func TestProjectPaymentSummary_BalanceAndSellerOwnership(t *testing.T) {
	quote := &domain.AcceptedQuoteAmount{QuoteRevisionID: "q", RevisionNumber: 2, SaleTotal: 10000, Currency: "MXN"}
	summary := domain.SummarizeProjectPayments(commercialTestProjectID, "c1", "MXN", quote, []domain.ProjectPayment{
		{ID: "p1", Kind: domain.ProjectPaymentKindDeposit, Amount: 4000, Currency: "MXN"},
	})
	store := &stubStore{
		paymentSummary:      &summary,
		projectReturnedByID: &domain.Project{ID: commercialTestProjectID, OwnerUserID: "seller-a"},
	}
	srv := &Server{Store: store}

	rr := httptest.NewRecorder()
	srv.HandleProjectPaymentSummary(rr, paymentRequest(t, http.MethodGet, "/x", string(domain.RoleVendedor), "seller-a", ""))
	if rr.Code != http.StatusOK {
		t.Fatalf("owner seller: %d %s", rr.Code, rr.Body.String())
	}
	var dto openapi.ProjectPaymentSummary
	if err := json.Unmarshal(rr.Body.Bytes(), &dto); err != nil || dto.Balance == nil || *dto.Balance != 6000 || dto.PaidTotal != 4000 || dto.AcceptedQuote == nil {
		t.Fatalf("summary %+v err=%v", dto, err)
	}

	rr = httptest.NewRecorder()
	srv.HandleProjectPaymentSummary(rr, paymentRequest(t, http.MethodGet, "/x", string(domain.RoleVendedor), "seller-b", ""))
	if rr.Code != http.StatusNotFound {
		t.Fatalf("another seller's project must 404, got %d", rr.Code)
	}
	rr = httptest.NewRecorder()
	srv.HandleProjectPaymentSummary(rr, paymentRequest(t, http.MethodGet, "/x", string(domain.RoleGerenteVentas), "manager", ""))
	if rr.Code != http.StatusOK {
		t.Fatalf("sales manager sees all owners: %d", rr.Code)
	}
}

func TestProjectReceivables_FiltersBySellerOwnership(t *testing.T) {
	total := 1000.0
	name := "Cliente"
	store := &stubStore{receivables: []storage.ProjectReceivable{
		{Summary: domain.ProjectCommercialSummary{ProjectID: "p1", ProjectName: "Mía", Currency: "MXN", SaleTotal: &total, OwnerUserID: "seller-a", CustomerName: &name}, PaidTotal: 400, Balance: 600},
		{Summary: domain.ProjectCommercialSummary{ProjectID: "p2", ProjectName: "Ajena", Currency: "MXN", SaleTotal: &total, OwnerUserID: "seller-b"}, PaidTotal: 0, Balance: 1000},
	}}
	srv := &Server{Store: store}
	read := func(role, user string) openapi.ProjectReceivablesResponse {
		rr := httptest.NewRecorder()
		srv.HandleProjectReceivables(rr, paymentRequest(t, http.MethodGet, "/api/projects/receivables", role, user, ""))
		if rr.Code != http.StatusOK {
			t.Fatalf("%s: %d %s", role, rr.Code, rr.Body.String())
		}
		var out openapi.ProjectReceivablesResponse
		if err := json.Unmarshal(rr.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	if got := read(string(domain.RoleVendedor), "seller-a"); len(got.Items) != 1 || got.Items[0].ProjectId != "p1" || got.Items[0].Balance != 600 {
		t.Fatalf("seller sees own receivables only: %+v", got)
	}
	if got := read(string(domain.RoleAdmin), "admin"); len(got.Items) != 2 {
		t.Fatalf("admin sees all receivables: %+v", got)
	}
}

func TestDeleteProject_WithPaymentsAnswersConflict(t *testing.T) {
	fk := &pgconn.PgError{Code: "23001", Message: "project has recorded payments"}
	store := &stubStore{
		projectReturnedByID: &domain.Project{ID: "p1", OwnerUserID: "admin"},
		deleteProjectErr:    fmt.Errorf("deleting project tree: %w", fk),
	}
	srv := &Server{Store: store}
	req := withClaims(httptest.NewRequest(http.MethodDelete, "/api/projects/p1", nil), "admin", string(domain.RoleAdmin))
	req.SetPathValue("id", "p1")
	rr := httptest.NewRecorder()
	srv.HandleProjectByID(rr, req)
	if rr.Code != http.StatusConflict || !strings.Contains(rr.Body.String(), "cobros registrados") {
		t.Fatalf("status %d body %s", rr.Code, rr.Body.String())
	}
}
