package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func TestStock_ListVisibleToPurchasingRoles(t *testing.T) {
	store := &stubStore{
		stockList: []domain.MaterialStock{
			{Kind: domain.StockKindHerrajes, MaterialID: "h1", Quantity: 0, MinStock: 10},
			{Kind: domain.StockKindTableros, MaterialID: "m1", Quantity: 14, MinStock: 10},
			{Kind: domain.StockKindCintillas, MaterialID: "e1", Quantity: 5, MinStock: 10},
		},
	}
	srv := &Server{Store: store}

	for _, role := range []domain.UserRole{domain.RoleAdmin, domain.RoleGerenteProduccion, domain.RoleAlmacen} {
		req := withClaims(httptest.NewRequest(http.MethodGet, "/api/stock", nil), "u1", string(role))
		rr := httptest.NewRecorder()
		srv.HandleStockList(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("role %s: status %d want 200 (body=%s)", role, rr.Code, rr.Body.String())
		}
		var got []stockRowResponse
		if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
			t.Fatalf("decoding: %v", err)
		}
		if len(got) != 3 {
			t.Fatalf("role %s: rows %d want 3 (%#v)", role, len(got), got)
		}
		// Derived status: 0 → agotado, 14>10 → ok, 5<=10 → bajo.
		if got[0].Status != domain.StockStatusAgotado {
			t.Errorf("qty 0 → %q want agotado", got[0].Status)
		}
		if got[1].Status != domain.StockStatusOk {
			t.Errorf("qty 14 min 10 → %q want ok", got[1].Status)
		}
		if got[2].Status != domain.StockStatusBajo {
			t.Errorf("qty 5 min 10 → %q want bajo", got[2].Status)
		}
	}
}

func TestStock_ListDeniedToOtherRoles(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	for _, role := range []domain.UserRole{domain.RoleIngeniero, domain.RoleProduccion, domain.RoleVendedor, domain.RoleUser} {
		req := withClaims(httptest.NewRequest(http.MethodGet, "/api/stock", nil), "u1", string(role))
		rr := httptest.NewRecorder()
		srv.HandleStockList(rr, req)
		if rr.Code != http.StatusForbidden {
			t.Fatalf("role %s: status %d want 403 (body=%s)", role, rr.Code, rr.Body.String())
		}
	}
}

func TestStock_UpsertMinSetsThreshold(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"kind":"herrajes","material_id":"h1","min_stock":20}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/stock", body), "a1", string(domain.RoleAdmin))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleStockUpsertMin(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status %d want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if !store.stockUpsertMinCalled {
		t.Fatal("UpsertStockMin must be called")
	}
	if store.stockUpsertMinReceived.Kind != domain.StockKindHerrajes ||
		store.stockUpsertMinReceived.MaterialID != "h1" ||
		store.stockUpsertMinReceived.MinStock != 20 {
		t.Fatalf("upsert received: %#v", store.stockUpsertMinReceived)
	}
}

func TestStock_UpsertMinDeniedToGerente(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"kind":"herrajes","material_id":"h1","min_stock":20}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/stock", body), "g1", string(domain.RoleGerenteProduccion))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleStockUpsertMin(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status %d want 403 (body=%s)", rr.Code, rr.Body.String())
	}
	if store.stockUpsertMinCalled {
		t.Fatal("gerente_produccion must not set mínimos")
	}
}

func TestStock_MovementEntradaCreatesRow(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"kind":"herrajes","material_id":"h1","type":"entrada","quantity":50,"note":"OC-1001"}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/stock/movements", body), "a1", string(domain.RoleAdmin))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleStockMovementCreate(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status %d want 201 (body=%s)", rr.Code, rr.Body.String())
	}
	var got domain.StockMovement
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.BalanceAfter != 50 || got.Delta != 50 {
		t.Fatalf("entrada balance: %#v", got)
	}
	if got.Type != domain.StockMovementEntrada {
		t.Fatalf("type %q", got.Type)
	}
	// who/when stamped from the JWT actor.
	if got.ByUserID == nil || *got.ByUserID != "a1" {
		t.Fatalf("by_user_id not stamped: %#v", got)
	}
	if got.ByName == nil || *got.ByName != "a1@test.com" {
		t.Fatalf("by_name not stamped: %#v", got)
	}
}

