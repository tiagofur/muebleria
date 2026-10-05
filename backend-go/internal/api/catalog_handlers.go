package api

import (
	"errors"
	"net/http"
	"strings"

	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// Contrato: CRUD de clientes y catálogo comercial — tableros, ambientales,
// edges/cintillas, herrajes y option groups. Consumidos por routes_catalog.go.
// --- CUSTOMERS ---

func (s *Server) HandleCustomers(w http.ResponseWriter, r *http.Request) {
	claims := claimsFromRequest(r)
	roles := actorRoles(claims)
	id := actorID(claims)

	switch r.Method {
	case http.MethodGet:
		if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanAccessCustomers), "no tenés permiso para ver clientes") {
			return
		}
		list, err := s.Store.ListCustomers(r.Context())
		if err != nil {
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, filterCustomersByOwner(list, id, roles))

	case http.MethodPost:
		if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanMutateCustomers), "no tenés permiso para crear clientes") {
			return
		}
		var c domain.Customer
		if !decodeJSONBody(w, r, &c) {
			return
		}
		c.Active = true
		c.OwnerUserID = domain.ResolveOwnerOnCreateRoles(id, roles, c.OwnerUserID)
		err := s.Store.CreateCustomer(r.Context(), &c)
		if err != nil {
			if isDuplicateKey(err) {
				respondWithError(w, http.StatusConflict, "El registro ya existe")
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusCreated, c)

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) HandleCustomerByID(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		respondWithError(w, http.StatusBadRequest, "missing customer id")
		return
	}
	claims := claimsFromRequest(r)
	roles := actorRoles(claims)
	uid := actorID(claims)

	if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanAccessCustomers), "no tenés permiso para ver clientes") {
		return
	}

	switch r.Method {
	case http.MethodGet:
		c, err := s.Store.GetCustomerByID(r.Context(), id)
		if err != nil {
			respondWithError(w, http.StatusNotFound, "customer not found")
			return
		}
		if !domain.CanAccessOwnedResourceRoles(uid, roles, c.OwnerUserID) {
			respondWithError(w, http.StatusNotFound, "customer not found")
			return
		}
		w.Header().Set("ETag", FormatVersionETag(c.Version))
		respondWithJSON(w, http.StatusOK, c)

	case http.MethodPut:
		if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanMutateCustomers), "no tenés permiso para editar clientes") {
			return
		}
		existing, err := s.Store.GetCustomerByID(r.Context(), id)
		if err != nil {
			respondWithError(w, http.StatusNotFound, "customer not found")
			return
		}
		if !domain.CanAccessOwnedResourceRoles(uid, roles, existing.OwnerUserID) {
			respondWithError(w, http.StatusNotFound, "customer not found")
			return
		}
		expectedVersion, ok := RequireIfMatch(w, r)
		if !ok {
			return
		}
		var c domain.Customer
		if !decodeJSONBody(w, r, &c) {
			return
		}
		c.OwnerUserID = domain.ResolveOwnerOnUpdateRoles(roles, existing.OwnerUserID, c.OwnerUserID)
		err = s.Store.UpdateCustomer(r.Context(), id, expectedVersion, &c)
		if err != nil {
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, err.Error())
				return
			}
			if errors.Is(err, storage.ErrVersionConflict) {
				respondWithAPIError(w, http.StatusPreconditionFailed, openapi.ApiErrorCodeVersionConflict, "la versión cambió; recargá y reintentá", nil)
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		w.Header().Set("ETag", FormatVersionETag(c.Version))
		respondWithJSON(w, http.StatusOK, c)

	case http.MethodDelete:
		if !requirePermission(w, domain.AnyRole(roles, domain.RoleCanMutateCustomers), "no tenés permiso para eliminar clientes") {
			return
		}
		expectedVersion, ok := RequireIfMatch(w, r)
		if !ok {
			return
		}
		existing, err := s.Store.GetCustomerByID(r.Context(), id)
		if err != nil {
			respondWithError(w, http.StatusNotFound, "customer not found")
			return
		}
		if !domain.CanAccessOwnedResourceRoles(uid, roles, existing.OwnerUserID) {
			respondWithError(w, http.StatusNotFound, "customer not found")
			return
		}
		err = s.Store.DeactivateCustomer(r.Context(), id, expectedVersion)
		if err != nil {
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, err.Error())
				return
			}
			if errors.Is(err, storage.ErrVersionConflict) {
				respondWithAPIError(w, http.StatusPreconditionFailed, openapi.ApiErrorCodeVersionConflict, "la versión cambió; recargá y reintentá", nil)
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, map[string]string{"message": "customer deactivated"})

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// --- CATALOG / MATERIALS ---

