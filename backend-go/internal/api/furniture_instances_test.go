package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #385 / DT-1 handler unit tests (withClaims + stubStore, no DB): role guard,
// generated-DTO create round-trip, typed error mapping and the If-Match
// precondition on the terminal removal command.

const (
	fiTestProjectID  = "41000000-0000-0000-0000-000000000001"
	fiTestInstanceID = "51000000-0000-0000-0000-0000000000f1"
)

func fiRequest(method, target, body, role string) *http.Request {
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
	req.SetPathValue("projectId", fiTestProjectID)
	req.SetPathValue("instanceId", fiTestInstanceID)
	return req
}

func TestHandleProjectFurnitureInstances_CreateReturns201(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	req := fiRequest(http.MethodPost, "/api/projects/"+fiTestProjectID+"/furniture-instances",
		`{"furniture_definition_id":"50000000-0000-0000-0000-000000000001"}`, string(domain.RoleVendedor))
	rr := httptest.NewRecorder()

	srv.HandleProjectFurnitureInstances(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%s)", rr.Code, rr.Body.String())
	}
	if got := rr.Header().Get("ETag"); got != `"v1"` {
		t.Fatalf("ETag = %q, want \"v1\"", got)
	}
	if store.createFurnitureInstanceCmd == nil {
		t.Fatal("store must receive the create command")
	}
	cmd := *store.createFurnitureInstanceCmd
	if cmd.ProjectID != fiTestProjectID || cmd.Origin != domain.FurnitureInstanceOriginManual {
		t.Fatalf("command = %+v, want manual origin on the public API", cmd)
	}
	if cmd.FurnitureDefinitionID != "50000000-0000-0000-0000-000000000001" {
		t.Fatalf("definition provenance lost: %+v", cmd)
	}
	body := rr.Body.String()
	for _, key := range []string{`"id":"fi-1"`, `"project_id":"` + fiTestProjectID + `"`, `"origin":"manual"`, `"lifecycle_status":"active"`, `"version":1`} {
		if !strings.Contains(body, key) {
			t.Fatalf("DTO body %s missing %s", body, key)
		}
	}
	// The public DTO exposes identity/provenance only — no configuration
	// snapshot, transform or pricing may appear.
	if strings.Contains(body, "position") || strings.Contains(body, "parameters") || strings.Contains(body, "price") {
		t.Fatalf("DTO leaked non-identity fields: %s", body)
	}
}

func TestHandleProjectFurnitureInstances_CreateIdempotencyReplay(t *testing.T) {
	backend := newDurableBackend(func() time.Time { return time.Now().UTC() })
	store := &durableTestStore{backend: backend}

	srv := &Server{Store: store}
	handler := srv.RequireIdempotency("project.create-furniture-instance", http.HandlerFunc(srv.HandleProjectFurnitureInstances))

	body := `{"furniture_definition_id":"50000000-0000-0000-0000-000000000001"}`

	// First attempt: creates identity
	req1 := fiRequest(http.MethodPost, "/api/projects/"+fiTestProjectID+"/furniture-instances", body, string(domain.RoleVendedor))
	req1.Header.Set("Idempotency-Key", "create-intent-key-12345")
	rr1 := httptest.NewRecorder()
	handler.ServeHTTP(rr1, req1)

	if rr1.Code != http.StatusCreated {
		t.Fatalf("first attempt status = %d, want 201 (body=%s)", rr1.Code, rr1.Body.String())
	}
	if store.createFurnitureInstanceCalls != 1 {
		t.Fatalf("expected 1 call to store, got %d", store.createFurnitureInstanceCalls)
	}

	// Second attempt with the exact same Idempotency-Key (network retry / replay)
	req2 := fiRequest(http.MethodPost, "/api/projects/"+fiTestProjectID+"/furniture-instances", body, string(domain.RoleVendedor))
	req2.Header.Set("Idempotency-Key", "create-intent-key-12345")
	rr2 := httptest.NewRecorder()
	handler.ServeHTTP(rr2, req2)

	if rr2.Code != http.StatusCreated {
		t.Fatalf("second attempt status = %d, want 201 (body=%s)", rr2.Code, rr2.Body.String())
	}
	if rr2.Header().Get("Idempotency-Replayed") != "true" {
		t.Fatal("second attempt must be marked as Idempotency-Replayed")
	}
	// Critical invariant: exactly ONE entity created, store called only once
	if store.createFurnitureInstanceCalls != 1 {
		t.Fatalf("idempotent replay must NOT call store again, got %d calls", store.createFurnitureInstanceCalls)
	}
	if rr1.Body.String() != rr2.Body.String() {
		t.Fatalf("replayed body mismatch: first=%s, second=%s", rr1.Body.String(), rr2.Body.String())
	}
}

