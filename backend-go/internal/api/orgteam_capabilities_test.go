package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

type teamCapabilitiesStore struct {
	*stubStore
	team          []storage.OrgTeamMember
	rolesUpdated  bool
	statusUpdated bool
	rolesErr      error
	statusErr     error
	summary       *storage.OrgTeamSummary
}

func (s *teamCapabilitiesStore) ListOrgTeam(context.Context, string, string) ([]storage.OrgTeamMember, error) {
	return s.team, nil
}
func (s *teamCapabilitiesStore) GetOrgTeamSummary(context.Context, string, string) (*storage.OrgTeamSummary, error) {
	if s.summary == nil {
		return &storage.OrgTeamSummary{TeamVersion: 1, EntitlementsVersion: 1}, nil
	}
	return s.summary, nil
}

func (s *teamCapabilitiesStore) UpdateMembershipRolesByOrg(_ context.Context, _ string, membershipID string, roles []domain.UserRole, version int64) (*storage.OrgTeamMember, error) {
	s.rolesUpdated = true
	if s.rolesErr != nil {
		return nil, s.rolesErr
	}
	return &storage.OrgTeamMember{MembershipID: membershipID, UserID: "target", Roles: roles, Status: domain.MembershipStatusActive, Version: version + 1}, nil
}

func (s *teamCapabilitiesStore) UpdateMembershipStatus(_ context.Context, _ string, membershipID string, status domain.MembershipStatus, _ string, _ string, version int64) (*storage.OrgTeamMember, error) {
	s.statusUpdated = true
	if s.statusErr != nil {
		return nil, s.statusErr
	}
	return &storage.OrgTeamMember{MembershipID: membershipID, UserID: "target", Status: status, Version: version + 1}, nil
}

func teamCapabilityServer(orgType domain.OrganizationType, team []storage.OrgTeamMember) (*Server, *teamCapabilitiesStore) {
	store := &teamCapabilitiesStore{
		stubStore: &stubStore{getOrgByID: &domain.Organization{ID: "org-1", Type: orgType, Active: true}},
		team:      team,
	}
	return &Server{Store: store}, store
}

func teamCapabilityRequest(method, path, actor string, roles []string, body string) *http.Request {
	req := withOrgClaims(httptest.NewRequest(method, path, strings.NewReader(body)), actor, "org-1", roles...)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("If-Match", `"v1"`)
	req.SetPathValue("membershipId", "target-membership")
	return req
}

func TestOrgTeamCapabilities_ViewRequiresTeamView(t *testing.T) {
	tests := []struct {
		name    string
		orgType domain.OrganizationType
		roles   []string
		want    int
	}{
		{name: "factory sales manager", orgType: domain.OrganizationTypeFactory, roles: []string{string(domain.RoleGerenteVentas)}, want: http.StatusOK},
		{name: "factory production manager", orgType: domain.OrganizationTypeFactory, roles: []string{string(domain.RoleGerenteProduccion)}, want: http.StatusOK},
		{name: "store sales manager", orgType: domain.OrganizationTypeStore, roles: []string{string(domain.RoleGerenteVentas)}, want: http.StatusOK},
		{name: "worker has no team view", orgType: domain.OrganizationTypeFactory, roles: []string{string(domain.RoleProduccion)}, want: http.StatusForbidden},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv, _ := teamCapabilityServer(tt.orgType, nil)
			rr := httptest.NewRecorder()
			srv.HandleOrgTeam(rr, teamCapabilityRequest(http.MethodGet, "/api/org/memberships", "actor", tt.roles, ""))
			if rr.Code != tt.want {
				t.Fatalf("status = %d, want %d: %s", rr.Code, tt.want, rr.Body.String())
			}
		})
	}
}

