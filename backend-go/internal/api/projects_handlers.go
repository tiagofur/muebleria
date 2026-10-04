package api

import (
	"context"
	"errors"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
	"github.com/tiagofur/muebles-backend/internal/storage"
	"net/http"
	"strings"
)

// Contrato: proyectos/cotizaciones — CRUD, alta con cliente inline (#712),
// cálculo financiero y validaciones de payload. Consumido por routes_projects.go.
// --- PROJECTS ---

func (s *Server) HandleProjects(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	roles := actorRoles(claims)
	uid := actorID(claims)

	switch r.Method {
	case http.MethodGet:
		if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanAccessProjects), "no tenés permiso para ver cotizaciones") {
			return
		}
		list, err := s.Store.ListProjects(r.Context())
		if err != nil {
			respondWithInternalError(w, err, "handler")
			return
		}
		filtered := filterProjectsByOwner(list, uid, roles)
		redactProjectsForCaller(claims, filtered)
		if !s.actorCanViewCosts(r) {
			domain.RedactProjectsList(filtered)
		}
		respondWithJSON(w, http.StatusOK, filtered)

	case http.MethodPost:
		if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanMutateProjects), "no tenés permiso para crear cotizaciones") {
			return
		}
		// #712: optional inline-customer create command. Embedded decode keeps
		// the flat legacy payload 100% backward compatible — existing clients
		// simply omit inline_customer_name.
		var req createProjectRequest
		if !decodeJSONBody(w, r, &req) {
			return
		}
		p := req.Project
		inlineName := strings.TrimSpace(req.InlineCustomerName)
		switch {
		case inlineName != "" && p.CustomerID != "":
			respondWithError(w, http.StatusBadRequest, "enviá un cliente existente o un cliente nuevo, no ambos")
			return
		case inlineName != "":
			// The inline transition also writes a customer: the caller needs
			// both permissions, checked together before anything persists.
			if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanMutateCustomers), "no tenés permiso para crear clientes") {
				return
			}
		}
		// #577: the resolved release authority projection is computed on read;
		// a client-sent copy is never persisted.
		p.ResolvedProductionRelease = nil
		// #697 review: the Digital Thread context projection is computed on
		// read; a client-sent copy is never persisted.
		p.HasDigitalThreadContext = false
		// #740: the durable per-release Engineering state is computed on read;
		// a client-sent copy is never persisted.
		p.ReleaseEngineering = nil

		if claims != nil {
			p.CreatedBy = claims.UserID
		}
		p.OwnerUserID = domain.ResolveOwnerOnCreateRoles(uid, roles, p.OwnerUserID)

		// #327: ownership may only point at organizations the caller belongs
		// to (manufacturing must be a factory); empty values default to the
		// caller's organization in the storage layer.
		if !s.authorizeProjectOrgOwnership(w, r, &p) {
			return
		}
		if !validateProjectPayloadRequiredIDs(w, &p, inlineName != "") {
			return
		}

		p.Status = domain.StatusDraft
		// Product default currency (Mexico).
		if p.Currency == "" {
			p.Currency = "MXN"
		}

		// #712: "nueva cotización + nuevo cliente" runs as ONE server-side
		// transaction. The customer id is minted and persisted by the server,
		// the project references exactly that row, and any failure rolls both
		// back — the FK never sees an unpersisted identity again.
		var inlineCustomer *domain.Customer
		if inlineName != "" {
			inlineCustomer = &domain.Customer{
				Name:        inlineName,
				OwnerUserID: domain.ResolveOwnerOnCreateRoles(uid, roles, p.OwnerUserID),
			}
			err := s.Store.CreateProjectWithInlineCustomer(r.Context(), &p, inlineCustomer)
			if err != nil {
				respondWithProjectCreateError(w, err)
				return
			}
		} else {
			err := s.Store.CreateProject(r.Context(), &p)
			if err != nil {
				respondWithProjectCreateError(w, err)
				return
			}
		}
		if !orgSeesManufacturing(claims, &p) {
			domain.RedactProjectManufacturing(&p)
		}
		if !s.actorCanViewCosts(r) {
			domain.RedactProjectCosts(&p)
		}
		if inlineCustomer != nil {
			respondWithJSON(w, http.StatusCreated, createProjectResponse{Project: p, InlineCustomer: inlineCustomer})
			return
		}
		respondWithJSON(w, http.StatusCreated, p)

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// createProjectRequest decodes the legacy flat POST /projects payload plus
// the optional #712 inline-customer command. The embedded struct keeps every
// existing field at the top level, so older clients decode unchanged.
type createProjectRequest struct {
	domain.Project
	InlineCustomerName string `json:"inline_customer_name,omitempty"`
}

