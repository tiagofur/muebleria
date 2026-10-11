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

// OpeningMembers is the pinned member set (#1274) the layout materializes
// as DERIVED hardware placements when the design's opening constrained a
// furniture's fronts: the gola run plus its factory-declared companions.
// The ids and the spacing come from the selection's profile pin — never
// the live catalog — so a datasheet change never drifts a resolved model.
type OpeningMembers struct {
	ProfileHardwareID string
	SupportHardwareID string
	CapHardwareID     string
	SupportSpacingMm  int
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
// [0, dims.WidthMm], aligned at the top-front of the carcass [0, DepthMm, HeightMm],
// the left support mounts at X = 0, and the right support mounts at X = WidthMm with
// its X axis inverted (mirrored into the cabinet).
func appendOpeningMemberLayoutHardware(layout *FurnitureLayout, catalog domain.Catalog, members OpeningMembers, dims LayoutDims, bottomBoundary bool) {
	if members.ProfileHardwareID == "" {
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
	// aligned at the top-front of carcass (Y = totalD, Z = zPos).
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
			[3]float64{totalW, 56.5, 27.2},
		))
	}

	// 2. Supports:
	if members.SupportHardwareID != "" {
		if hw, ok := findHardware(catalog, members.SupportHardwareID); ok && hw.Active {
			// Left support: at X = 0, Y = totalD, Z = zPos, normal orientation
			layout.Hardware = append(layout.Hardware, buildDerivedHardware(
				hw,
				fmt.Sprintf("opening-support-left-%s", hw.ID),
				[3]float64{0, yPos, zPos},
				LayoutBasis{
					X: [3]float64{1, 0, 0},
					Y: [3]float64{0, 1, 0},
					Z: [3]float64{0, 0, 1},
				},
				[3]float64{20, 40, 20},
			))
			// Intermediate supports if width exceeds spacing:
			if members.SupportSpacingMm > 0 && totalW > float64(members.SupportSpacingMm) {
				count := int(totalW / float64(members.SupportSpacingMm))
				for i := 1; i <= count; i++ {
					stepX := (totalW / float64(count+1)) * float64(i)
					layout.Hardware = append(layout.Hardware, buildDerivedHardware(
						hw,
						fmt.Sprintf("opening-support-mid-%d-%s", i, hw.ID),
						[3]float64{stepX, yPos, zPos},
						LayoutBasis{
							X: [3]float64{1, 0, 0},
							Y: [3]float64{0, 1, 0},
							Z: [3]float64{0, 0, 1},
						},
						[3]float64{20, 40, 20},
					))
				}
			}
			// Right support: at X = totalW, Y = totalD, Z = zPos, inverted in X!
			layout.Hardware = append(layout.Hardware, buildDerivedHardware(
				hw,
				fmt.Sprintf("opening-support-right-%s", hw.ID),
				[3]float64{totalW, yPos, zPos},
				LayoutBasis{
					X: [3]float64{-1, 0, 0},
					Y: [3]float64{0, 1, 0},
					Z: [3]float64{0, 0, 1},
				},
				[3]float64{20, 40, 20},
			))
		}
	}

	// 3. End Caps:
	if members.CapHardwareID != "" {
		if hw, ok := findHardware(catalog, members.CapHardwareID); ok && hw.Active {
			layout.Hardware = append(layout.Hardware,
				buildDerivedHardware(hw, fmt.Sprintf("opening-cap-left-%s", hw.ID), [3]float64{0, yPos, zPos}, LayoutBasis{X: [3]float64{1, 0, 0}, Y: [3]float64{0, 1, 0}, Z: [3]float64{0, 0, 1}}, [3]float64{3, 58, 29}),
				buildDerivedHardware(hw, fmt.Sprintf("opening-cap-right-%s", hw.ID), [3]float64{totalW, yPos, zPos}, LayoutBasis{X: [3]float64{-1, 0, 0}, Y: [3]float64{0, 1, 0}, Z: [3]float64{0, 0, 1}}, [3]float64{3, 58, 29}),
			)
		}
	}
}

func buildDerivedHardware(hw domain.Hardware, placementID string, translation [3]float64, basis LayoutBasis, dims [3]float64) LayoutHardware {
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
		PlacementID:      placementID,
		HardwareID:       hw.ID,
		Name:             hw.Name,
		Shape:            shape,
		PlacementKind:    HardwarePlacementKindDerived,
		Transform:        LayoutTransform{TranslationMm: translation},
		DimensionsMm:     dims,
		LocalTransform:   LayoutLocalTransform{TranslationMm: translation, Basis: basis},
		AssetID:          assetID,
		AssetRevisionID:  assetRevisionID,
		SHA256:           sha256,
		ExpectedBytes:    expectedBytes,
		Representation:   rep,
		ValidationState:  valState,
		PreparationState: prepState,
		MountFrame:       mountFrame,
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
