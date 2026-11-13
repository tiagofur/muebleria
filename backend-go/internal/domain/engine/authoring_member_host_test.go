package engine

import (
	"fmt"
	"math"
	"testing"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1429 slice A — the MERIVOBOX shape: a drawer agregado whose fixed rails
// declare hostPlacement lateral_izquierdo/lateral_derecho (Blum guide rows
// 37/69/197/229/261/293 from the carcase front at 33.5 over the drawer
// bottom) and whose moving rails declare hostPlacement frente_cajon (Blum
// front fixing 20.5 from each lateral edge at 33.5/65.5 over the drawer
// bottom). Each frozen hole must round-trip through the SAME board-local
// frame the 3D placement projection uses back to its intended workshop
// position — the convention proof is the round trip, not a hardcoded face.
func TestMemberHostMachiningMerivoboxShape(t *testing.T) {
	const (
		moduleW = 400.0
		moduleH = 720.0
		moduleD = 500.0
	)

	guideProfile := domain.HardwareMachiningProfile{Parts: []domain.HardwareMachiningPart{{
		ID: "pilot", Role: "screw", Operations: guideOps(3.2, 12),
	}}}
	frontProfile := func(sign float64) domain.HardwareMachiningProfile {
		return domain.HardwareMachiningProfile{Parts: []domain.HardwareMachiningPart{{
			ID: "pilot", Role: "screw",
			Operations: []domain.MachiningOperation{
				{ID: "pilot-low", Kind: "screw_pilot", DiameterMm: 2.7, DepthMm: ptrFloat64(8), XMm: 20.5 * sign, YMm: 33.5, Face: "anchor"},
				{ID: "pilot-high", Kind: "screw_pilot", DiameterMm: 2.7, DepthMm: ptrFloat64(8), XMm: 20.5 * sign, YMm: 65.5, Face: "anchor"},
			},
		}}}
	}

	host := func(placement string) string { return placement }
	_ = host
	agr := domain.Agregado{
		ID: "agr-mbox", Code: "CAJON-MBOX", Name: "Cajón MERIVOBOX", Active: true,
		WidthMm: int(moduleW), HeightMm: 81, DepthMm: int(moduleD),
		RigidMembers: []domain.AgregadoRigidMember{
			{
				MemberID: "fixed_rail_left", Role: "fixed_rail",
				Source:        domain.RigidMemberSource{Kind: domain.RigidMemberSourceFixed, Fixed: &domain.FixedHardwareSource{HardwareID: "hw-rail-fij-l"}},
				BOMRole:       domain.BOMRoleNonPurchasing,
				HostPlacement: "lateral_izquierdo",
				Placement: domain.AssemblyAnchorRule{
					X: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
					Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 136},
					Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
				},
			},
			{
				MemberID: "fixed_rail_right", Role: "fixed_rail",
				Source:        domain.RigidMemberSource{Kind: domain.RigidMemberSourceFixed, Fixed: &domain.FixedHardwareSource{HardwareID: "hw-rail-fij-r"}},
				BOMRole:       domain.BOMRoleNonPurchasing,
				HostPlacement: "lateral_derecho",
				Placement: domain.AssemblyAnchorRule{
					X: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMax},
					Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 136},
					Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
				},
			},
			{
				MemberID: "moving_rail_left", Role: "moving_rail",
				Source:        domain.RigidMemberSource{Kind: domain.RigidMemberSourceFixed, Fixed: &domain.FixedHardwareSource{HardwareID: "hw-rail-mov-l"}},
				BOMRole:       domain.BOMRoleNonPurchasing,
				HostPlacement: "frente_cajon",
				Placement: domain.AssemblyAnchorRule{
					X: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
					Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
					Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
				},
			},
			{
				MemberID: "moving_rail_right", Role: "moving_rail",
				Source:        domain.RigidMemberSource{Kind: domain.RigidMemberSourceFixed, Fixed: &domain.FixedHardwareSource{HardwareID: "hw-rail-mov-r"}},
				BOMRole:       domain.BOMRoleNonPurchasing,
				HostPlacement: "frente_cajon",
				Placement: domain.AssemblyAnchorRule{
					X: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMax},
					Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
					Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
				},
			},
		},
	}

	rails := []domain.Hardware{
		{ID: "hw-rail-fij-l", Code: "RAIL-FIJ-L", Name: "Guía fija izquierda", Unit: domain.UnitPiece, Active: true, Machining: &guideProfile},
		{ID: "hw-rail-fij-r", Code: "RAIL-FIJ-R", Name: "Guía fija derecha", Unit: domain.UnitPiece, Active: true, Machining: &guideProfile},
		{ID: "hw-rail-mov-l", Code: "RAIL-MOV-L", Name: "Corredera móvil izquierda", Unit: domain.UnitPiece, Active: true, Machining: ptrProfile(frontProfile(1))},
		{ID: "hw-rail-mov-r", Code: "RAIL-MOV-R", Name: "Corredera móvil derecha", Unit: domain.UnitPiece, Active: true, Machining: ptrProfile(frontProfile(-1))},
	}

	module, catalog := memberHostCabinet(int(moduleW), int(moduleH), int(moduleD))
	catalog.Agregados = append(catalog.Agregados, agr)
	catalog.Hardware = append(catalog.Hardware, rails...)
	module.Agregados = []domain.ModuleAgregadoInstance{{AgregadoID: "agr-mbox", Quantity: 1}}

	layout, boards, err := resolveFurnitureLayoutOpts(module, catalog, &LayoutDims{WidthMm: int(moduleW), HeightMm: int(moduleH), DepthMm: int(moduleD)}, nil, resolveOptions{})
	if err != nil {
		t.Fatalf("layout resolve: %v", err)
	}

	operations := []ResolvedMachiningOperation{}
	issues := []domain.ContractIssue{}
	deriveMemberHostMachining(layout.Assemblies, boards, catalog, &operations, &issues)
	if len(issues) != 0 {
		t.Fatalf("unexpected derivation issues: %+v", issues)
	}

	byMember := map[string][]ResolvedMachiningOperation{}
	for _, op := range operations {
		if op.Provenance.SourceKind != "assemblyMemberHost" {
			t.Fatalf("unexpected provenance %q", op.Provenance.SourceKind)
		}
		byMember[op.Provenance.MemberID] = append(byMember[op.Provenance.MemberID], op)
	}
	if len(byMember) != 4 {
		t.Fatalf("want holes from 4 members, got %d: %+v", len(byMember), byMember)
	}

	boardByID := map[string]*layoutBoard{}
	for i := range boards {
		boardByID[boards[i].id] = &boards[i]
	}

	// The assembly sits at the module origin, so the drawer's front plane is
	// the module front (depth 500) and its bottom is z=0. The entry plane is
	// the INNER face of each host: left lateral inner face at x=18, right at
	// x=400−18, front inner face at depth 500−18.
	assertHoleWorld := func(memberID string, op ResolvedMachiningOperation, wantDepthFromFront, wantHeight float64, wantPlane float64, planeAxis int) {
		t.Helper()
		board, ok := boardByID[op.HostComponentInstanceID]
		if !ok {
			t.Fatalf("%s: host %s is not a resolved board", memberID, op.HostComponentInstanceID)
		}
		if len(op.Holes) != 1 {
			t.Fatalf("%s: operation carries %d holes, want 1", memberID, len(op.Holes))
		}
		world := forwardMapHole(board, op.Holes[0])
		depthFromFront := moduleD - world[1]
		if math.Abs(depthFromFront-wantDepthFromFront) > 0.5 || math.Abs(world[2]-wantHeight) > 0.5 {
			t.Fatalf("%s hole on %s (%s x=%.1f y=%.1f): workshop depth-from-front %.2f (want %.2f), height %.2f (want %.2f)",
				memberID, board.id, op.Holes[0].Face, op.Holes[0].XMm, op.Holes[0].YMm,
				depthFromFront, wantDepthFromFront, world[2], wantHeight)
		}
		if math.Abs(world[planeAxis]-wantPlane) > 0.5 {
			t.Fatalf("%s hole entry plane coordinate %d = %.2f (want inner-face plane %.2f — the face must enter from the drawer interior)",
				memberID, planeAxis, world[planeAxis], wantPlane)
		}
	}

	// Moving rails: the height datum is PANEL-LOCAL (Blum mide la fijación
	// frontal desde la arista inferior del frente), so the emitted YMm must
	// equal the Blum heights verbatim and the entry plane stays the panel's
	// inner face at the module front.
	assertFrontHole := func(memberID string, op ResolvedMachiningOperation, wantHeight float64) {
		t.Helper()
		board, ok := boardByID[op.HostComponentInstanceID]
		if !ok {
			t.Fatalf("%s: host %s missing", memberID, op.HostComponentInstanceID)
		}
		if board.placement != string(domain.PlacementFrenteCajon) {
			t.Fatalf("%s landed on %q", memberID, board.placement)
		}
		if len(op.Holes) != 1 {
			t.Fatalf("%s: %d holes, want 1", memberID, len(op.Holes))
		}
		hole := op.Holes[0]
		world := forwardMapHole(board, hole)
		depthFromFront := moduleD - world[1]
		if math.Abs(depthFromFront) > 0.5 || math.Abs(hole.YMm-wantHeight) > 0.01 {
			t.Fatalf("%s hole (back x=%.1f y=%.1f): depth-from-front %.2f (want 0), panel-local height %.2f (want %.1f)",
				memberID, hole.XMm, hole.YMm, depthFromFront, hole.YMm, wantHeight)
		}
	}

	movL := byMember["moving_rail_left"]
	if len(movL) != 2 {
		t.Fatalf("moving_rail_left froze %d operations, want 2", len(movL))
	}
	assertFrontHole("moving_rail_left", movL[0], 33.5)
	assertFrontHole("moving_rail_left", movL[1], 65.5)

	movR := byMember["moving_rail_right"]
	if len(movR) != 2 {
		t.Fatalf("moving_rail_right froze %d operations, want 2", len(movR))
	}
	assertFrontHole("moving_rail_right", movR[0], 33.5)
	assertFrontHole("moving_rail_right", movR[1], 65.5)

	fijL := byMember["fixed_rail_left"]
	if len(fijL) != 6 {
		t.Fatalf("fixed_rail_left froze %d operations, want 6", len(fijL))
	}
	for i, wantDepth := range []float64{37, 69, 197, 229, 261, 293} {
		assertHoleWorld("fixed_rail_left", fijL[i], wantDepth, 33.5, 18, 0)
	}

	fijR := byMember["fixed_rail_right"]
	if len(fijR) != 6 {
		t.Fatalf("fixed_rail_right froze %d operations, want 6", len(fijR))
	}
	for i, wantDepth := range []float64{37, 69, 197, 229, 261, 293} {
		assertHoleWorld("fixed_rail_right", fijR[i], wantDepth, 33.5, moduleW-18, 0)
	}

	// The moving-rail holes must land on the frente_cajon board, the fixed
	// ones on their respective laterals.
	for _, op := range movL {
		if boardByID[op.HostComponentInstanceID].placement != string(domain.PlacementFrenteCajon) {
			t.Fatalf("front hole landed on %q", boardByID[op.HostComponentInstanceID].placement)
		}
	}
	if boardByID[fijL[0].HostComponentInstanceID].placement != string(domain.PlacementLateralIzquierdo) {
		t.Fatalf("left guide holes landed on %q", boardByID[fijL[0].HostComponentInstanceID].placement)
	}
	if boardByID[fijR[0].HostComponentInstanceID].placement != string(domain.PlacementLateralDerecho) {
		t.Fatalf("right guide holes landed on %q", boardByID[fijR[0].HostComponentInstanceID].placement)
	}
}

