package engine

// authoring_door_swing.go — #529 door-swing accessory grouping + motion
//
// computeDoorSwingAccessories derives the authoritative DoorAccessoryGroup
// list from the resolved effective placements and the furniture's doorSwing
// parameter.  The result is pure presentation metadata: manufacturing truth
// stays in HardwarePlacements + Machining and is never rebuilt from this
// section.
//
// computeDoorSwingMotions derives the ResolvedAgregadoMotion list from the
// DoorAccessoryGroup list (Slice B MVP — rotate only, 110 °):
//   doorSwing = left  → kind "rotate", pivotSide "left",  axisLocal [0,0, 1], openAngleDeg 110
//   doorSwing = right → kind "rotate", pivotSide "right", axisLocal [0,0,-1], openAngleDeg 110
//   doorSwing = pair  → TWO motions: left (axis Z=+1) and right (axis Z=-1)
//
// stampDoorAffinity back-annotates the normalized hardware placement list
// with the door-affinity so the API layer and SketchUp inspector can surface
// "Pertenece a Puerta 1 …" without re-deriving the grouping.
//
// Business rules (canonical):
//   doorSwing = left  → bisagras anchorFace=left,  jaladera anchorFace=right, mirrored=false
//   doorSwing = right → bisagras anchorFace=right, jaladera anchorFace=left,  mirrored=true
//   doorSwing = pair  → door[0]: swing=left, door[1]: swing=right
//
// Sistema 32 default offsets:
//   Bisagra superior: offsetY = 100 mm
//   Bisagra inferior: offsetY = boardLengthMm − 100 mm
//   Jaladera:         offsetY = boardLengthMm / 2,  offsetX = 40 mm

