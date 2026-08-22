package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

/**
 * Structured site survey endpoints (OC-040/OC-041, issue #305): start,
 * spaces, field capture, verification, approval and the fabrication freeze,
 * with the RBAC matrix and the hard gate that keeps preliminary measures
 * away from production.
 */

func doSurvey(srv *Server, method, path, role, body string) *httptest.ResponseRecorder {
	return doSurveySpace(srv, method, path, role, body, "")
}

func doSurveySpace(srv *Server, method, path, role, body, spaceID string) *httptest.ResponseRecorder {
	req := withClaims(httptest.NewRequest(method, path, strings.NewReader(body)), "u1", role)
	req.SetPathValue("id", "p1")
	if spaceID != "" {
		req.SetPathValue("spaceId", spaceID)
	}
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	switch {
	case method == http.MethodGet && strings.HasSuffix(path, "/site-survey"):
		srv.HandleProjectSiteSurvey(rr, req)
	case method == http.MethodPost && strings.HasSuffix(path, "/site-survey"):
		srv.HandleProjectSiteSurvey(rr, req)
	case method == http.MethodPut && strings.HasSuffix(path, "/spaces"):
		srv.HandleSiteSurveySpaces(rr, req)
	case method == http.MethodDelete:
		srv.HandleSiteSurveySpaceDelete(rr, req)
	case strings.HasSuffix(path, "/capture"):
		srv.HandleSiteSurveyCapture(rr, req)
	case strings.HasSuffix(path, "/approve"):
		srv.HandleSiteSurveyApprove(rr, req)
	case strings.HasSuffix(path, "/verify"):
		srv.HandleSiteSurveyVerify(rr, req)
	case strings.HasSuffix(path, "/freeze"):
		srv.HandleSiteSurveyFreeze(rr, req)
	default:
		rr.WriteHeader(http.StatusNotFound)
	}
	return rr
}

func decodeSurveyView(t *testing.T, rr *httptest.ResponseRecorder) siteSurveyViewResponse {
	t.Helper()
	var view siteSurveyViewResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &view); err != nil {
		t.Fatalf("decode survey view: %v body %s", err, rr.Body.String())
	}
	return view
}

// firstSurveySpaceID returns the id of the (only) stored space.
func firstSurveySpaceID(t *testing.T, store *stubStore) string {
	t.Helper()
	if store.siteSurvey == nil || len(store.siteSurvey.Spaces) == 0 {
		t.Fatal("no survey space stored")
	}
	return store.siteSurvey.Spaces[0].ID
}

// surveyDrivenTo starts a survey and captures one space on site.
func surveyDrivenTo(t *testing.T, store *stubStore, srv *Server) string {
	t.Helper()
	rr := doSurvey(srv, http.MethodPost, "/api/projects/p1/site-survey", string(domain.RoleVendedor), `{}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("start survey = %d body %s", rr.Code, rr.Body.String())
	}
	rr = doSurvey(srv, http.MethodPut, "/api/projects/p1/site-survey/spaces", string(domain.RoleVendedor),
		`{"name":"Cocina","elements":[{"kind":"opening","label":"Ventana","width_mm":1200,"height_mm":900}]}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("upsert space = %d body %s", rr.Code, rr.Body.String())
	}
	spaceID := firstSurveySpaceID(t, store)
	rr = doSurveySpace(srv, http.MethodPost, "/api/projects/p1/site-survey/spaces/"+spaceID+"/capture", string(domain.RoleVendedor),
		`{"width_mm":3200,"height_mm":2600}`, spaceID)
	if rr.Code != http.StatusOK {
		t.Fatalf("capture = %d body %s", rr.Code, rr.Body.String())
	}
	return spaceID
}

