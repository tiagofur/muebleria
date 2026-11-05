/**
 * #1429 slice B — TS mirror of deriveMemberHostMachining
 * (backend-go/internal/domain/engine/authoring_member_host.go, slice A): a
 * rigid member whose recipe declares `hostPlacement` drills the module board
 * carrying that placement with the member hardware's CATALOG machining
 * profile. The truth lives in the agregado recipe — compose a module with the
 * drawer and the carcase/front drilling follows automatically.
 *
 * Datum contract per host role (identical to the Go twin):
 *   - frente_cajon (moving rail → drawer front): the height datum is
 *     PANEL-LOCAL (Blum mide la fijación frontal desde la arista inferior del
 *     frente — 33.5/65.5 quedan intactos sea cual sea el recubrimiento).
 *   - lateral_izquierdo / lateral_derecho (fixed rail → carcase side): the
 *     profile's xMm measures from the drawer's front plane toward the back
 *     (Blum guide rows), yMm the height above the drawer bottom.
 *
 * The entry face is the board face whose outward normal points toward the
 * drawer interior, and (face, xMm, yMm) ride the SAME board-local frame the
 * 3D placement projection publishes (euler + group + render swap —
 * spatialAnchor) — preview and CNC can never disagree on where the hole sits.
 * Fail-closed: a declared host with no matching board, a rotated member
 * basis, or hardware without an active catalog profile yields an explicit
 * issue and never an invented hole.
 *
 * Parity: contracts/memberHostDrilling.contract.json (Go golden author,
 * TS consumer) — drift 0 is issue acceptance.
 */

import { eulerXyzMatrix } from './spatialAnchor';
import type {
  Hardware,
  HardwareMachiningPart,
  MachiningOperation,
  ResolvedBoardPart,
} from './types';
import type { ResolvedModuleAssembly } from './agregadoAssembly';
import type { HoleDefinition, HoleType } from './partDrilling';

/** Issue codes the TS projection reports (mirrors the Go derivation). */
export type MemberHostDrillingIssueCode =
  | 'MEMBER_HOST_PLACEMENT_MISSING'
  | 'MEMBER_HOST_PROFILE_REQUIRED'
  | 'MEMBER_HOST_BASIS_UNSUPPORTED';

export interface MemberHostDrillingIssue {
  readonly code: MemberHostDrillingIssueCode;
  readonly memberId: string;
  readonly hostPlacement: string;
  readonly message: string;
}

export interface MemberHostDrillingInput {
  readonly assemblies: readonly ResolvedModuleAssembly[];
  /** Module boards (secondary BOM): hosts match by componentPlacement. */
  readonly parts: readonly ResolvedBoardPart[];
  readonly hardwareCatalog: readonly Hardware[];
}

export interface MemberHostDrillingResult {
  /** Member-host holes per host part id (appended to the piece's pattern). */
  readonly holesByPartId: ReadonlyMap<string, readonly HoleDefinition[]>;
  readonly issues: readonly MemberHostDrillingIssue[];
}

/** Row-major 3×3 transpose-times-vector (Go transposeMat3 + mulMatVec3). */
function transposeMatVec(m: readonly number[], v: readonly [number, number, number]): [number, number, number] {
  return [
    m[0]! * v[0]! + m[3]! * v[1]! + m[6]! * v[2]!,
    m[1]! * v[0]! + m[4]! * v[1]! + m[7]! * v[2]!,
    m[2]! * v[0]! + m[5]! * v[1]! + m[8]! * v[2]!,
  ];
}

/** Row-major 3×3 matrix-times-vector (Go mulMatVec3). */
function matVec(m: readonly number[], v: readonly [number, number, number]): [number, number, number] {
  return [
    m[0]! * v[0]! + m[1]! * v[1]! + m[2]! * v[2]!,
    m[3]! * v[0]! + m[4]! * v[1]! + m[5]! * v[2]!,
    m[6]! * v[0]! + m[7]! * v[1]! + m[8]! * v[2]!,
  ];
}

