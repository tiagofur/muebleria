package engine

import (
	"fmt"
	"math"
	"strings"

	"github.com/tiagofur/muebles-backend/internal/domain"
)

// #1429 slice A — member-declared external hosts. A rigid member whose recipe
// declares `hostPlacement` drills the module board carrying that placement
// with the member hardware's CATALOG machining profile (hw.Machining). The
// truth lives in the agregado recipe: compose a module with the drawer and
// the front/carcase drilling follows automatically — no per-module authoring.
//
// Datum contract per host role (op.XMm / op.YMm of each profile operation):
//   - frente_cajon (moving rail → drawer front): XMm = lateral offset from
//     the member's x anchor toward the drawer interior (min anchor ⇒ +20.5,
//     max anchor ⇒ −20.5), YMm = height from the HOST PANEL's bottom edge
//     (Blum mide la fijación frontal desde la arista inferior del frente:
//     33.5 / 65.5 quedan panel-locales sea cual sea el recubrimiento).
//   - lateral_izquierdo / lateral_derecho (fixed rail → carcase side):
//     XMm = distance from the drawer's FRONT plane toward the back (Blum
//     guide rows 37/69/197/229/261/293), YMm = height above the drawer bottom
//     (Blum 33.5 over the carcase bottom the drawer sits on).
//
// The entry face is the board face whose outward normal points toward the
// drawer interior, and the hole's (face, xMm, yMm) ride the SAME board-local
// frame the 3D placement projection uses (euler + group + render swap) —
// CNC and preview can never disagree on where the hole sits. Fail-closed: a
// declared host with no matching board, a non-identity member basis, or
// hardware without an active catalog profile yields an explicit error issue
// and never an invented hole.
func deriveMemberHostMachining(
	assemblies []LayoutAssembly,
	boards []layoutBoard,
	catalog domain.Catalog,
	operations *[]ResolvedMachiningOperation,
	issues *[]domain.ContractIssue,
) {
	for _, assembly := range assemblies {
		origin, ok := assemblyTranslation(assembly)
		if !ok {
			continue
		}
		width, _, depth := assembly.DimensionsMm[0], assembly.DimensionsMm[1], assembly.DimensionsMm[2]
		frontPlaneY := origin[1] + depth
		drawerCenter := [3]float64{
			origin[0] + width/2,
			frontPlaneY - depth/2,
			origin[2],
		}
		for _, member := range assembly.RigidMembers {
			hostPlacement := strings.TrimSpace(memberHostPlacement(member))
			if hostPlacement == "" {
				continue
			}
			memberID, hardwareID := memberHostIdentity(member)
			hw, ok := findHardware(catalog, hardwareID)
			if !ok || !hw.Active {
				*issues = append(*issues, domain.ContractIssue{
					Code: "MEMBER_HOST_PROFILE_REQUIRED",
					Message: fmt.Sprintf("el miembro %s declara hostPlacement %q pero su herraje %s no existe o está inactivo",
						memberID, hostPlacement, hardwareID),
					Severity:    domain.IssueSeverityError,
					EntityID:    memberID,
					Path:        fmt.Sprintf("furniture.assemblies[assemblyInstanceId=%s].rigidMembers[memberId=%s]", assembly.AssemblyInstanceID, memberID),
					Remediation: "Activa el herraje del miembro o quita el hostPlacement de la receta.",
				})
				continue
			}
			if !memberBasisIsIdentity(member) {
				*issues = append(*issues, domain.ContractIssue{
					Code: "MEMBER_HOST_BASIS_UNSUPPORTED",
					Message: fmt.Sprintf("el miembro %s declara hostPlacement %q con una base rotada; el slice A sólo proyecta miembros alineados a ejes",
						memberID, hostPlacement),
					Severity:    domain.IssueSeverityError,
					EntityID:    memberID,
					Path:        fmt.Sprintf("furniture.assemblies[assemblyInstanceId=%s].rigidMembers[memberId=%s]", assembly.AssemblyInstanceID, memberID),
					Remediation: "Deja el miembro sin rotación o proyecta sus taladros con un placement manual.",
				})
				continue
			}
			hosts := make([]*layoutBoard, 0, 2)
			for i := range boards {
				if boards[i].placement == hostPlacement {
					hosts = append(hosts, &boards[i])
				}
			}
			if len(hosts) == 0 {
				*issues = append(*issues, domain.ContractIssue{
					Code: "MEMBER_HOST_PLACEMENT_MISSING",
					Message: fmt.Sprintf("el miembro %s declara hostPlacement %q pero el mueble no tiene ninguna pieza con ese rol",
						memberID, hostPlacement),
					Severity:    domain.IssueSeverityError,
					EntityID:    memberID,
					Path:        fmt.Sprintf("furniture.assemblies[assemblyInstanceId=%s].rigidMembers[memberId=%s]", assembly.AssemblyInstanceID, memberID),
					Remediation: "Agrega la pieza al módulo con ese placement o corrige el hostPlacement de la receta.",
				})
				continue
			}
			profile := hw.Machining
			if profile == nil || len(profile.Parts) == 0 {
				*issues = append(*issues, domain.ContractIssue{
					Code: "MEMBER_HOST_PROFILE_REQUIRED",
					Message: fmt.Sprintf("el miembro %s declara hostPlacement %q pero el herraje %s no lleva perfil de mecanizado en catálogo",
						memberID, hostPlacement, hw.Code),
					Severity:    domain.IssueSeverityError,
					EntityID:    memberID,
					Path:        fmt.Sprintf("furniture.assemblies[assemblyInstanceId=%s].rigidMembers[memberId=%s]", assembly.AssemblyInstanceID, memberID),
					Remediation: "Agrega el perfil de mecanizado al herraje o quita el hostPlacement de la receta.",
				})
				continue
			}
			// #1512 M3: a right-hand member consumes the LEFT-canonical
			// catalog profile mirrored — hole center x' = HW − x (XMm is the
			// hole CENTER in the repo convention; see the mirror helper).
			// Requires the canonical hardware width; non-hole kinds fail
			// closed (no invented mapping).
			if member.Hand == domain.MemberHandRight {
				widthMm, _, _ := HardwareFormulaDims(&hw)
				if widthMm <= 0 {
					*issues = append(*issues, domain.ContractIssue{
						Code: "MEMBER_HOST_HAND_MIRROR_REQUIRES_DIMENSIONS",
						Message: fmt.Sprintf("el miembro %s declara hand right pero el herraje %s no tiene ancho canónico (dimensions W) para espejar su perfil",
							memberID, hw.Code),
						Severity:    domain.IssueSeverityError,
						EntityID:    memberID,
						Path:        fmt.Sprintf("furniture.assemblies[assemblyInstanceId=%s].rigidMembers[memberId=%s]", assembly.AssemblyInstanceID, memberID),
						Remediation: "Declara dimensions W×H×D en el herraje o usa el perfil por separado por mano.",
					})
					continue
				}
				mirrored, ok := mirrorMachiningProfileForRightHand(profile, widthMm)
				if !ok {
					*issues = append(*issues, domain.ContractIssue{
						Code: "MEMBER_HOST_HAND_MIRROR_UNSUPPORTED_KIND",
						Message: fmt.Sprintf("el miembro %s declara hand right y el herraje %s lleva operaciones no-taladro en su perfil: el espejo v1 sólo cubre holes",
							memberID, hw.Code),
						Severity:    domain.IssueSeverityError,
						EntityID:    memberID,
						Path:        fmt.Sprintf("furniture.assemblies[assemblyInstanceId=%s].rigidMembers[memberId=%s]", assembly.AssemblyInstanceID, memberID),
						Remediation: "Declara el perfil por mano (herrajes separados) o usa sólo operaciones de taladro.",
					})
					continue
				}
				profile = mirrored
			}
			for _, part := range profile.Parts {
				for _, op := range part.Operations {
					holeWorld, ok := memberHostHoleWorld(op, member, origin, frontPlaneY)
					if !ok {
						continue
					}
					for _, board := range hosts {
						hole, ok := memberHostHoleOnBoard(op, part, hw, board, holeWorld, drawerCenter, hostPlacement)
						if !ok {
							continue
						}
						if hole.DepthMm > board.thicknessMm {
							*issues = append(*issues, domain.ContractIssue{
								Code: "DRILLING_CONFLICT",
								Message: fmt.Sprintf("el herraje %s taladra %.2fmm en la pieza %q de %.2fmm (miembro %s)",
									hw.Code, hole.DepthMm, board.name, board.thicknessMm, memberID),
								Severity:    domain.IssueSeverityError,
								EntityID:    memberID,
								Path:        fmt.Sprintf("furniture.assemblies[assemblyInstanceId=%s].rigidMembers[memberId=%s]", assembly.AssemblyInstanceID, memberID),
								Remediation: "Usa un piloto que quepa en el espesor de la pieza anfitriona.",
								Details: map[string]any{
									"pilotDepthMm":    hole.DepthMm,
									"hostThicknessMm": board.thicknessMm,
								},
							})
						}
						*operations = append(*operations, ResolvedMachiningOperation{
							OperationID:             fmt.Sprintf("%s:%s:%s:op-%s", assembly.AssemblyInstanceID, memberID, board.id, op.ID),
							HostComponentInstanceID: board.id,
							Provenance: ResolvedMachiningProvenance{
								SourceKind:         "assemblyMemberHost",
								AssemblyInstanceID: assembly.AssemblyInstanceID,
								MemberID:           memberID,
							},
							Holes: []ResolveHole{hole},
						})
					}
				}
			}
		}
	}
}