func TestHandleProjectFurnitureInstances_CreateRoleGuard(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	req := fiRequest(http.MethodPost, "/api/projects/"+fiTestProjectID+"/furniture-instances", `{}`, string(domain.RoleProduccion))
	rr := httptest.NewRecorder()

	srv.HandleProjectFurnitureInstances(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 (body=%s)", rr.Code, rr.Body.String())
	}
	if store.createFurnitureInstanceCmd != nil {
		t.Fatal("production role must not create furniture identities")
	}
}

func TestHandleProjectFurnitureInstances_ListRoleGuard(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	req := fiRequest(http.MethodGet, "/api/projects/"+fiTestProjectID+"/furniture-instances", "", string(domain.RoleAlmacen))
	rr := httptest.NewRecorder()

	srv.HandleProjectFurnitureInstances(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 (body=%s)", rr.Code, rr.Body.String())
	}
	// The blocker must point at the project furniture, not at quotes.
	if !strings.Contains(rr.Body.String(), "muebles del proyecto") {
		t.Fatalf("permission message = %s, want it to reference the project furniture", rr.Body.String())
	}
}

func TestHandleProjectFurnitureInstances_CreateTypedErrors(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want int
	}{
		{"project not visible", storage.ErrFurnitureInstanceNotFound, http.StatusNotFound},
		{"definition unknown", storage.ErrFurnitureDefinitionNotFound, http.StatusBadRequest},
		{"project owned by another org", domain.ErrFurnitureInstanceProjectNotWritable, http.StatusForbidden},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := &Server{Store: &stubStore{createFurnitureInstanceErr: tc.err}}
			req := fiRequest(http.MethodPost, "/api/projects/"+fiTestProjectID+"/furniture-instances", `{}`, string(domain.RoleAdmin))
			rr := httptest.NewRecorder()
			srv.HandleProjectFurnitureInstances(rr, req)
			if rr.Code != tc.want {
				t.Fatalf("status = %d, want %d (body=%s)", rr.Code, tc.want, rr.Body.String())
			}
		})
	}
}

