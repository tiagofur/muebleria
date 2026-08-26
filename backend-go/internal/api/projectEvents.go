package api

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

func newProjectEventID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("evt_%d_%d", time.Now().UnixNano(), os.Getpid())
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("evt_%x%x%x%x%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// authorizeProjectEventAppends enforces OC-010 server authority on lifecycle
// events arriving inside the project aggregate (dual-write path of
// PUT /api/projects/{id}). Only NEW event ids are checked, so a client
// resending the existing log is never rejected. Writes the HTTP error
// response and returns false when a new event violates the vocabulary or the
// RBAC matrix.
func authorizeProjectEventAppends(w http.ResponseWriter, roles []domain.UserRole, existing, incoming []domain.ProjectEvent) bool {
	known := make(map[string]struct{}, len(existing))
	for _, ev := range existing {
		known[ev.ID] = struct{}{}
	}
	for _, ev := range incoming {
		if ev.ID == "" || ev.Type == "" {
			continue
		}
		if _, ok := known[ev.ID]; ok {
			continue
		}
		if !domain.IsValidProjectEventType(ev.Type) {
			respondWithError(w, http.StatusBadRequest, "tipo de evento desconocido: "+ev.Type)
			return false
		}
		if !domain.AnyRole(roles, func(rr domain.UserRole) bool { return domain.RoleCanAppendProjectEvent(rr, ev.Type) }) {
			respondWithError(w, http.StatusForbidden, "no tenés permiso para registrar este evento del ciclo de vida: "+ev.Type)
			return false
		}
	}
	return true
}

// authorizeCloseoutEventAppends enforces OC-074 on closeout events arriving
// through the project aggregate dual-write path (PUT /api/projects/{id}): a
// NEW client_signed_off/project_closed event must pass the closeout gates
// evaluated against the stored project state.
func authorizeCloseoutEventAppends(w http.ResponseWriter, existing *domain.Project, incoming []domain.ProjectEvent) bool {
	known := make(map[string]struct{}, len(existing.Events))
	for _, ev := range existing.Events {
		known[ev.ID] = struct{}{}
	}
	for _, ev := range incoming {
		if ev.ID == "" || (ev.Type != "client_signed_off" && ev.Type != "project_closed") {
			continue
		}
		if _, ok := known[ev.ID]; ok {
			continue
		}
		if failing := domain.ValidateCloseoutEventAppend(existing.ModuleUnits, existing.Items, existing.Installation, ev.Type); len(failing) > 0 {
			respondWithError(w, http.StatusConflict, "gates de cierre pendientes: "+strings.Join(failing, ", "))
			return false
		}
	}
	return true
}

// HandleProjectEvents handles:
// - GET /api/projects/{id}/events (returns the project lifecycle events log, oldest first)
// - POST /api/projects/{id}/events (appends an immutable lifecycle event to the audit log)
func (s *Server) HandleProjectEvents(w http.ResponseWriter, r *http.Request) {
	projectID := r.PathValue("id")
	if projectID == "" {
		respondWithError(w, http.StatusBadRequest, "missing project id")
		return
	}

	switch r.Method {
	case http.MethodGet:
		project, err := s.Store.GetProjectByID(r.Context(), projectID)
		if err != nil || project == nil {
			respondWithError(w, http.StatusNotFound, "obra no encontrada")
			return
		}

		events, err := s.Store.ListProjectEvents(r.Context(), projectID)
		if err != nil {
			respondWithError(w, http.StatusInternalServerError, "no se pudo leer el historial de eventos")
			return
		}
		if events == nil {
			events = []domain.ProjectEvent{}
		}
		respondWithJSON(w, http.StatusOK, events)

	case http.MethodPost:
		claims := claimsFromRequest(r)
		var req struct {
			ID      string                    `json:"id,omitempty"`
			Type    string                    `json:"type"`
			At      *time.Time                `json:"at,omitempty"`
			Source  domain.ProjectEventSource `json:"source,omitempty"`
			Note    string                    `json:"note,omitempty"`
			Payload json.RawMessage           `json:"payload,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			respondWithError(w, http.StatusBadRequest, "payload JSON inválido")
			return
		}
		if req.Type == "" {
			respondWithError(w, http.StatusBadRequest, "type es requerido")
			return
		}
		// The append-only log only accepts the canonical OC-010 vocabulary.
		if !domain.IsValidProjectEventType(req.Type) {
			respondWithError(w, http.StatusBadRequest, "tipo de evento desconocido: "+req.Type)
			return
		}
		// RBAC (OC-010..OC-024): appending a lifecycle event is a role-gated
		// action, not just "any authenticated user".
		if !requirePermission(w,
			domain.AnyRole(actorRoles(claims), func(rr domain.UserRole) bool { return domain.RoleCanAppendProjectEvent(rr, req.Type) }),
			"no tenés permiso para registrar este evento del ciclo de vida") {
			return
		}
		// OC-074: closeout events are gated by the real project state —
		// installed units alone never close a project.
		if req.Type == "client_signed_off" || req.Type == "project_closed" {
			project, perr := s.Store.GetProjectByID(r.Context(), projectID)
			if perr != nil || project == nil {
				respondWithError(w, http.StatusNotFound, "obra no encontrada")
				return
			}
			if failing := domain.ValidateCloseoutEventAppend(project.ModuleUnits, project.Items, project.Installation, req.Type); len(failing) > 0 {
				respondWithError(w, http.StatusConflict, "gates de cierre pendientes: "+strings.Join(failing, ", "))
				return
			}
		}

		id := req.ID
		if id == "" {
			id = newProjectEventID()
		}

		var at time.Time
		if req.At != nil && !req.At.IsZero() {
			at = *req.At
		} else {
			at = time.Now()
		}

		var byUserID *string
		if claims != nil && claims.UserID != "" {
			byUserID = &claims.UserID
		}

		evt := domain.ProjectEvent{
			ID:        id,
			ProjectID: projectID,
			Type:      req.Type,
			At:        at,
			ByUserID:  byUserID,
			Source:    domain.NormalizeProjectEventSource(string(req.Source)),
			Note:      req.Note,
			Payload:   req.Payload,
			CreatedAt: time.Now(),
		}

		if err := s.Store.InsertProjectEvent(r.Context(), evt); err != nil {
			respondWithError(w, http.StatusInternalServerError, "no se pudo registrar el evento")
			return
		}

		respondWithJSON(w, http.StatusCreated, evt)

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "método no permitido")
	}
}
