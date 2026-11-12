package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"

	"github.com/google/uuid"
	openapi "github.com/tiagofur/muebles-backend/internal/api/openapi/generated"
	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1553 — the M4 drawer-system wizard applies its plan SERVER-SIDE in one
// request: kits multi-design per height, accessory hardware with pieces,
// the accessory option group and ONE agregado with height variants. The auth
// middleware wraps this handler in the request's tenant transaction, so every
// store call below is atomic — any failure rolls the whole system back, never
// a half-created system (#1553 acceptance: rollback proven by SQL readback).
//
// Failure semantics (typed, before OR during the writes):
//   - 422 HARDWARE_KIT_SYSTEM_PAYLOAD_INVALID: vocabulary/internal-reference
//     violations (kit links, variant refs, duplicate payload codes, non-empty
//     variant-set ids — the server assigns those).
//   - 422 HARDWARE_KIT_SYSTEM_REFERENCE_MISSING: a code the plan marked
//     reused does not exist in the base.
//   - 409 HARDWARE_KIT_SYSTEM_CODE_TAKEN: a code the plan marked new already
//     exists (naming the conflicting rows; the advisory locks serialize
//     concurrent creations so the loser reads this cleanly).
//
// Row identity stays client-owned (#1398); the server never derives ids from
// names — the historical `${code}-heights` variant-set id dies here.
func (s *Server) HandleHardwareKitSystemCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		respondWithError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if !requirePermission(w, domain.AnyRole(actorRoles(claimsFromRequest(r)), domain.RoleCanMutateCatalog), "no tenés permiso para modificar el catálogo") {
		return
	}
	var req openapi.HardwareKitSystemCreateRequest
	if !decodeJSONBody(w, r, &req) {
		return
	}

	plan, payloadErr := kitSystemPlanFromRequest(&req)
	if payloadErr != nil {
		respondWithJSON(w, http.StatusUnprocessableEntity, payloadErr)
		return
	}

	// Serialize on the payload codes BEFORE probing: two concurrent creations
	// of the same plan take the locks in the same (sorted) order — the loser
	// waits for the winner's commit and then reads the codes in its duplicate
	// pre-check, yielding a clean typed 409 instead of a mid-write unique
	// violation on an aborted transaction.
	sortedCodes := append([]string{}, plan.allCodes...)
	sort.Strings(sortedCodes)
	if err := s.Store.LockCatalogCodes(r.Context(), sortedCodes); err != nil {
		respondWithInternalError(w, err, "kit system code locks")
		return
	}

	hwList, err := s.Store.ListHardwares(r.Context())
	if err != nil {
		respondWithInternalError(w, err, "kit system hardware probe")
		return
	}
	existingCodes := make(map[string]bool, len(hwList))
	for _, h := range hwList {
		existingCodes[h.Code] = true
	}
	agrList, err := s.Store.ListAgregados(r.Context())
	if err != nil {
		respondWithInternalError(w, err, "kit system agregado probe")
		return
	}
	existingAgregadoCodes := make(map[string]bool, len(agrList))
	for _, a := range agrList {
		existingAgregadoCodes[a.Code] = true
	}

	// #1596: resolve the eligibility target BEFORE the first insert — a 4xx
	// after sibling rows were written would COMMIT a half system (the
	// middleware commits 4xx). The resolved group (id + version) rides in the
	// plan; the member append happens later in the same transaction.
	if plan.eligibility != nil && plan.eligibility.existingGroupID != "" {
		groups, err := s.Store.ListOptionGroups(r.Context())
		if err != nil {
			respondWithInternalError(w, err, "kit system eligibility probe")
			return
		}
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
				"el grupo de elegibilidad debe ser kind agregado (ahí viven los ensambles que los módulos eligen)",
				map[string]any{"group_id": plan.eligibility.eligibilityTarget.ID, "kind": plan.eligibility.eligibilityTarget.Kind},
			))
			return
		}
	}

	// Codes the plan marked reused MUST exist; codes marked new (hardware
	// rows + the agregado) MUST NOT.
	missingExpected := []string{}
	for _, code := range req.ExpectedExistingCodes {
		if !existingCodes[code] {
			missingExpected = append(missingExpected, code)
		}
	}
	if len(missingExpected) > 0 {
		respondWithJSON(w, http.StatusUnprocessableEntity, map[string]any{
			"code":    "HARDWARE_KIT_SYSTEM_REFERENCE_MISSING",
			"message": fmt.Sprintf("el plan marca como existentes códigos que no están en el catálogo: %v", missingExpected),
			"details": map[string]any{"codes": missingExpected},
		})
		return
	}
	taken := []string{}
	for _, code := range plan.allCodes {
		if existingCodes[code] || existingAgregadoCodes[code] {
			taken = append(taken, code)
		}
	}
	if len(taken) > 0 {
		respondWithJSON(w, http.StatusConflict, map[string]any{
			"code":    "HARDWARE_KIT_SYSTEM_CODE_TAKEN",
			"message": fmt.Sprintf("códigos del sistema ya existen en el catálogo: %v", taken),
			"details": map[string]any{"codes": taken},
		})
		return
	}

	// Resolve every visual/piece asset binding BEFORE the first insert: an
	// invalid asset must fail the request 4xx-clean, never after sibling rows
	// were written (a 4xx commits the middleware transaction).
	for i := range plan.hardware {
		h := &plan.hardware[i]
		h.Active = true
		if !s.resolveHardwareVisualBindingForWrite(r, w, h) {
			return
		}
	}

	createdCodes := make([]string, 0, len(plan.hardware))
	reusedCodes := append([]string{}, req.ExpectedExistingCodes...)
	for i := range plan.hardware {
		h := plan.hardware[i]
		if err := s.Store.CreateHardware(r.Context(), &h); err != nil {
			if isDuplicateKey(err) {
				respondWithJSON(w, http.StatusConflict, map[string]any{
					"code":    "HARDWARE_KIT_SYSTEM_CODE_TAKEN",
					"message": fmt.Sprintf("el código «%s» ya existe en el catálogo (otra creación lo ganó)", h.Code),
					"details": map[string]any{"codes": []string{h.Code}},
				})
				return
			}
			respondWithInternalError(w, err, "kit system hardware create")
			return
		}
		createdCodes = append(createdCodes, h.Code)
	}

	agr := plan.agregado
	if err := s.Store.CreateAgregado(r.Context(), agr); err != nil {
		if isDuplicateKey(err) {
			respondWithJSON(w, http.StatusConflict, map[string]any{
				"code":    "HARDWARE_KIT_SYSTEM_CODE_TAKEN",
				"message": fmt.Sprintf("el ensamble «%s» ya existe en el catálogo (otra creación lo ganó)", agr.Code),
				"details": map[string]any{"codes": []string{agr.Code}},
			})
			return
		}
		respondWithInternalError(w, err, "kit system agregado create")
		return
	}

	if plan.optionGroup != nil {
		if err := s.Store.CreateOptionGroup(r.Context(), plan.optionGroup); err != nil {
			if isDuplicateKey(err) {
				respondWithJSON(w, http.StatusConflict, map[string]any{
					"code":    "HARDWARE_KIT_SYSTEM_CODE_TAKEN",
					"message": fmt.Sprintf("el grupo «%s» ya existe en el catálogo", plan.optionGroup.Code),
					"details": map[string]any{"codes": []string{plan.optionGroup.Code}},
				})
				return
			}
			respondWithInternalError(w, err, "kit system option group create")
			return
		}
	}

	// #1596 decisión 9: elegibilidad del ensamble en la MISMA transacción.
	if plan.eligibility != nil {
		switch {
		case plan.eligibility.existingGroupID != "":
			target := plan.eligibility.eligibilityTarget
			memberPresent := false
			for _, id := range target.OptionIDs {
				if id == agr.ID {
					memberPresent = true
					break
				}
			}
			if !memberPresent {
				target.OptionIDs = append(target.OptionIDs, agr.ID)
				if err := s.Store.UpdateOptionGroup(r.Context(), target.ID, target.Version, target); err != nil {
					respondWithInternalError(w, err, "kit system eligibility member add")
					return
				}
			}
		default:
			g := plan.eligibility.newGroup
			g.OptionIDs = []string{agr.ID}
			if err := s.Store.CreateOptionGroup(r.Context(), g); err != nil {
				if isDuplicateKey(err) {
					respondWithJSON(w, http.StatusConflict, map[string]any{
						"code":    "HARDWARE_KIT_SYSTEM_CODE_TAKEN",
						"message": fmt.Sprintf("el grupo de elegibilidad «%s» ya existe en el catálogo", g.Code),
						"details": map[string]any{"codes": []string{g.Code}},
					})
					return
				}
				respondWithInternalError(w, err, "kit system eligibility group create")
				return
			}
		}
	}

	respondWithJSON(w, http.StatusCreated, openapi.HardwareKitSystemCreated{
		CreatedCodes:  createdCodes,
		ReusedCodes:   reusedCodes,
		AgregadoID:    agr.ID,
		AgregadoCode:  agr.Code,
		VariantSetIds: plan.variantSetIDs,
	})
}

