package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sort"
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

// validateHardwareKitLink (#1422 slice 1): the referenced kit must exist in
// the same organization, never be self, and never itself be a part of
// another kit (a kit is never a part).
func (s *Server) validateHardwareKitLink(ctx context.Context, h *domain.Hardware, effectiveID string) error {
	kitID := strings.TrimSpace(*h.KitHardwareID)
	if kitID == "" {
		// trimmed-empty del wire → sin link (evita 500 del cast a UUID).
		h.KitHardwareID = nil
		return nil
	}
	// El id EFECTIVO es el del path en PUT (el body puede omitirlo) —
	// sin esto, un PUT self-link con body sin id saltearía el check (#1423 B1).
	if kitID == effectiveID || kitID == h.ID {
		return fmt.Errorf("un herraje no puede ser parte de sí mismo")
	}
	kit, err := s.Store.GetHardwareByID(ctx, kitID)
	if err != nil || kit == nil {
		return fmt.Errorf("el kit del herraje no existe en este taller")
	}
	if kit.KitHardwareID != nil && *kit.KitHardwareID != "" {
		return fmt.Errorf("«%s» ya es parte de otro juego: un juego no puede ser parte de otro", kit.Code)
	}
	return nil
}

// kitPartHardwareCodes returns the codes of the given hardware ids that are
// design parts of a kit (kit_hardware_id set). #1436: a part is never
// purchasable on its own — the whole kit travels — so it can neither be an
// option-group member nor a fixed module hardware line.
func (s *Server) kitPartHardwareCodes(ctx context.Context, ids map[string]bool) ([]string, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	list, err := s.Store.ListHardwares(ctx)
	if err != nil {
		return nil, err
	}
	var codes []string
	for i := range list {
		h := &list[i]
		if ids[h.ID] && h.KitHardwareID != nil && *h.KitHardwareID != "" {
			codes = append(codes, h.Code)
		}
	}
	sort.Strings(codes)
	return codes, nil
}

// respondKitPartGuard writes the typed 422 shared by the option-group and
// module hardware-line guards (#1436, owner decision 10-31: fail-closed).
func respondKitPartGuard(w http.ResponseWriter, code string, codes []string) {
	respondWithJSON(w, http.StatusUnprocessableEntity, map[string]any{
		"code":    code,
		"message": fmt.Sprintf("las partes de diseño de un juego no se compran por sí solas (el juego completo viaja junto): %s", strings.Join(codes, ", ")),
	})
}

// validateOptionGroupKitParts rejects hardware option groups whose members
// include kit design parts (#1436).
func (s *Server) validateOptionGroupKitParts(w http.ResponseWriter, r *http.Request, og *domain.OptionGroup) bool {
	if og.Kind != "hardware" || len(og.OptionIDs) == 0 {
		return true
	}
	ids := make(map[string]bool, len(og.OptionIDs))
	for _, id := range og.OptionIDs {
		ids[id] = true
	}
	codes, err := s.kitPartHardwareCodes(r.Context(), ids)
	if err != nil {
		respondWithInternalError(w, err, "handler")
		return false
	}
	if len(codes) > 0 {
		respondKitPartGuard(w, "OPTION_GROUP_KIT_PART", codes)
		return false
	}
	return true
}

