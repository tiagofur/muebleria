package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

type teamCapabilitiesStore struct {
	*stubStore
	team              []storage.OrgTeamMember
	rolesUpdated      bool
	statusUpdated     bool
	sessionsRevoked   bool
	rolesErr          error
	statusErr         error
	revokeErr         error
	summary           *storage.OrgTeamSummary
	inventory         *storage.MembershipResponsibilityInventory
	inventoryErr      error
	auditEvent        string
	auditDetails      map[string]interface{}
	invitations       []storage.Invitation
	invitationCreated bool
	adminTransferred  bool
	sectorsChanged    bool
	offboarded        bool
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

func (s *teamCapabilitiesStore) RevokeMembershipSessions(_ context.Context, _ string, membershipID, _ string, _ string, version int64) (*storage.OrgTeamMember, error) {
	s.sessionsRevoked = true
	if s.revokeErr != nil {
		return nil, s.revokeErr
	}
	return &storage.OrgTeamMember{MembershipID: membershipID, UserID: "target", Status: domain.MembershipStatusActive, Version: version + 1}, nil
}
func (s *teamCapabilitiesStore) GetMembershipResponsibilityInventory(_ context.Context, membershipID string) (*storage.MembershipResponsibilityInventory, error) {
	if s.inventoryErr != nil {
		return nil, s.inventoryErr
	}
	if s.inventory != nil {
		return s.inventory, nil
	}
	return &storage.MembershipResponsibilityInventory{OrganizationID: "org-1", MembershipID: membershipID, UserID: "target"}, nil
}
func (s *teamCapabilitiesStore) GetMembershipOffboardingImpact(_ context.Context, _ string, membershipID, _ string) (*storage.MembershipResponsibilityInventory, int64, string, error) {
	inventory, err := s.GetMembershipResponsibilityInventory(context.Background(), membershipID)
	if err != nil {
		return nil, 0, "", err
	}
	version := int64(1)
	for _, member := range s.team {
		if member.MembershipID == membershipID {
			version = member.Version
			break
		}
	}
	return inventory, version, strings.Repeat("a", 64), nil
}
func (s *teamCapabilitiesStore) InsertSecurityAuditEvent(_ context.Context, event storage.SecurityAuditEvent) error {
	s.auditEvent, s.auditDetails = event.EventType, event.Details
	return nil
}
func (s *teamCapabilitiesStore) ListInvitations(context.Context, string, string) ([]storage.Invitation, error) {
	return s.invitations, nil
}
func (s *teamCapabilitiesStore) CreateInvitation(_ context.Context, orgID, email string, roles []domain.UserRole, _ string, expires time.Time, actor string) (*storage.Invitation, error) {
	s.invitationCreated = true
	return &storage.Invitation{ID: "inv-1", OrganizationID: orgID, Email: email, Roles: roles, Status: "pending", ExpiresAt: expires, CreatedAt: time.Now(), InvitedBy: &actor, Version: 1}, nil
}
func (s *teamCapabilitiesStore) TransferOrganizationAdmin(_ context.Context, command storage.TransferOrganizationAdminCommand) (*storage.AdminTransferResult, error) {
	s.adminTransferred = true
	return &storage.AdminTransferResult{
		Source: &storage.OrgTeamMember{MembershipID: command.SourceMembershipID, UserID: "actor", Status: domain.MembershipStatusActive, Roles: []domain.UserRole{domain.RoleUser}, Version: command.ExpectedSourceVersion + 1},
		Target: &storage.OrgTeamMember{MembershipID: command.TargetMembershipID, UserID: "target", Status: domain.MembershipStatusActive, Roles: []domain.UserRole{domain.RoleAdmin}, Version: command.ExpectedTargetVersion + 1},
	}, nil
}
func (s *teamCapabilitiesStore) ChangeMembershipSectors(_ context.Context, command storage.ChangeMembershipSectorsCommand) (*storage.MembershipSectorChangeResult, error) {
	s.sectorsChanged = true
	return &storage.MembershipSectorChangeResult{Member: storage.OrgTeamMember{MembershipID: command.MembershipID, UserID: "target", Status: domain.MembershipStatusActive, Roles: []domain.UserRole{domain.RoleProduccion}, Version: command.ExpectedMembershipVersion + 1}, Sectors: command.Sectors}, nil
}
func (s *teamCapabilitiesStore) OffboardMember(_ context.Context, command storage.OffboardMemberCommand) (*storage.OffboardMemberResult, error) {
	s.offboarded = true
	return &storage.OffboardMemberResult{Member: storage.OrgTeamMember{MembershipID: command.MembershipID, UserID: "target", Status: domain.MembershipStatusLeft, Roles: []domain.UserRole{domain.RoleVendedor}, Version: command.ExpectedMembershipVersion + 1}}, nil
}

func teamCapabilityServer(orgType domain.OrganizationType, team []storage.OrgTeamMember) (*Server, *teamCapabilitiesStore) {
	store := &teamCapabilitiesStore{
		stubStore: &stubStore{getOrgByID: &domain.Organization{ID: "org-1", Type: orgType, Status: domain.OrganizationStatusActive, CredentialVersion: 1}},
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

func TestInvitationCapabilitiesAllowOnlyManagerRoleSubset(t *testing.T) {
	tests := []struct {
		name       string
		actorRoles []string
		body       string
		want       int
		created    bool
	}{
		{name: "sales manager invites seller", actorRoles: []string{string(domain.RoleGerenteVentas)}, body: `{"email":"seller@example.com","roles":["vendedor"]}`, want: http.StatusCreated, created: true},
		{name: "sales manager cannot invite production", actorRoles: []string{string(domain.RoleGerenteVentas)}, body: `{"email":"worker@example.com","roles":["produccion"]}`, want: http.StatusForbidden},
		{name: "production manager invites warehouse", actorRoles: []string{string(domain.RoleGerenteProduccion)}, body: `{"email":"warehouse@example.com","roles":["almacen"]}`, want: http.StatusCreated, created: true},
		{name: "production manager cannot invite admin", actorRoles: []string{string(domain.RoleGerenteProduccion)}, body: `{"email":"admin@example.com","roles":["admin"]}`, want: http.StatusForbidden},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv, store := teamCapabilityServer(domain.OrganizationTypeFactory, nil)
			rr := httptest.NewRecorder()
			srv.HandleOrgCreateInvitation(rr, teamCapabilityRequest(http.MethodPost, "/api/org/invitations", "actor", tt.actorRoles, tt.body))
			if rr.Code != tt.want || store.invitationCreated != tt.created {
				t.Fatalf("status=%d created=%t body=%s", rr.Code, store.invitationCreated, rr.Body.String())
			}
		})
	}
}

func TestInvitationListUsesTeamViewCapability(t *testing.T) {
	srv, _ := teamCapabilityServer(domain.OrganizationTypeFactory, nil)
	rr := httptest.NewRecorder()
	srv.HandleOrgListInvitations(rr, teamCapabilityRequest(http.MethodGet, "/api/org/invitations", "actor", []string{string(domain.RoleGerenteVentas)}, ""))
	if rr.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rr.Code, rr.Body.String())
	}
}

