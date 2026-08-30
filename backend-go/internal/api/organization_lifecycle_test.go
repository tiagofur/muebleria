package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
)

func TestOrganizationLifecycleRoutesReplaceLegacyCreateRoutes(t *testing.T) {
	server := NewServer(&stubStore{}, "test-secret", nil, 100, 100)
	handler := RegisterRoutes(server)

	tests := []struct {
		name   string
		method string
		path   string
		body   string
		want   int
	}{
		{name: "canonical provisioning is registered", method: http.MethodPost, path: "/api/organizations", body: `{}`, want: http.StatusUnauthorized},
		{name: "canonical suspend is registered", method: http.MethodPost, path: "/api/organizations/00000000-0000-0000-0000-000000000001:suspend", body: `{}`, want: http.StatusUnauthorized},
		{name: "legacy platform create is removed", method: http.MethodPost, path: "/api/platform/organizations", body: `{}`, want: http.StatusMethodNotAllowed},
		{name: "legacy factory create is removed", method: http.MethodPost, path: "/api/factory/organizations", body: `{}`, want: http.StatusMethodNotAllowed},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(test.method, test.path, strings.NewReader(test.body))
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, request)
			if recorder.Code != test.want {
				t.Fatalf("status = %d, want %d; body=%s", recorder.Code, test.want, recorder.Body.String())
			}
		})
	}
}

func TestProvisionOrganizationSameSlugRaceReturnsTypedConflict(t *testing.T) {
	recorder := httptest.NewRecorder()
	respondWithOrganizationCommandError(recorder, &pgconn.PgError{Code: "23505", ConstraintName: "organizations_slug_key"})
	if recorder.Code != http.StatusConflict {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var payload openapi.ApiError
	if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil || payload.Code != openapi.ApiErrorCodeOrganizationSlugConflict {
		t.Fatalf("payload=%+v err=%v", payload, err)
	}
}
