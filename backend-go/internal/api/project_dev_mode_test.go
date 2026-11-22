package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// asExtension makes the request come from a SketchUp extension session,
// optionally announcing the library developer mode.
func asExtension(req *http.Request, devMode bool) *http.Request {
	if claims := claimsFromRequest(req); claims != nil {
		claims.Client = auth.ExtensionClient
	}
	if devMode {
		req.Header.Set(LibraryModeHeader, "draft")
	}
	return req
}

// #1599: the project is marked only when the dev-mode header comes from a
// caller with developer-mode authority; otherwise byte-identical to today.
func TestBootstrapMarksProjectOnlyForAuthorizedDevMode(t *testing.T) {
	body := `{"projectName":"Cocina Ana","designName":"Diseño principal","newCustomer":{"name":"Ana López"}}`
	for _, tc := range []struct {
		name   string
		header string
		roles  []domain.UserRole
		marked bool
	}{
		{"admin in dev mode", "draft", []domain.UserRole{domain.RoleAdmin}, true},
		{"header is case-insensitive", "Draft", []domain.UserRole{domain.RoleAdmin}, true},
		{"no header: unchanged", "", []domain.UserRole{domain.RoleAdmin}, false},
		{"unknown mode value ignored", "published", []domain.UserRole{domain.RoleAdmin}, false},
		{"seller cannot mark even with the header", "draft", []domain.UserRole{domain.RoleVendedor}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store := &stubStore{modelBindingContext: bootstrapBindingContext()}
			req := httptest.NewRequest(http.MethodPost, "/api/projects:bootstrap-design", strings.NewReader(body))
			if tc.header != "" {
				req.Header.Set(LibraryModeHeader, tc.header)
			}
			req = asExtension(withTestClaims(req, "10000000-0000-0000-0000-000000000099", tc.roles), false)
			w := httptest.NewRecorder()
			(&Server{Store: store}).HandleProjectDesignBootstrap(w, req)
			if w.Code != http.StatusCreated {
				t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
			}
			if got := len(store.devModeMarks) == 1; got != tc.marked {
				t.Fatalf("marked=%v want %v (%v)", got, tc.marked, store.devModeMarks)
			}
			if tc.marked && !strings.HasSuffix(store.devModeMarks[0], ":10000000-0000-0000-0000-000000000099") {
				t.Fatalf("mark must carry the server actor: %v", store.devModeMarks)
			}
		})
	}
}

func TestBootstrapIgnoresDevModeHeaderFromWebSessions(t *testing.T) {
	store := &stubStore{modelBindingContext: bootstrapBindingContext()}
	req := httptest.NewRequest(http.MethodPost, "/api/projects:bootstrap-design",
		strings.NewReader(`{"projectName":"Cocina Ana","designName":"Diseño principal","newCustomer":{"name":"Ana López"}}`))
	req.Header.Set(LibraryModeHeader, "draft")
	req = withTestClaims(req, "10000000-0000-0000-0000-000000000099", []domain.UserRole{domain.RoleAdmin}) // web session
	w := httptest.NewRecorder()
	(&Server{Store: store}).HandleProjectDesignBootstrap(w, req)
	if w.Code != http.StatusCreated || len(store.devModeMarks) != 0 {
		t.Fatalf("a web session must not mark: status=%d marks=%v", w.Code, store.devModeMarks)
	}
}

