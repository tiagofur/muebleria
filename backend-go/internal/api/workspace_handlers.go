package api

import (
	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/application"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
	"log/slog"
	"net/http"
)

// Contrato: utilidades operativas — seed demo, owners asignables (F035),
// workshop settings (F031/F044) y plantillas de proyecto (#110).
// --- SEED ---

// HandleSeed populates the database with plantilla fixture data.
// Idempotent: skips if materials already exist.
func (s *Server) HandleSeed(w http.ResponseWriter, r *http.Request) {
	if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateModules), "solo administradores") {
		return
	}
	if err := s.Store.SeedCatalog(r.Context()); err != nil {
		slog.Error("seed catalog failed", "error", err)
		// Ops diagnostic in the envelope (#964): the seed is a staff/demo
		// endpoint; the reason is business-safe (typed storage errors).
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict,
			"el seed del catálogo demo falló", map[string]any{"reason": err.Error()})
		return
	}
	// #955: demo hardware profile + real publication of the seeded
	// Standard draft release (idempotent; keeps the demo chain on real
	// manifests instead of placeholder hashes).
	demoPublisher := ""
	if claims := claimsFromRequest(r); claims != nil && claims.PlatformAdmin {
		demoPublisher = claims.UserID
	}
	// #964: provisioning is PER-ORG (deterministic ids under the caller's
	// organization — the fixed seed ids are global PKs and a second org
	// collided, the historical /seed 500). The publication stays
	// platform-only and carries EVERY org's provisioned profile.
	profileID, err := application.SeedDemoForOrg(r.Context(), s.Store, storage.OrgFromCtx(r.Context()), demoPublisher)
	if err != nil {
		slog.Error("seed demo release failed", "error", err)
		respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict,
			"el seed del release demo falló", map[string]any{"reason": err.Error()})
		return
	}
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"status":"ok","profileId":"` + profileID + `"}`))
}

// --- ADMIN: User Management ---

// HandleAssignableOwners: GET /api/assignable-owners
// Active members of the current organization that can own a customer/project
// portfolio (admin + gerente + vendedor). Roles come from the org membership,
// not the deprecated users.role column.
func (s *Server) HandleAssignableOwners(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	roles := actorRoles(claimsFromRequest(r))
	if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanAssignOwner), "no tenés permiso para asignar responsables") {
		return
	}
	claims := claimsFromRequest(r)
	if claims == nil || claims.OrgID == "" {
		respondWithError(w, http.StatusForbidden, "elegí un taller para continuar")
		return
	}
	team, err := s.Store.ListOrgTeam(r.Context(), claims.OrgID, claims.UserID)
	if err != nil {
		respondWithInternalError(w, err, "handler")
		return
	}
	// Portfolio owners are sales-facing roles (plus admin). When a membership
	// holds several of them, report the most privileged one for display.
	ownerRank := map[domain.UserRole]int{
		domain.RoleAdmin: 0, domain.RoleGerenteVentas: 1,
		domain.RoleVendedor: 2, domain.RoleUser: 3,
	}
	out := make([]map[string]string, 0, len(team))
	for _, m := range team {
		if m.Status != domain.MembershipStatusActive {
			continue
		}
		best, bestRank := "", -1
		for _, rl := range m.Roles {
			if rank, ok := ownerRank[rl]; ok && (bestRank == -1 || rank < bestRank) {
				best, bestRank = string(rl), rank
			}
		}
		if best == "" {
			continue
		}
		out = append(out, map[string]string{
			"id":   m.UserID,
			"name": m.Name,
			"role": best,
		})
	}
	respondWithJSON(w, http.StatusOK, out)
}

// HandleWorkshopSettings: GET/PUT /api/settings (F031 + F044 COST-02).
func (s *Server) HandleWorkshopSettings(w http.ResponseWriter, r *http.Request) {
	roles := actorRoles(claimsFromRequest(r))
	switch r.Method {
	case http.MethodGet:
		// Any authenticated user may read settings (needed for cost visibility on client).
		ws, err := s.Store.GetWorkshopSettings(r.Context())
		if err != nil {
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, ws)

	case http.MethodPut:
		if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanAccessSettings), "no tenés permiso para editar ajustes del taller") {
			return
		}
		var ws domain.WorkshopSettings
		if !decodeJSONBody(w, r, &ws) {
			return
		}
		saved, err := s.Store.UpsertWorkshopSettings(r.Context(), ws)
		if err != nil {
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, saved)

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// --- Project templates (#110 / H15) ---

// HandleProjectTemplates: GET (list) / POST (create). Templates are a recipe
// collection (no customer/owner scoping) — readable by anyone who can access
// projects, mutable by engineer/admin (catalog-style RBAC).
func (s *Server) HandleProjectTemplates(w http.ResponseWriter, r *http.Request) {
	roles := actorRoles(claimsFromRequest(r))

	switch r.Method {
	case http.MethodGet:
		if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanAccessProjects), "no tenés permiso para ver cotizaciones") {
			return
		}
		list, err := s.Store.ListProjectTemplates(r.Context())
		if err != nil {
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, list)

	case http.MethodPost:
		if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanMutateModules), "no tenés permiso para crear plantillas") {
			return
		}
		var t domain.ProjectTemplate
		if !decodeJSONBody(w, r, &t) {
			return
		}
		if t.Currency == "" {
			t.Currency = "MXN"
		}
		if t.MarginFactor == 0 {
			t.MarginFactor = 1.35
		}
		if t.Items == nil {
			t.Items = []domain.ProjectItem{}
		}
		if err := s.Store.CreateProjectTemplate(r.Context(), t); err != nil {
			if isDuplicateKey(err) {
				respondWithError(w, http.StatusConflict, "El registro ya existe")
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusCreated, t)

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// HandleProjectTemplateByID: GET / PUT / DELETE on /project-templates/{id}.
func (s *Server) HandleProjectTemplateByID(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		respondWithError(w, http.StatusBadRequest, "missing template id")
		return
	}
	roles := actorRoles(claimsFromRequest(r))

	switch r.Method {
	case http.MethodGet:
		if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanAccessProjects), "no tenés permiso para ver cotizaciones") {
			return
		}
		t, err := s.Store.GetProjectTemplateByID(r.Context(), id)
		if err != nil {
			respondWithError(w, http.StatusNotFound, "template not found")
			return
		}
		respondWithJSON(w, http.StatusOK, t)

	case http.MethodPut:
		if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanMutateModules), "no tenés permiso para editar plantillas") {
			return
		}
		var t domain.ProjectTemplate
		if !decodeJSONBody(w, r, &t) {
			return
		}
		if t.Currency == "" {
			t.Currency = "MXN"
		}
		if t.Items == nil {
			t.Items = []domain.ProjectItem{}
		}
		if err := s.Store.UpdateProjectTemplate(r.Context(), id, t); err != nil {
			respondWithInternalError(w, err, "handler")
			return
		}
		updated, err := s.Store.GetProjectTemplateByID(r.Context(), id)
		if err != nil {
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, updated)

	case http.MethodDelete:
		if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanMutateModules), "no tenés permiso para borrar plantillas") {
			return
		}
		if err := s.Store.DeleteProjectTemplate(r.Context(), id); err != nil {
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, map[string]bool{"ok": true})

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}
