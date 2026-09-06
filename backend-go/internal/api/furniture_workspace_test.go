package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

func TestHandleProjectFurnitureWorkspace_RoleGuard(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	projectID := "00000000-0000-4000-8000-000000000010"
	req := httptest.NewRequest(http.MethodPost, "/api/projects/"+projectID+"/furniture-workspace", bytes.NewReader([]byte("{}")))
	// Role without RoleCanAccessProjects (e.g. transportista)
	req = withClaims(req, "user-1", "transportista")
	req.SetPathValue("projectId", projectID)
	rec := httptest.NewRecorder()

	srv.HandleProjectFurnitureWorkspace(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden, got %d (body: %s)", rec.Code, rec.Body.String())
	}
}

func TestHandleProjectFurnitureWorkspace_InvalidUUIDs(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	// Bad project ID
	req := httptest.NewRequest(http.MethodPost, "/api/projects/not-a-uuid/furniture-workspace", bytes.NewReader([]byte("{}")))
	req = withClaims(req, "user-1", "vendedor")
	req.SetPathValue("projectId", "not-a-uuid")
	rec := httptest.NewRecorder()
	srv.HandleProjectFurnitureWorkspace(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for bad projectId, got %d", rec.Code)
	}

	// Bad quoteRevisionId in body
	validProjectID := "00000000-0000-4000-8000-000000000010"
	badQuoteReq := openapi.ProjectFurnitureWorkspaceRequest{
		QuoteRevisionId: ptr("not-a-uuid"),
	}
	body, _ := json.Marshal(badQuoteReq)
	req2 := httptest.NewRequest(http.MethodPost, "/api/projects/"+validProjectID+"/furniture-workspace", bytes.NewReader(body))
	req2 = withClaims(req2, "user-1", "vendedor")
	req2.SetPathValue("projectId", validProjectID)
	rec2 := httptest.NewRecorder()
	srv.HandleProjectFurnitureWorkspace(rec2, req2)
	if rec2.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for bad quoteRevisionId, got %d", rec2.Code)
	}
}

func TestHandleProjectFurnitureWorkspace_ContradictoryContext(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	validProjectID := "00000000-0000-4000-8000-000000000010"
	validDesignID := "00000000-0000-4000-8000-000000000020"
	validRevisionID := "00000000-0000-4000-8000-000000000030"

	// Case 1: kind=working with a designRevisionId -> rejected
	reqBody1 := openapi.ProjectFurnitureWorkspaceRequest{
		DesignId:          &validDesignID,
		DesignContextKind: ptr("working"),
		DesignRevisionId:  &validRevisionID,
	}
	b1, _ := json.Marshal(reqBody1)
	req1 := httptest.NewRequest(http.MethodPost, "/api/projects/"+validProjectID+"/furniture-workspace", bytes.NewReader(b1))
	req1 = withClaims(req1, "user-1", "vendedor")
	req1.SetPathValue("projectId", validProjectID)
	rec1 := httptest.NewRecorder()
	srv.HandleProjectFurnitureWorkspace(rec1, req1)
	if rec1.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for working with designRevisionId, got %d", rec1.Code)
	}

	// Case 2: kind=revision without designRevisionId -> rejected
	reqBody2 := openapi.ProjectFurnitureWorkspaceRequest{
		DesignId:          &validDesignID,
		DesignContextKind: ptr("revision"),
	}
	b2, _ := json.Marshal(reqBody2)
	req2 := httptest.NewRequest(http.MethodPost, "/api/projects/"+validProjectID+"/furniture-workspace", bytes.NewReader(b2))
	req2 = withClaims(req2, "user-1", "vendedor")
	req2.SetPathValue("projectId", validProjectID)
	rec2 := httptest.NewRecorder()
	srv.HandleProjectFurnitureWorkspace(rec2, req2)
	if rec2.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for revision without designRevisionId, got %d", rec2.Code)
	}
}