func TestStock_MovementSalidaDebits(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	// entrada 10 → salida 3 → balance 7
	post := func(body string) {
		req := withClaims(httptest.NewRequest(http.MethodPost, "/api/stock/movements", strings.NewReader(body)), "a1", string(domain.RoleAdmin))
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()
		srv.HandleStockMovementCreate(rr, req)
		if rr.Code != http.StatusCreated {
			t.Fatalf("movement failed: %d %s", rr.Code, rr.Body.String())
		}
	}
	post(`{"kind":"herrajes","material_id":"h1","type":"entrada","quantity":10}`)
	post(`{"kind":"herrajes","material_id":"h1","type":"salida","quantity":3,"note":"desperdicio"}`)

	moves := store.stockMovements
	if len(moves) != 2 {
		t.Fatalf("movements: %#v", moves)
	}
	last := moves[1]
	if last.Delta != -3 || last.BalanceAfter != 7 {
		t.Fatalf("salida should debit 3 → balance 7, got %#v", last)
	}
	if last.Note == nil || *last.Note != "desperdicio" {
		t.Fatalf("note not kept: %#v", last)
	}
}

func TestStock_MovementSalidaInsufficient(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	req1 := withClaims(httptest.NewRequest(http.MethodPost, "/api/stock/movements",
		strings.NewReader(`{"kind":"tableros","material_id":"m1","type":"entrada","quantity":10}`)), "a1", string(domain.RoleAdmin))
	req1.Header.Set("Content-Type", "application/json")
	rr1 := httptest.NewRecorder()
	srv.HandleStockMovementCreate(rr1, req1)
	if rr1.Code != http.StatusCreated {
		t.Fatalf("entrada failed: %d %s", rr1.Code, rr1.Body.String())
	}

	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/stock/movements",
		strings.NewReader(`{"kind":"tableros","material_id":"m1","type":"salida","quantity":20}`)), "a1", string(domain.RoleAdmin))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleStockMovementCreate(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status %d want 400 (body=%s)", rr.Code, rr.Body.String())
	}
	if msg := errorBody(t, rr); !strings.Contains(msg, "faltan 10") {
		t.Errorf("message %q should state the shortfall", msg)
	}
	// The failed movement must not be recorded.
	if len(store.stockMovements) != 1 {
		t.Fatalf("failed salida must not hit the ledger: %#v", store.stockMovements)
	}
}

func TestStock_MovementOnUntrackedMaterialFails(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/stock/movements",
		strings.NewReader(`{"kind":"cintillas","material_id":"e1","type":"salida","quantity":5}`)), "a1", string(domain.RoleAdmin))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleStockMovementCreate(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("status %d want 404 (body=%s)", rr.Code, rr.Body.String())
	}
	if len(store.stockMovements) != 0 {
		t.Fatal("untracked salida must not write")
	}
}

func TestStock_MovementAjusteSigned(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	post := func(body string) {
		req := withClaims(httptest.NewRequest(http.MethodPost, "/api/stock/movements", strings.NewReader(body)), "w1", string(domain.RoleAlmacen))
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()
		srv.HandleStockMovementCreate(rr, req)
		if rr.Code != http.StatusCreated {
			t.Fatalf("movement failed: %d %s", rr.Code, rr.Body.String())
		}
	}
	post(`{"kind":"herrajes","material_id":"h1","type":"entrada","quantity":10}`)
	post(`{"kind":"herrajes","material_id":"h1","type":"ajuste","quantity":-5,"note":"conteo físico"}`)

	if len(store.stockMovements) != 2 {
		t.Fatalf("movements: %#v", store.stockMovements)
	}
	if store.stockMovements[1].BalanceAfter != 5 {
		t.Fatalf("ajuste -5 → balance 5, got %#v", store.stockMovements[1])
	}
	// positive ajuste adds
	post(`{"kind":"herrajes","material_id":"h1","type":"ajuste","quantity":2,"note":"sobrante"}`)
	if store.stockMovements[2].BalanceAfter != 7 {
		t.Fatalf("ajuste +2 → balance 7, got %#v", store.stockMovements[2])
	}
}

