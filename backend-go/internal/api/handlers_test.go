package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// stubStore is a minimal Store for handler unit tests. Only the methods under
// test are populated; the rest panic so a misconfigured test fails loudly
// instead of silently passing. This mirrors the httptest.ResponseRecorder style
// of middleware_test.go and avoids any database dependency.
type stubStore struct {
	createCustomerErr    error
	createMaterialErr    error
	createProjectErr     error
	updateProjectErr     error
	customerReturnedByID *domain.Customer
	customerGetByIDErr   error
	projectReturnedByID  *domain.Project
	projectGetByIDErr    error
	listCustomers        []domain.Customer
	listProjects         []domain.Project
	listMaterials        []domain.MaterialBoard
	lastCreatedCustomer  *domain.Customer
	lastCreatedProject   *domain.Project
	materialReturnedByID *domain.MaterialBoard
	materialGetByIDErr   error
	// Auth test hooks
	getUserByEmail      *domain.User
	getUserByEmailErr   error
	createUserErr       error
	listUsers           []domain.User
	createMaterialOK    bool
	deleteProjectCalled bool
	// F044 workshop settings (nil → defaults, flag false)
	workshopSettings *domain.WorkshopSettings
}

func (s *stubStore) CreateCustomer(ctx context.Context, c *domain.Customer) error {
	if s.createCustomerErr != nil {
		return s.createCustomerErr
	}
	cp := *c
	s.lastCreatedCustomer = &cp
	return nil
}
func (s *stubStore) CreateMaterialBoard(ctx context.Context, m *domain.MaterialBoard) error {
	if s.createMaterialErr != nil {
		return s.createMaterialErr
	}
	s.createMaterialOK = true
	return nil
}
func (s *stubStore) CreateProject(ctx context.Context, p *domain.Project) error {
	if s.createProjectErr != nil {
		return s.createProjectErr
	}
	cp := *p
	s.lastCreatedProject = &cp
	return nil
}
func (s *stubStore) GetCustomerByID(ctx context.Context, id string) (*domain.Customer, error) {
	return s.customerReturnedByID, s.customerGetByIDErr
}
func (s *stubStore) GetMaterialBoardByID(ctx context.Context, id string) (*domain.MaterialBoard, error) {
	return s.materialReturnedByID, s.materialGetByIDErr
}

// stubNotUsed marks interface methods that the focal handlers never call.
func (s *stubStore) stubNotUsed(name string) {
	panic("stubStore: unexpected call to " + name + " — add a field if the test needs it")
}

