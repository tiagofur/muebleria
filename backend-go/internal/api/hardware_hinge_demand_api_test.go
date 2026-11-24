package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1579: the table a hinge declares is validated fail-closed on write, and a
// PUT that omits it keeps the stored one (a partial GET→PUT client must not
// move quotes back to the factory ladder by accident).

func TestHandleHardwaresPostRejectsInvalidHingeDemand(t *testing.T) {
	bodies := map[string]string{
		"six hinges is out of range": `{
			"code":"BIS-X","name":"Bisagra X","unit":"piece","cost_per_unit":0,"active":true,
			"hinge_demand":{"bands":[{"upToHeightMm":900,"hinges":6}]}
		}`,
		"descending heights": `{
			"code":"BIS-X","name":"Bisagra X","unit":"piece","cost_per_unit":0,"active":true,
			"hinge_demand":{"bands":[{"upToHeightMm":1600,"hinges":3},{"upToHeightMm":900,"hinges":2}]}
		}`,
		"no bands": `{
			"code":"BIS-X","name":"Bisagra X","unit":"piece","cost_per_unit":0,"active":true,
			"hinge_demand":{}
		}`,
		"a hinge table carries no group role": `{
			"code":"BIS-X","name":"Bisagra X","unit":"piece","cost_per_unit":0,"active":true,
			"hinge_demand":{"optionRole":"BISAGRA","bands":[{"upToHeightMm":900,"hinges":2}]}
		}`,
	}
	for name, body := range bodies {
		t.Run(name, func(t *testing.T) {
			srv := &Server{Store: &stubStore{}}
			req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/hardware", strings.NewReader(body)), "admin", string(domain.RoleAdmin))
			rr := httptest.NewRecorder()
			srv.HandleHardwares(rr, req)

			if rr.Code != http.StatusUnprocessableEntity {
				t.Fatalf("status = %d, want 422 (body=%s)", rr.Code, rr.Body.String())
			}
			if !strings.Contains(rr.Body.String(), "HINGE_DEMAND_INVALID") {
				t.Fatalf("body missing typed code: %s", rr.Body.String())
			}
		})
	}
}

func TestHandleHardwareByIdPutRejectsInvalidHingeDemand(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	body := strings.NewReader(`{
		"code":"BIS-X","name":"Bisagra X","unit":"piece","cost_per_unit":0,"active":true,
		"hinge_demand":{"bands":[{"upToHeightMm":900,"hinges":1}]}
	}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/catalog/hardware/h1", body), "admin", string(domain.RoleAdmin))
	req.Header.Set("If-Match", `"v1"`)
	req.SetPathValue("id", "h1")
	rr := httptest.NewRecorder()
	srv.HandleHardwareByID(rr, req)

	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422 (body=%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "HINGE_DEMAND_INVALID") {
		t.Fatalf("body missing typed code: %s", rr.Body.String())
	}
}

func storedHingeTable() *domain.HingeDemandPolicy {
	return &domain.HingeDemandPolicy{
		Bands: []domain.HingeDemandBand{{UpToHeightMm: 900, Hinges: 2}, {UpToHeightMm: 2400, Hinges: 5}},
	}
}

func putHingeBody(t *testing.T, store *stubStore, body string) *httptest.ResponseRecorder {
	t.Helper()
	srv := &Server{Store: store}
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/catalog/hardware/h1", strings.NewReader(body)), "admin", string(domain.RoleAdmin))
	req.Header.Set("If-Match", `"v1"`)
	req.SetPathValue("id", "h1")
	rr := httptest.NewRecorder()
	srv.HandleHardwareByID(rr, req)
	return rr
}

func TestHandleHardwareByIdPutKeepsStoredHingeDemandWhenOmitted(t *testing.T) {
	store := &stubStore{hardwareReturnedByID: &domain.Hardware{
		ID: "h1", Code: "BIS-X", Name: "Bisagra X", Unit: "piece", Active: true,
		HingeDemand: storedHingeTable(),
	}}
	rr := putHingeBody(t, store, `{"code":"BIS-X","name":"Bisagra X","unit":"piece","cost_per_unit":0,"active":true}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	saved := store.updateHardwareReceived
	if saved == nil || saved.HingeDemand == nil || len(saved.HingeDemand.Bands) != 2 {
		t.Fatalf("an omitted hinge_demand must keep the stored table, saved = %+v", saved)
	}
}

func TestHandleHardwareByIdPutClearsHingeDemandOnExplicitNull(t *testing.T) {
	store := &stubStore{hardwareReturnedByID: &domain.Hardware{
		ID: "h1", Code: "BIS-X", Name: "Bisagra X", Unit: "piece", Active: true,
		HingeDemand: storedHingeTable(),
	}}
	rr := putHingeBody(t, store, `{"code":"BIS-X","name":"Bisagra X","unit":"piece","cost_per_unit":0,"active":true,"hinge_demand":null}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if saved := store.updateHardwareReceived; saved == nil || saved.HingeDemand != nil {
		t.Fatalf("an explicit null must clear the table, saved = %+v", saved)
	}
}

func TestHandleHardwareByIdPutStoresHingeDemand(t *testing.T) {
	store := &stubStore{hardwareReturnedByID: &domain.Hardware{
		ID: "h1", Code: "BIS-X", Name: "Bisagra X", Unit: "piece", Active: true,
	}}
	rr := putHingeBody(t, store, `{
		"code":"BIS-X","name":"Bisagra X","unit":"piece","cost_per_unit":0,"active":true,
		"hinge_demand":{"bands":[{"upToHeightMm":900,"hinges":2},{"upToHeightMm":2400,"hinges":5}],"widthSurgeOverMm":null}
	}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	saved := store.updateHardwareReceived
	if saved == nil || saved.HingeDemand == nil || len(saved.HingeDemand.Bands) != 2 {
		t.Fatalf("the table must reach the store, saved = %+v", saved)
	}
	// The wire's explicit null means "no width surge" — never "inherit".
	if saved.HingeDemand.WidthSurgeOverMm == nil || *saved.HingeDemand.WidthSurgeOverMm != 0 {
		t.Fatalf("widthSurgeOverMm null must decode as disabled (0), got %v", saved.HingeDemand.WidthSurgeOverMm)
	}
}
