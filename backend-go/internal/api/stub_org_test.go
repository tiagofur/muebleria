package api

// Contrato: stub del stubStore espejo de store_org (store_org.go). Los
// métodos se movieron tal cual desde handlers_test.go (Fase B #1017);
// las firmas son las de la sub-interface en store_org.go
import (
	"context"
	"errors"
	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
	"time"
)

// GetOrganizationByID mirrors the stub's single-user world onto the scoped
// organization: the furniture license gate moved from the user to the
// organization (ADR-0004), so legacy license tests keep their intent when the
// org carries the same plan/expiry as the configured user.
func (s *stubStore) GetOrganizationByID(_ context.Context, _ string) (*domain.Organization, error) {
	if s.getOrgByID != nil {
		return s.getOrgByID, nil
	}
	if s.getUserByEmail != nil {
		// Single-user world: an active factory org; the test controls the
		// license through orgLicensePlan/orgLicenseExpiresAt (user licensing
		// is gone — ADR-0005 §3).
		plan := s.orgLicensePlan
		if plan == "" {
			plan = domain.LicensePlanTrial
		}
		return &domain.Organization{
			ID:               storage.InitialOrganizationID,
			Name:             "Taller Test",
			Slug:             "taller-test",
			Type:             domain.OrganizationTypeFactory,
			LicensePlan:      plan,
			LicenseExpiresAt: s.orgLicenseExpiresAt,
			Status:           domain.OrganizationStatusActive, CredentialVersion: 1,
		}, nil
	}
	return nil, errors.New("organization not found")
}

func (s *stubStore) GetOrganizationBySlug(context.Context, string) (*domain.Organization, error) {
	return nil, errors.New("organization not found")
}

func (s *stubStore) ListOrganizations(context.Context) ([]domain.Organization, error) {
	return nil, nil
}

func (s *stubStore) CreateOrganization(_ context.Context, o *domain.Organization) error {
	if o.ID == "" {
		o.ID = "new-org-1"
	}
	if o.Version == 0 {
		o.Version = 1
	}
	if o.CreatedAt.IsZero() {
		o.CreatedAt = time.Now()
	}
	s.createdOrgs = append(s.createdOrgs, o)
	return nil
}

func (s *stubStore) ListConnectedOrganizations(_ context.Context, _ string) ([]domain.Organization, error) {
	if s.listConnectedOrgs != nil {
		return s.listConnectedOrgs, nil
	}
	return []domain.Organization{}, nil
}

func (s *stubStore) ListMembershipsByUser(_ context.Context, userID string) ([]domain.MembershipWithOrg, error) {
	if s.membershipsByUser != nil {
		return s.membershipsByUser[userID], nil
	}
	return nil, nil
}

func (s *stubStore) GetActiveMembership(_ context.Context, userID, organizationID string) (*domain.MembershipWithOrg, error) {
	if s.getActiveMembershipErr != nil {
		return nil, s.getActiveMembershipErr
	}
	if s.getActiveMembershipEmpty {
		return nil, nil
	}
	if s.membershipsByUser != nil {
		for _, m := range s.membershipsByUser[userID] {
			if m.OrganizationID == organizationID {
				return &m, nil
			}
		}
		return nil, storage.ErrMembershipNotFound
	}
	// Default single-organization world: every stub user is an active admin
	// of whatever organization the token names, unless the test simulates
	// explicit memberships (ADR-0005 middleware re-validates per request).
	return &domain.MembershipWithOrg{
		Membership: domain.Membership{
			ID: userID + ":" + organizationID, OrganizationID: organizationID, UserID: userID,
			Roles: []domain.UserRole{domain.RoleAdmin}, Status: domain.MembershipStatusActive,
			CredentialVersion: 1,
		},
		Organization: domain.Organization{
			ID: organizationID, Status: domain.OrganizationStatusActive, CredentialVersion: 1, Type: domain.OrganizationTypeFactory,
		},
	}, nil
}

func (s *stubStore) EnsureMembership(context.Context, string, string, []domain.UserRole) error {
	return nil
}

func (s *stubStore) SetPlatformAdmin(context.Context, string, bool) error {
	return nil
}

func (s *stubStore) InsertSecurityAuditEvent(_ context.Context, ev storage.SecurityAuditEvent) error {
	s.auditEvents = append(s.auditEvents, ev)
	return nil
}

func (s *stubStore) UpdateOrganization(context.Context, *domain.Organization) error { return nil }

func (s *stubStore) UpdateOrganizationVersion(_ context.Context, o *domain.Organization, expected int64) error {
	o.Version = expected + 1
	return nil
}