// createProjectResponse embeds the created project (same flat shape clients
// already parse) and, only for the inline transition, the customer the
// server created so the caller can reconcile local state with the persisted
// identity.
type createProjectResponse struct {
	domain.Project
	InlineCustomer *domain.Customer `json:"inline_customer,omitempty"`
}

// respondWithProjectCreateError maps the create-path storage failures:
// duplicate id → 409 (existing idempotent-create contract), invisible
func isValidUUID(value string) bool {
	value = strings.TrimSpace(value)
	if len(value) != 36 {
		return false
	}
	for i := range value {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if value[i] != '-' {
				return false
			}
			continue
		}
		c := value[i]
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')) {
			return false
		}
	}
	return true
}

// validateProjectPayloadRequiredIDs rejects malformed UUIDs before they reach
// Postgres and become 22P02 internal errors (pre-demo audit P1-5). The
// customer check is skipped for the #712 inline transition — the server mints
// that id itself inside the atomic transaction.
func validateProjectPayloadRequiredIDs(w http.ResponseWriter, p *domain.Project, inlineCustomer bool) bool {
	if !inlineCustomer && !isValidUUID(p.CustomerID) {
		respondWithError(w, http.StatusBadRequest, "la cotización necesita un cliente válido")
		return false
	}
	for i := range p.Items {
		if !isValidUUID(p.Items[i].ModuleID) {
			respondWithError(w, http.StatusBadRequest, "hay una línea de la cotización sin mueble válido")
			return false
		}
		for role, choice := range p.Items[i].OptionChoices {
			if !isValidUUID(choice) {
				respondWithError(w, http.StatusBadRequest, "opción inválida ("+role+") en una línea de la cotización")
				return false
			}
		}
	}
	for role, choice := range p.ProjectLevelChoices {
		if !isValidUUID(choice) {
			respondWithError(w, http.StatusBadRequest, "opción global inválida ("+role+") en la cotización")
			return false
		}
	}
	return true
}

