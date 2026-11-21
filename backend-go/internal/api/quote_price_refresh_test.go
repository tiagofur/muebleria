package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1662: preview is read-only (DryRun), the command creates (201), typed
// 409s for unchanged totals and opening configuration changes, permissions.
func TestHandleQuotePriceRefresh(t *testing.T) {
	const projectID = "16620000-0000-4000-8000-000000000001"
	const revisionID = "16620000-0000-4000-8000-000000000003"
	req := func(suffix, user string, roles []domain.UserRole) *http.Request {
		r := httptest.NewRequest(http.MethodPost, "/api/projects/"+projectID+"/quote-revisions/"+revisionID+suffix, nil)
		r.SetPathValue("projectId", projectID)
		r.SetPathValue("quoteRevisionId", revisionID)
		return withTestClaims(r, user, roles)
	}

	store := &stubStore{}
	server := &Server{Store: store}
	w := httptest.NewRecorder()
	server.HandleQuotePriceRefreshPreview(w, req(":price-refresh-preview", "user-1", []domain.UserRole{domain.RoleVendedor}))
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"newSaleTotal":1100`) || !strings.Contains(w.Body.String(), `"changed":true`) {
		t.Fatalf("preview: %d %s", w.Code, w.Body.String())
	}
	if len(store.priceRefreshCmds) != 1 || !store.priceRefreshCmds[0].DryRun || store.priceRefreshCmds[0].ActorUserID != "user-1" {
		t.Fatalf("preview must be a dry run with the server actor: %+v", store.priceRefreshCmds)
	}

	w = httptest.NewRecorder()
	server.HandleQuotePriceRefresh(w, req(":price-refresh", "user-1", []domain.UserRole{domain.RoleVendedor}))
	if w.Code != http.StatusCreated || !strings.Contains(w.Body.String(), `"sourceType":"price_refresh"`) {
		t.Fatalf("command: %d %s", w.Code, w.Body.String())
	}
	if store.priceRefreshCmds[1].DryRun {
		t.Fatalf("command must not be a dry run")
	}

	for _, tc := range []struct {
		err  error
		code string
	}{
		{domain.ErrPriceRefreshNoChange, `"PRICE_REFRESH_NO_CHANGE"`},
		{domain.ErrPriceRefreshConfigurationChanged, `"PRICE_REFRESH_CONFIGURATION_CHANGED"`},
		{domain.ErrQuoteRevisionConflict, `"CONFLICT"`},
	} {
		server = &Server{Store: &stubStore{priceRefreshErr: tc.err}}
		w = httptest.NewRecorder()
		server.HandleQuotePriceRefresh(w, req(":price-refresh", "user-1", []domain.UserRole{domain.RoleAdmin}))
		if w.Code != http.StatusConflict || !strings.Contains(w.Body.String(), tc.code) {
			t.Fatalf("%v: %d %s", tc.err, w.Code, w.Body.String())
		}
	}

	server = &Server{Store: &stubStore{priceRefreshErr: domain.ErrQuoteRevisionNotFound}}
	w = httptest.NewRecorder()
	server.HandleQuotePriceRefresh(w, req(":price-refresh", "user-1", []domain.UserRole{domain.RoleAdmin}))
	if w.Code != http.StatusNotFound {
		t.Fatalf("not found: %d", w.Code)
	}

	store = &stubStore{}
	server = &Server{Store: store}
	w = httptest.NewRecorder()
	server.HandleQuotePriceRefresh(w, req(":price-refresh", "user-1", []domain.UserRole{domain.RoleProduccion}))
	if w.Code != http.StatusForbidden || len(store.priceRefreshCmds) != 0 {
		t.Fatalf("produccion must be forbidden before the store: %d calls=%d", w.Code, len(store.priceRefreshCmds))
	}
}

// #1662: the commands are registered on the REAL router (a `{id}:command`
// pattern panics in net/http — they ride the quote-revision command router).
// Unauthenticated requests reach the auth middleware (401), never a 404.
func TestQuotePriceRefreshRoutesRegistered(t *testing.T) {
	router := RegisterRoutes(&Server{Store: &stubStore{}, Tokens: mustAuthority("price-refresh-router-secret-0123456789abcdef")})
	for _, command := range []string{"price-refresh-preview", "price-refresh"} {
		req := httptest.NewRequest(http.MethodPost, "/api/projects/16620000-0000-4000-8000-000000000001/quote-revisions/16620000-0000-4000-8000-000000000003:"+command, nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("%s: status %d, want 401 from the auth middleware", command, w.Code)
		}
	}
}