func TestCanonicalAdministrationCommandsReachTransactionalStore(t *testing.T) {
	target := storage.OrgTeamMember{MembershipID: "target-membership", UserID: "target", Roles: []domain.UserRole{domain.RoleProduccion}, Status: domain.MembershipStatusActive, Version: 1}
	tests := []struct {
		name   string
		handle func(*Server, http.ResponseWriter, *http.Request)
		path   string
		roles  []string
		body   string
		assert func(*teamCapabilitiesStore) bool
	}{
		{name: "transfer admin", handle: (*Server).HandleTransferOrganizationAdmin, path: "/api/org/memberships/source-membership:transfer-admin", roles: []string{string(domain.RoleAdmin)}, body: `{"target_membership_id":"target-membership","target_version":1,"demote_source":true,"reason":"handoff"}`, assert: func(s *teamCapabilitiesStore) bool { return s.adminTransferred }},
		{name: "change sectors", handle: (*Server).HandleChangeMembershipSectors, path: "/api/org/memberships/target-membership:change-sectors", roles: []string{string(domain.RoleGerenteProduccion)}, body: `{"sectors":["cutting"],"reason":"line assignment"}`, assert: func(s *teamCapabilitiesStore) bool { return s.sectorsChanged }},
		{name: "offboard", handle: (*Server).HandleOffboardMembership, path: "/api/org/memberships/target-membership:offboard", roles: []string{string(domain.RoleAdmin)}, body: `{"impact_version":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","reason":"employment ended","reassignment":{}}`, assert: func(s *teamCapabilitiesStore) bool { return s.offboarded }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv, store := teamCapabilityServer(domain.OrganizationTypeFactory, []storage.OrgTeamMember{target})
			req := teamCapabilityRequest(http.MethodPost, tt.path, "actor", tt.roles, tt.body)
			if strings.Contains(tt.path, "source-membership") {
				req.SetPathValue("membershipId", "source-membership")
			}
			rr := httptest.NewRecorder()
			tt.handle(srv, rr, req)
			if rr.Code != http.StatusOK || !tt.assert(store) {
				t.Fatalf("status=%d called=%t body=%s", rr.Code, tt.assert(store), rr.Body.String())
			}
		})
	}
}