func TestOrgTeamSupportSessionIsReadOnly(t *testing.T) {
	target := storage.OrgTeamMember{MembershipID: "target-membership", UserID: "target", Roles: []domain.UserRole{domain.RoleVendedor}}
	srv, store := teamCapabilityServer(domain.OrganizationTypeFactory, []storage.OrgTeamMember{target})

	readRequest := teamCapabilityRequest(http.MethodGet, "/api/org/memberships", "support-actor", []string{string(domain.RoleAdmin)}, "")
	claimsFromRequest(readRequest).Support = &auth.SupportClaims{OrgID: "org-1", SessionID: "support-session"}
	readResponse := httptest.NewRecorder()
	srv.HandleOrgTeam(readResponse, readRequest)
	if readResponse.Code != http.StatusOK {
		t.Fatalf("support read status = %d, want %d: %s", readResponse.Code, http.StatusOK, readResponse.Body.String())
	}

	writeRequest := teamCapabilityRequest(http.MethodPut, "/api/org/memberships/target-membership/roles", "support-actor", []string{string(domain.RoleAdmin)}, `{"roles":["vendedor"]}`)
	claimsFromRequest(writeRequest).Support = &auth.SupportClaims{OrgID: "org-1", SessionID: "support-session"}
	writeResponse := httptest.NewRecorder()
	srv.HandleOrgMemberRoles(writeResponse, writeRequest)
	if writeResponse.Code != http.StatusForbidden {
		t.Fatalf("support write status = %d, want %d: %s", writeResponse.Code, http.StatusForbidden, writeResponse.Body.String())
	}
	if store.rolesUpdated {
		t.Fatal("support session must not update membership roles")
	}
}

func TestOrgMemberRolesCapabilities(t *testing.T) {
	tests := []struct {
		name       string
		orgType    domain.OrganizationType
		actor      string
		actorRoles []string
		target     storage.OrgTeamMember
		body       string
		want       int
		updated    bool
	}{
		{name: "factory sales manager manages vendedor", orgType: domain.OrganizationTypeFactory, actor: "actor", actorRoles: []string{string(domain.RoleGerenteVentas)}, target: storage.OrgTeamMember{MembershipID: "target-membership", UserID: "target", Roles: []domain.UserRole{domain.RoleVendedor}}, body: `{"roles":["vendedor"]}`, want: http.StatusOK, updated: true},
		{name: "factory production manager manages production and warehouse", orgType: domain.OrganizationTypeFactory, actor: "actor", actorRoles: []string{string(domain.RoleGerenteProduccion)}, target: storage.OrgTeamMember{MembershipID: "target-membership", UserID: "target", Roles: []domain.UserRole{domain.RoleProduccion, domain.RoleAlmacen}}, body: `{"roles":["produccion","almacen"]}`, want: http.StatusOK, updated: true},
		{name: "mixed managers manage mixed target", orgType: domain.OrganizationTypeFactory, actor: "actor", actorRoles: []string{string(domain.RoleGerenteVentas), string(domain.RoleGerenteProduccion)}, target: storage.OrgTeamMember{MembershipID: "target-membership", UserID: "target", Roles: []domain.UserRole{domain.RoleVendedor, domain.RoleProduccion}}, body: `{"roles":["vendedor","produccion","almacen"]}`, want: http.StatusOK, updated: true},
		{name: "store sales manager manages vendedor", orgType: domain.OrganizationTypeStore, actor: "actor", actorRoles: []string{string(domain.RoleGerenteVentas)}, target: storage.OrgTeamMember{MembershipID: "target-membership", UserID: "target", Roles: []domain.UserRole{domain.RoleVendedor}}, body: `{"roles":["vendedor"]}`, want: http.StatusOK, updated: true},
		{name: "factory admin can assign admin", orgType: domain.OrganizationTypeFactory, actor: "actor", actorRoles: []string{string(domain.RoleAdmin)}, target: storage.OrgTeamMember{MembershipID: "target-membership", UserID: "target", Roles: []domain.UserRole{domain.RoleVendedor}}, body: `{"roles":["admin"]}`, want: http.StatusOK, updated: true},
		{name: "current target role outside sales scope is denied", orgType: domain.OrganizationTypeFactory, actor: "actor", actorRoles: []string{string(domain.RoleGerenteVentas)}, target: storage.OrgTeamMember{MembershipID: "target-membership", UserID: "target", Roles: []domain.UserRole{domain.RoleVendedor, domain.RoleProduccion}}, body: `{"roles":["vendedor"]}`, want: http.StatusForbidden},
		{name: "crafted admin desired role is denied", orgType: domain.OrganizationTypeFactory, actor: "actor", actorRoles: []string{string(domain.RoleGerenteVentas)}, target: storage.OrgTeamMember{MembershipID: "target-membership", UserID: "target", Roles: []domain.UserRole{domain.RoleVendedor}}, body: `{"roles":["vendedor","admin"]}`, want: http.StatusForbidden},
		{name: "self mutation is denied", orgType: domain.OrganizationTypeFactory, actor: "target", actorRoles: []string{string(domain.RoleGerenteVentas)}, target: storage.OrgTeamMember{MembershipID: "target-membership", UserID: "target", Roles: []domain.UserRole{domain.RoleVendedor}}, body: `{"roles":["vendedor"]}`, want: http.StatusForbidden},
		{name: "store rejects crafted production role", orgType: domain.OrganizationTypeStore, actor: "actor", actorRoles: []string{string(domain.RoleGerenteVentas)}, target: storage.OrgTeamMember{MembershipID: "target-membership", UserID: "target", Roles: []domain.UserRole{domain.RoleVendedor}}, body: `{"roles":["produccion"]}`, want: http.StatusBadRequest},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv, store := teamCapabilityServer(tt.orgType, []storage.OrgTeamMember{tt.target})
			rr := httptest.NewRecorder()
			srv.HandleOrgMemberRoles(rr, teamCapabilityRequest(http.MethodPut, "/api/org/memberships/target-membership/roles", tt.actor, tt.actorRoles, tt.body))
			if rr.Code != tt.want {
				t.Fatalf("status = %d, want %d: %s", rr.Code, tt.want, rr.Body.String())
			}
			if store.rolesUpdated != tt.updated {
				t.Fatalf("rolesUpdated = %t, want %t", store.rolesUpdated, tt.updated)
			}
		})
	}
}

