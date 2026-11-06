package domain

// Projection of grip styles onto the opening capabilities and the overhang
// rule (#1531). It replaces the overlay blobs `opening.capabilities` and
// `opening.bottom-overhang`: the SketchUp extension's capabilities read, the
// design-opening write gate and the v1 overhang resolution keep their shapes
// while their only source is now the workshop's grip styles.

import "sort"

// OpeningCapabilitiesFromGripStyles projects the offered styles:
//   - a system is enabled when an offered style uses it for some type;
//   - gola profiles are the ones the offered styles reference; the standard
//     per section comes from the default style;
//   - the default system per furniture type is the default style's mode;
//   - gola placements per type: top, plus between when a style declares it.
//
// nil = the organization has no styles (the library ladder governs).
func OpeningCapabilitiesFromGripStyles(styles []GripStyle, profiles []OpeningProfile) *OpeningCapabilities {
	if len(styles) == 0 {
		return nil
	}
	shapeByID := map[string]string{}
	for _, profile := range profiles {
		shapeByID[profile.ID] = profile.CrossSectionShape
	}
	enabled := map[string]bool{}
	golaProfiles := map[string]bool{}
	placements := map[string]map[string]bool{}
	var defaultStyle *GripStyle
	for i := range styles {
		style := styles[i]
		if style.IsDefault {
			defaultStyle = &styles[i]
		}
		if !style.Offered {
			continue
		}
		for _, ftype := range GripStyleFurnitureTypes {
			recipe, ok := style.ByFurnitureType[ftype]
			if !ok {
				continue
			}
			enabled[recipe.Mode] = true
			if recipe.Mode != GripModeGola {
				continue
			}
			golaProfiles[recipe.TopProfileID] = true
			if placements[ftype] == nil {
				placements[ftype] = map[string]bool{}
			}
			placements[ftype][GolaPositionTop] = true
			if recipe.BetweenProfileID != "" {
				golaProfiles[recipe.BetweenProfileID] = true
				placements[ftype][GolaPositionBetween] = true
			}
		}
	}

	caps := &OpeningCapabilities{
		Version:         1,
		Grips:           map[string]OpeningGripCapability{},
		ByFurnitureType: map[string]OpeningFurnitureTypeCapabilities{},
	}
	for _, system := range []string{OpeningGripSystemHandle, OpeningGripSystemGola, OpeningGripSystemBottomOverhang} {
		capability := OpeningGripCapability{Enabled: enabled[system]}
		if system == OpeningGripSystemGola && len(golaProfiles) > 0 {
			for id := range golaProfiles {
				capability.Profiles = append(capability.Profiles, id)
			}
			sort.Strings(capability.Profiles)
		}
		caps.Grips[system] = capability
	}

	if defaultStyle != nil {
		// Global default: the default style's mode for base cabinets.
		if recipe, ok := defaultStyle.ByFurnitureType["inferior"]; ok && enabled[recipe.Mode] {
			capability := caps.Grips[recipe.Mode]
			capability.Default = true
			caps.Grips[recipe.Mode] = capability
		}
		standard := map[string]string{}
		for _, ftype := range GripStyleFurnitureTypes {
			recipe, ok := defaultStyle.ByFurnitureType[ftype]
			if !ok || recipe.Mode != GripModeGola {
				continue
			}
			for _, id := range []string{recipe.TopProfileID, recipe.BetweenProfileID} {
				shape := shapeByID[id]
				if id == "" || shape == "" {
					continue
				}
				if _, taken := standard[shape]; !taken {
					standard[shape] = id
				}
			}
		}
		if len(standard) > 0 {
			gola := caps.Grips[OpeningGripSystemGola]
			gola.StandardProfiles = standard
			caps.Grips[OpeningGripSystemGola] = gola
		}
	}

	for _, ftype := range GripStyleFurnitureTypes {
		typeCaps := OpeningFurnitureTypeCapabilities{Grips: map[string]OpeningFurnitureTypeGrip{}}
		if set := placements[ftype]; len(set) > 0 {
			var list []string
			for _, position := range GolaPositions {
				if set[position] {
					list = append(list, position)
				}
			}
			typeCaps.Grips[OpeningGripSystemGola] = OpeningFurnitureTypeGrip{Placements: list}
		}
		if defaultStyle != nil {
			if recipe, ok := defaultStyle.ByFurnitureType[ftype]; ok && enabled[recipe.Mode] {
				grip := typeCaps.Grips[recipe.Mode]
				yes := true
				grip.Default = &yes
				typeCaps.Grips[recipe.Mode] = grip
			}
		}
		if len(typeCaps.Grips) > 0 {
			caps.ByFurnitureType[ftype] = typeCaps
		}
	}
	return caps
}

// OpeningOverhangRuleFromGripStyles gives the v1 bottom_overhang selections
// their millimetres (owner decision for #1531, until #1532 links each design
// to a style): the default style's overhang (wall cabinets first, then any
// type), then the first offered style with an overhang, then 20 (A4). Never
// nil: the overhang no longer waits for field evidence.
func OpeningOverhangRuleFromGripStyles(styles []GripStyle) *OpeningOverhangRule {
	order := []string{"superior", "inferior", "alto"}
	pick := func(style GripStyle) *int {
		for _, ftype := range order {
			if value := style.OverhangMmFor(ftype); value != nil {
				return value
			}
		}
		return nil
	}
	for _, style := range styles {
		if style.IsDefault {
			if value := pick(style); value != nil {
				return &OpeningOverhangRule{Version: 1, OverhangMm: *value}
			}
		}
	}
	for _, style := range styles {
		if style.Offered {
			if value := pick(style); value != nil {
				return &OpeningOverhangRule{Version: 1, OverhangMm: *value}
			}
		}
	}
	return &OpeningOverhangRule{Version: 1, OverhangMm: DefaultGripOverhangMm}
}
