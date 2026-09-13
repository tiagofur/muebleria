package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

const projectionDesignID = "42000000-0000-0000-0000-000000000003"

func projectionRequest(role string) *http.Request {
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/projects/"+qrTestProjectID+"/designs/"+projectionDesignID+"/commercial-projection", nil), "admin-1", role)
	req.SetPathValue("projectId", qrTestProjectID)
	req.SetPathValue("designId", projectionDesignID)
	return req
}

func TestHandleDesignCommercialProjection_PreservesLegitimateZeroAndReference(t *testing.T) {
	zero := 0.0
	store := &stubStore{commercialProjection: &domain.CommercialProjection{
		Schema: domain.CommercialProjectionSchema, Status: domain.CommercialProjectionCurrent,
		ProjectID: qrTestProjectID, DesignID: projectionDesignID, WorkingVersion: "v1",
		WorkingFingerprint: "sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		PricingAuthority:   "calc-project-breakdown", CalculatedAt: time.Now().UTC(), Currency: "MXN",
		Amounts: &domain.CommercialProjectionAmounts{SaleTotal: &zero, DirectCost: &zero}, Issues: []string{},
		Reference: &domain.CommercialProjectionReference{QuoteRevisionID: "3f7b6c5d-0000-4000-8000-000000000010", RevisionNumber: 1, Status: "accepted", Currency: "MXN", SaleTotal: &zero},
	}}
	rr := httptest.NewRecorder()
	(&Server{Store: store}).HandleDesignCommercialProjection(rr, projectionRequest(string(domain.RoleAdmin)))
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	amounts := body["amounts"].(map[string]any)
	if value, ok := amounts["saleTotal"]; !ok || value != float64(0) {
		t.Fatalf("legitimate zero lost: %#v", amounts)
	}
	if body["pricingAuthority"] != "calc-project-breakdown" {
		t.Fatalf("authority lost: %#v", body)
	}
}

func TestHandleDesignCommercialProjection_RedactsCostsForCostBlindRole(t *testing.T) {
	value := 25.0
	store := &stubStore{commercialProjection: &domain.CommercialProjection{
		Schema: domain.CommercialProjectionSchema, Status: domain.CommercialProjectionCurrent,
		ProjectID: qrTestProjectID, DesignID: projectionDesignID, WorkingVersion: "v1",
		WorkingFingerprint: "sha256-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		PricingAuthority:   "calc-project-breakdown", CalculatedAt: time.Now().UTC(), Currency: "MXN",
		Amounts: &domain.CommercialProjectionAmounts{SaleTotal: &value, DirectCost: &value, MarginFactor: &value}, Issues: []string{},
	}}
	rr := httptest.NewRecorder()
	(&Server{Store: store}).HandleDesignCommercialProjection(rr, projectionRequest(string(domain.RoleVendedor)))
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
	var body struct {
		CostsWithheld bool           `json:"costsWithheld"`
		Amounts       map[string]any `json:"amounts"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if !body.CostsWithheld || body.Amounts["directCost"] != nil || body.Amounts["marginFactor"] != nil {
		t.Fatalf("cost redaction failed: %#v", body)
	}
	if body.Amounts["saleTotal"] != value {
		t.Fatalf("commercial total must stay visible: %#v", body.Amounts)
	}
}

func TestHandleDesignCommercialProjection_DeniesUnrelatedRoleBeforeRead(t *testing.T) {
	store := &stubStore{}
	rr := httptest.NewRecorder()
	(&Server{Store: store}).HandleDesignCommercialProjection(rr, projectionRequest(string(domain.RoleAlmacen)))
	if rr.Code != http.StatusForbidden {
		t.Fatalf("status=%d want 403", rr.Code)
	}
}