func TestHandleProjectFurnitureInstances_ListMapsGeneratedDTO(t *testing.T) {
	definitionID := "50000000-0000-0000-0000-000000000001"
	store := &stubStore{listFurnitureInstances: []domain.FurnitureInstance{
		{ID: "fi-1", ProjectID: fiTestProjectID, FurnitureDefinitionID: definitionID,
			Origin: domain.FurnitureInstanceOriginManual, LifecycleStatus: domain.FurnitureInstanceLifecycleActive, Version: 1},
		{ID: "fi-2", ProjectID: fiTestProjectID,
			Origin: domain.FurnitureInstanceOriginDuplicate, OriginFurnitureInstanceID: "fi-1",
			LifecycleStatus: domain.FurnitureInstanceLifecycleRemoved, Version: 2},
	}}
	srv := &Server{Store: store}
	req := fiRequest(http.MethodGet, "/api/projects/"+fiTestProjectID+"/furniture-instances", "", string(domain.RoleIngeniero))
	rr := httptest.NewRecorder()

	srv.HandleProjectFurnitureInstances(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	body := rr.Body.String()
	for _, key := range []string{
		`"furniture_definition_id":"` + definitionID + `"`,
		`"origin_furniture_instance_id":"fi-1"`,
		`"lifecycle_status":"removed"`,
	} {
		if !strings.Contains(body, key) {
			t.Fatalf("list DTO %s missing %s", body, key)
		}
	}
}

func TestHandleFurnitureInstanceRemove_RequiresIfMatch(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	req := fiRequest(http.MethodPost, "/api/furniture-instances/51000000-0000-0000-0000-0000000000f1:remove", "", string(domain.RoleAdmin))
	rr := httptest.NewRecorder()

	srv.HandleFurnitureInstanceRemove(rr, req)

	if rr.Code != http.StatusPreconditionRequired {
		t.Fatalf("status = %d, want 428 without If-Match (body=%s)", rr.Code, rr.Body.String())
	}
}

func TestHandleFurnitureInstanceRemove_TypedErrors(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want int
	}{
		{"not found", storage.ErrFurnitureInstanceNotFound, http.StatusNotFound},
		{"stale version", storage.ErrVersionConflict, http.StatusConflict},
		{"already removed", domain.ErrFurnitureInstanceLifecycleConflict, http.StatusConflict},
		{"not owner org", domain.ErrFurnitureInstanceProjectNotWritable, http.StatusForbidden},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := &Server{Store: &stubStore{removeFurnitureInstanceErr: tc.err}}
			req := fiRequest(http.MethodPost, "/api/furniture-instances/51000000-0000-0000-0000-0000000000f1:remove", "", string(domain.RoleAdmin))
			req.Header.Set("If-Match", `"v1"`)
			rr := httptest.NewRecorder()
			srv.HandleFurnitureInstanceRemove(rr, req)
			if rr.Code != tc.want {
				t.Fatalf("status = %d, want %d (body=%s)", rr.Code, tc.want, rr.Body.String())
			}
		})
	}
}