/**
 * Render-frame AABB of the board's local box under its Euler — the exact
 * mirror of Go boardAABBRender (layout.go): 8 corners of
 * [0,w]×[0,t]×[0,l] through the rotation matrix, min and size.
 */
function boardAABBRender(
  part: Pick<ResolvedBoardPart, 'widthMm' | 'thicknessMm' | 'lengthMm' | 'rotateX' | 'rotateY' | 'rotateZ'>,
): { readonly min: [number, number, number]; readonly size: [number, number, number] } {
  const m = eulerXyzMatrix(part.rotateX ?? 0, part.rotateY ?? 0, part.rotateZ ?? 0);
  const w = Math.max(part.widthMm, 0);
  const t = Math.max(part.thicknessMm, 0);
  const l = Math.max(part.lengthMm, 0);
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const aw of [0, w]) {
    for (const at of [0, t]) {
      for (const al of [0, l]) {
        const p = matVec(m, [aw, at, al]);
        minX = Math.min(minX, p[0]!);
        minY = Math.min(minY, p[1]!);
        minZ = Math.min(minZ, p[2]!);
        maxX = Math.max(maxX, p[0]!);
        maxY = Math.max(maxY, p[1]!);
        maxZ = Math.max(maxZ, p[2]!);
      }
    }
  }
  return { min: [minX, minY, minZ], size: [maxX - minX, maxY - minY, maxZ - minZ] };
}

function basisIsIdentity(basis: {
  readonly x: readonly [number, number, number];
  readonly y: readonly [number, number, number];
  readonly z: readonly [number, number, number];
}): boolean {
  return (
    basis.x[0] === 1 && basis.x[1] === 0 && basis.x[2] === 0 &&
    basis.y[0] === 0 && basis.y[1] === 1 && basis.y[2] === 0 &&
    basis.z[0] === 0 && basis.z[1] === 0 && basis.z[2] === 1
  );
}

/**
 * Workshop position of one profile operation under the role datum contract
 * (Go memberHostHoleWorld). For frente_cajon hosts the height axis rides the
 * host panel locally (applied at the board mapping); for lateral hosts xMm
 * measures from the drawer's front plane toward the back.
 */
function holeWorld(
  op: MachiningOperation,
  memberTranslationMm: readonly [number, number, number],
  origin: readonly [number, number, number],
  frontPlaneY: number,
  hostPlacement: string,
): [number, number, number] {
  if (hostPlacement === 'frente_cajon') {
    return [origin[0]! + memberTranslationMm[0]! + op.xMm, origin[1]! + memberTranslationMm[1]!, 0];
  }
  return [
    origin[0]! + memberTranslationMm[0]! + op.xMm,
    frontPlaneY - op.xMm,
    origin[2]! + memberTranslationMm[2]! + op.yMm,
  ];
}

/**
 * Maps the hole's workshop position onto the host board's drilling frame —
 * the exact mirror of Go memberHostHoleOnBoard (entry face by interior
 * normal, board-local axes via euler + group + render swap). Returns null
 * when the hole falls outside the face's in-plane bounds.
 */