func TestStock_MovementGerenteDenied(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/stock/movements",
		strings.NewReader(`{"kind":"herrajes","material_id":"h1","type":"entrada","quantity":10}`)), "g1", string(domain.RoleGerenteProduccion))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleStockMovementCreate(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status %d want 403 (body=%s)", rr.Code, rr.Body.String())
	}
	if len(store.stockMovements) != 0 {
		t.Fatal("gerente must not write movements")
	}
}

func TestStock_MovementInvalidInput(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	cases := []struct {
		name string
		body string
	}{
		{"bad kind", `{"kind":"tornillos","material_id":"h1","type":"entrada","quantity":10}`},
		{"bad type", `{"kind":"herrajes","material_id":"h1","type":"transferencia","quantity":10}`},
		{"zero entrada", `{"kind":"herrajes","material_id":"h1","type":"entrada","quantity":0}`},
		{"negative entrada", `{"kind":"herrajes","material_id":"h1","type":"entrada","quantity":-3}`},
		{"zero ajuste", `{"kind":"herrajes","material_id":"h1","type":"ajuste","quantity":0,"note":"x"}`},
		{"missing material", `{"kind":"herrajes","material_id":"","type":"entrada","quantity":10}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := withClaims(httptest.NewRequest(http.MethodPost, "/api/stock/movements", strings.NewReader(tc.body)), "a1", string(domain.RoleAdmin))
			req.Header.Set("Content-Type", "application/json")
			rr := httptest.NewRecorder()
			srv.HandleStockMovementCreate(rr, req)
			if rr.Code != http.StatusBadRequest {
				t.Fatalf("status %d want 400 (body=%s)", rr.Code, rr.Body.String())
			}
		})
	}
}

func TestStock_MovementUnknownProject404(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/stock/movements",
		strings.NewReader(`{"kind":"herrajes","material_id":"h1","type":"despacho","quantity":5,"project_id":"p-nope"}`)), "a1", string(domain.RoleAdmin))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleStockMovementCreate(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("status %d want 404 (body=%s)", rr.Code, rr.Body.String())
	}
}

func TestStock_MovementUnknownReversion404(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/stock/movements",
		strings.NewReader(`{"kind":"herrajes","material_id":"h1","type":"despacho","quantity":5,"reverts_id":"sm-nope"}`)), "a1", string(domain.RoleAdmin))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleStockMovementCreate(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("status %d want 404 (body=%s)", rr.Code, rr.Body.String())
	}
}

func TestStock_MovementDespachoReversalCreditsBack(t *testing.T) {
	store := &stubStore{
		projectReturnedByID: &domain.Project{
			ID: "p1", Name: "Cocina López", CustomerID: "c1",
			Currency: "MXN", MarginFactor: 1.35, Status: domain.StatusAccepted,
		},
	}
	srv := &Server{Store: store}
	post := func(body string) int {
		req := withClaims(httptest.NewRequest(http.MethodPost, "/api/stock/movements", strings.NewReader(body)), "a1", string(domain.RoleAdmin))
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()
		srv.HandleStockMovementCreate(rr, req)
		return rr.Code
	}
	if code := post(`{"kind":"herrajes","material_id":"h1","type":"entrada","quantity":10}`); code != http.StatusCreated {
		t.Fatalf("entrada %d", code)
	}
	if code := post(`{"kind":"herrajes","material_id":"h1","type":"despacho","quantity":4,"project_id":"p1"}`); code != http.StatusCreated {
		t.Fatalf("despacho %d", code)
	}
	if len(store.stockMovements) != 2 {
		t.Fatalf("movements: %#v", store.stockMovements)
	}
	despacho := store.stockMovements[1]
	if despacho.BalanceAfter != 6 || despacho.Delta != -4 {
		t.Fatalf("despacho should leave balance 6, got %#v", despacho)
	}
	// Reversión: type despacho + reverts_id → credits back to 10.
	if code := post(`{"kind":"herrajes","material_id":"h1","type":"despacho","quantity":4,"reverts_id":"` + despacho.ID + `"}`); code != http.StatusCreated {
		t.Fatalf("reversión %d", code)
	}
	reversion := store.stockMovements[2]
	if reversion.Delta != 4 || reversion.BalanceAfter != 10 {
		t.Fatalf("reversión should credit back to 10, got %#v", reversion)
	}
	if reversion.RevertsID == nil || *reversion.RevertsID != despacho.ID {
		t.Fatalf("reversión must link the original: %#v", reversion)
	}
}

func TestStock_MovementReversalRejectsNonDespachoOrMismatch(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	post := func(body string) int {
		req := withClaims(httptest.NewRequest(http.MethodPost, "/api/stock/movements", strings.NewReader(body)), "a1", string(domain.RoleAdmin))
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()
		srv.HandleStockMovementCreate(rr, req)
		return rr.Code
	}
	if code := post(`{"kind":"herrajes","material_id":"h1","type":"entrada","quantity":5}`); code != http.StatusCreated {
		t.Fatalf("entrada h1 %d", code)
	}
	if code := post(`{"kind":"herrajes","material_id":"h2","type":"entrada","quantity":5}`); code != http.StatusCreated {
		t.Fatalf("entrada h2 %d", code)
	}
	// Reverting an entrada (not a despacho) → 400.
	if code := post(`{"kind":"herrajes","material_id":"h1","type":"despacho","quantity":5,"reverts_id":"sm-1"}`); code != http.StatusBadRequest {
		t.Fatalf("revert non-despacho: %d", code)
	}
	// Reverting a despacho of a different material → 400.
	if code := post(`{"kind":"herrajes","material_id":"h1","type":"despacho","quantity":2,"reverts_id":"sm-2"}`); code != http.StatusBadRequest {
		t.Fatalf("revert mismatched material: %d", code)
	}
}

func TestStock_MovementsListFiltered(t *testing.T) {
	store := &stubStore{
		stockMovementsList: []domain.StockMovement{
			{ID: "sm-2", Kind: domain.StockKindHerrajes, MaterialID: "h1", Type: domain.StockMovementEntrada, Delta: 50, BalanceAfter: 50},
			{ID: "sm-1", Kind: domain.StockKindTableros, MaterialID: "m1", Type: domain.StockMovementEntrada, Delta: 10, BalanceAfter: 10},
		},
	}
	srv := &Server{Store: store}
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/stock/movements?kind=herrajes&limit=5", nil), "g1", string(domain.RoleGerenteProduccion))
	rr := httptest.NewRecorder()
	srv.HandleStockMovementsList(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status %d want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	var got []domain.StockMovement
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("rows %d want 2", len(got))
	}

	// bad kind filter → 400
	req2 := withClaims(httptest.NewRequest(http.MethodGet, "/api/stock/movements?kind=tornillos", nil), "g1", string(domain.RoleGerenteProduccion))
	rr2 := httptest.NewRecorder()
	srv.HandleStockMovementsList(rr2, req2)
	if rr2.Code != http.StatusBadRequest {
		t.Fatalf("bad kind: status %d want 400 (body=%s)", rr2.Code, rr2.Body.String())
	}
}

func TestRBAC_StockParity(t *testing.T) {
	if !domain.RoleCanManageStock(domain.RoleAdmin) {
		t.Fatal("admin manages stock")
	}
	if !domain.RoleCanManageStock(domain.RoleAlmacen) {
		t.Fatal("almacen manages stock")
	}
	if domain.RoleCanManageStock(domain.RoleGerenteProduccion) {
		t.Fatal("gerente_produccion reads stock only")
	}
	if domain.RoleCanManageStock(domain.RoleProduccion) {
		t.Fatal("produccion stays out of stock")
	}
	// Derived alert states.
	if domain.StockStatusOf(0, 10) != domain.StockStatusAgotado {
		t.Fatal("0 → agotado")
	}
	if domain.StockStatusOf(5, 10) != domain.StockStatusBajo {
		t.Fatal("5 ≤ 10 → bajo")
	}
	if domain.StockStatusOf(11, 10) != domain.StockStatusOk {
		t.Fatal("11 > 10 → ok")
	}
}
