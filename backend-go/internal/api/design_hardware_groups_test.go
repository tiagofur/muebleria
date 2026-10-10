package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #1252: HTTP boundary of the consumed hardware option groups read model —
// generated contract shape, fail-closed errors, and the honest "sin elegir"
// (chosen_hardware_id omitted when no design default exists).

func TestHandleHardwareOptionGroups_ReturnsContractShape(t *testing.T) {
	store := &stubStore{hardwareOptionGroups: &storage.DesignConsumedHardwareOptionGroups{
		DesignID:  designTestDesignID,
		ProjectID: designTestProjectID,
		Scope:     "design",
		Groups: []storage.ConsumedHardwareOptionGroup{
			{Code: "BISAGRA", Name: "Bisagras", OptionIDs: []string{"hw-cl", "hw-eco"},
				ChosenHardwareID: "hw-cl", ConsumedBy: 2},
			{Code: "PATAS", Name: "Patas", OptionIDs: []string{"hw-pata"}, ConsumedBy: 1},
		},
	}}
	srv := &Server{Store: store}
	req := designRequest(http.MethodGet, "/api/designs/"+designTestDesignID+"/hardware-option-groups", "", string(domain.RoleAdmin))
	rr := httptest.NewRecorder()

	srv.HandleDesignHardwareOptionGroups(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	var body struct {
		DesignID  string `json:"design_id"`
		ProjectID string `json:"project_id"`
		Scope     string `json:"scope"`
		Groups    []struct {
			Code             string   `json:"code"`
			Name             string   `json:"name"`
			OptionIds        []string `json:"option_ids"`
			ChosenHardwareID string   `json:"chosen_hardware_id"`
			ConsumedBy       int      `json:"consumed_by"`
		} `json:"groups"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v (%s)", err, rr.Body.String())
	}
	if body.DesignID != designTestDesignID || body.Scope != "design" || len(body.Groups) != 2 {
		t.Fatalf("unexpected envelope: %+v", body)
	}
	if body.Groups[0].ChosenHardwareID != "hw-cl" {
		t.Fatalf("chosen = %q, want hw-cl", body.Groups[0].ChosenHardwareID)
	}
	if body.Groups[1].ChosenHardwareID != "" {
		t.Fatalf("absent choice must be omitted (sin elegir), got %q", body.Groups[1].ChosenHardwareID)
	}
}

func TestHandleHardwareOptionGroups_ProjectFallbackScopeRidesThrough(t *testing.T) {
	store := &stubStore{hardwareOptionGroups: &storage.DesignConsumedHardwareOptionGroups{
		DesignID:  designTestDesignID,
		ProjectID: designTestProjectID,
		Scope:     "project",
		Groups: []storage.ConsumedHardwareOptionGroup{
			{Code: "CORREDERA", Name: "Correderas", OptionIDs: []string{"hw-corr"}, ConsumedBy: 3},
		},
	}}
	srv := &Server{Store: store}
	req := designRequest(http.MethodGet, "/api/designs/"+designTestDesignID+"/hardware-option-groups", "", string(domain.RoleAdmin))
	rr := httptest.NewRecorder()

	srv.HandleDesignHardwareOptionGroups(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	var body struct {
		Scope  string `json:"scope"`
		Groups []struct {
			Code       string `json:"code"`
			ConsumedBy int    `json:"consumed_by"`
		} `json:"groups"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v (%s)", err, rr.Body.String())
	}
	if body.Scope != "project" || len(body.Groups) != 1 || body.Groups[0].Code != "CORREDERA" {
		t.Fatalf("fallback envelope = %+v", body)
	}
}

func TestHandleHardwareOptionGroups_DesignNotFound(t *testing.T) {
	srv := &Server{Store: &stubStore{hardwareOptionGroupsErr: domain.ErrDesignNotFound}}
	req := designRequest(http.MethodGet, "/api/designs/"+designTestDesignID+"/hardware-option-groups", "", string(domain.RoleAdmin))
	rr := httptest.NewRecorder()

	srv.HandleDesignHardwareOptionGroups(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (body=%s)", rr.Code, rr.Body.String())
	}
}

func TestHandleHardwareOptionGroups_RequiresAuth(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	req := httptest.NewRequest(http.MethodGet, "/api/designs/"+designTestDesignID+"/hardware-option-groups", nil)
	req.SetPathValue("designId", designTestDesignID)
	rr := httptest.NewRecorder()

	srv.HandleDesignHardwareOptionGroups(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rr.Code)
	}
}

func TestHandleHardwareOptionGroups_InvalidDesignID(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	req := designRequest(http.MethodGet, "/api/designs/not-a-uuid/hardware-option-groups", "", string(domain.RoleAdmin))
	req.SetPathValue("designId", "not-a-uuid")
	rr := httptest.NewRecorder()

	srv.HandleDesignHardwareOptionGroups(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body=%s)", rr.Code, rr.Body.String())
	}
}
