package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

/**
 * Installation endpoints (OC-070..OC-074, #303): visit lifecycle with audit
 * events, punch RBAC on the PUT diff, closeout smuggling rejection and the
 * server-authoritative OC-074 closeout gates.
 */

func installationFixtures() (*stubStore, *Server) {
	installedAt := time.Date(2026, 9, 2, 15, 0, 0, 0, time.UTC)
	unit := domain.ModuleUnitExecution{
		ID: "u1", ProjectID: "p1", ProjectItemID: "i1", UnitIndex: 1,
		ProductionRevision: "rev-1", Status: domain.ModuleUnitStatusInstalled,
		InstalledAt: &installedAt,
	}
	job := &domain.InstallationJob{
		ID:        "ijob-1",
		ProjectID: "p1",
		Visits: []domain.InstallationVisit{
			{ID: "ivis-1", Date: "2026-09-02", Crew: []string{"Juan"}, Status: domain.InstallationVisitScheduled, CreatedAt: installedAt},
		},
		FieldIssues: []domain.FieldIssue{},
		PunchItems:  []domain.PunchItem{},
		CreatedAt:   installedAt,
	}
	project := &domain.Project{
		ID: "p1", Name: "Obra Test", CustomerID: "c1", Status: domain.StatusProduced,
		Items:        []domain.ProjectItem{{ID: "i1", ModuleID: "m-gab", Quantity: 1, FloorStatus: "installed"}},
		ModuleUnits:  []domain.ModuleUnitExecution{unit},
		Installation: job,
	}
	store := &stubStore{
		projectReturnedByID: project,
		moduleUnits:         []domain.ModuleUnitExecution{unit},
		installationJob:     job,
		installationUnits:   []domain.ModuleUnitExecution{unit},
		installationItems:   []domain.ProjectItem{{ID: "i1", ModuleID: "m-gab", FloorStatus: "installed"}},
	}
	return store, &Server{Store: store}
}

func doInstallation(srv *Server, method, path, role, body string) *httptest.ResponseRecorder {
	req := withClaims(httptest.NewRequest(method, path, strings.NewReader(body)), "u1", role)
	req.SetPathValue("id", "p1")
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	if strings.HasSuffix(path, "/closeout") {
		srv.HandleProjectInstallationCloseout(rr, req)
	} else {
		srv.HandleProjectInstallation(rr, req)
	}
	return rr
}

