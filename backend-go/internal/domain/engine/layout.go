package engine

import (
	"fmt"
	"math"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// Resolved visual furniture layout for external authoring clients (today: the
// SketchUp extension). This is the server-side mirror of the canonical TS
// resolution semantics:
//
//   - packages/domain/src/engine/bom.ts        (spatial formula expansion)
//   - packages/domain/src/spatialPlacement.ts  (default pose per placement)
//   - packages/domain/src/spatialAnchor.ts     (min-corner AABB convention)
//   - packages/domain/src/agregados.ts         (subspace unit layout)
//   - packages/domain/src/hardwarePlacement.ts (board-local face anchors)
//
// All geometry math happens here, server-side: the SketchUp adapter only
// transforms pre-baked boxes (SketchUp owns authoring/interaction; Granete
// owns resolution truth — see progress/current.md invariant).
//
// Frame convention (workshop == SketchUp): X = width (PW), Y = depth (PD),
// Z = height (PH). Board-local box is [width, thickness, length] on local
// X/Y/Z. (x,y,z) on a resolved board is the workshop MIN corner of the part
// AABB after rotation; rotations are Euler XYZ in the render frame (Three
// Y-up: render X = workshop X, render Y = workshop Z, render Z = workshop Y),
// exactly like the web 3D preview.

// LayoutDims is the W/H/D override for a layout resolution (mm).
type LayoutDims struct {
	WidthMm  int
	HeightMm int
	DepthMm  int
}

// LayoutTransform positions a layout element in workshop millimeters.
type LayoutTransform struct {
	TranslationMm [3]float64 `json:"translationMm"`
}

// LayoutComponent is one resolved board rendered as an axis-aligned box.
// TranslationMm is the AABB min corner in workshop space; DimensionsMm is the
// rotated AABB size (exact for the standard 90° placement rotations).
// Material fields carry the workshop's chosen board when an option choice
// resolved it; otherwise the role-palette fallback color is used.
type LayoutComponent struct {
	ComponentInstanceID        string          `json:"componentInstanceId"`
	SlotID                     string          `json:"slotId"`
	Role                       string          `json:"role,omitempty"`
	Name                       string          `json:"name"`
	Kind                       string          `json:"kind"`
	Transform                  LayoutTransform `json:"transform"`
	DimensionsMm               [3]float64      `json:"dimensionsMm"`
	LengthMm                   int             `json:"lengthMm"`
	WidthMm                    int             `json:"widthMm"`
	ThicknessMm                int             `json:"thicknessMm"`
	OptionRole                 string          `json:"optionRole,omitempty"`
	MaterialID                 string          `json:"materialId,omitempty"`
	MaterialCode               string          `json:"materialCode,omitempty"`
	MaterialName               string          `json:"materialName,omitempty"`
	MaterialColorHex           string          `json:"materialColorHex,omitempty"`
	MaterialImageURL           string          `json:"materialImageUrl,omitempty"`
	MaterialTextureURL         string          `json:"materialTextureUrl,omitempty"`
	MaterialTextureTileWidthMm float64         `json:"materialTextureTileWidthMm,omitempty"`
	MaterialTextureTileLengthMm float64        `json:"materialTextureTileLengthMm,omitempty"`
	MaterialRoughness          *float64        `json:"materialRoughness,omitempty"`
	MaterialMetalness          *float64        `json:"materialMetalness,omitempty"`
	MaterialClearcoat          *float64        `json:"materialClearcoat,omitempty"`
	MaterialGrain              bool            `json:"materialGrain,omitempty"`
}

// LayoutHardware is one visible hardware placement (handle, hinge, …) resolved
// to a world-space box anchored on its host board face.
type LayoutHardware struct {
	PlacementID            string          `json:"placementId"`
	HardwareID             string          `json:"hardwareId"`
	Name                   string          `json:"name"`
	Shape                  string          `json:"shape"`
	SizeMm                 float64         `json:"sizeMm,omitempty"`
	DiameterMm             float64         `json:"diameterMm,omitempty"`
	ProjectionMm           float64         `json:"projectionMm"`
	ColorHex               string          `json:"colorHex,omitempty"`
	HostComponentInstanceID string         `json:"hostComponentInstanceId"`
	AnchorFace             string          `json:"anchorFace"`
	Transform              LayoutTransform `json:"transform"`
	DimensionsMm           [3]float64      `json:"dimensionsMm"`
}

// FurnitureLayout is the full resolved layout of one furniture definition at
// concrete dimensions.
type FurnitureLayout struct {
	FurnitureDefinitionID string             `json:"furnitureDefinitionId"`
	DefinitionName        string             `json:"definitionName"`
	DimensionsMm          [3]int             `json:"dimensionsMm"`
	Components            []LayoutComponent  `json:"components"`
	Hardware              []LayoutHardware   `json:"hardware"`
}

// layoutBoard is the intermediate resolved board before AABB projection.
type layoutBoard struct {
	id          string
	name        string
	placement   string
	optionRole  string
	x, y, z     float64 // workshop min corner of the AABB
	rotX, rotY  float64
	rotZ        float64
	widthMm     float64 // local X
	thicknessMm float64 // local Y
	lengthMm    float64 // local Z
	hardware    []domain.HardwarePlacement
}

// ResolveFurnitureLayout resolves a module's full visual composition — every
// board component of its structure, module-level instances and agregados, plus
// visible hardware placements — at the given dimensions. dimsOverride wins
// over the module's own external dimensions (the SketchUp dialog edits
// widthMm/heightMm/depthMm freely). optionChoices maps option group code
// (== component optionRole) to a material id — the same shape the React app
// stores on project items — and resolves real boards (id/code/name/color) per
// component. A provided choice pointing at an unknown or inactive material
// fails loudly; a role without a choice keeps the role-palette fallback color.
func ResolveFurnitureLayout(module domain.Module, catalog domain.Catalog, dimsOverride *LayoutDims, optionChoices map[string]string) (FurnitureLayout, error) {
	if err := ValidateModule(module); err != nil {
		return FurnitureLayout{}, err
	}

	dims := LayoutDims{WidthMm: module.WidthMm, HeightMm: module.HeightMm, DepthMm: module.DepthMm}
	if dimsOverride != nil {
		dims = *dimsOverride
	}
	if dims.WidthMm <= 0 || dims.HeightMm <= 0 || dims.DepthMm <= 0 {
		return FurnitureLayout{}, fmt.Errorf(
			"el mueble %q (%s) no tiene medidas válidas para resolver el layout",
			module.Name, module.Code,
		)
	}

	layout := FurnitureLayout{
		FurnitureDefinitionID: module.ID,
		DefinitionName:        module.Name,
		DimensionsMm:          [3]int{dims.WidthMm, dims.HeightMm, dims.DepthMm},
		Components:            []LayoutComponent{},
		Hardware:              []LayoutHardware{},
	}

	boards, err := resolveLayoutBoards(module, catalog, dims, optionChoices)
	if err != nil {
		return FurnitureLayout{}, err
	}

	for i := range boards {
		board := &boards[i]
		min, size := boardAABBWorkshop(board)

		component := LayoutComponent{
			ComponentInstanceID: board.id,
			SlotID:              board.placement,
			Role:                board.optionRole,
			Name:                board.name,
			Kind:                "board",
			Transform:           LayoutTransform{TranslationMm: min},
			DimensionsMm:        size,
			LengthMm:            int(math.Round(board.lengthMm)),
			WidthMm:             int(math.Round(board.widthMm)),
			ThicknessMm:         int(math.Round(board.thicknessMm)),
			OptionRole:          board.optionRole,
			MaterialColorHex:    colorForOptionRole(board.optionRole),
		}
		if material, err := resolveSelectedBoard(board.optionRole, optionChoices, catalog.Materials); err != nil {
			return FurnitureLayout{}, err
		} else if material != nil {
			component.MaterialID = material.ID
			component.MaterialCode = material.Code
			component.MaterialName = material.Name
			component.MaterialImageURL = material.ImageURL
			component.MaterialTextureURL = material.PreviewTextureURL
			component.MaterialTextureTileWidthMm = material.PreviewTextureTileWidthMm
			component.MaterialTextureTileLengthMm = material.PreviewTextureTileLengthMm
			component.MaterialRoughness = material.PreviewRoughness
			component.MaterialMetalness = material.PreviewMetalness
			component.MaterialClearcoat = material.PreviewClearcoat
			component.MaterialGrain = material.GrainDefault
			if color := normalizeHexColor(material.PreviewColor); color != "" {
				component.MaterialColorHex = color
			}
		}
		layout.Components = append(layout.Components, component)

		for hi, hp := range board.hardware {
			resolved, ok := resolveHardwareToWorld(board, hp, catalog, fmt.Sprintf("%s-hw-%d", board.id, hi))
			if !ok {
				continue // cost-only hardware (no valid preview shape) renders nothing
			}
			layout.Hardware = append(layout.Hardware, resolved)
		}
	}
	return layout, nil
}

// resolveLayoutBoards walks structure + module + agregado component instances
// (mirrors TS resolveComposedModule) and returns the resolved boards.
func resolveLayoutBoards(module domain.Module, catalog domain.Catalog, dims LayoutDims, optionChoices map[string]string) ([]layoutBoard, error) {
	if strings.TrimSpace(module.StructureID) == "" {
		return legacyBoardStack(module, optionChoices, catalog.Materials)
	}

	structure, ok := findStructure(catalog, module.StructureID)
	if !ok {
		return nil, fmt.Errorf("structure not found: %s", module.StructureID)
	}

	baseMode := module.BaseMode
	if strings.TrimSpace(baseMode) == "" {
		baseMode = "none"
	}
	b := baseClearanceForLayout(module, baseMode)

	boards := []layoutBoard{}

	structureInstances := filterInstancesForBaseMode(structure.Components, catalog, baseMode)
	structureBoards, err := expandLayoutInstances(structureInstances, catalog, dims, "st-", b, optionChoices)
	if err != nil {
		return nil, err
	}
	boards = append(boards, structureBoards...)

	moduleInstances := filterInstancesForBaseMode(module.Components, catalog, baseMode)
	moduleBoards, err := expandLayoutInstances(moduleInstances, catalog, dims, "mod-", b, optionChoices)
	if err != nil {
		return nil, err
	}
	boards = append(boards, moduleBoards...)

	agregadoInstances := append(append([]domain.ModuleAgregadoInstance{}, structure.Agregados...), module.Agregados...)
	for _, agrInst := range agregadoInstances {
		agrBoards, err := expandLayoutAgregado(agrInst, catalog, dims, b, optionChoices)
		if err != nil {
			return nil, err
		}
		boards = append(boards, agrBoards...)
	}
	return boards, nil
}

// legacyBoardStack handles pre-composition modules (flat BoardParts without
// spatial data). Pieces have no authored position, so they are stacked
// bottom-up by index — completeness over prettiness; real furniture today is
// composed via structures. The 18 mm stacking thickness is the explicit legacy
// fallback (contract §15) used ONLY when the part's role has no selected
// material; a selected board drives the real effective thickness (#402).
func legacyBoardStack(module domain.Module, optionChoices map[string]string, materials []domain.MaterialBoard) ([]layoutBoard, error) {
	boards := []layoutBoard{}
	for i, part := range module.BoardParts {
		thicknessMm, err := effectiveThicknessMm(part.OptionRole, 18, optionChoices, materials)
		if err != nil {
			return nil, err
		}
		thickness := float64(thicknessMm)
		boards = append(boards, layoutBoard{
			id:          fmt.Sprintf("legacy-%s-%d", module.ID, i),
			name:        part.Description,
			placement:   "custom",
			optionRole:  part.OptionRole,
			x:           0,
			y:           0,
			z:           float64(i) * thickness,
			widthMm:     float64(part.WidthMm),
			thicknessMm: thickness,
			lengthMm:    float64(part.LengthMm),
		})
	}
	return boards, nil
}

// baseClearanceForLayout mirrors TS resolveBaseClearanceWithContext without a
// quote-line context: none → 0; module value; else the 100 mm default.
func baseClearanceForLayout(module domain.Module, baseMode string) int {
	if baseMode == "none" {
		return 0
	}
	if module.BaseClearanceMm != nil && *module.BaseClearanceMm > 0 {
		return *module.BaseClearanceMm
	}
	return 100
}

// filterInstancesForBaseMode mirrors TS filterComponentInstancesForBaseMode:
// ZOCLO board parts only exist in plinth_board mode.
func filterInstancesForBaseMode(instances []domain.ComponentInstance, catalog domain.Catalog, baseMode string) []domain.ComponentInstance {
	filtered := make([]domain.ComponentInstance, 0, len(instances))
	for _, inst := range instances {
		comp, ok := findComponent(catalog, inst.ComponentID)
		if ok && len(comp.OptionRoles) > 0 && strings.TrimSpace(comp.OptionRoles[0]) == "ZOCLO" && baseMode != "plinth_board" {
			continue
		}
		filtered = append(filtered, inst)
	}
	return filtered
}

// expandLayoutInstances resolves component instances into positioned boards
// (mirrors TS expandComponentInstances in engine/bom.ts, spatial branch).
func expandLayoutInstances(
	instances []domain.ComponentInstance,
	catalog domain.Catalog,
	dims LayoutDims,
	idPrefix string,
	baseClearance int,
	optionChoices map[string]string,
) ([]layoutBoard, error) {
	boards := []layoutBoard{}
	for _, inst := range instances {
		comp, ok := findComponent(catalog, inst.ComponentID)
		if !ok {
			return nil, fmt.Errorf("component not found: %s", inst.ComponentID)
		}
		if inst.Quantity <= 0 {
			return nil, fmt.Errorf("component instance quantity must be > 0 for %s", inst.ComponentID)
		}

		// #403 / MT-2: single canonical binding role — multiple distinct
		// roles are ambiguous and fail loudly instead of silently honoring
		// only the first (material_role.go, mirrored from TS).
		optionRole, err := materialBindingRole(comp)
		if err != nil {
			return nil, err
		}

		// #402 / MT-1: resolve the selected board BEFORE geometry — the
		// effective thickness drives formulas, pose, board size, AABB and
		// hardware anchors. Same canonical rule as the BOM resolver
		// (effective_thickness.go); never the nominal thickness when a
		// material is selected.
		effectiveT, err := effectiveThicknessMm(optionRole, comp.ThicknessMm, optionChoices, catalog.Materials)
		if err != nil {
			return nil, fmt.Errorf("component %s: %w", comp.Code, err)
		}
		t := float64(effectiveT)

		// Geometry formulas evaluate against the parent furniture dims.
		geomDims := formulaDims{
			W: dims.WidthMm, H: dims.HeightMm, D: dims.DepthMm,
			PW: dims.WidthMm, PH: dims.HeightMm, PD: dims.DepthMm,
			T: effectiveT, B: baseClearance,
		}
		lengthMm := float64(comp.LengthMm)
		widthMm := float64(comp.WidthMm)
		lengthFormula := comp.LengthFormula
		widthFormula := comp.WidthFormula
		if inst.Overrides != nil {
			if inst.Overrides.LengthFormula != "" {
				lengthFormula = inst.Overrides.LengthFormula
			}
			if inst.Overrides.WidthFormula != "" {
				widthFormula = inst.Overrides.WidthFormula
			}
		}
		if lengthFormula != "" {
			v, err := evaluatePartFormula(lengthFormula, geomDims)
			if err != nil {
				return nil, fmt.Errorf("component %s length formula: %w", comp.Code, err)
			}
			lengthMm = float64(v)
		}
		if widthFormula != "" {
			v, err := evaluatePartFormula(widthFormula, geomDims)
			if err != nil {
				return nil, fmt.Errorf("component %s width formula: %w", comp.Code, err)
			}
			widthMm = float64(v)
		}

		xFormula := comp.XFormula
		yFormula := comp.YFormula
		zFormula := comp.ZFormula
		if inst.Overrides != nil {
			if inst.Overrides.XFormula != "" {
				xFormula = inst.Overrides.XFormula
			}
			if inst.Overrides.YFormula != "" {
				yFormula = inst.Overrides.YFormula
			}
			if inst.Overrides.ZFormula != "" {
				zFormula = inst.Overrides.ZFormula
			}
		}

		placement := string(comp.Placement)
		if inst.PlacementOverride != nil && strings.TrimSpace(string(*inst.PlacementOverride)) != "" {
			placement = strings.TrimSpace(string(*inst.PlacementOverride))
		}
		if placement == "" {
			placement = "custom"
		}

		for i := 0; i < inst.Quantity; i++ {
			// Spatial formulas: H = thickness (bom.ts), i = copy index.
			// H/T carry the effective thickness (#402), like the TS spatial branch.
			spatialDims := formulaDims{
				W: int(math.Round(widthMm)), H: effectiveT, D: int(math.Round(lengthMm)),
				PW: dims.WidthMm, PH: dims.HeightMm, PD: dims.DepthMm,
				T: effectiveT, B: baseClearance, I: i,
			}
			pose := defaultPoseForPlacement(placement, float64(dims.WidthMm), float64(dims.HeightMm), float64(dims.DepthMm), t, i, inst.Quantity)

			x, y, z := pose.x, pose.y, pose.z
			if xFormula != "" {
				v, err := evaluatePartFormula(xFormula, spatialDims)
				if err != nil {
					return nil, fmt.Errorf("component %s x formula: %w", comp.Code, err)
				}
				x = float64(v)
			}
			if yFormula != "" {
				v, err := evaluatePartFormula(yFormula, spatialDims)
				if err != nil {
					return nil, fmt.Errorf("component %s y formula: %w", comp.Code, err)
				}
				y = float64(v)
			}
			if zFormula != "" {
				v, err := evaluatePartFormula(zFormula, spatialDims)
				if err != nil {
					return nil, fmt.Errorf("component %s z formula: %w", comp.Code, err)
				}
				z = float64(v)
			}

			rotX := pickRotation(comp.RotateX, inst, placement, pose.rotateX, 0)
			rotY := pickRotation(comp.RotateY, inst, placement, pose.rotateY, 1)
			rotZ := pickRotation(comp.RotateZ, inst, placement, pose.rotateZ, 2)

			board := layoutBoard{
				id:          fmt.Sprintf("%s%s-copy-%d", idPrefix, comp.ID, i),
				name:        comp.Name,
				placement:   placement,
				optionRole:  optionRole,
				x:           x,
				y:           y,
				z:           z,
				rotX:        rotX,
				rotY:        rotY,
				rotZ:        rotZ,
				widthMm:     widthMm,
				thicknessMm: t,
				lengthMm:    lengthMm,
			}
			if inst.Overrides != nil {
				board.hardware = inst.Overrides.HardwarePlacements
			}
			boards = append(boards, board)
		}
	}
	return boards, nil
}

// pickRotation mirrors the TS precedence: instance override (any value incl.
// 0) > component value when placement is custom or non-zero > placement pose.
func pickRotation(compValue int, inst domain.ComponentInstance, placement string, poseValue float64, axis int) float64 {
	if inst.Overrides != nil {
		var override *int
		switch axis {
		case 0:
			override = inst.Overrides.RotateX
		case 1:
			override = inst.Overrides.RotateY
		case 2:
			override = inst.Overrides.RotateZ
		}
		if override != nil {
			return float64(*override)
		}
	}
	if placement == "custom" || compValue != 0 {
		return float64(compValue)
	}
	return poseValue
}

// expandLayoutAgregado mirrors the TS agregado expansion: evaluate the
// sub-space box + origin, split it into units, expand inner components against
// each unit's dims and offset by the unit origin. Inner components resolve
// their own material binding role — an agregado never leaks a hardcoded
// thickness into its children (#402).
func expandLayoutAgregado(agrInst domain.ModuleAgregadoInstance, catalog domain.Catalog, dims LayoutDims, baseClearance int, optionChoices map[string]string) ([]layoutBoard, error) {
	agr, ok := findAgregado(catalog, agrInst.AgregadoID)
	if !ok {
		return nil, fmt.Errorf("agregado not found: %s", agrInst.AgregadoID)
	}

	// T here is the sub-space box's own context, not a board piece: the
	// agregado box has no material binding of its own, so the 18 mm fallback is
	// the explicit legacy fallback the contract allows (TS resolveComposedModule
	// keeps the same parentDims T: 18). Piece-level T is resolved per inner
	// component inside expandLayoutInstances.
	parentDims := formulaDims{
		W: dims.WidthMm, H: dims.HeightMm, D: dims.DepthMm,
		PW: dims.WidthMm, PH: dims.HeightMm, PD: dims.DepthMm,
		T: 18, B: baseClearance,
	}

	spaceW := float64(dims.WidthMm)
	spaceH := float64(dims.HeightMm)
	spaceD := float64(dims.DepthMm)
	if agrInst.Dimensions != nil {
		if agrInst.Dimensions.WidthFormula != "" {
			if v, err := evaluatePartFormula(agrInst.Dimensions.WidthFormula, parentDims); err == nil {
				spaceW = float64(v)
			}
		} else if agr.WidthMm > 0 {
			spaceW = float64(agr.WidthMm)
		}
		if agrInst.Dimensions.HeightFormula != "" {
			if v, err := evaluatePartFormula(agrInst.Dimensions.HeightFormula, parentDims); err == nil {
				spaceH = float64(v)
			}
		} else if agr.HeightMm > 0 {
			spaceH = float64(agr.HeightMm)
		}
		if agrInst.Dimensions.DepthFormula != "" {
			if v, err := evaluatePartFormula(agrInst.Dimensions.DepthFormula, parentDims); err == nil {
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

	spaceX, spaceY, spaceZ := 0.0, 0.0, 0.0
	if agrInst.Position != nil {
		if agrInst.Position.XFormula != "" {
			if v, err := evaluatePartFormula(agrInst.Position.XFormula, parentDims); err == nil {
				spaceX = float64(v)
			}
		}
		if agrInst.Position.YFormula != "" {
			if v, err := evaluatePartFormula(agrInst.Position.YFormula, parentDims); err == nil {
				spaceY = float64(v)
			}
		}
		if agrInst.Position.ZFormula != "" {
			if v, err := evaluatePartFormula(agrInst.Position.ZFormula, parentDims); err == nil {
				spaceZ = float64(v)
			}
		}
	}

	quantity := agrInst.Quantity
	if quantity <= 0 {
		quantity = 1
	}
	units := agregadoSubspaceUnits(quantity, spaceW, spaceH, spaceD, spaceX, spaceY, spaceZ, agrInst.LayoutDirection, agrInst.GapMm)

	boards := []layoutBoard{}
	for _, unit := range units {
		unitDims := LayoutDims{
			WidthMm:  int(math.Round(unit.w)),
			HeightMm: int(math.Round(unit.h)),
			DepthMm:  int(math.Round(unit.d)),
		}
		unitBoards, err := expandLayoutInstances(agr.Components, catalog, unitDims, fmt.Sprintf("agr-%s-u%d-", agrInst.AgregadoID, unit.index), baseClearance, optionChoices)
		if err != nil {
			return nil, err
		}
		for i := range unitBoards {
			unitBoards[i].x += unit.x
			unitBoards[i].y += unit.y
			unitBoards[i].z += unit.z
		}
		boards = append(boards, unitBoards...)
	}
	return boards, nil
}

type agregadoUnit struct {
	index          int
	x, y, z, w, h, d float64
}

// agregadoSubspaceUnits mirrors TS calculateAgregadoSubspaceUnits.
func agregadoSubspaceUnits(quantity int, w, h, d, x, y, z float64, direction string, gapMm float64) []agregadoUnit {
	n := quantity
	if n < 1 {
		n = 1
	}
	gap := math.Max(0, gapMm)
	units := make([]agregadoUnit, 0, n)

	if direction == "vertical" && n > 1 {
		availableH := math.Max(1, h-(float64(n-1)*gap))
		unitH := availableH / float64(n)
		for i := 0; i < n; i++ {
			units = append(units, agregadoUnit{i, x, y, z + float64(i)*(unitH+gap), w, unitH, d})
		}
		return units
	}
	if direction == "horizontal" && n > 1 {
		availableW := math.Max(1, w-(float64(n-1)*gap))
		unitW := availableW / float64(n)
		for i := 0; i < n; i++ {
			units = append(units, agregadoUnit{i, x + float64(i)*(unitW+gap), y, z, unitW, h, d})
		}
		return units
	}
	for i := 0; i < n; i++ {
		units = append(units, agregadoUnit{i, x, y, z, w, h, d})
	}
	return units
}

// spatialPose is the default pose for a component copy (TS SpatialPose).
type spatialPose struct {
	x, y, z                      float64
	rotateX, rotateY, rotateZ    float64
}

// defaultPoseForPlacement mirrors TS spatialPlacement.ts defaultPoseForPlacement.
func defaultPoseForPlacement(placement string, pw, ph, pd, t float64, i, quantity int) spatialPose {
	zero := spatialPose{}
	switch placement {
	case "base":
		return spatialPose{x: t, y: 0, z: 0, rotateY: 90}
	case "superior":
		return spatialPose{x: t, y: 0, z: math.Max(0, ph-t), rotateY: 90}
	case "lateral_izquierdo":
		x := 0.0
		if quantity > 1 {
			x = float64(i) * math.Max(0, pw-t)
		}
		return spatialPose{x: x, rotateX: 90, rotateY: 180, rotateZ: 90}
	case "lateral_derecho":
		span := math.Max(0, pw-t)
		x := span
		if quantity > 1 {
			x = span - float64(i)*span
		}
		return spatialPose{x: x, rotateX: 90, rotateY: 180, rotateZ: 90}
	case "trasera":
		return spatialPose{x: t, y: 0, z: t, rotateX: 90, rotateY: 180}
	case "frontal":
		return spatialPose{x: t, y: math.Max(0, pd-t), z: t, rotateX: 90, rotateY: 180}
	case "puerta", "frente_cajon":
		return spatialPose{x: 2, y: pd, z: 2, rotateX: 90, rotateY: 180}
	case "interno":
		return spatialPose{x: t, y: t, z: 150 + float64(i)*200}
	default: // custom
		return zero
	}
}

// eulerXyzMatrix mirrors TS spatialAnchor.ts eulerXyzMatrix: row-major,
// right-handed, active, composed Rx*Ry*Rz (Three 'XYZ' order).
func eulerXyzMatrix(rx, ry, rz float64) [9]float64 {
	x := rx * math.Pi / 180
	y := ry * math.Pi / 180
	z := rz * math.Pi / 180
	cx, sx := math.Cos(x), math.Sin(x)
	cy, sy := math.Cos(y), math.Sin(y)
	cz, sz := math.Cos(z), math.Sin(z)

	rxM := [9]float64{1, 0, 0, 0, cx, -sx, 0, sx, cx}
	ryM := [9]float64{cy, 0, sy, 0, 1, 0, -sy, 0, cy}
	rzM := [9]float64{cz, -sz, 0, sz, cz, 0, 0, 0, 1}
	return mulMat3(rxM, mulMat3(ryM, rzM))
}

func mulMat3(a, b [9]float64) [9]float64 {
	var c [9]float64
	for r := 0; r < 3; r++ {
		for col := 0; col < 3; col++ {
			c[r*3+col] = a[r*3]*b[col] + a[r*3+1]*b[3+col] + a[r*3+2]*b[6+col]
		}
	}
	return c
}

func mulMatVec3(m [9]float64, v [3]float64) [3]float64 {
	return [3]float64{
		m[0]*v[0] + m[1]*v[1] + m[2]*v[2],
		m[3]*v[0] + m[4]*v[1] + m[5]*v[2],
		m[6]*v[0] + m[7]*v[1] + m[8]*v[2],
	}
}

// boardAABBWorkshop returns the workshop-frame AABB (min corner + size) of a
// rotated board whose (x,y,z) is the workshop min corner of the AABB.
//
// The board local box is [width, thickness, length] on local X/Y/Z, and the
// rotation Euler is authored in the render frame (Y-up). The rotated corners
// are therefore computed in the render frame and mapped back to workshop
// coordinates (swap Y/Z), which keeps the convention identical to the web 3D
// preview.
func boardAABBWorkshop(board *layoutBoard) (min [3]float64, size [3]float64) {
	m := eulerXyzMatrix(board.rotX, board.rotY, board.rotZ)

	minR := [3]float64{math.Inf(1), math.Inf(1), math.Inf(1)}
	maxR := [3]float64{math.Inf(-1), math.Inf(-1), math.Inf(-1)}
	for _, aw := range [2]float64{0, board.widthMm} {
		for _, at := range [2]float64{0, board.thicknessMm} {
			for _, al := range [2]float64{0, board.lengthMm} {
				p := mulMatVec3(m, [3]float64{aw, at, al})
				for k := 0; k < 3; k++ {
					if p[k] < minR[k] {
						minR[k] = p[k]
					}
					if p[k] > maxR[k] {
						maxR[k] = p[k]
					}
				}
			}
		}
	}

	// Render AABB size (X, Y, Z) → workshop (X, Z, Y): the render group sits at
	// (x − ox, z − oy, y − oz), so the workshop min corner is (x, y, z) by
	// construction (spatialAnchor.ts groupPositionFromMinCorner).
	sizeR := [3]float64{maxR[0] - minR[0], maxR[1] - minR[1], maxR[2] - minR[2]}
	min = [3]float64{board.x, board.y, board.z}
	size = [3]float64{snapMm(sizeR[0]), snapMm(sizeR[2]), snapMm(sizeR[1])}
	return min, size
}

// snapMm kills trig noise from 90° rotations (18.00000000000012 → 18) the
// same way spatialAnchor.ts snaps near-zero offsets.
func snapMm(v float64) float64 {
	return math.Round(v*1e6) / 1e6
}

// Default hardware visual constants (TS hardwarePlacement.ts parity).
const (
	defaultHardwareSizeMm       = 96
	defaultHardwareDiameterMm   = 32
	defaultHardwareProjectionMm = 25
)

var validHardwarePreviewShapes = map[string]bool{
	"knob": true, "bar-pull": true, "cup-pull": true, "hinge": true,
	"slide": true, "rail": true, "leg": true,
}

// resolveHardwareToWorld resolves one hardware placement from board-local face
// coordinates to a world-space box. Returns ok=false for cost-only hardware
// (no valid preview shape) — mirrors TS resolveHardwarePlacement.
func resolveHardwareToWorld(board *layoutBoard, hp domain.HardwarePlacement, catalog domain.Catalog, placementID string) (LayoutHardware, bool) {
	hw, ok := findHardware(catalog, hp.HardwareID)
	if !ok || !hw.Active {
		return LayoutHardware{}, false
	}
	shape := ""
	if hw.PreviewShape != nil && validHardwarePreviewShapes[*hw.PreviewShape] {
		shape = *hw.PreviewShape
	}
	if shape == "" {
		return LayoutHardware{}, false
	}

	w := math.Max(board.widthMm, 0)
	t := math.Max(board.thicknessMm, 0)
	l := math.Max(board.lengthMm, 0)

	size := positivePtrOr(hw.PreviewSizeMm, defaultHardwareSizeMm)
	diameter := positivePtrOr(hw.PreviewDiameterMm, defaultHardwareDiameterMm)
	projection := positivePtrOr(hw.PreviewProjectionMm, defaultHardwareProjectionMm)

	// Face-plane offsets (mm or formula; formulas see the board env, TS parity).
	boardEnv := formulaDims{
		W: int(math.Round(w)), H: int(math.Round(l)), D: int(math.Round(l)),
		PW: int(math.Round(w)), PH: int(math.Round(l)), PD: int(math.Round(l)),
		T: int(math.Round(t)), HW: int(math.Round(size)),
	}
	xMm := hp.RelativePosition.XMm
	if hp.RelativePosition.XFormula != "" {
		if v, err := evaluatePartFormula(hp.RelativePosition.XFormula, boardEnv); err == nil {
			xMm = float64(v)
		}
	}
	yMm := hp.RelativePosition.YMm
	if hp.RelativePosition.YFormula != "" {
		if v, err := evaluatePartFormula(hp.RelativePosition.YFormula, boardEnv); err == nil {
			yMm = float64(v)
		}
	}

	var local [3]float64
	var normal [3]float64
	switch hp.AnchorFace {
	case "front":
		local = [3]float64{clampMm(xMm, w), t, clampMm(yMm, l)}
		normal = [3]float64{0, 1, 0}
	case "back":
		local = [3]float64{clampMm(xMm, w), 0, clampMm(yMm, l)}
		normal = [3]float64{0, -1, 0}
	case "left":
		local = [3]float64{0, clampMm(xMm, t), clampMm(yMm, l)}
		normal = [3]float64{-1, 0, 0}
	case "right":
		local = [3]float64{w, clampMm(xMm, t), clampMm(yMm, l)}
		normal = [3]float64{1, 0, 0}
	case "top":
		local = [3]float64{clampMm(xMm, w), clampMm(yMm, t), l}
		normal = [3]float64{0, 0, 1}
	case "bottom":
		local = [3]float64{clampMm(xMm, w), clampMm(yMm, t), 0}
		normal = [3]float64{0, 0, -1}
	default:
		return LayoutHardware{}, false
	}

	// Board-local → world: rotate by the board Euler in the render frame, add
	// the group position, then map render → workshop (swap Y/Z).
	m := eulerXyzMatrix(board.rotX, board.rotY, board.rotZ)
	renderOffset := mulMatVec3(m, local)
	// Group render position (spatialAnchor.ts): (x − ox, z − oy, y − oz).
	aabbMinR, aabbSizeR := boardAABBRender(board)
	group := [3]float64{board.x - aabbMinR[0], board.z - aabbMinR[1], board.y - aabbMinR[2]}
	_ = aabbSizeR

	faceRender := [3]float64{
		group[0] + renderOffset[0],
		group[1] + renderOffset[1],
		group[2] + renderOffset[2],
	}
	normalRender := mulMatVec3(m, normal)

	// Box in-plane extents by shape (knob: square; pulls: bar along size).
	extentU := size
	extentV := diameter
	if shape == "knob" {
		extentU = diameter
		extentV = diameter
	}

	// In-plane basis in the render frame: two vectors orthogonal to the normal.
	u := orthogonalVector(normalRender)
	v := cross3(normalRender, u)

	centerRender := [3]float64{
		faceRender[0] + normalRender[0]*projection/2,
		faceRender[1] + normalRender[1]*projection/2,
		faceRender[2] + normalRender[2]*projection/2,
	}

	// AABB of the oriented box (8 corners in render space) → workshop.
	minR := [3]float64{math.Inf(1), math.Inf(1), math.Inf(1)}
	maxR := [3]float64{math.Inf(-1), math.Inf(-1), math.Inf(-1)}
	hu, hv, hn := extentU/2, extentV/2, projection/2
	for _, su := range [2]float64{-hu, hu} {
		for _, sv := range [2]float64{-hv, hv} {
			for _, sn := range [2]float64{-hn, hn} {
				p := [3]float64{
					centerRender[0] + u[0]*su + v[0]*sv + normalRender[0]*sn,
					centerRender[1] + u[1]*su + v[1]*sv + normalRender[1]*sn,
					centerRender[2] + u[2]*su + v[2]*sv + normalRender[2]*sn,
				}
				for k := 0; k < 3; k++ {
					if p[k] < minR[k] {
						minR[k] = p[k]
					}
					if p[k] > maxR[k] {
						maxR[k] = p[k]
					}
				}
			}
		}
	}

	boxMin := [3]float64{snapMm(minR[0]), snapMm(minR[2]), snapMm(minR[1])} // render → workshop (swap Y/Z)
	boxMax := [3]float64{snapMm(maxR[0]), snapMm(maxR[2]), snapMm(maxR[1])}
	dims := [3]float64{boxMax[0] - boxMin[0], boxMax[1] - boxMin[1], boxMax[2] - boxMin[2]}
	for k := 0; k < 3; k++ {
		if dims[k] < 1 {
			dims[k] = 1
		}
	}

	color := "#9aa0a6"
	if hw.PreviewColor != nil && *hw.PreviewColor != "" {
		color = normalizeHexColor(*hw.PreviewColor)
	}

	return LayoutHardware{
		PlacementID:            placementID,
		HardwareID:             hw.ID,
		Name:                   hw.Name,
		Shape:                  shape,
		SizeMm:                 size,
		DiameterMm:             diameter,
		ProjectionMm:           projection,
		ColorHex:               color,
		HostComponentInstanceID: board.id,
		AnchorFace:             hp.AnchorFace,
		Transform:              LayoutTransform{TranslationMm: boxMin},
		DimensionsMm:           dims,
	}, true
}

// boardAABBRender returns the render-frame min corner and size of the rotated
// local box when the local origin sits at the render origin.
func boardAABBRender(board *layoutBoard) (min [3]float64, size [3]float64) {
	m := eulerXyzMatrix(board.rotX, board.rotY, board.rotZ)
	min = [3]float64{math.Inf(1), math.Inf(1), math.Inf(1)}
	max := [3]float64{math.Inf(-1), math.Inf(-1), math.Inf(-1)}
	for _, aw := range [2]float64{0, board.widthMm} {
		for _, at := range [2]float64{0, board.thicknessMm} {
			for _, al := range [2]float64{0, board.lengthMm} {
				p := mulMatVec3(m, [3]float64{aw, at, al})
				for k := 0; k < 3; k++ {
					if p[k] < min[k] {
						min[k] = p[k]
					}
					if p[k] > max[k] {
						max[k] = p[k]
					}
				}
			}
		}
	}
	return min, [3]float64{max[0] - min[0], max[1] - min[1], max[2] - min[2]}
}

func orthogonalVector(n [3]float64) [3]float64 {
	ref := [3]float64{0, 0, 1}
	if math.Abs(n[2]) > 0.9 {
		ref = [3]float64{1, 0, 0}
	}
	return normalize3(cross3(n, ref))
}

func cross3(a, b [3]float64) [3]float64 {
	return [3]float64{a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]}
}

func normalize3(v [3]float64) [3]float64 {
	n := math.Sqrt(v[0]*v[0] + v[1]*v[1] + v[2]*v[2])
	if n < 1e-9 {
		return [3]float64{0, 0, 0}
	}
	return [3]float64{v[0] / n, v[1] / n, v[2] / n}
}

func positiveOr(v float64, fallback float64) float64 {
	if v > 0 && !math.IsNaN(v) && !math.IsInf(v, 0) {
		return v
	}
	return fallback
}

func positivePtrOr(v *float64, fallback float64) float64 {
	if v == nil {
		return fallback
	}
	return positiveOr(*v, fallback)
}

func clampMm(v, max float64) float64 {
	if math.IsNaN(v) {
		return 0
	}
	if v < 0 {
		return 0
	}
	if v > max {
		return max
	}
	return v
}

// normalizeHexColor accepts #RGB/#RRGGBB and returns #RRGGBB (lowercase
// tolerated); anything else is returned as-is for the client to fall back.
func normalizeHexColor(s string) string {
	s = strings.TrimSpace(s)
	if len(s) == 4 && strings.HasPrefix(s, "#") {
		return fmt.Sprintf("#%c%c%c%c%c%c", s[1], s[1], s[2], s[2], s[3], s[3])
	}
	return s
}

// colorForOptionRole mirrors the web 3D preview palette
// (packages/ui/src/preview3d/boardPartVisual.ts ROLE_COLORS) so the SketchUp
// preview matches what the workshop sees in the React app.
func colorForOptionRole(role string) string {
	r := strings.ToUpper(strings.TrimSpace(role))
	switch {
	case strings.Contains(r, "FRENTE"), strings.Contains(r, "PUERTA"):
		return "#c4a574"
	case strings.Contains(r, "FONDO"), strings.Contains(r, "TRASERA"):
		return "#8b7355"
	case strings.Contains(r, "INTERIOR"):
		return "#d4c4a8"
	case strings.Contains(r, "EDGE"):
		return "#a09070"
	default:
		return "#c8b89a"
	}
}