func TestOrgMemberStatusCapabilities(t *testing.T) {
	tests := []struct {
		name        string
		actorRoles  []string
		targetRoles []domain.UserRole
		want        int
		updated     bool
	}{
		{name: "sales manager suspends vendedor", actorRoles: []string{string(domain.RoleGerenteVentas)}, targetRoles: []domain.UserRole{domain.RoleVendedor}, want: http.StatusOK, updated: true},
		{name: "production manager suspends warehouse worker", actorRoles: []string{string(domain.RoleGerenteProduccion)}, targetRoles: []domain.UserRole{domain.RoleAlmacen}, want: http.StatusOK, updated: true},
		{name: "sales manager cannot suspend generic user", actorRoles: []string{string(domain.RoleGerenteVentas)}, targetRoles: []domain.UserRole{domain.RoleUser}, want: http.StatusForbidden},
		{name: "mixed managers suspend mixed target", actorRoles: []string{string(domain.RoleGerenteVentas), string(domain.RoleGerenteProduccion)}, targetRoles: []domain.UserRole{domain.RoleVendedor, domain.RoleProduccion}, want: http.StatusOK, updated: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			target := storage.OrgTeamMember{MembershipID: "target-membership", UserID: "target", Roles: tt.targetRoles}
			srv, store := teamCapabilityServer(domain.OrganizationTypeFactory, []storage.OrgTeamMember{target})
			rr := httptest.NewRecorder()
			srv.HandleOrgMemberStatus(rr, teamCapabilityRequest(http.MethodPut, "/api/org/memberships/target-membership/status", "actor", tt.actorRoles, `{"status":"suspended","reason":"staffing change"}`))
			if rr.Code != tt.want {
				t.Fatalf("status = %d, want %d: %s", rr.Code, tt.want, rr.Body.String())
			}
			if store.statusUpdated != tt.updated {
				t.Fatalf("statusUpdated = %t, want %t", store.statusUpdated, tt.updated)
			}
		})
	}
}

func TestOrgMemberStatusRequiresReasonToSuspend(t *testing.T) {
	target := storage.OrgTeamMember{MembershipID: "target-membership", UserID: "target", Roles: []domain.UserRole{domain.RoleVendedor}}
	srv, store := teamCapabilityServer(domain.OrganizationTypeFactory, []storage.OrgTeamMember{target})
	rr := httptest.NewRecorder()
	srv.HandleOrgMemberStatus(rr, teamCapabilityRequest(http.MethodPut, "/api/org/memberships/target-membership/status", "actor", []string{string(domain.RoleAdmin)}, `{"status":"suspended","reason":"   "}`))
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d: %s", rr.Code, http.StatusBadRequest, rr.Body.String())
	}
	if store.statusUpdated {
		t.Fatal("suspension without a reason must not write")
	}
}

