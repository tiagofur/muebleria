package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1398: a child row id collision (a template clone that drags preset /
// hardware line / board part ids of real rows) is an honest typed 409 naming
// the child rows — never the module-code message, and never a 500 from the
// middleware committing an aborted transaction.
func TestHandleModules_ChildRowIDDuplicateIsTypedConflict(t *testing.T) {
	cases := []struct {
		name        string
		constraint  string
		wantMessage string
	}{
		{"preset id collision", "module_presets_pkey", "Los ids de presets, herrajes o piezas"},
		{"hardware line id collision", "hardware_lines_pkey", "Los ids de presets, herrajes o piezas"},
		{"module code collision stays the code message", "modules_pkey", "El código ingresado ya está registrado"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := &stubStore{createModuleArmed: true, createModuleErr: &pgconn.PgError{Code: "23505", ConstraintName: tc.constraint}}
			req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/modules", strings.NewReader(`{}`)), "eng", string(domain.RoleIngeniero))
			rr := httptest.NewRecorder()
			newModuleMutationServer(store).HandleModules(rr, req)
			if rr.Code != http.StatusConflict {
				t.Fatalf("status = %d body = %s, want 409", rr.Code, rr.Body.String())
			}
			if !strings.Contains(rr.Body.String(), tc.wantMessage) {
				t.Fatalf("body %s must contain %q", rr.Body.String(), tc.wantMessage)
			}
		})
	}
}
