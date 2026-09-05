package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #500 / WEB-DT-1 handler unit tests (withClaims + stubStore, no DB): role
// guard, generated-DTO round-trip with per-unit items, uniform 404 and the
// empty-revision case (project visible, no snapshots yet).

const qrTestProjectID = "41000000-0000-0000-0000-000000000002"

func qrRequest(role string) *http.Request {
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/projects/"+qrTestProjectID+"/quote-revisions", nil), "admin-1", role)
	req.SetPathValue("projectId", qrTestProjectID)
	return req
}

func TestHandleProjectQuoteRevisions_ListMapsDetailWithItems(t *testing.T) {
	store := &stubStore{}
	version := 2
	store.quoteRevisionsList = []domain.QuoteRevisionDetail{
		{
			QuoteRevision: domain.QuoteRevision{
				ID:                     "3f7b6c5d-0000-4000-8000-000000000010",
				OrganizationID:         "00000000-0000-4000-8000-000000000001",
				ProjectID:              qrTestProjectID,
				RevisionNumber:         2,
				Status:                 "draft",
				SourceType:             "requote",
				Notes:                  "Borrador desde diseño",
				CreatedBy:              "90000000-0000-0000-0000-000000000001",
				BaseQuoteRevisionID:    "3f7b6c5d-0000-4000-8000-00000000000f",
				SourceDesignRevisionID: "7f7b6c5d-0000-4000-8000-000000000003",
			},
			CreatedAt: time.Date(2026, 9, 2, 15, 30, 0, 0, time.UTC),
			Items: []domain.QuoteRevisionItem{
				{
					FurnitureInstanceID:   "f1000000-0000-4000-8000-000000000001",
					FurnitureDefinitionID: "d1000000-0000-4000-8000-000000000001",
					DefinitionVersion:     &version,
					Parameters:            map[string]any{"widthMm": 650},
					MaterialChoices:       map[string]string{"carcass": "mat-roble"},
					LifecycleStatus:       "active",
				},
				{
					// Units without definition keep identity provenance and a
					// null definition reference — never a guessed label.
					FurnitureInstanceID: "f1000000-0000-4000-8000-000000000002",
					Parameters:          map[string]any{},
					MaterialChoices:     map[string]string{},
					LifecycleStatus:     "cancelled",
				},
			},
		},
	}
	srv := &Server{Store: store}
	rr := httptest.NewRecorder()

	srv.HandleProjectQuoteRevisions(rr, qrRequest(string(domain.RoleVendedor)))

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if store.quoteRevisionsCalls != 1 {
		t.Fatalf("store calls = %d, want 1", store.quoteRevisionsCalls)
	}

	var list []map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &list); err != nil {
		t.Fatalf("invalid JSON envelope: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("revisions = %d, want 1", len(list))
	}
	rev := list[0]
	for key, want := range map[string]any{
		"id":                     "3f7b6c5d-0000-4000-8000-000000000010",
		"projectId":              qrTestProjectID,
		"revisionNumber":         float64(2),
		"status":                 "draft",
		"sourceType":             "requote",
		"baseQuoteRevisionId":    "3f7b6c5d-0000-4000-8000-00000000000f",
		"sourceDesignRevisionId": "7f7b6c5d-0000-4000-8000-000000000003",
	} {
		got, ok := rev[key]
		if !ok || got != want {
			t.Fatalf("revision[%s] = %v (%T), want %v", key, got, got, want)
		}
	}
	if _, ok := rev["createdAt"]; !ok {
		t.Fatalf("revision must expose createdAt for the exact-context selector: %v", rev)
	}
	items, ok := rev["items"].([]any)
	if !ok || len(items) != 2 {
		t.Fatalf("items = %v, want 2 per-unit snapshots", rev["items"])
	}
	first := items[0].(map[string]any)
	if first["furnitureInstanceId"] != "f1000000-0000-4000-8000-000000000001" || first["lifecycleStatus"] != "active" {
		t.Fatalf("item join key / lifecycle lost: %v", first)
	}
	second := items[1].(map[string]any)
	// Absent-when-null is the canonical optional-field convention; a
	// definitionless unit must never carry a guessed definition reference.
	if def, present := second["furnitureDefinitionId"]; present && def != nil {
		t.Fatalf("definitionless unit must serialize without a definition reference, got %v", def)
	}
	// Commercial snapshot only: no pricing/cost internals may ride along.
	if strings.Contains(rr.Body.String(), "price") || strings.Contains(rr.Body.String(), "cost") {
		t.Fatalf("cost/pricing leaked into the commercial context DTO: %s", rr.Body.String())
	}
}

func TestHandleProjectQuoteRevisions_EmptyProjectReturnsEmptyList(t *testing.T) {
	store := &stubStore{}
	store.quoteRevisionsList = []domain.QuoteRevisionDetail{}
	srv := &Server{Store: store}
	rr := httptest.NewRecorder()

	srv.HandleProjectQuoteRevisions(rr, qrRequest(string(domain.RoleProduccion)))

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	if strings.TrimSpace(rr.Body.String()) != "[]" {
		t.Fatalf("body = %s, want [] (visible project without revisions yet)", rr.Body.String())
	}
}

func TestHandleProjectQuoteRevisions_DeniesRoleWithoutProjectAccess(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	rr := httptest.NewRecorder()

	srv.HandleProjectQuoteRevisions(rr, qrRequest(string(domain.RoleAlmacen)))

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rr.Code)
	}
	if store.quoteRevisionsCalls != 0 {
		t.Fatalf("store calls = %d, want 0 (denied before any read)", store.quoteRevisionsCalls)
	}
}

func TestHandleProjectQuoteRevisions_MissingProjectIsUniform404(t *testing.T) {
	store := &stubStore{}
	store.quoteRevisionsErr = domain.ErrQuoteRevisionNotFound
	srv := &Server{Store: store}
	rr := httptest.NewRecorder()

	srv.HandleProjectQuoteRevisions(rr, qrRequest(string(domain.RoleAdmin)))

	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want uniform 404", rr.Code)
	}
	if !strings.Contains(rr.Body.String(), "NOT_FOUND") {
		t.Fatalf("typed error envelope missing: %s", rr.Body.String())
	}
}

func TestHandleProjectQuoteRevisions_RejectsInvalidProjectID(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/projects/not-a-uuid/quote-revisions", nil), "admin-1", string(domain.RoleAdmin))
	req.SetPathValue("projectId", "not-a-uuid")
	rr := httptest.NewRecorder()

	srv.HandleProjectQuoteRevisions(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rr.Code)
	}
	if store.quoteRevisionsCalls != 0 {
		t.Fatalf("store calls = %d, want 0", store.quoteRevisionsCalls)
	}
}