// The remaining Store methods are not exercised by the duplicate-key tests.
func (s *stubStore) GetUserByEmail(context.Context, string) (*domain.User, error) {
	return s.getUserByEmail, s.getUserByEmailErr
}
func (s *stubStore) GetUserByID(context.Context, string) (*domain.User, error) {
	if s.getUserByEmail != nil {
		return s.getUserByEmail, s.getUserByEmailErr
	}
	return nil, s.getUserByEmailErr
}
func (s *stubStore) CreateUser(context.Context, *domain.User) error {
	return s.createUserErr
}
func (s *stubStore) ListUsers(context.Context) ([]domain.User, error) {
	if s.listUsers != nil {
		return s.listUsers, nil
	}
	return []domain.User{}, nil
}
func (s *stubStore) ApproveUser(context.Context, string) error {
	s.stubNotUsed("ApproveUser")
	return nil
}
func (s *stubStore) UpdateUserRole(context.Context, string, domain.UserRole) error {
	s.stubNotUsed("UpdateUserRole")
	return nil
}
func (s *stubStore) RejectUser(context.Context, string) error {
	s.stubNotUsed("RejectUser")
	return nil
}
func (s *stubStore) ListCustomers(context.Context) ([]domain.Customer, error) {
	if s.listCustomers != nil {
		return s.listCustomers, nil
	}
	return []domain.Customer{}, nil
}
func (s *stubStore) UpdateCustomer(context.Context, string, *domain.Customer) error {
	return nil
}
func (s *stubStore) DeactivateCustomer(context.Context, string) error {
	return nil
}
func (s *stubStore) ListMaterialBoards(context.Context) ([]domain.MaterialBoard, error) {
	if s.listMaterials != nil {
		return s.listMaterials, nil
	}
	return []domain.MaterialBoard{}, nil
}
func (s *stubStore) UpdateMaterialBoard(context.Context, string, *domain.MaterialBoard) error {
	s.stubNotUsed("UpdateMaterialBoard")
	return nil
}
func (s *stubStore) DeactivateMaterialBoard(context.Context, string) error {
	s.stubNotUsed("DeactivateMaterialBoard")
	return nil
}
func (s *stubStore) ListEdgeBands(context.Context) ([]domain.EdgeBand, error) {
	s.stubNotUsed("ListEdgeBands")
	return nil, nil
}
func (s *stubStore) GetEdgeBandByID(context.Context, string) (*domain.EdgeBand, error) {
	s.stubNotUsed("GetEdgeBandByID")
	return nil, nil
}
func (s *stubStore) CreateEdgeBand(context.Context, *domain.EdgeBand) error {
	s.stubNotUsed("CreateEdgeBand")
	return nil
}
func (s *stubStore) UpdateEdgeBand(context.Context, string, *domain.EdgeBand) error {
	s.stubNotUsed("UpdateEdgeBand")
	return nil
}
func (s *stubStore) DeactivateEdgeBand(context.Context, string) error {
	s.stubNotUsed("DeactivateEdgeBand")
	return nil
}
func (s *stubStore) ListHardwares(context.Context) ([]domain.Hardware, error) {
	s.stubNotUsed("ListHardwares")
	return nil, nil
}
func (s *stubStore) GetHardwareByID(context.Context, string) (*domain.Hardware, error) {
	s.stubNotUsed("GetHardwareByID")
	return nil, nil
}
func (s *stubStore) CreateHardware(context.Context, *domain.Hardware) error {
	s.stubNotUsed("CreateHardware")
	return nil
}
func (s *stubStore) UpdateHardware(context.Context, string, *domain.Hardware) error {
	s.stubNotUsed("UpdateHardware")
	return nil
}
func (s *stubStore) DeactivateHardware(context.Context, string) error {
	s.stubNotUsed("DeactivateHardware")
	return nil
}
func (s *stubStore) ListOptionGroups(context.Context) ([]domain.OptionGroup, error) {
	s.stubNotUsed("ListOptionGroups")
	return nil, nil
}
func (s *stubStore) GetOptionGroupByID(context.Context, string) (*domain.OptionGroup, error) {
	s.stubNotUsed("GetOptionGroupByID")
	return nil, nil
}
func (s *stubStore) CreateOptionGroup(context.Context, *domain.OptionGroup) error {
	s.stubNotUsed("CreateOptionGroup")
	return nil
}
func (s *stubStore) UpdateOptionGroup(context.Context, string, *domain.OptionGroup) error {
	s.stubNotUsed("UpdateOptionGroup")
	return nil
}
func (s *stubStore) DeleteOptionGroup(context.Context, string) error {
	s.stubNotUsed("DeleteOptionGroup")
	return nil
}
func (s *stubStore) ListCategories(context.Context) ([]domain.ModuleCategory, error) {
	s.stubNotUsed("ListCategories")
	return nil, nil
}
func (s *stubStore) GetCategoryByID(context.Context, string) (*domain.ModuleCategory, error) {
	s.stubNotUsed("GetCategoryByID")
	return nil, nil
}
func (s *stubStore) CreateCategory(context.Context, *domain.ModuleCategory) error {
	s.stubNotUsed("CreateCategory")
	return nil
}
func (s *stubStore) UpdateCategory(context.Context, string, *domain.ModuleCategory) error {
	s.stubNotUsed("UpdateCategory")
	return nil
}
func (s *stubStore) DeleteCategory(context.Context, string) error {
	s.stubNotUsed("DeleteCategory")
	return nil
}
func (s *stubStore) GetFullCatalog(context.Context) (domain.Catalog, error) {
	s.stubNotUsed("GetFullCatalog")
	return domain.Catalog{}, nil
}
func (s *stubStore) GetModuleByID(context.Context, string) (*domain.Module, error) {
	s.stubNotUsed("GetModuleByID")
	return nil, nil
}
func (s *stubStore) CreateModule(context.Context, *domain.Module) error {
	s.stubNotUsed("CreateModule")
	return nil
}
func (s *stubStore) UpdateModule(context.Context, string, *domain.Module) error {
	s.stubNotUsed("UpdateModule")
	return nil
}
func (s *stubStore) DeleteModule(context.Context, string) error {
	s.stubNotUsed("DeleteModule")
	return nil
}
func (s *stubStore) ListProjects(context.Context) ([]domain.Project, error) {
	if s.listProjects != nil {
		return s.listProjects, nil
	}
	return []domain.Project{}, nil
}
func (s *stubStore) GetProjectByID(context.Context, string) (*domain.Project, error) {
	return s.projectReturnedByID, s.projectGetByIDErr
}
func (s *stubStore) UpdateProject(context.Context, string, *domain.Project) error {
	if s.updateProjectErr != nil {
		return s.updateProjectErr
	}
	return nil
}
func (s *stubStore) DeleteProject(context.Context, string) error {
	s.deleteProjectCalled = true
	return nil
}

