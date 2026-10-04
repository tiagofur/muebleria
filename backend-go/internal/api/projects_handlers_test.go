package api

import (
	"encoding/json"
	"errors"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// Contrato: tests de proyectos — creación (dup-key, cliente inline #712),
// update inline idempotente, RBAC de borrado/owner, ciclo F036 y F108.
func TestHandleProjectsDuplicateKeyReturns409(t *testing.T) {
	srv := &Server{Store: &stubStore{createProjectErr: dupErr("error creating project")}}
	body := strings.NewReader(`{"id":"77777777-8888-9999-0000-111111111111","name":"Dup","customer_id":"10000000-0000-0000-0000-000000000001","currency":"UYU","margin_factor":1.35,"labor_fixed_cost":0}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/projects", body), "v1", string(domain.RoleVendedor))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleProjects(rr, req)

	if rr.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusConflict, rr.Body.String())
	}
	if msg := errorBody(t, rr); !strings.Contains(msg, "ya existe") {
		t.Errorf("error message = %q, want it to mention 'ya existe'", msg)
	}
}

// TestHandleProjectsCreateEchoesClientId guards the core fix: the project id
// the client sent must survive the round-trip so subsequent calls (calculate,
// update) hit the same row. Regression for the phantom-project bug where the
// DB generated its own id and the FE kept the one it minted.
func TestHandleProjectsCreateEchoesClientId(t *testing.T) {
	srv := &Server{Store: &stubStore{createProjectErr: nil}}
	const sentID = "88888888-9999-0000-1111-222222222222"
	body := strings.NewReader(`{"id":"` + sentID + `","name":"Nuevo","customer_id":"10000000-0000-0000-0000-000000000001","currency":"UYU","margin_factor":1.35,"labor_fixed_cost":0}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/projects", body), "v1", string(domain.RoleVendedor))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleProjects(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusCreated, rr.Body.String())
	}
	var got domain.Project
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if got.ID != sentID {
		t.Errorf("project id echoed = %q, want the client-sent id %q (regression: DB must not mint its own)", got.ID, sentID)
	}
	if got.Status != domain.StatusDraft {
		t.Errorf("status = %q, want %q", got.Status, domain.StatusDraft)
	}
}

// #712 — the inline "nuevo cliente" create command on POST /projects.
func TestHandleProjectsCreateWithInlineCustomer(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	body := strings.NewReader(`{"id":"88888888-9999-0000-1111-222222222222","name":"Cocina Ana","customer_id":"","inline_customer_name":"  Ana López  ","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"items":[]}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/projects", body), "v1", string(domain.RoleVendedor))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleProjects(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusCreated, rr.Body.String())
	}
	var got struct {
		domain.Project
		InlineCustomer *domain.Customer `json:"inline_customer"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	const stubMintedID = "70000000-0000-0000-0000-000000000712"
	if got.CustomerID != stubMintedID {
		t.Fatalf("project.customer_id = %q, want the server-minted id %q", got.CustomerID, stubMintedID)
	}
	if got.InlineCustomer == nil {
		t.Fatal("response must include the created inline_customer for local reconciliation")
	}
	if got.InlineCustomer.ID != stubMintedID {
		t.Fatalf("inline_customer.id = %q, want %q", got.InlineCustomer.ID, stubMintedID)
	}
	// The name is trimmed at the command boundary — same rule every UI sends.
	if got.InlineCustomer.Name != "Ana López" {
		t.Fatalf("inline_customer.name = %q, want the trimmed name", got.InlineCustomer.Name)
	}
	if !got.InlineCustomer.Active {
		t.Fatal("inline customer must be created active")
	}
}

func TestHandleProjectsCreateInlinePlusExistingCustomerReturns400(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	body := strings.NewReader(`{"name":"X","customer_id":"10000000-0000-0000-0000-000000000001","inline_customer_name":"Ana López","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"items":[]}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/projects", body), "v1", string(domain.RoleVendedor))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleProjects(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body=%s)", rr.Code, rr.Body.String())
	}
	if msg := errorBody(t, rr); !strings.Contains(msg, "no ambos") {
		t.Errorf("error message = %q, want it to reject the ambiguous intent", msg)
	}
}

func TestHandleProjectsCreateInlineWhitespaceNameReturns400(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	body := strings.NewReader(`{"name":"X","customer_id":"","inline_customer_name":"   ","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"items":[]}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/projects", body), "v1", string(domain.RoleVendedor))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleProjects(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body=%s)", rr.Code, rr.Body.String())
	}
	if msg := errorBody(t, rr); !strings.Contains(msg, "cliente") {
		t.Errorf("error message = %q, want it to mention the cliente", msg)
	}
}

func TestHandleProjectsCreateInlineStillValidatesItems(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	body := strings.NewReader(`{"name":"X","customer_id":"","inline_customer_name":"Ana López","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"items":[{"id":"i1","module_id":"no-un-uuid","quantity":1,"option_choices":{}}]}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/projects", body), "v1", string(domain.RoleVendedor))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleProjects(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body=%s)", rr.Code, rr.Body.String())
	}
	if msg := errorBody(t, rr); !strings.Contains(msg, "mueble") {
		t.Errorf("error message = %q, want item validation to keep applying", msg)
	}
}

// The invisible-customer storage guard surfaces as the neutral 404 — the same
// verdict for missing and other-tenant ids, never a cross-org oracle (#712 §8).
func TestHandleProjectsCreateInvisibleCustomerReturns404Neutral(t *testing.T) {
	srv := &Server{Store: &stubStore{createProjectErr: storage.ErrCustomerNotFound}}
	body := strings.NewReader(`{"name":"X","customer_id":"10000000-0000-0000-0000-0000000009ff","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"items":[]}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/projects", body), "v1", string(domain.RoleVendedor))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleProjects(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (body=%s)", rr.Code, rr.Body.String())
	}
	if msg := errorBody(t, rr); strings.Contains(msg, "otra organización") || strings.Contains(msg, "tenant") {
		t.Errorf("error message = %q, must stay neutral about other tenants", msg)
	}
}

func TestHandleProjectsCreateWithInlineDuplicateProjectReturns409(t *testing.T) {
	srv := &Server{Store: &stubStore{createProjectWithInlineErr: dupErr("error creating project")}}
	body := strings.NewReader(`{"id":"77777777-8888-9999-0000-111111111111","name":"Dup","customer_id":"","inline_customer_name":"Ana López","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"items":[]}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/projects", body), "v1", string(domain.RoleVendedor))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleProjects(rr, req)

	if rr.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 (body=%s)", rr.Code, rr.Body.String())
	}
}

// #714 — the inline "nuevo cliente" update command on PUT /projects/{id}.
const inlineUpdateProjectPath = "/api/projects/88888888-9999-0000-1111-222222222222"

func inlineUpdateRequest(body, idempotencyKey string) *http.Request {
	req := withClaims(httptest.NewRequest(http.MethodPut, inlineUpdateProjectPath, strings.NewReader(body)), "v1", string(domain.RoleVendedor))
	req.SetPathValue("id", "88888888-9999-0000-1111-222222222222")
	req.Header.Set("Content-Type", "application/json")
	if idempotencyKey != "" {
		req.Header.Set("Idempotency-Key", idempotencyKey)
	}
	return req
}

func serveInlineUpdate(srv *Server, rr http.ResponseWriter, req *http.Request) {
	srv.requireProjectInlineUpdateIdempotency(http.HandlerFunc(srv.HandleProjectByID)).ServeHTTP(rr, req)
}

func seedInlineUpdateStore(extra *stubStore) *stubStore {
	base := &domain.Project{
		ID: "88888888-9999-0000-1111-222222222222", Name: "Cocina base",
		CustomerID:  "10000000-0000-0000-0000-000000000001",
		OwnerUserID: "v1", Status: domain.StatusDraft, Items: []domain.ProjectItem{},
		UpdatedAt: time.Date(2026, 9, 13, 22, 0, 0, 0, time.UTC),
	}
	if extra == nil {
		extra = &stubStore{}
	}
	extra.projectReturnedByID = base
	return extra
}

const inlineUpdateBody = `{"id":"88888888-9999-0000-1111-222222222222","name":"Cocina editada","customer_id":"","inline_customer_name":"  Ana López  ","inline_customer_replaces":"10000000-0000-0000-0000-000000000001","expected_project_updated_at":"2026-09-13T22:00:00Z","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"status":"draft","items":[]}`

func TestHandleProjectByIDUpdateWithInlineCustomer(t *testing.T) {
	const stubMintedID = "70000000-0000-0000-0000-000000000714"
	// The read-back deliberately differs from the client payload: the server
	// resolved timestamps the caller never sent (#716 lesson — the response is
	// the authority, never a local reconstruction).
	readback := &domain.Project{
		ID: "88888888-9999-0000-1111-222222222222", Name: "Cocina editada",
		CustomerID: stubMintedID, OwnerUserID: "v1", Status: domain.StatusDraft,
		Items: []domain.ProjectItem{}, UpdatedAt: time.Date(2026, 9, 13, 23, 0, 0, 0, time.UTC),
	}
	store := seedInlineUpdateStore(&stubStore{projectReadbackAfterUpdate: readback})
	srv := &Server{Store: store}
	rr := httptest.NewRecorder()

	serveInlineUpdate(srv, rr, inlineUpdateRequest(inlineUpdateBody, "key-714-aaaaaaaaaaaa"))

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusOK, rr.Body.String())
	}
	var got struct {
		domain.Project
		InlineCustomer *domain.Customer `json:"inline_customer"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if got.CustomerID != stubMintedID {
		t.Fatalf("project.customer_id = %q, want the server-minted id %q", got.CustomerID, stubMintedID)
	}
	if !got.UpdatedAt.Equal(readback.UpdatedAt) {
		t.Fatalf("updated_at = %v, want the authoritative read-back %v", got.UpdatedAt, readback.UpdatedAt)
	}
	if got.InlineCustomer == nil || got.InlineCustomer.ID != stubMintedID || got.InlineCustomer.Name != "Ana López" || !got.InlineCustomer.Active {
		t.Fatalf("inline_customer = %+v, want the active trimmed 'Ana López' with the minted id", got.InlineCustomer)
	}
	if store.updateProjectWithInlineCalls != 1 {
		t.Fatalf("inline transition calls = %d, want exactly 1", store.updateProjectWithInlineCalls)
	}
	if store.updateProjectWithInlineBase != "10000000-0000-0000-0000-000000000001" {
		t.Fatalf("base = %q, want the caller's base view of the customer assignment", store.updateProjectWithInlineBase)
	}
	if want := time.Date(2026, 9, 13, 22, 0, 0, 0, time.UTC); !store.updateProjectWithInlineExpectedUpdatedAt.Equal(want) {
		t.Fatalf("expected updated_at = %v, want %v", store.updateProjectWithInlineExpectedUpdatedAt, want)
	}
	if store.lastUpdatedProject != nil && store.lastUpdatedProject.CustomerID != stubMintedID {
		t.Fatalf("stored project customer = %q, want the minted id", store.lastUpdatedProject.CustomerID)
	}
}

func TestHandleProjectByIDUpdateInlinePlusExistingCustomerReturns400(t *testing.T) {
	srv := &Server{Store: seedInlineUpdateStore(nil)}
	body := `{"id":"88888888-9999-0000-1111-222222222222","name":"X","customer_id":"10000000-0000-0000-0000-000000000001","inline_customer_name":"Ana López","inline_customer_replaces":"10000000-0000-0000-0000-000000000001","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"status":"draft","items":[]}`
	rr := httptest.NewRecorder()

	serveInlineUpdate(srv, rr, inlineUpdateRequest(body, "key-714-bbbbbbbbbbbb"))

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body=%s)", rr.Code, rr.Body.String())
	}
	if msg := errorBody(t, rr); !strings.Contains(msg, "no ambos") {
		t.Errorf("error message = %q, want it to reject the ambiguous intent", msg)
	}
}

func TestHandleProjectByIDUpdateInlineWithoutBaseReturns400(t *testing.T) {
	srv := &Server{Store: seedInlineUpdateStore(nil)}
	body := `{"id":"88888888-9999-0000-1111-222222222222","name":"X","customer_id":"","inline_customer_name":"Ana López","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"status":"draft","items":[]}`
	rr := httptest.NewRecorder()

	serveInlineUpdate(srv, rr, inlineUpdateRequest(body, "key-714-cccccccccccc"))

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body=%s)", rr.Code, rr.Body.String())
	}
	if msg := errorBody(t, rr); !strings.Contains(msg, "cliente actual") {
		t.Errorf("error message = %q, want it to demand the base customer view", msg)
	}
}