// memberHostCabinet is the carcase that hosts the drawer: both laterals and
// the drawer front (the placement roles the members declare), full-depth and
// full-height so the datum assertions stay simple.
func memberHostCabinet(w, h, d int) (domain.Module, domain.Catalog) {
	side := domain.Component{
		ID: "comp-side", Code: "LAT", Name: "Lateral", Placement: domain.PlacementLateralIzquierdo,
		GeometryKind: "rectangular_board", ThicknessMm: 18, OptionRoles: []string{"LATERAL"},
		LengthFormula: "PH", WidthFormula: "PD", Active: true,
	}
	sideR := side
	sideR.ID = "comp-side-r"
	sideR.Code = "LAT-R"
	sideR.Name = "Lateral Derecho"
	sideR.Placement = domain.PlacementLateralDerecho
	front := domain.Component{
		ID: "comp-front", Code: "FRE", Name: "Frente Cajón", Placement: domain.PlacementFrenteCajon,
		GeometryKind: "rectangular_board", ThicknessMm: 18, OptionRoles: []string{"FRENTE"},
		LengthFormula: "PH", WidthFormula: "PW", Active: true,
	}
	structure := domain.Structure{
		ID: "st-mbox", Code: "CUERPO-MBOX", Name: "Cuerpo MBOX", Active: true,
		Components: []domain.ComponentInstance{
			{ComponentID: "comp-side", Quantity: 1},
			{ComponentID: "comp-side-r", Quantity: 1},
			{ComponentID: "comp-front", Quantity: 1},
		},
	}
	module := domain.Module{
		ID: "mod-mbox", Code: "MOD-MBOX", Name: "Base MERIVOBOX",
		WidthMm: w, HeightMm: h, DepthMm: d,
		StructureID: "st-mbox",
	}
	catalog := domain.Catalog{
		Structures: []domain.Structure{structure},
		Components: []domain.Component{side, sideR, front},
	}
	return module, catalog
}

