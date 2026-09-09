package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #637 / DT-MAT: HTTP boundary of the provenance read model and the explicit
// reconciliation command — generated request/response contract, fail-closed
// errors and the optimistic-concurrency token plumbing.

const matProvTestInstance = "51000000-0000-0000-0000-0000000000e1"
const matProvTestFront = "70000000-0000-0000-0000-0000000000f1"

func TestHandleMaterialProvenance_GetReturnsContractShape(t *testing.T) {
	updatedAt := time.Date(2026, 9, 9, 12, 0, 0, 0, time.UTC)
	store := &stubStore{materialProvenance: &storage.DesignWorkingCopyMaterialProvenance{
		DesignID:             designTestDesignID,
		ProjectID:            designTestProjectID,
		WorkingCopyUpdatedAt: updatedAt,
		Items: []storage.DesignWorkingItemMaterialProvenance{{
			FurnitureInstanceID: matProvTestInstance,
			Roles: []engine.MaterialRoleProvenance{
				{Role: "FRENTES", QuotedChoice: matProvTestFront, Provenance: engine.MaterialProvenanceQuotedMissingFromWorking},
				{Role: "FRENTE", WorkingChoice: matProvTestFront, EffectiveChoice: matProvTestFront, Provenance: engine.MaterialProvenanceAuthored},
			},
			Reconcilable: true,
		}},
	}}
	srv := &Server{Store: store}
	req := designRequest(http.MethodGet, "/api/designs/"+designTestDesignID+"/working-copy/material-provenance", "", string(domain.RoleAdmin))
	rr := httptest.NewRecorder()

	srv.HandleDesignWorkingCopyMaterialProvenance(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	var body struct {
		DesignID             string `json:"design_id"`
		ProjectID            string `json:"project_id"`
		WorkingCopyUpdatedAt string `json:"working_copy_updated_at"`
		Items                []struct {
			FurnitureInstanceID string           `json:"furniture_instance_id"`
			Reconcilable        bool             `json:"reconcilable"`
			Roles               []map[string]any `json:"roles"`
		} `json:"items"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v (%s)", err, rr.Body.String())
	}
	if body.DesignID != designTestDesignID || len(body.Items) != 1 || !body.Items[0].Reconcilable {
		t.Fatalf("unexpected envelope: %+v", body)
	}
	if body.WorkingCopyUpdatedAt == "" {
		t.Fatal("working_copy_updated_at must be present when the working copy exists")
	}
	role := body.Items[0].Roles[0]
	if role["role"] != "FRENTES" || role["provenance"] != "quoted_missing_from_working" || role["quoted_choice"] != matProvTestFront {
		t.Fatalf("candidate role = %v", role)
	}
	if _, hasWorking := role["working_choice"]; hasWorking {
		t.Fatalf("absent working choice must be omitted, got %v", role)
	}
}

func TestHandleMaterialProvenance_DesignNotFound(t *testing.T) {
	srv := &Server{Store: &stubStore{materialProvenanceErr: domain.ErrDesignNotFound}}
	req := designRequest(http.MethodGet, "/api/designs/"+designTestDesignID+"/working-copy/material-provenance", "", string(domain.RoleAdmin))
	rr := httptest.NewRecorder()

	srv.HandleDesignWorkingCopyMaterialProvenance(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (body=%s)", rr.Code, rr.Body.String())
	}
}

func TestHandleMaterialProvenance_RequiresAuth(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	req := httptest.NewRequest(http.MethodGet, "/api/designs/"+designTestDesignID+"/working-copy/material-provenance", nil)
	req.SetPathValue("designId", designTestDesignID)
	rr := httptest.NewRecorder()

	srv.HandleDesignWorkingCopyMaterialProvenance(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rr.Code)
	}
}

func TestHandleMaterialsReconcile_PostAppliesCommand(t *testing.T) {
	updatedAt := time.Date(2026, 9, 9, 12, 30, 0, 0, time.UTC)
	store := &stubStore{reconcileMaterialsResult: &storage.DesignWorkingMaterialsReconciliation{
		DesignID:             designTestDesignID,
		ProjectID:            designTestProjectID,
		FurnitureInstanceID:  matProvTestInstance,
		FilledChoices:        map[string]string{"FRENTES": matProvTestFront},
		PreservedChoices:     map[string]string{"FRENTE": matProvTestFront},
		WorkingCopyUpdatedAt: updatedAt,
	}}
	srv := &Server{Store: store}
	body := `{"furniture_instance_id":"` + matProvTestInstance + `","expected_updated_at":"` + updatedAt.Format(time.RFC3339Nano) + `"}`
	req := designRequest(http.MethodPost, "/api/designs/"+designTestDesignID+"/working-copy/material-choices:reconcile", body, string(domain.RoleAdmin))
	rr := httptest.NewRecorder()

	srv.HandleDesignWorkingCopyMaterialsReconcile(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if store.reconcileMaterialsCmd == nil {
		t.Fatal("store must receive the reconcile command")
	}
	if store.reconcileMaterialsCmd.FurnitureInstanceID != matProvTestInstance {
		t.Fatalf("furniture_instance_id = %s", store.reconcileMaterialsCmd.FurnitureInstanceID)
	}
	if store.reconcileMaterialsCmd.ExpectedUpdatedAt == nil || !store.reconcileMaterialsCmd.ExpectedUpdatedAt.Equal(updatedAt) {
		t.Fatalf("expected_updated_at = %v, want %v", store.reconcileMaterialsCmd.ExpectedUpdatedAt, updatedAt)
	}
	var resp struct {
		FilledChoices    map[string]string `json:"filled_choices"`
		PreservedChoices map[string]string `json:"preserved_choices"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v (%s)", err, rr.Body.String())
	}
	if resp.FilledChoices["FRENTES"] != matProvTestFront || resp.PreservedChoices["FRENTE"] != matProvTestFront {
		t.Fatalf("filled/preserved = %v / %v", resp.FilledChoices, resp.PreservedChoices)
	}
}

func TestHandleMaterialsReconcile_InvalidInputs(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	cases := []struct {
		name string
		body string
	}{
		{"not a uuid", `{"furniture_instance_id":"abc"}`},
		{"missing instance", `{}`},
		{"bad timestamp", `{"furniture_instance_id":"` + matProvTestInstance + `","expected_updated_at":"ayer"}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req := designRequest(http.MethodPost, "/api/designs/"+designTestDesignID+"/working-copy/material-choices:reconcile", tc.body, string(domain.RoleAdmin))
			rr := httptest.NewRecorder()
			srv.HandleDesignWorkingCopyMaterialsReconcile(rr, req)
			if rr.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (body=%s)", rr.Code, rr.Body.String())
			}
		})
	}
}

func TestHandleMaterialsReconcile_StaleWorkingCopyReturns409(t *testing.T) {
	srv := &Server{Store: &stubStore{reconcileMaterialsErr: storage.ErrVersionConflict}}
	req := designRequest(http.MethodPost, "/api/designs/"+designTestDesignID+"/working-copy/material-choices:reconcile",
		`{"furniture_instance_id":"`+matProvTestInstance+`"}`, string(domain.RoleAdmin))
	rr := httptest.NewRecorder()

	srv.HandleDesignWorkingCopyMaterialsReconcile(rr, req)

	if rr.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 (body=%s)", rr.Code, rr.Body.String())
	}
	if msg := rr.Body.String(); !strings.Contains(msg, "cambió") {
		t.Fatalf("conflict message = %s", msg)
	}
}

func TestHandleMaterialsReconcile_WorkingItemNotFoundReturns404(t *testing.T) {
	srv := &Server{Store: &stubStore{reconcileMaterialsErr: domain.ErrWorkingItemNotFound}}
	req := designRequest(http.MethodPost, "/api/designs/"+designTestDesignID+"/working-copy/material-choices:reconcile",
		`{"furniture_instance_id":"`+matProvTestInstance+`"}`, string(domain.RoleAdmin))
	rr := httptest.NewRecorder()

	srv.HandleDesignWorkingCopyMaterialsReconcile(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (body=%s)", rr.Code, rr.Body.String())
	}
}