func (s *Server) HandleMaterials(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		list, err := s.Store.ListMaterialBoards(r.Context())
		if err != nil {
			respondWithInternalError(w, err, "handler")
			return
		}
		if !s.actorCanViewCosts(r) {
			domain.RedactMaterialsList(list)
		}
		respondWithJSON(w, http.StatusOK, list)

	case http.MethodPost:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tenés permiso para modificar el catálogo") {
			return
		}
		var m domain.MaterialBoard
		if !decodeJSONBody(w, r, &m) {
			return
		}
		if strings.TrimSpace(m.Manufacturer) == "" {
			respondWithError(w, http.StatusBadRequest, "El fabricante del tablero es obligatorio")
			return
		}
		m.Active = true
		err := s.Store.CreateMaterialBoard(r.Context(), &m)
		if err != nil {
			if isDuplicateKey(err) {
				respondWithError(w, http.StatusConflict, "El código ingresado ya está registrado")
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusCreated, m)

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) HandleMaterialByID(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		respondWithError(w, http.StatusBadRequest, "missing material id")
		return
	}

	switch r.Method {
	case http.MethodGet:
		m, err := s.Store.GetMaterialBoardByID(r.Context(), id)
		if err != nil {
			respondWithError(w, http.StatusNotFound, "material board not found")
			return
		}
		if !s.actorCanViewCosts(r) {
			domain.RedactMaterialCosts(m)
		}
		w.Header().Set("ETag", FormatVersionETag(m.Version))
		respondWithJSON(w, http.StatusOK, m)

	case http.MethodPut:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tenés permiso para modificar el catálogo") {
			return
		}
		expectedVersion, ok := RequireIfMatch(w, r)
		if !ok {
			return
		}
		var m domain.MaterialBoard
		if !decodeJSONBody(w, r, &m) {
			return
		}
		// Snapshot current media URLs so we can clean up replaced files after a
		// successful commit. Reading first keeps cleanup off the failure path.
		prevImage, prevTexture := "", ""
		if cur, err := s.Store.GetMaterialBoardByID(r.Context(), id); err == nil && cur != nil {
			prevImage = cur.ImageURL
			prevTexture = cur.PreviewTextureURL
			if strings.TrimSpace(m.Manufacturer) == "" {
				// Syncs de catálogos legacy (pre-fabricante obligatorio) llegan sin
				// fabricante: conservar el existente en vez de romper la sincronización.
				m.Manufacturer = cur.Manufacturer
			}
		}
		err := s.Store.UpdateMaterialBoard(r.Context(), id, expectedVersion, &m)
		if err != nil {
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, err.Error())
				return
			}
			if errors.Is(err, storage.ErrVersionConflict) {
				respondWithAPIError(w, http.StatusPreconditionFailed, openapi.ApiErrorCodeVersionConflict, "la versión cambió; recargá y reintentá", nil)
				return
			}
			// F116 A1: renaming to an existing code must surface as 409, not 500
			// (edges and hardware already map this).
			if isDuplicateKey(err) {
				respondWithError(w, http.StatusConflict, "El código ingresado ya está registrado")
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		if prevImage != m.ImageURL {
			deleteMediaFileByURL(r.Context(), s.MediaDir, prevImage)
		}
		if prevTexture != m.PreviewTextureURL {
			deleteMediaFileByURL(r.Context(), s.MediaDir, prevTexture)
		}
		w.Header().Set("ETag", FormatVersionETag(m.Version))
		respondWithJSON(w, http.StatusOK, m)

	case http.MethodDelete:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tenés permiso para modificar el catálogo") {
			return
		}
		expectedVersion, ok := RequireIfMatch(w, r)
		if !ok {
			return
		}
		err := s.Store.DeactivateMaterialBoard(r.Context(), id, expectedVersion)
		if err != nil {
			// F179: a missing or cross-org board must surface as 404 (the
			// scoped UPDATE affects no rows), never as a 500.
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, err.Error())
				return
			}
			if errors.Is(err, storage.ErrVersionConflict) {
				respondWithAPIError(w, http.StatusPreconditionFailed, openapi.ApiErrorCodeVersionConflict, "la versión cambió; recargá y reintentá", nil)
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, map[string]string{"message": "material board deactivated"})

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// --- EDGE BANDS ---

