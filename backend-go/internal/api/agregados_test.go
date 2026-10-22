package api

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
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

type updateAgregadoStubStore struct {
	stubStore
	updateErr error
}

func (s *updateAgregadoStubStore) UpdateAgregadoWithRevision(_ context.Context, _ string, _ int64, _ *domain.Agregado, _ *string) error {
	return s.updateErr
}

func agregadoByIDRequest(t *testing.T, server *Server, method string, body string, ifMatch string) *httptest.ResponseRecorder {
	t.Helper()
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req := withClaims(httptest.NewRequest(method, "/api/catalog/agregados/agr-1", reader), "user-1", string(domain.RoleAdmin))
	req.SetPathValue("id", "agr-1")
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if ifMatch != "" {
		req.Header.Set("If-Match", ifMatch)
	}
	rec := httptest.NewRecorder()
	server.HandleAgregadoByID(rec, req)
	return rec
}

// #1369 P2: the handler maps store failures by typed error, never by message
// text — a failing store reads as 500, only the typed not-found reads as 404.
func TestAgregadoByID_StoreErrorsMapByType(t *testing.T) {
	putBody := `{"id":"agr-1","code":"AGR-1","name":"Uno"}`

	t.Run("GET typed not-found → 404; any other store error → 500", func(t *testing.T) {
		rec := agregadoByIDRequest(t, &Server{Store: &stubStore{agregadoGetByIDErr: storage.ErrAgregadoNotFound}}, http.MethodGet, "", "")
		if rec.Code != http.StatusNotFound {
			t.Fatalf("not found: status = %d body=%s", rec.Code, rec.Body.String())
		}
		rec = agregadoByIDRequest(t, &Server{Store: &stubStore{agregadoGetByIDErr: errors.New("connection reset by peer")}}, http.MethodGet, "", "")
		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("store failure: status = %d body=%s", rec.Code, rec.Body.String())
		}
	})

	t.Run("PUT typed not-found → 404; version conflict → 412; other → 500", func(t *testing.T) {
		rec := agregadoByIDRequest(t, &Server{Store: &updateAgregadoStubStore{stubStore: stubStore{getOrgByID: customLibraryOrg()}, updateErr: storage.ErrAgregadoNotFound}}, http.MethodPut, putBody, `"v1"`)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("not found: status = %d body=%s", rec.Code, rec.Body.String())
		}
		rec = agregadoByIDRequest(t, &Server{Store: &updateAgregadoStubStore{stubStore: stubStore{getOrgByID: customLibraryOrg()}, updateErr: storage.ErrVersionConflict}}, http.MethodPut, putBody, `"v1"`)
		if rec.Code != http.StatusPreconditionFailed {
			t.Fatalf("version conflict: status = %d body=%s", rec.Code, rec.Body.String())
		}
		rec = agregadoByIDRequest(t, &Server{Store: &updateAgregadoStubStore{stubStore: stubStore{getOrgByID: customLibraryOrg()}, updateErr: errors.New("revision insert: deadlock detected")}}, http.MethodPut, putBody, `"v1"`)
		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("store failure: status = %d body=%s", rec.Code, rec.Body.String())
		}
	})

	t.Run("DELETE typed not-found → 404; in use keeps the count → 409; other → 500", func(t *testing.T) {
		rec := agregadoByIDRequest(t, &Server{Store: &deleteAgregadoStubStore{stubStore: stubStore{getOrgByID: customLibraryOrg()}, deleteErr: storage.ErrAgregadoNotFound}}, http.MethodDelete, "", "")
		if rec.Code != http.StatusNotFound {
			t.Fatalf("not found: status = %d body=%s", rec.Code, rec.Body.String())
		}
		inUse := fmt.Errorf("%w: agregado in use by 2 módulo(s)", storage.ErrAgregadoInUse)
		rec = agregadoByIDRequest(t, &Server{Store: &deleteAgregadoStubStore{stubStore: stubStore{getOrgByID: customLibraryOrg()}, deleteErr: inUse}}, http.MethodDelete, "", "")
		if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "2 módulo(s)") {
			t.Fatalf("in use: status = %d body=%s", rec.Code, rec.Body.String())
		}
		rec = agregadoByIDRequest(t, &Server{Store: &deleteAgregadoStubStore{stubStore: stubStore{getOrgByID: customLibraryOrg()}, deleteErr: errors.New("connection reset by peer")}}, http.MethodDelete, "", "")
		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("store failure: status = %d body=%s", rec.Code, rec.Body.String())
		}
	})
}

// #1373/#443 — cruce borrar-vs-editar a nivel handler: tras el DELETE (hard)
// de la fila, un PUT que todavía lleva el If-Match viejo NO es un conflicto de
// versión: la store rechaza con el not-found tipado y el handler responde 404
// (nunca 409/412/500). La prueba equivalente a nivel storage (la fila no
// resucita y el error es not-found, no ErrVersionConflict) vive en
// TestCatalog_UpdateAfterHardDeleteDoesNotResurrect.
func TestAgregado_PutAfterDeleteIsNotFound(t *testing.T) {
	putBody := `{"id":"agr-1","code":"AGR-1","name":"Uno"}`

	// 1) El DELETE con el If-Match vigente elimina la fila.
	deleteStore := &deleteAgregadoStubStore{}
	deleteStore.getOrgByID = customLibraryOrg()
	del := agregadoByIDRequest(t, &Server{Store: deleteStore}, http.MethodDelete, "", `"v1"`)
	if del.Code != http.StatusOK {
		t.Fatalf("delete: status = %d body=%s", del.Code, del.Body.String())
	}

	// 2) El editor, que todavía tenía v1, guarda en ciego: la store responde
	// el not-found del storage (la fila ya no existe) → 404.
	putStore := &updateAgregadoStubStore{stubStore: stubStore{getOrgByID: customLibraryOrg()}, updateErr: storage.ErrAgregadoNotFound}
	put := agregadoByIDRequest(t, &Server{Store: putStore}, http.MethodPut, putBody, `"v1"`)
	if put.Code != http.StatusNotFound {
		t.Fatalf("put tras delete: status = %d body=%s", put.Code, put.Body.String())
	}
	if strings.Contains(put.Body.String(), string(openapi.ApiErrorCodeVersionConflict)) {
		t.Fatalf("un agregado borrado no es un conflicto de versión: %s", put.Body.String())
	}
}

func TestAgregadoDelete_HandlerSupportsOptionalIfMatch(t *testing.T) {
	t.Run("DELETE sin If-Match invoca DeleteAgregado con version 0 y responde 200", func(t *testing.T) {
		store := &deleteAgregadoStubStore{}
		store.getOrgByID = customLibraryOrg()
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
		store.getOrgByID = customLibraryOrg()
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
		store := &deleteAgregadoStubStore{stubStore: stubStore{getOrgByID: customLibraryOrg()}, deleteErr: storage.ErrVersionConflict}
		store.getOrgByID = customLibraryOrg()
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