func TestSiteSurvey_StartAndSpacesRBAC(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}

	rr := doSurvey(srv, http.MethodPost, "/api/projects/p1/site-survey", string(domain.RoleProduccion), `{}`)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("produccion must not start a survey, got %d", rr.Code)
	}

	rr = doSurvey(srv, http.MethodPost, "/api/projects/p1/site-survey", string(domain.RoleVendedor), `{}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("start = %d body %s", rr.Code, rr.Body.String())
	}
	view := decodeSurveyView(t, rr)
	if view.Survey == nil || view.Survey.Revision != 1 {
		t.Fatalf("started survey must be revision 1, got %+v", view.Survey)
	}
	if len(store.siteSurveyEvents) != 1 || store.siteSurveyEvents[0].Type != "survey_captured" {
		t.Fatalf("start must append survey_captured, got %+v", store.siteSurveyEvents)
	}

	rr = doSurvey(srv, http.MethodPost, "/api/projects/p1/site-survey", string(domain.RoleVendedor), `{}`)
	if rr.Code != http.StatusConflict {
		t.Fatalf("second start must conflict, got %d", rr.Code)
	}
}

func TestSiteSurvey_CaptureVerifyApproveFreezeFlow(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	spaceID := surveyDrivenTo(t, store, srv)

	// OC-041: approval is engineering's authority; a vendedor cannot approve.
	rr := doSurveySpace(srv, http.MethodPost, "/api/projects/p1/site-survey/spaces/"+spaceID+"/approve", string(domain.RoleVendedor), `{}`, spaceID)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("vendedor must not approve measures, got %d", rr.Code)
	}

	// Verification is technical (admin/gerente_ventas/ingeniero — no vendedor).
	rr = doSurvey(srv, http.MethodPost, "/api/projects/p1/site-survey/verify", string(domain.RoleGerenteVentas), `{}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("verify = %d body %s", rr.Code, rr.Body.String())
	}

	rr = doSurveySpace(srv, http.MethodPost, "/api/projects/p1/site-survey/spaces/"+spaceID+"/approve", string(domain.RoleIngeniero), `{}`, spaceID)
	if rr.Code != http.StatusOK {
		t.Fatalf("approve = %d body %s", rr.Code, rr.Body.String())
	}

	rr = doSurvey(srv, http.MethodPost, "/api/projects/p1/site-survey/freeze", string(domain.RoleIngeniero), `{}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("freeze = %d body %s", rr.Code, rr.Body.String())
	}
	view := decodeSurveyView(t, rr)
	if view.Survey.Spaces[0].Intent != domain.MeasureIntentFabrication {
		t.Fatalf("frozen space must be fabrication, got %s", view.Survey.Spaces[0].Intent)
	}
	if len(view.Blockers) != 0 {
		t.Fatalf("frozen survey must have no blockers, got %+v", view.Blockers)
	}
	types := map[string]int{}
	for _, ev := range store.siteSurveyEvents {
		types[ev.Type]++
	}
	if types["survey_captured"] != 2 || types["survey_verified"] != 1 || types["survey_measures_approved"] != 2 {
		t.Fatalf("unexpected event log: %+v", types)
	}
}

func TestSiteSurvey_PreliminaryNeverPassesTheGate(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}

	rr := doSurvey(srv, http.MethodPost, "/api/projects/p1/site-survey", string(domain.RoleVendedor), `{}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("start = %d", rr.Code)
	}
	rr = doSurvey(srv, http.MethodPut, "/api/projects/p1/site-survey/spaces", string(domain.RoleVendedor), `{"name":"Cocina"}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("space = %d body %s", rr.Code, rr.Body.String())
	}
	spaceID := firstSurveySpaceID(t, store)

	// Approving a space that was never captured on site must fail.
	rr = doSurveySpace(srv, http.MethodPost, "/api/projects/p1/site-survey/spaces/"+spaceID+"/approve", string(domain.RoleIngeniero), `{}`, spaceID)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("approving a preliminary space must fail, got %d body %s", rr.Code, rr.Body.String())
	}

	// Freezing with a preliminary space must fail and explain the blocker.
	rr = doSurvey(srv, http.MethodPost, "/api/projects/p1/site-survey/freeze", string(domain.RoleIngeniero), `{}`)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("freeze with preliminary space must fail, got %d", rr.Code)
	}
	if !strings.Contains(rr.Body.String(), "preliminares") {
		t.Fatalf("freeze error must name the preliminary blocker, got %s", rr.Body.String())
	}

	// The GET view must surface the blocker for the release gate consumers.
	rr = doSurvey(srv, http.MethodGet, "/api/projects/p1/site-survey", string(domain.RoleVendedor), ``)
	if rr.Code != http.StatusOK {
		t.Fatalf("view = %d", rr.Code)
	}
	view := decodeSurveyView(t, rr)
	if len(view.Blockers) == 0 {
		t.Fatal("view must surface OC-041 blockers for the preliminary space")
	}
}

func TestSiteSurvey_VerifyRequiresCapturedSpaces(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	doSurvey(srv, http.MethodPost, "/api/projects/p1/site-survey", string(domain.RoleVendedor), `{}`)
	doSurvey(srv, http.MethodPut, "/api/projects/p1/site-survey/spaces", string(domain.RoleVendedor), `{"name":"Cocina"}`)

	rr := doSurvey(srv, http.MethodPost, "/api/projects/p1/site-survey/verify", string(domain.RoleIngeniero), `{}`)
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("verify without captured spaces must fail, got %d", rr.Code)
	}
}