// forwardMapHole maps a frozen (face, xMm, yMm) hole back to workshop space
// through the same board-local chain the 3D placement projection uses
// (layout.go face switch + euler + group + render swap).
func forwardMapHole(board *layoutBoard, hole ResolveHole) [3]float64 {
	m := eulerXyzMatrix(board.rotX, board.rotY, board.rotZ)
	aabbMinR, _ := boardAABBRender(board)
	group := [3]float64{board.x - aabbMinR[0], board.z - aabbMinR[1], board.y - aabbMinR[2]}
	var local [3]float64
	switch hole.Face {
	case "front":
		local = [3]float64{hole.XMm, board.thicknessMm, hole.YMm}
	default: // back
		local = [3]float64{hole.XMm, 0, hole.YMm}
	}
	renderOffset := mulMatVec3(m, local)
	faceRender := [3]float64{
		group[0] + renderOffset[0],
		group[1] + renderOffset[1],
		group[2] + renderOffset[2],
	}
	return [3]float64{faceRender[0], faceRender[2], faceRender[1]} // render → workshop swap
}

func guideOps(diameter, depth float64) []domain.MachiningOperation {
	ops := make([]domain.MachiningOperation, 0, 6)
	for i, x := range []float64{37, 69, 197, 229, 261, 293} {
		ops = append(ops, domain.MachiningOperation{
			ID:         fmt.Sprintf("pilot-%d", i+1),
			Kind:       "screw_pilot",
			DiameterMm: diameter,
			DepthMm:    ptrFloat64(depth),
			XMm:        x,
			YMm:        33.5,
			Face:       "anchor",
		})
	}
	return ops
}

func ptrFloat64(v float64) *float64 { return &v }

func ptrProfile(p domain.HardwareMachiningProfile) *domain.HardwareMachiningProfile {
	return &p
}

