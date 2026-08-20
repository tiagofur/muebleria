package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// ─── Suppliers ─────────────────────────────────────────────────────────────

func TestSuppliers_ListVisibleToPurchasingRoles(t *testing.T) {
	store := &stubStore{
		suppliersList: []domain.Supplier{
			{ID: "s1", Name: "Maderera Norte", Active: true},
			{ID: "s2", Name: "Ferremax", Active: true},
		},
	}
	srv := &Server{Store: store}

	for _, role := range []domain.UserRole{domain.RoleAdmin, domain.RoleGerenteProduccion, domain.RoleAlmacen} {
		req := withClaims(httptest.NewRequest(http.MethodGet, "/api/suppliers", nil), "u1", string(role))
		rr := httptest.NewRecorder()
		srv.HandleSuppliers(rr, req)
		if rr.Code != http.StatusOK {
			t.Fatalf("role %s: status %d want 200 (body=%s)", role, rr.Code, rr.Body.String())
		}
		var got []domain.Supplier
		if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
			t.Fatalf("decoding: %v", err)
		}
		if len(got) != 2 {
			t.Fatalf("role %s: got %d suppliers want 2", role, len(got))
		}
	}
}

func TestSuppliers_ListDeniedToOtherRoles(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	for _, role := range []domain.UserRole{domain.RoleIngeniero, domain.RoleProduccion, domain.RoleVendedor} {
		req := withClaims(httptest.NewRequest(http.MethodGet, "/api/suppliers", nil), "u1", string(role))
		rr := httptest.NewRecorder()
		srv.HandleSuppliers(rr, req)
		if rr.Code != http.StatusForbidden {
			t.Fatalf("role %s: status %d want 403 (body=%s)", role, rr.Code, rr.Body.String())
		}
	}
}

func TestSuppliers_CreateStampsAndValidates(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}

	// Missing id → 400
	body := strings.NewReader(`{"name":"Maderera Sur"}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/suppliers", body), "a1", string(domain.RoleAdmin))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleSuppliers(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("missing id: status %d want 400 (body=%s)", rr.Code, rr.Body.String())
	}

	// Missing name → 400
	body = strings.NewReader(`{"id":"s3"}`)
	req = withClaims(httptest.NewRequest(http.MethodPost, "/api/suppliers", body), "a1", string(domain.RoleAdmin))
	req.Header.Set("Content-Type", "application/json")
	rr = httptest.NewRecorder()
	srv.HandleSuppliers(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("missing name: status %d want 400 (body=%s)", rr.Code, rr.Body.String())
	}

	// Valid create → 201, active defaults true
	body = strings.NewReader(`{"id":"s3","name":"Maderera Sur","email":"ventas@sursa.com","active":false}`)
	req = withClaims(httptest.NewRequest(http.MethodPost, "/api/suppliers", body), "a1", string(domain.RoleAdmin))
	req.Header.Set("Content-Type", "application/json")
	rr = httptest.NewRecorder()
	srv.HandleSuppliers(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("valid: status %d want 201 (body=%s)", rr.Code, rr.Body.String())
	}
	if len(store.suppliersList) != 1 || store.suppliersList[0].Name != "Maderera Sur" {
		t.Fatalf("created supplier: %#v", store.suppliersList)
	}
}

func TestSuppliers_CreateDeniedToGerente(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"s4","name":"Ferretería Central"}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/suppliers", body), "g1", string(domain.RoleGerenteProduccion))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleSuppliers(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("status %d want 403 (body=%s)", rr.Code, rr.Body.String())
	}
	if len(store.suppliersList) != 0 {
		t.Fatal("gerente_produccion must not create suppliers")
	}
}

func TestSuppliers_UpdateAndDeactivate(t *testing.T) {
	store := &stubStore{
		suppliersList: []domain.Supplier{{ID: "s1", Name: "Maderera Norte", Active: true}},
	}
	srv := &Server{Store: store}

	// PUT updates the row.
	body := strings.NewReader(`{"name":"Maderera Norte SA","phone":"123"}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/suppliers/s1", body), "a1", string(domain.RoleAlmacen))
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", "s1")
	rr := httptest.NewRecorder()
	srv.HandleSupplierByID(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("PUT: status %d want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if store.suppliersList[0].Name != "Maderera Norte SA" {
		t.Fatalf("updated supplier: %#v", store.suppliersList[0])
	}

	// DELETE deactivates.
	req = withClaims(httptest.NewRequest(http.MethodDelete, "/api/suppliers/s1", nil), "a1", string(domain.RoleAlmacen))
	req.SetPathValue("id", "s1")
	rr = httptest.NewRecorder()
	srv.HandleSupplierByID(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("DELETE: status %d want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if store.suppliersList[0].Active {
		t.Fatal("supplier must be deactivated after DELETE")
	}
}

// ─── Purchase orders ───────────────────────────────────────────────────────

func TestPurchaseOrders_CreateBuildsBorradorWithNumber(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"po-abc123","supplier_id":"s1","items":[{"kind":"herrajes","material_id":"h1","quantity":50}]}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/purchase-orders", body), "a1", string(domain.RoleAdmin))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandlePurchaseOrders(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status %d want 201 (body=%s)", rr.Code, rr.Body.String())
	}
	if len(store.posList) != 1 {
		t.Fatalf("created POs: %d want 1", len(store.posList))
	}
	po := store.posList[0]
	if po.Status != domain.POBorrador {
		t.Errorf("status %q want borrador", po.Status)
	}
	if po.Number != "OC-0001" {
		t.Errorf("number %q want OC-0001", po.Number)
	}
	if len(po.Items) != 1 || po.Items[0].Quantity != 50 {
		t.Errorf("items: %#v", po.Items)
	}
	if po.CreatedBy == nil || *po.CreatedBy != "a1" {
		t.Errorf("created_by %v want a1", po.CreatedBy)
	}
}

