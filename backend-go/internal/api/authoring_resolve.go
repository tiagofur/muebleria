package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// HandleFurnitureAuthoringResolve: POST /api/furniture/authoring/resolve
//
// #477 — the versioned rich authoring resolve boundary. SketchUp submits a
// structured semantic authoring snapshot (occurrences, relationship/joint
// intent, manual hardware placements — granete.sketchup-authoring-resolve.v1)
// and Granete returns the authoritative accepted/resolved result: #415 native
// layout with exact occurrence identities, machining with provenance,
// deterministic fingerprint, structured preflight issues and stable error
// codes. Clients branch on issue codes, never on message substrings.
//
// The operation is STATELESS: identical requests return identical responses
// and no Project/FurnitureInstance business record is created (nothing
// persists before #384/Gate A). POST is deliberate even though the resolve is
// read-like: authoring intent is a structured body, and keeping it out of the
// query string is exactly the proliferation this endpoint prevents — any
// query parameter present fails closed.
//
// Authorization is an explicit extension capability (#460 coordination), not
// method-based reasoning: extension tokens stay read-only except for the
// POST allowlist in the auth middleware that names this endpoint.
func (s *Server) HandleFurnitureAuthoringResolve(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	claims, ok := r.Context().Value(UserContextKey).(*auth.Claims)
	if !ok || claims == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}

	u, err := s.Store.GetUserByID(r.Context(), claims.UserID)
	if err != nil || u == nil {
		respondWithError(w, http.StatusUnauthorized, "invalid token")
		return
	}

	// Same workshop-license gate as the catalog/layout family.
	org, err := s.Store.GetOrganizationByID(r.Context(), storage.OrgFromCtx(r.Context()))
	if err != nil {
		respondWithInternalError(w, err, "load organization license")
		return
	}
	if org == nil || domain.LicenseStatusAt(org.LicensePlan, org.LicenseExpiresAt, time.Now()) != domain.LicenseStatusActive {
		respondWithError(w, http.StatusForbidden,
			"la licencia del taller no está activa. Pedile al administrador del taller que la renueve (plan y vencimiento) para usar la biblioteca de Granete.")
		return
	}

	// Negative proof for the ad-hoc query-parameter shortcut: the resolve
	// accepts NO query string at all, so ?shelf.../?hinge... keys can never
	// grow back.
	if len(r.URL.RawQuery) > 0 {
		s.writeAuthoringResolveEnvelope(w, http.StatusBadRequest, authoringResolveRequest{}, authoringStatusRejected,
			[]domain.ContractIssue{{
				Code:        "QUERY_PARAMETERS_UNSUPPORTED",
				Message:     "el resolve de autoría no acepta parámetros de query; la intención semántica viaja en el body versionado",
				Severity:    domain.IssueSeverityError,
				Path:        "query",
				Remediation: "Serialize the authoring intent in the granete.sketchup-authoring-resolve.v1 request body.",
			}})
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, authoringResolveMaxBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields() // unknown fields fail closed — no guessing a malformed schema
	var req authoringResolveRequest
	if err := dec.Decode(&req); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			s.writeAuthoringResolveEnvelope(w, http.StatusRequestEntityTooLarge, req, authoringStatusRejected, []domain.ContractIssue{{
				Code: "PAYLOAD_TOO_LARGE", Message: "el body del resolve excede el límite de 2 MiB",
				Severity:    domain.IssueSeverityError,
				Path:        "body",
				Remediation: "Resolve one furniture definition per request.",
			}})
			return
		}
		s.writeAuthoringResolveEnvelope(w, http.StatusBadRequest, req, authoringStatusRejected, []domain.ContractIssue{{
			Code: "REQUEST_INVALID", Message: "el body no es un request de resolve válido: " + err.Error(),
			Severity: domain.IssueSeverityError, Path: "body",
			Remediation: "Send exactly the granete.sketchup-authoring-resolve.v1 request shape; unknown fields are rejected.",
		}})
		return
	}
	if dec.More() {
		s.writeAuthoringResolveEnvelope(w, http.StatusBadRequest, req, authoringStatusRejected, []domain.ContractIssue{{
			Code: "REQUEST_INVALID", Message: "el body contiene JSON adicional después del request",
			Severity: domain.IssueSeverityError, Path: "body",
		}})
		return
	}

	// Schema identity fails before anything else mutates or resolves.
	if req.SchemaName != engine.AuthoringResolveSchemaName || req.SchemaID != engine.AuthoringResolveSchemaID {
		s.writeAuthoringResolveEnvelope(w, http.StatusBadRequest, req, authoringStatusRejected, []domain.ContractIssue{{
			Code:     "SCHEMA_ID_MISMATCH",
			Message:  "la identidad del schema debe ser " + engine.AuthoringResolveSchemaID,
			Severity: domain.IssueSeverityError, Path: "schemaId",
		}})
		return
	}
	if req.SchemaVersion != engine.AuthoringResolveSchemaVersion {
		s.writeAuthoringResolveEnvelope(w, http.StatusBadRequest, req, authoringStatusRejected, []domain.ContractIssue{{
			Code:     "SCHEMA_VERSION_UNSUPPORTED",
			Message:  "schemaVersion " + req.SchemaVersion + " no está soportado por este contrato",
			Severity: domain.IssueSeverityError, Path: "schemaVersion",
			Remediation: "Update the extension or target a supported resolve schema version.",
		}})
		return
	}

	if issues := validateAuthoringResolveEnvelopeFields(req); len(issues) > 0 {
		s.writeAuthoringResolveEnvelope(w, http.StatusBadRequest, req, authoringStatusRejected, issues)
		return
	}

	module, err := s.Store.GetModuleByID(r.Context(), req.Furniture.FurnitureDefinitionID)
	if err != nil {
		respondWithInternalError(w, err, "load module")
		return
	}
	if module == nil {
		s.writeAuthoringResolveEnvelope(w, http.StatusUnprocessableEntity, req, authoringStatusRejected, []domain.ContractIssue{{
			Code: "CATALOG_REFERENCE_MISSING", Message: "la definición de mueble " + req.Furniture.FurnitureDefinitionID + " no existe",
			Severity: domain.IssueSeverityError, Path: "furniture.furnitureDefinitionId",
			Remediation: "Resolve a definition from the current workshop catalog.",
		}})
		return
	}

	// ONE catalog read feeds BOTH the revision check and the resolve (#477
	// review: two reads could observe different catalog states and make the
	// resolve non-reproducible against the pinned revision).
	composition, revision, err := s.loadWorkshopCatalogOnce(r)
	if err != nil {
		respondWithInternalError(w, err, "load resolution catalog")
		return
	}
	catalog := composition

	// No implicit latest: the request MUST pin the catalog revision it was
	// authored against, and a drifted catalog rejects with the structured
	// code so the client refetches instead of resolving against moved truth.
	if req.Furniture.CatalogRevision == "" {
		s.writeAuthoringResolveEnvelope(w, http.StatusBadRequest, req, authoringStatusRejected, []domain.ContractIssue{{
			Code:     "REQUEST_INVALID",
			Message:  "furniture.catalogRevision es obligatorio: el resolve sólo es reproducible contra un catálogo pineado",
			Severity: domain.IssueSeverityError, Path: "furniture.catalogRevision",
			Remediation: "Carry the revisionId served by GET /api/furniture/definitions.",
		}})
		return
	}
	if revision != req.Furniture.CatalogRevision {
		s.writeAuthoringResolveEnvelope(w, http.StatusUnprocessableEntity, req, authoringStatusRejected, []domain.ContractIssue{{
			Code:     "CATALOG_REVISION_STALE",
			Message:  "el request fue armado contra la revisión " + req.Furniture.CatalogRevision + " del catálogo y la actual es " + revision,
			Severity: domain.IssueSeverityError, Path: "furniture.catalogRevision",
			Remediation: "Refetch the workshop catalog and rebuild the authoring snapshot against the new revision.",
		}})
		return
	}

	occurrences, occurrenceIssues := authoringOccurrencesFromWire(req.Furniture.Components)
	if len(occurrenceIssues) > 0 {
		s.writeAuthoringResolveEnvelope(w, http.StatusBadRequest, req, authoringStatusRejected, occurrenceIssues)
		return
	}
	placements, placementIssues := authoringPlacementsFromWire(req.Furniture.HardwarePlacements)
	if len(placementIssues) > 0 {
		s.writeAuthoringResolveEnvelope(w, http.StatusBadRequest, req, authoringStatusRejected, placementIssues)
		return
	}

	dims, issues := authoringDimsFromParameters(req.Furniture.Parameters, module)
	if len(issues) > 0 {
		s.writeAuthoringResolveEnvelope(w, http.StatusUnprocessableEntity, req, authoringStatusRejected, issues)
		return
	}
	if choiceIssues := validateMaterialChoices(req.Furniture.MaterialChoices, catalog.Materials); len(choiceIssues) > 0 {
		s.writeAuthoringResolveEnvelope(w, http.StatusUnprocessableEntity, req, authoringStatusRejected, choiceIssues)
		return
	}

	result, err := engine.ResolveAuthoringLayout(engine.AuthoringResolveInput{
		Module:                  *module,
		Catalog:                 catalog,
		Dims:                    dims,
		OptionChoices:           req.Furniture.MaterialChoices,
		PrecisionMm:             req.Units.PrecisionMm,
		Occurrences:             occurrences,
		Relationships:           req.Furniture.Relationships,
		ManualPlacements:        placements,
		ManualPlacementsPresent: req.Furniture.HardwarePlacements != nil,
	})
	if err != nil {
		s.writeAuthoringResolveEnvelope(w, http.StatusUnprocessableEntity, req, authoringStatusRejected, []domain.ContractIssue{{
			Code: "RESOLVE_GEOMETRY_INVALID", Message: err.Error(),
			Severity: domain.IssueSeverityError, Path: "furniture",
			Remediation: "Adjust the parameters/material choices so the definition resolves.",
		}})
		return
	}
	if len(result.StructuralIssues) > 0 {
		s.writeAuthoringResolveEnvelope(w, http.StatusUnprocessableEntity, req, authoringStatusRejected, result.StructuralIssues)
		return
	}

	s.writeAuthoringResolveAccepted(w, req, revision, result)
}