// #1429 slice A — definition-level fail-closed: the hostPlacement vocabulary
// is closed and requires a fixed source; the derivation errors explicitly on
// a missing host board or hardware without a catalog machining profile.
func TestMemberHostValidationAndFailClosed(t *testing.T) {
	member := func(hostPlacement string, kind domain.RigidMemberSourceKind) domain.AgregadoRigidMember {
		return domain.AgregadoRigidMember{
			MemberID: "rail", Role: "fixed_rail",
			Source:        domain.RigidMemberSource{Kind: kind, Fixed: &domain.FixedHardwareSource{HardwareID: "hw-rail"}},
			BOMRole:       domain.BOMRoleNonPurchasing,
			HostPlacement: hostPlacement,
			Placement: domain.AssemblyAnchorRule{
				X: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
				Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
				Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
			},
		}
	}

	if err := domain.ValidateAgregadoRigidMember(member("lateral_izquierdo", domain.RigidMemberSourceFixed), false); err != nil {
		t.Fatalf("valid hostPlacement rejected: %v", err)
	}
	if err := domain.ValidateAgregadoRigidMember(member("puerta", domain.RigidMemberSourceFixed), false); err == nil {
		t.Fatalf("hostPlacement outside the closed vocabulary must be rejected")
	}
	if err := domain.ValidateAgregadoRigidMember(member("frente_cajon", domain.RigidMemberSourceVariant), false); err == nil {
		t.Fatalf("hostPlacement on a variant-sourced member must be rejected")
	}
	if err := domain.ValidateAgregadoRigidMember(member("", domain.RigidMemberSourceFixed), false); err != nil {
		t.Fatalf("empty hostPlacement must stay valid (historical behavior): %v", err)
	}

	// Derivation: a declared host with no matching board fails explicitly.
	layoutAssemblies := []LayoutAssembly{{
		AssemblyInstanceID: "asm-1",
		Placement:          map[string]any{"translation": []float64{0, 0, 0}},
		DimensionsMm:       [3]float64{400, 81, 500},
		RigidMembers: []domain.ResolvedRigidMember{{
			MemberID:   "rail",
			Role:       "fixed_rail",
			HardwareID: "hw-rail",
			LocalTransform: domain.AssemblyMemberTransform{
				TranslationMm: [3]float64{0, 136, 0},
				Basis:         domain.HardwareBasis{X: [3]float64{1, 0, 0}, Y: [3]float64{0, 1, 0}, Z: [3]float64{0, 0, 1}},
			},
			HostPlacement: "lateral_izquierdo",
		}},
	}}
	active := true
	catalog := domain.Catalog{Hardware: []domain.Hardware{{ID: "hw-rail", Code: "RAIL", Name: "Guía", Unit: domain.UnitPiece, Active: true}}}

	ops := []ResolvedMachiningOperation{}
	issues := []domain.ContractIssue{}
	deriveMemberHostMachining(layoutAssemblies, nil, catalog, &ops, &issues)
	found := false
	for _, issue := range issues {
		if issue.Code == "MEMBER_HOST_PLACEMENT_MISSING" {
			found = true
		}
	}
	if !found || len(ops) != 0 {
		t.Fatalf("missing host board must fail closed with zero holes (issues=%+v, ops=%d)", issues, len(ops))
	}

	// Hardware without a catalog profile fails closed too.
	ops, issues = []ResolvedMachiningOperation{}, []domain.ContractIssue{}
	catalogNoProfile := domain.Catalog{Hardware: []domain.Hardware{{ID: "hw-rail", Code: "RAIL", Name: "Guía", Unit: domain.UnitPiece, Active: active}}}
	_ = catalogNoProfile.Hardware[0]
	deriveMemberHostMachining(layoutAssemblies, []layoutBoard{{id: "b1", placement: "lateral_izquierdo", x: 0, thicknessMm: 18, widthMm: 500, lengthMm: 720}}, catalog, &ops, &issues)
	found = false
	for _, issue := range issues {
		if issue.Code == "MEMBER_HOST_PROFILE_REQUIRED" {
			found = true
		}
	}
	if !found || len(ops) != 0 {
		t.Fatalf("missing profile must fail closed with zero holes (issues=%+v, ops=%d)", issues, len(ops))
	}
}