func (s *Server) HandleProjectByID(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		respondWithError(w, http.StatusBadRequest, "missing project id")
		return
	}
	claims := claimsFromRequest(r)
	roles := actorRoles(claims)
	uid := actorID(claims)

	if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanAccessProjects), "no tenés permiso para ver cotizaciones") {
		return
	}

	switch r.Method {
	case http.MethodGet:
		p, err := s.Store.GetProjectByID(r.Context(), id)
		if err != nil {
			respondWithError(w, http.StatusNotFound, "project not found")
			return
		}
		if !domain.CanAccessOwnedResourceRoles(uid, roles, p.OwnerUserID) {
			respondWithError(w, http.StatusNotFound, "project not found")
			return
		}
		if !orgSeesManufacturing(claims, p) {
			domain.RedactProjectManufacturing(p)
		}
		if !s.actorCanViewCosts(r) {
			domain.RedactProjectCosts(p)
		}
		respondWithJSON(w, http.StatusOK, p)

	case http.MethodPut:
		existing, err := s.Store.GetProjectByID(r.Context(), id)
		if err != nil {
			// 404 lets the FE upsert fall through to POST create.
			if strings.Contains(err.Error(), "not found") || strings.Contains(err.Error(), "no rows") {
				respondWithError(w, http.StatusNotFound, "project not found")
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		if !domain.CanAccessOwnedResourceRoles(uid, roles, existing.OwnerUserID) {
			respondWithError(w, http.StatusNotFound, "project not found")
			return
		}
		var req updateProjectRequest
		if !decodeJSONBody(w, r, &req) {
			return
		}
		p := req.Project
		inlineName := strings.TrimSpace(req.InlineCustomerName)
		if inlineName != "" {
			if p.CustomerID != "" {
				respondWithError(w, http.StatusBadRequest, "enviá un cliente existente o un cliente nuevo, no ambos")
				return
			}
			if req.InlineCustomerReplaces == nil {
				respondWithError(w, http.StatusBadRequest, "falta el cliente actual de la cotización para crear uno nuevo")
				return
			}
			if req.ExpectedProjectUpdatedAt == nil {
				respondWithError(w, http.StatusBadRequest, "falta la versión actual de la cotización para crear un cliente nuevo")
				return
			}
			if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanMutateCustomers), "no tenés permiso para crear clientes") {
				return
			}
			if claims.OrgID != "" && claims.OrgID != existing.OrganizationID {
				respondWithError(w, http.StatusForbidden, "sólo la organización dueña de la cotización puede asignar un cliente nuevo")
				return
			}
			if existing.Status != domain.StatusDraft {
				respondWithError(w, http.StatusConflict, "la cotización ya no está en borrador: no se puede asignar un cliente nuevo")
				return
			}
		}
		// #577: the resolved release authority projection is computed on read;
		// a client-sent copy is never persisted.
		p.ResolvedProductionRelease = nil
		// #697 review: the Digital Thread context projection is computed on
		// read; a client-sent copy is never persisted.
		p.HasDigitalThreadContext = false
		// #740: the durable per-release Engineering state is computed on read;
		// a client-sent copy is never persisted.
		p.ReleaseEngineering = nil
		// OC-070..OC-074: the installation job is server-authoritative — it
		// only changes through the dedicated installation endpoints (gates,
		// RBAC and audit). A client-sent copy is ignored, never persisted.
		p.Installation = existing.Installation

		// #395: once a canonical ProductionRelease exists it is the ONE
		// release authority — immutable history created only through
		// POST /api/projects/{id}/production-releases. The client blob can
		// no longer create or rewrite release truth: the stored copy is
		// preserved exactly like the installation job above.
		if canonicalRelease, crErr := s.Store.GetLatestProjectProductionRelease(r.Context(), id); crErr != nil {
			respondWithInternalError(w, crErr, "resolver la liberación de producción")
			return
		} else if canonicalRelease != nil {
			p.ProductionRelease = existing.ProductionRelease
			// #577: physical executions are station-authoritative — without
			// frozen routing evidence they cannot be minted or rewritten
			// through the generic aggregate surface either; keep the stored copy.
			p.PartInstances = existing.PartInstances
			p.ModuleUnits = existing.ModuleUnits
			// #740: item floor status and the F092 floor-event log are
			// operational physical state. Canonical projects advance them ONLY
			// through the gated station endpoints (operational gate + audit
			// in one transaction) — a client-sent copy is ignored, never
			// persisted, exactly like the executions above.
			storedFloorStatus := make(map[string]string, len(existing.Items))
			for _, item := range existing.Items {
				storedFloorStatus[item.ID] = item.FloorStatus
			}
			for i := range p.Items {
				if stored, ok := storedFloorStatus[p.Items[i].ID]; ok {
					p.Items[i].FloorStatus = stored
				}
			}
			p.FloorEvents = nil
		}

		// #327: organization ownership is server-authoritative. It is
		// assigned once at create (validated against the caller's
		// memberships); reassignment requires a dedicated audited flow. A
		// client-sent copy is ignored, never persisted.
		p.OrganizationID = existing.OrganizationID
		p.SalesOrganizationID = existing.SalesOrganizationID
		p.ManufacturingOrganizationID = existing.ManufacturingOrganizationID
		// Sales-organization callers never receive the manufacturing payload;
		// restore the stored copy so their round-trip PUTs cannot wipe it.
		if !orgSeesManufacturing(claims, existing) {
			domain.RestoreProjectManufacturing(&p, existing)
		}
		if !validateProjectPayloadRequiredIDs(w, &p, inlineName != "") {
			return
		}

		// F036 status transitions: reopen / mark produced vs general mutate.
		statusChanging := p.Status != "" && p.Status != existing.Status
		if statusChanging {
			reopen := engine.IsProjectClosed(existing.Status) && p.Status == domain.StatusDraft
			markProduced := p.Status == domain.StatusProduced
			if reopen {
				if !requirePermission(w, domain.AnyRole(roles, func(rr domain.UserRole) bool { return domain.ProjectAllowsReopenToDraft(existing.Status, rr) }), "no tenés permiso para reabrir cotizaciones") {
					return
				}
			} else if markProduced {
				if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanMarkProduced), "no tenés permiso para marcar en producción") {
					return
				}
				// Production queue roles may only flip status (not rewrite BOM).
				if !domain.AnyRole(roles, domain.RoleCanMutateProjects) {
					next := *existing
					next.Status = domain.StatusProduced
					if next.PriceSnapshot == nil && existing.PriceSnapshot != nil {
						next.PriceSnapshot = existing.PriceSnapshot
					}
					// Keep closed→closed snapshot; engine-equivalent without catalog re-freeze.
					p = next
				}
			} else if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanMutateProjects), "no tenés permiso para editar cotizaciones") {
				return
			}
		} else if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanMutateProjects), "no tenés permiso para editar cotizaciones") {
			return
		}

		p.OwnerUserID = domain.ResolveOwnerOnUpdateRoles(roles, existing.OwnerUserID, p.OwnerUserID)
		// Reopen must clear snapshot even if client resends one.
		if statusChanging && p.Status == domain.StatusDraft && engine.IsProjectClosed(existing.Status) {
			p.PriceSnapshot = nil
		}
		// Preserve snapshot when moving accepted → produced if client omitted it.
		if statusChanging && p.Status == domain.StatusProduced && p.PriceSnapshot == nil {
			p.PriceSnapshot = existing.PriceSnapshot
		}
		// #108: closing a quote pins each item's structure revision so later
		// edits to the structure do not silently mutate the closed quote's BOM.
		// Same caveat as PriceSnapshot above: the handler builds the freeze
		// inline rather than calling TransitionProjectStatus.
		if statusChanging && engine.IsProjectClosed(p.Status) {
			catalog, cerr := s.Store.GetFullCatalog(r.Context())
			if cerr != nil {
				respondWithInternalError(w, cerr, "handler: load catalog for structure pins")
				return
			}
			p.Items = engine.CaptureProjectItemStructurePins(p.Items, catalog)
		}
		// OC-010 server authority: lifecycle events also arrive via the project
		// aggregate (dual-write). New event ids must pass the same vocabulary +
		// RBAC gates as POST /api/projects/{id}/events; resending the existing
		// log is always allowed.
		if !authorizeProjectEventAppends(w, roles, existing.Events, p.Events) {
			return
		}
		// OC-074: new closeout events in the dual-write path must pass the
		// closeout gates against the stored project state.
		if !authorizeCloseoutEventAppends(w, existing, p.Events) {
			return
		}
		var inlineCustomer *domain.Customer
		if inlineName != "" {
			inlineCustomer = &domain.Customer{Name: inlineName, OwnerUserID: p.OwnerUserID}
			err = s.Store.UpdateProjectWithInlineCustomer(
				r.Context(), id, &p, inlineCustomer,
				strings.TrimSpace(*req.InlineCustomerReplaces),
				*req.ExpectedProjectUpdatedAt,
			)
		} else {
			err = s.Store.UpdateProject(r.Context(), id, &p)
		}
		if err != nil {
			if errors.Is(err, storage.ErrProjectConcurrentUpdate) {
				respondWithError(w, http.StatusConflict, "la cotización cambió en el servidor: recargá y volvé a intentar")
				return
			}
			if errors.Is(err, storage.ErrCustomerNotFound) {
				respondWithError(w, http.StatusNotFound, "El cliente indicado no existe")
				return
			}
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, err.Error())
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		// Read back the authoritative aggregate after the generic update. Read-only
		// projections are recomputed by storage and must not be returned as the
		// zero values cleared from the client payload above.
		updated, err := s.Store.GetProjectByID(r.Context(), id)
		if err != nil {
			respondWithInternalError(w, err, "handler: read updated project")
			return
		}
		response := *updated
		if !orgSeesManufacturing(claims, &response) {
			domain.RedactProjectManufacturing(&response)
		}
		if !s.actorCanViewCosts(r) {
			domain.RedactProjectCosts(&response)
		}
		if inlineCustomer != nil {
			respondWithJSON(w, http.StatusOK, updateProjectResponse{Project: response, InlineCustomer: inlineCustomer})
			return
		}
		respondWithJSON(w, http.StatusOK, response)

	case http.MethodDelete:
		if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanDeleteProject), "no tenés permiso para eliminar cotizaciones") {
			return
		}
		existing, err := s.Store.GetProjectByID(r.Context(), id)
		if err != nil {
			respondWithError(w, http.StatusNotFound, "project not found")
			return
		}
		if !domain.CanAccessOwnedResourceRoles(uid, roles, existing.OwnerUserID) {
			respondWithError(w, http.StatusNotFound, "project not found")
			return
		}
		if cleaner, ok := s.Store.(interface {
			DeleteProjectWithMediaCleanup(context.Context, string, func(context.Context, []storage.ProjectMediaFile)) error
		}); ok && strings.TrimSpace(s.MediaDir) != "" {
			err = cleaner.DeleteProjectWithMediaCleanup(r.Context(), id, func(_ context.Context, files []storage.ProjectMediaFile) {
				deleteProjectMediaFiles(s.MediaDir, files)
			})
		} else {
			err = s.Store.DeleteProject(r.Context(), id)
		}
		if err != nil {
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, map[string]string{"message": "project deleted"})

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// Endpoint para calcular el breakdown financiero de un proyecto usando el motor de Go
func (s *Server) HandleProjectCalculate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	id := r.PathValue("id")
	if id == "" {
		respondWithError(w, http.StatusBadRequest, "missing project id")
		return
	}

	claims := claimsFromRequest(r)
	roles := actorRoles(claims)
	uid := actorID(claims)
	if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanAccessProjects), "no tenés permiso para ver cotizaciones") {
		return
	}

	p, err := s.Store.GetProjectByID(r.Context(), id)
	if err != nil {
		respondWithError(w, http.StatusNotFound, "project not found")
		return
	}
	if !domain.CanAccessOwnedResourceRoles(uid, roles, p.OwnerUserID) {
		respondWithError(w, http.StatusNotFound, "project not found")
		return
	}

	catalog, err := s.Store.GetFullCatalog(r.Context())
	if err != nil {
		respondWithInternalError(w, err, "calculate: load catalog")
		return
	}

	// #986: the governed resolve's commercial demand joins the live estimate —
	// the same derivation the release freeze and the quote snapshots run.
	// Derivation failures are business-input failures (a governed joint that
	// cannot resolve), surfaced like the rest of the calculation errors.
	profileDemand, err := s.Store.DeriveLiveProfileDemand(r.Context(), p, catalog)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	breakdown, err := engine.CalcProjectBreakdownWithProfileDemand(*p, catalog, profileDemand)
	if err != nil {
		// Calculation errors are business-validation failures (bad inputs), not
		// internal leaks — surface a clean, actionable message.
		respondWithError(w, http.StatusBadRequest, err.Error())
		return
	}

	if !s.actorCanViewCosts(r) {
		domain.RedactQuoteBreakdown(&breakdown)
	}
	respondWithJSON(w, http.StatusOK, breakdown)
}