// dedupeMemberHostManualEquivalents (#1429 slice B) suppresses member-host
// operations whose hole was already authored by an EXPLICIT manual placement
// on the same host board: the owner's authoring wins, so an equivalent hole
// neither duplicates in the output nor false-collides in the gate.
// Equivalence = same host board, same face, center within 0.1mm, diameter
// and depth within 0.1mm — the same tolerance the TS deduplicateHoles
// applies (partDrillingResolver). Non-equivalent holes keep BOTH operations
// and the collision gate stays fail-closed: another depth at the same spot
// is a physical contradiction, never a silent merge.
func dedupeMemberHostManualEquivalents(operations []ResolvedMachiningOperation) []ResolvedMachiningOperation {
	manualHoles := make(map[string][]ResolveHole)
	for _, op := range operations {
		if op.Provenance.SourceKind != "manualHardwarePlacement" {
			continue
		}
		manualHoles[op.HostComponentInstanceID] = append(manualHoles[op.HostComponentInstanceID], op.Holes...)
	}
	if len(manualHoles) == 0 {
		return operations
	}
	equivalent := func(h ResolveHole, candidates []ResolveHole) bool {
		for _, m := range candidates {
			if h.Face != m.Face {
				continue
			}
			if math.Abs(h.XMm-m.XMm) > 0.1 || math.Abs(h.YMm-m.YMm) > 0.1 {
				continue
			}
			if math.Abs(h.DiameterMm-m.DiameterMm) > 0.1 || math.Abs(h.DepthMm-m.DepthMm) > 0.1 {
				continue
			}
			return true
		}
		return false
	}
	kept := make([]ResolvedMachiningOperation, 0, len(operations))
	for _, op := range operations {
		if op.Provenance.SourceKind == "assemblyMemberHost" &&
			len(op.Holes) == 1 &&
			equivalent(op.Holes[0], manualHoles[op.HostComponentInstanceID]) {
			continue
		}
		kept = append(kept, op)
	}
	return kept
}