// #1429 slice B — dedupe con placements manuales equivalentes: la autoría
// explícita del owner manda. Un placement manual que ya autoró el MISMO
// agujero (misma pieza anfitriona, cara, centro ±0.1mm, diámetro y
// profundidad) suprime la operación member-host equivalente; los agujeros NO
// equivalentes conviven y el gate DRILLING_CONFLICT sigue fail-closed.
func TestDedupeMemberHostManualEquivalents(t *testing.T) {
	memberHostOp := func(id, host string, face string, x, y, diam, depth float64) ResolvedMachiningOperation {
		return ResolvedMachiningOperation{
			OperationID:             id,
			HostComponentInstanceID: host,
			Provenance: ResolvedMachiningProvenance{
				SourceKind: "assemblyMemberHost", AssemblyInstanceID: "asm-1", MemberID: "rail",
			},
			Holes: []ResolveHole{{Face: face, XMm: x, YMm: y, DiameterMm: diam, DepthMm: depth, Type: "screw"}},
		}
	}
	manualOp := func(id, host string, face string, x, y, diam, depth float64) ResolvedMachiningOperation {
		return ResolvedMachiningOperation{
			OperationID:             id,
			HostComponentInstanceID: host,
			Provenance: ResolvedMachiningProvenance{
				SourceKind: "manualHardwarePlacement", HardwarePlacementID: id,
			},
			Holes: []ResolveHole{{Face: face, XMm: x, YMm: y, DiameterMm: diam, DepthMm: depth, Type: "screw"}},
		}
	}

	t.Run("placement manual equivalente suprime el member-host duplicado", func(t *testing.T) {
		ops := []ResolvedMachiningOperation{
			memberHostOp("asm-1:rail:b1:op-1", "b1", "front", 37, 33.5, 3.2, 12),
			memberHostOp("asm-1:rail:b1:op-2", "b1", "front", 69, 33.5, 3.2, 12),
			manualOp("hp-1", "b1", "front", 37.05, 33.52, 3.2, 12.05),
		}
		kept := dedupeMemberHostManualEquivalents(ops)
		if len(kept) != 2 {
			t.Fatalf("kept %d ops, want 2 (manual + the non-equivalent member-host): %+v", len(kept), kept)
		}
		if kept[0].OperationID != "asm-1:rail:b1:op-2" || kept[1].OperationID != "hp-1" {
			t.Fatalf("wrong survivors: %+v", kept)
		}
	})

	t.Run("misma posición con otra profundidad NO es equivalente (gate fail-closed)", func(t *testing.T) {
		ops := []ResolvedMachiningOperation{
			memberHostOp("asm-1:rail:b1:op-1", "b1", "front", 37, 33.5, 3.2, 12),
			manualOp("hp-1", "b1", "front", 37, 33.5, 3.2, 15),
		}
		kept := dedupeMemberHostManualEquivalents(ops)
		if len(kept) != 2 {
			t.Fatalf("both operations must survive a depth mismatch, got %d", len(kept))
		}
	})

	t.Run("sin placements manuales el conjunto queda intacto", func(t *testing.T) {
		ops := []ResolvedMachiningOperation{
			memberHostOp("asm-1:rail:b1:op-1", "b1", "front", 37, 33.5, 3.2, 12),
		}
		kept := dedupeMemberHostManualEquivalents(ops)
		if len(kept) != 1 || kept[0].OperationID != "asm-1:rail:b1:op-1" {
			t.Fatalf("no manual placements must keep the member-host op: %+v", kept)
		}
	})
}

