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
	createCustomerErr     error
	createMaterialErr     error
	createProjectErr      error
	updateProjectErr      error
	customerReturnedByID  *domain.Customer
	customerGetByIDErr    error
	materialReturnedByID  *domain.MaterialBoard
	materialGetByIDErr    error
	// Auth test hooks
	getUserByEmail        *domain.User
	getUserByEmailErr     error
	createUserErr         error
}

func (s *stubStore) CreateCustomer(ctx context.Context, c *domain.Customer) error {
	return s.createCustomerErr
}
func (s *stubStore) CreateMaterialBoard(ctx context.Context, m *domain.MaterialBoard) error {
	return s.createMaterialErr
}
func (s *stubStore) CreateProject(ctx context.Context, p *domain.Project) error {
	return s.createProjectErr
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
	s.stubNotUsed("ListUsers"); return nil, nil
}
func (s *stubStore) ApproveUser(context.Context, string) error { s.stubNotUsed("ApproveUser"); return nil }
func (s *stubStore) UpdateUserRole(context.Context, string, domain.UserRole) error {
	s.stubNotUsed("UpdateUserRole"); return nil
}
func (s *stubStore) RejectUser(context.Context, string) error { s.stubNotUsed("RejectUser"); return nil }
func (s *stubStore) ListCustomers(context.Context) ([]domain.Customer, error) {
	s.stubNotUsed("ListCustomers"); return nil, nil
}
func (s *stubStore) UpdateCustomer(context.Context, string, *domain.Customer) error {
	s.stubNotUsed("UpdateCustomer"); return nil
}
func (s *stubStore) DeactivateCustomer(context.Context, string) error {
	s.stubNotUsed("DeactivateCustomer"); return nil
}
func (s *stubStore) ListMaterialBoards(context.Context) ([]domain.MaterialBoard, error) {
	s.stubNotUsed("ListMaterialBoards"); return nil, nil
}
func (s *stubStore) UpdateMaterialBoard(context.Context, string, *domain.MaterialBoard) error {
	s.stubNotUsed("UpdateMaterialBoard"); return nil
}
func (s *stubStore) DeactivateMaterialBoard(context.Context, string) error {
	s.stubNotUsed("DeactivateMaterialBoard"); return nil
}
func (s *stubStore) ListEdgeBands(context.Context) ([]domain.EdgeBand, error) {
	s.stubNotUsed("ListEdgeBands"); return nil, nil
}
func (s *stubStore) GetEdgeBandByID(context.Context, string) (*domain.EdgeBand, error) {
	s.stubNotUsed("GetEdgeBandByID"); return nil, nil
}
func (s *stubStore) CreateEdgeBand(context.Context, *domain.EdgeBand) error {
	s.stubNotUsed("CreateEdgeBand"); return nil
}
func (s *stubStore) UpdateEdgeBand(context.Context, string, *domain.EdgeBand) error {
	s.stubNotUsed("UpdateEdgeBand"); return nil
}
func (s *stubStore) DeactivateEdgeBand(context.Context, string) error {
	s.stubNotUsed("DeactivateEdgeBand"); return nil
}
func (s *stubStore) ListHardwares(context.Context) ([]domain.Hardware, error) {
	s.stubNotUsed("ListHardwares"); return nil, nil
}
func (s *stubStore) GetHardwareByID(context.Context, string) (*domain.Hardware, error) {
	s.stubNotUsed("GetHardwareByID"); return nil, nil
}
func (s *stubStore) CreateHardware(context.Context, *domain.Hardware) error {
	s.stubNotUsed("CreateHardware"); return nil
}
func (s *stubStore) UpdateHardware(context.Context, string, *domain.Hardware) error {
	s.stubNotUsed("UpdateHardware"); return nil
}
func (s *stubStore) DeactivateHardware(context.Context, string) error {
	s.stubNotUsed("DeactivateHardware"); return nil
}
func (s *stubStore) ListOptionGroups(context.Context) ([]domain.OptionGroup, error) {
	s.stubNotUsed("ListOptionGroups"); return nil, nil
}
func (s *stubStore) GetOptionGroupByID(context.Context, string) (*domain.OptionGroup, error) {
	s.stubNotUsed("GetOptionGroupByID"); return nil, nil
}
func (s *stubStore) CreateOptionGroup(context.Context, *domain.OptionGroup) error {
	s.stubNotUsed("CreateOptionGroup"); return nil
}
func (s *stubStore) UpdateOptionGroup(context.Context, string, *domain.OptionGroup) error {
	s.stubNotUsed("UpdateOptionGroup"); return nil
}
func (s *stubStore) DeleteOptionGroup(context.Context, string) error {
	s.stubNotUsed("DeleteOptionGroup"); return nil
}
func (s *stubStore) ListCategories(context.Context) ([]domain.ModuleCategory, error) {
	s.stubNotUsed("ListCategories"); return nil, nil
}
func (s *stubStore) GetCategoryByID(context.Context, string) (*domain.ModuleCategory, error) {
	s.stubNotUsed("GetCategoryByID"); return nil, nil
}
func (s *stubStore) CreateCategory(context.Context, *domain.ModuleCategory) error {
	s.stubNotUsed("CreateCategory"); return nil
}
func (s *stubStore) UpdateCategory(context.Context, string, *domain.ModuleCategory) error {
	s.stubNotUsed("UpdateCategory"); return nil
}
func (s *stubStore) DeleteCategory(context.Context, string) error {
	s.stubNotUsed("DeleteCategory"); return nil
}
func (s *stubStore) GetFullCatalog(context.Context) (domain.Catalog, error) {
	s.stubNotUsed("GetFullCatalog"); return domain.Catalog{}, nil
}
func (s *stubStore) GetModuleByID(context.Context, string) (*domain.Module, error) {
	s.stubNotUsed("GetModuleByID"); return nil, nil
}
func (s *stubStore) CreateModule(context.Context, *domain.Module) error {
	s.stubNotUsed("CreateModule"); return nil
}
func (s *stubStore) UpdateModule(context.Context, string, *domain.Module) error {
	s.stubNotUsed("UpdateModule"); return nil
}
func (s *stubStore) DeleteModule(context.Context, string) error {
	s.stubNotUsed("DeleteModule"); return nil
}
func (s *stubStore) ListProjects(context.Context) ([]domain.Project, error) {
	s.stubNotUsed("ListProjects"); return nil, nil
}
func (s *stubStore) GetProjectByID(context.Context, string) (*domain.Project, error) {
	s.stubNotUsed("GetProjectByID"); return nil, nil
}
func (s *stubStore) UpdateProject(context.Context, string, *domain.Project) error {
	if s.updateProjectErr != nil {
		return s.updateProjectErr
	}
	return nil
}
func (s *stubStore) DeleteProject(context.Context, string) error {
	s.stubNotUsed("DeleteProject"); return nil
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
	req := httptest.NewRequest(http.MethodPost, "/api/customers", body)
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
	req := httptest.NewRequest(http.MethodPost, "/api/catalog/materials", body)
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
	req := httptest.NewRequest(http.MethodPost, "/api/customers", body)
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
	req := httptest.NewRequest(http.MethodPost, "/api/projects", body)
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
	req := httptest.NewRequest(http.MethodPost, "/api/projects", body)
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
	srv := &Server{Store: &stubStore{updateProjectErr: errors.New("project not found")}}
	body := strings.NewReader(`{"id":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee","name":"Ghost","customer_id":"c1","currency":"UYU","margin_factor":1.35,"labor_fixed_cost":0,"items":[]}`)
	req := httptest.NewRequest(http.MethodPut, "/api/projects/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", body)
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
