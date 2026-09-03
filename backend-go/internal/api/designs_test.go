package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #387 / DT-3: Design aggregate and immutable DesignRevision snapshots handler unit tests
// (withClaims + stubStore, no DB): role guard, generated-DTO round-trip, typed error mapping.

const (
	designTestProjectID  = "41000000-0000-0000-0000-000000000001"
	designTestDesignID   = "52000000-0000-0000-0000-000000000001"
	designTestRevisionID = "53000000-0000-0000-0000-000000000001"
	designTestInstanceID = "51000000-0000-0000-0000-0000000000f1"
)

func designRequest(method, target, body, role string) *http.Request {
	var reader *strings.Reader
	if body == "" {
		reader = strings.NewReader("")
	} else {
		reader = strings.NewReader(body)
	}
	req := withClaims(httptest.NewRequest(method, target, reader), "admin-1", role)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	req.SetPathValue("projectId", designTestProjectID)
	req.SetPathValue("designId", designTestDesignID)
	req.SetPathValue("revisionId", designTestRevisionID)
	return req
}

func TestHandleProjectDesigns_CreateReturns201(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	req := designRequest(http.MethodPost, "/api/projects/"+designTestProjectID+"/designs",
		`{"name":"Cocina Principal","source_quote_revision_id":"70000000-0000-0000-0000-000000000001"}`,
		string(domain.RoleVendedor))
	rr := httptest.NewRecorder()

	srv.HandleProjectDesigns(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%s)", rr.Code, rr.Body.String())
	}
	if store.createDesignCmd == nil {
		t.Fatal("store must receive createDesign command")
	}
	cmd := *store.createDesignCmd
	if cmd.ProjectID != designTestProjectID || cmd.Name != "Cocina Principal" {
		t.Fatalf("command mismatch: %+v", cmd)
	}
	if cmd.SourceQuoteRevisionID != "70000000-0000-0000-0000-000000000001" {
		t.Fatalf("source quote revision id lost: %+v", cmd)
	}
	body := rr.Body.String()
	for _, key := range []string{`"id":"des-1"`, `"project_id":"` + designTestProjectID + `"`, `"name":"Cocina Principal"`, `"status":"active"`} {
		if !strings.Contains(body, key) {
			t.Fatalf("DTO body %s missing %s", body, key)
		}
	}
}

func TestHandleProjectDesigns_CreateRoleGuard(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	req := designRequest(http.MethodPost, "/api/projects/"+designTestProjectID+"/designs",
		`{"name":"Test"}`, string(domain.RoleProduccion))
	rr := httptest.NewRecorder()

	srv.HandleProjectDesigns(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 (body=%s)", rr.Code, rr.Body.String())
	}
	if store.createDesignCmd != nil {
		t.Fatal("production role must not create designs")
	}
}

