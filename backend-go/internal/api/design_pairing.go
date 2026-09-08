package api

import (
	"crypto/rand"
	"errors"
	"math/big"
	"net/http"
	"strings"
	"time"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// #499 / DT-SU-1: secure Web-to-SketchUp Project/Design pairing grants.
//
// Slice boundary: this file owns grant create/exchange/status/cancel ONLY —
// the Web "Abrir en SketchUp" UX and the plugin's code-entry are later
// slices. Authority rules:
//   * creation is a web-session command over an exact Project/Design the
//     caller can access; the code is returned exactly once and stored
//     hash-only;
//   * exchange is extension-credential-only (#460 boundary): a web session
//     can never exchange, and the consuming transaction runs under the
//     device's own tenant scope so foreign codes are uniformly 404;
//   * the authoritative context/capabilities payload reuses the #388 model
//     binding validation verbatim — no second validation model;
//   * codes never appear in URLs, logs or audit details.

const (
	// pairingGrantTTL mirrors the device-enrollment claim window: long
	// enough to copy a code into the plugin, short enough to blunt leakage.
	pairingGrantTTL   = 10 * time.Minute
	pairingCodeLength = 12
)

// generatePairingCode mints an opaque one-time code. crypto/rand.Int draws
// each character uniformly over the alphabet — no modulo bias for any
// alphabet size (the 32-char device alphabet made %256 bias-free only by
// coincidence; this stays correct if the alphabet ever changes).
func generatePairingCode() (string, error) {
	max := big.NewInt(int64(len(deviceCodeAlphabet)))
	out := make([]byte, pairingCodeLength)
	for i := range out {
		n, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", err
		}
		out[i] = deviceCodeAlphabet[n.Int64()]
	}
	return string(out), nil
}

// HandleDesignPairingGrantCreate serves POST for
// /api/projects/{projectId}/designs/{designId}/pairing-grants.
func (s *Server) HandleDesignPairingGrantCreate(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanAccessProjects), "no tenés permiso para vincular diseños de esta obra") {
		return
	}
	projectID := r.PathValue("projectId")
	designID := r.PathValue("designId")
	if !isValidUUID(projectID) || !isValidUUID(designID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "IDs inválidos", nil)
		return
	}

	var body openapi.CreatePairingGrantRequest
	if !decodeGeneratedJSONBody(w, r, &body) {
		return
	}
	action := string(body.Action)
	if !domain.IsValidPairingAction(action) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "Acción de vinculación desconocida", nil)
		return
	}
	var pinnedBase string
	if body.BaseRevisionID != nil {
		pinnedBase = strings.TrimSpace(*body.BaseRevisionID)
		if pinnedBase != "" && !isValidUUID(pinnedBase) {
			respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "base_revision_id inválido", nil)
			return
		}
	}

	code, err := generatePairingCode()
	if err != nil {
		respondWithInternalError(w, err, "pairing-grant: code entropy")
		return
	}
	grant, err := s.Store.CreateDesignPairingGrant(r.Context(), storage.CreateDesignPairingGrantCommand{
		ProjectID:      projectID,
		DesignID:       designID,
		BaseRevisionID: pinnedBase,
		Action:         action,
		Code:           code,
		TTL:            pairingGrantTTL,
		ActorUserID:    claims.UserID,
		SessionID:      claims.Sid,
		IP:             clientIP(r),
		RequestID:      RequestIDFromContext(r.Context()),
	})
	if err != nil {
		switch {
		case errors.Is(err, domain.ErrInvalidDesignCommand):
			respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "Solicitud de vinculación inválida", nil)
		case errors.Is(err, domain.ErrDesignNotFound):
			// Uniform 404: missing, foreign and cross-project objects are
			// indistinguishable (#388 negative proofs).
			respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "El proyecto o el diseño no existe", nil)
		case errors.Is(err, domain.ErrDesignRevisionNotFound):
			respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "La revisión de diseño no existe", nil)
		default:
			respondWithInternalError(w, err, "pairing-grant: create")
		}
		return
	}

	respondWithJSON(w, http.StatusCreated, openapi.PairingGrantCreated{
		ID:             grant.ID,
		Action:         openapi.PairingAction(grant.Action),
		Status:         openapi.PairingGrantStatusKind(grant.Status),
		BaseRevisionID: nullableRevisionID(grant.BaseRevisionID),
		Code:           code,
		ExpiresAt:      grant.ExpiresAt.UTC().Format(time.RFC3339Nano),
		CreatedAt:      grant.CreatedAt.UTC().Format(time.RFC3339Nano),
	})
}