func TestInstallation_GetReturnsDerivedCloseoutView(t *testing.T) {
	store, srv := installationFixtures()
	rr := doInstallation(srv, http.MethodGet, "/api/projects/p1/installation", string(domain.RoleProduccion), "")
	if rr.Code != http.StatusOK {
		t.Fatalf("GET installation = %d, body %s", rr.Code, rr.Body.String())
	}
	var view struct {
		Installation   *domain.InstallationJob    `json:"installation"`
		JobStatus      string                     `json:"job_status"`
		Units          map[string]interface{}     `json:"units"`
		CloseoutChecks []domain.CloseoutCheck     `json:"closeout_checks"`
		CloseoutReady  bool                       `json:"closeout_ready"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &view); err != nil {
		t.Fatalf("decode view: %v", err)
	}
	if view.Installation == nil || view.Installation.ID != "ijob-1" {
		t.Fatalf("installation job missing in view: %+v", view.Installation)
	}
	if view.JobStatus != "planned" {
		t.Fatalf("job_status = %s, want planned", view.JobStatus)
	}
	if view.Units["installed"] != float64(1) || view.Units["total"] != float64(1) {
		t.Fatalf("units summary = %v", view.Units)
	}
	// Scheduled visit still open → closeout not ready.
	if view.CloseoutReady {
		t.Fatal("open visit must block closeout readiness")
	}
	_ = store
}

func TestInstallation_PutValidatesTransitionsAndDerivesEvents(t *testing.T) {
	store, srv := installationFixtures()

	// scheduled → in_progress (legal) with a new blocking punch item.
	job := *store.installationJob
	job.Visits = []domain.InstallationVisit{{
		ID: "ivis-1", Date: "2026-09-02", Crew: []string{"Juan"},
		Status: domain.InstallationVisitInProgress, CreatedAt: job.CreatedAt,
	}}
	job.PunchItems = []domain.PunchItem{{
		ID: "pnch-1", Description: "Falta manija", Owner: "Carlos",
		Severity: domain.PunchSeverityCritical, IsBlocker: true, Status: domain.PunchItemOpen,
		OpenedAt: time.Now().UTC(),
	}}
	body, _ := json.Marshal(job)
	rr := doInstallation(srv, http.MethodPut, "/api/projects/p1/installation", string(domain.RoleGerenteProduccion), string(body))
	if rr.Code != http.StatusOK {
		t.Fatalf("PUT installation = %d, body %s", rr.Code, rr.Body.String())
	}
	types := map[string]bool{}
	for _, ev := range store.installationEvents {
		types[ev.Type] = true
	}
	if !types["installation_started"] {
		t.Fatalf("installation_started event missing: %+v", store.installationEvents)
	}
	if !types["punch_opened"] {
		t.Fatalf("punch_opened event missing: %+v", store.installationEvents)
	}

	// Illegal visit transition (in_progress → scheduled) must be rejected.
	bad := *store.installationJob
	bad.Visits = []domain.InstallationVisit{{
		ID: "ivis-1", Date: "2026-09-02", Crew: []string{"Juan"},
		Status: domain.InstallationVisitScheduled, CreatedAt: job.CreatedAt,
	}}
	badBody, _ := json.Marshal(bad)
	rr = doInstallation(srv, http.MethodPut, "/api/projects/p1/installation", string(domain.RoleGerenteProduccion), string(badBody))
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("illegal visit transition = %d, body %s", rr.Code, rr.Body.String())
	}
}

func TestInstallation_PutPunchEventsRequirePunchRoles(t *testing.T) {
	store, srv := installationFixtures()
	job := *store.installationJob
	job.PunchItems = []domain.PunchItem{{
		ID: "pnch-1", Description: "Retoque", Owner: "Carlos",
		Severity: domain.PunchSeverityMinor, Status: domain.PunchItemOpen,
		OpenedAt: time.Now().UTC(),
	}}
	body, _ := json.Marshal(job)
	// produccion may work visits but not append punch events.
	rr := doInstallation(srv, http.MethodPut, "/api/projects/p1/installation", string(domain.RoleProduccion), string(body))
	if rr.Code != http.StatusForbidden {
		t.Fatalf("punch via produccion = %d, body %s", rr.Code, rr.Body.String())
	}
}

func TestInstallation_PutRejectsCloseoutSmuggling(t *testing.T) {
	store, srv := installationFixtures()
	job := *store.installationJob
	now := time.Now().UTC()
	job.Closeout = &domain.ClientCloseout{SignedOffBy: "Cliente", SignedOffAt: now}
	body, _ := json.Marshal(job)
	rr := doInstallation(srv, http.MethodPut, "/api/projects/p1/installation", string(domain.RoleAdmin), string(body))
	if rr.Code != http.StatusConflict {
		t.Fatalf("closeout smuggling via PUT = %d, body %s", rr.Code, rr.Body.String())
	}
}

func TestInstallation_PutRbacRejectsVendedor(t *testing.T) {
	_, srv := installationFixtures()
	rr := doInstallation(srv, http.MethodPut, "/api/projects/p1/installation", string(domain.RoleVendedor), `{"id":"ijob-1"}`)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("PUT by vendedor = %d", rr.Code)
	}
}

func TestInstallation_CloseoutGatesBlockThenAllow(t *testing.T) {
	store, srv := installationFixtures()

	// Open scheduled visit blocks sign-off.
	rr := doInstallation(srv, http.MethodPost, "/api/projects/p1/installation/closeout",
		string(domain.RoleAdmin), `{"action":"sign_off","signed_off_by":"María"}`)
	if rr.Code != http.StatusConflict {
		t.Fatalf("sign_off with open visit = %d, body %s", rr.Code, rr.Body.String())
	}
	var blocked struct {
		CloseoutChecks []domain.CloseoutCheck `json:"closeout_checks"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &blocked); err != nil {
		t.Fatalf("decode blocked checks: %v", err)
	}
	if len(blocked.CloseoutChecks) == 0 {
		t.Fatal("gate response must explain the failing checks")
	}

	// Close the visit (scheduled → cancelled is legal) and retry.
	job := *store.installationJob
	job.Visits = []domain.InstallationVisit{{
		ID: "ivis-1", Date: "2026-09-02", Crew: []string{"Juan"},
		Status: domain.InstallationVisitCancelled, CreatedAt: job.CreatedAt,
	}}
	store.installationJob = &job
	store.projectReturnedByID.Installation = &job

	rr = doInstallation(srv, http.MethodPost, "/api/projects/p1/installation/closeout",
		string(domain.RoleAdmin), `{"action":"sign_off","signed_off_by":"María González"}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("sign_off = %d, body %s", rr.Code, rr.Body.String())
	}
	signed := false
	for _, ev := range store.installationEvents {
		if ev.Type == "client_signed_off" {
			signed = true
		}
	}
	if !signed {
		t.Fatal("client_signed_off audit event missing")
	}

	// close requires sign-off (already recorded) → passes and audits.
	rr = doInstallation(srv, http.MethodPost, "/api/projects/p1/installation/closeout",
		string(domain.RoleGerenteVentas), `{"action":"close"}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("close = %d, body %s", rr.Code, rr.Body.String())
	}
	closed := false
	for _, ev := range store.installationEvents {
		if ev.Type == "project_closed" {
			closed = true
		}
	}
	if !closed {
		t.Fatal("project_closed audit event missing")
	}
}

