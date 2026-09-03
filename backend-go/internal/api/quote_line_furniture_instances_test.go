package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #386 / DT-2 handler unit tests (withClaims + stubStore, no DB): role
// guards, generated-DTO shape, typed error mapping (accepted quote → 409
// CONFLICT) and the command router dispatch.

const (
	qlfiTestProjectID = "41000000-0000-0000-0000-000000000002"
	qlfiTestLineID    = "61000000-0000-0000-0000-0000000000f1"
)

func qlfiRequest(method, target, role string) *http.Request {
	req := withClaims(httptest.NewRequest(method, target, strings.NewReader("")), "admin-1", role)
	req.SetPathValue("projectId", qlfiTestProjectID)
	req.SetPathValue("quoteLineId", qlfiTestLineID)
	return req
}

func TestHandleQuoteLineFurnitureInstances_ListRoleGuard(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	req := qlfiRequest(http.MethodGet,
		"/api/projects/"+qlfiTestProjectID+"/quote-lines/"+qlfiTestLineID+"/furniture-instances",
		string(domain.RoleAlmacen))
	rr := httptest.NewRecorder()

	srv.HandleQuoteLineFurnitureInstances(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 (body=%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "obra") {
		t.Fatalf("permission message = %s, want it to reference the project quote", rr.Body.String())
	}
}

func TestHandleQuoteLineFurnitureInstances_ListMapsGeneratedDTO(t *testing.T) {
	store := &stubStore{listQuoteLineFurnitureLinks: []domain.QuoteLineFurnitureInstance{
		{
			ID: "qlfi-1", ProjectID: qlfiTestProjectID, QuoteLineID: qlfiTestLineID,
			FurnitureInstanceID: "fi-1",
			FurnitureInstance: domain.FurnitureInstance{
				ID: "fi-1", ProjectID: qlfiTestProjectID, Origin: domain.FurnitureInstanceOriginQuote,
				LifecycleStatus: domain.FurnitureInstanceLifecycleActive, Version: 1,
			},
		},
	}}
	srv := &Server{Store: store}
	req := qlfiRequest(http.MethodGet,
		"/api/projects/"+qlfiTestProjectID+"/quote-lines/"+qlfiTestLineID+"/furniture-instances",
		string(domain.RoleIngeniero))
	rr := httptest.NewRecorder()

	srv.HandleQuoteLineFurnitureInstances(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	body := rr.Body.String()
	for _, key := range []string{
		`"quote_line_id":"` + qlfiTestLineID + `"`,
		`"furniture_instance_id":"fi-1"`,
		`"furniture_instance":{"id":"fi-1"`,
		`"origin":"quote"`,
	} {
		if !strings.Contains(body, key) {
			t.Fatalf("list DTO %s missing %s", body, key)
		}
	}
}

func TestHandleQuoteLineMaterialize_RoleGuard(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	req := qlfiRequest(http.MethodPost,
		"/api/projects/"+qlfiTestProjectID+"/quote-lines/"+qlfiTestLineID+":materialize",
		string(domain.RoleProduccion))
	rr := httptest.NewRecorder()

	srv.HandleQuoteLineMaterialize(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 (body=%s)", rr.Code, rr.Body.String())
	}
	if store.materializeQuoteLineCmd != nil {
		t.Fatal("production role must not materialize quote furniture")
	}
}

func TestHandleQuoteLineMaterialize_TypedErrors(t *testing.T) {
	cases := []struct {
		name     string
		err      error
		want     int
		wantCode string
	}{
		{"line not found", storage.ErrQuoteLineNotFound, http.StatusNotFound, "NOT_FOUND"},
		{"accepted quote revision", domain.ErrQuoteRevisionAccepted, http.StatusConflict, "CONFLICT"},
		{"durable history", domain.ErrFurnitureInstanceDurableHistory, http.StatusConflict, "CONFLICT"},
		{"not owner org", domain.ErrFurnitureInstanceProjectNotWritable, http.StatusForbidden, "FORBIDDEN"},
		{"stale version race", storage.ErrVersionConflict, http.StatusConflict, "VERSION_CONFLICT"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := &Server{Store: &stubStore{materializeQuoteLineErr: tc.err}}
			req := qlfiRequest(http.MethodPost,
				"/api/projects/"+qlfiTestProjectID+"/quote-lines/"+qlfiTestLineID+":materialize",
				string(domain.RoleAdmin))
			rr := httptest.NewRecorder()
			srv.HandleQuoteLineMaterialize(rr, req)
			if rr.Code != tc.want {
				t.Fatalf("status = %d, want %d (body=%s)", rr.Code, tc.want, rr.Body.String())
			}
			if !strings.Contains(rr.Body.String(), tc.wantCode) {
				t.Fatalf("typed code %s missing from %s", tc.wantCode, rr.Body.String())
			}
		})
	}
}

func TestHandleQuoteLineMaterialize_MapsResult(t *testing.T) {
	store := &stubStore{materializeQuoteLineResult: &domain.QuoteLineMaterialization{
		ProjectID: qlfiTestProjectID, QuoteLineID: qlfiTestLineID, Quantity: 3,
		Instances: []domain.QuoteLineFurnitureInstance{
			{ID: "qlfi-1", ProjectID: qlfiTestProjectID, QuoteLineID: qlfiTestLineID, FurnitureInstanceID: "fi-1"},
		},
		CreatedInstanceIDs:   []string{"fi-1", "fi-2", "fi-3"},
		CancelledInstanceIDs: []string{"fi-9"},
	}}
	srv := &Server{Store: store}
	req := qlfiRequest(http.MethodPost,
		"/api/projects/"+qlfiTestProjectID+"/quote-lines/"+qlfiTestLineID+":materialize",
		string(domain.RoleAdmin))
	rr := httptest.NewRecorder()

	srv.HandleQuoteLineMaterialize(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	body := rr.Body.String()
	for _, key := range []string{
		`"quantity":3`,
		`"created_furniture_instance_ids":["fi-1","fi-2","fi-3"]`,
		`"cancelled_furniture_instance_ids":["fi-9"]`,
	} {
		if !strings.Contains(body, key) {
			t.Fatalf("materialize DTO %s missing %s", body, key)
		}
	}
	if store.materializeQuoteLineCmd == nil ||
		store.materializeQuoteLineCmd.ProjectID != qlfiTestProjectID ||
		store.materializeQuoteLineCmd.QuoteLineID != qlfiTestLineID {
		t.Fatalf("materialize command = %+v", store.materializeQuoteLineCmd)
	}
}

func TestQuoteLineCommandRouter_Dispatch(t *testing.T) {
	called := false
	router := quoteLineCommandRouter(map[string]http.Handler{
		"materialize": http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			called = true
			if r.PathValue("quoteLineId") != qlfiTestLineID {
				t.Fatalf("quoteLineId = %q, want %q", r.PathValue("quoteLineId"), qlfiTestLineID)
			}
		}),
	})

	dispatch := func(segment string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost,
			"/api/projects/x/quote-lines/"+segment, strings.NewReader(""))
		req.SetPathValue("quoteLineCommand", segment)
		rr := httptest.NewRecorder()
		router.ServeHTTP(rr, req)
		return rr
	}

	if rr := dispatch(qlfiTestLineID + ":materialize"); rr.Code != http.StatusOK || !called {
		t.Fatalf("dispatch status=%d called=%v", rr.Code, called)
	}
	for _, segment := range []string{qlfiTestLineID + ":unknown", qlfiTestLineID, ":materialize", qlfiTestLineID + ":a:b"} {
		if rr := dispatch(segment); rr.Code != http.StatusNotFound {
			t.Fatalf("segment %q status=%d, want 404", segment, rr.Code)
		}
	}
}
