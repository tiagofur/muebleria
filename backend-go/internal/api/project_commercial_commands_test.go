package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

const commercialTestProjectID = "46000000-0000-4000-8000-000000001647"

func postCommercialCommand(t *testing.T, srv *Server, handler func(http.ResponseWriter, *http.Request), path, role, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := withClaims(httptest.NewRequest(http.MethodPost, path, strings.NewReader(body)), "user-1647", role)
	req.SetPathValue("projectId", commercialTestProjectID)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	handler(rr, req)
	return rr
}

func TestRecordProjectDeposit_ServerAuthorsTheEvent(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	rr := postCommercialCommand(t, srv, srv.HandleRecordProjectDeposit, "/api/projects/"+commercialTestProjectID+"/deposits",
		string(domain.RoleVendedor), `{"amount":2500,"currency":" MXN ","paymentMethod":"transfer","reference":" TRF-1 ","note":"50%"}`)
	if rr.Code != http.StatusCreated {
		t.Fatalf("status %d: %s", rr.Code, rr.Body.String())
	}
	if len(store.paymentCommands) != 1 {
		t.Fatalf("store commands = %d", len(store.paymentCommands))
	}
	cmd := store.paymentCommands[0]
	if cmd.DepositEvent == nil {
		t.Fatal("#1649: a deposit must carry its deposit_received lifecycle event")
	}
	ev := *cmd.DepositEvent
	if ev.Type != "deposit_received" || ev.ProjectID != commercialTestProjectID || !strings.HasPrefix(ev.ID, "evt_") {
		t.Fatalf("event identity: %+v", ev)
	}
	if ev.ByUserID == nil || *ev.ByUserID != "user-1647" {
		t.Fatalf("actor must be the authenticated user, got %v", ev.ByUserID)
	}
	// #1649: the same deposit is a payment row of the ledger.
	pay := cmd.Payment
	if pay.Kind != domain.ProjectPaymentKindDeposit || pay.Amount != 2500 || pay.Currency != "MXN" ||
		pay.Reference != "TRF-1" || pay.PaymentMethod != "transfer" || pay.RecordedBy != "user-1647" || pay.ID == "" {
		t.Fatalf("payment row: %+v", pay)
	}
	var payload map[string]any
	if err := json.Unmarshal(ev.Payload, &payload); err != nil {
		t.Fatal(err)
	}
	if payload["amount"] != 2500.0 || payload["currency"] != "MXN" || payload["reference"] != "TRF-1" || payload["paymentMethod"] != "transfer" || payload["paymentId"] != pay.ID {
		t.Fatalf("normalized payload: %v", payload)
	}
	var dto openapi.ProjectLifecycleEvent
	if err := json.Unmarshal(rr.Body.Bytes(), &dto); err != nil || dto.ByUserId != "user-1647" || dto.Type != "deposit_received" {
		t.Fatalf("response dto: %+v err=%v", dto, err)
	}
}

func TestRecordProjectDeposit_RejectsInvalidInputWithoutWriting(t *testing.T) {
	future := time.Now().Add(2 * time.Hour).UTC().Format(time.RFC3339)
	cases := []struct {
		name, role, body, field string
		status                  int
	}{
		{"monto cero", string(domain.RoleVendedor), `{"amount":0,"currency":"MXN"}`, "amount", http.StatusBadRequest},
		{"moneda inválida", string(domain.RoleVendedor), `{"amount":10,"currency":"mx"}`, "currency", http.StatusBadRequest},
		{"fecha futura", string(domain.RoleVendedor), `{"amount":10,"currency":"MXN","receivedAt":"` + future + `"}`, "receivedAt", http.StatusBadRequest},
		{"el cliente no elige el autor", string(domain.RoleVendedor), `{"amount":10,"currency":"MXN","byUserId":"otro"}`, "", http.StatusBadRequest},
		{"rol sin permiso", string(domain.RoleProduccion), `{"amount":10,"currency":"MXN"}`, "", http.StatusForbidden},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := &stubStore{}
			srv := &Server{Store: store}
			rr := postCommercialCommand(t, srv, srv.HandleRecordProjectDeposit, "/api/projects/x/deposits", tc.role, tc.body)
			if rr.Code != tc.status {
				t.Fatalf("status %d want %d: %s", rr.Code, tc.status, rr.Body.String())
			}
			if len(store.paymentCommands) != 0 {
				t.Fatal("invalid command reached the store")
			}
			if tc.field != "" {
				var apiErr openapi.ApiError
				if err := json.Unmarshal(rr.Body.Bytes(), &apiErr); err != nil || apiErr.FieldErrors[tc.field] == "" {
					t.Fatalf("expected fieldErrors.%s, got %s", tc.field, rr.Body.String())
				}
			}
		})
	}
}

