package api

import (
	"errors"
	"net/http"
	"strings"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// HandleCustomerSummaries exposes only the identity and display name required
// by the SketchUp bootstrap picker. Portfolio and tenant filters stay equal to
// the canonical Customer reader.
func (s *Server) HandleCustomerSummaries(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	roles := actorRoles(claims)
	if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanAccessCustomers), "no tenés permiso para ver clientes") {
		return
	}
	customers, err := s.Store.ListCustomers(r.Context())
	if err != nil {
		respondWithInternalError(w, err, "list customer summaries")
		return
	}
	visible := filterCustomersByOwner(customers, actorID(claims), roles)
	summaries := make([]openapi.CustomerSummary, 0, len(visible))
	for _, customer := range visible {
		if customer.Active {
			summaries = append(summaries, openapi.CustomerSummary{ID: customer.ID, Name: customer.Name})
		}
	}
	respondWithJSON(w, http.StatusOK, summaries)
}

// HandleProjectDesignBootstrap creates Customer? + Project + Design inside
// RequireIdempotency's transaction, then returns the same canonical context as
// #388 binding validation. The request cannot supply business IDs other than an
// exact existing Customer identity.
func (s *Server) HandleProjectDesignBootstrap(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	roles := actorRoles(claims)
	if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanMutateProjects), "no tenés permiso para crear proyectos") {
		return
	}

	var body openapi.ProjectDesignBootstrapRequest
	if !decodeGeneratedJSONBody(w, r, &body) {
		return
	}
	projectName := strings.TrimSpace(body.ProjectName)
	designName := strings.TrimSpace(body.DesignName)
	existingCustomerID := ""
	if body.ExistingCustomerId != nil {
		existingCustomerID = strings.TrimSpace(*body.ExistingCustomerId)
	}
	newCustomerName := ""
	if body.NewCustomer != nil {
		newCustomerName = strings.TrimSpace(body.NewCustomer.Name)
	}
	if projectName == "" || designName == "" || len(projectName) > 200 || len(designName) > 200 ||
		(existingCustomerID == "") == (newCustomerName == "") ||
		(existingCustomerID != "" && !isValidUUID(existingCustomerID)) || len(newCustomerName) > 200 {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "proyecto, diseño y exactamente un cliente son obligatorios", nil)
		return
	}
	if newCustomerName != "" && !requirePermission(w, domain.AnyRole(roles, domain.RoleCanMutateCustomers), "no tenés permiso para crear clientes") {
		return
	}

	result, err := s.Store.BootstrapProjectDesign(r.Context(), storage.BootstrapProjectDesignCommand{
		ProjectName: projectName, DesignName: designName,
		ExistingCustomerID: existingCustomerID, NewCustomerName: newCustomerName,
		ActorUserID: claims.UserID, ActorRoles: roles, IP: clientIP(r), RequestID: RequestIDFromContext(r.Context()),
	})
	if err != nil {
		switch {
		case errors.Is(err, storage.ErrInvalidProjectDesignBootstrap):
			respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "la intención de nuevo proyecto es inválida", nil)
		case errors.Is(err, storage.ErrCustomerNotFound):
			respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "el cliente no existe", nil)
		case errors.Is(err, domain.ErrFurnitureInstanceProjectNotWritable):
			respondWithAPIError(w, http.StatusForbidden, openapi.ApiErrorCodeForbidden, "el proyecto no pertenece a este taller", nil)
		default:
			respondWithInternalError(w, err, "bootstrap project design")
		}
		return
	}

	ctx, err := s.Store.GetModelBindingContext(r.Context(), result.Project.ID, result.Design.ID, nil)
	if err != nil {
		respondWithInternalError(w, err, "read bootstrap binding context")
		return
	}
	respondWithJSON(w, http.StatusCreated, openapi.ProjectDesignBootstrapResponse{
		Customer: openapi.CustomerSummary{ID: result.Customer.ID, Name: result.Customer.Name},
		Binding:  modelBindingValidationDTO(ctx, roles),
	})
}
