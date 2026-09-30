package api

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"sort"
	"time"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// HandleFurnitureAuthoringPreview: POST /api/furniture/authoring/preview
//
// #497 — the web catalog editor's "Probar resolución": resolve a DRAFT set of
// typed parameter definitions (what the editor is about to save) plus sample
// values through the SAME engine and validation pipeline as the versioned
// authoring resolve (#477), without persisting anything. The response carries
// the would-be definitionHash, the draft's published parameter set (including
// the synthesized dimension projections) and the resolved result, so the
// browser can show component counts, preflight issues and a read-only 3D
// render without ever computing manufacturing consequences itself.
//
// STATELESS like the resolve: no catalog row changes and the
// workshopCatalogRevisionID does not advance. The `resolved` section is the
// resolve engine's own output and stays OUT of granete-api.v1.yaml — like the
// #477 resolve it is golden-pinned by the domain contract (single authority,
// no second validation model); the web client consumes it through
// GraneteApiClient with a domain parser, not the generated client.
//
// Fail-closed boundaries: unknown fields, trailing JSON, query parameters and
// oversized bodies are rejected; every rejected DRAFT answers 422 with
// structured issues and NO resolved data (the same rule as the rejected
// resolve response).
func (s *Server) HandleFurnitureAuthoringPreview(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithAPIError(w, http.StatusMethodNotAllowed, openapi.ApiErrorCodeMethodNotAllowed, "el preview de autoría sólo acepta POST", nil)
		return
	}
	claims, ok := r.Context().Value(UserContextKey).(*auth.Claims)
	if !ok || claims == nil {
		respondWithAPIError(w, http.StatusUnauthorized, openapi.ApiErrorCodeUnauthorized, "se requiere un token válido", nil)
		return
	}
	u, err := s.Store.GetUserByID(r.Context(), claims.UserID)
	if err != nil || u == nil {
		respondWithAPIError(w, http.StatusUnauthorized, openapi.ApiErrorCodeUnauthorized, "se requiere un token válido", nil)
		return
	}
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

	mediaType, _, contentTypeErr := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if contentTypeErr != nil || mediaType != "application/json" {
		respondWithAPIError(w, http.StatusUnsupportedMediaType, openapi.ApiErrorCodeBadRequest, "Content-Type debe ser application/json", nil)
		return
	}
	if len(r.URL.RawQuery) > 0 {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "el preview de autoría no acepta parámetros de query; el draft viaja en el body", nil)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, authoringResolveMaxBodyBytes)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	var req authoringPreviewRequest
	if err := dec.Decode(&req); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			respondWithAPIError(w, http.StatusRequestEntityTooLarge, openapi.ApiErrorCodeBadRequest, "el body del preview excede el límite de 2 MiB", nil)
			return
		}
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "el body no es un request de preview válido: "+err.Error(), nil)
		return
	}
	var trailing any
	if err := dec.Decode(&trailing); !errors.Is(err, io.EOF) {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "el body contiene JSON adicional después del request", nil)
		return
	}
	if len(req.ParameterDefinitions) > authoringMaxParameterCount {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "parameterDefinitions no puede exceder 256 entradas", nil)
		return
	}
	if len(req.Parameters) > authoringMaxParameterCount || len(req.MaterialChoices) > authoringMaxMaterialChoiceCount {
		respondWithAPIError(w, http.StatusBadRequest, openapi.ApiErrorCodeBadRequest, "parameters y materialChoices no pueden exceder 256 entradas", nil)
		return
	}

	// ONE authoritative catalog read, exactly like the resolve: the draft is
	// resolved against the module's current composition and the revision is
	// echoed so the client can display which truth it was previewed against.
	snapshot, err := s.loadWorkshopCatalogOnce(r)
	if err != nil {
		if definitionErr, ok := furnitureParameterDefinitionsError(err); ok {
			respondWithParameterDefinitionIssues(w, definitionErr.Issues)
			return
		}
		respondWithInternalError(w, err, "load preview catalog")
		return
	}
	module := snapshot.module(req.ModuleID)
	if module == nil {
		respondWithAPIError(w, http.StatusNotFound, openapi.ApiErrorCodeNotFound, "el mueble "+req.ModuleID+" no existe en el catálogo actual", nil)
		return
	}

	// Draft boundary first: the persisted shape (closed fields, no reserved
	// dimension names, no dimensionColumn bindings) before anything else.
	if issues := domain.ValidatePersistedFurnitureParameterDefinitions(req.ParameterDefinitions); len(issues) != 0 {
		s.writeAuthoringPreviewRejected(w, req.ModuleID, snapshot.Revision, parameterDefinitionContractIssues(issues))
		return
	}

	// The draft's published set = draft + the module's synthesized dimension
	// projections (ranges from the module's own dims and presets), sorted and
	// validated exactly like the catalog assembly does before hashing.
	published := snapshot.Projection.Definitions[module.ID]
	draftParameters := make([]domain.FurnitureParameterDefinition, 0, len(req.ParameterDefinitions)+3)
	draftParameters = append(draftParameters, req.ParameterDefinitions...)
	for _, parameter := range published.Parameters {
		if parameter.Binding != nil && parameter.Binding.Kind == domain.FurnitureParameterBindingDimensionColumn {
			draftParameters = append(draftParameters, parameter)
		}
	}
	sort.SliceStable(draftParameters, func(i, j int) bool {
		if draftParameters[i].SortOrder != draftParameters[j].SortOrder {
			return draftParameters[i].SortOrder < draftParameters[j].SortOrder
		}
		return draftParameters[i].Name < draftParameters[j].Name
	})
	if issues := domain.ValidatePublishedFurnitureParameterDefinitions(draftParameters); len(issues) != 0 {
		s.writeAuthoringPreviewRejected(w, req.ModuleID, snapshot.Revision, parameterDefinitionContractIssues(issues))
		return
	}
	definitionHash, err := domain.FurnitureParameterDefinitionHash(draftParameters)
	if err != nil {
		respondWithInternalError(w, err, "hash preview draft")
		return
	}

	previewDefinition := published
	previewDefinition.Parameters = draftParameters
	dims, normalizedParameters, issues, err := authoringParametersFromDefinition(req.Parameters, module, previewDefinition)
	if err != nil {
		respondWithInternalError(w, err, "evaluate preview parameters")
		return
	}
	if len(issues) > 0 {
		s.writeAuthoringPreviewRejected(w, req.ModuleID, snapshot.Revision, issues)
		return
	}
	if choiceIssues := validateMaterialChoices(req.MaterialChoices, snapshot.Composition); len(choiceIssues) > 0 {
		s.writeAuthoringPreviewRejected(w, req.ModuleID, snapshot.Revision, choiceIssues)
		return
	}

	// The engine validates the draft's consumers against the module's real
	// composition (bindings must resolve to exactly one unambiguous target).
	draftModule := *module
	draftModule.ParameterDefinitions = req.ParameterDefinitions
	result, err := engine.ResolveAuthoringLayout(engine.AuthoringResolveInput{
		Module:              draftModule,
		Catalog:             snapshot.Composition,
		Dims:                dims,
		OptionChoices:       req.MaterialChoices,
		EvaluatedParameters: normalizedParameters,
	})
	if err != nil {
		var definitionsErr *domain.FurnitureParameterDefinitionsError
		if errors.As(err, &definitionsErr) {
			s.writeAuthoringPreviewRejected(w, req.ModuleID, snapshot.Revision, parameterDefinitionContractIssues(definitionsErr.Issues))
			return
		}
		s.writeAuthoringPreviewRejected(w, req.ModuleID, snapshot.Revision, []domain.ContractIssue{{
			Code: "RESOLVE_GEOMETRY_INVALID", Message: err.Error(),
			Severity: domain.IssueSeverityError, Path: "parameterDefinitions",
			Remediation: "Adjust the draft definitions or sample values so the definition resolves.",
		}})
		return
	}
	if len(result.StructuralIssues) > 0 {
		s.writeAuthoringPreviewRejected(w, req.ModuleID, snapshot.Revision, result.StructuralIssues)
		return
	}

	s.writeAuthoringPreviewAccepted(w, req, snapshot.Revision, definitionHash, draftParameters, result)
}