func (s *stubStore) CloneCatalog(context.Context, string, string) error { return nil }

func (s *stubStore) StartSupportSession(context.Context, string, string, string, time.Duration, int64) (*domain.SupportSession, error) {
	return &domain.SupportSession{ID: "ss-1", PlatformAdminUserID: "pa-1", OrganizationID: "org-1", Reason: "soporte", OrganizationCredentialVersion: 1}, nil
}

func (s *stubStore) GetOpenSupportSession(context.Context, string) (*domain.SupportSession, error) {
	return nil, storage.ErrSupportSessionNotFound
}

func (s *stubStore) EndOpenSupportSessionsByOrg(context.Context, string, string) (int64, error) {
	return 0, nil
}

func (s *stubStore) EndSupportSession(context.Context, string, string, string) (bool, error) {
	return true, nil
}

func (s *stubStore) ListOrgTeam(context.Context, string, string) ([]storage.OrgTeamMember, error) {
	return nil, nil
}

func (s *stubStore) GetOrgTeamSummary(context.Context, string, string) (*storage.OrgTeamSummary, error) {
	return &storage.OrgTeamSummary{TeamVersion: 1, EntitlementsVersion: 1}, nil
}

func (s *stubStore) UpdateMembershipRolesByOrg(_ context.Context, _ string, membershipID string, roles []domain.UserRole, version int64) (*storage.OrgTeamMember, error) {
	return &storage.OrgTeamMember{MembershipID: membershipID, UserID: "u-1", Roles: roles, Status: domain.MembershipStatusActive, Version: version + 1}, nil
}

func (s *stubStore) UpdateMembershipStatus(_ context.Context, _ string, membershipID string, status domain.MembershipStatus, _ string, _ string, version int64) (*storage.OrgTeamMember, error) {
	return &storage.OrgTeamMember{MembershipID: membershipID, UserID: "u-1", Status: status, Version: version + 1}, nil
}

func (s *stubStore) RevokeMembershipSessions(_ context.Context, _ string, membershipID, _ string, _ string, version int64) (*storage.OrgTeamMember, error) {
	return &storage.OrgTeamMember{MembershipID: membershipID, UserID: "u-1", Status: domain.MembershipStatusActive, Version: version + 1}, nil
}

func (s *stubStore) GetMembershipResponsibilityInventory(_ context.Context, membershipID string) (*storage.MembershipResponsibilityInventory, error) {
	return &storage.MembershipResponsibilityInventory{OrganizationID: "org-1", MembershipID: membershipID, UserID: "u-1"}, nil
}

func (s *stubStore) CreateInvitation(_ context.Context, orgID string, email string, roles []domain.UserRole, _ string, _ time.Time, _ string) (*storage.Invitation, error) {
	return &storage.Invitation{ID: "inv-1", OrganizationID: orgID, Email: email, Status: "pending", Roles: roles}, nil
}

func (s *stubStore) ListInvitations(context.Context, string, string) ([]storage.Invitation, error) {
	return nil, nil
}

func (s *stubStore) ResendInvitation(_ context.Context, orgID, id, _ string, _ time.Time, version int64) (*storage.Invitation, error) {
	return &storage.Invitation{ID: id, OrganizationID: orgID, Status: "pending", Version: version + 1}, nil
}

func (s *stubStore) RevokeInvitation(_ context.Context, orgID, id, reason, actor string, version int64) (*storage.Invitation, error) {
	now := time.Now()
	return &storage.Invitation{ID: id, OrganizationID: orgID, Status: "revoked", Version: version + 1, RevokedAt: &now, RevokedReason: &reason, RevokedBy: &actor}, nil
}

func (s *stubStore) AcceptInvitation(context.Context, storage.AcceptInvitationCommand, func(string, string) bool, func(string) error) (*storage.AcceptInvitationResult, error) {
	return nil, storage.ErrInvitationNotFound
}

func (s *stubStore) ListSecurityAuditEvents(context.Context, string, int) ([]openapi.SecurityAuditEvent, error) {
	return nil, nil
}

func (s *stubStore) GetUserByEmailAnyState(_ context.Context, email string) (*domain.User, error) {
	if s.getUserByEmail != nil && s.getUserByEmail.Email == email {
		return s.getUserByEmail, nil
	}
	return nil, errors.New("user not found")
}

// #403 / MT-2 — ambiguous material binding roles are surfaced at authoring
// time. The validation must reject BEFORE any store call (stubStore panics on
// unexpected calls, so reaching the store would fail the test).