// kitSystemPlan is the validated, domain-typed application plan.
type kitSystemPlan struct {
	hardware      []domain.Hardware
	agregado      *domain.Agregado
	optionGroup   *domain.OptionGroup
	eligibility   *kitSystemEligibility
	variantSetIDs []string
	allCodes      []string
}

// kitSystemEligibility (#1596 decisión 9) is the plan-level intent for where
// the new ensamble becomes eligible: an existing kind:agregado group (the
// agregado is appended as a member) or a brand-new group created with the
// agregado as its only member. Applied in the SAME transaction as the rest of
// the system — an eligibility failure rolls the whole creation back.
type kitSystemEligibility struct {
	existingGroupID string
	newGroup        *domain.OptionGroup
	// eligibilityTarget is resolved in the probe phase (pre-insert): the
	// exact group row (with its version) the member append will update.
	eligibilityTarget *domain.OptionGroup
}

func kitSystemEligibilityFromRequest(row *openapi.HardwareKitSystemEligibilityGroupRow) (*kitSystemEligibility, error) {
	if row == nil {
		return nil, nil
	}
	if row.ExistingGroupID != nil && *row.ExistingGroupID != "" {
		if (row.ID != nil && *row.ID != "") || (row.Code != nil && *row.Code != "") || (row.Name != nil && *row.Name != "") {
			return nil, fmt.Errorf("eligibility_group: existing_group_id es excluyente con id/code/name del grupo nuevo")
		}
		return &kitSystemEligibility{existingGroupID: *row.ExistingGroupID}, nil
	}
	id, code, name := derefString(row.ID), derefString(row.Code), derefString(row.Name)
	if id == "" || code == "" || name == "" {
		return nil, fmt.Errorf("eligibility_group: necesitás existing_group_id (grupo existente) o id+code+name (grupo nuevo)")
	}
	return &kitSystemEligibility{newGroup: &domain.OptionGroup{
		ID:       id,
		Code:     code,
		Name:     name,
		Kind:     "agregado",
		Required: false,
	}}, nil
}