func TestHandleProjectByIDUpdateInlineWithoutProjectVersionReturns400(t *testing.T) {
	srv := &Server{Store: seedInlineUpdateStore(nil)}
	body := `{"id":"88888888-9999-0000-1111-222222222222","name":"X","customer_id":"","inline_customer_name":"Ana López","inline_customer_replaces":"10000000-0000-0000-0000-000000000001","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"status":"draft","items":[]}`
	rr := httptest.NewRecorder()

	serveInlineUpdate(srv, rr, inlineUpdateRequest(body, "key-714-version-missing"))

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body=%s)", rr.Code, rr.Body.String())
	}
	if msg := errorBody(t, rr); !strings.Contains(msg, "versión") {
		t.Errorf("error message = %q, want it to demand the project version", msg)
	}
	if srv.Store.(*stubStore).updateProjectWithInlineCalls != 0 {
		t.Fatal("missing concurrency evidence must fail before the transition")
	}
}

// The inline capability rides the durable idempotency receipts: a missing or
// malformed key is rejected before anything persists.
func TestHandleProjectByIDUpdateInlineWithoutIdempotencyKeyReturns400(t *testing.T) {
	srv := &Server{Store: seedInlineUpdateStore(nil)}
	rr := httptest.NewRecorder()

	serveInlineUpdate(srv, rr, inlineUpdateRequest(inlineUpdateBody, ""))

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body=%s)", rr.Code, rr.Body.String())
	}
	if srv.Store.(*stubStore).updateProjectWithInlineCalls != 0 {
		t.Fatal("nothing may persist when the idempotency key is missing")
	}
}

