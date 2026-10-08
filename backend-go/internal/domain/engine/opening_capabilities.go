package engine

import (
	"encoding/json"
	"fmt"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// Opening capabilities parser (#1134) — decodes the factory's
// `opening.capabilities` overlay blob (library_overlays.overrides, one
// literal flat key holding the structured object, same pattern as
// `joint.constructionPolicy`). Shared with the TS domain through
// contracts/openingCapabilities.contract.json — Go and TS must never
// maintain incompatible parsers (ADR-0009 §7).
//
// Fail-closed: an unknown version has no fallback to fall through to (the
// overlay IS the decision), so it is an error; unknown grip systems, unknown
// furniture types, unknown placements, unknown keys ANYWHERE (which is what
// keeps dimensional payloads out — every millimetre belongs to the
// OpeningProfile datasheet), more than one default system, and empty grips
// all fail. Absent blob → nil, nil: no factory overlay, the library ladder
// governs — exactly like the construction policy's reading.

const openingCapabilitiesBlobKey = "opening.capabilities"

var openingGripSystemVocabulary = map[string]bool{
	domain.OpeningGripSystemHandle:         true,
	domain.OpeningGripSystemGola:           true,
	domain.OpeningGripSystemBottomOverhang: true,
}

var openingFurnitureTypeVocabulary = map[string]bool{
	"inferior": true, "superior": true, "alto": true,
}

var openingPlacementVocabulary = map[string]bool{
	"top": true, "between": true, "bottom": true,
}

// ParseOpeningCapabilities decodes the opening capabilities from an
// organization overlay's overrides JSON. nil, nil = no overlay decision.
func ParseOpeningCapabilities(overrides json.RawMessage) (*domain.OpeningCapabilities, error) {
	if len(overrides) == 0 || string(overrides) == "null" {
		return nil, nil
	}
	var raw map[string]any
	if err := json.Unmarshal(overrides, &raw); err != nil {
		return nil, fmt.Errorf("overlay overrides are not a JSON object: %w", err)
	}
	blob, present := raw[openingCapabilitiesBlobKey]
	if !present || blob == nil {
		return nil, nil
	}
	structured, ok := blob.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("%s must be an object", openingCapabilitiesBlobKey)
	}
	if version, ok := structured["version"].(float64); !ok || version != 1 {
		return nil, fmt.Errorf("%s.version must be 1 (una versión futura no se interpreta)", openingCapabilitiesBlobKey)
	}
	for key := range structured {
		if key != "version" && key != "grips" && key != "byFurnitureType" {
			return nil, fmt.Errorf("%s.%s no es una clave conocida (las dimensiones viven en el OpeningProfile)", openingCapabilitiesBlobKey, key)
		}
	}

	gripsRaw, ok := structured["grips"].(map[string]any)
	if !ok || len(gripsRaw) == 0 {
		return nil, fmt.Errorf("%s.grips debe declarar al menos un sistema", openingCapabilitiesBlobKey)
	}
	capabilities := &domain.OpeningCapabilities{
		Version: 1,
		Grips:   map[string]domain.OpeningGripCapability{},
	}
	defaults := 0
	for system, entryRaw := range gripsRaw {
		if !openingGripSystemVocabulary[system] {
			return nil, fmt.Errorf("%s.grips.%s no es un sistema de grip conocido", openingCapabilitiesBlobKey, system)
		}
		entry, ok := entryRaw.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("%s.grips.%s debe ser un objeto", openingCapabilitiesBlobKey, system)
		}
		capability := domain.OpeningGripCapability{}
		for key, value := range entry {
			switch key {
			case "enabled":
				enabled, ok := value.(bool)
				if !ok {
					return nil, fmt.Errorf("%s.grips.%s.enabled debe ser booleano", openingCapabilitiesBlobKey, system)
				}
				capability.Enabled = enabled
			case "default":
				def, ok := value.(bool)
				if !ok {
					return nil, fmt.Errorf("%s.grips.%s.default debe ser booleano", openingCapabilitiesBlobKey, system)
				}
				capability.Default = def
			case "profiles":
				if system != domain.OpeningGripSystemGola {
					return nil, fmt.Errorf("%s.grips.%s.profiles sólo aplica al sistema gola", openingCapabilitiesBlobKey, system)
				}
				list, ok := value.([]any)
				if !ok {
					return nil, fmt.Errorf("%s.grips.%s.profiles debe ser una lista", openingCapabilitiesBlobKey, system)
				}
				profiles := make([]string, 0, len(list))
				for _, item := range list {
					profileID, ok := item.(string)
					if !ok || profileID == "" {
						return nil, fmt.Errorf("%s.grips.%s.profiles exige ids exactos no vacíos", openingCapabilitiesBlobKey, system)
					}
					profiles = append(profiles, profileID)
				}
				capability.Profiles = profiles
			default:
				return nil, fmt.Errorf("%s.grips.%s.%s no es una clave conocida", openingCapabilitiesBlobKey, system, key)
			}
		}
		if capability.Default {
			defaults++
			if defaults > 1 {
				return nil, fmt.Errorf("%s declara más de un sistema por defecto", openingCapabilitiesBlobKey)
			}
		}
		capabilities.Grips[system] = capability
	}

	if byTypeRaw, present := structured["byFurnitureType"]; present && byTypeRaw != nil {
		byType, ok := byTypeRaw.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("%s.byFurnitureType debe ser un objeto", openingCapabilitiesBlobKey)
		}
		capabilities.ByFurnitureType = map[string]domain.OpeningFurnitureTypeCapabilities{}
		for furnitureType, typeRaw := range byType {
			if !openingFurnitureTypeVocabulary[furnitureType] {
				return nil, fmt.Errorf("%s.byFurnitureType.%s no es un tipo de mueble conocido", openingCapabilitiesBlobKey, furnitureType)
			}
			typeEntry, ok := typeRaw.(map[string]any)
			if !ok {
				return nil, fmt.Errorf("%s.byFurnitureType.%s debe ser un objeto", openingCapabilitiesBlobKey, furnitureType)
			}
			for key := range typeEntry {
				if key != "grips" {
					return nil, fmt.Errorf("%s.byFurnitureType.%s.%s no es una clave conocida", openingCapabilitiesBlobKey, furnitureType, key)
				}
			}
			typeCaps := domain.OpeningFurnitureTypeCapabilities{Grips: map[string]domain.OpeningFurnitureTypeGrip{}}
			gripsForType, ok := typeEntry["grips"].(map[string]any)
			if !ok {
				return nil, fmt.Errorf("%s.byFurnitureType.%s.grips debe ser un objeto", openingCapabilitiesBlobKey, furnitureType)
			}
			for system, gripRaw := range gripsForType {
				if !openingGripSystemVocabulary[system] {
					return nil, fmt.Errorf("%s.byFurnitureType.%s.grips.%s no es un sistema conocido", openingCapabilitiesBlobKey, furnitureType, system)
				}
				gripEntry, ok := gripRaw.(map[string]any)
				if !ok {
					return nil, fmt.Errorf("%s.byFurnitureType.%s.grips.%s debe ser un objeto", openingCapabilitiesBlobKey, furnitureType, system)
				}
				grip := domain.OpeningFurnitureTypeGrip{}
				for key, value := range gripEntry {
					switch key {
					case "placements":
						list, ok := value.([]any)
						if !ok || len(list) == 0 {
							return nil, fmt.Errorf("%s.byFurnitureType.%s.grips.%s.placements debe ser una lista no vacía", openingCapabilitiesBlobKey, furnitureType, system)
						}
						placements := make([]string, 0, len(list))
						for _, item := range list {
							placement, ok := item.(string)
							if !ok || !openingPlacementVocabulary[placement] {
								return nil, fmt.Errorf("%s.byFurnitureType.%s.grips.%s.placements tiene una placement desconocida", openingCapabilitiesBlobKey, furnitureType, system)
							}
							placements = append(placements, placement)
						}
						grip.Placements = placements
					case "default":
						def, ok := value.(bool)
						if !ok {
							return nil, fmt.Errorf("%s.byFurnitureType.%s.grips.%s.default debe ser booleano", openingCapabilitiesBlobKey, furnitureType, system)
						}
						grip.Default = &def
					default:
						return nil, fmt.Errorf("%s.byFurnitureType.%s.grips.%s.%s no es una clave conocida", openingCapabilitiesBlobKey, furnitureType, system, key)
					}
				}
				typeCaps.Grips[system] = grip
			}
			capabilities.ByFurnitureType[furnitureType] = typeCaps
		}
	}

	return capabilities, nil
}