// HandleDesignPairingGrantExchange serves POST for
// /api/design-pairing-grants:exchange — extension credential only.
func (s *Server) HandleDesignPairingGrantExchange(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	// The pairing grant is a Web→SketchUp handoff: exchanging with a web
	// session would let a browser mint binding context outside the device
	// boundary, so the credential class is part of the contract.
	if claims.Client != auth.ExtensionClient {
		respondWithError(w, http.StatusForbidden, "el intercambio de vinculación requiere el credencial de la extensión")
		return
	}
	// Org-less device tokens carry no tenant scope; the grant lookup is
	// organization-scoped, so fail closed before any data access.
	if claims.OrgID == "" {
		respondWithError(w, http.StatusForbidden, "elegí un taller para continuar")
		return
	}

	var body openapi.ExchangePairingGrantRequest
	if !decodeGeneratedJSONBody(w, r, &body) {
		return
	}
	code := normalizeDeviceCode(body.Code)
	if len(code) != pairingCodeLength {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "Código de vinculación inválido", nil)
		return
	}

	// The storage resolves the #388 binding validation (with the grant's
	// frozen base revision pin) and the conditional consume in ONE coherent
	// transaction: a validation failure rolls back and leaves the grant
	// pending — the code is never burned by an invalid binding.
	result, err := s.Store.ExchangeDesignPairingGrant(r.Context(), storage.ExchangeDesignPairingGrantCommand{
		Code:                 code,
		ExchangedByUserID:    claims.UserID,
		ExchangedBySessionID: claims.Sid,
		IP:                   clientIP(r),
		RequestID:            RequestIDFromContext(r.Context()),
	})
	if err != nil {
		switch {
		case errors.Is(err, storage.ErrPairingGrantNotFound):
			// Uniform 404: unknown code AND another organization's code are
			// indistinguishable — never a scope probe (#499 security
			// properties).
			respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "El código de vinculación no existe o expiró", nil)
		case errors.Is(err, storage.ErrPairingGrantConflict):
			respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "El código de vinculación ya fue usado, expiró o fue cancelado", nil)
		case errors.Is(err, domain.ErrDesignNotFound):
			// Exact binding validation failure: the grant was NOT consumed.
			respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "El proyecto o el diseño no existe", nil)
		case errors.Is(err, domain.ErrDesignRevisionNotFound):
			// The frozen pin no longer resolves to this design's lineage.
			respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "La revisión de diseño no existe", nil)
		default:
			respondWithInternalError(w, err, "pairing-grant: exchange")
		}
		return
	}
	grant, ctx := result.Grant, result.BindingContext

	// Capabilities mirror the binding:validate permission gates exactly.
	roles := actorRoles(claims)
	state := openapi.ModelBindingStateValid
	if ctx.Design.Status == domain.DesignStatusArchived {
		state = openapi.ModelBindingStateDesignArchived
	}
	var baseRevID *string
	var baseRevNum *int64
	if ctx.WorkingCopyBaseRevisionID != nil && *ctx.WorkingCopyBaseRevisionID != "" {
		id := *ctx.WorkingCopyBaseRevisionID
		baseRevID = &id
		if ctx.BaseRevisionNumber != nil {
			num := int64(*ctx.BaseRevisionNumber)
			baseRevNum = &num
		}
	}

	respondWithJSON(w, http.StatusOK, openapi.PairingGrantExchange{
		GrantID:              grant.ID,
		Action:               openapi.PairingAction(grant.Action),
		PinnedBaseRevisionID: nullableRevisionID(grant.BaseRevisionID),
		State:                state,
		SchemaVersion:        ModelBindingSchemaVersion,
		Organization: openapi.ModelBindingOrganizationSummary{
			ID:   ctx.OrganizationID,
			Name: ctx.OrganizationName,
		},
		Project: openapi.ModelBindingProjectSummary{
			ID:   ctx.ProjectID,
			Name: ctx.ProjectName,
		},
		Design: openapi.ModelBindingDesignSummary{
			ID:     ctx.Design.ID,
			Name:   ctx.Design.Name,
			Status: openapi.DesignStatus(ctx.Design.Status),
		},
		WorkingCopy: openapi.ModelBindingWorkingCopySummary{
			BaseRevisionID:     baseRevID,
			BaseRevisionNumber: baseRevNum,
			UpdatedAt:          ctx.WorkingCopyUpdatedAt.UTC().Format(time.RFC3339Nano),
		},
		Capabilities: openapi.ModelBindingCapabilities{
			CanEditWorkingCopy: state == openapi.ModelBindingStateValid &&
				domain.AnyRole(roles, domain.RoleCanAccessProjects),
			CanPublishRevision: state == openapi.ModelBindingStateValid &&
				domain.AnyRole(roles, domain.RoleCanMutateProjects),
		},
	})
}