func TestPurchaseOrders_CreateValidates(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	cases := []struct {
		name string
		body string
	}{
		{"missing id", `{"supplier_id":"s1","items":[{"kind":"herrajes","material_id":"h1","quantity":1}]}`},
		{"missing supplier", `{"id":"p1","items":[{"kind":"herrajes","material_id":"h1","quantity":1}]}`},
		{"no items", `{"id":"p1","supplier_id":"s1","items":[]}`},
		{"bad kind", `{"id":"p1","supplier_id":"s1","items":[{"kind":"piedra","material_id":"h1","quantity":1}]}`},
		{"zero qty", `{"id":"p1","supplier_id":"s1","items":[{"kind":"herrajes","material_id":"h1","quantity":0}]}`},
	}
	for _, tc := range cases {
		body := strings.NewReader(tc.body)
		req := withClaims(httptest.NewRequest(http.MethodPost, "/api/purchase-orders", body), "a1", string(domain.RoleAdmin))
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()
		srv.HandlePurchaseOrders(rr, req)
		if rr.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d want 400 (body=%s)", tc.name, rr.Code, rr.Body.String())
		}
	}
}

func TestPurchaseOrders_CreateDeniedToGerente(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"p1","supplier_id":"s1","items":[{"kind":"herrajes","material_id":"h1","quantity":1}]}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/purchase-orders", body), "g1", string(domain.RoleGerenteProduccion))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandlePurchaseOrders(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("status %d want 403 (body=%s)", rr.Code, rr.Body.String())
	}
	if len(store.posList) != 0 {
		t.Fatal("gerente_produccion must not create POs")
	}
}