import (
	"fmt"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

const (
	doorSwingLeft  = "left"
	doorSwingRight = "right"
	doorSwingPair  = "pair"

	// hingeOffsetFromEdgeMm is the Sistema-32 default margin from the board
	// edge (top/bottom) to each hinge centre.
	hingeOffsetFromEdgeMm = 100.0
	// handleOffsetFromHingeFaceMm is the default in-board distance of the
	// handle centre from the hinge-side edge.
	handleOffsetFromHingeFaceMm = 40.0
)

// doorSlotSwing resolves the effective swing side for one door slot.
// For "pair": slot 0 → left, slot 1 → right (standard hinged-pair opening).
func doorSlotSwing(swing string, slotIndex int) string {
	if swing == doorSwingPair {
		if slotIndex == 0 {
			return doorSwingLeft
		}
		return doorSwingRight
	}
	return swing
}

// oppositeFace returns the horizontal face that is opposite to the given one.
// Only "left" ↔ "right" are door-relevant; anything else is returned as-is.
func oppositeFace(face string) string {
	switch face {
	case "left":
		return "right"
	case "right":
		return "left"
	}
	return face
}

// doorLabel formats the human-readable label for a door slot (1-based).
func doorLabel(slotIndex int) string {
	return fmt.Sprintf("Puerta %d", slotIndex+1)
}

// isDoorBoard reports whether a board represents a door component.
// The canonical criterion is optionRole == "FRENTE" (case-insensitive).
func isDoorBoard(board *layoutBoard) bool {
	return strings.EqualFold(board.optionRole, "FRENTE")
}

// hardwareCategoryForPlacement resolves the hardware category string for a
// placement intent by looking up the catalog.  Returns "" when not found.
func hardwareCategoryForPlacement(intent AuthoringManualPlacement, catalog domain.Catalog) string {
	hw, ok := findHardware(catalog, intent.CatalogHardwareID)
	if !ok {
		return ""
	}
	cat := strings.ToLower(strings.TrimSpace(hw.Category))
	if cat == "" && hw.PreviewShape != nil {
		shape := strings.ToLower(strings.TrimSpace(*hw.PreviewShape))
		switch shape {
		case "hinge":
			cat = "hinge"
		case "bar-pull", "handle", "knob":
			cat = "handle"
		default:
			cat = shape
		}
	}
	return cat
}

// computeDoorSwingAccessories groups hinge and handle placements per door slot
// and annotates each group with the swing side derived from the doorSwing
// parameter.  When the module has no doorSwing parameter (or the evaluated
// value is unknown / empty) the function returns nil.
func computeDoorSwingAccessories(
	definitions []domain.FurnitureParameterDefinition,
	evaluated map[string]any,
	boards []layoutBoard,
	placements []effectiveManualPlacement,
	catalog domain.Catalog,
) []domain.DoorAccessoryGroup {
	// 1. Resolve the doorSwing value from evaluated parameters.
	swing := ""
	for _, def := range definitions {
		if def.Name == "doorSwing" && def.Type == domain.FurnitureParameterTypeEnum {
			if v, ok := evaluated["doorSwing"].(string); ok && v != "" {
				swing = v
			}
			break
		}
	}
	if swing == "" {
		return nil
	}

	// 2. Collect door boards in stable order (index = slotIndex).
	var doorBoards []*layoutBoard
	for i := range boards {
		if isDoorBoard(&boards[i]) {
			doorBoards = append(doorBoards, &boards[i])
		}
	}
	if len(doorBoards) == 0 {
		return nil
	}

	// 3. Build a placement index keyed by hostComponentInstanceID.
	//    Multiple placements may target the same board (one hinge, one handle, etc.).
	type placementEntry struct {
		intent   AuthoringManualPlacement
		board    *layoutBoard
		category string
	}
	byBoardID := make(map[string][]placementEntry, len(placements))
	for _, p := range placements {
		if p.board == nil {
			continue
		}
		cat := hardwareCategoryForPlacement(p.intent, catalog)
		byBoardID[p.board.id] = append(byBoardID[p.board.id], placementEntry{
			intent:   p.intent,
			board:    p.board,
			category: cat,
		})
	}

	// 4. Build one DoorAccessoryGroup per door slot.
	groups := make([]domain.DoorAccessoryGroup, 0, len(doorBoards))
	for slotIdx, door := range doorBoards {
		slotSwing := doorSlotSwing(swing, slotIdx)
		hingeFace := slotSwing         // bisagras on the hinge side
		handleFace := oppositeFace(slotSwing) // jaladera on the opposite side

		group := domain.DoorAccessoryGroup{
			DoorSlotIndex: slotIdx,
			DoorLabel:     doorLabel(slotIdx),
			SwingSide:     slotSwing,
			HingeFace:     hingeFace,
			HandleFace:    handleFace,
			Hinges:        []domain.HardwareAccessoryRow{},
			Handles:       []domain.HardwareAccessoryRow{},
		}

		for _, entry := range byBoardID[door.id] {
			row := domain.HardwareAccessoryRow{
				HardwarePlacementID: entry.intent.HardwarePlacementID,
				CatalogHardwareID:   entry.intent.CatalogHardwareID,
				AnchorFace:          entry.intent.AnchorFace,
				OffsetMm:            entry.intent.OffsetMm,
				PlacementKind:       entry.intent.PlacementKind,
				RotationDeg:         entry.intent.RotationDeg,
			}
			if hw, ok := findHardware(catalog, entry.intent.CatalogHardwareID); ok {
				row.HardwareName = hw.Name
			}

			switch entry.category {
			case "hinge":
				group.Hinges = append(group.Hinges, row)
			case "handle":
				group.Handles = append(group.Handles, row)
			}
		}

		groups = append(groups, group)
	}

	return groups
}

// MotionKeyframe is one pose sample on an animation timeline.
type MotionKeyframe struct {
	Progress      float64    `json:"progress"`
	TranslationMm [3]float64 `json:"translationMm"`
	RotationDeg   *struct {
		X *float64 `json:"x,omitempty"`
		Y *float64 `json:"y,omitempty"`
		Z *float64 `json:"z,omitempty"`
	} `json:"rotationDeg,omitempty"`
}

// ResolvedMotionDef describes a single motion (rotate | translate | keyframes)
// for one agregado instance in the authoring-resolve response (Slice B MVP).
type ResolvedMotionDef struct {
	// Kind is "rotate" | "translate" | "keyframes".
	Kind         string           `json:"kind"`
	PivotSide    string           `json:"pivotSide,omitempty"`
	PivotLocalMm [3]float64       `json:"pivotLocalMm,omitempty"`
	AxisLocal    [3]float64       `json:"axisLocal"`
	OpenAngleDeg float64          `json:"openAngleDeg,omitempty"`
	DistanceMm   float64          `json:"distanceMm,omitempty"`
	Keyframes    []MotionKeyframe `json:"keyframes,omitempty"`
}

// ResolvedAgregadoMotion pairs one resolved motion definition with the
// component/hardware instance IDs it governs.  Published in the
// authoringResolveResolved envelope (#529 Slice B).
type ResolvedAgregadoMotion struct {
	// AgregadoInstanceID is the resolved component-instance ID of the moving part.
	AgregadoInstanceID string `json:"agregadoInstanceId"`
	// Motion describes how the part moves.
	Motion ResolvedMotionDef `json:"motion"`
	// ComponentInstanceIDs lists the component instance IDs that belong to
	// this motion (the door panel board(s)).
	ComponentInstanceIDs []string `json:"componentInstanceIds"`
	// HardwarePlacementIDs optionally lists hardware placements that move with
	// the panel (hinges, handle, etc.). Populated from the DoorAccessoryGroup.
	HardwarePlacementIDs []string `json:"hardwarePlacementIds,omitempty"`
}

// computeDoorSwingMotions derives a ResolvedAgregadoMotion for every door
// slot in groups (Slice B MVP — rotate only, 110 °). The door boards slice
// must be in the same order as the groups produced by computeDoorSwingAccessories.
// Returns nil when groups is empty.
func computeDoorSwingMotions(doorBoards []*layoutBoard, groups []domain.DoorAccessoryGroup) []ResolvedAgregadoMotion {
	if len(groups) == 0 {
		return nil
	}
	motions := make([]ResolvedAgregadoMotion, 0, len(groups))
	for i, g := range groups {
		// Axis direction: left-hinge → rotate about +Z; right-hinge → −Z.
		axisZ := 1.0
		if g.SwingSide == doorSwingRight {
			axisZ = -1.0
		}

		// Gather hardware placement IDs from the group rows.
		var hwIDs []string
		for _, row := range g.Hinges {
			hwIDs = append(hwIDs, row.HardwarePlacementID)
		}
		for _, row := range g.Handles {
			hwIDs = append(hwIDs, row.HardwarePlacementID)
		}

		// Component instance ID of the door board for this slot.
		instanceID := ""
		if i < len(doorBoards) && doorBoards[i] != nil {
			instanceID = doorBoards[i].id
		}

		motions = append(motions, ResolvedAgregadoMotion{
			AgregadoInstanceID: instanceID,
			Motion: ResolvedMotionDef{
				Kind:         "rotate",
				PivotSide:    g.SwingSide,
				AxisLocal:    [3]float64{0, 0, axisZ},
				OpenAngleDeg: 110,
			},
			ComponentInstanceIDs: []string{instanceID},
			HardwarePlacementIDs: hwIDs,
		})
	}
	return motions
}

// stampDoorAffinity back-annotates each AuthoringManualPlacement in the
// normalized snapshot with the DoorAffinity resolved by
// computeDoorSwingAccessories.  Placements not present in any group are left
// unchanged (nil DoorAffinity).
func stampDoorAffinity(placements []AuthoringManualPlacement, groups []domain.DoorAccessoryGroup) {
	if len(groups) == 0 {
		return
	}

	// Build a lookup: placementID → (group, accessoryRole, accessoryIndex).
	type affinityEntry struct {
		group         domain.DoorAccessoryGroup
		accessoryRole domain.DoorAccessoryRole
		accessoryIdx  int
	}
	lookup := make(map[string]affinityEntry, len(placements))
	for _, g := range groups {
		for i, row := range g.Hinges {
			lookup[row.HardwarePlacementID] = affinityEntry{
				group:         g,
				accessoryRole: domain.DoorAccessoryHinge,
				accessoryIdx:  i,
			}
		}
		for i, row := range g.Handles {
			lookup[row.HardwarePlacementID] = affinityEntry{
				group:         g,
				accessoryRole: domain.DoorAccessoryHandle,
				accessoryIdx:  i,
			}
		}
	}

	for i := range placements {
		if entry, ok := lookup[placements[i].HardwarePlacementID]; ok {
			placements[i].DoorAffinity = &domain.DoorAffinity{
				DoorSlotIndex:  entry.group.DoorSlotIndex,
				DoorLabel:      entry.group.DoorLabel,
				SwingSide:      entry.group.SwingSide,
				AccessoryRole:  entry.accessoryRole,
				AccessoryIndex: entry.accessoryIdx,
			}
		}
	}
}