func TestHandleFurnitureInstanceRemove_ReturnsTerminalState(t *testing.T) {
	store := &stubStore{}
	store.furnitureInstancesByID = map[string]domain.FurnitureInstance{
		fiTestInstanceID: {ID: fiTestInstanceID, ProjectID: fiTestProjectID,
			LifecycleStatus: domain.FurnitureInstanceLifecycleActive, Version: 1},
	}
	srv := &Server{Store: store}
	req := fiRequest(http.MethodPost, "/api/furniture-instances/51000000-0000-0000-0000-0000000000f1:remove", "", string(domain.RoleAdmin))
	req.Header.Set("If-Match", `"v1"`)
	rr := httptest.NewRecorder()

	srv.HandleFurnitureInstanceRemove(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if got := rr.Header().Get("ETag"); got != `"v2"` {
		t.Fatalf("ETag = %q, want \"v2\"", got)
	}
	if !strings.Contains(rr.Body.String(), `"lifecycle_status":"removed"`) {
		t.Fatalf("body = %s, want terminal removed state", rr.Body.String())
	}
	if store.removeFurnitureInstanceCmd == nil || store.removeFurnitureInstanceCmd.ExpectedVersion != 1 {
		t.Fatalf("remove command = %+v, want expected version 1", store.removeFurnitureInstanceCmd)
	}
}

// TestHandleProjectFurnitureInstances_ListIncludesDisplaySummary (#389 / DT-5):
// the list DTO carries the server-computed presentation block — catalog label
// plus quoted-or-default dimensions — so authoring clients never guess labels
// or dimensions. Identity fields stay verbatim; display is optional and absent
// when neither source knows anything.
func TestHandleProjectFurnitureInstances_ListIncludesDisplaySummary(t *testing.T) {
	definitionID := "50000000-0000-0000-0000-000000000001"
	summaries := []storage.FurnitureInstanceSummary{
		{
			Instance: domain.FurnitureInstance{ID: "fi-1", ProjectID: fiTestProjectID,
				FurnitureDefinitionID: definitionID, Origin: domain.FurnitureInstanceOriginQuote,
				LifecycleStatus: domain.FurnitureInstanceLifecycleActive, Version: 1},
			DisplayName: "Gabinete Base 600",
			DisplayDims: &domain.ItemCustomDims{WidthMm: 600, HeightMm: 720, DepthMm: 560},
		},
		{
			Instance: domain.FurnitureInstance{ID: "fi-2", ProjectID: fiTestProjectID,
				Origin: domain.FurnitureInstanceOriginManual,
				LifecycleStatus: domain.FurnitureInstanceLifecycleActive, Version: 1},
		},
	}
	store := &stubStore{listFurnitureInstanceSummaries: summaries}
	srv := &Server{Store: store}
	req := fiRequest(http.MethodGet, "/api/projects/"+fiTestProjectID+"/furniture-instances", "", string(domain.RoleIngeniero))
	rr := httptest.NewRecorder()

	srv.HandleProjectFurnitureInstances(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	body := rr.Body.String()
	if !strings.Contains(body, `"display":{"name":"Gabinete Base 600","dimensions_mm":{"width":600,"height":720,"depth":560}}`) {
		t.Fatalf("list DTO %s missing the display summary", body)
	}
	// A unit without catalog or quoted presentation carries NO display object
	// (never an invented label).
	if strings.Contains(body, `"origin":"manual","lifecycle_status":"active","version":1,"created_at":"","updated_at":"","display"`) {
		t.Fatalf("fi-2 must serialize without a display block: %s", body)
	}
}

// TestHandleProjectFurnitureInstances_CreateExtensionClientSetsOriginDesign (#390 / DT-6):
// when created through the authoring client (SketchUp extension bearer), the
// identity is stamped with origin='design' server-side, never trusting client payload.
func TestHandleProjectFurnitureInstances_CreateExtensionClientSetsOriginDesign(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	req := fiRequest(http.MethodPost, "/api/projects/"+fiTestProjectID+"/furniture-instances",
		`{"furniture_definition_id":"50000000-0000-0000-0000-000000000001"}`, string(domain.RoleAdmin))
	claims := claimsFromRequest(req)
	claims.Client = auth.ExtensionClient
	rr := httptest.NewRecorder()

	srv.HandleProjectFurnitureInstances(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%s)", rr.Code, rr.Body.String())
	}
	if store.createFurnitureInstanceCmd == nil {
		t.Fatal("store must receive the create command")
	}
	cmd := *store.createFurnitureInstanceCmd
	if cmd.ProjectID != fiTestProjectID || cmd.Origin != domain.FurnitureInstanceOriginDesign {
		t.Fatalf("command = %+v, want design origin for extension client", cmd)
	}
	if cmd.FurnitureDefinitionID != "50000000-0000-0000-0000-000000000001" {
		t.Fatalf("definition provenance lost: %+v", cmd)
	}
}

func TestHandleFurnitureInstanceDuplicate_HappyPath(t *testing.T) {
	sourceID := "60000000-0000-0000-0000-000000000001"
	store := &stubStore{
		furnitureInstancesByID: map[string]domain.FurnitureInstance{
			sourceID: {
				ID:                    sourceID,
				ProjectID:             fiTestProjectID,
				FurnitureDefinitionID: "50000000-0000-0000-0000-000000000001",
				Origin:                domain.FurnitureInstanceOriginDesign,
				LifecycleStatus:       domain.FurnitureInstanceLifecycleActive,
				Version:               1,
			},
		},
	}
	srv := &Server{Store: store}
	router := projectFurnitureInstanceCommandRouter(map[string]http.Handler{
		"duplicate": http.HandlerFunc(srv.HandleFurnitureInstanceDuplicate),
	})

	req := fiRequest(http.MethodPost, "/api/projects/"+fiTestProjectID+"/furniture-instances/"+sourceID+":duplicate", "", string(domain.RoleAdmin))
	req.SetPathValue("projectId", fiTestProjectID)
	req.SetPathValue("instanceCommand", sourceID+":duplicate")
	rr := httptest.NewRecorder()

	router.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%s)", rr.Code, rr.Body.String())
	}
	if rr.Header().Get("ETag") == "" {
		t.Fatal("response must set ETag")
	}
	if store.duplicateFurnitureInstanceCmd == nil {
		t.Fatal("store must receive duplicate command")
	}
	cmd := *store.duplicateFurnitureInstanceCmd
	if cmd.ProjectID != fiTestProjectID || cmd.SourceFurnitureInstanceID != sourceID {
		t.Fatalf("command mismatch: %+v", cmd)
	}

	var dto openapi.FurnitureInstance
	if err := json.Unmarshal(rr.Body.Bytes(), &dto); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if dto.ID != "fi-dup-1" || dto.ProjectID != fiTestProjectID {
		t.Fatalf("dto mismatch: %+v", dto)
	}
	if dto.Origin != openapi.FurnitureInstanceOriginDuplicate {
		t.Fatalf("origin = %s, want duplicate", dto.Origin)
	}
	if dto.OriginFurnitureInstanceID == nil || *dto.OriginFurnitureInstanceID != sourceID {
		t.Fatalf("originFurnitureInstanceId = %v, want %s", dto.OriginFurnitureInstanceID, sourceID)
	}
	if dto.FurnitureDefinitionID == nil || *dto.FurnitureDefinitionID != "50000000-0000-0000-0000-000000000001" {
		t.Fatalf("definition = %v, want source definition", dto.FurnitureDefinitionID)
	}
}

