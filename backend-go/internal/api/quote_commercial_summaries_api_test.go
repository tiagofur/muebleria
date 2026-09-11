package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// activityAt formats a real commercial event timestamp for the summary stub.
func activityAt(t time.Time) *string {
	formatted := t.UTC().Format(time.RFC3339)
	return &formatted
}

// 2A BLOCKER 4: commercialActivityAt is nullable in the wire contract — a
// project without revisions serializes an explicit null, never a substituted
// Project timestamp.
func TestHandleProjectCommercialSummaries_ActivityAtNullable(t *testing.T) {
	store := &stubStore{
		commercialSummariesList: []domain.ProjectCommercialSummary{
			{
				ProjectID:            "p-none",
				ProjectName:          "Project without revisions",
				Currency:             "MXN",
				QuoteStatus:          domain.ProjectCommercialQuoteStatusNone,
				FurnitureQuantity:    0,
				CommercialActivityAt: nil,
			},
		},
	}
	server := &Server{Store: store}

	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/projects/commercial-summaries", nil), "u-admin", string(domain.RoleAdmin))
	w := httptest.NewRecorder()
	server.HandleProjectCommercialSummaries(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", w.Code, w.Body.String())
	}
	var payload []map[string]any
	if err := json.NewDecoder(w.Body).Decode(&payload); err != nil {
		t.Fatalf("decode JSON: %v", err)
	}
	if len(payload) != 1 {
		t.Fatalf("expected 1 summary, got %d", len(payload))
	}
	value, ok := payload[0]["commercialActivityAt"]
	if !ok {
		t.Fatal("commercialActivityAt must be present in the payload")
	}
	if value != nil {
		t.Fatalf("commercialActivityAt = %v, want explicit null without revisions", value)
	}
}

func TestHandleProjectCommercialSummaries_RequiresAuth(t *testing.T) {
	server := &Server{Store: &stubStore{}}
	req := httptest.NewRequest(http.MethodGet, "/api/projects/commercial-summaries", nil)
	w := httptest.NewRecorder()

	server.HandleProjectCommercialSummaries(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized, got %d", w.Code)
	}
}

func TestHandleProjectCommercialSummaries_RequiresRole(t *testing.T) {
	server := &Server{Store: &stubStore{}}
	// An actor with empty roles cannot access projects
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/projects/commercial-summaries", nil), "u-unauthorized", "")
	claims := claimsFromRequest(req)
	claims.Roles = []string{}
	claims.Role = ""
	w := httptest.NewRecorder()

	server.HandleProjectCommercialSummaries(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandleProjectCommercialSummaries_OwnerFiltering(t *testing.T) {
	sellerID := "u-seller-1"
	otherID := "u-seller-2"
	revNum := int64(1)
	sale := 50000.0

	store := &stubStore{
		commercialSummariesList: []domain.ProjectCommercialSummary{
			{
				ProjectID:            "p-1",
				ProjectName:          "Project 1",
				Currency:             "MXN",
				QuoteStatus:          domain.ProjectCommercialQuoteStatusDraft,
				QuoteRevisionNumber:  &revNum,
				SaleTotal:            &sale,
				FurnitureQuantity:    2,
				CommercialActivityAt: activityAt(time.Date(2026, 9, 11, 10, 0, 0, 0, time.UTC)),
				OwnerUserID:          sellerID,
			},
			{
				ProjectID:            "p-2",
				ProjectName:          "Project 2",
				Currency:             "MXN",
				QuoteStatus:          domain.ProjectCommercialQuoteStatusAccepted,
				QuoteRevisionNumber:  &revNum,
				SaleTotal:            &sale,
				FurnitureQuantity:    1,
				CommercialActivityAt: activityAt(time.Date(2026, 9, 11, 11, 0, 0, 0, time.UTC)),
				OwnerUserID:          otherID,
			},
		},
	}
	server := &Server{Store: store}

	// Actor is a seller (vendedor) — does not see all owners
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/projects/commercial-summaries", nil), sellerID, string(domain.RoleVendedor))
	w := httptest.NewRecorder()

	server.HandleProjectCommercialSummaries(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", w.Code, w.Body.String())
	}

	var dtos []openapi.ProjectCommercialSummary
	if err := json.NewDecoder(w.Body).Decode(&dtos); err != nil {
		t.Fatalf("decode JSON: %v", err)
	}

	if len(dtos) != 1 {
		t.Fatalf("expected 1 project for seller, got %d", len(dtos))
	}
	if dtos[0].ProjectId != "p-1" {
		t.Fatalf("expected project p-1, got %s", dtos[0].ProjectId)
	}
}

func TestHandleProjectCommercialSummaries_AdminSeesAll(t *testing.T) {
	revNum := int64(1)
	sale := 50000.0
	store := &stubStore{
		commercialSummariesList: []domain.ProjectCommercialSummary{
			{
				ProjectID:            "p-1",
				ProjectName:          "Project 1",
				Currency:             "MXN",
				QuoteStatus:          domain.ProjectCommercialQuoteStatusDraft,
				QuoteRevisionNumber:  &revNum,
				SaleTotal:            &sale,
				FurnitureQuantity:    2,
				CommercialActivityAt: activityAt(time.Date(2026, 9, 11, 10, 0, 0, 0, time.UTC)),
				OwnerUserID:          "u-1",
			},
			{
				ProjectID:            "p-2",
				ProjectName:          "Project 2",
				Currency:             "MXN",
				QuoteStatus:          domain.ProjectCommercialQuoteStatusAccepted,
				QuoteRevisionNumber:  &revNum,
				SaleTotal:            &sale,
				FurnitureQuantity:    1,
				CommercialActivityAt: activityAt(time.Date(2026, 9, 11, 11, 0, 0, 0, time.UTC)),
				OwnerUserID:          "u-2",
			},
		},
	}
	server := &Server{Store: store}

	// Actor is an admin — sees all owners
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/projects/commercial-summaries", nil), "u-admin", string(domain.RoleAdmin))
	w := httptest.NewRecorder()

	server.HandleProjectCommercialSummaries(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", w.Code, w.Body.String())
	}

	var dtos []openapi.ProjectCommercialSummary
	if err := json.NewDecoder(w.Body).Decode(&dtos); err != nil {
		t.Fatalf("decode JSON: %v", err)
	}

	if len(dtos) != 2 {
		t.Fatalf("expected 2 projects for admin, got %d", len(dtos))
	}
}

func TestHandleProjectCommercialSummaries_CorruptSnapshotFailClosed(t *testing.T) {
	store := &stubStore{
		commercialSummariesErr: domain.ErrInvalidRevisionSnapshot,
	}
	server := &Server{Store: store}

	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/projects/commercial-summaries", nil), "u-admin", string(domain.RoleAdmin))
	w := httptest.NewRecorder()

	server.HandleProjectCommercialSummaries(w, req)

	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409 Conflict for corrupt snapshot, got %d: %s", w.Code, w.Body.String())
	}
}
