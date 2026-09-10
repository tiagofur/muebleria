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

// #642 / QUOTE-AUTH Slice 1: commercial snapshot DTO surface — frozen truth
// exposed on the exact revision, cost redaction for cost-blind actors, honest
// absence for legacy revisions, and the actionable fail-closed publish error.

func commercialSnapshotTestDetail() domain.QuoteRevisionDetail {
	published := time.Date(2026, 9, 10, 10, 0, 0, 0, time.UTC)
	accepted := time.Date(2026, 9, 10, 11, 0, 0, 0, time.UTC)
	return domain.QuoteRevisionDetail{
		QuoteRevision: domain.QuoteRevision{
			ID:             quoteLifecycleTestRevID,
			OrganizationID: "00000000-0000-4000-8000-000000000001",
			ProjectID:      quoteLifecycleTestProjectID,
			RevisionNumber: 2,
			Status:         "accepted",
			SourceType:     "requote",
			PublishedAt:    &published,
			AcceptedAt:     &accepted,
			CommercialSnapshot: &domain.QuoteCommercialSnapshot{
				Schema:     domain.QuoteCommercialSnapshotSchema,
				CapturedAt: time.Date(2026, 9, 10, 9, 0, 0, 0, time.UTC),
				Currency:   "MXN",
				Customer:   domain.QuoteCommercialIdentity{ID: "c1000000-0000-4000-8000-000000000001", Name: "Cliente CS"},
				Project:    domain.QuoteCommercialIdentity{ID: quoteLifecycleTestProjectID, Name: "Obra CS"},
				Breakdown: domain.QuoteBreakdown{
					MaterialsCost: 192, EdgeTotal: 3, HardwareTotal: 4, DirectCost: 199,
					LaborModular: 100, LaborFixedCost: 100, MarginFactor: 1.5, SalePrice: 498.5,
				},
				Lines: []domain.QuoteCommercialLine{{
					QuoteLineID: "e1000000-0000-4000-8000-000000000001", Quantity: 1,
					FurnitureInstanceIDs: []string{"f1000000-0000-4000-8000-000000000001"},
					Amounts:              domain.QuoteCommercialLineAmounts{MaterialsCost: 192, EdgeTotal: 3, HardwareTotal: 4, DirectCost: 199, LaborModular: 100, SalePrice: 398.5},
				}},
				Units: []domain.QuoteCommercialUnit{{
					FurnitureInstanceID: "f1000000-0000-4000-8000-000000000001",
					QuoteLineID:         "e1000000-0000-4000-8000-000000000001",
					ModuleCode:          "CS-MOD",
					ModuleName:          "Gabinete CS",
					LifecycleStatus:     "active",
					Options: []domain.QuoteCommercialOption{{
						GroupCode: "INTERIOR", GroupLabel: "Acabado interior",
						ChoiceID: "92000000-0000-4000-8000-000000000001", ChoiceLabel: "Tablero Roble",
					}},
				}},
			},
		},
		CreatedAt: time.Date(2026, 9, 10, 9, 0, 0, 0, time.UTC),
		Items:     []domain.QuoteRevisionItem{},
	}
}

func TestHandleProjectQuoteRevisions_CommercialSnapshotDTO(t *testing.T) {
	server := &Server{Store: &stubStore{quoteRevisionsList: []domain.QuoteRevisionDetail{commercialSnapshotTestDetail()}}}

	req := httptest.NewRequest(http.MethodGet, "/api/projects/"+quoteLifecycleTestProjectID+"/quote-revisions", nil)
	req.SetPathValue("projectId", quoteLifecycleTestProjectID)
	req = withTestClaims(req, "user-1", []domain.UserRole{domain.RoleAdmin})
	w := httptest.NewRecorder()
	server.HandleProjectQuoteRevisions(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var payload []map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode payload: %v", err)
	}
	if len(payload) != 1 {
		t.Fatalf("expected 1 revision, got %d", len(payload))
	}
	revision := payload[0]
	if revision["publishedAt"] == nil || revision["acceptedAt"] == nil {
		t.Fatalf("lifecycle timestamps must be exposed: %v", revision)
	}
	snapshot, ok := revision["commercialSnapshot"].(map[string]any)
	if !ok {
		t.Fatalf("commercialSnapshot must be an object for cost-visible actors: %v", revision["commercialSnapshot"])
	}
	if snapshot["schema"] != domain.QuoteCommercialSnapshotSchema || snapshot["currency"] != "MXN" {
		t.Fatalf("snapshot envelope = %v", snapshot)
	}
	breakdown, _ := snapshot["breakdown"].(map[string]any)
	if breakdown["materialsCost"].(float64) != 192 || breakdown["salePrice"].(float64) != 498.5 {
		t.Fatalf("cost-visible breakdown = %v", breakdown)
	}
	units, _ := snapshot["units"].([]any)
	if len(units) != 1 {
		t.Fatalf("expected 1 frozen unit, got %v", snapshot["units"])
	}
	unit, _ := units[0].(map[string]any)
	if unit["moduleCode"] != "CS-MOD" || unit["moduleName"] != "Gabinete CS" {
		t.Fatalf("frozen unit descriptor = %v", unit)
	}
}