// Proof G at the HTTP boundary: the same intention replayed with the same key
// returns the EXACT committed response — no second customer, no re-execution.
func TestHandleProjectByIDUpdateInlineReplayReturnsSameResponse(t *testing.T) {
	store := seedInlineUpdateStore(nil)
	srv := &Server{Store: store}
	first := httptest.NewRecorder()
	second := httptest.NewRecorder()

	serveInlineUpdate(srv, first, inlineUpdateRequest(inlineUpdateBody, "key-714-dddddddddddd"))
	serveInlineUpdate(srv, second, inlineUpdateRequest(inlineUpdateBody, "key-714-dddddddddddd"))

	if first.Code != http.StatusOK || second.Code != http.StatusOK {
		t.Fatalf("status first=%d second=%d, want 200/200", first.Code, second.Code)
	}
	if second.Header().Get("Idempotency-Replayed") != "true" {
		t.Fatalf("replay header = %q, want 'true'", second.Header().Get("Idempotency-Replayed"))
	}
	if first.Body.String() != second.Body.String() {
		t.Fatalf("replayed body differs:\nfirst=%s\nsecond=%s", first.Body.String(), second.Body.String())
	}
	if store.updateProjectWithInlineCalls != 1 {
		t.Fatalf("transition executions = %d, want 1 (the replay is served from the receipt)", store.updateProjectWithInlineCalls)
	}
}