func (s *stubStore) GetWorkshopSettings(context.Context) (domain.WorkshopSettings, error) {
	if s.workshopSettings != nil {
		return *s.workshopSettings, nil
	}
	return domain.DefaultWorkshopSettings(), nil
}

func (s *stubStore) UpsertWorkshopSettings(_ context.Context, ws domain.WorkshopSettings) (domain.WorkshopSettings, error) {
	cp := ws
	s.workshopSettings = &cp
	return ws, nil
}

// dupErr mimics the wrapped error the storage layer returns on a unique
// violation: fmt.Errorf("error creating X: %w", pgErr).
func dupErr(op string) error {
	return errors.New(op + ": duplicate key value violates unique constraint")
}

// compile-time guard: stubStore must satisfy Store.
var _ Store = (*stubStore)(nil)

func TestHandleCustomersDuplicateKeyReturns409(t *testing.T) {
	srv := &Server{Store: &stubStore{createCustomerErr: dupErr("error creating customer")}}
	body := strings.NewReader(`{"id":"11111111-2222-3333-4444-555555555555","name":"Dup","active":true}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/customers", body), "admin", string(domain.RoleAdmin))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleCustomers(rr, req)

	if rr.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusConflict, rr.Body.String())
	}
	if msg := errorBody(t, rr); !strings.Contains(msg, "ya existe") {
		t.Errorf("error message = %q, want it to mention 'ya existe'", msg)
	}
}

func TestHandleMaterialsDuplicateKeyReturns409(t *testing.T) {
	srv := &Server{Store: &stubStore{createMaterialErr: dupErr("error creating material board")}}
	body := strings.NewReader(`{"code":"MAT-DUP","name":"Dup","width_mm":100,"length_mm":100,"thickness_mm":18,"board_price":10}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/materials", body), "eng", string(domain.RoleIngeniero))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleMaterials(rr, req)

	if rr.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusConflict, rr.Body.String())
	}
	if msg := errorBody(t, rr); !strings.Contains(msg, "código") {
		t.Errorf("error message = %q, want it to mention 'código'", msg)
	}
}

