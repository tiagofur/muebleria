package api

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1369 P1 — hydrateAgregadoRecipe ya no traga errores reales de DB: sólo el
// sentinel ErrAgregadoRevisionNotFound significa «sin receta, queda tal cual».
// Cualquier otro error de lectura debe ser 500: responder el agregado con la
// receta silenciosamente vacía hace que el próximo PUT (If-Match aún válido)
// la borre en silencio y que el simulate produzca un diff falso (todo «added»).

func agregadoListRequest(t *testing.T, server *Server) *httptest.ResponseRecorder {
	t.Helper()
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/catalog/agregados", nil), "user-1", string(domain.RoleAdmin))
	rec := httptest.NewRecorder()
	server.HandleAgregados(rec, req)
	return rec
}

func TestHydrateAgregadoRecipe_ReaderFailureIs500(t *testing.T) {
	dbBroken := errors.New("connection reset by peer")

	t.Run("GET list: un error de lectura falla TODA la respuesta (500), nunca una lista con recetas vacías", func(t *testing.T) {
		store := &stubStore{
			listAgregados:              []domain.Agregado{{ID: "agr-1", Code: "AGR-1", Name: "Uno", Version: 2}},
			agregadoCurrentRevisionErr: dbBroken,
		}
		rec := agregadoListRequest(t, &Server{Store: store})
		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
		}
	})

	t.Run("GET by-id: 500 — la UI no debe ver «0 miembros» por un store roto", func(t *testing.T) {
		store := &stubStore{
			agregadoReturnedByID:       recipeSimStubAgregado(),
			agregadoCurrentRevisionErr: dbBroken,
		}
		rec := agregadoByIDRequest(t, &Server{Store: store}, http.MethodGet, "", "")
		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
		}
	})

	t.Run("simulate: 500 sin diff — un current inventado produciría un diff falso", func(t *testing.T) {
		store := &stubStore{
			agregadoReturnedByID:       recipeSimStubAgregado(),
			agregadoCurrentRevisionErr: fmt.Errorf("unmarshal agregado recipe: invalid character 'x'"),
		}
		rr := recipeSimRequest(t, &Server{Store: store}, string(domain.RoleIngeniero), candidateJSON(t, func(*domain.Agregado) {}))
		if rr.Code != http.StatusInternalServerError {
			t.Fatalf("status = %d body=%s", rr.Code, rr.Body.String())
		}
		if strings.Contains(rr.Body.String(), `"diff"`) {
			t.Fatalf("un 500 no lleva diff: %s", rr.Body.String())
		}
	})
}

func TestHydrateAgregadoRecipe_RevisionNotFoundKeepsRowAsIs(t *testing.T) {
	// Envuelto a propósito: la distinción es errors.Is, no igualdad de error.
	sentinel := fmt.Errorf("read revision: %w", domain.ErrAgregadoRevisionNotFound)

	t.Run("GET by-id: 200 con la fila tal cual (receta inline y versión intactas)", func(t *testing.T) {
		row := recipeSimStubAgregado()
		row.Version = 7
		store := &stubStore{agregadoReturnedByID: row, agregadoCurrentRevisionErr: sentinel}
		rec := agregadoByIDRequest(t, &Server{Store: store}, http.MethodGet, "", "")
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
		}
		body := rec.Body.String()
		if !strings.Contains(body, `"runner-left"`) || !strings.Contains(body, `"version":7`) {
			t.Fatalf("la fila debe salir tal cual: %s", body)
		}
	})

	t.Run("GET list: 200 con la fila tal cual", func(t *testing.T) {
		store := &stubStore{
			listAgregados:              []domain.Agregado{*recipeSimStubAgregado()},
			agregadoCurrentRevisionErr: sentinel,
		}
		rec := agregadoListRequest(t, &Server{Store: store})
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), `"runner-left"`) {
			t.Fatalf("la fila debe salir tal cual: %s", rec.Body.String())
		}
	})

	t.Run("simulate: sigue funcionando sin revisión (diff sobre la fila)", func(t *testing.T) {
		store := &stubStore{agregadoReturnedByID: recipeSimStubAgregado(), agregadoCurrentRevisionErr: sentinel}
		rr := recipeSimRequest(t, &Server{Store: store}, string(domain.RoleIngeniero), candidateJSON(t, func(*domain.Agregado) {}))
		if rr.Code != http.StatusOK {
			t.Fatalf("status = %d body=%s", rr.Code, rr.Body.String())
		}
	})
}