// authoringResolveMaxBodyBytes caps the resolve payload explicitly (contract
// §15: payload limits are part of the contract, not an afterthought).
const authoringResolveMaxBodyBytes = 2 << 20 // 2 MiB

type authoringResolveRequest struct {
	SchemaID         string                           `json:"schemaId"`
	SchemaName       string                           `json:"schemaName"`
	SchemaVersion    string                           `json:"schemaVersion"`
	MessageID        string                           `json:"messageId"`
	IdempotencyKey   string                           `json:"idempotencyKey"`
	SentAt           string                           `json:"sentAt"`
	Source           authoringResolveSource           `json:"source"`
	Units            authoringResolveUnits            `json:"units"`
	CoordinateSystem authoringResolveCoordinateSystem `json:"coordinateSystem"`
	Furniture        authoringResolveFurniture        `json:"furniture"`
}

type authoringResolveSource struct {
	Client        string `json:"client"`
	ClientVersion string `json:"clientVersion"`
	Host          string `json:"host"`
	HostVersion   string `json:"hostVersion"`
}

type authoringResolveUnits struct {
	Length      string  `json:"length"`
	Angle       string  `json:"angle"`
	PrecisionMm float64 `json:"precisionMm"`
}

type authoringResolveCoordinateSystem struct {
	Handedness     string `json:"handedness"`
	UpAxis         string `json:"upAxis"`
	ProjectFrameID string `json:"projectFrameId"`
}