func TestHandleProjectDesigns_ListReturns200(t *testing.T) {
	store := &stubStore{
		designsByID: map[string]domain.Design{
			"des-1": {
				ID:        "des-1",
				ProjectID: designTestProjectID,
				Name:      "Design 1",
				Status:    domain.DesignStatusActive,
			},
		},
	}
	srv := &Server{Store: store}
	req := designRequest(http.MethodGet, "/api/projects/"+designTestProjectID+"/designs", "", string(domain.RoleAdmin))
	rr := httptest.NewRecorder()

	srv.HandleProjectDesigns(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"name":"Design 1"`) {
		t.Fatalf("body = %s, want Design 1", rr.Body.String())
	}
}

func TestHandleDesign_GetReturns200(t *testing.T) {
	store := &stubStore{
		designsByID: map[string]domain.Design{
			designTestDesignID: {
				ID:        designTestDesignID,
				ProjectID: designTestProjectID,
				Name:      "Master Design",
				Status:    domain.DesignStatusActive,
			},
		},
	}
	srv := &Server{Store: store}
	req := designRequest(http.MethodGet, "/api/designs/"+designTestDesignID, "", string(domain.RoleAdmin))
	rr := httptest.NewRecorder()

	srv.HandleDesign(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), `"name":"Master Design"`) {
		t.Fatalf("body = %s, want Master Design", rr.Body.String())
	}
}

func TestHandleDesignRevisions_PublishReturns201(t *testing.T) {
	store := &stubStore{
		designsByID: map[string]domain.Design{
			designTestDesignID: {
				ID:        designTestDesignID,
				ProjectID: designTestProjectID,
				Status:    domain.DesignStatusActive,
			},
		},
	}
	srv := &Server{Store: store}
	reqBody := `{
		"source_type": "sketchup",
		"items": [
			{
				"furniture_instance_id": "` + designTestInstanceID + `",
				"parameters": {"widthMm": 600},
				"material_choices": {"CARCASS": "WHITE-18"},
				"transform": {
					"translation_mm": [100, 200, 0],
					"rotation_deg": [0, 0, 90]
				},
				"room_id": "kitchen",
				"technical_client_locator": {
					"kind": "sketchup_persistent_id",
					"value": "skp-999"
				}
			}
		]
	}`
	req := designRequest(http.MethodPost, "/api/designs/"+designTestDesignID+"/revisions", reqBody, string(domain.RoleVendedor))
	rr := httptest.NewRecorder()

	srv.HandleDesignRevisions(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%s)", rr.Code, rr.Body.String())
	}
	if store.publishDesignRevisionCmd == nil {
		t.Fatal("store must receive publishDesignRevision command")
	}
	cmd := *store.publishDesignRevisionCmd
	if cmd.DesignID != designTestDesignID || cmd.SourceType != domain.DesignRevisionSourceSketchup {
		t.Fatalf("command mismatch: %+v", cmd)
	}
	if len(cmd.Items) != 1 {
		t.Fatalf("items count = %d, want 1", len(cmd.Items))
	}
	item := cmd.Items[0]
	if item.FurnitureInstanceID != designTestInstanceID {
		t.Fatalf("item FI ID = %s, want %s", item.FurnitureInstanceID, designTestInstanceID)
	}
	if item.RoomID != "kitchen" || item.TechnicalClientLocator == nil || item.TechnicalClientLocator.Value != "skp-999" {
		t.Fatalf("item properties mismatch: %+v", item)
	}
	body := rr.Body.String()
	for _, key := range []string{`"revision_number":1`, `"source_type":"sketchup"`, `"status":"published"`, `"skp-999"`} {
		if !strings.Contains(body, key) {
			t.Fatalf("DTO body %s missing %s", body, key)
		}
	}
}

func TestHandleDesignRevisions_TypedErrors(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want int
	}{
		{"not found", domain.ErrDesignNotFound, http.StatusNotFound},
		{"revision not found", domain.ErrDesignRevisionNotFound, http.StatusNotFound},
		{"design not active", domain.ErrDesignNotActive, http.StatusConflict},
		{"stale base conflict", domain.ErrDesignRevisionConflict, http.StatusConflict},
		{"invalid parent", domain.ErrInvalidParentRevision, http.StatusBadRequest},
		{"duplicate FI", domain.ErrDuplicateFurnitureInstanceInRevision, http.StatusBadRequest},
		{"cross project FI", domain.ErrCrossProjectFurnitureInstance, http.StatusBadRequest},
		{"lifecycle conflict", domain.ErrFurnitureInstanceLifecycleConflict, http.StatusConflict},
		{"instance not found", storage.ErrFurnitureInstanceNotFound, http.StatusBadRequest},
		{"project not writable", domain.ErrFurnitureInstanceProjectNotWritable, http.StatusForbidden},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := &Server{Store: &stubStore{publishDesignRevisionErr: tc.err}}
			reqBody := `{"source_type":"sketchup","items":[]}`
			req := designRequest(http.MethodPost, "/api/designs/"+designTestDesignID+"/revisions", reqBody, string(domain.RoleAdmin))
			rr := httptest.NewRecorder()

			srv.HandleDesignRevisions(rr, req)

			if rr.Code != tc.want {
				t.Fatalf("status = %d, want %d (body=%s)", rr.Code, tc.want, rr.Body.String())
			}
		})
	}
}

func TestHandleDesignRevision_GetReturns200WithItems(t *testing.T) {
	store := &stubStore{
		designRevisionsByID: map[string]domain.DesignRevision{
			designTestRevisionID: {
				ID:             designTestRevisionID,
				DesignID:       designTestDesignID,
				RevisionNumber: 1,
				SourceType:     domain.DesignRevisionSourceSketchup,
				Status:         domain.DesignRevisionStatusPublished,
				Items: []domain.DesignRevisionItem{
					{
						ID:                  "ditem-1",
						DesignRevisionID:    designTestRevisionID,
						FurnitureInstanceID: designTestInstanceID,
						Parameters:          map[string]any{"widthMm": 600.0},
						MaterialChoices:     map[string]string{"CARCASS": "WHITE-18"},
					},
				},
			},
		},
	}
	srv := &Server{Store: store}
	req := designRequest(http.MethodGet, "/api/designs/"+designTestDesignID+"/revisions/"+designTestRevisionID, "", string(domain.RoleAdmin))
	rr := httptest.NewRecorder()

	srv.HandleDesignRevision(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	body := rr.Body.String()
	if !strings.Contains(body, `"revision_number":1`) || !strings.Contains(body, `"ditem-1"`) {
		t.Fatalf("body = %s, want revision 1 with ditem-1", body)
	}
}