func TestPurchaseOrders_ListAndGet(t *testing.T) {
	po := domain.PurchaseOrder{ID: "p1", Number: "OC-P1", SupplierID: "s1", Status: domain.POBorrador}
	store := &stubStore{posList: []domain.PurchaseOrder{po}, poReturnedByID: &po}
	srv := &Server{Store: store}

	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/purchase-orders", nil), "w1", string(domain.RoleAlmacen))
	rr := httptest.NewRecorder()
	srv.HandlePurchaseOrders(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("list: status %d want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	var got []domain.PurchaseOrder
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatalf("list: %d POs want 1", len(got))
	}

	req = withClaims(httptest.NewRequest(http.MethodGet, "/api/purchase-orders/p1", nil), "w1", string(domain.RoleAlmacen))
	req.SetPathValue("id", "p1")
	rr = httptest.NewRecorder()
	srv.HandlePurchaseOrderByID(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("get: status %d want 200 (body=%s)", rr.Code, rr.Body.String())
	}

	// Unknown id → 404.
	req = withClaims(httptest.NewRequest(http.MethodGet, "/api/purchase-orders/nope", nil), "w1", string(domain.RoleAlmacen))
	req.SetPathValue("id", "nope")
	rr = httptest.NewRecorder()
	srv.HandlePurchaseOrderByID(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("get unknown: status %d want 404 (body=%s)", rr.Code, rr.Body.String())
	}
}

func TestPurchaseOrders_EditOnlyBorrador(t *testing.T) {
	po := domain.PurchaseOrder{ID: "p1", Number: "OC-P1", SupplierID: "s1", Status: domain.POEmitida}
	store := &stubStore{poReturnedByID: &po}
	srv := &Server{Store: store}

	body := strings.NewReader(`{"supplier_id":"s2","items":[{"kind":"tableros","material_id":"m1","quantity":4}]}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/purchase-orders/p1", body), "a1", string(domain.RoleAdmin))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandlePurchaseOrderByID(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("edit emitida: status %d want 400 (body=%s)", rr.Code, rr.Body.String())
	}

	// Borrador → 200.
	po.Status = domain.POBorrador
	req = withClaims(httptest.NewRequest(http.MethodPut, "/api/purchase-orders/p1", body), "a1", string(domain.RoleAdmin))
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", "p1")
	rr = httptest.NewRecorder()
	srv.HandlePurchaseOrderByID(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("edit borrador: status %d want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if store.poReturnedByID.SupplierID != "s2" || len(store.poReturnedByID.Items) != 1 {
		t.Fatalf("updated PO: %#v", store.poReturnedByID)
	}
}

func TestPurchaseOrders_EmitAndCancel(t *testing.T) {
	po := domain.PurchaseOrder{ID: "p1", Number: "OC-P1", SupplierID: "s1", Status: domain.POBorrador}
	store := &stubStore{poReturnedByID: &po}
	srv := &Server{Store: store}

	// Emit borrador → 200 emitida.
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/purchase-orders/p1/emit", nil), "a1", string(domain.RoleAdmin))
	req.SetPathValue("id", "p1")
	rr := httptest.NewRecorder()
	srv.HandlePurchaseOrderEmit(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("emit: status %d want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if !store.emitPOCalled {
		t.Fatal("EmitPurchaseOrder must be called")
	}
	var emitted domain.PurchaseOrder
	if err := json.Unmarshal(rr.Body.Bytes(), &emitted); err != nil {
		t.Fatal(err)
	}
	if emitted.Status != domain.POEmitida {
		t.Errorf("emit result status %q want emitida", emitted.Status)
	}

	// Emit twice → 400.
	po.Status = domain.POEmitida
	req = withClaims(httptest.NewRequest(http.MethodPost, "/api/purchase-orders/p1/emit", nil), "a1", string(domain.RoleAdmin))
	req.SetPathValue("id", "p1")
	rr = httptest.NewRecorder()
	srv.HandlePurchaseOrderEmit(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("emit emitida: status %d want 400 (body=%s)", rr.Code, rr.Body.String())
	}

	// Cancel emitida → 200 cancelada.
	req = withClaims(httptest.NewRequest(http.MethodPost, "/api/purchase-orders/p1/cancel", nil), "a1", string(domain.RoleAdmin))
	req.SetPathValue("id", "p1")
	rr = httptest.NewRecorder()
	srv.HandlePurchaseOrderCancel(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("cancel: status %d want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if !store.cancelPOCalled {
		t.Fatal("CancelPurchaseOrder must be called")
	}

	// Cancel recibida → 400.
	po.Status = domain.PORecibida
	req = withClaims(httptest.NewRequest(http.MethodPost, "/api/purchase-orders/p1/cancel", nil), "a1", string(domain.RoleAdmin))
	req.SetPathValue("id", "p1")
	rr = httptest.NewRecorder()
	srv.HandlePurchaseOrderCancel(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("cancel recibida: status %d want 400 (body=%s)", rr.Code, rr.Body.String())
	}
}

func TestPurchaseOrders_ReceiveRecordsStockLines(t *testing.T) {
	po := domain.PurchaseOrder{
		ID: "p1", Number: "OC-P1", SupplierID: "s1", Status: domain.POEmitida,
		Items: []domain.PurchaseOrderItem{
			{Kind: domain.StockKindHerrajes, MaterialID: "h1", Quantity: 50},
		},
	}
	user := &domain.User{ID: "a1", Name: "Ana Almacén"}
	store := &stubStore{poReturnedByID: &po, getUserByEmail: user}
	srv := &Server{Store: store}

	body := strings.NewReader(`{"lines":[{"kind":"herrajes","material_id":"h1","quantity":30}]}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/purchase-orders/p1/receive", body), "a1", string(domain.RoleAdmin))
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", "p1")
	rr := httptest.NewRecorder()

	srv.HandlePurchaseOrderReceive(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status %d want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if !store.receivePOCalled {
		t.Fatal("ReceivePurchaseOrder must be called")
	}
	if len(store.lastReceiveLines) != 1 || store.lastReceiveLines[0].Quantity != 30 {
		t.Fatalf("received lines: %#v", store.lastReceiveLines)
	}
	// who/when stamped: byUserID from JWT, byName resolved from the user record.
	if store.lastReceiveByUserID != "a1" {
		t.Errorf("byUserID %q want a1", store.lastReceiveByUserID)
	}
	if store.lastReceiveByName != "Ana Almacén" {
		t.Errorf("byName %q want 'Ana Almacén'", store.lastReceiveByName)
	}
}

func TestPurchaseOrders_ReceiveValidates(t *testing.T) {
	po := domain.PurchaseOrder{ID: "p1", Number: "OC-P1", SupplierID: "s1", Status: domain.POBorrador}
	store := &stubStore{poReturnedByID: &po}
	srv := &Server{Store: store}

	// Non-emitida → 400.
	body := strings.NewReader(`{"lines":[{"kind":"herrajes","material_id":"h1","quantity":10}]}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/purchase-orders/p1/receive", body), "a1", string(domain.RoleAdmin))
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", "p1")
	rr := httptest.NewRecorder()
	srv.HandlePurchaseOrderReceive(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("borrador receive: status %d want 400 (body=%s)", rr.Code, rr.Body.String())
	}

	// Empty lines → 400.
	po.Status = domain.POEmitida
	body = strings.NewReader(`{"lines":[]}`)
	req = withClaims(httptest.NewRequest(http.MethodPost, "/api/purchase-orders/p1/receive", body), "a1", string(domain.RoleAdmin))
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("id", "p1")
	rr = httptest.NewRecorder()
	srv.HandlePurchaseOrderReceive(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("empty lines: status %d want 400 (body=%s)", rr.Code, rr.Body.String())
	}
}

func TestPurchaseOrders_GerenteReadOnlyOnLifecycle(t *testing.T) {
	po := domain.PurchaseOrder{ID: "p1", Number: "OC-P1", SupplierID: "s1", Status: domain.POBorrador}
	store := &stubStore{poReturnedByID: &po}
	srv := &Server{Store: store}

	for _, action := range []string{"/emit", "/cancel", "/receive"} {
		req := withClaims(httptest.NewRequest(http.MethodPost, "/api/purchase-orders/p1"+action, nil), "g1", string(domain.RoleGerenteProduccion))
		req.Header.Set("Content-Type", "application/json")
		req.SetPathValue("id", "p1")
		if action == "/receive" {
			req.Body = io.NopCloser(strings.NewReader(`{"lines":[{"kind":"herrajes","material_id":"h1","quantity":10}]}`))
		}
		rr := httptest.NewRecorder()
		var handler func(w http.ResponseWriter, r *http.Request)
		switch action {
		case "/emit":
			handler = srv.HandlePurchaseOrderEmit
		case "/cancel":
			handler = srv.HandlePurchaseOrderCancel
		case "/receive":
			handler = srv.HandlePurchaseOrderReceive
		}
		handler(rr, req)
		if rr.Code != http.StatusForbidden {
			t.Errorf("%s as gerente: status %d want 403 (body=%s)", action, rr.Code, rr.Body.String())
		}
	}
}