type authoringPreviewRequest struct {
	ModuleID             string                                `json:"moduleId"`
	ParameterDefinitions []domain.FurnitureParameterDefinition `json:"parameterDefinitions"`
	Parameters           map[string]any                        `json:"parameters,omitempty"`
	MaterialChoices      map[string]string                     `json:"materialChoices,omitempty"`
}

type authoringPreviewResponse struct {
	ModuleID             string                                `json:"moduleId"`
	CatalogRevision      string                                `json:"catalogRevision"`
	Status               string                                `json:"status"`
	DefinitionHash       string                                `json:"definitionHash,omitempty"`
	DefinitionParameters []domain.FurnitureParameterDefinition `json:"definitionParameters,omitempty"`
	Resolved             *authoringResolveResolved             `json:"resolved,omitempty"`
	Issues               []domain.ContractIssue                `json:"issues"`
}

// parameterDefinitionContractIssues converts definition-boundary issues into
// the structured ContractIssue vocabulary the authoring family speaks.
func parameterDefinitionContractIssues(issues []domain.FurnitureParameterDefinitionIssue) []domain.ContractIssue {
	converted := make([]domain.ContractIssue, 0, len(issues))
	for _, issue := range issues {
		converted = append(converted, domain.ContractIssue{
			Code: "PARAMETER_DEFINITION_INVALID", Message: issue.Message,
			Severity: domain.IssueSeverityError, Path: "parameterDefinitions." + issue.Field,
			Remediation: "Correct the draft definition before saving it.",
			Details:     map[string]any{"parameter": issue.Parameter},
		})
	}
	return converted
}

func (s *Server) writeAuthoringPreviewRejected(w http.ResponseWriter, moduleID, revision string, issues []domain.ContractIssue) {
	if issues == nil {
		issues = []domain.ContractIssue{}
	}
	s.writeAuthoringPreviewEnvelope(w, http.StatusUnprocessableEntity, authoringPreviewResponse{
		ModuleID: moduleID, CatalogRevision: revision,
		Status: authoringStatusRejected, Issues: issues,
	})
}

func (s *Server) writeAuthoringPreviewAccepted(w http.ResponseWriter, req authoringPreviewRequest, revision, definitionHash string, draftParameters []domain.FurnitureParameterDefinition, result *engine.AuthoringResolveResult) {
	validationIssues := result.ValidationIssues
	if validationIssues == nil {
		validationIssues = []domain.ContractIssue{}
	}
	s.writeAuthoringPreviewEnvelope(w, http.StatusOK, authoringPreviewResponse{
		ModuleID:             req.ModuleID,
		CatalogRevision:      revision,
		Status:               authoringStatusAccepted,
		DefinitionHash:       definitionHash,
		DefinitionParameters: draftParameters,
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
	})
}

func (s *Server) writeAuthoringPreviewEnvelope(w http.ResponseWriter, httpStatus int, response authoringPreviewResponse) {
	body, err := json.Marshal(response)
	if err != nil {
		respondWithInternalError(w, err, "marshal authoring preview envelope")
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(httpStatus)
	_, _ = w.Write(body)
}