func TestHandleProjectQuoteRevisions_CommercialSnapshotCostRedaction(t *testing.T) {
	server := &Server{Store: &stubStore{quoteRevisionsList: []domain.QuoteRevisionDetail{commercialSnapshotTestDetail()}}}

	req := httptest.NewRequest(http.MethodGet, "/api/projects/"+quoteLifecycleTestProjectID+"/quote-revisions", nil)
	req.SetPathValue("projectId", quoteLifecycleTestProjectID)
	// Vendedor with the workshop cost flag OFF: commercial truth stays, the
	// workshop cost stack is redacted to 0 — same policy as project payloads.
	req = withTestClaims(req, "user-2", []domain.UserRole{domain.RoleVendedor})
	w := httptest.NewRecorder()
	server.HandleProjectQuoteRevisions(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var payload []map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode payload: %v", err)
	}
	snapshot, ok := payload[0]["commercialSnapshot"].(map[string]any)
	if !ok {
		t.Fatal("cost-blind actors still see the frozen commercial envelope")
	}
	breakdown, _ := snapshot["breakdown"].(map[string]any)
	for _, field := range []string{"materialsCost", "edgeTotal", "hardwareTotal", "directCost", "laborModular", "laborFixedCost", "marginFactor"} {
		if breakdown[field].(float64) != 0 {
			t.Fatalf("cost field %s must be redacted, got %v", field, breakdown[field])
		}
	}
	if breakdown["salePrice"].(float64) != 498.5 {
		t.Fatalf("salePrice is commercial and must stay, got %v", breakdown["salePrice"])
	}
	if snapshot["currency"] != "MXN" || snapshot["units"] == nil {
		t.Fatal("commercial identity/descriptors must survive redaction")
	}
	lines := snapshot["lines"].([]any)
	amounts := lines[0].(map[string]any)["amounts"].(map[string]any)
	for _, field := range []string{"materialsCost", "edgeTotal", "hardwareTotal", "directCost", "laborModular"} {
		if amounts[field].(float64) != 0 {
			t.Fatalf("line cost field %s must be redacted, got %v", field, amounts[field])
		}
	}
	if amounts["salePrice"].(float64) != 398.5 {
		t.Fatalf("line salePrice is commercial and must stay, got %v", amounts["salePrice"])
	}
}

func TestHandleProjectQuoteRevisions_LegacyRevisionWithoutSnapshot(t *testing.T) {
	detail := commercialSnapshotTestDetail()
	detail.CommercialSnapshot = nil
	server := &Server{Store: &stubStore{quoteRevisionsList: []domain.QuoteRevisionDetail{detail}}}

	req := httptest.NewRequest(http.MethodGet, "/api/projects/"+quoteLifecycleTestProjectID+"/quote-revisions", nil)
	req.SetPathValue("projectId", quoteLifecycleTestProjectID)
	req = withTestClaims(req, "user-1", []domain.UserRole{domain.RoleAdmin})
	w := httptest.NewRecorder()
	server.HandleProjectQuoteRevisions(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	body := w.Body.String()
	if containsKey(body, "commercialSnapshot") {
		t.Fatalf("legacy revision must expose an ABSENT commercialSnapshot (honest fail-closed state), got %s", body)
	}
}

func containsKey(body, key string) bool {
	var payload []map[string]any
	if err := json.Unmarshal([]byte(body), &payload); err != nil {
		return false
	}
	if len(payload) != 1 {
		return false
	}
	_, present := payload[0][key]
	return present
}

func TestHandleQuoteRevisionPublish_MissingSnapshotFailsClosed(t *testing.T) {
	server := &Server{Store: &stubStore{
		publishQuoteRevisionErr: domain.ErrQuoteCommercialSnapshotMissing,
	}}
	req := newQuoteLifecycleCommandRequest("/api/projects/"+quoteLifecycleTestProjectID+"/quote-revisions/"+quoteLifecycleTestRevID+":publish", "user-1", []domain.UserRole{domain.RoleAdmin})
	w := httptest.NewRecorder()
	server.HandleQuoteRevisionPublish(w, req)

	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409 fail-closed, got %d: %s", w.Code, w.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode error payload: %v", err)
	}
	message, _ := body["message"].(string)
	if !strings.Contains(message, "nueva revisión") {
		t.Fatalf("error message must point to the actionable continuation (new revision), got %q", message)
	}
}
