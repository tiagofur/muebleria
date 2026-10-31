package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1422 slice 2 — workshop kit templates API: fail-closed validation (422
// KIT_TEMPLATE_INVALID with the twin's field), If-Match guarded writes and
// the soft-deactivate delete.

func kitTemplateRequestBody() string {
	return `{
		"id": "b1a2c3d4-0000-4000-8000-000000000001",
		"code": "PLANT-BIS-1",
		"labelEs": "Bisagra del taller (2 partes)",
		"agregadoLabelEs": "Puerta",
		"motion": "rotate_left",
		"slots": [
			{"slot": "cup_fixed", "memberId": "hinge_cup", "suffix": "-COPA", "labelEs": "Copa", "role": "hinge_cup", "membership": "body", "anchorXRef": "min", "offsetSign": 1, "defaultOffsetMm": 0},
			{"slot": "arm_moving", "memberId": "hinge_arm", "suffix": "-BRAZO", "labelEs": "Brazo", "role": "hinge_arm", "membership": "actor:door", "anchorXRef": "center", "offsetSign": -1, "defaultOffsetMm": 24}
		]
	}`
}

func kitTemplatesRequest(t *testing.T, server *Server, method, body, ifMatch string) *httptest.ResponseRecorder {
	t.Helper()
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req := withClaims(httptest.NewRequest(method, "/api/catalog/kit-templates", reader), "user-1", string(domain.RoleAdmin))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if ifMatch != "" {
		req.Header.Set("If-Match", ifMatch)
	}
	rec := httptest.NewRecorder()
	server.HandleKitTemplates(rec, req)
	return rec
}

func kitTemplateByIDRequest(t *testing.T, server *Server, method, body, ifMatch string) *httptest.ResponseRecorder {
	t.Helper()
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req := withClaims(httptest.NewRequest(method, "/api/catalog/kit-templates/t-1", reader), "user-1", string(domain.RoleAdmin))
	req.SetPathValue("id", "t-1")
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	if ifMatch != "" {
		req.Header.Set("If-Match", ifMatch)
	}
	rec := httptest.NewRecorder()
	server.HandleKitTemplateByID(rec, req)
	return rec
}

func TestKitTemplatesCreateValidatesFailClosed(t *testing.T) {
	server := &Server{Store: &stubStore{}}

	// Bad membership: 422 with the twin's field, never persisted.
	rec := kitTemplatesRequest(t, server, http.MethodPost, strings.Replace(
		kitTemplateRequestBody(), `"membership": "body"`, `"membership": "puerta"`, 1), "")
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("bad membership: expected 422, got %d", rec.Code)
	}
	var body struct {
		Code  string `json:"code"`
		Field string `json:"field"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode 422 body: %v", err)
	}
	if body.Code != "KIT_TEMPLATE_INVALID" || body.Field != "slots[0].membership" {
		t.Fatalf("bad 422 payload: %+v", body)
	}

	// Missing code: workshop rows always carry one.
	rec = kitTemplatesRequest(t, server, http.MethodPost, `{
		"id": "t-no-code", "labelEs": "X", "agregadoLabelEs": "Puerta", "motion": "none",
		"slots": [{"slot": "a", "memberId": "m_a", "suffix": "-A", "labelEs": "A", "role": "r_a", "membership": "body", "anchorXRef": "min", "offsetSign": 1, "defaultOffsetMm": 0}]
	}`, "")
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("missing code: expected 422, got %d", rec.Code)
	}
}

func TestKitTemplatesCreatePersistsValidTemplate(t *testing.T) {
	store := &stubStore{}
	server := &Server{Store: store}
	rec := kitTemplatesRequest(t, server, http.MethodPost, kitTemplateRequestBody(), "")
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(store.listKitTemplates) != 1 {
		t.Fatalf("expected 1 persisted template, got %d", len(store.listKitTemplates))
	}
	if store.listKitTemplates[0].Version != 1 || !store.listKitTemplates[0].Active {
		t.Fatalf("template not initialized: %+v", store.listKitTemplates[0])
	}
}

func TestKitTemplatePutRequiresIfMatchAndGuardsVersion(t *testing.T) {
	server := &Server{Store: &stubStore{}}

	// Missing If-Match: rejected before the body matters.
	rec := kitTemplateByIDRequest(t, server, http.MethodPut, kitTemplateRequestBody(), "")
	if rec.Code == http.StatusOK {
		t.Fatalf("PUT without If-Match must not succeed, got %d", rec.Code)
	}
}

func TestKitTemplatePutVersionConflictReads412(t *testing.T) {
	store := &stubStore{listKitTemplates: []domain.KitTemplate{{
		ID: "t-1", LabelEs: "Vieja", Motion: "none", Active: true, Version: 7,
		Slots: []domain.KitTemplateSlot{{
			Slot: "a", MemberID: "m_a", Suffix: "-A", LabelEs: "A", Role: "r_a",
			Membership: "body", AnchorXRef: "min", OffsetSign: 1,
		}},
	}}}
	server := &Server{Store: store}
	rec := kitTemplateByIDRequest(t, server, http.MethodPut, kitTemplateRequestBody(), `"v3"`)
	if rec.Code != http.StatusPreconditionFailed {
		t.Fatalf("expected 412 on stale If-Match, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestKitTemplatePutSuccessBumpsVersion(t *testing.T) {
	store := &stubStore{listKitTemplates: []domain.KitTemplate{{
		ID: "t-1", LabelEs: "Vieja", Motion: "none", Active: true, Version: 7,
		AgregadoLabelEs: "Puerta",
		Slots: []domain.KitTemplateSlot{{
			Slot: "a", MemberID: "m_a", Suffix: "-A", LabelEs: "A", Role: "r_a",
			Membership: "body", AnchorXRef: "min", OffsetSign: 1,
		}},
	}}}
	server := &Server{Store: store}
	rec := kitTemplateByIDRequest(t, server, http.MethodPut, kitTemplateRequestBody(), `"v7"`)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var updated domain.KitTemplate
	if err := json.Unmarshal(rec.Body.Bytes(), &updated); err != nil {
		t.Fatalf("decode updated: %v", err)
	}
	if updated.Version != 8 {
		t.Fatalf("expected version 8, got %d", updated.Version)
	}
	if etag := rec.Header().Get("ETag"); etag != `"v8"` {
		t.Fatalf("expected ETag v8, got %q", etag)
	}
}

func TestKitTemplateDeleteDeactivates(t *testing.T) {
	store := &deleteKitTemplateStubStore{stubStore: stubStore{}}
	server := &Server{Store: store}
	rec := kitTemplateByIDRequest(t, server, http.MethodDelete, "", `"v2"`)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if store.lastID != "t-1" || store.lastVersion != 2 {
		t.Fatalf("deactivate called with id=%s version=%d", store.lastID, store.lastVersion)
	}
}

func TestKitTemplateGetNotFoundReads404(t *testing.T) {
	server := &Server{Store: &stubStore{}}
	rec := kitTemplateByIDRequest(t, server, http.MethodGet, "", "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

func TestKitTemplatesListEmptyReadsArray(t *testing.T) {
	server := &Server{Store: &stubStore{}}
	rec := kitTemplatesRequest(t, server, http.MethodGet, "", "")
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != "[]" {
		t.Fatalf("expected 200 [], got %d %s", rec.Code, rec.Body.String())
	}
}

type deleteKitTemplateStubStore struct {
	stubStore
	lastID      string
	lastVersion int64
}

func (s *deleteKitTemplateStubStore) DeactivateKitTemplate(_ context.Context, id string, expectedVersion int64) error {
	s.lastID = id
	s.lastVersion = expectedVersion
	return nil
}