// Key reuse with a different payload is an explicit conflict — never a silent
// second execution under someone else's key.
func TestHandleProjectByIDUpdateInlineKeyReuseWithOtherPayloadReturns409(t *testing.T) {
	srv := &Server{Store: seedInlineUpdateStore(nil)}
	other := `{"id":"88888888-9999-0000-1111-222222222222","name":"Otro nombre","customer_id":"","inline_customer_name":"Ana López","inline_customer_replaces":"10000000-0000-0000-0000-000000000001","expected_project_updated_at":"2026-09-13T22:00:00Z","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"status":"draft","items":[]}`
	first := httptest.NewRecorder()
	second := httptest.NewRecorder()

	serveInlineUpdate(srv, first, inlineUpdateRequest(inlineUpdateBody, "key-714-eeeeeeeeeeee"))
	serveInlineUpdate(srv, second, inlineUpdateRequest(other, "key-714-eeeeeeeeeeee"))

	if second.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 (body=%s)", second.Code, second.Body.String())
	}
}

// Proof H mapping: the storage's explicit concurrency error surfaces as an
// honest 409, never as a 500 or a silent overwrite.
func TestHandleProjectByIDUpdateInlineConcurrentConflictReturns409(t *testing.T) {
	store := seedInlineUpdateStore(&stubStore{updateProjectWithInlineErr: storage.ErrProjectConcurrentUpdate})
	srv := &Server{Store: store}
	rr := httptest.NewRecorder()

	serveInlineUpdate(srv, rr, inlineUpdateRequest(inlineUpdateBody, "key-714-ffffffffffff"))

	if rr.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 (body=%s)", rr.Code, rr.Body.String())
	}
	if msg := errorBody(t, rr); !strings.Contains(msg, "cambió") {
		t.Errorf("error message = %q, want the honest concurrent-update message", msg)
	}
}