// TestMemberHostManualPlacementDedupeEndToEnd (#1429 slice B): through the
// REAL boundary — a manual HER-TOR-3X20 placement authored exactly on one of
// the fixed rail's Blum rows suppresses that member-host duplicate while the
// rest of the guide rows keep drilling, with zero DRILLING_CONFLICT issues.
func TestMemberHostManualPlacementDedupeEndToEnd(t *testing.T) {
	const (
		moduleW = 400.0
		moduleH = 720.0
		moduleD = 500.0
	)

	// Profile matches the manual table entry HER-TOR-3X20 (screw Ø3×15) so a
	// manual placement CAN be equivalent to a member-host hole.
	guideProfile := domain.HardwareMachiningProfile{Parts: []domain.HardwareMachiningPart{{
		ID: "pilot", Role: "screw", Operations: guideOps(3, 15),
	}}}
	frontProfile := func(sign float64) domain.HardwareMachiningProfile {
		return domain.HardwareMachiningProfile{Parts: []domain.HardwareMachiningPart{{
			ID: "pilot", Role: "screw",
			Operations: []domain.MachiningOperation{
				{ID: "pilot-low", Kind: "screw_pilot", DiameterMm: 2.7, DepthMm: ptrFloat64(8), XMm: 20.5 * sign, YMm: 33.5, Face: "anchor"},
				{ID: "pilot-high", Kind: "screw_pilot", DiameterMm: 2.7, DepthMm: ptrFloat64(8), XMm: 20.5 * sign, YMm: 65.5, Face: "anchor"},
			},
		}}}
	}

	agr := domain.Agregado{
		ID: "agr-mbox", Code: "CAJON-MBOX", Name: "Cajón MERIVOBOX", Active: true,
		WidthMm: int(moduleW), HeightMm: 81, DepthMm: int(moduleD),
		RigidMembers: []domain.AgregadoRigidMember{
			{
				MemberID: "fixed_rail_left", Role: "fixed_rail",
				Source:        domain.RigidMemberSource{Kind: domain.RigidMemberSourceFixed, Fixed: &domain.FixedHardwareSource{HardwareID: "hw-rail-fij-l"}},
				BOMRole:       domain.BOMRoleNonPurchasing,
				HostPlacement: "lateral_izquierdo",
				Placement: domain.AssemblyAnchorRule{
					X: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
					Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 136},
					Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
				},
			},
			{
				MemberID: "moving_rail_left", Role: "moving_rail",
				Source:        domain.RigidMemberSource{Kind: domain.RigidMemberSourceFixed, Fixed: &domain.FixedHardwareSource{HardwareID: "hw-rail-mov-l"}},
				BOMRole:       domain.BOMRoleNonPurchasing,
				HostPlacement: "frente_cajon",
				Placement: domain.AssemblyAnchorRule{
					X: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
					Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
					Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
				},
			},
		},
	}

	rails := []domain.Hardware{
		{ID: "hw-rail-fij-l", Code: "RAIL-FIJ-L", Name: "Guía fija izquierda", Unit: domain.UnitPiece, Active: true, Machining: &guideProfile},
		{ID: "hw-rail-mov-l", Code: "RAIL-MOV-L", Name: "Corredera móvil izquierda", Unit: domain.UnitPiece, Active: true, Machining: ptrProfile(frontProfile(1))},
		{ID: "HER-TOR-3X20", Code: "HER-TOR-3X20", Name: "Tornillo 3x20", Unit: domain.UnitPiece, Active: true},
	}

	module, catalog := memberHostCabinet(int(moduleW), int(moduleH), int(moduleD))
	catalog.Agregados = append(catalog.Agregados, agr)
	catalog.Hardware = append(catalog.Hardware, rails...)
	module.Agregados = []domain.ModuleAgregadoInstance{{AgregadoID: "agr-mbox", Quantity: 1}}
	dims := &LayoutDims{WidthMm: int(moduleW), HeightMm: int(moduleH), DepthMm: int(moduleD)}

	// Pass 1: no manual placements — collect the member-host holes of the
	// fixed left rail to author the equivalent manual placement on top.
	first, err := ResolveAuthoringLayout(AuthoringResolveInput{
		Module: module, Catalog: catalog, Dims: dims,
	})
	if err != nil {
		t.Fatalf("pass-1 resolve: %v", err)
	}
	var target *ResolvedMachiningOperation
	for i := range first.Machining.Operations {
		op := &first.Machining.Operations[i]
		if op.Provenance.SourceKind == "assemblyMemberHost" && op.Provenance.MemberID == "fixed_rail_left" {
			target = op
			break
		}
	}
	if target == nil || len(target.Holes) != 1 {
		t.Fatalf("pass 1 produced no member-host hole for fixed_rail_left: %+v", first.Machining.Operations)
	}
	hole := target.Holes[0]

	// Pass 2: the owner additionally authors a manual placement at the SAME
	// spot (face + panel-local offsets read from the member-host hole).
	second, err := ResolveAuthoringLayout(AuthoringResolveInput{
		Module: module, Catalog: catalog, Dims: dims,
		ManualPlacements: []AuthoringManualPlacement{{
			HardwarePlacementID:     "hp-equiv",
			CatalogHardwareID:       "HER-TOR-3X20",
			HostComponentInstanceID: target.HostComponentInstanceID,
			AnchorFace:              hole.Face,
			OffsetMm:                [2]float64{hole.XMm, hole.YMm},
		}},
		ManualPlacementsPresent: true,
	})
	if err != nil {
		t.Fatalf("pass-2 resolve: %v", err)
	}
	countAtSpot := 0
	survivors := 0
	for _, op := range second.Machining.Operations {
		if op.Provenance.SourceKind == "assemblyMemberHost" && op.Provenance.MemberID == "fixed_rail_left" {
			survivors++
		}
		if op.Provenance.SourceKind == "manualHardwarePlacement" && op.Provenance.HardwarePlacementID == "" {
			t.Fatalf("manual op lost its identity: %+v", op)
		}
		if op.Provenance.SourceKind == "manualHardwarePlacement" &&
			op.HostComponentInstanceID == target.HostComponentInstanceID &&
			len(op.Holes) == 1 &&
			op.Holes[0].Face == hole.Face && op.Holes[0].XMm == hole.XMm && op.Holes[0].YMm == hole.YMm {
			countAtSpot++
		}
	}
	if survivors != 5 {
		t.Fatalf("fixed_rail_left must keep its 5 non-equivalent holes, got %d", survivors)
	}
	if countAtSpot != 1 {
		t.Fatalf("the equivalent hole must appear exactly ONCE (the manual op), got %d", countAtSpot)
	}
	for _, issue := range second.ValidationIssues {
		if issue.Code == "DRILLING_CONFLICT" {
			t.Fatalf("equivalent holes must not collide: %+v", issue)
		}
	}
}

// #1512 M3: the right-hand mirror uses the repo hole-CENTER convention
// (x' = HW − x) — a center-symmetric hole maps to itself; non-hole kinds
// fail closed with ok=false (no invented mapping).
func TestMirrorMachiningProfileForRightHand_1512(t *testing.T) {
	profile := &domain.HardwareMachiningProfile{
		Parts: []domain.HardwareMachiningPart{
			{
				ID:   "p1",
				Role: "cup",
				Operations: []domain.MachiningOperation{
					{ID: "cup", Kind: "blind_hole", DiameterMm: 35, DepthMm: ptrFloat64(12.5), XMm: 0, YMm: 9, Label: "Taza"},
					{ID: "pilot", Kind: "through_hole", DiameterMm: 5, XMm: 45.5, YMm: 9},
				},
			},
		},
	}

	mirrored, ok := mirrorMachiningProfileForRightHand(profile, 91)
	if !ok {
		t.Fatal("hole-only profile must mirror")
	}
	ops := mirrored.Parts[0].Operations
	if ops[0].XMm != 91 {
		t.Fatalf("cup center x = %g, want 91 (91 − 0: centro se espeja al lado opuesto)", ops[0].XMm)
	}
	if ops[1].XMm != 45.5 {
		t.Fatalf("pilot center x = %g, want 45.5 (auto-simétrico: 91 − 45.5)", ops[1].XMm)
	}
	if ops[0].DepthMm == nil || *ops[0].DepthMm != 12.5 {
		t.Fatalf("depth must ride unchanged, got %v", ops[0].DepthMm)
	}
	if ops[0].Label != "Taza" {
		t.Fatalf("label must ride unchanged, got %q", ops[0].Label)
	}

	nonHole := &domain.HardwareMachiningProfile{
		Parts: []domain.HardwareMachiningPart{
			{ID: "p1", Operations: []domain.MachiningOperation{{ID: "g1", Kind: "groove", XMm: 10}}},
		},
	}
	if _, ok := mirrorMachiningProfileForRightHand(nonHole, 91); ok {
		t.Fatal("non-hole kinds must fail closed (ok=false), never invent a mapping")
	}
}