func TestOrgTeamMemberReturnsMembershipOwnedReadModel(t *testing.T) {
	lastActivity := time.Date(2026, time.August, 30, 12, 0, 0, 0, time.UTC)
	revokedAt := lastActivity.Add(time.Hour)
	target := storage.OrgTeamMember{MembershipID: "target-membership", UserID: "target", Email: "target@example.test", Name: "Target", AccountStatus: domain.AccountStatusActive, Status: domain.MembershipStatusActive, Roles: []domain.UserRole{domain.RoleProduccion}, JoinedAt: time.Now(), Version: 2, LastActivity: &lastActivity, CredentialVersion: 3, SessionsRevokedAt: &revokedAt, Sectors: []domain.ProductionSector{domain.SectorCutting}, OffboardingBlockingCount: 1}
	srv, _ := teamCapabilityServer(domain.OrganizationTypeFactory, []storage.OrgTeamMember{target})
	req := teamCapabilityRequest(http.MethodGet, "/api/org/memberships/target-membership", "actor", []string{string(domain.RoleGerenteProduccion)}, "")
	rr := httptest.NewRecorder()
	srv.HandleOrgTeamMember(rr, req)
	if rr.Code != http.StatusOK || rr.Header().Get("ETag") != `"v2"` {
		t.Fatalf("status=%d etag=%q body=%s", rr.Code, rr.Header().Get("ETag"), rr.Body.String())
	}
	var member openapi.TeamMember
	if err := json.Unmarshal(rr.Body.Bytes(), &member); err != nil {
		t.Fatal(err)
	}
	if len(member.Sectors) != 1 || member.Sectors[0] != openapi.ProductionSectorCutting || member.OffboardingBlockingCount != 1 || member.LastActivity == nil || *member.LastActivity != lastActivity.Format(time.RFC3339Nano) || member.CredentialVersion != 3 || member.SessionsRevokedAt == nil || *member.SessionsRevokedAt != revokedAt.Format(time.RFC3339Nano) {
		t.Fatalf("member=%+v", member)
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

func TestCanonicalTeamCommandsUseNarrowGeneratedBodies(t *testing.T) {
	target := storage.OrgTeamMember{MembershipID: "target-membership", UserID: "target", Roles: []domain.UserRole{domain.RoleVendedor}}
	tests := []struct {
		name   string
		handle func(*Server, http.ResponseWriter, *http.Request)
		path   string
		body   string
		assert func(*teamCapabilitiesStore) bool
	}{
		{name: "change roles", handle: (*Server).HandleChangeMembershipRoles, path: "/api/org/memberships/target-membership:change-roles", body: `{"roles":["vendedor"]}`, assert: func(s *teamCapabilitiesStore) bool { return s.rolesUpdated }},
		{name: "suspend", handle: (*Server).HandleSuspendMembership, path: "/api/org/memberships/target-membership:suspend", body: `{"reason":"staffing change"}`, assert: func(s *teamCapabilitiesStore) bool { return s.statusUpdated }},
		{name: "reactivate", handle: (*Server).HandleReactivateMembership, path: "/api/org/memberships/target-membership:reactivate", body: "", assert: func(s *teamCapabilitiesStore) bool { return s.statusUpdated }},
		{name: "revoke sessions", handle: (*Server).HandleRevokeMembershipSessions, path: "/api/org/memberships/target-membership:revoke-sessions", body: `{"reason":"device lost"}`, assert: func(s *teamCapabilitiesStore) bool { return s.sessionsRevoked }},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			srv, store := teamCapabilityServer(domain.OrganizationTypeFactory, []storage.OrgTeamMember{target})
			rr := httptest.NewRecorder()
			tt.handle(srv, rr, teamCapabilityRequest(http.MethodPost, tt.path, "actor", []string{string(domain.RoleAdmin)}, tt.body))
			if rr.Code != http.StatusOK || !tt.assert(store) {
				t.Fatalf("status=%d wrote=%t body=%s", rr.Code, tt.assert(store), rr.Body.String())
			}
		})
	}
}

func TestCanonicalRevokeSessionsRequiresCapabilityAndReason(t *testing.T) {
	target := storage.OrgTeamMember{MembershipID: "target-membership", UserID: "target", Roles: []domain.UserRole{domain.RoleVendedor}}
	srv, store := teamCapabilityServer(domain.OrganizationTypeFactory, []storage.OrgTeamMember{target})
	for _, tt := range []struct {
		roles []string
		body  string
		want  int
	}{
		{roles: []string{string(domain.RoleGerenteVentas)}, body: `{"reason":"device lost"}`, want: http.StatusForbidden},
		{roles: []string{string(domain.RoleAdmin)}, body: `{"reason":"   "}`, want: http.StatusBadRequest},
	} {
		rr := httptest.NewRecorder()
		srv.HandleRevokeMembershipSessions(rr, teamCapabilityRequest(http.MethodPost, "/api/org/memberships/target-membership:revoke-sessions", "actor", tt.roles, tt.body))
		if rr.Code != tt.want {
			t.Fatalf("status=%d want=%d body=%s", rr.Code, tt.want, rr.Body.String())
		}
	}
	if store.sessionsRevoked {
		t.Fatal("denied revocation must not write")
	}
}