func TestHandleProjectFurnitureWorkspace_NotFound(t *testing.T) {
	store := &stubStore{
		furnitureWorkspaceErr: domain.ErrDesignNotFound,
	}
	srv := &Server{Store: store}
	validProjectID := "00000000-0000-4000-8000-000000000010"
	req := httptest.NewRequest(http.MethodPost, "/api/projects/"+validProjectID+"/furniture-workspace", bytes.NewReader([]byte("{}")))
	req = withClaims(req, "user-1", "vendedor")
	req.SetPathValue("projectId", validProjectID)
	rec := httptest.NewRecorder()

	srv.HandleProjectFurnitureWorkspace(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 Not Found, got %d", rec.Code)
	}
}

func TestHandleProjectFurnitureWorkspace_SuccessDTO(t *testing.T) {
	validProjectID := "00000000-0000-4000-8000-000000000010"
	store := &stubStore{
		furnitureWorkspaceResult: &domain.FurnitureWorkspace{
			ProjectID: validProjectID,
			DesignContext: domain.FurnitureWorkspaceDesignHeader{
				Kind: "working",
			},
			Release: &domain.FurnitureWorkspaceRelease{
				ID:                   "rel-01",
				ReleaseNumber:        1,
				DesignRevisionID:     "des-rev-01",
				DesignRevisionNumber: 1,
				QuoteRevisionID:      "quote-rev-01",
			},
			LatestProjectRelease: &domain.FurnitureWorkspaceRelease{
				ID:                   "rel-02",
				ReleaseNumber:        2,
				DesignRevisionID:     "des-rev-02",
				DesignRevisionNumber: 2,
				QuoteRevisionID:      "quote-rev-02",
			},
			Summary: domain.FurnitureWorkspaceSummary{
				Total:       2,
				ActiveUnits: 2,
				Placed:      1,
				Pending:     1,
			},
			Units: []domain.FurnitureWorkspaceUnit{
				{
					Instance: domain.FurnitureInstance{
						ID:              "fi-01",
						ProjectID:       validProjectID,
						Origin:          domain.FurnitureInstanceOriginQuote,
						LifecycleStatus: domain.FurnitureInstanceLifecycleActive,
					},
					Commercial: domain.FurnitureWorkspaceCommercial{Present: true, LifecycleStatus: "active"},
					Design:     domain.FurnitureWorkspaceDesign{Presence: "placed", ContextKind: "working"},
					CommercialGrouping: &domain.FurnitureWorkspaceCommercialGrouping{
						QuoteLineID: "line-01",
						UnitIndex:   1,
						UnitTotal:   2,
					},
				},
				{
					Instance: domain.FurnitureInstance{
						ID:              "fi-02",
						ProjectID:       validProjectID,
						Origin:          domain.FurnitureInstanceOriginQuote,
						LifecycleStatus: domain.FurnitureInstanceLifecycleActive,
					},
					Commercial: domain.FurnitureWorkspaceCommercial{Present: true, LifecycleStatus: "active"},
					Design:     domain.FurnitureWorkspaceDesign{Presence: "pending", ContextKind: "working"},
					CommercialGrouping: &domain.FurnitureWorkspaceCommercialGrouping{
						QuoteLineID: "line-01",
						UnitIndex:   2,
						UnitTotal:   2,
					},
					ActionRequired: &domain.FurnitureWorkspaceAction{
						Code:        domain.FurnitureWorkspaceActionPendingPlacement,
						Message:     "Pendiente de colocar en el diseño",
						Remediation: "Colocá la unidad desde el panel de muebles",
					},
				},
			},
		},
	}
	srv := &Server{Store: store}
	req := httptest.NewRequest(http.MethodPost, "/api/projects/"+validProjectID+"/furniture-workspace", bytes.NewReader([]byte("{}")))
	req = withClaims(req, "user-1", "vendedor")
	req.SetPathValue("projectId", validProjectID)
	rec := httptest.NewRecorder()

	srv.HandleProjectFurnitureWorkspace(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d (body: %s)", rec.Code, rec.Body.String())
	}

	var res openapi.ProjectFurnitureWorkspace
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}

	if res.ProjectId != validProjectID {
		t.Errorf("expected projectId %s, got %s", validProjectID, res.ProjectId)
	}
	if res.Release == nil || res.Release.ID != "rel-01" {
		t.Errorf("expected contextual release rel-01, got %+v", res.Release)
	}
	if res.LatestProjectRelease == nil || res.LatestProjectRelease.ID != "rel-02" {
		t.Errorf("expected latest project release rel-02, got %+v", res.LatestProjectRelease)
	}
	if len(res.Units) != 2 {
		t.Fatalf("expected 2 units, got %d", len(res.Units))
	}
	if res.Units[0].CommercialGrouping == nil || res.Units[0].CommercialGrouping.UnitIndex != 1 {
		t.Errorf("expected unit 0 commercialGrouping unitIndex 1, got %+v", res.Units[0].CommercialGrouping)
	}
	if res.Units[1].ActionRequired == nil || res.Units[1].ActionRequired.Code != "pending_placement" {
		t.Errorf("expected unit 1 actionRequired pending_placement, got %+v", res.Units[1].ActionRequired)
	}
}

