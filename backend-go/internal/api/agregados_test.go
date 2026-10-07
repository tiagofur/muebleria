package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

type deleteAgregadoStubStore struct {
	stubStore
	lastID      string
	lastVersion int64
	deleteErr   error
}

func (s *deleteAgregadoStubStore) DeleteAgregado(_ context.Context, id string, expectedVersion int64) error {
	s.lastID = id
	s.lastVersion = expectedVersion
	return s.deleteErr
}

func TestAgregadoDelete_HandlerSupportsOptionalIfMatch(t *testing.T) {
	t.Run("DELETE sin If-Match invoca DeleteAgregado con version 0 y responde 200", func(t *testing.T) {
		store := &deleteAgregadoStubStore{}
		server := &Server{Store: store}

		req := withClaims(httptest.NewRequest(http.MethodDelete, "/api/catalog/agregados/agr-1", nil), "user-1", string(domain.RoleAdmin))
		req.SetPathValue("id", "agr-1")
		rec := httptest.NewRecorder()

		server.HandleAgregadoByID(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
		}
		if store.lastID != "agr-1" || store.lastVersion != 0 {
			t.Fatalf("expected DeleteAgregado(agr-1, 0), got (%s, %d)", store.lastID, store.lastVersion)
		}
	})

	t.Run("DELETE con If-Match válido pasa la versión y responde 200", func(t *testing.T) {
		store := &deleteAgregadoStubStore{}
		server := &Server{Store: store}

		req := withClaims(httptest.NewRequest(http.MethodDelete, "/api/catalog/agregados/agr-1", nil), "user-1", string(domain.RoleAdmin))
		req.SetPathValue("id", "agr-1")
		req.Header.Set("If-Match", `"v3"`)
		rec := httptest.NewRecorder()

		server.HandleAgregadoByID(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
		}
		if store.lastID != "agr-1" || store.lastVersion != 3 {
			t.Fatalf("expected DeleteAgregado(agr-1, 3), got (%s, %d)", store.lastID, store.lastVersion)
		}
	})

	t.Run("DELETE con version conflict responde 412", func(t *testing.T) {
		store := &deleteAgregadoStubStore{deleteErr: storage.ErrVersionConflict}
		server := &Server{Store: store}

		req := withClaims(httptest.NewRequest(http.MethodDelete, "/api/catalog/agregados/agr-1", nil), "user-1", string(domain.RoleAdmin))
		req.SetPathValue("id", "agr-1")
		req.Header.Set("If-Match", `"v1"`)
		rec := httptest.NewRecorder()

		server.HandleAgregadoByID(rec, req)

		if rec.Code != http.StatusPreconditionFailed {
			t.Fatalf("status = %d, want 412; body=%s", rec.Code, rec.Body.String())
		}
	})
}