// Proof J: the inline capability cannot bypass the commercial lifecycle — a
// non-draft project is rejected with an explicit conflict.
func TestHandleProjectByIDUpdateInlineClosedProjectReturns409(t *testing.T) {
	store := seedInlineUpdateStore(nil)
	store.projectReturnedByID.Status = domain.StatusQuoted
	srv := &Server{Store: store}
	rr := httptest.NewRecorder()

	serveInlineUpdate(srv, rr, inlineUpdateRequest(inlineUpdateBody, "key-714-gggggggggggg"))

	if rr.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409 (body=%s)", rr.Code, rr.Body.String())
	}
	if store.updateProjectWithInlineCalls != 0 {
		t.Fatal("a closed project must never reach the inline transition")
	}
}

// The inline transition writes BOTH entities, so a caller without the
// customer-mutation capability is refused even though it may edit projects.
func TestHandleProjectByIDUpdateInlineWithoutCustomerPermissionReturns403(t *testing.T) {
	store := seedInlineUpdateStore(nil)
	srv := &Server{Store: store}
	req := withClaims(httptest.NewRequest(http.MethodPut, inlineUpdateProjectPath, strings.NewReader(inlineUpdateBody)), "prod-1", string(domain.RoleProduccion))
	req.SetPathValue("id", "88888888-9999-0000-1111-222222222222")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotency-Key", "key-714-hhhhhhhhhhhh")
	rr := httptest.NewRecorder()

	serveInlineUpdate(srv, rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusForbidden, rr.Body.String())
	}
	if store.updateProjectWithInlineCalls != 0 {
		t.Fatal("production-only roles must never run the inline transition")
	}
}

// Regression (proof D): legacy PUTs — no inline fields, no idempotency key —
// keep the exact previous contract: plain UpdateProject, flat project echo.
func TestHandleProjectByIDUpdateLegacyPutUnchanged(t *testing.T) {
	store := seedInlineUpdateStore(nil)
	srv := &Server{Store: store}
	body := `{"id":"88888888-9999-0000-1111-222222222222","name":"Edición normal","customer_id":"10000000-0000-0000-0000-000000000001","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"status":"draft","items":[]}`
	req := withClaims(httptest.NewRequest(http.MethodPut, inlineUpdateProjectPath, strings.NewReader(body)), "v1", string(domain.RoleVendedor))
	req.SetPathValue("id", "88888888-9999-0000-1111-222222222222")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleProjectByID(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rr.Code, rr.Body.String())
	}
	if store.updateProjectWithInlineCalls != 0 {
		t.Fatal("legacy PUT must never touch the inline transition")
	}
	if store.lastUpdatedProject == nil {
		t.Fatal("legacy PUT must go through UpdateProject")
	}
	var got domain.Project
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if got.CustomerID != "10000000-0000-0000-0000-000000000001" {
		t.Fatalf("customer_id = %q, want the selected existing customer", got.CustomerID)
	}
}