func TestOrgMemberMutationsMapNamedTeamInvariantConstraints(t *testing.T) {
	tests := []struct {
		name       string
		constraint string
		handle     func(*Server, http.ResponseWriter, *http.Request)
		body       string
		configure  func(*teamCapabilitiesStore, error)
		wantCode   string
	}{
		{
			name:       "role mutation preserves last admin error",
			constraint: organizationRequiresActiveAdminConstraint,
			handle:     (*Server).HandleOrgMemberRoles,
			body:       `{"roles":["vendedor"]}`,
			configure:  func(store *teamCapabilitiesStore, err error) { store.rolesErr = err },
			wantCode:   string(openapi.ApiErrorCodeLastAdmin),
		},
		{
			name:       "status mutation preserves seat limit error",
			constraint: organizationActiveMemberSeatLimitConstraint,
			handle:     (*Server).HandleOrgMemberStatus,
			body:       `{"status":"suspended","reason":"staffing change"}`,
			configure:  func(store *teamCapabilitiesStore, err error) { store.statusErr = err },
			wantCode:   string(openapi.ApiErrorCodeSeatLimitReached),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			target := storage.OrgTeamMember{MembershipID: "target-membership", UserID: "target", Roles: []domain.UserRole{domain.RoleVendedor}}
			srv, store := teamCapabilityServer(domain.OrganizationTypeFactory, []storage.OrgTeamMember{target})
			tt.configure(store, &pgconn.PgError{Code: "23514", ConstraintName: tt.constraint})
			rr := httptest.NewRecorder()
			tt.handle(srv, rr, teamCapabilityRequest(http.MethodPut, "/api/org/memberships/target-membership", "actor", []string{string(domain.RoleAdmin)}, tt.body))
			if rr.Code != http.StatusConflict {
				t.Fatalf("status = %d, want %d: %s", rr.Code, http.StatusConflict, rr.Body.String())
			}
			if !strings.Contains(rr.Body.String(), `"code":"`+tt.wantCode+`"`) {
				t.Fatalf("typed error missing %s: %s", tt.wantCode, rr.Body.String())
			}
		})
	}
}

func TestOrgTeamDirectoryReturnsAuthoritativeSummaryAndCapabilities(t *testing.T) {
	target := storage.OrgTeamMember{MembershipID: "target-membership", UserID: "target", Email: "target@example.test", Name: "Target", AccountStatus: domain.AccountStatusActive, Status: domain.MembershipStatusSuspended, Roles: []domain.UserRole{domain.RoleVendedor}, Version: 2}
	srv, store := teamCapabilityServer(domain.OrganizationTypeFactory, []storage.OrgTeamMember{target})
	store.summary = &storage.OrgTeamSummary{ActiveMembers: 2, SuspendedMembers: 1, LeftMembers: 3, TeamVersion: 7, EntitlementsVersion: 5}

	rr := httptest.NewRecorder()
	srv.HandleOrgTeam(rr, teamCapabilityRequest(http.MethodGet, "/api/org/memberships", "actor", []string{string(domain.RoleGerenteVentas)}, ""))
	if rr.Code != http.StatusOK {
		t.Fatalf("directory status = %d: %s", rr.Code, rr.Body.String())
	}
	var directory openapi.TeamDirectory
	if err := json.NewDecoder(rr.Body).Decode(&directory); err != nil {
		t.Fatal(err)
	}
	if directory.Summary.ActiveMembers != 2 || directory.Summary.MaxActiveMembers != nil || directory.Summary.TeamVersion != 7 || len(directory.Items) != 1 {
		t.Fatalf("directory summary/items = %#v", directory)
	}
	if got := directory.Summary.Capabilities; len(got) != 3 || got[0] != openapi.TeamCapabilityTeamView {
		t.Fatalf("capabilities = %#v", got)
	}

	rr = httptest.NewRecorder()
	srv.HandleOrgTeamSummary(rr, teamCapabilityRequest(http.MethodGet, "/api/org/team/summary", "actor", []string{string(domain.RoleGerenteVentas)}, ""))
	if rr.Code != http.StatusOK {
		t.Fatalf("summary status = %d: %s", rr.Code, rr.Body.String())
	}
	var summary openapi.TeamSummary
	if err := json.NewDecoder(rr.Body).Decode(&summary); err != nil {
		t.Fatal(err)
	}
	if summary.LeftMembers != 3 || summary.EntitlementsVersion != 5 {
		t.Fatalf("summary = %#v", summary)
	}
}