func TestMembershipOffboardingPreviewIsScopedVersionedAndDeterministic(t *testing.T) {
	target := storage.OrgTeamMember{MembershipID: "target-membership", UserID: "target", Roles: []domain.UserRole{domain.RoleVendedor}, Version: 4}
	srv, store := teamCapabilityServer(domain.OrganizationTypeFactory, []storage.OrgTeamMember{target})
	store.inventory = &storage.MembershipResponsibilityInventory{
		OrganizationID: "org-1", MembershipID: target.MembershipID, UserID: target.UserID,
		CustomerOwnershipCount: 2, SalesProjectOwnershipCount: 3, EngineerAssignmentCount: 5,
		OpenWarrantyAssignmentCount: 7, ActiveProductionClaimCount: 11,
	}

	request := teamCapabilityRequest(http.MethodPost, "/api/org/memberships/target-membership:offboarding-preview", "actor", []string{string(domain.RoleAdmin)}, "")
	request.Header.Set("If-Match", `"v4"`)
	first := httptest.NewRecorder()
	srv.HandleMembershipOffboardingPreview(first, request)
	if first.Code != http.StatusOK {
		t.Fatalf("first status=%d body=%s", first.Code, first.Body.String())
	}
	var preview openapi.MembershipOffboardingPreview
	if err := json.Unmarshal(first.Body.Bytes(), &preview); err != nil {
		t.Fatalf("decode preview: %v", err)
	}
	if preview.MembershipID != target.MembershipID || preview.MembershipVersion != 4 || preview.Inventory.TransferRequiredCount != 17 || preview.Inventory.BlockingCount != 11 {
		t.Fatalf("preview=%+v", preview)
	}
	if first.Header().Get("ETag") != `"v4"` || store.auditEvent != "membership_offboarding_previewed" || store.auditDetails["impact_version"] != preview.ImpactVersion {
		t.Fatalf("etag=%q audit=%q details=%v", first.Header().Get("ETag"), store.auditEvent, store.auditDetails)
	}

	second := httptest.NewRecorder()
	repeatedRequest := teamCapabilityRequest(http.MethodPost, "/api/org/memberships/target-membership:offboarding-preview", "actor", []string{string(domain.RoleAdmin)}, "")
	repeatedRequest.Header.Set("If-Match", `"v4"`)
	srv.HandleMembershipOffboardingPreview(second, repeatedRequest)
	if second.Code != http.StatusOK {
		t.Fatalf("repeated status=%d body=%s", second.Code, second.Body.String())
	}
	var repeated openapi.MembershipOffboardingPreview
	if err := json.Unmarshal(second.Body.Bytes(), &repeated); err != nil {
		t.Fatalf("decode repeated preview: %v", err)
	}
	if repeated.ImpactVersion != preview.ImpactVersion {
		t.Fatalf("impact version changed: %q != %q", repeated.ImpactVersion, preview.ImpactVersion)
	}
}

func TestMembershipOffboardingPreviewRejectsStaleOrUnmanageableTarget(t *testing.T) {
	target := storage.OrgTeamMember{MembershipID: "target-membership", UserID: "target", Roles: []domain.UserRole{domain.RoleProduccion}, Version: 4}
	srv, _ := teamCapabilityServer(domain.OrganizationTypeFactory, []storage.OrgTeamMember{target})
	stale := teamCapabilityRequest(http.MethodPost, "/api/org/memberships/target-membership:offboarding-preview", "actor", []string{string(domain.RoleAdmin)}, "")
	stale.Header.Set("If-Match", `"v3"`)
	staleResult := httptest.NewRecorder()
	srv.HandleMembershipOffboardingPreview(staleResult, stale)
	if staleResult.Code != http.StatusPreconditionFailed {
		t.Fatalf("stale status=%d body=%s", staleResult.Code, staleResult.Body.String())
	}

	denied := httptest.NewRecorder()
	srv.HandleMembershipOffboardingPreview(denied, teamCapabilityRequest(http.MethodPost, "/api/org/memberships/target-membership:offboarding-preview", "sales-manager", []string{string(domain.RoleGerenteVentas)}, ""))
	if denied.Code != http.StatusForbidden {
		t.Fatalf("scope status=%d body=%s", denied.Code, denied.Body.String())
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