// TestHandleProjectByIDUpdateNotFoundReturns404 ensures PUT on a missing project
// returns 404 so APIWorkspaceRepository.upsert falls through to POST create.
// Regression: UpdateProject used to return nil when RowsAffected==0, upsert
// treated it as success, and POST /calculate 404'd on a phantom FE-only id.
func TestHandleProjectByIDUpdateNotFoundReturns404(t *testing.T) {
	srv := &Server{Store: &stubStore{projectGetByIDErr: errors.New("no rows in result set")}}
	body := strings.NewReader(`{"id":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee","name":"Ghost","customer_id":"10000000-0000-0000-0000-000000000001","currency":"UYU","margin_factor":1.35,"labor_fixed_cost":0,"items":[]}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/projects/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", body), "admin", string(domain.RoleAdmin))
	req.SetPathValue("id", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleProjectByID(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusNotFound, rr.Body.String())
	}
	if msg := errorBody(t, rr); !strings.Contains(msg, "not found") {
		t.Errorf("error message = %q, want it to mention 'not found'", msg)
	}
}

// Pre-demo audit P1-5: PUT with empty-string uuid fields (e.g. the minimal
// {"status":"accepted"} payload or a round-trip with unset optionals) used to
// reach SQL as "" on NOT NULL uuid columns and surface as 500 22P02
// "error interno del servidor". It must be a 400 that names the field.
func TestHandleProjectByIDUpdateEmptyCustomerReturns400(t *testing.T) {
	srv := &Server{Store: &stubStore{projectReturnedByID: &domain.Project{
		ID: "p1", Name: "P", CustomerID: "c1", OwnerUserID: "u1", Status: domain.StatusDraft,
	}}}
	body := strings.NewReader(`{"id":"p1","name":"P","customer_id":"","currency":"UYU","margin_factor":1.35,"labor_fixed_cost":0,"items":[]}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/projects/p1", body), "admin", string(domain.RoleAdmin))
	req.SetPathValue("id", "p1")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleProjectByID(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusBadRequest, rr.Body.String())
	}
	if msg := errorBody(t, rr); !strings.Contains(msg, "cliente") {
		t.Errorf("error message = %q, want it to mention 'cliente'", msg)
	}
}

func TestHandleProjectByIDUpdateEmptyModuleIDReturns400(t *testing.T) {
	srv := &Server{Store: &stubStore{projectReturnedByID: &domain.Project{
		ID: "p1", Name: "P", CustomerID: "c1", OwnerUserID: "u1", Status: domain.StatusDraft,
	}}}
	body := strings.NewReader(`{"id":"p1","name":"P","customer_id":"10000000-0000-0000-0000-000000000001","currency":"UYU","margin_factor":1.35,"labor_fixed_cost":0,"items":[{"id":"i1","module_id":"","quantity":1,"option_choices":{"FRENTE":""}}]}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/projects/p1", body), "admin", string(domain.RoleAdmin))
	req.SetPathValue("id", "p1")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleProjectByID(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusBadRequest, rr.Body.String())
	}
	if msg := errorBody(t, rr); !strings.Contains(msg, "mueble") {
		t.Errorf("error message = %q, want it to mention 'mueble'", msg)
	}
}

func TestHandleProjectsCreateEmptyCustomerReturns400(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	body := strings.NewReader(`{"name":"X","customer_id":"","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"items":[]}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/projects", body), "admin", string(domain.RoleAdmin))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleProjects(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusBadRequest, rr.Body.String())
	}
	if msg := errorBody(t, rr); !strings.Contains(msg, "cliente") {
		t.Errorf("error message = %q, want it to mention 'cliente'", msg)
	}
}

