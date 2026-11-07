package engine

import (
	"fmt"
	"sort"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1502: kit accesorio elegible. Un grupo de opción con kit_hardware_id
// declara ACCESORIOS para un kit comercial (p. ej. LATERAL_E → galería /
// BOXCOVER / BOXCAP sobre el kit MERIVOBOX E): la bahía que monta el kit
// materializa el accesorio elegido — separado del SKP del cajón, con assets
// propios (los miembros accesorios reutilizan la maquinaria de partes de kit)
// — y aporta su línea de cotización. Sin grupos vinculados el motor queda
// byte-idéntico al legacy.
//
// Contrato por grupo, por bahía (espejo exacto en el resolve TS de previews):
//   - elección válida → ensamble accesorio propio `<bahía>-acc-<grupo>` +
//     línea de cotización `kit-acc-<inst>-u<n>-<grupo>` (cotiza lo dibujado).
//   - sin elección y grupo OPCIONAL → nada (patrón ZOCLO_PERFIL).
//   - sin elección y grupo REQUERIDO → fail-closed visible: rejection
//     `accessory_choice_required` + ContractIssue ACCESSORY_CHOICE_REQUIRED
//     en el authoring resolve (status blocked); la cotización no inventa
//     demanda por el accesorio faltante.
//   - elección inválida (no es miembro activo del grupo) → rejection
//     `resolve_failed` con el detalle; nunca un accesorio dibujado de más.

// accessoryChoiceRequiredReason is the machine rejection reason for a bay
// whose mounted kit declares a REQUIRED accessory group with no choice.
const accessoryChoiceRequiredReason = "accessory_choice_required"

// linkedAccessoryGroups returns the hardware option groups offering
// accessories for the given kit, deterministically ordered by code.
func linkedAccessoryGroups(catalog domain.Catalog, kitID string) []domain.OptionGroup {
	target := strings.TrimSpace(kitID)
	if target == "" || len(catalog.OptionGroups) == 0 {
		return nil
	}
	var groups []domain.OptionGroup
	for _, og := range catalog.OptionGroups {
		if og.Kind != "hardware" || og.KitHardwareID == nil || *og.KitHardwareID != target {
			continue
		}
		groups = append(groups, og)
	}
	if len(groups) == 0 {
		return nil
	}
	sort.SliceStable(groups, func(i, j int) bool { return groups[i].Code < groups[j].Code })
	return groups
}

// accessoryRigidMembers materializes the chosen accessory as bay rigid
// members: an accessory that is itself a kit contributes its design parts
// (same sync machinery as the main kit — placements from DesignParts[0].Label,
// actorMembership, assets from the catalog); a monolithic accessory draws
// itself as a single member with its own asset.
func accessoryRigidMembers(catalog domain.Catalog, accessoryKitID, hostCode string) []domain.AgregadoRigidMember {
	accessory := domain.Agregado{Code: hostCode}
	accessory = syncAgregadoRigidMembersFromCatalog(accessory, catalog, accessoryKitID)
	if len(accessory.RigidMembers) > 0 {
		return accessory.RigidMembers
	}
	if hw, ok := findHardware(catalog, accessoryKitID); ok {
		// #1518 F1 (was #1512 hands): a multi-design monolithic accessory
		// draws ONE member PER piece — same expansion rule as multi-design
		// kit parts (placement from the piece: anchor + offsets).
		if len(hw.Pieces) > 0 {
			members := make([]domain.AgregadoRigidMember, 0, len(hw.Pieces))
			for _, piece := range hw.Pieces {
				members = append(members, kitPieceMember(hw, piece, hostCode))
			}
			return members
		}
		return []domain.AgregadoRigidMember{kitPartMember(hw, hostCode, "")}
	}
	return nil
}

// accessoryMemberForChoice validates a group choice as an active member of
// the group. Only then may it draw or quote.
func accessoryMemberForChoice(catalog domain.Catalog, og domain.OptionGroup, choice string) (domain.Hardware, bool) {
	trimmed := strings.TrimSpace(choice)
	if trimmed == "" {
		return domain.Hardware{}, false
	}
	member := false
	for _, id := range og.OptionIDs {
		if strings.TrimSpace(id) == trimmed {
			member = true
			break
		}
	}
	if !member {
		return domain.Hardware{}, false
	}
	hw, ok := findHardware(catalog, trimmed)
	if !ok || !hw.Active {
		return domain.Hardware{}, false
	}
	return hw, true
}

// resolveAccessoryAssemblies resolves the accessory assemblies one bay
// contributes for the kit it mounts. Legacy bays (kit without linked groups)
// produce nothing.
func resolveAccessoryAssemblies(
	baseAgr domain.Agregado,
	catalog domain.Catalog,
	optionChoices map[string]string,
	effectiveKit string,
	bayInstanceID string,
	unit agregadoUnit,
	params AssemblyResolutionParams,
) ([]LayoutAssembly, []LayoutAssemblyRejection) {
	groups := linkedAccessoryGroups(catalog, effectiveKit)
	if len(groups) == 0 {
		return nil, nil
	}
	var assemblies []LayoutAssembly
	var rejections []LayoutAssemblyRejection
	for _, og := range groups {
		accInstanceID := fmt.Sprintf("%s-acc-%s", bayInstanceID, strings.ToLower(og.Code))
		choice := strings.TrimSpace(optionChoices[og.Code])
		if choice == "" {
			if og.Required {
				rejections = append(rejections, LayoutAssemblyRejection{
					AssemblyInstanceID: accInstanceID,
					AgregadoID:         baseAgr.ID,
					AgregadoCode:       baseAgr.Code,
					Reason:             accessoryChoiceRequiredReason,
					BayHeightMm:        unit.h,
					Detail:             fmt.Sprintf("el grupo «%s» declara accesorios para el kit montado en esta bahía y es obligatorio", og.Code),
				})
			}
			continue
		}
		if _, ok := accessoryMemberForChoice(catalog, og, choice); !ok {
			rejections = append(rejections, LayoutAssemblyRejection{
				AssemblyInstanceID: accInstanceID,
				AgregadoID:         baseAgr.ID,
				AgregadoCode:       baseAgr.Code,
				Reason:             "resolve_failed",
				BayHeightMm:        unit.h,
				Detail:             fmt.Sprintf("la elección «%s» del grupo «%s» no es un accesorio activo del grupo", choice, og.Code),
			})
			continue
		}
		members := accessoryRigidMembers(catalog, choice, baseAgr.Code)
		if len(members) == 0 {
			continue
		}
		// The synthetic accessory recipe only feeds ResolveAgregadoAssembly:
		// its own commercial kit keeps `included_in_kit` members legal and
		// its internal BOM is discarded (the quote adds the accessory line
		// through the variant-kit path, never from assembly BOMs).
		accessoryKitID := choice
		accAgr := domain.Agregado{
			ID:                      accInstanceID,
			Code:                    baseAgr.Code,
			Name:                    fmt.Sprintf("%s · %s", baseAgr.Name, og.Name),
			RigidMembers:            members,
			CommercialKitHardwareID: &accessoryKitID,
		}
		resolved, err := ResolveAgregadoAssembly(accAgr, params)
		if err != nil {
			rejections = append(rejections, LayoutAssemblyRejection{
				AssemblyInstanceID: accInstanceID,
				AgregadoID:         baseAgr.ID,
				AgregadoCode:       baseAgr.Code,
				Reason:             "resolve_failed",
				BayHeightMm:        unit.h,
				Detail:             err.Error(),
			})
			continue
		}
		if len(resolved.RigidMembers) == 0 {
			continue
		}
		AttachHardwareAssetsToMembers(resolved.RigidMembers, catalog)
		assemblies = append(assemblies, LayoutAssembly{
			AssemblyInstanceID: accInstanceID,
			AgregadoID:         baseAgr.ID,
			Placement: map[string]any{
				"translation": []float64{unit.x, unit.y, unit.z},
				"basis": map[string]any{
					"x": []float64{1, 0, 0},
					"y": []float64{0, 1, 0},
					"z": []float64{0, 0, 1},
				},
			},
			DimensionsMm: [3]float64{unit.w, unit.h, unit.d},
			RigidMembers: resolved.RigidMembers,
		})
	}
	return assemblies, rejections
}

// collectAccessoryKitHardwareLines quotes the accessories a bay chose for
// the kit it mounts (cotiza lo dibujado: same decision as the layout —
// valid choice only; optional-without-choice and required-without-choice
// contribute nothing).
func collectAccessoryKitHardwareLines(
	catalog domain.Catalog,
	optionChoices map[string]string,
	kitID string,
	instanceKey string,
	unitIndex int,
) []domain.HardwareLine {
	groups := linkedAccessoryGroups(catalog, kitID)
	if len(groups) == 0 {
		return nil
	}
	lines := make([]domain.HardwareLine, 0, len(groups))
	for _, og := range groups {
		choice := strings.TrimSpace(optionChoices[og.Code])
		if choice == "" {
			continue
		}
		if _, ok := accessoryMemberForChoice(catalog, og, choice); !ok {
			continue
		}
		lines = append(lines, domain.HardwareLine{
			ID:         fmt.Sprintf("kit-acc-%s-u%d-%s", instanceKey, unitIndex, strings.ToLower(og.Code)),
			Quantity:   1,
			OptionRole: "COMMERCIAL_KIT",
			HardwareID: choice,
		})
	}
	return lines
}

// accessoryChoiceContractIssues maps accessory-choice layout rejections onto
// the closed contract issue code (#1502). Error severity drives the blocked
// validation status while the layout itself is still returned: the user sees
// the bay and chooses the accessory.
func accessoryChoiceContractIssues(rejections []LayoutAssemblyRejection) []domain.ContractIssue {
	issues := []domain.ContractIssue{}
	for _, rej := range rejections {
		if rej.Reason != accessoryChoiceRequiredReason {
			continue
		}
		issues = append(issues, domain.ContractIssue{
			Code:        "ACCESSORY_CHOICE_REQUIRED",
			Message:     fmt.Sprintf("la bahía %s monta un kit con accesorio obligatorio sin elegir", rej.AssemblyInstanceID),
			Severity:    domain.IssueSeverityError,
			EntityID:    rej.AssemblyInstanceID,
			Path:        "furniture.layout.assemblies",
			Remediation: "Elegí el accesorio del grupo vinculado al kit (alta del ítem o elección a nivel proyecto).",
			Details:     map[string]any{"agregadoId": rej.AgregadoID, "agregadoCode": rej.AgregadoCode, "bayHeightMm": rej.BayHeightMm, "detail": rej.Detail},
		})
	}
	return issues
}

// consumeAgregadoAndAccessoryChoices (#1555): registers the choice keys the
// resolve CONSULTS when it materializes a bay's kit and its accessories —
// the agregado option role and every kit-linked accessory group with a valid
// member choice. The #826 intersection (design working copy, quote freeze)
// and the release gate share THIS derivation: dropping a consulted key would
// change the NEXT resolve's BOM (different kit / missing accessory line),
// breaking the BOM-neutrality guarantee exactly like the review reproduced.
// A key whose value is not a real active member is consumed by nobody — it
// stays droppable and the gate rejects it by name. Same decision functions
// the quote and the layout run (ResolveEffectiveAgregadoID,
// linkedAccessoryGroups, accessoryMemberForChoice): no second truth.
func consumeAgregadoAndAccessoryChoices(module domain.Module, catalog domain.Catalog, choices map[string]string, consumed map[string]string) {
	instances := append(append([]domain.ModuleAgregadoInstance{}, structureAgregadosOf(module, catalog)...), module.Agregados...)
	for _, inst := range instances {
		role := strings.TrimSpace(inst.OptionRole)
		effectiveID := ResolveEffectiveAgregadoID(inst, choices)
		if effectiveID == "" {
			continue
		}
		agr, ok := findAgregado(catalog, effectiveID)
		if !ok {
			continue
		}
		if role != "" && strings.TrimSpace(choices[role]) != "" {
			consumed[role] = effectiveID
		}
		for _, kitID := range agregadoKitIDs(agr) {
			for _, og := range linkedAccessoryGroups(catalog, kitID) {
				choice := strings.TrimSpace(choices[og.Code])
				if choice == "" {
					continue
				}
				if hw, ok := accessoryMemberForChoice(catalog, og, choice); ok {
					consumed[og.Code] = hw.ID
				}
			}
		}
	}
}

// agregadoKitIDs lists the commercial kits the agregado can mount: the level
// kit plus every height-variant kit (#1493). Accessory groups are declared
// per kit; the web offering unions them across variants and so does the
// consumed derivation.
func agregadoKitIDs(agr domain.Agregado) []string {
	kitIDs := make([]string, 0, 2)
	seen := map[string]bool{}
	if agr.CommercialKitHardwareID != nil && strings.TrimSpace(*agr.CommercialKitHardwareID) != "" {
		kitIDs = append(kitIDs, *agr.CommercialKitHardwareID)
		seen[*agr.CommercialKitHardwareID] = true
	}
	for _, vs := range agr.VariantSets {
		for _, v := range vs.Variants {
			kit := strings.TrimSpace(v.CommercialKitHardwareID)
			if kit != "" && !seen[kit] {
				kitIDs = append(kitIDs, kit)
				seen[kit] = true
			}
		}
	}
	return kitIDs
}
