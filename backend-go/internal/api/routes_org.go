package api

import (
	"github.com/tiagofur/muebles-backend/internal/domain"
	"net/http"
)

// Contrato: equipo de la org, membresías, sesiones por membresía,
// invitaciones y aceptación pública (#326, SEC-7).
func registerOrgRoutes(server *Server, mux *http.ServeMux, authRL, authMW func(http.Handler) http.Handler) {
	// Org team management (#326): active-org admin (or support session).
	mux.Handle("GET /api/org/memberships", authMW(http.HandlerFunc(server.HandleOrgTeam)))
	mux.Handle("GET /api/org/memberships/{membershipId}", authMW(http.HandlerFunc(server.HandleOrgTeamMember)))
	mux.Handle("GET /api/org/team/summary", authMW(http.HandlerFunc(server.HandleOrgTeamSummary)))
	mux.Handle("GET /api/org/memberships/{membershipId}/sessions", noStoreMiddleware(rejectSessionQueryToken(authMW(http.HandlerFunc(server.HandleListMembershipSessions)))))
	mux.Handle("POST /api/org/memberships/{membershipId}/sessions/{sessionId}/revoke", noStoreMiddleware(rejectSessionQueryToken(authMW(server.RequireIdempotency("org.revoke-membership-session", http.HandlerFunc(server.HandleRevokeMembershipSession))))))
	// #460 SEC-7: membership commands that change authority or cut access
	// wholesale (role changes, admin transfer, offboarding, mass session
	// revocation) require a fresh organization_admin step-up; reversible
	// ordinary operations (suspend/reactivate/sectors/invitations) stay on
	// the capability boundary. Step-up runs BEFORE the idempotency wrapper so
	// a challenge never consumes the command's key.
	mux.Handle("PUT /api/org/memberships/{membershipId}/roles", authMW(server.RequireStepUp(domain.StepUpScopeOrganizationAdmin, server.RequireIdempotency("org.update-membership-roles", http.HandlerFunc(server.HandleOrgMemberRoles)))))
	mux.Handle("PUT /api/org/memberships/{membershipId}/status", authMW(server.RequireIdempotency("org.update-membership-status", http.HandlerFunc(server.HandleOrgMemberStatus))))
	mux.Handle("POST /api/org/memberships/{membershipCommand...}", membershipCommandRouter(map[string]http.Handler{
		"change-roles":        authMW(server.RequireStepUp(domain.StepUpScopeOrganizationAdmin, server.RequireIdempotency("org.change-membership-roles", http.HandlerFunc(server.HandleChangeMembershipRoles)))),
		"suspend":             authMW(server.RequireIdempotency("org.suspend-membership", http.HandlerFunc(server.HandleSuspendMembership))),
		"reactivate":          authMW(server.RequireIdempotency("org.reactivate-membership", http.HandlerFunc(server.HandleReactivateMembership))),
		"revoke-sessions":     authMW(server.RequireStepUp(domain.StepUpScopeOrganizationAdmin, server.RequireIdempotency("org.revoke-membership-sessions", http.HandlerFunc(server.HandleRevokeMembershipSessions)))),
		"offboarding-preview": authMW(server.RequireIdempotency("org.offboarding-preview", http.HandlerFunc(server.HandleMembershipOffboardingPreview))),
		"transfer-admin":      authMW(server.RequireStepUp(domain.StepUpScopeOrganizationAdmin, server.RequireIdempotency("org.transfer-admin", http.HandlerFunc(server.HandleTransferOrganizationAdmin)))),
		"change-sectors":      authMW(server.RequireIdempotency("org.change-membership-sectors", http.HandlerFunc(server.HandleChangeMembershipSectors))),
		"offboard":            authMW(server.RequireStepUp(domain.StepUpScopeOrganizationAdmin, server.RequireIdempotency("org.offboard-membership", http.HandlerFunc(server.HandleOffboardMembership)))),
	}))
	mux.Handle("GET /api/org/invitations", authMW(http.HandlerFunc(server.HandleOrgListInvitations)))
	mux.Handle("POST /api/org/invitations", noStoreMiddleware(authMW(server.RequireIdempotency("org.create-invitation", http.HandlerFunc(server.HandleOrgCreateInvitation)))))
	mux.Handle("POST /api/org/invitations/{invitationCommand...}", noStoreMiddleware(authMW(http.HandlerFunc(server.HandleOrgInvitationCommand))))

	// Public invitation acceptance (rate limited like login/register).
	mux.Handle("POST /api/auth/invitations:accept", noStoreMiddleware(authRL(server.RequireIdempotency("auth.accept-invitation", http.HandlerFunc(server.HandleAcceptInvitation)))))
}