// memberHostPlacement reads the declared external host from either the new
// typed field or the wire payload (snake/camel on read paths that rebuild
// members from JSON).
func memberHostPlacement(member domain.ResolvedRigidMember) string {
	return member.HostPlacement
}

// mirrorMachiningProfileForRightHand (#1512 M3) mirrors a LEFT-canonical
// catalog profile for a right-hand member. XMm is the hole CENTER in the
// hardware frame (repo convention: seed fixtures and the Ruby projector both
// place circles at radius ⌀/2 centered on x_mm), so the mirror is
// x' = HW − x — a center-symmetric hole (x = HW/2) maps to itself. Depth,
// inner diameter and label ride unchanged. Returns ok=false when any
// operation is not a hole kind — the mirror never invents a mapping.
func mirrorMachiningProfileForRightHand(profile *domain.HardwareMachiningProfile, hardwareWidthMm float64) (*domain.HardwareMachiningProfile, bool) {
	mirrored := &domain.HardwareMachiningProfile{}
	mirrored.Parts = make([]domain.HardwareMachiningPart, len(profile.Parts))
	for pi, part := range profile.Parts {
		out := domain.HardwareMachiningPart{ID: part.ID, Role: part.Role}
		out.Operations = make([]domain.MachiningOperation, len(part.Operations))
		for oi, op := range part.Operations {
			kind := strings.ToLower(strings.TrimSpace(op.Kind))
			// Round-hole kinds only (the repo vocabulary): blind/through holes
			// and screw pilots (the Blum datum profiles use screw_pilot).
			// Anything else (grooves, slots) fails closed — no invented mapping.
			if kind != "blind_hole" && kind != "through_hole" && kind != "hole" && kind != "screw_pilot" {
				return nil, false
			}
			mirrored := op
			mirrored.XMm = hardwareWidthMm - op.XMm
			out.Operations[oi] = mirrored
		}
		mirrored.Parts[pi] = out
	}
	return mirrored, true
}

