package api

// #1625 — POST /api/catalog/hardware-kit-systems/{agregadoId}/heights: añade
// UNA altura a un sistema de cajones existente en una transacción. Lo consume
// el modal «Añadir altura» del catálogo web (store addSystemHeight).

import (
	"errors"
	"fmt"
	"math"
	"strings"
	"net/http"
	"sort"

	"github.com/google/uuid"
	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
	"github.com/tiagofur/muebles-backend/internal/storage"
)

// The auth middleware runs the handler inside the request's tenant
// transaction and COMMITS 4xx responses (only 5xx roll back). So every check
// that answers 4xx runs before the first write, and the writes are ordered so
// the only one that can lose a race — the If-Match update of the ensamble —
// goes first: a 412 there commits nothing. The hardware inserts run after,
// under advisory locks on their codes (probed free), and any failure there is
// a 5xx that rolls the whole height back.
func (s *Server) HandleHardwareKitSystemHeightAdd(w http.ResponseWriter, r *http.Request) {
	if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tenés permiso para modificar el catálogo") || !s.requireGeometryAuthoringFor(w, r, "agregados") {
		return
	}
	agregadoID := r.PathValue("agregadoId")
	if agregadoID == "" {
		respondWithError(w, http.StatusBadRequest, "missing agregado id")
		return
	}
	expectedVersion, ok := RequireIfMatch(w, r)
	if !ok {
		return
	}
	var req openapi.HardwareKitSystemHeightAddRequest
	if !decodeJSONBody(w, r, &req) {
		return
	}
	plan, payloadErr := kitSystemHeightPlanFromRequest(&req)
	if payloadErr != nil {
		respondWithJSON(w, http.StatusUnprocessableEntity, payloadErr)
		return
	}

	sortedCodes := append([]string{}, plan.allCodes...)
	sort.Strings(sortedCodes)
	if err := s.Store.LockCatalogCodes(r.Context(), sortedCodes); err != nil {
		respondWithInternalError(w, err, "kit system height code locks")
		return
	}

	hwList, err := s.Store.ListHardwares(r.Context())
	if err != nil {
		respondWithInternalError(w, err, "kit system height hardware probe")
		return
	}
	existingCodes := make(map[string]bool, len(hwList))
	for _, h := range hwList {
		existingCodes[h.Code] = true
	}
	taken := []string{}
	for _, code := range plan.allCodes {
		if existingCodes[code] {
			taken = append(taken, code)
		}
	}
	if len(taken) > 0 {
		sort.Strings(taken)
		respondWithJSON(w, http.StatusConflict, map[string]any{
			"code":    "HARDWARE_KIT_SYSTEM_CODE_TAKEN",
			"message": fmt.Sprintf("códigos de la altura ya existen en el catálogo: %v", taken),
			"details": map[string]any{"codes": taken},
		})
		return
	}

	agr, err := s.Store.GetAgregadoByIDWithRecipe(r.Context(), agregadoID)
	if err != nil || agr == nil {
		if agr == nil && (err == nil || errors.Is(err, storage.ErrAgregadoNotFound)) {
			respondWithError(w, http.StatusNotFound, "agregado not found")
			return
		}
		respondWithInternalError(w, err, "kit system height agregado get")
		return
	}
	if agr.Version != expectedVersion {
		respondWithAPIError(w, http.StatusPreconditionFailed, openapi.ApiErrorCodeVersionConflict, "la versión del ensamble cambió; recargá y reintentá", nil)
		return
	}

	next, variantSetID, heightErr := addHeightVariant(*agr, plan.variant)
	if heightErr != nil {
		respondWithJSON(w, http.StatusUnprocessableEntity, heightErr)
		return
	}
	if err := domain.ValidateAgregadoAssemblyDefinition(next); err != nil {
		respondWithJSON(w, http.StatusUnprocessableEntity, invalidPayload(
			fmt.Sprintf("la receta del ensamble con la altura nueva es inválida: %v", err), nil))
		return
	}

	// Review #1626: the selector and a new eligibility group have codes too —
	// a taken one is a typed 409 decided BEFORE any write, never a 5xx from
	// the insert.
	groups, err := s.Store.ListOptionGroups(r.Context())
	if err != nil {
		respondWithInternalError(w, err, "kit system height option group probe")
		return
	}
	existingGroupCodes := make(map[string]bool, len(groups))
	for _, g := range groups {
		existingGroupCodes[g.Code] = true
	}
	takenGroups := []string{}
	if plan.optionGroup != nil && existingGroupCodes[plan.optionGroup.Code] {
		takenGroups = append(takenGroups, plan.optionGroup.Code)
	}
	if plan.eligibility != nil && plan.eligibility.newGroup != nil && existingGroupCodes[plan.eligibility.newGroup.Code] {
		takenGroups = append(takenGroups, plan.eligibility.newGroup.Code)
	}
	if plan.optionGroup != nil && plan.eligibility != nil && plan.eligibility.newGroup != nil &&
		plan.optionGroup.Code == plan.eligibility.newGroup.Code {
		respondWithJSON(w, http.StatusUnprocessableEntity, invalidPayload("el selector de insertos y el grupo de elegibilidad no pueden compartir código", nil))
		return
	}
	if len(takenGroups) > 0 {
		respondWithJSON(w, http.StatusConflict, map[string]any{
			"code":    "HARDWARE_KIT_SYSTEM_CODE_TAKEN",
			"message": fmt.Sprintf("códigos de grupo ya existen en el catálogo: %v", takenGroups),
			"details": map[string]any{"codes": takenGroups},
		})
		return
	}

	if plan.eligibility != nil && plan.eligibility.existingGroupID != "" {
		for i := range groups {
			if groups[i].ID == plan.eligibility.existingGroupID {
				plan.eligibility.eligibilityTarget = &groups[i]
				break
			}
		}
		if plan.eligibility.eligibilityTarget == nil {
			respondWithJSON(w, http.StatusUnprocessableEntity, map[string]any{
				"code":    "HARDWARE_KIT_SYSTEM_REFERENCE_MISSING",
				"message": fmt.Sprintf("el grupo de elegibilidad «%s» no existe en la organización", plan.eligibility.existingGroupID),
				"details": map[string]any{"codes": []string{plan.eligibility.existingGroupID}},
			})
			return
		}
		if plan.eligibility.eligibilityTarget.Kind != "agregado" {
			respondWithJSON(w, http.StatusUnprocessableEntity, invalidPayload(
				"el grupo de elegibilidad debe ser kind agregado", map[string]any{"group_id": plan.eligibility.eligibilityTarget.ID}))
			return
		}
	}

	for i := range plan.hardware {
		h := &plan.hardware[i]
		h.Active = true
		if !s.resolveHardwareVisualBindingForWrite(r, w, h) {
			return
		}
	}

	// Writes. First the only race-prone one (version-guarded): a conflict
	// here is a clean 412 with nothing written yet.
	var createdBy *string
	if claims := claimsFromRequest(r); claims != nil && claims.UserID != "" {
		createdBy = &claims.UserID
	}
	if err := s.Store.UpdateAgregadoWithRevision(r.Context(), agregadoID, expectedVersion, &next, createdBy); err != nil {
		if errors.Is(err, storage.ErrVersionConflict) {
			respondWithAPIError(w, http.StatusPreconditionFailed, openapi.ApiErrorCodeVersionConflict, "la versión del ensamble cambió; recargá y reintentá", nil)
			return
		}
		if errors.Is(err, storage.ErrAgregadoNotFound) {
			respondWithError(w, http.StatusNotFound, "agregado not found")
			return
		}
		respondWithInternalError(w, err, "kit system height agregado update")
		return
	}

	// From here on every failure is 5xx: the transaction rolls the ensamble
	// update back with it, never a half height.
	createdCodes := make([]string, 0, len(plan.hardware))
	for i := range plan.hardware {
		h := plan.hardware[i]
		if err := s.Store.CreateHardware(r.Context(), &h); err != nil {
			respondWithInternalError(w, err, "kit system height hardware create")
			return
		}
		createdCodes = append(createdCodes, h.Code)
	}
	if plan.optionGroup != nil {
		if err := s.Store.CreateOptionGroup(r.Context(), plan.optionGroup); err != nil {
			respondWithInternalError(w, err, "kit system height option group create")
			return
		}
	}
	if plan.eligibility != nil {
		if plan.eligibility.existingGroupID != "" {
			target := plan.eligibility.eligibilityTarget
			present := false
			for _, id := range target.OptionIDs {
				if id == agregadoID {
					present = true
					break
				}
			}
			if !present {
				target.OptionIDs = append(target.OptionIDs, agregadoID)
				if err := s.Store.UpdateOptionGroup(r.Context(), target.ID, target.Version, target); err != nil {
					respondWithInternalError(w, err, "kit system height eligibility member add")
					return
				}
			}
		} else {
			g := plan.eligibility.newGroup
			g.OptionIDs = []string{agregadoID}
			if err := s.Store.CreateOptionGroup(r.Context(), g); err != nil {
				respondWithInternalError(w, err, "kit system height eligibility group create")
				return
			}
		}
	}

	respondWithJSON(w, http.StatusCreated, openapi.HardwareKitSystemHeightAdded{
		CreatedCodes:    createdCodes,
		AgregadoID:      agregadoID,
		AgregadoVersion: next.Version,
		VariantSetID:    variantSetID,
		HeightMm:        int64(next.HeightMm),
	})
}