// #1554: the right-hand mirror runs INSIDE the member-host derivation. A
// member with Hand=right whose hardware carries a non-hole kind (counterbore
// — valid vocabulary, outside the mirror whitelist) fails closed with the
// exact issue code and emits ZERO member-host holes — never a partial mirror
// (the cup hole mirrored while the bore was silently dropped).
func TestMemberHostHandRightMirrorFailClosed_1554(t *testing.T) {
	agr := domain.Agregado{
		ID: "agr-mbox", Code: "CAJON-MBOX", Name: "Cajón MERIVOBOX", Active: true,
		WidthMm: 400, HeightMm: 81, DepthMm: 500,
		RigidMembers: []domain.AgregadoRigidMember{{
			MemberID: "hand_rail", Role: "fixed_rail",
			Source:        domain.RigidMemberSource{Kind: domain.RigidMemberSourceFixed, Fixed: &domain.FixedHardwareSource{HardwareID: "hw-canon-cb"}},
			BOMRole:       domain.BOMRoleNonPurchasing,
			HostPlacement: string(domain.PlacementLateralIzquierdo),
			Hand:          "right",
			Placement: domain.AssemblyAnchorRule{
				X: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
				Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 136},
				Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
			},
		}},
	}
	hw := domain.Hardware{
		ID: "hw-canon-cb", Code: "RAIL-CANON-CB", Name: "Guía canónica con escariado",
		Unit: domain.UnitPiece, Active: true,
		Dimensions: &domain.HardwareDimensions{WidthMm: 91},
		Machining: ptrProfile(domain.HardwareMachiningProfile{Parts: []domain.HardwareMachiningPart{{
			ID: "pilot", Role: "cup",
			Operations: []domain.MachiningOperation{
				{ID: "cup", Kind: "blind_hole", DiameterMm: 35, DepthMm: ptrFloat64(12), XMm: 45.5, YMm: 9},
				{ID: "bore", Kind: "counterbore", DiameterMm: 5, DepthMm: ptrFloat64(4), XMm: 45.5, YMm: 9},
			},
		}}}),
	}
	module, catalog := memberHostCabinet(400, 720, 500)
	catalog.Agregados = append(catalog.Agregados, agr)
	catalog.Hardware = append(catalog.Hardware, hw)
	module.Agregados = []domain.ModuleAgregadoInstance{{AgregadoID: "agr-mbox", Quantity: 1}}

	result, err := ResolveAuthoringLayout(AuthoringResolveInput{
		Module:  module,
		Catalog: catalog,
		Dims:    &LayoutDims{WidthMm: 400, HeightMm: 720, DepthMm: 500},
	})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	found := false
	for _, issue := range result.ValidationIssues {
		if issue.Code == "MEMBER_HOST_HAND_MIRROR_UNSUPPORTED_KIND" {
			found = true
		}
		if issue.Code == "DRILLING_CONFLICT" {
			t.Fatalf("a partial mirror must never exist, let alone collide: %+v", issue)
		}
	}
	if !found {
		t.Fatalf("expected MEMBER_HOST_HAND_MIRROR_UNSUPPORTED_KIND, got: %+v", result.ValidationIssues)
	}
	for _, op := range result.Machining.Operations {
		if op.Provenance.SourceKind == "assemblyMemberHost" {
			t.Fatalf("fail-closed member must emit ZERO member-host holes: %+v", op)
		}
	}
}