// memberHostIdentity resolves the member's id and its already-resolved
// hardware id (variant sources resolve to their selected hardware before the
// derivation runs; they declare no external host — validated at definition).
func memberHostIdentity(member domain.ResolvedRigidMember) (string, string) {
	return member.MemberID, member.HardwareID
}

func memberBasisIsIdentity(member domain.ResolvedRigidMember) bool {
	b := member.LocalTransform.Basis
	return b.X == [3]float64{1, 0, 0} && b.Y == [3]float64{0, 1, 0} && b.Z == [3]float64{0, 0, 1}
}

// memberHostHoleWorld resolves the hole's workshop position from one profile
// operation under the role datum contract. For frente_cajon hosts the depth
// axis is irrelevant (the in-face axes are width and height); for lateral
// hosts XMm measures from the drawer's front plane toward the back.
func memberHostHoleWorld(op domain.MachiningOperation, member domain.ResolvedRigidMember, origin [3]float64, frontPlaneY float64) ([3]float64, bool) {
	mt := member.LocalTransform.TranslationMm
	world := [3]float64{
		origin[0] + mt[0] + op.XMm,
		0,
		0, // frente_cajon hosts override the height axis panel-locally (see memberHostHoleOnBoard)
	}
	if strings.TrimSpace(member.HostPlacement) == string(domain.PlacementFrenteCajon) {
		world[1] = origin[1] + mt[1]
		return world, true
	}
	world[1] = frontPlaneY - op.XMm
	world[2] = origin[2] + mt[2] + op.YMm
	return world, true
}

// memberHostHoleOnBoard maps the hole's workshop position onto the host
// board's drilling frame: the entry face is the ±thickness face whose world
// normal points toward the drawer interior, and (xMm, yMm) ride the SAME
// board-local axes the 3D placement projection publishes (x along width,
// y along length, unmirrored — layout.go face switch). The second return is
// false when the hole falls outside the face's in-plane bounds.
func memberHostHoleOnBoard(
	op domain.MachiningOperation,
	part domain.HardwareMachiningPart,
	hw domain.Hardware,
	board *layoutBoard,
	holeWorld [3]float64,
	drawerCenter [3]float64,
	hostPlacement string,
) (ResolveHole, bool) {
	m := eulerXyzMatrix(board.rotX, board.rotY, board.rotZ)
	aabbMinR, _ := boardAABBRender(board)
	group := [3]float64{board.x - aabbMinR[0], board.z - aabbMinR[1], board.y - aabbMinR[2]}

	// Board-local frame of the hole point (render chain inverted).
	holeRender := [3]float64{holeWorld[0], holeWorld[2], holeWorld[1]}
	delta := [3]float64{holeRender[0] - group[0], holeRender[1] - group[1], holeRender[2] - group[2]}
	local := mulMatVec3(transposeMat3(m), delta)

	// Face selection: outward world normal toward the drawer interior.
	face := "back"
	if faceNormalTowardInterior(m, group, board, drawerCenter) {
		face = "front"
	}

	w := math.Max(board.widthMm, 0)
	t := math.Max(board.thicknessMm, 0)
	l := math.Max(board.lengthMm, 0)

	var depthMm float64
	if op.Kind == "through_hole" {
		depthMm = t // front/back faces measure depth over the thickness
	} else if op.DepthMm != nil {
		depthMm = *op.DepthMm
	}

	// frente_cajon datum: the height rides the HOST PANEL's own bottom edge
	// (Blum panel-local), never the drawer bottom — overlay reveals shift the
	// panel edge without moving the fixing pattern on the panel.
	inFaceY := local[2]
	if hostPlacement == string(domain.PlacementFrenteCajon) {
		inFaceY = op.YMm
	}
	hole := ResolveHole{
		Face:       face,
		XMm:        math.Round(local[0]*100) / 100,
		YMm:        math.Round(inFaceY*100) / 100,
		DiameterMm: op.DiameterMm,
		DepthMm:    depthMm,
		Type:       memberHostHoleType(part, op, hw),
	}
	return hole, local[0] >= -1e-6 && local[0] <= w+1e-6 && inFaceY >= -1e-6 && inFaceY <= l+1e-6
}