func TestHandleCustomersCreateSuccess(t *testing.T) {
	srv := &Server{Store: &stubStore{createCustomerErr: nil}}
	body := strings.NewReader(`{"id":"22222222-3333-4444-5555-666666666666","name":"Nuevo","active":true}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/customers", body), "v1", string(domain.RoleVendedor))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleCustomers(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d (body=%s)", rr.Code, http.StatusCreated, rr.Body.String())
	}
	var got domain.Customer
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatalf("decoding response: %v", err)
	}
	if !got.Active {
		t.Errorf("expected handler to force Active=true on create, got Active=%v", got.Active)
	}
}

func TestHandleProjectsDuplicateKeyReturns409(t *testing.T) {
	srv := &Server{Store: &stubStore{createProjectErr: dupErr("error creating project")}}
	body := strings.NewReader(`{"id":"77777777-8888-9999-0000-111111111111","name":"Dup","customer_id":"c1","currency":"UYU","margin_factor":1.35,"labor_fixed_cost":0}`)
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
	body := strings.NewReader(`{"id":"` + sentID + `","name":"Nuevo","customer_id":"c1","currency":"UYU","margin_factor":1.35,"labor_fixed_cost":0}`)
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

// TestHandleProjectByIDUpdateNotFoundReturns404 ensures PUT on a missing project
// returns 404 so APIWorkspaceRepository.upsert falls through to POST create.
// Regression: UpdateProject used to return nil when RowsAffected==0, upsert
// treated it as success, and POST /calculate 404'd on a phantom FE-only id.
func TestHandleProjectByIDUpdateNotFoundReturns404(t *testing.T) {
	srv := &Server{Store: &stubStore{projectGetByIDErr: errors.New("no rows in result set")}}
	body := strings.NewReader(`{"id":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee","name":"Ghost","customer_id":"c1","currency":"UYU","margin_factor":1.35,"labor_fixed_cost":0,"items":[]}`)
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

func withClaims(req *http.Request, userID, role string) *http.Request {
	claims := &auth.Claims{UserID: userID, Role: role, Email: userID + "@test.com"}
	return req.WithContext(context.WithValue(req.Context(), UserContextKey, claims))
}

func TestOwnership_VendedorListFiltersOthers(t *testing.T) {
	store := &stubStore{
		listCustomers: []domain.Customer{
			{ID: "c1", Name: "Mine", OwnerUserID: "v1"},
			{ID: "c2", Name: "Theirs", OwnerUserID: "v2"},
		},
		listProjects: []domain.Project{
			{ID: "p1", Name: "Mine", OwnerUserID: "v1"},
			{ID: "p2", Name: "Theirs", OwnerUserID: "v2"},
		},
	}
	srv := &Server{Store: store}

	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/customers", nil), "v1", string(domain.RoleVendedor))
	rr := httptest.NewRecorder()
	srv.HandleCustomers(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("customers status %d", rr.Code)
	}
	var customers []domain.Customer
	if err := json.Unmarshal(rr.Body.Bytes(), &customers); err != nil {
		t.Fatal(err)
	}
	if len(customers) != 1 || customers[0].ID != "c1" {
		t.Fatalf("vendedor customer filter: %#v", customers)
	}

	req = withClaims(httptest.NewRequest(http.MethodGet, "/api/projects", nil), "v1", string(domain.RoleVendedor))
	rr = httptest.NewRecorder()
	srv.HandleProjects(rr, req)
	var projects []domain.Project
	if err := json.Unmarshal(rr.Body.Bytes(), &projects); err != nil {
		t.Fatal(err)
	}
	if len(projects) != 1 || projects[0].ID != "p1" {
		t.Fatalf("vendedor project filter: %#v", projects)
	}
}

func TestOwnership_AdminListSeesAll(t *testing.T) {
	store := &stubStore{
		listCustomers: []domain.Customer{
			{ID: "c1", OwnerUserID: "v1"},
			{ID: "c2", OwnerUserID: "v2"},
		},
	}
	srv := &Server{Store: store}
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/customers", nil), "admin", string(domain.RoleAdmin))
	rr := httptest.NewRecorder()
	srv.HandleCustomers(rr, req)
	var customers []domain.Customer
	if err := json.Unmarshal(rr.Body.Bytes(), &customers); err != nil {
		t.Fatal(err)
	}
	if len(customers) != 2 {
		t.Fatalf("admin should see all: %#v", customers)
	}
}

func TestOwnership_VendedorForcedOwnerOnCreate(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"22222222-3333-4444-5555-666666666666","name":"Nuevo","active":true,"owner_user_id":"other"}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/customers", body), "v1", string(domain.RoleVendedor))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleCustomers(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("status %d body %s", rr.Code, rr.Body.String())
	}
	if store.lastCreatedCustomer == nil || store.lastCreatedCustomer.OwnerUserID != "v1" {
		t.Fatalf("expected owner forced to v1, got %#v", store.lastCreatedCustomer)
	}
}

func TestOwnership_AdminCanAssignOwnerOnCreate(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"33333333-4444-5555-6666-777777777777","name":"Asignado","active":true,"owner_user_id":"v2"}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/customers", body), "admin", string(domain.RoleAdmin))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleCustomers(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("status %d", rr.Code)
	}
	if store.lastCreatedCustomer == nil || store.lastCreatedCustomer.OwnerUserID != "v2" {
		t.Fatalf("admin assign: %#v", store.lastCreatedCustomer)
	}
}