// kitSystemHeightPlan is the validated, domain-typed height plan.
type kitSystemHeightPlan struct {
	hardware    []domain.Hardware
	variant     domain.ProductVariant
	optionGroup *domain.OptionGroup
	eligibility *kitSystemEligibility
	allCodes    []string
}

// kitSystemHeightPlanFromRequest validates the wire plan against its OWN
// references (pure; no DB): exactly one kit row; design rows link to it;
// insert rows (no kit link) only as options of the selector, which links to
// the new kit.
func kitSystemHeightPlanFromRequest(req *openapi.HardwareKitSystemHeightAddRequest) (*kitSystemHeightPlan, map[string]any) {
	if len(req.Hardware) == 0 {
		return nil, invalidPayload("la altura necesita al menos su fila kit", nil)
	}
	kitID := ""
	seenCodes := map[string]bool{}
	allIDs := map[string]bool{}
	for i := range req.Hardware {
		row := &req.Hardware[i]
		if row.ID == "" || row.Code == "" || row.Name == "" {
			return nil, invalidPayload("cada fila de herraje necesita id, code y name", map[string]any{"index": i})
		}
		if row.Unit != "set" && row.Unit != "piece" {
			return nil, invalidPayload(fmt.Sprintf("unidad inválida «%s» en «%s» (set|piece)", row.Unit, row.Code), nil)
		}
		if row.Unit == "set" {
			if kitID != "" {
				return nil, invalidPayload("la altura lleva exactamente una fila kit (unit=set)", nil)
			}
			kitID = row.ID
		}
		if seenCodes[row.Code] {
			return nil, invalidPayload(fmt.Sprintf("código repetido en el payload: «%s»", row.Code), nil)
		}
		if allIDs[row.ID] {
			return nil, invalidPayload(fmt.Sprintf("id repetido en el payload: «%s»", row.ID), nil)
		}
		seenCodes[row.Code] = true
		allIDs[row.ID] = true
	}
	if kitID == "" {
		return nil, invalidPayload("la altura necesita su fila kit (unit=set)", nil)
	}

	optionIDs := map[string]bool{}
	if req.OptionGroup != nil {
		for _, id := range req.OptionGroup.OptionIds {
			optionIDs[id] = true
		}
	}

	hardware := make([]domain.Hardware, 0, len(req.Hardware))
	for i := range req.Hardware {
		row := &req.Hardware[i]
		linked := row.KitHardwareID != nil && *row.KitHardwareID != ""
		switch {
		case row.ID == kitID:
			if linked {
				return nil, invalidPayload("la fila kit no puede vincularse a otro kit", nil)
			}
		case linked:
			if *row.KitHardwareID != kitID {
				return nil, invalidPayload(fmt.Sprintf("«%s» referencia kit_hardware_id que no es el kit de la altura", row.Code), nil)
			}
		default:
			if !optionIDs[row.ID] {
				return nil, invalidPayload(fmt.Sprintf("«%s» no es parte del kit ni opción del selector de insertos", row.Code), nil)
			}
		}
		h := domain.Hardware{
			ID:          row.ID,
			Code:        row.Code,
			Name:        row.Name,
			Unit:        domain.HardwareUnit(row.Unit),
			CostPerUnit: row.CostPerUnit,
			Active:      row.Active,
			Notes:       derefString(row.Notes),
			PreviewShape: func() *string {
				if row.PreviewShape == nil {
					return nil
				}
				cp := *row.PreviewShape
				return &cp
			}(),
			KitHardwareID: row.KitHardwareID,
		}
		pieces, piecesErr := convertPieces(row.Pieces)
		if piecesErr != nil {
			return nil, invalidPayload(fmt.Sprintf("piezas inválidas en «%s»: %v", row.Code, piecesErr), nil)
		}
		if err := domain.ValidateHardwarePieces(pieces); err != nil {
			return nil, invalidPayload(fmt.Sprintf("piezas inválidas en «%s»: %v", row.Code, err), nil)
		}
		h.Pieces = pieces
		designParts, dpErr := convertSystemDesignParts(row.DesignParts)
		if dpErr != nil {
			return nil, invalidPayload(fmt.Sprintf("design_parts inválidas en «%s»: %v", row.Code, dpErr), nil)
		}
		h.DesignParts = designParts
		hardware = append(hardware, h)
	}

	if !(req.Variant.NominalDimensionMm > 0) || math.IsInf(req.Variant.NominalDimensionMm, 0) {
		return nil, invalidPayload("la variante necesita nominalDimensionMm > 0", nil)
	}
	if req.Variant.KitHardwareID != kitID {
		return nil, invalidPayload("kit_hardware_id de la variante no es la fila kit del payload", nil)
	}

	var optionGroup *domain.OptionGroup
	if req.OptionGroup != nil {
		og := req.OptionGroup
		if og.Kind != "hardware" {
			return nil, invalidPayload("el selector de insertos debe ser kind hardware", nil)
		}
		if og.KitHardwareID != kitID {
			return nil, invalidPayload("kit_hardware_id del selector no es el kit de la altura", nil)
		}
		if og.ID == "" || og.Code == "" || og.Name == "" || len(og.OptionIds) == 0 {
			return nil, invalidPayload("el selector necesita id, code, name y al menos una opción", nil)
		}
		for _, id := range og.OptionIds {
			if !allIDs[id] || id == kitID {
				return nil, invalidPayload(fmt.Sprintf("option_ids del selector referencia una fila que no es inserto del payload: «%s»", id), nil)
			}
		}
		kitRef := og.KitHardwareID
		optionGroup = &domain.OptionGroup{
			ID: og.ID, Code: og.Code, Name: og.Name, Kind: og.Kind,
			Required: og.Required, OptionIDs: og.OptionIds, KitHardwareID: &kitRef,
		}
	}

	eligibility, egErr := kitSystemEligibilityFromRequest(req.EligibilityGroup)
	if egErr != nil {
		return nil, invalidPayload(egErr.Error(), nil)
	}
	return &kitSystemHeightPlan{
		hardware:    hardware,
		variant: domain.ProductVariant{
			NominalDimensionMm: req.Variant.NominalDimensionMm, HardwareID: kitID, CommercialKitHardwareID: kitID,
			Label: strings.TrimSpace(derefString(req.Variant.Label)),
		},
		optionGroup: optionGroup,
		eligibility: eligibility,
		allCodes:    seenCodesSlice(seenCodes),
	}, nil
}