// HandleDesignPairingGrantStatus serves GET for
// /api/projects/{projectId}/designs/{designId}/pairing-grants/{grantId}.
func (s *Server) HandleDesignPairingGrantStatus(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	if r.Method != http.MethodGet {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanAccessProjects), "no tenés permiso para ver la vinculación de esta obra") {
		return
	}
	projectID := r.PathValue("projectId")
	designID := r.PathValue("designId")
	grantID := r.PathValue("grantId")

	grant, err := s.Store.GetDesignPairingGrant(r.Context(), projectID, designID, grantID)
	if err != nil {
		if errors.Is(err, storage.ErrPairingGrantNotFound) {
			// Uniform 404: unknown, foreign-org and cross-paired grants are
			// indistinguishable.
			respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "La vinculación no existe", nil)
			return
		}
		respondWithInternalError(w, err, "pairing-grant: status")
		return
	}

	respondWithJSON(w, http.StatusOK, openapi.PairingGrantStatus{
		ID:             grant.ID,
		Action:         openapi.PairingAction(grant.Action),
		Status:         openapi.PairingGrantStatusKind(domain.DerivedPairingStatus(*grant, time.Now())),
		BaseRevisionID: nullableRevisionID(grant.BaseRevisionID),
		ExpiresAt:      grant.ExpiresAt.UTC().Format(time.RFC3339Nano),
		CreatedAt:      grant.CreatedAt.UTC().Format(time.RFC3339Nano),
		ExchangedAt:    formatRFC3339Ptr(grant.ExchangedAt),
	})
}

// HandleDesignPairingGrantCancel serves POST for
// /api/projects/{projectId}/designs/{designId}/pairing-grants/{grantId}:cancel.
func (s *Server) HandleDesignPairingGrantCancel(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claims), domain.RoleCanAccessProjects), "no tenés permiso para cancelar la vinculación de esta obra") {
		return
	}
	projectID := r.PathValue("projectId")
	designID := r.PathValue("designId")
	grantID := r.PathValue("grantId")

	grant, err := s.Store.CancelDesignPairingGrant(r.Context(), storage.CancelDesignPairingGrantCommand{
		ProjectID:   projectID,
		DesignID:    designID,
		GrantID:     grantID,
		ActorUserID: claims.UserID,
		IP:          clientIP(r),
		RequestID:   RequestIDFromContext(r.Context()),
	})
	if err != nil {
		switch {
		case errors.Is(err, storage.ErrPairingGrantNotFound):
			respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "La vinculación no existe", nil)
		case errors.Is(err, storage.ErrPairingGrantConflict):
			respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "La vinculación ya no está pendiente", nil)
		default:
			respondWithInternalError(w, err, "pairing-grant: cancel")
		}
		return
	}

	respondWithJSON(w, http.StatusOK, openapi.PairingGrantStatus{
		ID:             grant.ID,
		Action:         openapi.PairingAction(grant.Action),
		Status:         openapi.PairingGrantStatusKind(grant.Status),
		BaseRevisionID: nullableRevisionID(grant.BaseRevisionID),
		ExpiresAt:      grant.ExpiresAt.UTC().Format(time.RFC3339Nano),
		CreatedAt:      grant.CreatedAt.UTC().Format(time.RFC3339Nano),
		ExchangedAt:    formatRFC3339Ptr(grant.ExchangedAt),
	})
}