func TestHandleFurnitureInstanceDuplicate_Idempotency(t *testing.T) {
	backend := newDurableBackend(func() time.Time { return time.Now().UTC() })
	store := &durableTestStore{backend: backend}
	sourceID := "60000000-0000-0000-0000-000000000001"
	store.furnitureInstancesByID = map[string]domain.FurnitureInstance{
		sourceID: {
			ID:                    sourceID,
			ProjectID:             fiTestProjectID,
			FurnitureDefinitionID: "50000000-0000-0000-0000-000000000001",
			Origin:                domain.FurnitureInstanceOriginDesign,
			LifecycleStatus:       domain.FurnitureInstanceLifecycleActive,
			Version:               1,
		},
	}

	srv := &Server{Store: store}
	handler := srv.RequireIdempotency("project.duplicate-furniture-instance", projectFurnitureInstanceCommandRouter(map[string]http.Handler{
		"duplicate": http.HandlerFunc(srv.HandleFurnitureInstanceDuplicate),
	}))

	// First attempt
	req1 := fiRequest(http.MethodPost, "/api/projects/"+fiTestProjectID+"/furniture-instances/"+sourceID+":duplicate", "", string(domain.RoleAdmin))
	req1.SetPathValue("projectId", fiTestProjectID)
	req1.SetPathValue("instanceCommand", sourceID+":duplicate")
	req1.Header.Set("Idempotency-Key", "dup-intent-key-12345")
	rr1 := httptest.NewRecorder()
	handler.ServeHTTP(rr1, req1)

	if rr1.Code != http.StatusCreated {
		t.Fatalf("first attempt status = %d, want 201 (body=%s)", rr1.Code, rr1.Body.String())
	}
	if store.duplicateFurnitureInstanceCalls != 1 {
		t.Fatalf("expected 1 call to store, got %d", store.duplicateFurnitureInstanceCalls)
	}

	// Second attempt with exact same key (replay)
	req2 := fiRequest(http.MethodPost, "/api/projects/"+fiTestProjectID+"/furniture-instances/"+sourceID+":duplicate", "", string(domain.RoleAdmin))
	req2.SetPathValue("projectId", fiTestProjectID)
	req2.SetPathValue("instanceCommand", sourceID+":duplicate")
	req2.Header.Set("Idempotency-Key", "dup-intent-key-12345")
	rr2 := httptest.NewRecorder()
	handler.ServeHTTP(rr2, req2)

	if rr2.Code != http.StatusCreated {
		t.Fatalf("second attempt status = %d, want 201 (body=%s)", rr2.Code, rr2.Body.String())
	}
	if rr2.Header().Get("Idempotency-Replayed") != "true" {
		t.Fatal("second attempt must be marked as Idempotency-Replayed")
	}
	if store.duplicateFurnitureInstanceCalls != 1 {
		t.Fatalf("idempotent replay must NOT call store again, got %d calls", store.duplicateFurnitureInstanceCalls)
	}
	if rr1.Body.String() != rr2.Body.String() {
		t.Fatalf("replayed body mismatch: first=%s, second=%s", rr1.Body.String(), rr2.Body.String())
	}
}