func TestInstallation_CloseoutWithBlockingPunchRejected(t *testing.T) {
	store, srv := installationFixtures()
	job := *store.installationJob
	job.Visits = nil
	job.PunchItems = []domain.PunchItem{{
		ID: "pnch-1", Description: "Falta zócalo", Owner: "Taller",
		Severity: domain.PunchSeverityCritical, IsBlocker: true, Status: domain.PunchItemOpen,
		OpenedAt: time.Now().UTC(),
	}}
	store.installationJob = &job

	rr := doInstallation(srv, http.MethodPost, "/api/projects/p1/installation/closeout",
		string(domain.RoleAdmin), `{"action":"sign_off","signed_off_by":"María"}`)
	if rr.Code != http.StatusConflict {
		t.Fatalf("sign_off with blocking punch = %d, body %s", rr.Code, rr.Body.String())
	}
	// OC-074: all units installed but the punch blocker keeps the gate closed.
	if !strings.Contains(rr.Body.String(), "punch") {
		t.Fatalf("gate response must name the punch blocker: %s", rr.Body.String())
	}
}

func TestInstallation_RawCloseoutEventBlockedByGates(t *testing.T) {
	store, srv := installationFixtures()
	// Scheduled visit still open: raw client_signed_off must be rejected.
	req := withClaims(httptest.NewRequest(http.MethodPost, "/api/projects/p1/events",
		strings.NewReader(`{"type":"client_signed_off"}`)), "u1", string(domain.RoleAdmin))
	req.SetPathValue("id", "p1")
	rr := httptest.NewRecorder()
	srv.HandleProjectEvents(rr, req)
	if rr.Code != http.StatusConflict {
		t.Fatalf("raw client_signed_off with open visit = %d, body %s", rr.Code, rr.Body.String())
	}
	_ = store
}

func TestInstallation_CloseoutRbacRejectsProduccion(t *testing.T) {
	_, srv := installationFixtures()
	rr := doInstallation(srv, http.MethodPost, "/api/projects/p1/installation/closeout",
		string(domain.RoleProduccion), `{"action":"sign_off","signed_off_by":"X"}`)
	if rr.Code != http.StatusForbidden {
		t.Fatalf("closeout by produccion = %d", rr.Code)
	}
}

func TestInstallation_CompleteInstallationMilestone(t *testing.T) {
	store, srv := installationFixtures()
	// Cancel the scheduled visit so completion is allowed (units already installed).
	job := *store.installationJob
	job.Visits = []domain.InstallationVisit{{
		ID: "ivis-1", Date: "2026-09-02", Crew: []string{"Juan"},
		Status: domain.InstallationVisitCancelled, CreatedAt: job.CreatedAt,
	}}
	store.installationJob = &job

	// produccion may record the plant milestone.
	rr := doInstallation(srv, http.MethodPost, "/api/projects/p1/installation/closeout",
		string(domain.RoleProduccion), `{"action":"complete_installation"}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("complete_installation = %d, body %s", rr.Code, rr.Body.String())
	}
	found := false
	for _, ev := range store.installationEvents {
		if ev.Type == "installation_completed" {
			found = true
		}
	}
	if !found {
		t.Fatal("installation_completed audit event missing")
	}

	// A unit not yet installed blocks completion.
	notInstalled := *store.installationJob
	notInstalledUnits := []domain.ModuleUnitExecution{{
		ID: "u1", ProjectID: "p1", ProjectItemID: "i1", UnitIndex: 1,
		ProductionRevision: "rev-1", Status: domain.ModuleUnitStatusLoaded,
	}}
	store.installationUnits = notInstalledUnits
	_ = notInstalled
	rr = doInstallation(srv, http.MethodPost, "/api/projects/p1/installation/closeout",
		string(domain.RoleAdmin), `{"action":"complete_installation"}`)
	if rr.Code != http.StatusConflict {
		t.Fatalf("complete_installation with pending unit = %d, body %s", rr.Code, rr.Body.String())
	}
}
