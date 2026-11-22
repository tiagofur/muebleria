package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1599: the project is marked only when the dev-mode header comes from a
// caller with developer-mode authority; otherwise byte-identical to today.
func TestBootstrapMarksProjectOnlyForAuthorizedDevMode(t *testing.T) {
	body := `{"projectName":"Cocina Ana","designName":"Diseño principal","newCustomer":{"name":"Ana López"}}`
	for _, tc := range []struct {
		name   string
		header string
		roles  []domain.UserRole
		marked bool
	}{
		{"admin in dev mode", "draft", []domain.UserRole{domain.RoleAdmin}, true},
		{"header is case-insensitive", "Draft", []domain.UserRole{domain.RoleAdmin}, true},
		{"no header: unchanged", "", []domain.UserRole{domain.RoleAdmin}, false},
		{"unknown mode value ignored", "published", []domain.UserRole{domain.RoleAdmin}, false},
		{"seller cannot mark even with the header", "draft", []domain.UserRole{domain.RoleVendedor}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store := &stubStore{modelBindingContext: bootstrapBindingContext()}
			req := httptest.NewRequest(http.MethodPost, "/api/projects:bootstrap-design", strings.NewReader(body))
			if tc.header != "" {
				req.Header.Set(LibraryModeHeader, tc.header)
			}
			req = withTestClaims(req, "10000000-0000-0000-0000-000000000099", tc.roles)
			w := httptest.NewRecorder()
			(&Server{Store: store}).HandleProjectDesignBootstrap(w, req)
			if w.Code != http.StatusCreated {
				t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
			}
			if got := len(store.devModeMarks) == 1; got != tc.marked {
				t.Fatalf("marked=%v want %v (%v)", got, tc.marked, store.devModeMarks)
			}
			if tc.marked && !strings.HasSuffix(store.devModeMarks[0], ":10000000-0000-0000-0000-000000000099") {
				t.Fatalf("mark must carry the server actor: %v", store.devModeMarks)
			}
		})
	}
}