func TestHandleProjectByIDUpdateMalformedRequiredUUIDsReturn400(t *testing.T) {
	const validCustomer = "10000000-0000-0000-0000-000000000001"
	const validModule = "20000000-0000-0000-0000-000000000001"
	const validChoice = "30000000-0000-0000-0000-000000000001"
	tests := []struct {
		name string
		body string
		want string
	}{
		{
			name: "customer",
			body: `{"id":"p1","name":"P","customer_id":"not-a-uuid","currency":"UYU","margin_factor":1.35,"labor_fixed_cost":0,"items":[]}`,
			want: "cliente",
		},
		{
			name: "module",
			body: `{"id":"p1","name":"P","customer_id":"` + validCustomer + `","currency":"UYU","margin_factor":1.35,"labor_fixed_cost":0,"items":[{"id":"i1","module_id":"bad-module","quantity":1,"option_choices":{}}]}`,
			want: "mueble",
		},
		{
			name: "item choice",
			body: `{"id":"p1","name":"P","customer_id":"` + validCustomer + `","currency":"UYU","margin_factor":1.35,"labor_fixed_cost":0,"items":[{"id":"i1","module_id":"` + validModule + `","quantity":1,"option_choices":{"FRENTE":"bad-choice"}}]}`,
			want: "opción inválida",
		},
		{
			name: "project choice",
			body: `{"id":"p1","name":"P","customer_id":"` + validCustomer + `","currency":"UYU","margin_factor":1.35,"labor_fixed_cost":0,"project_level_choices":{"FRENTE":"bad-choice"},"items":[{"id":"i1","module_id":"` + validModule + `","quantity":1,"option_choices":{"FRENTE":"` + validChoice + `"}}]}`,
			want: "opción global inválida",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv := &Server{Store: &stubStore{projectReturnedByID: &domain.Project{
				ID: "p1", Name: "P", CustomerID: validCustomer, OwnerUserID: "u1", Status: domain.StatusDraft,
			}}}
			req := withClaims(httptest.NewRequest(http.MethodPut, "/api/projects/p1", strings.NewReader(tt.body)), "admin", string(domain.RoleAdmin))
			req.SetPathValue("id", "p1")
			req.Header.Set("Content-Type", "application/json")
			rr := httptest.NewRecorder()

			srv.HandleProjectByID(rr, req)

			if rr.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusBadRequest, rr.Body.String())
			}
			if msg := errorBody(t, rr); !strings.Contains(msg, tt.want) {
				t.Errorf("error message = %q, want it to mention %q", msg, tt.want)
			}
		})
	}
}
func TestRBAC_VendedorCannotDeleteProject(t *testing.T) {
	store := &stubStore{
		projectReturnedByID: &domain.Project{
			ID: "p1", Name: "P", CustomerID: "c1", OwnerUserID: "v1",
			Currency: "MXN", MarginFactor: 1.35, Status: domain.StatusDraft,
		},
	}
	srv := &Server{Store: store}
	req := withClaims(httptest.NewRequest(http.MethodDelete, "/api/projects/p1", nil), "v1", string(domain.RoleVendedor))
	req.SetPathValue("id", "p1")
	rr := httptest.NewRecorder()
	srv.HandleProjectByID(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("status %d want 403 body=%s", rr.Code, rr.Body.String())
	}
	if store.deleteProjectCalled {
		t.Fatal("delete must not run for vendedor")
	}
}

func TestRBAC_GerenteCanDeleteProject(t *testing.T) {
	store := &stubStore{
		projectReturnedByID: &domain.Project{
			ID: "p1", Name: "P", CustomerID: "c1", OwnerUserID: "v1",
			Currency: "MXN", MarginFactor: 1.35, Status: domain.StatusDraft,
		},
	}
	srv := &Server{Store: store}
	req := withClaims(httptest.NewRequest(http.MethodDelete, "/api/projects/p1", nil), "g1", string(domain.RoleGerenteVentas))
	req.SetPathValue("id", "p1")
	rr := httptest.NewRecorder()
	srv.HandleProjectByID(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d want 200 body=%s", rr.Code, rr.Body.String())
	}
	if !store.deleteProjectCalled {
		t.Fatal("gerente delete should run")
	}
}
func TestRBAC_GerenteCanAssignOwnerOnCreate(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"44444444-5555-6666-7777-888888888888","name":"Asignado","active":true,"owner_user_id":"v2"}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/customers", body), "g1", string(domain.RoleGerenteVentas))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleCustomers(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("status %d body %s", rr.Code, rr.Body.String())
	}
	if store.lastCreatedCustomer == nil || store.lastCreatedCustomer.OwnerUserID != "v2" {
		t.Fatalf("gerente assign: %#v", store.lastCreatedCustomer)
	}
}
func TestF036_VendedorCannotReopenAcceptedProject(t *testing.T) {
	store := &stubStore{
		projectReturnedByID: &domain.Project{
			ID: "p1", Name: "P", CustomerID: "c1", OwnerUserID: "v1",
			Currency: "MXN", MarginFactor: 1.35, Status: domain.StatusAccepted,
		},
	}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"p1","name":"P","customer_id":"10000000-0000-0000-0000-000000000001","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"items":[],"status":"draft","owner_user_id":"v1"}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/projects/p1", body), "v1", string(domain.RoleVendedor))
	req.SetPathValue("id", "p1")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleProjectByID(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("status %d want 403 body=%s", rr.Code, rr.Body.String())
	}
}