// The three SYNC paths of the issue's investigation mark the project the
// server resolved (never one from the client), and only for an extension
// session of a dev-mode role announcing the mode.
func TestSyncPathsMarkTheServerResolvedProject(t *testing.T) {
	type path struct {
		name      string
		run       func(srv *Server, store *stubStore, roles []domain.UserRole, devMode bool) int
		projectID string
	}
	workingCopy := func(srv *Server, store *stubStore, roles []domain.UserRole, devMode bool) int {
		// The extension's authoring-surface gate reads the design and project.
		store.designsByID = map[string]domain.Design{designTestDesignID: {ID: designTestDesignID, ProjectID: "proj-1"}}
		store.projectReturnedByID = &domain.Project{ID: "proj-1", AuthoringSurface: domain.AuthoringSurfaceSketchup}
		body := `{"source_type":"manual","expected_working_version":"2026-09-21T00:00:00.000000Z","items":[{"furniture_instance_id":"` + designTestInstanceID + `","parameters":{"width":850},"material_choices":{}}]}`
		req := designRequest(http.MethodPut, "/api/designs/"+designTestDesignID+"/working-copy", body, string(roles[0]))
		req = asExtension(req, devMode)
		rr := httptest.NewRecorder()
		srv.HandleDesignWorkingCopy(rr, req)
		return rr.Code
	}
	create := func(srv *Server, _ *stubStore, roles []domain.UserRole, devMode bool) int {
		req := fiRequest(http.MethodPost, "/api/projects/"+fiTestProjectID+"/furniture-instances",
			`{"furniture_definition_id":"50000000-0000-0000-0000-000000000001"}`, string(roles[0]))
		req = asExtension(req, devMode)
		rr := httptest.NewRecorder()
		srv.HandleProjectFurnitureInstances(rr, req)
		return rr.Code
	}
	sourceID := "60000000-0000-0000-0000-000000000001"
	duplicate := func(srv *Server, store *stubStore, roles []domain.UserRole, devMode bool) int {
		store.furnitureInstancesByID = map[string]domain.FurnitureInstance{
			sourceID: {ID: sourceID, ProjectID: fiTestProjectID, FurnitureDefinitionID: "50000000-0000-0000-0000-000000000001",
				Origin: domain.FurnitureInstanceOriginDesign, LifecycleStatus: domain.FurnitureInstanceLifecycleActive, Version: 1},
		}
		router := projectFurnitureInstanceCommandRouter(map[string]http.Handler{"duplicate": http.HandlerFunc(srv.HandleFurnitureInstanceDuplicate)})
		req := fiRequest(http.MethodPost, "/api/projects/"+fiTestProjectID+"/furniture-instances/"+sourceID+":duplicate", "", string(roles[0]))
		req.SetPathValue("projectId", fiTestProjectID)
		req.SetPathValue("instanceCommand", sourceID+":duplicate")
		req = asExtension(req, devMode)
		rr := httptest.NewRecorder()
		router.ServeHTTP(rr, req)
		return rr.Code
	}
	paths := []path{
		{"working-copy PUT", workingCopy, "proj-1"}, // resolved by the server from the design
		{"furniture create", create, fiTestProjectID},
		{"furniture duplicate", duplicate, fiTestProjectID},
	}
	for _, p := range paths {
		for _, tc := range []struct {
			name    string
			roles   []domain.UserRole
			devMode bool
			marked  bool
		}{
			{"admin in dev mode marks", []domain.UserRole{domain.RoleAdmin}, true, true},
			{"no header leaves it unmarked", []domain.UserRole{domain.RoleAdmin}, false, false},
			{"seller with the header does not mark", []domain.UserRole{domain.RoleVendedor}, true, false},
		} {
			t.Run(p.name+"/"+tc.name, func(t *testing.T) {
				store := &stubStore{}
				srv := &Server{Store: store}
				code := p.run(srv, store, tc.roles, tc.devMode)
				if code >= 300 {
					t.Fatalf("status %d", code)
				}
				if got := len(store.devModeMarks) == 1; got != tc.marked {
					t.Fatalf("marked=%v want %v (%v)", got, tc.marked, store.devModeMarks)
				}
				if tc.marked && !strings.HasPrefix(store.devModeMarks[0], p.projectID+":") {
					t.Fatalf("must mark the server-resolved project %s, got %v", p.projectID, store.devModeMarks)
				}
			})
		}
	}
}