// moduleFixedHardwareIDs collects the hardware ids of fixed module hardware
// lines (optionRole-resolved lines carry no id and resolve through guarded
// groups instead).
func moduleFixedHardwareIDs(m *domain.Module) map[string]bool {
	ids := map[string]bool{}
	for _, line := range m.HardwareLines {
		if line.HardwareID != "" {
			ids[line.HardwareID] = true
		}
	}
	return ids
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
		if err := domain.ValidateHardwareDesignParts(h.DesignParts); err != nil {
			respondWithJSON(w, http.StatusUnprocessableEntity, map[string]any{
				"code":    "HARDWARE_DESIGN_PARTS_INVALID",
				"message": err.Error(),
			})
			return
		}
		if h.KitHardwareID != nil && *h.KitHardwareID != "" {
			if err := s.validateHardwareKitLink(r.Context(), &h, h.ID); err != nil {
				respondWithJSON(w, http.StatusUnprocessableEntity, map[string]any{
					"code":    "HARDWARE_KIT_INVALID",
					"message": err.Error(),
				})
				return
			}
		}
		if err := domain.ValidateHardwareFinishIDs(h.AvailableFinishes); err != nil {
			respondWithError(w, http.StatusBadRequest, err.Error())
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
		present, ok := decodeJSONBodyKeys(w, r, &h)
		if !ok {
			return
		}
		if err := domain.ValidateHardwareDesignParts(h.DesignParts); err != nil {
			respondWithJSON(w, http.StatusUnprocessableEntity, map[string]any{
				"code":    "HARDWARE_DESIGN_PARTS_INVALID",
				"message": err.Error(),
			})
			return
		}
		// cur doubles as the kit-unlink guard snapshot and the media-cleanup
		// snapshot for the replaced file.
		cur, curErr := s.Store.GetHardwareByID(r.Context(), id)
		if curErr != nil || cur == nil {
			// Nonexistent id: keep flowing so UpdateHardware produces the
			// canonical 404 below.
			cur = nil
		}
		// #1436: fail-closed silent unlink. A PUT that OMITS kit_hardware_id
		// must not clear an existing link (a partial GET→PUT client lost the
		// wizard's link this way in the 10-31 session). Echo the id to keep
		// the link; an explicit null is the deliberate unlink.
		if cur != nil && cur.KitHardwareID != nil && *cur.KitHardwareID != "" && !present["kit_hardware_id"] {
			respondWithJSON(w, http.StatusUnprocessableEntity, map[string]any{
				"code":    "HARDWARE_KIT_LINK_REQUIRED",
				"message": fmt.Sprintf("«%s» es parte de un juego de herrajes: reenviá kit_hardware_id (el mismo id para conservar el vínculo, null explícito para desvincularlo)", cur.Code),
			})
			return
		}
		if h.KitHardwareID != nil && *h.KitHardwareID != "" {
			if err := s.validateHardwareKitLink(r.Context(), &h, id); err != nil {
				respondWithJSON(w, http.StatusUnprocessableEntity, map[string]any{
					"code":    "HARDWARE_KIT_INVALID",
					"message": err.Error(),
				})
				return
			}
		}
		if err := domain.ValidateHardwareFinishIDs(h.AvailableFinishes); err != nil {
			respondWithError(w, http.StatusBadRequest, err.Error())
			return
		}
		// Snapshot current media URL so we can clean up the replaced file after
		// a successful commit.
		prevImage := ""
		if cur != nil {
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
		err := s.Store.UpdateHardware(r.Context(), id, expectedVersion, &h)
		if err != nil {
			if strings.Contains(err.Error(), "not found") {
				respondWithError(w, http.StatusNotFound, err.Error())
				return
			}
			if errors.Is(err, storage.ErrVersionConflict) {
				respondWithAPIError(w, http.StatusPreconditionFailed, openapi.ApiErrorCodeVersionConflict, "la versión del herraje cambió; recargá y reintentá", nil)
				return
			}
			if errors.Is(err, storage.ErrHardwareInUse) {
				// #1215: an in-use hardware cannot be deactivated (the PUT
				// carries the active flag); 409 with the reference counts.
				respondWithError(w, http.StatusConflict, err.Error())
				return
			}
			if errors.Is(err, storage.ErrHardwareKitHasParts) {
				// #1422 perfección (review B1): same 409 on the PUT path —
				// the ONLY deactivation path the product actually uses.
				respondWithError(w, http.StatusConflict, err.Error())
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
			if errors.Is(err, storage.ErrHardwareInUse) {
				// #1215: refuse to deactivate a referenced hardware with a
				// clear 409 instead of a later opaque calculate failure.
				respondWithError(w, http.StatusConflict, err.Error())
				return
			}
			if errors.Is(err, storage.ErrHardwareKitHasParts) {
				// #1422 slice 1 review: a kit with linked parts must not be
				// deactivated — the parts' kit link would dangle.
				respondWithError(w, http.StatusConflict, err.Error())
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
		// #1436: a kit design part is never individually purchasable — it
		// cannot become an option (the owner decision from the 10-31 session).
		if !s.validateOptionGroupKitParts(w, r, &og) {
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
		// #1436: same fail-closed guard on replace — a payload keeping a kit
		// part as member is rejected so existing rows must be cleaned up.
		if !s.validateOptionGroupKitParts(w, r, &og) {
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