func invalidPayload(message string, details map[string]any) map[string]any {
	return map[string]any{
		"code":    "HARDWARE_KIT_SYSTEM_PAYLOAD_INVALID",
		"message": message,
		"details": details,
	}
}

// kitSystemPlanFromRequest converts and validates the wire plan against its
// OWN internal references (pure; no DB access). Vocabulary and reference
// failures return the typed 422 payload; nothing here mutates the catalog.
func kitSystemPlanFromRequest(req *openapi.HardwareKitSystemCreateRequest) (*kitSystemPlan, map[string]any) {
	kitIDs := map[string]bool{}
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
			kitIDs[row.ID] = true
		}
		allIDs[row.ID] = true
	}
	if len(kitIDs) == 0 {
		return nil, invalidPayload("el sistema necesita al menos un kit (unit=set)", nil)
	}

	seenCodes := map[string]bool{}
	for i := range req.Hardware {
		code := req.Hardware[i].Code
		if seenCodes[code] {
			return nil, invalidPayload(fmt.Sprintf("código repetido en el payload: «%s»", code), nil)
		}
		seenCodes[code] = true
	}

	hardware := make([]domain.Hardware, 0, len(req.Hardware))
	for i := range req.Hardware {
		row := &req.Hardware[i]
		if row.KitHardwareID != nil && *row.KitHardwareID != "" && !kitIDs[*row.KitHardwareID] {
			return nil, invalidPayload(fmt.Sprintf("«%s» referencia kit_hardware_id que no es una fila kit del payload", row.Code), nil)
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

	agrRow := &req.Agregado
	if agrRow.ID == "" || agrRow.Code == "" || agrRow.Name == "" {
		return nil, invalidPayload("el agregado necesita id, code y name", nil)
	}
	if seenCodes[agrRow.Code] {
		return nil, invalidPayload(fmt.Sprintf("código repetido en el payload: «%s»", agrRow.Code), nil)
	}
	seenCodes[agrRow.Code] = true
	if agrRow.WidthMm <= 0 || agrRow.DepthMm <= 0 || agrRow.HeightMm <= 0 {
		return nil, invalidPayload("el agregado necesita dimensiones positivas", nil)
	}
	if !kitIDs[agrRow.CommercialKitHardwareID] {
		return nil, invalidPayload("commercial_kit_hardware_id del agregado no es una fila kit del payload", nil)
	}

	variantSetIDs := make([]string, 0, len(agrRow.VariantSets))
	variantSets := make([]domain.AgregadoVariantSet, 0, len(agrRow.VariantSets))
	for i := range agrRow.VariantSets {
		vs := &agrRow.VariantSets[i]
		if vs.ID != "" {
			return nil, invalidPayload("variant_sets[].id debe venir vacío: el servidor lo asigna (#1553)", nil)
		}
		if vs.Dimension != "width" && vs.Dimension != "height" && vs.Dimension != "depth" {
			return nil, invalidPayload(fmt.Sprintf("dimensión de variant set inválida «%s»", vs.Dimension), nil)
		}
		variants := make([]domain.ProductVariant, 0, len(vs.Variants))
		for j := range vs.Variants {
			v := &vs.Variants[j]
			if !(v.NominalDimensionMm > 0) {
				return nil, invalidPayload("cada variante necesita nominalDimensionMm > 0", nil)
			}
			if !kitIDs[v.HardwareId] {
				return nil, invalidPayload("hardwareId de variante no es una fila kit del payload", nil)
			}
			if v.CommercialKitHardwareId != nil && *v.CommercialKitHardwareId != "" && !kitIDs[*v.CommercialKitHardwareId] {
				return nil, invalidPayload("commercialKitHardwareId de variante no es una fila kit del payload", nil)
			}
			variants = append(variants, domain.ProductVariant{
				NominalDimensionMm:      v.NominalDimensionMm,
				HardwareID:              v.HardwareId,
				CommercialKitHardwareID: derefString(v.CommercialKitHardwareId),
			})
		}
		id := uuid.NewString()
		variantSetIDs = append(variantSetIDs, id)
		variantSets = append(variantSets, domain.AgregadoVariantSet{
			ID:        id,
			Dimension: vs.Dimension,
			Variants:  variants,
		})
	}

	presentationMotion := map[string]any(nil)
	if agrRow.PresentationMotion != nil && len(*agrRow.PresentationMotion) > 0 {
		// Round-trip through JSON so an arbitrary motion payload keeps the
		// exact map shape the domain stores (the backend stores and echoes
		// presentation motion verbatim — it never interprets it).
		raw, err := json.Marshal(*agrRow.PresentationMotion)
		if err != nil {
			return nil, invalidPayload("presentation_motion no es serializable", nil)
		}
		var motion map[string]any
		if err := json.Unmarshal(raw, &motion); err != nil {
			return nil, invalidPayload("presentation_motion debe ser un objeto", nil)
		}
		presentationMotion = motion
	}

	kitRef := agrRow.CommercialKitHardwareID
	agr := &domain.Agregado{
		ID:                      agrRow.ID,
		Code:                    agrRow.Code,
		Name:                    agrRow.Name,
		Active:                  agrRow.Active,
		WidthMm:                 int(agrRow.WidthMm),
		HeightMm:                int(agrRow.HeightMm),
		DepthMm:                 int(agrRow.DepthMm),
		CommercialKitHardwareID: &kitRef,
		VariantSets:             variantSets,
		PresentationMotion:      presentationMotion,
	}

	optionGroup := (*domain.OptionGroup)(nil)
	if req.OptionGroup != nil {
		og := req.OptionGroup
		if og.Kind != "hardware" {
			return nil, invalidPayload("el grupo del sistema debe ser kind hardware", nil)
		}
		if !allIDs[og.KitHardwareID] || !kitIDs[og.KitHardwareID] {
			return nil, invalidPayload("kit_hardware_id del grupo no es una fila kit del payload", nil)
		}
		for _, optionID := range og.OptionIds {
			if !allIDs[optionID] {
				return nil, invalidPayload(fmt.Sprintf("option_ids del grupo referencia una fila inexistente del payload: «%s»", optionID), nil)
			}
		}
		kitRef := og.KitHardwareID
		optionGroup = &domain.OptionGroup{
			ID:            og.ID,
			Code:          og.Code,
			Name:          og.Name,
			Kind:          og.Kind,
			Required:      og.Required,
			OptionIDs:     og.OptionIds,
			KitHardwareID: &kitRef,
		}
	}

	allCodes := append([]string{}, seenCodesSlice(seenCodes)...)
	eligibility, egErr := kitSystemEligibilityFromRequest(req.EligibilityGroup)
	if egErr != nil {
		return nil, invalidPayload(egErr.Error(), nil)
	}
	return &kitSystemPlan{
		hardware:      hardware,
		agregado:      agr,
		optionGroup:   optionGroup,
		eligibility:   eligibility,
		variantSetIDs: variantSetIDs,
		allCodes:      allCodes,
	}, nil
}

// convertPieces maps the wire pieces (asset identifiers as a generic map) to
// domain pieces; the asset facts are resolved server-side later through the
// SAME authority as the regular hardware write.
func convertPieces(wire []openapi.HardwarePiece) ([]domain.HardwarePiece, error) {
	if len(wire) == 0 {
		return nil, nil
	}
	out := make([]domain.HardwarePiece, 0, len(wire))
	for i := range wire {
		p := wire[i]
		dp := domain.HardwarePiece{Anchor: p.Anchor}
		if p.Asset != nil && len(p.Asset) > 0 {
			raw, err := json.Marshal(p.Asset)
			if err != nil {
				return nil, fmt.Errorf("piece %d: asset no serializable: %w", i, err)
			}
			var binding domain.HardwareVisualAssetBinding
			if err := json.Unmarshal(raw, &binding); err != nil {
				return nil, fmt.Errorf("piece %d: asset inválido: %w", i, err)
			}
			if binding.AssetID == "" {
				return nil, fmt.Errorf("piece %d: asset sin assetId", i)
			}
			dp.Asset = &binding
		}
		if p.OffsetMm != nil && len(p.OffsetMm) > 0 {
			raw, err := json.Marshal(p.OffsetMm)
			if err != nil {
				return nil, fmt.Errorf("piece %d: offsetMm no serializable: %w", i, err)
			}
			var offset domain.HardwarePieceOffset
			if err := json.Unmarshal(raw, &offset); err != nil {
				return nil, fmt.Errorf("piece %d: offsetMm inválido: %w", i, err)
			}
			// Fail loud before any write: a silently dropped offset would
			// fall back to the engine's invisible 10/35 default — exactly
			// what the new alta exists to eliminate (#1596 review A-S2).
			// Explicit {0,0,0} is legitimate (diseño en el origen).
			dp.OffsetMm = &offset
		}
		out = append(out, dp)
	}
	return out, nil
}

// convertSystemDesignParts maps the wire design-part declarations to domain
// (#1596): the alta writes the «Al abrir» the engine already reads
// (kitPieceMember → DesignParts[0].ActorMembership); the name/code regex is
// legacy inference and the new alta never relies on it.
func convertSystemDesignParts(wire []openapi.HardwareKitSystemDesignPartRow) ([]domain.HardwareDesignPart, error) {
	if len(wire) == 0 {
		return nil, nil
	}
	out := make([]domain.HardwareDesignPart, 0, len(wire))
	for i := range wire {
		w := wire[i]
		if strings.TrimSpace(w.ComponentName) == "" {
			return nil, fmt.Errorf("fila %d: component_name vacío", i)
		}
		switch w.ActorMembership {
		case "body", "actor:drawer", "actor:door":
		default:
			return nil, fmt.Errorf("fila %d: actor_membership «%s» fuera del vocabulario (body|actor:drawer|actor:door)", i, w.ActorMembership)
		}
		dp := domain.HardwareDesignPart{
			ComponentName:   strings.TrimSpace(w.ComponentName),
			ActorMembership: w.ActorMembership,
		}
		if w.Label != nil {
			dp.Label = *w.Label
		}
		if w.FinishKey != nil {
			dp.FinishKey = *w.FinishKey
		}
		out = append(out, dp)
	}
	return out, nil
}

func derefString(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

func seenCodesSlice(seen map[string]bool) []string {
	out := make([]string, 0, len(seen))
	for code := range seen {
		out = append(out, code)
	}
	return out
}