func TestHandleProjectFurnitureWorkspace_SuccessDTO_WithReconciliationImpact(t *testing.T) {
	validProjectID := "00000000-0000-4000-8000-000000000010"
	store := &stubStore{
		furnitureWorkspaceResult: &domain.FurnitureWorkspace{
			ProjectID: validProjectID,
			DesignContext: domain.FurnitureWorkspaceDesignHeader{
				Kind: "revision",
			},
			Units: []domain.FurnitureWorkspaceUnit{
				{
					Instance: domain.FurnitureInstance{
						ID:              "fi-spatial-01",
						ProjectID:       validProjectID,
						Origin:          domain.FurnitureInstanceOriginQuote,
						LifecycleStatus: domain.FurnitureInstanceLifecycleActive,
					},
					Reconciliation: &domain.FurnitureWorkspaceReconciliationItem{
						Item: domain.ReconciliationItem{
							FurnitureInstanceID: "fi-spatial-01",
							Status:              domain.ReconciliationStatusModified,
							Differences: []domain.StructuredDifference{
								{Path: "transform.translationMm", QuoteValue: []float64{0, 0, 0}, DesignValue: []float64{100, 0, 0}},
							},
						},
						Impact: domain.ChangeImpact{Spatial: true},
					},
				},
			},
		},
	}
	srv := &Server{Store: store}
	req := httptest.NewRequest(http.MethodPost, "/api/projects/"+validProjectID+"/furniture-workspace", bytes.NewReader([]byte("{}")))
	req = withClaims(req, "user-1", "vendedor")
	req.SetPathValue("projectId", validProjectID)
	rec := httptest.NewRecorder()

	srv.HandleProjectFurnitureWorkspace(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d (body: %s)", rec.Code, rec.Body.String())
	}

	var res openapi.ProjectFurnitureWorkspace
	if err := json.Unmarshal(rec.Body.Bytes(), &res); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}

	if len(res.Units) != 1 {
		t.Fatalf("expected 1 unit, got %d", len(res.Units))
	}
	recon := res.Units[0].Reconciliation
	if recon == nil {
		t.Fatalf("expected reconciliation on unit, got nil")
	}
	if recon.Status != openapi.ReconciliationStatusModified {
		t.Errorf("expected status modified, got %s", recon.Status)
	}
	if !recon.Impact.Spatial || recon.Impact.Commercial || recon.Impact.Manufacturing {
		t.Errorf("expected unit impact spatial=true, commercial=false, manufacturing=false, got %+v", recon.Impact)
	}
	if len(recon.Differences) != 1 {
		t.Fatalf("expected 1 difference, got %d", len(recon.Differences))
	}
	diff := recon.Differences[0]
	if diff.Path != "transform.translationMm" {
		t.Errorf("expected diff path transform.translationMm, got %s", diff.Path)
	}
	if !diff.Impact.Spatial || diff.Impact.Commercial || diff.Impact.Manufacturing {
		t.Errorf("expected difference impact spatial=true, got %+v", diff.Impact)
	}
}

func ptr[T any](v T) *T {
	return &v
}
