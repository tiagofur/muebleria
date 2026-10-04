package api

import (
	"github.com/tiagofur/muebles-backend/internal/domain"
	"net/http"
)

// Contrato: consola platform (ADR-0005 §5/#326), red comercial factory y
// ciclo de vida de organizaciones con step-up platform_admin.
func registerPlatformRoutes(server *Server, mux *http.ServeMux, authMW func(http.Handler) http.Handler) {
	// Platform console (ADR-0005 §5 / #326): org lifecycle, licenses, users,
	// audit and audited support sessions. Platform staff only. #460 SEC-7:
	// support entry and the high-impact platform mutations (account status,
	// org lifecycle, entitlements) require a fresh platform_admin/support_access
	// step-up — a stolen platform bearer alone cannot silently enter a tenant
	// or disable accounts.
	platformMW := PlatformAdminMiddleware(server.tokenAuthority(), server.Store)
	mux.Handle("GET /api/platform/organizations", platformMW(http.HandlerFunc(server.HandlePlatformListOrganizations)))
	mux.Handle("PATCH /api/platform/organizations/{id}", platformMW(server.RequireStepUp(domain.StepUpScopePlatformAdmin, server.RequireIdempotency("platform.update-organization", http.HandlerFunc(server.HandlePlatformUpdateOrganization)))))
	mux.Handle("GET /api/platform/organizations/{id}/audit", platformMW(http.HandlerFunc(server.HandlePlatformOrgAudit)))
	mux.Handle("GET /api/platform/users", platformMW(http.HandlerFunc(server.HandlePlatformUsers)))
	mux.Handle("GET /api/platform/users/{userId}/sessions", noStoreMiddleware(rejectSessionQueryToken(platformMW(http.HandlerFunc(server.HandleListPlatformUserSessions)))))
	mux.Handle("POST /api/platform/users/{userId}/sessions/{sessionId}/revoke", noStoreMiddleware(rejectSessionQueryToken(platformMW(server.RequireIdempotency("platform.revoke-user-session", http.HandlerFunc(server.HandleRevokePlatformUserSession))))))
	mux.Handle("POST /api/platform/users/{userCommand...}", platformMW(server.RequireStepUp(domain.StepUpScopePlatformAdmin, http.HandlerFunc(server.HandlePlatformUserCommand))))
	mux.Handle("POST /api/platform/organizations/{id}/support-session", noStoreMiddleware(platformMW(server.RequireStepUp(domain.StepUpScopeSupportAccess, server.RequireIdempotency("platform.start-support-session", http.HandlerFunc(server.HandlePlatformStartSupportSession))))))
	mux.Handle("DELETE /api/platform/support-sessions/{sessionId}", platformMW(http.HandlerFunc(server.HandlePlatformEndSupportSession)))

	// Factory sales network (#326): a factory admin lists/creates its
	// connected store/dealer organizations (cloned from the factory catalog).
	mux.Handle("GET /api/factory/organizations", authMW(http.HandlerFunc(server.HandleFactoryOrganizations)))

	// Organization lifecycle commands share one authoritative application
	// service across Platform, Factory and the admin CLI. #460 SEC-7: the
	// lifecycle transitions and entitlement changes are platform_admin
	// step-up gated (before their idempotency wrappers).
	mux.Handle("POST /api/organizations", authMW(server.RequireIdempotency("organizations.provision", http.HandlerFunc(server.HandleProvisionOrganization))))
	mux.Handle("GET /api/organizations/{id}/readiness", platformMW(http.HandlerFunc(server.HandleOrganizationReadiness)))
	mux.Handle("GET /api/organizations/{id}/offboarding-preview", platformMW(http.HandlerFunc(server.HandleOrganizationOffboardingPreview)))
	mux.Handle("GET /api/organizations/{id}/entitlements", platformMW(http.HandlerFunc(server.HandleOrganizationEntitlements)))
	mux.Handle("PUT /api/organizations/{id}/entitlements", platformMW(server.RequireStepUp(domain.StepUpScopePlatformAdmin, server.RequireIdempotency("organizations.update-entitlements", http.HandlerFunc(server.HandleOrganizationEntitlements)))))
	mux.Handle("POST /api/organizations/{organizationCommand...}", organizationCommandRouter(map[string]http.Handler{
		"suspend":           platformMW(server.RequireStepUp(domain.StepUpScopePlatformAdmin, server.RequireIdempotency("organizations.suspend", http.HandlerFunc(server.HandleOrganizationLifecycleCommand)))),
		"reactivate":        platformMW(server.RequireStepUp(domain.StepUpScopePlatformAdmin, server.RequireIdempotency("organizations.reactivate", http.HandlerFunc(server.HandleOrganizationLifecycleCommand)))),
		"begin-offboarding": platformMW(server.RequireStepUp(domain.StepUpScopePlatformAdmin, server.RequireIdempotency("organizations.begin-offboarding", http.HandlerFunc(server.HandleOrganizationLifecycleCommand)))),
		"terminate":         platformMW(server.RequireStepUp(domain.StepUpScopePlatformAdmin, server.RequireIdempotency("organizations.terminate", http.HandlerFunc(server.HandleOrganizationLifecycleCommand)))),
	}))
}