func (s *Server) HandleEdgeBands(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		list, err := s.Store.ListEdgeBands(r.Context())
		if err != nil {
			respondWithInternalError(w, err, "handler")
			return
		}
		if !s.actorCanViewCosts(r) {
			domain.RedactEdgesList(list)
		}
		respondWithJSON(w, http.StatusOK, list)

	case http.MethodPost:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tenés permiso para modificar el catálogo") {
			return
		}
		var e domain.EdgeBand
		if !decodeJSONBody(w, r, &e) {
			return
		}
		e.Active = true
		err := s.Store.CreateEdgeBand(r.Context(), &e)
		if err != nil {
			if isDuplicateKey(err) {
				respondWithError(w, http.StatusConflict, "El código ingresado ya está registrado")
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusCreated, e)

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) HandleEdgeBandByID(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		respondWithError(w, http.StatusBadRequest, "missing id")
		return
	}

	switch r.Method {
	case http.MethodGet:
		e, err := s.Store.GetEdgeBandByID(r.Context(), id)
		if err != nil {
			respondWithError(w, http.StatusNotFound, "edge band not found")
			return
		}
		if !s.actorCanViewCosts(r) {
			domain.RedactEdgeCosts(e)
		}
		w.Header().Set("ETag", FormatVersionETag(e.Version))
		respondWithJSON(w, http.StatusOK, e)

	case http.MethodPut:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tenés permiso para modificar el catálogo") {
			return
		}
		expectedVersion, ok := RequireIfMatch(w, r)
		if !ok {
			return
		}
		var e domain.EdgeBand
		if !decodeJSONBody(w, r, &e) {
			return
		}
		err := s.Store.UpdateEdgeBand(r.Context(), id, expectedVersion, &e)
		if err != nil {
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, err.Error())
				return
			}
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, err.Error())
				return
			}
			if errors.Is(err, storage.ErrVersionConflict) {
				respondWithAPIError(w, http.StatusPreconditionFailed, openapi.ApiErrorCodeVersionConflict, "la versión cambió; recargá y reintentá", nil)
				return
			}
			if isDuplicateKey(err) {
				respondWithError(w, http.StatusConflict, "El código ingresado ya está registrado")
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		w.Header().Set("ETag", FormatVersionETag(e.Version))
		respondWithJSON(w, http.StatusOK, e)

	case http.MethodDelete:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tenés permiso para modificar el catálogo") {
			return
		}
		expectedVersion, ok := RequireIfMatch(w, r)
		if !ok {
			return
		}
		err := s.Store.DeactivateEdgeBand(r.Context(), id, expectedVersion)
		if err != nil {
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, err.Error())
				return
			}
			if errors.Is(err, storage.ErrVersionConflict) {
				respondWithAPIError(w, http.StatusPreconditionFailed, openapi.ApiErrorCodeVersionConflict, "la versión cambió; recargá y reintentá", nil)
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, map[string]string{"message": "edge band deactivated"})

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// --- HARDWARES ---

func (s *Server) HandleHardwares(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		list, err := s.Store.ListHardwares(r.Context())
		if err != nil {
			respondWithInternalError(w, err, "handler")
			return
		}
		if !s.actorCanViewCosts(r) {
			domain.RedactHardwareList(list)
		}
		respondWithJSON(w, http.StatusOK, list)

	case http.MethodPost:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tenés permiso para modificar el catálogo") {
			return
		}
		var h domain.Hardware
		if !decodeJSONBody(w, r, &h) {
			return
		}
		// #667 M1: the visual asset binding is resolved and validated before
		// persistence; the payload's echoed facts are replaced server-side.
		if !s.resolveHardwareVisualBindingForWrite(r, w, &h) {
			return
		}
		h.Active = true
		err := s.Store.CreateHardware(r.Context(), &h)
		if err != nil {
			if isDuplicateKey(err) {
				respondWithError(w, http.StatusConflict, "El código ingresado ya está registrado")
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusCreated, h)

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) HandleHardwareByID(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		respondWithError(w, http.StatusBadRequest, "missing id")
		return
	}

	switch r.Method {
	case http.MethodGet:
		h, err := s.Store.GetHardwareByID(r.Context(), id)
		if err != nil {
			respondWithError(w, http.StatusNotFound, "hardware not found")
			return
		}
		if !s.actorCanViewCosts(r) {
			domain.RedactHardwareCosts(h)
		}
		// #1084 (#443 slice 1): the strong version ETag is the If-Match token
		// writers must echo back on PUT/DELETE.
		w.Header().Set("ETag", FormatVersionETag(h.Version))
		respondWithJSON(w, http.StatusOK, h)

	case http.MethodPut:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tenés permiso para modificar el catálogo") {
			return
		}
		expectedVersion, ok := RequireIfMatch(w, r)
		if !ok {
			return
		}
		var h domain.Hardware
		if !decodeJSONBody(w, r, &h) {
			return
		}
		// Snapshot current media URL so we can clean up the replaced file after
		// a successful commit.
		prevImage := ""
		cur, err := s.Store.GetHardwareByID(r.Context(), id)
		if err == nil && cur != nil {
			prevImage = cur.ImageURL
		}
		// #667 M1: the visual asset binding is resolved and validated before
		// persistence; the payload's echoed facts are replaced server-side.
		// A failed validation leaves the previous association untouched.
		// If the binding is identical to the currently persisted binding on this
		// hardware, it is preserved as-is (retiring an asset only prevents NEW
		// selections, not keeping existing bindings).
		if cur != nil && cur.VisualAsset != nil && h.VisualAsset != nil &&
			cur.VisualAsset.AssetID == h.VisualAsset.AssetID &&
			cur.VisualAsset.AssetRevisionID == h.VisualAsset.AssetRevisionID {
			h.VisualAsset = cur.VisualAsset
		} else if !s.resolveHardwareVisualBindingForWrite(r, w, &h) {
			return
		}
		err = s.Store.UpdateHardware(r.Context(), id, expectedVersion, &h)
		if err != nil {
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, err.Error())
				return
			}
			if errors.Is(err, storage.ErrVersionConflict) {
				respondWithAPIError(w, http.StatusPreconditionFailed, openapi.ApiErrorCodeVersionConflict, "la versión del herraje cambió; recargá y reintentá", nil)
				return
			}
			if isDuplicateKey(err) {
				respondWithError(w, http.StatusConflict, "El código ingresado ya está registrado")
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		if prevImage != h.ImageURL {
			deleteMediaFileByURL(r.Context(), s.MediaDir, prevImage)
		}
		w.Header().Set("ETag", FormatVersionETag(h.Version))
		respondWithJSON(w, http.StatusOK, h)

	case http.MethodDelete:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tenés permiso para modificar el catálogo") {
			return
		}
		expectedVersion, ok := RequireIfMatch(w, r)
		if !ok {
			return
		}
		err := s.Store.DeactivateHardware(r.Context(), id, expectedVersion)
		if err != nil {
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, err.Error())
				return
			}
			if errors.Is(err, storage.ErrVersionConflict) {
				respondWithAPIError(w, http.StatusPreconditionFailed, openapi.ApiErrorCodeVersionConflict, "la versión del herraje cambió; recargá y reintentá", nil)
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, map[string]string{"message": "hardware deactivated"})

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// --- OPTION GROUPS ---

