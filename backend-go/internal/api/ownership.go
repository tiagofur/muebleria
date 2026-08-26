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