func TestHandleFurnitureInstanceDuplicate_RoleGuard(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	sourceID := "60000000-0000-0000-0000-000000000001"
	req := fiRequest(http.MethodPost, "/api/projects/"+fiTestProjectID+"/furniture-instances/"+sourceID+":duplicate", "", string(domain.RoleProduccion))
	req.SetPathValue("projectId", fiTestProjectID)
	req.SetPathValue("instanceId", sourceID)
	rr := httptest.NewRecorder()

	srv.HandleFurnitureInstanceDuplicate(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403 (body=%s)", rr.Code, rr.Body.String())
	}
	if store.duplicateFurnitureInstanceCmd != nil {
		t.Fatal("produccion role must not duplicate furniture instances")
	}
}

func TestHandleFurnitureInstanceDuplicate_InvalidUUID(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}

	// Invalid projectId
	req1 := fiRequest(http.MethodPost, "/api/projects/not-a-uuid/furniture-instances/60000000-0000-0000-0000-000000000001:duplicate", "", string(domain.RoleAdmin))
	req1.SetPathValue("projectId", "not-a-uuid")
	req1.SetPathValue("instanceId", "60000000-0000-0000-0000-000000000001")
	rr1 := httptest.NewRecorder()
	srv.HandleFurnitureInstanceDuplicate(rr1, req1)
	if rr1.Code != http.StatusBadRequest {
		t.Fatalf("invalid projectId status = %d, want 400", rr1.Code)
	}

	// Invalid instanceId
	req2 := fiRequest(http.MethodPost, "/api/projects/"+fiTestProjectID+"/furniture-instances/not-a-uuid:duplicate", "", string(domain.RoleAdmin))
	req2.SetPathValue("projectId", fiTestProjectID)
	req2.SetPathValue("instanceId", "not-a-uuid")
	rr2 := httptest.NewRecorder()
	srv.HandleFurnitureInstanceDuplicate(rr2, req2)
	if rr2.Code != http.StatusBadRequest {
		t.Fatalf("invalid instanceId status = %d, want 400", rr2.Code)
	}
}

func TestHandleFurnitureInstanceDuplicate_Errors(t *testing.T) {
	sourceID := "60000000-0000-0000-0000-000000000001"
	cases := []struct {
		name string
		err  error
		code int
	}{
		{"not found", storage.ErrFurnitureInstanceNotFound, http.StatusNotFound},
		{"terminal conflict", domain.ErrFurnitureInstanceLifecycleConflict, http.StatusConflict},
		{"not writable", domain.ErrFurnitureInstanceProjectNotWritable, http.StatusForbidden},
		{"invalid command", domain.ErrInvalidFurnitureInstanceCommand, http.StatusBadRequest},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := &Server{Store: &stubStore{duplicateFurnitureInstanceErr: tc.err}}
			req := fiRequest(http.MethodPost, "/api/projects/"+fiTestProjectID+"/furniture-instances/"+sourceID+":duplicate", "", string(domain.RoleAdmin))
			req.SetPathValue("projectId", fiTestProjectID)
			req.SetPathValue("instanceId", sourceID)
			rr := httptest.NewRecorder()

			srv.HandleFurnitureInstanceDuplicate(rr, req)

			if rr.Code != tc.code {
				t.Fatalf("status = %d, want %d (body=%s)", rr.Code, tc.code, rr.Body.String())
			}
		})
	}
}