// faceNormalTowardInterior reports whether the local +Y ('front') face's
// world outward normal points toward the drawer centre; its opposite (−Y,
// 'back') points the other way, so one dot product decides the entry face.
func faceNormalTowardInterior(m [9]float64, group [3]float64, board *layoutBoard, drawerCenter [3]float64) bool {
	normalRender := mulMatVec3(m, [3]float64{0, 1, 0})
	normalWorld := [3]float64{normalRender[0], normalRender[2], normalRender[1]}
	aabbMinR, aabbSizeR := boardAABBRender(board)
	// Board centre: local origin in render (group) + AABB min + half size,
	// then the render → workshop swap.
	centerRender := [3]float64{
		group[0] + aabbMinR[0] + aabbSizeR[0]/2,
		group[1] + aabbMinR[1] + aabbSizeR[1]/2,
		group[2] + aabbMinR[2] + aabbSizeR[2]/2,
	}
	centerWorld := [3]float64{centerRender[0], centerRender[2], centerRender[1]}
	dx := drawerCenter[0] - centerWorld[0]
	dy := drawerCenter[1] - centerWorld[1]
	dz := drawerCenter[2] - centerWorld[2]
	return normalWorld[0]*dx+normalWorld[1]*dy+normalWorld[2]*dz > 0
}

// memberHostHoleType mirrors the TS inferHoleType precedence for the
// catalog-profile path: part role first, then the hardware name — the name
// carries the Spanish noun ("Tornillo…" ⇒ screw), never a guess from size.
func memberHostHoleType(part domain.HardwareMachiningPart, op domain.MachiningOperation, hw domain.Hardware) string {
	role := strings.ToLower(part.Role)
	label := strings.ToLower(op.Label + " " + op.ID)
	name := strings.ToLower(hw.Name + " " + hw.Code)
	switch {
	case containsAny(role, "hinge", "bisagra", "cup", "taza", "plate", "placa") || containsAny(name, "bisagra"):
		return "hinge"
	case containsAny(role, "minifix", "cam", "bolt", "perno", "cazuela") || containsAny(name, "minifix"):
		return "minifix"
	case containsAny(role, "dowel", "taquete", "tarugo") || containsAny(name, "taquete", "tarugo"):
		return "dowel"
	case containsAny(role, "shelf", "estante", "soporte") || containsAny(name, "soporte", "entrepaño"):
		return "shelf"
	case containsAny(role, "screw", "tornillo") || op.Kind == "screw_pilot" || containsAny(label, "tornillo", "piloto", "screw") || containsAny(name, "tornillo"):
		return "screw"
	}
	return "screw"
}

func containsAny(s string, needles ...string) bool {
	for _, n := range needles {
		if strings.Contains(s, n) {
			return true
		}
	}
	return false
}

func transposeMat3(m [9]float64) [9]float64 {
	return [9]float64{
		m[0], m[3], m[6],
		m[1], m[4], m[7],
		m[2], m[5], m[8],
	}
}

// assemblyTranslation reads the module-space translation the layout wrote
// into Placement["translation"] (constructed as []float64 in-process; JSON
// round-trips make it []any — accept both defensively).
func assemblyTranslation(assembly LayoutAssembly) ([3]float64, bool) {
	raw, ok := assembly.Placement["translation"]
	if !ok {
		return [3]float64{}, false
	}
	var out [3]float64
	switch v := raw.(type) {
	case []float64:
		if len(v) != 3 {
			return [3]float64{}, false
		}
		out = [3]float64{v[0], v[1], v[2]}
	case []any:
		if len(v) != 3 {
			return [3]float64{}, false
		}
		for i := 0; i < 3; i++ {
			f, ok := v[i].(float64)
			if !ok {
				return [3]float64{}, false
			}
			out[i] = f
		}
	default:
		return [3]float64{}, false
	}
	return out, true
}