type authoringResolveFurniture struct {
	FurnitureDefinitionID string `json:"furnitureDefinitionId"`
	// CatalogRevision is REQUIRED (#477 review: the resolve is reproducible
	// only against a pinned catalog; there is no implicit latest).
	CatalogRevision    string                         `json:"catalogRevision"`
	Parameters         map[string]any                 `json:"parameters,omitempty"`
	MaterialChoices    map[string]string              `json:"materialChoices,omitempty"`
	Components         []authoringOccurrenceWire      `json:"components,omitempty"`
	Relationships      []engine.AuthoringRelationship `json:"relationships,omitempty"`
	HardwarePlacements []authoringPlacementWire       `json:"hardwarePlacements,omitempty"`
}

type authoringOccurrenceWire struct {
	ComponentInstanceID   string                  `json:"componentInstanceId"`
	ComponentDefinitionID string                  `json:"componentDefinitionId,omitempty"`
	CatalogComponentID    string                  `json:"catalogComponentId,omitempty"`
	Role                  string                  `json:"role,omitempty"`
	Transform             *authoringTransformWire `json:"transform,omitempty"`
}

type authoringTransformWire struct {
	Frame         string    `json:"frame"`
	TranslationMm []float64 `json:"translationMm"`
}

type authoringPlacementWire struct {
	HardwarePlacementID     string    `json:"hardwarePlacementId"`
	CatalogHardwareID       string    `json:"catalogHardwareId"`
	HostComponentInstanceID string    `json:"hostComponentInstanceId"`
	AnchorFace              string    `json:"anchorFace"`
	OffsetMm                []float64 `json:"offsetMm"`
}

