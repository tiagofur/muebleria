package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/tiagofur/muebles-backend/internal/auth"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/domain/engine"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// HandleFurnitureDefinitionLayout: GET /api/furniture/definitions/{definitionId}/layout
//
// Resolves one workshop furniture definition (a module row — the same entity
// the React app edits) into its COMPLETE visual composition at concrete
// dimensions: every board component of the structure/module/agregados plus the
// visible hardware placements (handles with preview geometry, hinges, …).
// All geometry is resolved server-side (formulas, poses, AABBs); clients like
// the SketchUp extension only transform pre-baked boxes — they never compute
// composition (progress/current.md invariant).
//
// Query parameters widthMm/heightMm/depthMm override the module's own
// dimensions (the SketchUp dialog edits them freely); each is optional and
// must be > 0 when present. Auth + active workshop (organization) license
// gate exactly like GET /api/furniture/definitions.
func (s *Server) HandleFurnitureDefinitionLayout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
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

	// The license belongs to the workshop (organization), not the user: load
	// the scoped organization and gate on its plan/expiry (ADR-0004), exactly
	// like GET /api/furniture/definitions.
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

	definitionID := r.PathValue("definitionId")
	module, err := s.Store.GetModuleByID(r.Context(), definitionID)
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "error interno del servidor")
		return
	}
	if module == nil {
		respondWithError(w, http.StatusNotFound, "definición no encontrada")
		return
	}

	dims, err := layoutDimsFromQuery(r, module)
	if err != nil {
		respondWithError(w, http.StatusBadRequest, err.Error())
		return
	}
	// Board choices ride in the query string (choice.ROLE=<materialId>)
	// because extension tokens are strictly read-only (GET + refresh).
	choices := layoutChoicesFromQuery(r)

	structures, err := s.Store.ListStructures(r.Context())
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "error interno del servidor")
		return
	}
	components, err := s.Store.ListComponents(r.Context())
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "error interno del servidor")
		return
	}
	agregados, err := s.Store.ListAgregados(r.Context())
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "error interno del servidor")
		return
	}
	hardware, err := s.Store.ListHardwares(r.Context())
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "error interno del servidor")
		return
	}
	materials, err := s.Store.ListMaterialBoards(r.Context())
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "error interno del servidor")
		return
	}

	catalog := domain.Catalog{
		Structures: structures,
		Components: components,
		Agregados:  agregados,
		Hardware:   hardware,
		Materials:  materials,
	}

	layout, err := engine.ResolveFurnitureLayout(*module, catalog, dims, choices)
	if err != nil {
		respondWithError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}

	body, err := json.Marshal(layout)
	if err != nil {
		respondWithError(w, http.StatusInternalServerError, "error interno del servidor")
		return
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}

// layoutDimsFromQuery parses the optional widthMm/heightMm/depthMm overrides.
// Unspecified axes inherit the module's own external dimensions; it returns
// nil when no override is present at all.
func layoutDimsFromQuery(r *http.Request, module *domain.Module) (*engine.LayoutDims, error) {
	parse := func(name string) (int, bool, error) {
		raw := r.URL.Query().Get(name)
		if raw == "" {
			return 0, false, nil
		}
		v, err := strconv.Atoi(raw)
		if err != nil || v <= 0 {
			return 0, true, errInvalidDim(name)
		}
		return v, true, nil
	}

	width, hasW, err := parse("widthMm")
	if err != nil {
		return nil, err
	}
	height, hasH, err := parse("heightMm")
	if err != nil {
		return nil, err
	}
	depth, hasD, err := parse("depthMm")
	if err != nil {
		return nil, err
	}
	if !hasW && !hasH && !hasD {
		return nil, nil
	}
	if !hasW {
		width = module.WidthMm
	}
	if !hasH {
		height = module.HeightMm
	}
	if !hasD {
		depth = module.DepthMm
	}
	return &engine.LayoutDims{WidthMm: width, HeightMm: height, DepthMm: depth}, nil
}

type dimError struct{ field string }

func (e dimError) Error() string {
	return "la medida " + e.field + " debe ser un número entero de milímetros mayor a 0"
}

func errInvalidDim(field string) error { return dimError{field: field} }

// layoutChoicesFromQuery collects choice.ROLE=<materialId> params. Roles are
// option group codes (same keys the React app stores as item option_choices).
func layoutChoicesFromQuery(r *http.Request) map[string]string {
	choices := map[string]string{}
	for key, values := range r.URL.Query() {
		if !strings.HasPrefix(key, "choice.") || len(values) == 0 {
			continue
		}
		role := strings.TrimSpace(strings.TrimPrefix(key, "choice."))
		value := strings.TrimSpace(values[0])
		if role != "" && value != "" {
			choices[role] = value
		}
	}
	return choices
}
