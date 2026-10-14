package engine

import (
	"fmt"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// Opening fronts layout pass (#1264 / V2 OPEN-FRONT): the server-resolved
// front region CONSTRAINS the expanded door/drawer-front boards. The pass
// runs over []layoutBoard right after expansion, BEFORE the authored-
// translation final pass — under an opening, the vertical placement of a
// front is the opening's, never client-authored — and before the pose
// projection, so AABB/localTransform/machining derive naturally downstream.
//
// Semantics (v1 single-region pilot): every front board keeps its authored
// width split and holguras (the catalog formulas' gaps stay intact); each
// grip consumes from its boundary — a top grip shrinks the board from the
// top, a bottom grip lifts its bottom edge (z += consumed). A negative
// consumption (case C's overhang, #1138) extends the board downward with
// the same arithmetic. Fail-closed: a board that would end non-positive
// rejects the resolve — never an invented size.
//
// Identity is never inferred from names or order: the boards are selected
// by the managed vocabulary (placement puerta/frente_cajon, or the FRENTE
// role the door-swing criterion already owns).

// applyOpeningFrontsToBoards applies the resolved front region to the door
// and drawer-front boards. It returns the set of constrained board indexes —
// their authored translation is superseded by the opening's constraint.
func applyOpeningFrontsToBoards(boards []layoutBoard, fronts []OpeningResolvedFront) (map[int]bool, error) {
	if len(fronts) == 0 {
		return nil, nil
	}
	// v1 pilot: ONE front region per furniture — the design opening
	// selection resolves a single zone (ratio 1); multi-zone layouts are V3
	// explicit scope, never a silent split.
	front := fronts[0]
	consumedByBoundary := map[string]int{}
	totalConsumed := 0
	for _, grip := range front.Grips {
		consumedByBoundary[grip.Boundary] += grip.ConsumedMm
		totalConsumed += grip.ConsumedMm
	}
	constrained := map[int]bool{}
	for i := range boards {
		board := &boards[i]
		if !boardIsOpeningFront(board) {
			continue
		}
		if board.lengthMm-float64(totalConsumed) <= 0 {
			return nil, fmt.Errorf(
				"la apertura deja el frente %s sin altura válida (consumo %d mm sobre %g mm)",
				board.id, totalConsumed, board.lengthMm)
		}
		board.lengthMm -= float64(totalConsumed)
		if lift := consumedByBoundary["bottom"]; lift != 0 {
			board.z += float64(lift)
		}
		constrained[i] = true

		// Gola / integrated grips are handle-free: prune any handle hardware
		// (JALADERA) from this front so the 3D layout does not mount a pull bar
		// on a gola front.
		if len(front.Grips) > 0 && len(board.hardware) > 0 {
			filtered := make([]domain.HardwarePlacement, 0, len(board.hardware))
			for _, hp := range board.hardware {
				if strings.EqualFold(hp.OptionRole, "JALADERA") || strings.EqualFold(hp.OptionRole, "JALADERAS") {
					continue
				}
				filtered = append(filtered, hp)
			}
			board.hardware = filtered
		}
	}
	return constrained, nil
}

// boardIsOpeningFront reports whether a board is a door/drawer-front the
// opening region constrains: the managed placements plus the FRENTE role
// criterion the door-swing accessories already own.
func boardIsOpeningFront(board *layoutBoard) bool {
	return board.placement == string(domain.PlacementPuerta) ||
		board.placement == string(domain.PlacementFrenteCajon) ||
		isDoorBoard(board)
}

// OpeningMembersFromFrozenPin projects the selection's pinned member set
// onto the layout's derived-hardware input (#1274). ONE projection feeds the
// authoring resolve and the production release (#1305) — a copy here and a
// copy there would drift. nil when the pin declares no members.
func OpeningMembersFromFrozenPin(selection *domain.DesignOpeningSelection) *OpeningMembers {
	if selection == nil || selection.ProfilePin == nil || selection.ProfilePin.BOM == nil {
		return nil
	}
	var spacing int
	if support := selection.ProfilePin.BOM.Members["supports"]; support.HardwareID != "" && support.SpacingMm != nil {
		spacing = *support.SpacingMm
	}
	members := &OpeningMembers{
		ProfileHardwareID: selection.ProfilePin.BOM.Members["profile"].HardwareID,
		SupportHardwareID: selection.ProfilePin.BOM.Members["supports"].HardwareID,
		CapHardwareID:     selection.ProfilePin.BOM.Members["endCaps"].HardwareID,
		SupportSpacingMm:  spacing,
		ProfileHeightMm:   selection.ProfilePin.ProfileHeightMm,
		ProfileDepthMm:    selection.ProfilePin.ProfileDepthMm,
	}
	if dims := selection.ProfilePin.BOM.Members["supports"].DimensionsMm; dims != nil {
		members.SupportDimsMm = &(*dims)
	}
	if dims := selection.ProfilePin.BOM.Members["endCaps"].DimensionsMm; dims != nil {
		members.CapDimsMm = &(*dims)
	}
	if members.ProfileHardwareID == "" && members.SupportHardwareID == "" && members.CapHardwareID == "" {
		return nil
	}
	return members
}

// applyOpeningFrontsToBomParts (#1305) mirrors applyOpeningFrontsToBoards
// over the BOM expansion: every door/drawer-front part shrinks by the SAME
// total consumption so the cut list and the machining layout can never
// disagree about a constrained front's size. The BOM carries no pose — the
// bottom-grip lift is layout-only — but the DIMENSION rule is the same one
// arithmetic. Fail-closed: a part that would end non-positive rejects the
// resolve — never an invented size.
func applyOpeningFrontsToBomParts(parts []domain.BoardPart, fronts []OpeningResolvedFront) error {
	if len(fronts) == 0 {
		return nil
	}
	// v1 pilot: ONE front region per furniture — the design opening resolves
	// a single zone (ratio 1); multi-zone layouts are V3 explicit scope.
	front := fronts[0]
	totalConsumed := 0
	for _, grip := range front.Grips {
		totalConsumed += grip.ConsumedMm
	}
	if totalConsumed == 0 {
		return nil
	}
	for i := range parts {
		if !bomPartIsOpeningFront(&parts[i]) {
			continue
		}
		if parts[i].LengthMm-totalConsumed <= 0 {
			return fmt.Errorf(
				"la apertura deja el frente %s sin altura válida (consumo %d mm sobre %d mm)",
				parts[i].ID, totalConsumed, parts[i].LengthMm)
		}
		parts[i].LengthMm -= totalConsumed
	}
	return nil
}

// bomPartIsOpeningFront is the BOM twin of boardIsOpeningFront: the SAME
// managed placements plus the SAME FRENTE role criterion, evaluated on the
// placement the composed expansion copied from the component (#1305).
func bomPartIsOpeningFront(part *domain.BoardPart) bool {
	return part.Placement == string(domain.PlacementPuerta) ||
		part.Placement == string(domain.PlacementFrenteCajon) ||
		strings.EqualFold(part.OptionRole, "FRENTE")
}

// openingDepthReductionAnnotations (#1317) is the BOM twin of the layout
// pass's TECHO correction: every full-depth panel of the boundary's
// canonical placement (superior at a top gola, base at a rebase) has its
// finished WIDTH (the depth extent of a horizontal panel — widthFormula
// "PD", the same convention the layout pose publishes) reduced by the
// declared reduction. The manguete frontal carries its own depth (≠ PD) and
// its correction is position-only — no annotation, the cut line is intact.
// The map keys by part ID; nil = nothing declared. The BOM carries no pose,
// so the annotation keys on the managed placement vocabulary plus the
// full-depth signature — the same criterion as the layout pass over
// canonical structures.
func openingDepthReductionAnnotations(
	parts []domain.BoardPart,
	modifiers []ResolvedOpeningBodyModifier,
	depthMm int,
) (map[string]float64, error) {
	var annotations map[string]float64
	for _, modifier := range modifiers {
		if modifier.Effect != OpeningModifierEffectDepthReduction {
			continue
		}
		kind := openingBoundaryKind(modifier.Boundary)
		if kind != "top" && kind != "bottom" {
			return nil, fmt.Errorf(
				"la reducción de profundidad del perfil %s sobre la frontera %q no tiene consumidor en el BOM",
				modifier.ProfileID, kind)
		}
		wantedPlacement := string(domain.PlacementSuperior)
		if kind == "bottom" {
			wantedPlacement = string(domain.PlacementBase)
		}
		for i := range parts {
			part := &parts[i]
			if part.Placement != wantedPlacement || part.WidthMm != depthMm {
				continue
			}
			if previous, seen := annotations[part.ID]; seen && previous != modifier.DepthReductionMm {
				return nil, fmt.Errorf(
					"la pieza %s recibe dos reducciones de profundidad distintas (%g y %g)",
					part.ID, previous, modifier.DepthReductionMm)
			}
			if annotations == nil {
				annotations = map[string]float64{}
			}
			annotations[part.ID] = modifier.DepthReductionMm
		}
	}
	return annotations, nil
}

// OpeningMembers is the pinned member set (#1274) the layout materializes
// as DERIVED hardware placements when the design's opening constrained a
// furniture's fronts: the gola run plus its factory-declared companions.
// The ids and the spacing come from the selection's profile pin — never
// the live catalog — so a datasheet change never drifts a resolved model.
//
// #1283 / §13.2: the declared datasheet geometry rides with the pin too.
// ProfileHeightMm/ProfileDepthMm are the profile's physical envelope
// (8006: 56.5 tall × 27.2 deep); Support/Cap dims are each accessory's
// declared envelope [along-run, depth, height]. Zero/nil = the pin does not
// declare the geometry (pre-#1283 pin) and the layout places nothing — the
// truthful absence, never an engine constant.
type OpeningMembers struct {
	ProfileHardwareID string
	SupportHardwareID string
	CapHardwareID     string
	SupportSpacingMm  int
	ProfileHeightMm   float64
	ProfileDepthMm    float64
	SupportDimsMm     *[3]float64
	CapDimsMm         *[3]float64
}

// attachOpeningMembers appends the member placements to the FIRST
// constrained front board (the door/drawer-front the opening shrank) — the
// channel physically sits on that front's freed edge: anchorFace top for a
// top-boundary grip (gola), bottom for rebase. Placements live in the front
// board's face frame: x runs across the front's width (≈ the useful span),
// y sits at the freed edge. Industry conventions (#1274 research): one run
// centered on the span, ceil(span/spacing)+1 supports spread evenly, one
// cap per exposed end. Honest absences: no constrained front or no profile
// member places nothing.
// appendOpeningMemberLayoutHardware emits the derived opening hardware directly
// in furniture space (#1274 / #1276): the profile spans the full furniture width
// [0, dims.WidthMm], aligned at the top-front of the carcass [0, DepthMm, HeightMm].
// #1296: supports mount on the sides' INNER faces (sideThicknessMm in from each
// outer face), behind the profile and centered on its height; the right support
// mirrors the left in X.
//
// #1283 / §13.2: every envelope comes from the pinned datasheet declaration,
// never from engine constants. The references are explicit:
//   - Height reference: the carcass top plane at a top-boundary gola
//     (dims.HeightMm; the bottom plane at a bottom boundary). The support's
//     local origin sits at profile height / 2 from that reference — the
//     support SKP must be modeled with its grip point as local origin.
//   - Depth reference: the carcass front plane (the profile's front face is
//     flush with it; the declared depth reaches back under the top).
func appendOpeningMemberLayoutHardware(layout *FurnitureLayout, catalog domain.Catalog, members OpeningMembers, dims LayoutDims, bottomBoundary bool, hostBoardID string, sideThicknessMm float64) {
	face := "top"
	if bottomBoundary {
		face = "bottom"
	}
	if members.ProfileHardwareID == "" {
		return
	}
	// §13.2 fail-closed: a pin without declared datasheet geometry (pre-#1283
	// rows) places no opening hardware — an invented envelope is never a
	// fallback for a missing declaration.
	if members.ProfileHeightMm <= 0 || members.ProfileDepthMm <= 0 {
		return
	}
	totalW := float64(dims.WidthMm)
	totalH := float64(dims.HeightMm)
	totalD := float64(dims.DepthMm)

	zPos := totalH
	if bottomBoundary {
		zPos = 0
	}
	yPos := totalD

	// 1. Profile: spanning the entire furniture width from X = 0 to X = totalW,
	// front face flush with the carcass front plane, vertical envelope from
	// the declared datasheet (8006: 56.5 tall × 27.2 deep).
	if hw, ok := findHardware(catalog, members.ProfileHardwareID); ok && hw.Active {
		layout.Hardware = append(layout.Hardware, buildDerivedHardware(
			hw,
			fmt.Sprintf("opening-profile-%s", hw.ID),
			[3]float64{0, yPos, zPos},
			LayoutBasis{
				X: [3]float64{1, 0, 0},
				Y: [3]float64{0, 1, 0},
				Z: [3]float64{0, 0, 1},
			},
			[3]float64{totalW, members.ProfileDepthMm, members.ProfileHeightMm},
			hostBoardID,
			face,
		))
	}

	// 2. Supports (#1296, owner convention): the bracket screws to the side
	// panel's INNER face, sits BEHIND the profile band and centers on the
	// profile's height. The re-modeled SU116 SKP carries its local (0,0,0) at
	// the L's corner — the plate's mounting face (X=0, against the side),
	// the arm's rear edge (Y=0) and the bracket's bottom (Z=0) — growing
	// +X (into the cabinet), +Y (toward the front) and +Z (up). The engine
	// places that origin at:
	//   X = the side's inner face (sideThicknessMm from each outer face)
	//   Y = profileBack − armDepth (the arm tip meets the profile's rear face)
	//   Z = the profile section's center − bracketHeight/2 (centered in height)
	// Members without declared geometry place nothing.
	if members.SupportHardwareID != "" && members.SupportDimsMm != nil {
		if hw, ok := findHardware(catalog, members.SupportHardwareID); ok && hw.Active {
			supportDims := *members.SupportDimsMm
			xLeft := sideThicknessMm
			xRight := totalW - sideThicknessMm
			ySupport := yPos - members.ProfileDepthMm - supportDims[1]
			zSupport := zPos - members.ProfileHeightMm/2 - supportDims[2]/2
			if bottomBoundary {
				zSupport = zPos + members.ProfileHeightMm/2 - supportDims[2]/2
			}
			// Left support: plate against the left side's inner face.
			layout.Hardware = append(layout.Hardware, buildDerivedHardware(
				hw,
				fmt.Sprintf("opening-support-left-%s", hw.ID),
				[3]float64{xLeft, ySupport, zSupport},
				LayoutBasis{
					X: [3]float64{1, 0, 0},
					Y: [3]float64{0, 1, 0},
					Z: [3]float64{0, 0, 1},
				},
				supportDims,
				hostBoardID,
				face,
			))
			// Intermediate supports if width exceeds spacing: spread over the
			// INNER span between the side plates.
			if members.SupportSpacingMm > 0 && totalW > float64(members.SupportSpacingMm) {
				count := int(totalW / float64(members.SupportSpacingMm))
				innerSpan := xRight - xLeft
				for i := 1; i <= count; i++ {
					stepX := xLeft + (innerSpan/float64(count+1))*float64(i)
					layout.Hardware = append(layout.Hardware, buildDerivedHardware(
						hw,
						fmt.Sprintf("opening-support-mid-%d-%s", i, hw.ID),
						[3]float64{stepX, ySupport, zSupport},
						LayoutBasis{
							X: [3]float64{1, 0, 0},
							Y: [3]float64{0, 1, 0},
							Z: [3]float64{0, 0, 1},
						},
						supportDims,
						hostBoardID,
						face,
					))
				}
			}
			// Right support: plate against the right side's inner face, mirrored in X.
			layout.Hardware = append(layout.Hardware, buildDerivedHardware(
				hw,
				fmt.Sprintf("opening-support-right-%s", hw.ID),
				[3]float64{xRight, ySupport, zSupport},
				LayoutBasis{
					X: [3]float64{-1, 0, 0},
					Y: [3]float64{0, 1, 0},
					Z: [3]float64{0, 0, 1},
				},
				supportDims,
				hostBoardID,
				face,
			))
		}
	}

	// 3. End Caps: the cap covers the profile's exposed section end, so its
	// envelope sits INSIDE the profile's band — origin at the box's MIN
	// corner (the host's fallback box extends +axes from the translation;
	// an origin at the top-front plane would float above/in front of the
	// cabinet). Left cap spans X [0, 3]; right mirrors at the far end.
	if members.CapHardwareID != "" && members.CapDimsMm != nil {
		if hw, ok := findHardware(catalog, members.CapHardwareID); ok && hw.Active {
			capDims := *members.CapDimsMm
			capY := yPos - capDims[1]
			capZ := zPos - capDims[2]
			layout.Hardware = append(layout.Hardware,
				buildDerivedHardware(hw, fmt.Sprintf("opening-cap-left-%s", hw.ID), [3]float64{0, capY, capZ}, LayoutBasis{X: [3]float64{1, 0, 0}, Y: [3]float64{0, 1, 0}, Z: [3]float64{0, 0, 1}}, capDims, hostBoardID, face),
				buildDerivedHardware(hw, fmt.Sprintf("opening-cap-right-%s", hw.ID), [3]float64{totalW, capY, capZ}, LayoutBasis{X: [3]float64{-1, 0, 0}, Y: [3]float64{0, 1, 0}, Z: [3]float64{0, 0, 1}}, capDims, hostBoardID, face),
			)
		}
	}
}

func buildDerivedHardware(hw domain.Hardware, placementID string, translation [3]float64, basis LayoutBasis, dims [3]float64, hostBoardID string, anchorFace string) LayoutHardware {
	shape := "custom"
	if hw.PreviewShape != nil && *hw.PreviewShape != "" {
		shape = *hw.PreviewShape
	}
	var assetID, assetRevisionID, sha256, rep, valState, prepState string
	var expectedBytes int64
	var mountFrame *domain.HardwareMountFrame
	if hw.VisualAsset != nil {
		assetID = hw.VisualAsset.AssetID
		assetRevisionID = hw.VisualAsset.AssetRevisionID
		sha256 = hw.VisualAsset.SHA256
		rep = string(hw.VisualAsset.Representation)
		valState = string(hw.VisualAsset.ValidationState)
		expectedBytes = hw.VisualAsset.SizeBytes
		prepState = string(hw.VisualAsset.PreparationState)
		mountFrame = hw.VisualAsset.MountFrame
	}

	return LayoutHardware{
		PlacementID:             placementID,
		HardwareID:              hw.ID,
		Name:                    hw.Name,
		Shape:                   shape,
		AnchorFace:              anchorFace,
		HostComponentInstanceID: hostBoardID,
		PlacementKind:           HardwarePlacementKindDerived,
		Transform:               LayoutTransform{TranslationMm: translation},
		DimensionsMm:            dims,
		LocalTransform:          LayoutLocalTransform{TranslationMm: translation, Basis: basis},
		AssetID:                 assetID,
		AssetRevisionID:         assetRevisionID,
		SHA256:                  sha256,
		ExpectedBytes:           expectedBytes,
		Representation:          rep,
		ValidationState:         valState,
		PreparationState:        prepState,
		MountFrame:              mountFrame,
	}
}

// openingFrontsBottomBoundary reports the zone edge the member hardware
// anchors to: a bottom grip (rebase) frees the front's bottom edge,
// anything else (gola's top consumption) the top edge.
func openingFrontsBottomBoundary(fronts []OpeningResolvedFront) bool {
	for _, grip := range fronts[0].Grips {
		if grip.Boundary == "bottom" {
			return true
		}
	}
	return false
}
