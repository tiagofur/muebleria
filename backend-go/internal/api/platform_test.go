package api

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

const (
	platformActorTestUserID = "00000000-0000-0000-0000-000000000101"
	platformActorTestOrgID  = "00000000-0000-0000-0000-000000000102"
)

type platformActorTestStore struct {
	stubStore
	transactionActor storage.TenantActor
	setActor         storage.TenantActor
	updateActor      storage.TenantActor
	auditActor       storage.TenantActor
	updateCalls      int
}

func (s *platformActorTestStore) WithinTenantTx(ctx context.Context, actor storage.TenantActor, execute func(context.Context) error) error {
	s.transactionActor = actor
	return execute(storage.WithTenantActorCtx(ctx, actor))
}

func (s *platformActorTestStore) SetTenantActor(ctx context.Context, actor storage.TenantActor) (context.Context, error) {
	s.setActor = actor
	return storage.WithTenantActorCtx(ctx, actor), nil
}

func (s *platformActorTestStore) UpdateOrganizationVersion(ctx context.Context, organization *domain.Organization, expectedVersion int64) error {
	actor, ok := storage.TenantActorFromCtx(ctx)
	if !ok || actor.UserID != platformActorTestUserID || actor.OrganizationID != "" {
		return errors.New("platform update requires an organization-free platform actor")
	}
	s.updateActor = actor
	s.updateCalls++
	organization.Version = expectedVersion + 1
	return nil
}

func (s *platformActorTestStore) InsertSecurityAuditEvent(ctx context.Context, event storage.SecurityAuditEvent) error {
	actor, ok := storage.TenantActorFromCtx(ctx)
	if !ok || actor.UserID != platformActorTestUserID || actor.OrganizationID != "" {
		return errors.New("platform audit requires an organization-free platform actor")
	}
	s.auditActor = actor
	return s.stubStore.InsertSecurityAuditEvent(ctx, event)
}

func platformActorToken(t *testing.T, secret string, platformAdmin bool) string {
	t.Helper()
	token, err := auth.GenerateLegacyWebToken(platformActorTestUserID, "platform@test.com", auth.TokenContext{
		PlatformAdmin:                 platformAdmin,
		OrgID:                         platformActorTestOrgID,
		Roles:                         []string{string(domain.RoleAdmin)},
		MembershipID:                  "00000000-0000-0000-0000-000000000103",
		MembershipCredentialVersion:   1,
		OrganizationCredentialVersion: 1,
	}, secret)
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func TestPlatformUpdateOrganizationClearsActiveWorkshopActor(t *testing.T) {
	const secret = "platform-context-test-secret-0123456789"
	store := &platformActorTestStore{stubStore: stubStore{
		getUserByEmail: &domain.User{ID: platformActorTestUserID, Email: "platform@test.com", AccountStatus: domain.AccountStatusActive, PlatformAdmin: true},
		membershipsByUser: map[string][]domain.MembershipWithOrg{
			platformActorTestUserID: {{
				Membership:   domain.Membership{ID: "00000000-0000-0000-0000-000000000103", UserID: platformActorTestUserID, OrganizationID: platformActorTestOrgID, Roles: []domain.UserRole{domain.RoleAdmin}, Status: domain.MembershipStatusActive, CredentialVersion: 1},
				Organization: domain.Organization{ID: platformActorTestOrgID, Status: domain.OrganizationStatusActive, CredentialVersion: 1},
			}},
		},
		getOrgByID: &domain.Organization{ID: platformActorTestOrgID, Name: "Taller", Type: domain.OrganizationTypeFactory, LicensePlan: domain.LicensePlanTrial, Status: domain.OrganizationStatusActive, CredentialVersion: 1, Version: 2, CreatedAt: time.Now(), UpdatedAt: time.Now()},
	}}
	server := NewServer(store, secret, nil, 1, 1)
	handler := PlatformAdminMiddleware(mustAuthority(secret), store)(http.HandlerFunc(server.HandlePlatformUpdateOrganization))

	req := httptest.NewRequest(http.MethodPatch, "/api/platform/organizations/"+platformActorTestOrgID, bytes.NewBufferString(`{"license_plan":"pro"}`))
	req.SetPathValue("id", platformActorTestOrgID)
	req.Header.Set("Authorization", "Bearer "+platformActorToken(t, secret, true))
	req.Header.Set("If-Match", `"v2"`)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if store.transactionActor.OrganizationID != platformActorTestOrgID {
		t.Fatalf("auth transaction actor organization=%q, want selected workshop", store.transactionActor.OrganizationID)
	}
	if store.setActor.UserID != platformActorTestUserID || store.setActor.OrganizationID != "" {
		t.Fatalf("platform actor=%+v, want user-only actor", store.setActor)
	}
	if store.updateCalls != 1 || store.updateActor.OrganizationID != "" || store.auditActor.OrganizationID != "" {
		t.Fatalf("updateCalls=%d updateActor=%+v auditActor=%+v", store.updateCalls, store.updateActor, store.auditActor)
	}
	if len(store.auditEvents) != 1 || store.auditEvents[0].EventType != "organization_license_updated" {
		t.Fatalf("audit=%+v", store.auditEvents)
	}
}

func TestPlatformUpdateOrganizationRejectsTenantAdmin(t *testing.T) {
	const secret = "platform-context-test-secret-0123456789"
	store := &platformActorTestStore{stubStore: stubStore{
		getUserByEmail: &domain.User{ID: platformActorTestUserID, Email: "tenant@test.com", AccountStatus: domain.AccountStatusActive},
		membershipsByUser: map[string][]domain.MembershipWithOrg{
			platformActorTestUserID: {{
				Membership:   domain.Membership{ID: "00000000-0000-0000-0000-000000000103", UserID: platformActorTestUserID, OrganizationID: platformActorTestOrgID, Roles: []domain.UserRole{domain.RoleAdmin}, Status: domain.MembershipStatusActive, CredentialVersion: 1},
				Organization: domain.Organization{ID: platformActorTestOrgID, Status: domain.OrganizationStatusActive, CredentialVersion: 1},
			}},
		},
	}}
	server := NewServer(store, secret, nil, 1, 1)
	handler := PlatformAdminMiddleware(mustAuthority(secret), store)(http.HandlerFunc(server.HandlePlatformUpdateOrganization))

	req := httptest.NewRequest(http.MethodPatch, "/api/platform/organizations/"+platformActorTestOrgID, bytes.NewBufferString(`{"license_plan":"pro"}`))
	req.SetPathValue("id", platformActorTestOrgID)
	req.Header.Set("Authorization", "Bearer "+platformActorToken(t, secret, false))
	req.Header.Set("If-Match", `"v2"`)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if store.updateCalls != 0 || len(store.auditEvents) != 0 {
		t.Fatalf("tenant admin mutated platform state: updates=%d audits=%d", store.updateCalls, len(store.auditEvents))
	}
}