function holeOnBoard(
  op: MachiningOperation,
  profilePart: HardwareMachiningPart,
  hw: Hardware,
  part: ResolvedBoardPart,
  world: readonly [number, number, number],
  drawerCenter: readonly [number, number, number],
  hostPlacement: string,
): HoleDefinition | null {
  const m = eulerXyzMatrix(part.rotateX ?? 0, part.rotateY ?? 0, part.rotateZ ?? 0);
  const aabb = boardAABBRender(part);
  const px = part.x ?? 0;
  const py = part.y ?? 0;
  const pz = part.z ?? 0;
  // Group position in the render frame: workshopToThree(minCorner) − offset.
  const group: [number, number, number] = [px - aabb.min[0], pz - aabb.min[1], py - aabb.min[2]];

  // Board-local frame of the hole point (render chain inverted).
  const holeRender: [number, number, number] = [world[0], world[2], world[1]];
  const delta: [number, number, number] = [
    holeRender[0] - group[0],
    holeRender[1] - group[1],
    holeRender[2] - group[2],
  ];
  const local = transposeMatVec(m, delta);

  // Face selection: outward world normal toward the drawer interior.
  const normalRender = matVec(m, [0, 1, 0]);
  const normalWorld: [number, number, number] = [normalRender[0], normalRender[2], normalRender[1]];
  const centerRender: [number, number, number] = [
    group[0] + aabb.min[0] + aabb.size[0] / 2,
    group[1] + aabb.min[1] + aabb.size[1] / 2,
    group[2] + aabb.min[2] + aabb.size[2] / 2,
  ];
  const centerWorld: [number, number, number] = [centerRender[0], centerRender[2], centerRender[1]];
  const dx = drawerCenter[0] - centerWorld[0];
  const dy = drawerCenter[1] - centerWorld[1];
  const dz = drawerCenter[2] - centerWorld[2];
  const face = normalWorld[0] * dx + normalWorld[1] * dy + normalWorld[2] * dz > 0 ? 'front' : 'back';

  const w = Math.max(part.widthMm, 0);
  const t = Math.max(part.thicknessMm, 0);
  const l = Math.max(part.lengthMm, 0);

  const depthMm = op.kind === 'through_hole' ? t : (op.depthMm ?? 0);

  // frente_cajon datum: the height rides the HOST PANEL's own bottom edge
  // (Blum panel-local), never the drawer bottom.
  const inFaceY = hostPlacement === 'frente_cajon' ? op.yMm : local[2];
  if (local[0] < -1e-6 || local[0] > w + 1e-6 || inFaceY < -1e-6 || inFaceY > l + 1e-6) {
    return null;
  }
  const type: HoleType = memberHostHoleType(profilePart, op, hw);
  return {
    face,
    xMm: Math.round(local[0] * 100) / 100,
    yMm: Math.round(inFaceY * 100) / 100,
    diameterMm: op.diameterMm,
    depthMm,
    type,
    description: `member-host:${hw.code}:${op.id}`,
  };
}

/**
 * Hole-type typing with the Go derivation's RESTRICTED precedence
 * (memberHostHoleType in authoring_member_host.go): profile part role first,
 * then the hardware name — the name carries the Spanish noun ("Tornillo…"
 * ⇒ screw) — then the screw-pilot kind/label. Deliberately NOT the manual
 * resolver's inferHoleType (which adds previewShape and Ø heuristics): the
 * preview must type member-host holes exactly like the CNC derivation does.
 */
function memberHostHoleType(
  part: HardwareMachiningPart,
  op: MachiningOperation,
  hw: Hardware,
): HoleType {
  const role = `${part.role}`.toLowerCase();
  const label = `${op.label ?? ''} ${op.id}`.toLowerCase();
  const name = `${hw.name} ${hw.code}`.toLowerCase();
  const has = (haystack: string, needles: readonly string[]): boolean =>
    needles.some((n) => haystack.includes(n));
  if (has(role, ['hinge', 'bisagra', 'cup', 'taza', 'plate', 'placa']) || name.includes('bisagra')) {
    return 'hinge';
  }
  if (has(role, ['minifix', 'cam', 'bolt', 'perno', 'cazuela']) || name.includes('minifix')) {
    return 'minifix';
  }
  if (has(role, ['dowel', 'taquete', 'tarugo']) || has(name, ['taquete', 'tarugo'])) {
    return 'dowel';
  }
  if (has(role, ['shelf', 'estante', 'soporte']) || has(name, ['soporte', 'entrepaño'])) {
    return 'shelf';
  }
  if (
    has(role, ['screw', 'tornillo']) ||
    op.kind === 'screw_pilot' ||
    has(label, ['tornillo', 'piloto', 'screw']) ||
    name.includes('tornillo')
  ) {
    return 'screw';
  }
  return 'screw';
}

/**
 * Projects every declared member-host's catalog machining profile onto the
 * external module boards (pure; Go is the golden author — the shared
 * fixture memberHostDrilling.contract.json pins both runtimes).
 */