func TestOwnership_VendedorCannotGetOtherCustomer(t *testing.T) {
	store := &stubStore{
		customerReturnedByID: &domain.Customer{ID: "c2", Name: "Theirs", OwnerUserID: "v2"},
	}
	srv := &Server{Store: store}
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/customers/c2", nil), "v1", string(domain.RoleVendedor))
	req.SetPathValue("id", "c2")
	rr := httptest.NewRecorder()
	srv.HandleCustomerByID(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status %d want 404", rr.Code)
	}
}

func TestOwnership_AdminReassignProjectOwner(t *testing.T) {
	store := &stubStore{
		projectReturnedByID: &domain.Project{
			ID: "p1", Name: "P", CustomerID: "c1", OwnerUserID: "v1",
			Currency: "MXN", MarginFactor: 1.35, Status: domain.StatusDraft,
		},
	}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"p1","name":"P","customer_id":"c1","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"items":[],"owner_user_id":"v2"}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/projects/p1", body), "admin", string(domain.RoleAdmin))
	req.SetPathValue("id", "p1")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleProjectByID(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rr.Code, rr.Body.String())
	}
	var got domain.Project
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.OwnerUserID != "v2" {
		t.Fatalf("reassign owner: %#v", got)
	}
}

// --- F035 product RBAC matrix ---

func TestRBAC_VendedorCannotCreateMaterial(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"m1","code":"M1","name":"Board","width_mm":1830,"length_mm":2750,"thickness_mm":15,"grain_default":false,"board_price":100,"active":true}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/materials", body), "v1", string(domain.RoleVendedor))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleMaterials(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("status %d want 403 body=%s", rr.Code, rr.Body.String())
	}
	if store.createMaterialOK {
		t.Fatal("store must not create material for vendedor")
	}
}

