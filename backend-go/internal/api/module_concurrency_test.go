package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #497 T2: module writes are guarded by optimistic concurrency (strong ETag
// "v<N>" / If-Match) and rejected parameter definitions answer with the same
// typed 422 envelope as the furniture read surface.

func newModuleMutationServer(store *stubStore) *Server {
	return &Server{Store: store}
}

func modulePutRequest(store *stubStore, body string, ifMatch string) *httptest.ResponseRecorder {
	if store.moduleReturnedByID == nil {
		// Existence is resolved before the precondition: a module the server
		// knows. Tests for the missing-row path set moduleReturnedByID nil.
		store.moduleReturnedByID = &domain.Module{ID: "mod1"}
	}
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/catalog/modules/mod1", strings.NewReader(body)), "eng", string(domain.RoleIngeniero))
	req.SetPathValue("id", "mod1")
	if ifMatch != "" {
		req.Header.Set("If-Match", ifMatch)
	}
	rr := httptest.NewRecorder()
	newModuleMutationServer(store).HandleModuleByID(rr, req)
	return rr
}

const modulePutBody = `{"code":"MC","name":"N","base_labor_cost":0,"width_mm":100,"height_mm":100,"depth_mm":100}`

func TestHandleModulePutRequiresIfMatch(t *testing.T) {
	rr := modulePutRequest(&stubStore{}, modulePutBody, "")
	if rr.Code != http.StatusPreconditionRequired {
		t.Fatalf("status = %d, want 428 (body=%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "PRECONDITION_REQUIRED") {
		t.Fatalf("body missing PRECONDITION_REQUIRED: %s", rr.Body.String())
	}
}

func TestHandleModulePutRejectsMalformedIfMatch(t *testing.T) {
	for _, bad := range []string{`"v0"`, `"vX"`, "v1", `"1"`} {
		rr := modulePutRequest(&stubStore{}, modulePutBody, bad)
		if rr.Code != http.StatusBadRequest {
			t.Fatalf("If-Match %q: status = %d, want 400 (body=%s)", bad, rr.Code, rr.Body.String())
		}
	}
}

func TestHandleModulePutForwardsExpectedVersionAndEchoesETag(t *testing.T) {
	store := &stubStore{}
	rr := modulePutRequest(store, modulePutBody, `"v7"`)
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if !store.updateModuleCalled || store.updateModuleExpectedVersion != 7 {
		t.Fatalf("expected version not forwarded: called=%v expected=%d", store.updateModuleCalled, store.updateModuleExpectedVersion)
	}
	if got := rr.Header().Get("ETag"); got != `"v8"` {
		t.Fatalf("ETag = %q, want %q", got, `"v8"`)
	}
	if !strings.Contains(rr.Body.String(), `"version":8`) {
		t.Fatalf("response body missing incremented version: %s", rr.Body.String())
	}
}

func TestHandleModulePutMapsVersionConflictToTyped412(t *testing.T) {
	store := &stubStore{updateModuleErr: storage.ErrVersionConflict}
	rr := modulePutRequest(store, modulePutBody, `"v1"`)
	if rr.Code != http.StatusPreconditionFailed {
		t.Fatalf("status = %d, want 412 (body=%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "VERSION_CONFLICT") {
		t.Fatalf("body missing VERSION_CONFLICT: %s", rr.Body.String())
	}
}

func TestHandleModulePutRejectsInvalidParameterDefinitionsWithTyped422(t *testing.T) {
	store := &stubStore{updateModuleErr: &domain.FurnitureParameterDefinitionsError{Issues: []domain.FurnitureParameterDefinitionIssue{
		{Field: "parameterDefinitions[0].name", Message: "reserved"},
	}}}
	rr := modulePutRequest(store, modulePutBody, `"v1"`)
	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422 (body=%s)", rr.Code, rr.Body.String())
	}
	body := rr.Body.String()
	if !strings.Contains(body, "PARAMETER_DEFINITION_INVALID") || !strings.Contains(body, `"issues"`) {
		t.Fatalf("body missing typed 422 envelope: %s", body)
	}
}

func TestHandleModuleCreateReturnsVersionAndETag(t *testing.T) {
	store := &stubStore{createModuleArmed: true}
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/modules", strings.NewReader(modulePutBody)), "eng", string(domain.RoleIngeniero))
	rr := httptest.NewRecorder()
	newModuleMutationServer(store).HandleModules(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%s)", rr.Code, rr.Body.String())
	}
	if got := rr.Header().Get("ETag"); got != `"v1"` {
		t.Fatalf("ETag = %q, want %q", got, `"v1"`)
	}
	if !strings.Contains(rr.Body.String(), `"version":1`) {
		t.Fatalf("response body missing version: %s", rr.Body.String())
	}
}

func TestHandleModuleCreateMapsInvalidParameterDefinitionsWithTyped422(t *testing.T) {
	store := &stubStore{createModuleArmed: true, createModuleErr: &domain.FurnitureParameterDefinitionsError{Issues: []domain.FurnitureParameterDefinitionIssue{
		{Field: "parameterDefinitions[0].type", Message: "unsupported"},
	}}}
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/modules", strings.NewReader(modulePutBody)), "eng", string(domain.RoleIngeniero))
	rr := httptest.NewRecorder()
	newModuleMutationServer(store).HandleModules(rr, req)
	if rr.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422 (body=%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "PARAMETER_DEFINITION_INVALID") {
		t.Fatalf("body missing PARAMETER_DEFINITION_INVALID: %s", rr.Body.String())
	}
}

// A stale editor must never blind-write: the handler refuses the write before
// it reaches the store, so the store cannot observe a version-less update.
func TestHandleModulePutWithoutIfMatchNeverCallsStore(t *testing.T) {
	store := &stubStore{}
	rr := modulePutRequest(store, modulePutBody, "")
	if rr.Code != http.StatusPreconditionRequired {
		t.Fatalf("status = %d, want 428", rr.Code)
	}
	if store.updateModuleCalled {
		t.Fatal("UpdateModule was called without an If-Match precondition")
	}
}

// PUT of a module the server does not know stays a 404 (no precondition
// demanded) so the client can fall back to POST create.
func TestHandleModulePutMissingStays404WithoutPrecondition(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/catalog/modules/missing", strings.NewReader(modulePutBody)), "eng", string(domain.RoleIngeniero))
	req.SetPathValue("id", "missing")
	rr := httptest.NewRecorder()
	srv.HandleModuleByID(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (body=%s)", rr.Code, rr.Body.String())
	}
}