export function projectMemberHostDrilling(input: MemberHostDrillingInput): MemberHostDrillingResult {
  const holesByPartId = new Map<string, HoleDefinition[]>();
  const issues: MemberHostDrillingIssue[] = [];

  for (const assembly of input.assemblies) {
    const resolved = assembly.resolvedAssembly;
    if (!resolved) continue;
    const origin = assembly.placement.originMm;
    // TS resolvedDimensionsMm order is [width, depth, height] — NOT the Go
    // LayoutAssembly [width, height, depth]; documented mapping.
    const width = resolved.resolvedDimensionsMm[0] ?? 0;
    const depth = resolved.resolvedDimensionsMm[1] ?? 0;
    const frontPlaneY = origin[1] + depth;
    const drawerCenter: [number, number, number] = [
      origin[0] + width / 2,
      frontPlaneY - depth / 2,
      origin[2],
    ];

    for (const member of resolved.rigidMembers) {
      const hostPlacement = (member.hostPlacement ?? '').trim();
      if (!hostPlacement) continue;
      const memberID = member.memberId;
      const hw = input.hardwareCatalog.find((h) => h.id === member.hardwareId);
      if (!hw || !hw.active) {
        issues.push({
          code: 'MEMBER_HOST_PROFILE_REQUIRED',
          memberId: memberID,
          hostPlacement,
          message: `el miembro ${memberID} declara hostPlacement "${hostPlacement}" pero su herraje ${member.hardwareId} no existe o está inactivo`,
        });
        continue;
      }
      if (!basisIsIdentity(member.localTransform.basis)) {
        issues.push({
          code: 'MEMBER_HOST_BASIS_UNSUPPORTED',
          memberId: memberID,
          hostPlacement,
          message: `el miembro ${memberID} declara hostPlacement "${hostPlacement}" con una base rotada; sólo se proyectan miembros alineados a ejes`,
        });
        continue;
      }
      const hosts = input.parts.filter((p) => (p.componentPlacement ?? '') === hostPlacement);
      if (hosts.length === 0) {
        issues.push({
          code: 'MEMBER_HOST_PLACEMENT_MISSING',
          memberId: memberID,
          hostPlacement,
          message: `el miembro ${memberID} declara hostPlacement "${hostPlacement}" pero el mueble no tiene ninguna pieza con ese rol`,
        });
        continue;
      }
      const profile = hw.machining;
      if (!profile || profile.parts.length === 0) {
        issues.push({
          code: 'MEMBER_HOST_PROFILE_REQUIRED',
          memberId: memberID,
          hostPlacement,
          message: `el miembro ${memberID} declara hostPlacement "${hostPlacement}" pero el herraje ${hw.code} no lleva perfil de mecanizado en catálogo`,
        });
        continue;
      }
      const translation = member.localTransform.translationMm;
      for (const profilePart of profile.parts) {
        for (const op of profilePart.operations) {
          const world = holeWorld(op, translation, origin, frontPlaneY, hostPlacement);
          for (const host of hosts) {
            const hole = holeOnBoard(op, profilePart, hw, host, world, drawerCenter, hostPlacement);
            if (!hole) continue;
            const list = holesByPartId.get(host.id) ?? [];
            list.push(hole);
            holesByPartId.set(host.id, list);
          }
        }
      }
    }
  }
  return { holesByPartId, issues };
}

/**
 * #1429 slice B: equivalence tolerance for the manual-placement dedupe —
 * the SAME rule Go dedupeMemberHostManualEquivalents applies (and the TS
 * deduplicateHoles uses): same face, center/Ø/depth within 0.1mm. The
 * owner's explicit manual placement wins; non-equivalent holes keep both
 * and the collision gate stays fail-closed.
 */
export function memberHostHoleIsEquivalent(
  hole: HoleDefinition,
  existing: readonly HoleDefinition[],
): boolean {
  for (const other of existing) {
    if (hole.face !== other.face) continue;
    if (Math.abs(hole.xMm - other.xMm) > 0.1 || Math.abs(hole.yMm - other.yMm) > 0.1) continue;
    if (Math.abs(hole.diameterMm - other.diameterMm) > 0.1) continue;
    if (Math.abs(hole.depthMm - other.depthMm) > 0.1) continue;
    return true;
  }
  return false;
}
