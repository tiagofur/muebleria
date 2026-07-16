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

func filterCustomersByOwner(list []domain.Customer, actorID string, role domain.UserRole) []domain.Customer {
	if domain.RoleSeesAllOwners(role) {
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

func filterProjectsByOwner(list []domain.Project, actorID string, role domain.UserRole) []domain.Project {
	if domain.RoleSeesAllOwners(role) {
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