// #1518 F1 (regresión del bug pos:, review P1): una parte de kit MULTI-PIEZA
// cuyo designParts[0].label trae pos: NO debe ver su placement pisado — el
// placement sale de la pieza del catálogo (ancla + offsets); el label único
// solía aplastar ambos lados al mismo X (SKPs superpuestos).
func TestKitPieceMemberIgnoresPosLabel_1518(t *testing.T) {
	kitID := "kit-m"
	hw := domain.Hardware{
		ID:            "hw-perfil-m",
		Code:          "MBOX-IGM-M",
		Name:          "Perfil MERIVOBOX M",
		KitHardwareID: &kitID,
		Active:        true,
		Pieces: []domain.HardwarePiece{
			{Anchor: domain.MemberHandLeft, OffsetMm: &domain.HardwarePieceOffset{X: 8, Y: 0, Z: 100}},
			{Anchor: domain.MemberHandRight, OffsetMm: &domain.HardwarePieceOffset{X: 12, Y: 0, Z: 100}},
		},
		DesignParts: []domain.HardwareDesignPart{
			// Label del editor de posición (el que antes pisaba ambos lados).
			{ComponentName: "MBOX-IGM-M", ActorMembership: "body", Label: "pos:min:10:0:0"},
		},
	}
	catalog := domain.Catalog{Hardware: []domain.Hardware{hw}}
	agr := domain.Agregado{ID: "agr-x", Code: "AGR-X"}
	got := syncAgregadoRigidMembersFromCatalog(agr, catalog, kitID)

	if len(got.RigidMembers) != 2 {
		t.Fatalf("members = %d, want 2 (uno por pieza)", len(got.RigidMembers))
	}
	for _, m := range got.RigidMembers {
		if m.Hand == domain.MemberHandLeft {
			if m.Placement.X.Ref != domain.AxisRefMin || m.Placement.X.OffsetMm != 8 {
				t.Errorf("left: X = %v/%g, want min/8 (offset de LA PIEZA, no del label 10)",
					m.Placement.X.Ref, m.Placement.X.OffsetMm)
			}
			if m.Placement.Z.OffsetMm != 100 {
				t.Errorf("left: Z = %g, want 100 (offset de la pieza)", m.Placement.Z.OffsetMm)
			}
		}
		if m.Hand == domain.MemberHandRight {
			// #1613: la pieza right declara X=12 → max−12 (positivo = hacia
			// adentro desde el ancla; el ancla right niega).
			if m.Placement.X.Ref != domain.AxisRefMax || m.Placement.X.OffsetMm != -12 {
				t.Errorf("right: X = %v/%g, want max/-12 (offset de LA PIEZA negado en right; el label min lo colapsaba)",
					m.Placement.X.Ref, m.Placement.X.OffsetMm)
			}
		}
	}
}

// #1518 F1 (review follow-up): el gate del pos: sobre MIEMBROS EXISTENTES —
// una receta guardada con label pos:min y dos miembros multi-pieza conserva
// su placement por pieza al re-sincronizar (el label nunca los colapsa).
func TestSyncKeepsPiecePlacementOnExistingMembers_1518(t *testing.T) {
	kitID := "kit-m"
	hw := domain.Hardware{
		ID:            "hw-perfil-m",
		Code:          "MBOX-IGM-M",
		Name:          "Perfil MERIVOBOX M",
		KitHardwareID: &kitID,
		Active:        true,
		Pieces: []domain.HardwarePiece{
			{Anchor: domain.MemberHandLeft, OffsetMm: &domain.HardwarePieceOffset{X: 8}},
			{Anchor: domain.MemberHandRight, OffsetMm: &domain.HardwarePieceOffset{X: 12}},
		},
		DesignParts: []domain.HardwareDesignPart{
			{ComponentName: "MBOX-IGM-M", ActorMembership: "body", Label: "pos:min:10:0:0"},
		},
	}
	catalog := domain.Catalog{Hardware: []domain.Hardware{hw}}
	agr := domain.Agregado{ID: "agr-x", Code: "AGR-X", RigidMembers: []domain.AgregadoRigidMember{
		{
			MemberID: "part_mbox_igm_m_left",
			Role:     "slide",
			Source: domain.RigidMemberSource{
				Kind:  domain.RigidMemberSourceFixed,
				Fixed: &domain.FixedHardwareSource{HardwareID: "hw-perfil-m"},
			},
			Placement: domain.AssemblyAnchorRule{
				X: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 8},
				Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
				Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 100},
			},
			BOMRole:         domain.BOMRoleIncludedInKit,
			ActorMembership: "body",
			Hand:            domain.MemberHandLeft,
		},
		{
			MemberID: "part_mbox_igm_m_right",
			Role:     "slide",
			Source: domain.RigidMemberSource{
				Kind:  domain.RigidMemberSourceFixed,
				Fixed: &domain.FixedHardwareSource{HardwareID: "hw-perfil-m"},
			},
			Placement: domain.AssemblyAnchorRule{
				X: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMax, OffsetMm: 12},
				Y: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin},
				Z: domain.AssemblyAxisPlacement{Ref: domain.AxisRefMin, OffsetMm: 100},
			},
			BOMRole:         domain.BOMRoleIncludedInKit,
			ActorMembership: "body",
			Hand:            domain.MemberHandRight,
		},
	}}

	got := syncAgregadoRigidMembersFromCatalog(agr, catalog, kitID)
	if len(got.RigidMembers) != 2 {
		t.Fatalf("members = %d, want 2", len(got.RigidMembers))
	}
	for _, m := range got.RigidMembers {
		wantRef, wantOff := domain.AxisRefMin, 8.0
		if m.Hand == domain.MemberHandRight {
			wantRef, wantOff = domain.AxisRefMax, 12.0
		}
		if m.Placement.X.Ref != wantRef || m.Placement.X.OffsetMm != wantOff {
			t.Errorf("%s: X = %v/%g, want %v/%g (el label pos:min NO pisa el placement por pieza)",
				m.MemberID, m.Placement.X.Ref, m.Placement.X.OffsetMm, wantRef, wantOff)
		}
	}
}