func (s *Server) HandleOptionGroups(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		list, err := s.Store.ListOptionGroups(r.Context())
		if err != nil {
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, list)

	case http.MethodPost:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tenés permiso para modificar el catálogo") {
			return
		}
		var og domain.OptionGroup
		if !decodeJSONBody(w, r, &og) {
			return
		}
		err := s.Store.CreateOptionGroup(r.Context(), &og)
		if err != nil {
			if isDuplicateKey(err) {
				respondWithError(w, http.StatusConflict, "El código ingresado ya está registrado")
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusCreated, og)

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) HandleOptionGroupByID(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if id == "" {
		respondWithError(w, http.StatusBadRequest, "missing id")
		return
	}

	switch r.Method {
	case http.MethodGet:
		og, err := s.Store.GetOptionGroupByID(r.Context(), id)
		if err != nil {
			respondWithError(w, http.StatusNotFound, "option group not found")
			return
		}
		w.Header().Set("ETag", FormatVersionETag(og.Version))
		respondWithJSON(w, http.StatusOK, og)

	case http.MethodPut:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tenés permiso para modificar el catálogo") {
			return
		}
		expectedVersion, ok := RequireIfMatch(w, r)
		if !ok {
			return
		}
		var og domain.OptionGroup
		if !decodeJSONBody(w, r, &og) {
			return
		}
		err := s.Store.UpdateOptionGroup(r.Context(), id, expectedVersion, &og)
		if err != nil {
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, err.Error())
				return
			}
			if errors.Is(err, storage.ErrVersionConflict) {
				respondWithAPIError(w, http.StatusPreconditionFailed, openapi.ApiErrorCodeVersionConflict, "la versión cambió; recargá y reintentá", nil)
				return
			}
			if isDuplicateKey(err) {
				respondWithError(w, http.StatusConflict, "El código ingresado ya está registrado")
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, og)

	case http.MethodDelete:
		if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tenés permiso para modificar el catálogo") {
			return
		}
		expectedVersion, ok := RequireIfMatch(w, r)
		if !ok {
			return
		}
		err := s.Store.DeleteOptionGroup(r.Context(), id, expectedVersion)
		if err != nil {
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, err.Error())
				return
			}
			if errors.Is(err, storage.ErrVersionConflict) {
				respondWithAPIError(w, http.StatusPreconditionFailed, openapi.ApiErrorCodeVersionConflict, "la versión cambió; recargá y reintentá", nil)
				return
			}
			respondWithInternalError(w, err, "handler")
			return
		}
		respondWithJSON(w, http.StatusOK, map[string]string{"message": "option group deleted"})

	default:
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}