type authoringResolveResponse struct {
	SchemaID           string                            `json:"schemaId"`
	SchemaName         string                            `json:"schemaName"`
	SchemaVersion      string                            `json:"schemaVersion"`
	ResolveContract    string                            `json:"resolveContract"`
	ResponseMessageID  string                            `json:"responseMessageId"`
	InReplyToMessageID string                            `json:"inReplyToMessageId"`
	IdempotencyKey     string                            `json:"idempotencyKey"`
	CatalogRevision    string                            `json:"catalogRevision"`
	Status             string                            `json:"status"`
	NormalizedSnapshot *engine.NormalizedAuthoringIntent `json:"normalizedSnapshot,omitempty"`
	Resolved           *authoringResolveResolved         `json:"resolved,omitempty"`
	Issues             []domain.ContractIssue            `json:"issues"`
}

type authoringResolveResolved struct {
	Layout    engine.FurnitureLayout    `json:"layout"`
	Machining engine.AuthoringMachining `json:"machining"`
	Preflight authoringResolvePreflight `json:"preflight"`
}

type authoringResolvePreflight struct {
	// Scope pins the semantics: this is the resolve-scoped validation
	// subset, NEVER the #347 fabrication-readiness verdict — the full model
	// is only linked through PreflightContract.
	Scope             string                 `json:"scope"`
	Status            string                 `json:"status"`
	Issues            []domain.ContractIssue `json:"issues"`
	PreflightContract string                 `json:"preflightContract"`
}

const (
	authoringStatusAccepted = "accepted"
	authoringStatusRejected = "rejected"
)