func formatRFC3339Ptr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	formatted := t.UTC().Format(time.RFC3339Nano)
	return &formatted
}

// nullableRevisionID maps the storage scan shape (COALESCE to ”) back to a
// JSON null: an absent pinned base must serialize as null, never as "".
func nullableRevisionID(id *string) *string {
	if id == nil || *id == "" {
		return nil
	}
	return id
}

// HandleDesignPairingGrantConfirm serves POST for
// /api/design-pairing-grants/{grantId}:confirm — extension credential only.
//
// Confirmation means the extension persisted AND read back the canonical
// com.granete.project binding with the exact identity the grant pinned.
// Only the session that exchanged may confirm; the payload carries exact
// persisted identifiers, never model data.
func (s *Server) HandleDesignPairingGrantConfirm(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	if claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if claims.Client != auth.ExtensionClient {
		respondWithError(w, http.StatusForbidden, "la confirmación de vinculación requiere el credencial de la extensión")
		return
	}
	if claims.OrgID == "" {
		respondWithError(w, http.StatusForbidden, "elegí un taller para continuar")
		return
	}
	grantID := r.PathValue("grantId")
	if !isValidUUID(grantID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "grantId inválido", nil)
		return
	}

	var body openapi.ConfirmPairingGrantRequest
	if !decodeGeneratedJSONBody(w, r, &body) {
		return
	}
	if !isValidUUID(body.ProjectID) || !isValidUUID(body.DesignID) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "Identidad persistida inválida", nil)
		return
	}
	persistedBase := ""
	if body.BaseRevisionID != nil {
		persistedBase = strings.TrimSpace(*body.BaseRevisionID)
	}

	grant, err := s.Store.ConfirmDesignPairingGrant(r.Context(), storage.ConfirmDesignPairingGrantCommand{
		GrantID:              grantID,
		PersistedProjectID:   body.ProjectID,
		PersistedDesignID:    body.DesignID,
		PersistedBaseRevID:   persistedBase,
		ConfirmedByUserID:    claims.UserID,
		ConfirmedBySessionID: claims.Sid,
		IP:                   clientIP(r),
		RequestID:            RequestIDFromContext(r.Context()),
	})
	if err != nil {
		switch {
		case errors.Is(err, storage.ErrPairingGrantNotFound):
			respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "La vinculación no existe", nil)
		case errors.Is(err, storage.ErrPairingGrantMismatch):
			respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "La identidad confirmada no coincide con la vinculación (proyecto, diseño o revisión base)", nil)
		case errors.Is(err, storage.ErrPairingGrantConflict):
			respondWithAPIError(w, http.StatusConflict, openapi.ApiErrorCodeConflict, "La vinculación no puede confirmarse desde esta sesión", nil)
		case errors.Is(err, domain.ErrDesignNotFound), errors.Is(err, domain.ErrDesignRevisionNotFound):
			respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "El proyecto o el diseño no existe", nil)
		default:
			respondWithInternalError(w, err, "pairing-grant: confirm")
		}
		return
	}

	respondWithJSON(w, http.StatusOK, openapi.PairingGrantStatus{
		ID:             grant.ID,
		Action:         openapi.PairingAction(grant.Action),
		Status:         openapi.PairingGrantStatusKind(grant.Status),
		BaseRevisionID: nullableRevisionID(grant.BaseRevisionID),
		ExpiresAt:      grant.ExpiresAt.UTC().Format(time.RFC3339Nano),
		CreatedAt:      grant.CreatedAt.UTC().Format(time.RFC3339Nano),
		ExchangedAt:    formatRFC3339Ptr(grant.ExchangedAt),
		ConfirmedAt:    formatRFC3339Ptr(grant.ConfirmedAt),
	})
}
