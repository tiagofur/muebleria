package engine

import (
	"fmt"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1493 slice 3: el kit comercial de la variante se cotiza POR BAHÍA. Una
// receta que declara kits por variante (una altura Blum MERIVOBOX N/M/K/E =
// un kit) no tenía ninguna línea de kit en la cotización — el BOM del resolve
// (role commercial_kit) sólo lo ve la simulación de receta. Aquí cada bahía
// resuelve SU variante y aporta la línea del kit efectivo (1 por bahía).
//
// Contrato:
//   - Sólo recetas que declaran kits POR VARIANTE generan líneas: las recetas
//     legacy (kit a nivel agregado o sin kit) quedan byte-idénticas.
//   - Una bahía donde ninguna variante cabe NO aporta kit (el layout la
//     rechaza visiblemente via assemblyRejections; la cotización no inventa
//     demanda para un cajón que no se dibuja).
//   - Si la receta ya autoriza una línea bulk que resuelve al mismo kit, no
//     se duplica (posiciones/autoría mandan, mismo orden de dedupe que TS).
func collectVariantKitHardwareLines(
	module domain.Module,
	catalog domain.Catalog,
	optionChoices map[string]string,
	dims formulaDims,
	baseClearance int,
) []domain.HardwareLine {
	lines := make([]domain.HardwareLine, 0)
	instances := append(append([]domain.ModuleAgregadoInstance{}, structureAgregadosOf(module, catalog)...), module.Agregados...)
	if len(instances) == 0 {
		return lines
	}

	for _, inst := range instances {
		effectiveID := ResolveEffectiveAgregadoID(inst, optionChoices)
		if effectiveID == "" {
			continue
		}
		agr, ok := findAgregado(catalog, effectiveID)
		if !ok || !agregadoDeclaresVariantKit(agr) {
			continue
		}
		quantity := inst.Quantity
		if quantity <= 0 {
			quantity = 1
		}
		parentDims := formulaDims{
			W: dims.W, H: dims.H, D: dims.D,
			PW: dims.W, PH: dims.H, PD: dims.D,
			T: 18, B: baseClearance,
		}
		// Cadena de fallback EXACTA del layout (layout.go) y de la expansión de
		// partes (resolve.go): fórmula vacía o fallada → externalDims de la
		// receta → dims del módulo. Review slice 3 (blocker): con externalDims
		// + fórmulas parciales el quote cotizaba contra la caja equivocada.
		spaceW, spaceH, spaceD := float64(dims.W), float64(dims.H), float64(dims.D)
		if inst.Dimensions != nil {
			if inst.Dimensions.WidthFormula != "" {
				if v, err := evaluatePartFormula(inst.Dimensions.WidthFormula, parentDims); err == nil {
					spaceW = float64(v)
				}
			} else if agr.WidthMm > 0 {
				spaceW = float64(agr.WidthMm)
			}
			if inst.Dimensions.HeightFormula != "" {
				if v, err := evaluatePartFormula(inst.Dimensions.HeightFormula, parentDims); err == nil {
					spaceH = float64(v)
				}
			} else if agr.HeightMm > 0 {
				spaceH = float64(agr.HeightMm)
			}
			if inst.Dimensions.DepthFormula != "" {
				if v, err := evaluatePartFormula(inst.Dimensions.DepthFormula, parentDims); err == nil {
					spaceD = float64(v)
				}
			} else if agr.DepthMm > 0 {
				spaceD = float64(agr.DepthMm)
			}
		} else {
			if agr.WidthMm > 0 {
				spaceW = float64(agr.WidthMm)
			}
			if agr.HeightMm > 0 {
				spaceH = float64(agr.HeightMm)
			}
			if agr.DepthMm > 0 {
				spaceD = float64(agr.DepthMm)
			}
		}

		units := agregadoSubspaceUnits(quantity, spaceW, spaceH, spaceD, 0, 0, 0, inst.LayoutDirection, inst.GapMm)
		// #1386: pose formulas with i/N make every unit full-size (the split
		// stays off) — mirror of resolve.go's parts expansion and the TS quote,
		// so the kit per bay matches the bay the layout draws (review slice 3).
		if formulaUsesCopyIndex(inst.Position) {
			units = make([]agregadoUnit, 0, quantity)
			for idx := 0; idx < quantity; idx++ {
				units = append(units, agregadoUnit{index: idx, w: spaceW, h: spaceH, d: spaceD})
			}
		}
		for _, unit := range units {
			params := AssemblyResolutionParams{WidthMm: unit.w, HeightMm: unit.h, DepthMm: unit.d}
			selected, err := SelectAgregadoVariants(agr, params)
			if err != nil {
				continue
			}
			kit, err := EffectiveKitHardwareID(agr, selected)
			if err != nil || kit == "" {
				continue
			}
			if agregadoBulkLinesReferenceKit(agr, optionChoices, kit) {
				continue
			}
			instanceKey := strings.TrimSpace(inst.ID)
			if instanceKey == "" {
				instanceKey = effectiveID
			}
			lines = append(lines, domain.HardwareLine{
				ID:         fmt.Sprintf("kit-agr-%s-u%d", instanceKey, unit.index),
				Quantity:   1,
				OptionRole: "COMMERCIAL_KIT",
				HardwareID: kit,
			})
		}
	}
	return lines
}

// structureAgregadosOf returns the agregado instances carried by the module's
// structure (empty when the module has no structure).
func structureAgregadosOf(module domain.Module, catalog domain.Catalog) []domain.ModuleAgregadoInstance {
	if strings.TrimSpace(module.StructureID) == "" {
		return nil
	}
	if st, ok := findStructure(catalog, module.StructureID); ok {
		return st.Agregados
	}
	return nil
}

// agregadoDeclaresVariantKit reports whether ANY variant of the recipe
// declares its own commercial kit (#1493).
func agregadoDeclaresVariantKit(agr domain.Agregado) bool {
	for _, vs := range agr.VariantSets {
		for _, v := range vs.Variants {
			if strings.TrimSpace(v.CommercialKitHardwareID) != "" {
				return true
			}
		}
	}
	return false
}

// agregadoBulkLinesReferenceKit reports whether the recipe's authored bulk
// hardware lines already resolve to the given kit (authoring wins, no
// duplicate demand).
func agregadoBulkLinesReferenceKit(agr domain.Agregado, optionChoices map[string]string, kitID string) bool {
	if kitID == "" {
		return false
	}
	for _, hl := range agr.HardwareLines {
		if resolvedBulkHardwareID(hl, optionChoices) == kitID {
			return true
		}
	}
	return false
}