// writeAuthoringResolveEnvelope serializes the deterministic resolve
// envelope. The schema triple echoed is always the SERVER's contract version
// (the capability marker), even on mismatch, so clients can detect drift.
func (s *Server) writeAuthoringResolveEnvelope(w http.ResponseWriter, httpStatus int, req authoringResolveRequest, status string, issues []domain.ContractIssue) {
	// No half-correlation ever: an envelope whose request message was never
	// read (transport-level rejection) carries NO correlation fields' values.
	responseMessageID := ""
	if req.MessageID != "" {
		responseMessageID = "resolve-" + req.MessageID
	}
	response := authoringResolveResponse{
		SchemaID:           engine.AuthoringResolveSchemaID,
		SchemaName:         engine.AuthoringResolveSchemaName,
		SchemaVersion:      engine.AuthoringResolveSchemaVersion,
		ResolveContract:    engine.AuthoringResolveSchemaID,
		ResponseMessageID:  responseMessageID,
		InReplyToMessageID: req.MessageID,
		IdempotencyKey:     req.IdempotencyKey,
		CatalogRevision:    req.Furniture.CatalogRevision,
		Status:             status,
		Issues:             issues,
	}
	if response.Issues == nil {
		response.Issues = []domain.ContractIssue{}
	}
	body, err := json.Marshal(response)
	if err != nil {
		respondWithInternalError(w, err, "marshal resolve envelope")
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(httpStatus)
	_, _ = w.Write(body)
}

// writeAuthoringResolveAccepted serializes the accepted result with the
// normalized snapshot and the resolved sections.
func (s *Server) writeAuthoringResolveAccepted(w http.ResponseWriter, req authoringResolveRequest, revision string, result *engine.AuthoringResolveResult) {
	validationIssues := result.ValidationIssues
	if validationIssues == nil {
		validationIssues = []domain.ContractIssue{}
	}
	response := authoringResolveResponse{
		SchemaID:           engine.AuthoringResolveSchemaID,
		SchemaName:         engine.AuthoringResolveSchemaName,
		SchemaVersion:      engine.AuthoringResolveSchemaVersion,
		ResolveContract:    engine.AuthoringResolveSchemaID,
		ResponseMessageID:  "resolve-" + req.MessageID,
		InReplyToMessageID: req.MessageID,
		IdempotencyKey:     req.IdempotencyKey,
		CatalogRevision:    revision,
		Status:             authoringStatusAccepted,
		NormalizedSnapshot: &result.Normalized,
		Resolved: &authoringResolveResolved{
			Layout:    result.Layout,
			Machining: result.Machining,
			Preflight: authoringResolvePreflight{
				Scope:             engine.AuthoringValidationScope,
				Status:            result.ValidationStatus,
				Issues:            validationIssues,
				PreflightContract: engine.ManufacturingPreflightContract,
			},
		},
		Issues: validationIssues,
	}
	body, err := json.Marshal(response)
	if err != nil {
		respondWithInternalError(w, err, "marshal resolve envelope")
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}

// validateAuthoringResolveEnvelopeFields checks the transport-envelope
// fields the resolve needs for deterministic stateless correlation.
func validateAuthoringResolveEnvelopeFields(req authoringResolveRequest) []domain.ContractIssue {
	issues := []domain.ContractIssue{}
	invalid := func(path, message string) {
		issues = append(issues, domain.ContractIssue{
			Code: "REQUEST_INVALID", Message: message, Severity: domain.IssueSeverityError, Path: path,
		})
	}

	if strings.TrimSpace(req.MessageID) == "" {
		invalid("messageId", "messageId es obligatorio")
	}
	if strings.TrimSpace(req.IdempotencyKey) == "" {
		invalid("idempotencyKey", "idempotencyKey es obligatorio")
	}
	if len(req.IdempotencyKey) > 128 {
		invalid("idempotencyKey", "idempotencyKey no puede exceder 128 caracteres")
	}
	if strings.TrimSpace(req.SentAt) == "" {
		invalid("sentAt", "sentAt es obligatorio")
	}
	if strings.TrimSpace(req.Source.Client) == "" || strings.TrimSpace(req.Source.Host) == "" ||
		strings.TrimSpace(req.Source.ClientVersion) == "" || strings.TrimSpace(req.Source.HostVersion) == "" {
		invalid("source", "source client/clientVersion/host/hostVersion son obligatorios")
	}
	if req.Units.Length != "mm" || req.Units.Angle != "deg" ||
		math.IsNaN(req.Units.PrecisionMm) || req.Units.PrecisionMm <= 0 || req.Units.PrecisionMm > 1 {
		invalid("units", "units debe ser { length: mm, angle: deg, precisionMm en (0,1] }")
	}
	if req.CoordinateSystem.Handedness != "right" || req.CoordinateSystem.UpAxis != "z" ||
		strings.TrimSpace(req.CoordinateSystem.ProjectFrameID) == "" {
		invalid("coordinateSystem", "coordinateSystem debe ser { handedness: right, upAxis: z, projectFrameId }")
	}
	if strings.TrimSpace(req.Furniture.FurnitureDefinitionID) == "" {
		issues = append(issues, domain.ContractIssue{
			Code: "CATALOG_REFERENCE_MISSING", Message: "furniture.furnitureDefinitionId es obligatorio",
			Severity: domain.IssueSeverityError, Path: "furniture.furnitureDefinitionId",
		})
	}
	return issues
}

// authoringDimsFromParameters maps the v1 parameter vocabulary
// (widthMm/heightMm/depthMm) onto layout dims. Unknown keys fail closed —
// feature-specific parameters are exactly the proliferation this endpoint
// replaces.
func authoringDimsFromParameters(parameters map[string]any, module *domain.Module) (*engine.LayoutDims, []domain.ContractIssue) {
	if parameters == nil {
		return nil, nil
	}
	dims := &engine.LayoutDims{
		WidthMm:  module.WidthMm,
		HeightMm: module.HeightMm,
		DepthMm:  module.DepthMm,
	}
	seen := false
	for key, raw := range parameters {
		switch key {
		case "widthMm", "heightMm", "depthMm":
		default:
			return nil, []domain.ContractIssue{{
				Code: "PARAMETER_INVALID", Message: "parámetro desconocido " + key,
				Severity: domain.IssueSeverityError, Path: "furniture.parameters." + key,
				Remediation: "v1 resuelve widthMm/heightMm/depthMm; la intención semántica rica viaja en components/relationships/hardwarePlacements.",
			}}
		}
		value, ok := raw.(float64)
		if !ok || value != math.Trunc(value) || value <= 0 || value > 1_000_000 {
			return nil, []domain.ContractIssue{{
				Code: "PARAMETER_INVALID", Message: key + " debe ser un número entero de milímetros mayor a 0",
				Severity: domain.IssueSeverityError, Path: "furniture.parameters." + key,
			}}
		}
		seen = true
		switch key {
		case "widthMm":
			dims.WidthMm = int(value)
		case "heightMm":
			dims.HeightMm = int(value)
		case "depthMm":
			dims.DepthMm = int(value)
		}
	}
	if !seen {
		return nil, nil
	}
	return dims, nil
}

// validateMaterialChoices rejects unknown/inactive board choices up front so
// the issue carries the resolve code instead of a raw engine error.
func validateMaterialChoices(choices map[string]string, materials []domain.MaterialBoard) []domain.ContractIssue {
	if len(choices) == 0 {
		return nil
	}
	active := make(map[string]bool, len(materials))
	for _, material := range materials {
		active[material.ID] = material.Active
	}
	for role, materialID := range choices {
		if active[materialID] {
			continue
		}
		return []domain.ContractIssue{{
			Code:     "MATERIAL_CHOICE_INVALID",
			Message:  "la elección " + role + "=" + materialID + " no corresponde a un tablero activo del catálogo",
			Severity: domain.IssueSeverityError, Path: "furniture.materialChoices." + role,
			Remediation: "Choose an active material board for that role.",
		}}
	}
	return nil
}

// loadWorkshopCatalogOnce performs ONE read of every catalog list and
// returns both the resolution catalog and the content-addressed workshop
// revision computed from the SAME data (the revision GET
// /api/furniture/definitions serves and ETags). One read = the pinned check
// and the resolve observe the same catalog state.
func (s *Server) loadWorkshopCatalogOnce(r *http.Request) (domain.Catalog, string, error) {
	modules, err := s.Store.ListModules(r.Context())
	if err != nil {
		return domain.Catalog{}, "", err
	}
	categories, err := s.Store.ListCategories(r.Context())
	if err != nil {
		return domain.Catalog{}, "", err
	}
	materialCategories, err := s.Store.ListMaterialCategories(r.Context())
	if err != nil {
		return domain.Catalog{}, "", err
	}
	optionGroups, err := s.Store.ListOptionGroups(r.Context())
	if err != nil {
		return domain.Catalog{}, "", err
	}
	structures, err := s.Store.ListStructures(r.Context())
	if err != nil {
		return domain.Catalog{}, "", err
	}
	components, err := s.Store.ListComponents(r.Context())
	if err != nil {
		return domain.Catalog{}, "", err
	}
	agregados, err := s.Store.ListAgregados(r.Context())
	if err != nil {
		return domain.Catalog{}, "", err
	}
	hardware, err := s.Store.ListHardwares(r.Context())
	if err != nil {
		return domain.Catalog{}, "", err
	}
	materials, err := s.Store.ListMaterialBoards(r.Context())
	if err != nil {
		return domain.Catalog{}, "", err
	}
	composition := domain.Catalog{
		Structures:   structures,
		Components:   components,
		Agregados:    agregados,
		Hardware:     hardware,
		Materials:    materials,
		OptionGroups: optionGroups,
	}
	catalog := buildWorkshopFurnitureCatalog(modules, categories, materialCategories, composition)
	return composition, workshopCatalogRevisionID(catalog), nil
}

// authoringOccurrencesFromWire converts wire occurrences (slice-based
// arrays) into engine occurrences, rejecting wrong-length or non-finite
// translations: Go fixed arrays silently truncate/extend on JSON decode, so
// the exact length is enforced here.
func authoringOccurrencesFromWire(wire []authoringOccurrenceWire) ([]engine.AuthoringOccurrence, []domain.ContractIssue) {
	if wire == nil {
		return nil, nil
	}
	issues := []domain.ContractIssue{}
	out := make([]engine.AuthoringOccurrence, 0, len(wire))
	for i, occurrence := range wire {
		path := fmt.Sprintf("furniture.components[%d]", i)
		engineOccurrence := engine.AuthoringOccurrence{
			ComponentInstanceID:   occurrence.ComponentInstanceID,
			ComponentDefinitionID: occurrence.ComponentDefinitionID,
			CatalogComponentID:    occurrence.CatalogComponentID,
			Role:                  occurrence.Role,
		}
		if occurrence.Transform != nil {
			translation, issue := wireTranslation(occurrence.Transform, path)
			if issue != nil {
				issues = append(issues, *issue)
				continue
			}
			engineOccurrence.Transform = translation
		}
		out = append(out, engineOccurrence)
	}
	return out, issues
}

func wireTranslation(transform *authoringTransformWire, path string) (*engine.AuthoringOccurrenceTransform, *domain.ContractIssue) {
	if transform.Frame != "assembly" {
		return nil, &domain.ContractIssue{
			Code:     "TRANSFORM_INVALID",
			Message:  "occurrence transform frame must be assembly",
			Severity: domain.IssueSeverityError, Path: path + ".transform.frame",
		}
	}
	if len(transform.TranslationMm) != 3 {
		return nil, &domain.ContractIssue{
			Code:     "TRANSFORM_INVALID",
			Message:  fmt.Sprintf("translationMm must carry exactly 3 millimeters, got %d", len(transform.TranslationMm)),
			Severity: domain.IssueSeverityError, Path: path + ".transform.translationMm",
		}
	}
	for _, value := range transform.TranslationMm {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return nil, &domain.ContractIssue{
				Code:     "TRANSFORM_INVALID",
				Message:  "translationMm must be finite millimeters",
				Severity: domain.IssueSeverityError, Path: path + ".transform.translationMm",
			}
		}
	}
	return &engine.AuthoringOccurrenceTransform{
		Frame:         "assembly",
		TranslationMm: [3]float64{transform.TranslationMm[0], transform.TranslationMm[1], transform.TranslationMm[2]},
	}, nil
}

// authoringPlacementsFromWire converts wire placements, enforcing the exact
// offsetMm length and finiteness.
func authoringPlacementsFromWire(wire []authoringPlacementWire) ([]engine.AuthoringManualPlacement, []domain.ContractIssue) {
	if wire == nil {
		return nil, nil
	}
	issues := []domain.ContractIssue{}
	out := make([]engine.AuthoringManualPlacement, 0, len(wire))
	for i, placement := range wire {
		path := fmt.Sprintf("furniture.hardwarePlacements[%d]", i)
		if len(placement.OffsetMm) != 2 {
			issues = append(issues, domain.ContractIssue{
				Code:     "HARDWARE_PLACEMENT_INVALID",
				Message:  fmt.Sprintf("offsetMm must carry exactly 2 millimeters, got %d", len(placement.OffsetMm)),
				Severity: domain.IssueSeverityError, Path: path + ".offsetMm",
			})
			continue
		}
		if math.IsNaN(placement.OffsetMm[0]) || math.IsInf(placement.OffsetMm[0], 0) ||
			math.IsNaN(placement.OffsetMm[1]) || math.IsInf(placement.OffsetMm[1], 0) {
			issues = append(issues, domain.ContractIssue{
				Code:     "HARDWARE_PLACEMENT_INVALID",
				Message:  "offsetMm must be finite millimeters",
				Severity: domain.IssueSeverityError, Path: path + ".offsetMm",
			})
			continue
		}
		out = append(out, engine.AuthoringManualPlacement{
			HardwarePlacementID:     placement.HardwarePlacementID,
			CatalogHardwareID:       placement.CatalogHardwareID,
			HostComponentInstanceID: placement.HostComponentInstanceID,
			AnchorFace:              placement.AnchorFace,
			OffsetMm:                [2]float64{placement.OffsetMm[0], placement.OffsetMm[1]},
		})
	}
	return out, issues
}