func TestF036_VendedorCanReopenQuotedProject(t *testing.T) {
	store := &stubStore{
		projectReturnedByID: &domain.Project{
			ID: "p1", Name: "P", CustomerID: "c1", OwnerUserID: "v1",
			Currency: "MXN", MarginFactor: 1.35, Status: domain.StatusQuoted,
		},
	}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"p1","name":"P","customer_id":"10000000-0000-0000-0000-000000000001","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"items":[],"status":"draft","owner_user_id":"v1"}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/projects/p1", body), "v1", string(domain.RoleVendedor))
	req.SetPathValue("id", "p1")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleProjectByID(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d want 200 body=%s", rr.Code, rr.Body.String())
	}
}

func TestF036_ProduccionCanMarkProduced(t *testing.T) {
	store := &stubStore{
		projectReturnedByID: &domain.Project{
			ID: "p1", Name: "P", CustomerID: "c1", OwnerUserID: "v1",
			Currency: "MXN", MarginFactor: 1.35, Status: domain.StatusAccepted,
		},
	}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"p1","name":"P","customer_id":"10000000-0000-0000-0000-000000000001","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"items":[],"status":"produced","owner_user_id":"v1"}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/projects/p1", body), "prod1", string(domain.RoleProduccion))
	req.SetPathValue("id", "p1")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleProjectByID(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d want 200 body=%s", rr.Code, rr.Body.String())
	}
	var got domain.Project
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Status != domain.StatusProduced {
		t.Fatalf("status = %q want produced", got.Status)
	}
}
func TestF036_VendedorCannotMarkProduced(t *testing.T) {
	store := &stubStore{
		projectReturnedByID: &domain.Project{
			ID: "p1", Name: "P", CustomerID: "c1", OwnerUserID: "v1",
			Currency: "MXN", MarginFactor: 1.35, Status: domain.StatusAccepted,
		},
	}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"p1","name":"P","customer_id":"10000000-0000-0000-0000-000000000001","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"items":[],"status":"produced","owner_user_id":"v1"}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/projects/p1", body), "v1", string(domain.RoleVendedor))
	req.SetPathValue("id", "p1")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleProjectByID(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("status %d want 403 body=%s", rr.Code, rr.Body.String())
	}
}

// --- Issue #19 auth hardening ---
func TestF108_ClosingQuotePinsStructureRevision(t *testing.T) {
	rev := 3
	catalog := &domain.Catalog{
		Modules: []domain.Module{
			{ID: "20000000-0000-0000-0000-000000000001", Code: "MOD-1", Name: "M", StructureID: "st1"},
		},
		Structures: []domain.Structure{
			{ID: "st1", Code: "EST-1", Name: "Cuerpo", Active: true, Revision: rev},
		},
	}
	store := &stubStore{
		projectReturnedByID: &domain.Project{
			ID: "p1", Name: "P", CustomerID: "c1", OwnerUserID: "adm1",
			Currency: "MXN", MarginFactor: 1.35, Status: domain.StatusDraft,
			Items: []domain.ProjectItem{
				{ID: "it1", ModuleID: "20000000-0000-0000-0000-000000000001", Quantity: 1},
			},
		},
		catalogOverride: catalog,
	}
	srv := &Server{Store: store}
	// Move draft → quoted (closed). The item has no incoming pin.
	body := strings.NewReader(`{"id":"p1","name":"P","customer_id":"10000000-0000-0000-0000-000000000001","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"items":[{"id":"it1","module_id":"20000000-0000-0000-0000-000000000001","quantity":1}],"status":"quoted","owner_user_id":"adm1"}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/projects/p1", body), "adm1", string(domain.RoleAdmin))
	req.SetPathValue("id", "p1")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleProjectByID(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d want 200 body=%s", rr.Code, rr.Body.String())
	}
	var got domain.Project
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(got.Items) != 1 {
		t.Fatalf("expected 1 item, got %d", len(got.Items))
	}
	pin := got.Items[0].StructureRevisionPin
	if pin == nil {
		t.Fatalf("expected StructureRevisionPin to be set on close, got nil")
	}
	if *pin != rev {
		t.Fatalf("StructureRevisionPin = %d, want %d (structure's current revision)", *pin, rev)
	}
}

// --- Project templates (#110 / H15) ---