// addHeightVariant returns the ensamble with the new height variant appended
// to its height variant set (created, with a server id, when absent) and its
// external height raised to the tallest variant. A nominal already present is
// a typed 422 — never a duplicate height.
func addHeightVariant(agr domain.Agregado, variant domain.ProductVariant) (domain.Agregado, string, map[string]any) {
	next := agr
	next.VariantSets = append([]domain.AgregadoVariantSet(nil), agr.VariantSets...)
	idx := -1
	for i := range next.VariantSets {
		if next.VariantSets[i].Dimension == "height" {
			idx = i
			break
		}
	}
	if idx == -1 {
		// Same shape the system wizard creates (#1553): a height set without
		// an explicit compatibility rule.
		next.VariantSets = append(next.VariantSets, domain.AgregadoVariantSet{ID: uuid.NewString(), Dimension: "height"})
		idx = len(next.VariantSets) - 1
	}
	vs := next.VariantSets[idx]
	for _, v := range vs.Variants {
		if v.NominalDimensionMm == variant.NominalDimensionMm {
			return agr, "", map[string]any{
				"code":    "HARDWARE_KIT_SYSTEM_HEIGHT_EXISTS",
				"message": fmt.Sprintf("el ensamble ya tiene la altura de %g mm", variant.NominalDimensionMm),
				"details": map[string]any{"nominalDimensionMm": variant.NominalDimensionMm},
			}
		}
	}
	// #1633: the label is unique too, compared EFFECTIVE against EFFECTIVE:
	// a legacy unlabeled 108 counts as «M», and so does a new unlabeled 108-
	// table nominal — two heights never both show as the same letter.
	if label := domain.EffectiveVariantLabel(variant); label != "" {
		for _, v := range vs.Variants {
			if strings.EqualFold(domain.EffectiveVariantLabel(v), label) {
				return agr, "", map[string]any{
					"code":    "HARDWARE_KIT_SYSTEM_HEIGHT_EXISTS",
					"message": fmt.Sprintf("el ensamble ya tiene una altura «%s»", label),
					"details": map[string]any{"label": label},
				}
			}
		}
	}
	vs.Variants = append(append([]domain.ProductVariant(nil), vs.Variants...), variant)
	next.VariantSets[idx] = vs
	if h := int(math.Ceil(variant.NominalDimensionMm)); h > next.HeightMm {
		next.HeightMm = h
	}
	return next, vs.ID, nil
}
