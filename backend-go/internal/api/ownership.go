package api

import (
	"net/http"

	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

func claimsFromRequest(r *http.Request) *auth.Claims {
	claims, ok := r.Context().Value(UserContextKey).(*auth.Claims)
	if !ok || claims == nil {
		return nil
	}
	return claims
}

func actorRole(claims *auth.Claims) domain.UserRole {
	if claims == nil {
		return ""
	}
	return domain.UserRole(claims.Role)
}

// actorRoles resolves the actor's effective role set with union semantics
// (ADR-0005): the live membership roles from the token; single-role tokens
// (and legacy tests that only set Role) fall back to that one role.
func actorRoles(claims *auth.Claims) []domain.UserRole {
	if claims == nil {
		return nil
	}
	if len(claims.Roles) > 0 {
		out := make([]domain.UserRole, len(claims.Roles))
		for i, r := range claims.Roles {
			out[i] = domain.UserRole(r)
		}
		return out
	}
	if claims.Role != "" {
		return []domain.UserRole{domain.UserRole(claims.Role)}
	}
	return nil
}

func actorID(claims *auth.Claims) string {
	if claims == nil {
		return ""
	}
	return claims.UserID
}

// requirePermission responds 403 and returns false when ok is false.
func requirePermission(w http.ResponseWriter, ok bool, message string) bool {
	if ok {
		return true
	}
	if message == "" {
		message = "no tenés permiso para esta acción"
	}
	respondWithError(w, http.StatusForbidden, message)
	return false
}

func filterCustomersByOwner(list []domain.Customer, actorID string, roles []domain.UserRole) []domain.Customer {
	if domain.RolesSeesAllOwners(roles) {
		return list
	}
	out := make([]domain.Customer, 0, len(list))
	for _, c := range list {
		if c.OwnerUserID == actorID {
			out = append(out, c)
		}
	}
	return out
}

func filterProjectsByOwner(list []domain.Project, actorID string, roles []domain.UserRole) []domain.Project {
	if domain.RolesSeesAllOwners(roles) {
		return list
	}
	out := make([]domain.Project, 0, len(list))
	for _, p := range list {
		if p.OwnerUserID == actorID {
			out = append(out, p)
		}
	}
	return out
}

// authorizeProjectOrgOwnership enforces #327 on create: ownership fields may
// only point at organizations the caller actively belongs to, and the
// manufacturing organization must be a factory. Empty values keep the caller's
// organization default resolved by the storage layer; assigning the caller's
// own org is always allowed (pilot semantics: one factory acting as both).
func (s *Server) authorizeProjectOrgOwnership(w http.ResponseWriter, r *http.Request, p *domain.Project) bool {
	claims := claimsFromRequest(r)
	if claims == nil || claims.OrgID == "" {
		return true
	}
	checks := []struct {
		orgID   string
		needMfg bool
	}{
		{p.SalesOrganizationID, false},
		{p.ManufacturingOrganizationID, true},
	}
	for _, c := range checks {
		if c.orgID == "" || c.orgID == claims.OrgID {
			continue
		}
		m, err := s.Store.GetActiveMembership(r.Context(), claims.UserID, c.orgID)
		if err != nil || m == nil || m.Status != domain.MembershipStatusActive || !m.Organization.Active {
			respondWithError(w, http.StatusForbidden, "no podés asignar una organización a la que no pertenecés")
			return false
		}
		if c.needMfg && m.Organization.Type != domain.OrganizationTypeFactory {
			respondWithError(w, http.StatusForbidden, "la organización de fabricación debe ser una fábrica")
			return false
		}
	}
	// #327 (F178): a store/dealer cannot be its own manufacturer — leaving
	// manufacturing empty would default it to the caller's org and the
	// sales/manufacturing split would never apply. Pilot factories acting as
	// their own sales org stay allowed.
	if own, err := s.Store.GetActiveMembership(r.Context(), claims.UserID, claims.OrgID); err == nil && own != nil &&
		(own.Organization.Type == domain.OrganizationTypeStore || own.Organization.Type == domain.OrganizationTypeDealer) {
		if p.ManufacturingOrganizationID == "" || p.ManufacturingOrganizationID == claims.OrgID {
			respondWithError(w, http.StatusBadRequest,
				"una tienda necesita asignar la fábrica que fabricará el proyecto (manufacturing_organization_id)")
			return false
		}
	}
	return true
}

// orgSeesManufacturing reports whether the caller's organization scope may see
// the project's manufacturing-internal payload: the manufacturing organization
// always can; pilot rows where both orgs coincide (or the scope is unknown)
// keep full visibility (#327).
func orgSeesManufacturing(claims *auth.Claims, p *domain.Project) bool {
	if p == nil || p.ManufacturingOrganizationID == "" || claims == nil || claims.OrgID == "" {
		return true
	}
	return claims.OrgID == p.ManufacturingOrganizationID
}

// manufacturingOnly wraps manufacturing subresource handlers (#327): only
// the manufacturing organization may reach physical execution, MRP, quality,
// installation and job costing. The sales organization gets the same 404 as
// a missing project — cross-org access never confirms existence.
func (s *Server) manufacturingOnly(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims := claimsFromRequest(r)
		if claims != nil && claims.OrgID != "" {
			p, err := s.Store.GetProjectByID(r.Context(), r.PathValue("id"))
			if err != nil || p == nil {
				respondWithError(w, http.StatusNotFound, "obra no encontrada")
				return
			}
			if !orgSeesManufacturing(claims, p) {
				respondWithError(w, http.StatusNotFound, "obra no encontrada")
				return
			}
		}
		next(w, r)
	}
}

// redactProjectsForCaller applies the sales/manufacturing split (#327) to a
// project list in place: rows manufactured by another organization lose their
// manufacturing-internal fields.
func redactProjectsForCaller(claims *auth.Claims, list []domain.Project) {
	for i := range list {
		if !orgSeesManufacturing(claims, &list[i]) {
			domain.RedactProjectManufacturing(&list[i])
		}
	}
}