func TestRecordProjectDeposit_ForeignOrMissingProjectIs404(t *testing.T) {
	store := &stubStore{paymentErr: storage.ErrProjectPaymentTargetNotFound}
	srv := &Server{Store: store}
	rr := postCommercialCommand(t, srv, srv.HandleRecordProjectDeposit, "/api/projects/x/deposits", string(domain.RoleAdmin), `{"amount":10,"currency":"MXN"}`)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status %d: %s", rr.Code, rr.Body.String())
	}

	store = &stubStore{paymentErr: errors.New("boom")}
	srv = &Server{Store: store}
	rr = postCommercialCommand(t, srv, srv.HandleRecordProjectDeposit, "/api/projects/x/deposits", string(domain.RoleAdmin), `{"amount":10,"currency":"MXN"}`)
	if rr.Code != http.StatusInternalServerError {
		t.Fatalf("storage failure status %d", rr.Code)
	}
}

func TestSetProjectCommercialStatus_WritesStatusAndEvent(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	rr := postCommercialCommand(t, srv, srv.HandleSetProjectCommercialStatus, "/api/projects/x/commercial-status",
		string(domain.RoleGerenteVentas), `{"status":"won","note":"Firmó el cliente"}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rr.Code, rr.Body.String())
	}
	cmd := store.commercialEventCommands[0]
	if cmd.CommercialStatus == nil || *cmd.CommercialStatus != domain.CommercialStatusWon || cmd.Event.Type != "quote_won" {
		t.Fatalf("command: %+v", cmd)
	}
	if cmd.Event.ByUserID == nil || *cmd.Event.ByUserID != "user-1647" || cmd.AuditEventType != "project_commercial_status_changed" {
		t.Fatalf("actor/audit: %+v", cmd)
	}
	var resp openapi.SetProjectCommercialStatusResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil || resp.CommercialStatus != "won" || resp.Event.Type != "quote_won" {
		t.Fatalf("response %+v err=%v", resp, err)
	}
}

func TestSetProjectCommercialStatus_RejectsUnknownStatusAndForbiddenRole(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	rr := postCommercialCommand(t, srv, srv.HandleSetProjectCommercialStatus, "/api/projects/x/commercial-status", string(domain.RoleAdmin), `{"status":"archived"}`)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("unknown status: %d %s", rr.Code, rr.Body.String())
	}
	rr = postCommercialCommand(t, srv, srv.HandleSetProjectCommercialStatus, "/api/projects/x/commercial-status", string(domain.RoleIngeniero), `{"status":"won"}`)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("forbidden role: %d %s", rr.Code, rr.Body.String())
	}
	if len(store.commercialEventCommands) != 0 {
		t.Fatal("rejected command reached the store")
	}
}

// #1647 negative proof: the generic project PUT cannot persist a
// client-fabricated deposit, cannot flip commercial_status and cannot choose
// the author of a new event.
func TestProjectPUT_IgnoresClientCommercialFactsAndStampsActor(t *testing.T) {
	stored := domain.CommercialStatusSent
	store := &stubStore{
		projectReturnedByID: &domain.Project{
			ID: "p1", Name: "P", CustomerID: "c1", OwnerUserID: "admin",
			Currency: "MXN", MarginFactor: 1.35, Status: domain.StatusDraft,
			CommercialStatus: &stored,
			Events:           []domain.ProjectEvent{{ID: "evt_old", ProjectID: "p1", Type: "quote_sent"}},
		},
	}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"p1","name":"P","customer_id":"10000000-0000-0000-0000-000000000001","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"items":[],
		"commercial_status":"won",
		"events":[
			{"id":"evt_old","project_id":"p1","type":"quote_sent","at":"2026-11-01T10:00:00Z"},
			{"id":"evt_fake_deposit","project_id":"p1","type":"deposit_received","at":"2026-11-17T10:00:00Z","by_user_id":"someone-else","payload":{"amount":999999,"currency":"MXN"}},
			{"id":"evt_fake_won","project_id":"p1","type":"quote_won","at":"2026-11-17T10:00:00Z"},
			{"id":"evt_survey","project_id":"p1","type":"survey_started","at":"2026-11-17T10:00:00Z","by_user_id":"someone-else"}
		]}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/projects/p1", body), "admin", string(domain.RoleAdmin))
	req.SetPathValue("id", "p1")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleProjectByID(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rr.Code, rr.Body.String())
	}
	saved := store.lastUpdatedProject
	if saved == nil {
		t.Fatal("project not saved")
	}
	if saved.CommercialStatus == nil || *saved.CommercialStatus != domain.CommercialStatusSent {
		t.Fatalf("commercial_status must keep the stored value, got %v", saved.CommercialStatus)
	}
	ids := map[string]domain.ProjectEvent{}
	for _, ev := range saved.Events {
		ids[ev.ID] = ev
	}
	if _, ok := ids["evt_fake_deposit"]; ok {
		t.Fatal("client-fabricated deposit was persisted")
	}
	if _, ok := ids["evt_fake_won"]; ok {
		t.Fatal("client-fabricated commercial event was persisted")
	}
	if _, ok := ids["evt_old"]; !ok {
		t.Fatal("already stored event must be passed through")
	}
	survey, ok := ids["evt_survey"]
	if !ok || survey.ByUserID == nil || *survey.ByUserID != "admin" {
		t.Fatalf("new event must be authored by the authenticated actor, got %+v", survey)
	}
}

// A retry with the same Idempotency-Key replays the recorded deposit instead
// of creating a second one; a different body under the same key conflicts.
func TestRecordProjectDeposit_IdempotentReplay(t *testing.T) {
	backend := newDurableBackend(func() time.Time { return time.Now().UTC() })
	store := &durableTestStore{backend: backend}
	srv := &Server{Store: store}
	handler := srv.RequireIdempotency("project.record-deposit", http.HandlerFunc(srv.HandleRecordProjectDeposit))
	send := func(body string) *httptest.ResponseRecorder {
		req := withClaims(httptest.NewRequest(http.MethodPost, "/api/projects/"+commercialTestProjectID+"/deposits", strings.NewReader(body)), "user-1647", string(domain.RoleVendedor))
		req.SetPathValue("projectId", commercialTestProjectID)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Idempotency-Key", "deposit-intent-key-1647")
		rr := httptest.NewRecorder()
		handler.ServeHTTP(rr, req)
		return rr
	}
	first := send(`{"amount":2500,"currency":"MXN"}`)
	second := send(`{"amount":2500,"currency":"MXN"}`)
	if first.Code != http.StatusCreated || second.Code != http.StatusCreated {
		t.Fatalf("status first=%d second=%d: %s", first.Code, second.Code, second.Body.String())
	}
	if second.Header().Get("Idempotency-Replayed") != "true" || first.Body.String() != second.Body.String() {
		t.Fatalf("retry must replay the same recorded event")
	}
	if len(store.paymentCommands) != 1 {
		t.Fatalf("retry created %d deposits", len(store.paymentCommands))
	}
	conflict := send(`{"amount":9999,"currency":"MXN"}`)
	if conflict.Code != http.StatusConflict || len(store.paymentCommands) != 1 {
		t.Fatalf("different body under the same key: %d (writes=%d)", conflict.Code, len(store.paymentCommands))
	}
}