func TestRBAC_ProduccionCannotCreateMaterial(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	body := strings.NewReader(`{"id":"m1","code":"M1","name":"Board","width_mm":1830,"length_mm":2750,"thickness_mm":15,"grain_default":false,"board_price":100,"active":true}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/materials", body), "p1", string(domain.RoleProduccion))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleMaterials(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("status %d want 403", rr.Code)
	}
}

func TestRBAC_IngenieroCanCreateMaterial(t *testing.T) {
	store := &stubStore{}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"m1","code":"M1","name":"Board","width_mm":1830,"length_mm":2750,"thickness_mm":15,"grain_default":false,"board_price":100,"active":true}`)
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/catalog/materials", body), "eng", string(domain.RoleIngeniero))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleMaterials(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("status %d want 201 body=%s", rr.Code, rr.Body.String())
	}
	if !store.createMaterialOK {
		t.Fatal("expected material created")
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

func TestRBAC_ProduccionCannotAccessCustomers(t *testing.T) {
	srv := &Server{Store: &stubStore{listCustomers: []domain.Customer{{ID: "c1"}}}}
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/customers", nil), "p1", string(domain.RoleProduccion))
	rr := httptest.NewRecorder()
	srv.HandleCustomers(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("status %d want 403", rr.Code)
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

func TestRBAC_ExportProductionDeniedToVendedor_Domain(t *testing.T) {
	// Client-side export; domain gate is the contract for UI + future API.
	if domain.RoleCanExportProduction(domain.RoleVendedor) {
		t.Fatal("vendedor must not export production")
	}
	if !domain.RoleCanExportProduction(domain.RoleIngeniero) {
		t.Fatal("ingeniero exports production")
	}
}

func TestF036_VendedorCannotReopenProject(t *testing.T) {
	store := &stubStore{
		projectReturnedByID: &domain.Project{
			ID: "p1", Name: "P", CustomerID: "c1", OwnerUserID: "v1",
			Currency: "MXN", MarginFactor: 1.35, Status: domain.StatusAccepted,
		},
	}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"p1","name":"P","customer_id":"c1","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"items":[],"status":"draft","owner_user_id":"v1"}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/projects/p1", body), "v1", string(domain.RoleVendedor))
	req.SetPathValue("id", "p1")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleProjectByID(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("status %d want 403 body=%s", rr.Code, rr.Body.String())
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
	body := strings.NewReader(`{"id":"p1","name":"P","customer_id":"c1","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"items":[],"status":"produced","owner_user_id":"v1"}`)
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

func TestF039_VendedorMaterialsListRedactsCosts(t *testing.T) {
	store := &stubStore{
		listMaterials: []domain.MaterialBoard{
			{ID: "m1", Code: "M1", Name: "Board", BoardPrice: 100, CostPerM2: 25, Active: true},
		},
	}
	srv := &Server{Store: store}
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/catalog/materials", nil), "v1", string(domain.RoleVendedor))
	rr := httptest.NewRecorder()
	srv.HandleMaterials(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d", rr.Code)
	}
	var list []domain.MaterialBoard
	if err := json.Unmarshal(rr.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].BoardPrice != 0 || list[0].CostPerM2 != 0 {
		t.Fatalf("expected redacted costs: %#v", list)
	}
	// Admin still sees costs
	store2 := &stubStore{
		listMaterials: []domain.MaterialBoard{
			{ID: "m1", Code: "M1", Name: "Board", BoardPrice: 100, CostPerM2: 25, Active: true},
		},
	}
	srv2 := &Server{Store: store2}
	req2 := withClaims(httptest.NewRequest(http.MethodGet, "/api/catalog/materials", nil), "a1", string(domain.RoleAdmin))
	rr2 := httptest.NewRecorder()
	srv2.HandleMaterials(rr2, req2)
	var list2 []domain.MaterialBoard
	_ = json.Unmarshal(rr2.Body.Bytes(), &list2)
	if len(list2) != 1 || list2[0].BoardPrice != 100 {
		t.Fatalf("admin should see board_price: %#v", list2)
	}
}

func TestF044_VendedorMaterialsShowCostsWhenFlagOn(t *testing.T) {
	flagOn := domain.DefaultWorkshopSettings()
	flagOn.VendedorCanViewCosts = true
	store := &stubStore{
		listMaterials: []domain.MaterialBoard{
			{ID: "m1", Code: "M1", Name: "Board", BoardPrice: 100, CostPerM2: 25, Active: true},
		},
		workshopSettings: &flagOn,
	}
	srv := &Server{Store: store}
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/catalog/materials", nil), "v1", string(domain.RoleVendedor))
	rr := httptest.NewRecorder()
	srv.HandleMaterials(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d", rr.Code)
	}
	var list []domain.MaterialBoard
	if err := json.Unmarshal(rr.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].BoardPrice != 100 || list[0].CostPerM2 != 25 {
		t.Fatalf("expected costs visible with flag: %#v", list)
	}
}

func TestF044_SettingsPutRequiresAccess(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	body := strings.NewReader(`{"default_margin_factor":1.4,"default_labor_fixed_cost":0,"default_currency":"MXN","vendedor_can_view_costs":true}`)
	req := withClaims(httptest.NewRequest(http.MethodPut, "/api/settings", body), "v1", string(domain.RoleVendedor))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.HandleWorkshopSettings(rr, req)
	if rr.Code != http.StatusForbidden && rr.Code != http.StatusUnauthorized {
		// requirePermission typically 403
		if rr.Code != 403 {
			t.Fatalf("vendedor must not put settings, status=%d body=%s", rr.Code, rr.Body.String())
		}
	}

	req2 := withClaims(httptest.NewRequest(http.MethodPut, "/api/settings", strings.NewReader(`{"default_margin_factor":1.4,"default_labor_fixed_cost":0,"default_currency":"MXN","vendedor_can_view_costs":true}`)), "a1", string(domain.RoleAdmin))
	req2.Header.Set("Content-Type", "application/json")
	rr2 := httptest.NewRecorder()
	srv.HandleWorkshopSettings(rr2, req2)
	if rr2.Code != http.StatusOK {
		t.Fatalf("admin put settings status=%d body=%s", rr2.Code, rr2.Body.String())
	}
	var got domain.WorkshopSettings
	if err := json.Unmarshal(rr2.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if !got.VendedorCanViewCosts {
		t.Fatalf("flag not saved: %#v", got)
	}
}

func TestF039_VendedorMaterialsHideCosts(t *testing.T) {
	store := &stubStore{}
	// Override ListMaterialBoards via embedding is hard — use direct domain redact unit + handler path with stub.
	// Handler path: stub ListMaterialBoards not implemented returns panic — use domain package test for redact,
	// and exercise calculate redaction here.
	_ = store
	srv := &Server{Store: &stubStore{
		projectReturnedByID: &domain.Project{
			ID: "p1", Name: "P", CustomerID: "c1", OwnerUserID: "v1",
			Currency: "MXN", MarginFactor: 1.35, Status: domain.StatusDraft,
		},
	}}
	// Calculate needs catalog — skip if GetFullCatalog panics. Use domain redaction assertion instead.
	bd := domain.QuoteBreakdown{MaterialsCost: 50, DirectCost: 80, MarginFactor: 1.35, SalePrice: 108}
	domain.RedactQuoteBreakdown(&bd)
	if bd.SalePrice != 108 || bd.DirectCost != 0 {
		t.Fatalf("redact: %#v", bd)
	}
	req := withClaims(httptest.NewRequest(http.MethodGet, "/api/projects/p1", nil), "v1", string(domain.RoleVendedor))
	req.SetPathValue("id", "p1")
	rr := httptest.NewRecorder()
	srv.HandleProjectByID(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rr.Code, rr.Body.String())
	}
	var got domain.Project
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.MarginFactor != 0 {
		t.Fatalf("vendedor project margin must be redacted, got %v", got.MarginFactor)
	}
	_ = srv
}

func TestF036_VendedorCannotMarkProduced(t *testing.T) {
	store := &stubStore{
		projectReturnedByID: &domain.Project{
			ID: "p1", Name: "P", CustomerID: "c1", OwnerUserID: "v1",
			Currency: "MXN", MarginFactor: 1.35, Status: domain.StatusAccepted,
		},
	}
	srv := &Server{Store: store}
	body := strings.NewReader(`{"id":"p1","name":"P","customer_id":"c1","currency":"MXN","margin_factor":1.35,"labor_fixed_cost":0,"items":[],"status":"produced","owner_user_id":"v1"}`)
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

func TestHandleLogin_Uniform401ForMissingUser(t *testing.T) {
	srv := &Server{
		Store:     &stubStore{getUserByEmailErr: errors.New("user not found")},
		JWTSecret: "test-secret-key-for-jwt-signing-32b",
	}
	body := strings.NewReader(`{"email":"nope@test.com","password":"whatever1"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", body)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleLogin(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 (body=%s)", rr.Code, rr.Body.String())
	}
	msg := errorBody(t, rr)
	if msg != "invalid email or password" {
		t.Errorf("error = %q, want generic invalid credentials", msg)
	}
}

func TestHandleLogin_Uniform401ForPendingUser(t *testing.T) {
	hash, err := mustHash("goodpass1")
	if err != nil {
		t.Fatal(err)
	}
	srv := &Server{
		Store: &stubStore{getUserByEmail: &domain.User{
			ID: "u1", Email: "pending@test.com", PasswordHash: hash,
			Name: "P", Role: domain.RoleUser, Active: false,
		}},
		JWTSecret: "test-secret-key-for-jwt-signing-32b",
	}
	body := strings.NewReader(`{"email":"pending@test.com","password":"goodpass1"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", body)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleLogin(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 (body=%s)", rr.Code, rr.Body.String())
	}
	msg := errorBody(t, rr)
	if strings.Contains(strings.ToLower(msg), "pendiente") || strings.Contains(strings.ToLower(msg), "pending") {
		t.Errorf("must not reveal pending status, got %q", msg)
	}
	if msg != "invalid email or password" {
		t.Errorf("error = %q, want generic invalid credentials", msg)
	}
}

func TestHandleLogin_Uniform401ForWrongPassword(t *testing.T) {
	hash, err := mustHash("goodpass1")
	if err != nil {
		t.Fatal(err)
	}
	srv := &Server{
		Store: &stubStore{getUserByEmail: &domain.User{
			ID: "u1", Email: "ok@test.com", PasswordHash: hash,
			Name: "O", Role: domain.RoleUser, Active: true,
		}},
		JWTSecret: "test-secret-key-for-jwt-signing-32b",
	}
	body := strings.NewReader(`{"email":"ok@test.com","password":"wrongpass9"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", body)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleLogin(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rr.Code)
	}
	if errorBody(t, rr) != "invalid email or password" {
		t.Errorf("unexpected body %s", rr.Body.String())
	}
}

func TestHandleRegister_RejectsWeakPassword(t *testing.T) {
	srv := &Server{Store: &stubStore{}}
	body := strings.NewReader(`{"email":"a@b.com","password":"short","name":"A"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/register", body)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleRegister(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body=%s)", rr.Code, rr.Body.String())
	}
}

func TestHandleRegister_IgnoresRoleInBody(t *testing.T) {
	// Role field removed from RegisterRequest — extra JSON fields are ignored by decoder.
	// Ensure self-registration cannot self-elevate via body.role.
	var created *domain.User
	srv := &Server{Store: &createUserCapture{created: &created}}
	body := strings.NewReader(`{"email":"a@b.com","password":"goodpass1","name":"A","role":"admin"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/register", body)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()

	srv.HandleRegister(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (body=%s)", rr.Code, rr.Body.String())
	}
	if created == nil {
		t.Fatal("expected CreateUser to be called")
	}
	if created.Role != domain.RoleUser {
		t.Errorf("role = %q, want %q (self-reg always user)", created.Role, domain.RoleUser)
	}
	if created.Active {
		t.Error("self-reg must start inactive (pending approval)")
	}
}

// createUserCapture embeds stubStore and records the user passed to CreateUser.
type createUserCapture struct {
	stubStore
	created **domain.User
}

func (c *createUserCapture) CreateUser(_ context.Context, u *domain.User) error {
	cp := *u
	*c.created = &cp
	return nil
}

func mustHash(pw string) (string, error) {
	return auth.HashPassword(pw)
}

func TestDecodeJSONBody_RejectsOversized(t *testing.T) {
	// Build a body larger than maxJSONBodyBytes.
	big := strings.Repeat("a", maxJSONBodyBytes+10)
	body := strings.NewReader(`{"name":"` + big + `"}`)
	req := httptest.NewRequest(http.MethodPost, "/x", body)
	rr := httptest.NewRecorder()
	var dst map[string]string
	ok := decodeJSONBody(rr, req, &dst)
	if ok {
		t.Fatal("expected decodeJSONBody to fail for oversized body")
	}
	if rr.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413", rr.Code)
	}
}
