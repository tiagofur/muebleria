package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

const (
	priceItemA = "a1000000-0000-4000-8000-000000001651"
	priceItemB = "b1000000-0000-4000-8000-000000001651"
)

func priceRequest(t *testing.T, srv *Server, handler func(http.ResponseWriter, *http.Request), role, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/price-updates", strings.NewReader(body)), "eng-1651", role)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	handler(rr, req)
	return rr
}

func pricedFixture() []domain.PricedItem {
	return []domain.PricedItem{
		{ID: priceItemA, Code: "MEL-18", Name: "Melamina 18", Price: 1000, Version: 3},
		{ID: priceItemB, Code: "MDF-15", Name: "MDF 15", Price: 0.04, Version: 1},
	}
}

func TestPreviewCatalogPriceUpdate_PercentUsesFilterAndRounds(t *testing.T) {
	store := &stubStore{pricedItems: pricedFixture()}
	srv := &Server{Store: store}
	rr := priceRequest(t, srv, srv.HandlePreviewCatalogPriceUpdate, string(domain.RoleIngeniero),
		`{"kind":"material","mode":"percent","percent":10,"filter":{"categoryId":" cat-1 ","group":"Egger"}}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rr.Code, rr.Body.String())
	}
	if f := store.pricedItemsFilter; f == nil || f.CategoryID != "cat-1" || f.Group != "Egger" || f.IncludeInactive {
		t.Fatalf("filter: %+v", f)
	}
	var p openapi.PriceUpdatePreview
	if err := json.Unmarshal(rr.Body.Bytes(), &p); err != nil {
		t.Fatal(err)
	}
	if len(p.Changed) != 1 || p.Changed[0].NewPrice != 1100 || p.Changed[0].Version != 3 || len(p.Unchanged) != 1 {
		t.Fatalf("preview: %+v", p)
	}
	if len(store.priceUpdates) != 0 {
		t.Fatal("preview must not apply anything")
	}
}

func TestPreviewCatalogPriceUpdate_ImportGroups(t *testing.T) {
	store := &stubStore{pricedItems: pricedFixture()}
	srv := &Server{Store: store}
	rr := priceRequest(t, srv, srv.HandlePreviewCatalogPriceUpdate, string(domain.RoleAdmin),
		`{"kind":"material","mode":"import","rows":[{"line":2,"code":"MEL-18","price":1100},{"line":3,"code":"NUEVO","price":5},{"line":4,"code":"MDF-15"}]}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rr.Code, rr.Body.String())
	}
	var p openapi.PriceUpdatePreview
	_ = json.Unmarshal(rr.Body.Bytes(), &p)
	if len(p.Changed) != 1 || len(p.NotFound) != 1 || len(p.Invalid) != 1 || *p.NotFound[0].Code != "NUEVO" {
		t.Fatalf("groups: %+v", p)
	}
	if f := store.pricedItemsFilter; f == nil || !f.IncludeInactive {
		t.Fatal("import must match inactive items too (exact code)")
	}
}

func TestPreviewCatalogPriceUpdate_RejectsBadInputAndRoles(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	for _, tc := range []struct {
		role, body string
		want       int
	}{
		{string(domain.RoleAdmin), `{"kind":"material","mode":"percent","percent":0}`, http.StatusBadRequest},
		{string(domain.RoleAdmin), `{"kind":"material","mode":"percent","percent":900}`, http.StatusBadRequest},
		{string(domain.RoleAdmin), `{"kind":"wood","mode":"percent","percent":5}`, http.StatusBadRequest},
		{string(domain.RoleAdmin), `{"kind":"edge","mode":"import","rows":[]}`, http.StatusBadRequest},
		{string(domain.RoleVendedor), `{"kind":"edge","mode":"percent","percent":5}`, http.StatusForbidden},
	} {
		if rr := priceRequest(t, srv, srv.HandlePreviewCatalogPriceUpdate, tc.role, tc.body); rr.Code != tc.want {
			t.Fatalf("%s %s: %d want %d (%s)", tc.role, tc.body, rr.Code, tc.want, rr.Body.String())
		}
	}
}

func TestApplyCatalogPriceUpdate_ServerActorRoundingAndStale(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	rr := priceRequest(t, srv, srv.HandleApplyCatalogPriceUpdate, string(domain.RoleIngeniero),
		`{"kind":"hardware","source":"percent","percent":10,"note":" lista octubre ","items":[{"id":"`+priceItemA+`","expectedVersion":3,"newPrice":1100.004}]}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rr.Code, rr.Body.String())
	}
	cmd := store.priceUpdates[0]
	if cmd.ActorUserID != "eng-1651" || cmd.Kind != domain.PriceResourceHardware || cmd.Note != "lista octubre" || cmd.Items[0].NewPrice != 1100 || cmd.Items[0].ExpectedVersion != 3 {
		t.Fatalf("command: %+v", cmd)
	}

	for _, body := range []string{
		`{"kind":"hardware","source":"percent","items":[]}`,
		`{"kind":"hardware","source":"guess","items":[{"id":"` + priceItemA + `","expectedVersion":1,"newPrice":1}]}`,
		`{"kind":"hardware","source":"import","items":[{"id":"` + priceItemA + `","expectedVersion":1,"newPrice":1},{"id":"` + priceItemA + `","expectedVersion":1,"newPrice":2}]}`,
		`{"kind":"hardware","source":"import","items":[{"id":"` + priceItemA + `","expectedVersion":1,"newPrice":-1}]}`,
	} {
		if rr := priceRequest(t, srv, srv.HandleApplyCatalogPriceUpdate, string(domain.RoleAdmin), body); rr.Code != http.StatusBadRequest {
			t.Fatalf("%s: %d", body, rr.Code)
		}
	}

	stale := &stubStore{priceErr: &storage.ErrPriceUpdateStale{IDs: []string{priceItemB}}}
	srv = &Server{Store: stale}
	rr = priceRequest(t, srv, srv.HandleApplyCatalogPriceUpdate, string(domain.RoleAdmin),
		`{"kind":"edge","source":"import","items":[{"id":"`+priceItemB+`","expectedVersion":1,"newPrice":5}]}`)
	if rr.Code != http.StatusPreconditionFailed || !strings.Contains(rr.Body.String(), priceItemB) {
		t.Fatalf("stale: %d %s", rr.Code, rr.Body.String())
	}
}

func TestCatalogPriceHistory(t *testing.T) {
	store := &stubStore{priceHistory: []storage.PriceHistoryEntry{{BatchID: "b", Code: "MEL-18", OldPrice: 1000, NewPrice: 1100, Source: "percent", ChangedBy: "eng", ChangedAt: time.Date(2026, 11, 20, 10, 0, 0, 0, time.UTC)}}}
	srv := &Server{Store: store}
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/catalog/price-history/material/"+priceItemA, nil), "eng", string(domain.RoleIngeniero))
	req.SetPathValue("kind", "material")
	req.SetPathValue("resourceId", priceItemA)
	rr := httptest.NewRecorder()
	srv.HandleCatalogPriceHistory(rr, req)
	var out openapi.PriceHistoryResponse
	if rr.Code != http.StatusOK || json.Unmarshal(rr.Body.Bytes(), &out) != nil || len(out.Entries) != 1 || out.Entries[0].NewPrice != 1100 {
		t.Fatalf("history: %d %s", rr.Code, rr.Body.String())
	}
	req.SetPathValue("kind", "wood")
	rr = httptest.NewRecorder()
	srv.HandleCatalogPriceHistory(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("bad kind: %d", rr.Code)
	}
}
