/**
 * F145/#311 — Environment authoring: muros y huecos del ambiente como
 * intenciones puras. Mismas reglas que kitchenLayoutCommands: un comando =
 * una intención = una entrada de undo; los rechazos enseñan cómo resolverlos.
 *
 * Los huecos (WallOpening) son presentation-only: nunca tocan BOM, precio ni
 * producción (North Star §17: helpers no contaminan el modelo de negocio).
 */

import { resolveWallFrames, syncActiveKitchenSpace } from './kitchenLayout';
import {
  WALL_OPENING_DEFAULTS_MM,
  WALL_OPENING_KIND_LABELS_ES,
} from './types';
import type {
  KitchenWall,
  ProjectKitchenLayout,
  WallOpening,
  WallOpeningKind,
} from './types';

/* ── Vocabularies ─────────────────────────────────────────────────────────── */

export {
  WALL_OPENING_KINDS,
  WALL_OPENING_KIND_LABELS_ES,
  WALL_OPENING_DEFAULTS_MM,
} from './types';

/** Reference room height for opening validation/rendering (mm). */
export const ROOM_WALL_HEIGHT_MM = 2400;

/** Shortest useful wall/opening (mm) — anything smaller is a typo. */
export const MIN_WALL_LENGTH_MM = 100;
export const MIN_OPENING_WIDTH_MM = 100;
export const MIN_OPENING_HEIGHT_MM = 100;

export type EnvironmentCommandErrorReason =
  | 'missing-wall'
  | 'missing-opening'
  | 'invalid-length'
  | 'invalid-angle'
  | 'opening-out-of-wall'
  | 'opening-out-of-height'
  | 'opening-overlap'
  | 'wall-shrunk-below-openings';

export type EnvironmentCommandResult =
  | {
      readonly ok: true;
      readonly layout: ProjectKitchenLayout;
      /**
       * Tras removeWall: colocaciones que quedaron sin muro (pasan a
       * «sin colocar») para que la UI explique la consecuencia.
       */
      readonly unplacedCount?: number;
    }
  | {
      readonly ok: false;
      readonly reason: EnvironmentCommandErrorReason;
      readonly message: string;
    };

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function wallNameOf(wall: KitchenWall): string {
  return wall.name?.trim() || 'el muro';
}

function resolveOpeningHeight(o: WallOpening): number {
  return o.heightMm ?? WALL_OPENING_DEFAULTS_MM[o.kind].heightMm;
}

function resolveOpeningSill(o: WallOpening): number {
  return o.sillMm ?? WALL_OPENING_DEFAULTS_MM[o.kind].sillMm;
}

function replaceWall(
  layout: ProjectKitchenLayout,
  wallId: string,
  next: KitchenWall,
): ProjectKitchenLayout {
  return {
    ...layout,
    walls: layout.walls.map((w) => (w.id === wallId ? next : w)),
  };
}

/* ── Wall commands ────────────────────────────────────────────────────────── */

/**
 * Add a wall chained after the last one: starts at its end and turns +90°
 * (rectangles close naturally; first wall defaults to 0°).
 */
export function addWall(
  layout: ProjectKitchenLayout,
  params: {
    readonly name?: string;
    readonly lengthMm: number;
    readonly angleDeg?: number;
  },
  newId: () => string,
): EnvironmentCommandResult {
  const lengthMm = Math.round(params.lengthMm);
  if (!Number.isFinite(lengthMm) || lengthMm < MIN_WALL_LENGTH_MM) {
    return {
      ok: false,
      reason: 'invalid-length',
      message: `El largo del muro debe ser de al menos ${MIN_WALL_LENGTH_MM} mm.`,
    };
  }
  const frames = resolveWallFrames(layout.walls);
  const last = frames[frames.length - 1];
  const angleDeg = Number.isFinite(params.angleDeg)
    ? Math.round(params.angleDeg! * 10) / 10
    : last
      ? (((last.angleDeg + 90) % 360) + 360) % 360
      : 0;
  const wall: KitchenWall = {
    id: newId(),
    name: params.name?.trim() || `Muro ${layout.walls.length + 1}`,
    lengthMm,
    angleDeg,
    ...(last
      ? { originXMm: Math.round(last.endXMm), originYMm: Math.round(last.endYMm) }
      : { originXMm: 0, originYMm: 0 }),
  };
  return {
    ok: true,
    layout: syncActiveKitchenSpace({ ...layout, walls: [...layout.walls, wall] }),
  };
}

/**
 * Edit wall dimensions/label. Rejects a shrink that would leave its openings
 * outside the wall (teaches instead of silently dropping data).
 */
export function updateWall(
  layout: ProjectKitchenLayout,
  wallId: string,
  patch: Partial<
    Pick<KitchenWall, 'name' | 'lengthMm' | 'angleDeg' | 'originXMm' | 'originYMm'>
  >,
): EnvironmentCommandResult {
  const wall = layout.walls.find((w) => w.id === wallId);
  if (!wall) {
    return { ok: false, reason: 'missing-wall', message: 'El muro ya no existe.' };
  }
  const lengthMm =
    patch.lengthMm !== undefined ? Math.round(patch.lengthMm) : wall.lengthMm;
  if (!Number.isFinite(lengthMm) || lengthMm < MIN_WALL_LENGTH_MM) {
    return {
      ok: false,
      reason: 'invalid-length',
      message: `El largo del muro debe ser de al menos ${MIN_WALL_LENGTH_MM} mm.`,
    };
  }
  const angleDeg =
    patch.angleDeg !== undefined ? patch.angleDeg : wall.angleDeg;
  if (!Number.isFinite(angleDeg)) {
    return {
      ok: false,
      reason: 'invalid-angle',
      message: 'El ángulo del muro debe ser un número.',
    };
  }
  const openings = wall.openings ?? [];
  const overflow = openings.find(
    (o) => o.offsetMm + o.widthMm > lengthMm + 1,
  );
  if (overflow) {
    return {
      ok: false,
      reason: 'wall-shrunk-below-openings',
      message: `No se puede acortar: ${
        WALL_OPENING_KIND_LABELS_ES[overflow.kind]
      } a ${Math.round(overflow.offsetMm)} mm quedaría fuera del muro.`,
    };
  }
  return {
    ok: true,
    layout: replaceWall(layout, wallId, {
      ...wall,
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      lengthMm,
      angleDeg,
      ...(patch.originXMm !== undefined ? { originXMm: patch.originXMm } : {}),
      ...(patch.originYMm !== undefined ? { originYMm: patch.originYMm } : {}),
    }),
  };
}

/**
 * Remove a wall. Its placements drop to «sin colocar» (documented ownership
 * policy: a placement never survives its wall); the count travels back so the
 * UI can teach what just happened. Openings die with the wall.
 */
export function removeWall(
  layout: ProjectKitchenLayout,
  wallId: string,
): EnvironmentCommandResult {
  const wall = layout.walls.find((w) => w.id === wallId);
  if (!wall) {
    return { ok: false, reason: 'missing-wall', message: 'El muro ya no existe.' };
  }
  const isWallAnchored = (p: { readonly mode?: string; readonly wallId: string }) =>
    (!p.mode || p.mode === 'wall') && p.wallId === wallId;
  const unplacedCount = layout.placements.filter(isWallAnchored).length;
  const next: ProjectKitchenLayout = {
    ...layout,
    walls: layout.walls.filter((w) => w.id !== wallId),
    placements: layout.placements.filter((p) => !isWallAnchored(p)),
  };
  return {
    ok: true,
    layout: syncActiveKitchenSpace(next),
    ...(unplacedCount > 0 ? { unplacedCount } : {}),
  };
}

/* ── Opening commands ─────────────────────────────────────────────────────── */

function validateOpeningAgainstWall(params: {
  readonly wall: KitchenWall;
  readonly offsetMm: number;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly sillMm: number;
}): EnvironmentCommandResult | null {
  const { wall, offsetMm, widthMm, heightMm, sillMm } = params;
  if (offsetMm < 0 || offsetMm + widthMm > wall.lengthMm + 1) {
    return {
      ok: false,
      reason: 'opening-out-of-wall',
      message: `El hueco no entra en ${wallNameOf(wall)} (${Math.round(
        wall.lengthMm,
      )} mm): reducí el ancho o acercalo al inicio del muro.`,
    };
  }
  if (heightMm < MIN_OPENING_HEIGHT_MM || sillMm < 0) {
    return {
      ok: false,
      reason: 'opening-out-of-height',
      message: `La altura del hueco debe ser de al menos ${MIN_OPENING_HEIGHT_MM} mm y no puede empezar bajo el piso.`,
    };
  }
  if (sillMm + heightMm > ROOM_WALL_HEIGHT_MM + 1) {
    return {
      ok: false,
      reason: 'opening-out-of-height',
      message: `El hueco supera la altura del muro (${ROOM_WALL_HEIGHT_MM} mm).`,
    };
  }
  return null;
}

function validateOpeningOverlap(params: {
  readonly wall: KitchenWall;
  readonly offsetMm: number;
  readonly widthMm: number;
  readonly ignoreOpeningId?: string;
}): EnvironmentCommandResult | null {
  const { wall, offsetMm, widthMm, ignoreOpeningId } = params;
  for (const peer of wall.openings ?? []) {
    if (peer.id === ignoreOpeningId) continue;
    const overlaps =
      offsetMm < peer.offsetMm + peer.widthMm - 1 &&
      peer.offsetMm < offsetMm + widthMm - 1;
    if (overlaps) {
      return {
        ok: false,
        reason: 'opening-overlap',
        message: `Se superpone con ${
          WALL_OPENING_KIND_LABELS_ES[peer.kind]
        } a ${Math.round(peer.offsetMm)} mm de ${
          wallNameOf(wall)
        }. Movelo o reducí el ancho.`,
      };
    }
  }
  return null;
}

/** Add an opening to a wall (window/door/pass). Kind defaults fill height/sill. */
export function addOpening(
  layout: ProjectKitchenLayout,
  wallId: string,
  params: {
    readonly kind: WallOpeningKind;
    readonly offsetMm: number;
    readonly widthMm: number;
    readonly heightMm?: number;
    readonly sillMm?: number;
  },
  newId: () => string,
): EnvironmentCommandResult {
  const wall = layout.walls.find((w) => w.id === wallId);
  if (!wall) {
    return { ok: false, reason: 'missing-wall', message: 'El muro ya no existe.' };
  }
  const defaults = WALL_OPENING_DEFAULTS_MM[params.kind];
  const offsetMm = Math.round(params.offsetMm);
  const widthMm = Math.round(params.widthMm);
  const heightMm = Math.round(params.heightMm ?? defaults.heightMm);
  const sillMm = Math.round(params.sillMm ?? defaults.sillMm);
  if (widthMm < MIN_OPENING_WIDTH_MM) {
    return {
      ok: false,
      reason: 'opening-out-of-wall',
      message: `El ancho del hueco debe ser de al menos ${MIN_OPENING_WIDTH_MM} mm.`,
    };
  }
  const invalid = validateOpeningAgainstWall({
    wall,
    offsetMm,
    widthMm,
    heightMm,
    sillMm,
  });
  if (invalid) return invalid;
  const clash = validateOpeningOverlap({ wall, offsetMm, widthMm });
  if (clash) return clash;

  const opening: WallOpening = {
    id: newId(),
    kind: params.kind,
    offsetMm,
    widthMm,
    heightMm,
    sillMm,
  };
  return {
    ok: true,
    layout: replaceWall(layout, wallId, {
      ...wall,
      openings: [...(wall.openings ?? []), opening],
    }),
  };
}

/** Edit an opening. Validations run against the wall and its peers. */
export function updateOpening(
  layout: ProjectKitchenLayout,
  wallId: string,
  openingId: string,
  patch: Partial<
    Pick<WallOpening, 'kind' | 'offsetMm' | 'widthMm' | 'heightMm' | 'sillMm'>
  >,
): EnvironmentCommandResult {
  const wall = layout.walls.find((w) => w.id === wallId);
  if (!wall) {
    return { ok: false, reason: 'missing-wall', message: 'El muro ya no existe.' };
  }
  const current = (wall.openings ?? []).find((o) => o.id === openingId);
  if (!current) {
    return {
      ok: false,
      reason: 'missing-opening',
      message: 'El hueco ya no existe en este muro.',
    };
  }
  const kind = patch.kind ?? current.kind;
  const defaults = WALL_OPENING_DEFAULTS_MM[kind];
  const offsetMm = Math.round(patch.offsetMm ?? current.offsetMm);
  const widthMm = Math.round(patch.widthMm ?? current.widthMm);
  const heightMm = Math.round(
    patch.heightMm ?? current.heightMm ?? defaults.heightMm,
  );
  const sillMm = Math.round(
    patch.sillMm ?? current.sillMm ?? defaults.sillMm,
  );
  if (widthMm < MIN_OPENING_WIDTH_MM) {
    return {
      ok: false,
      reason: 'opening-out-of-wall',
      message: `El ancho del hueco debe ser de al menos ${MIN_OPENING_WIDTH_MM} mm.`,
    };
  }
  const invalid = validateOpeningAgainstWall({
    wall,
    offsetMm,
    widthMm,
    heightMm,
    sillMm,
  });
  if (invalid) return invalid;
  const clash = validateOpeningOverlap({
    wall,
    offsetMm,
    widthMm,
    ignoreOpeningId: openingId,
  });
  if (clash) return clash;

  return {
    ok: true,
    layout: replaceWall(layout, wallId, {
      ...wall,
      openings: (wall.openings ?? []).map((o) =>
        o.id === openingId
          ? { ...o, kind, offsetMm, widthMm, heightMm, sillMm }
          : o,
      ),
    }),
  };
}

/** Remove an opening from a wall. */
export function removeOpening(
  layout: ProjectKitchenLayout,
  wallId: string,
  openingId: string,
): EnvironmentCommandResult {
  const wall = layout.walls.find((w) => w.id === wallId);
  if (!wall) {
    return { ok: false, reason: 'missing-wall', message: 'El muro ya no existe.' };
  }
  const openings = (wall.openings ?? []).filter((o) => o.id !== openingId);
  if (openings.length === (wall.openings ?? []).length) {
    return {
      ok: false,
      reason: 'missing-opening',
      message: 'El hueco ya no existe en este muro.',
    };
  }
  return {
    ok: true,
    layout: replaceWall(layout, wallId, {
      ...wall,
      // Sin huecos, la key desaparece (spread condicional no borra props).
      openings: openings.length > 0 ? openings : undefined,
    }),
  };
}

/* ── Geometry (pure, shared by 3D + 2D plan) ──────────────────────────────── */

/** A solid piece of wall between/around openings (wall-local mm). */
export type WallSolidSegment = {
  /** Start along the wall from its origin (mm). */
  readonly startMm: number;
  readonly lengthMm: number;
  /** Vertical band [zBottomMm, zTopMm] from the floor (mm). */
  readonly zBottomMm: number;
  readonly zTopMm: number;
};

/**
 * Split a wall into solid segments around its openings — real holes without
 * CSG. Openings are clamped to the wall span; sub-millimeter slivers are
 * dropped so floating dust never produces invisible boxes.
 */
export function splitWallSegments(
  wall: KitchenWall,
  wallHeightMm: number = ROOM_WALL_HEIGHT_MM,
): readonly WallSolidSegment[] {
  const height = Math.max(1, wallHeightMm);
  const length = Math.max(1, wall.lengthMm);
  const openings = (wall.openings ?? [])
    .map((o) => ({
      start: Math.max(0, o.offsetMm),
      end: Math.min(length, o.offsetMm + o.widthMm),
      sill: resolveOpeningSill(o),
      top: resolveOpeningSill(o) + resolveOpeningHeight(o),
    }))
    .filter((o) => o.end - o.start >= 1)
    .sort((a, b) => a.start - b.start);

  const out: WallSolidSegment[] = [];
  let cursor = 0;
  const push = (startMm: number, endMm: number, zBottom: number, zTop: number) => {
    if (endMm - startMm >= 1 && zTop - zBottom >= 1) {
      out.push({
        startMm,
        lengthMm: endMm - startMm,
        zBottomMm: zBottom,
        zTopMm: zTop,
      });
    }
  };

  for (const o of openings) {
    // Full-height solid before the opening (merge if openings touch).
    if (o.start > cursor) {
      push(cursor, o.start, 0, height);
    }
    // Below (sill) and above (lintel) bands inside the opening span.
    push(Math.max(cursor, o.start), o.end, 0, Math.min(o.sill, height));
    push(Math.max(cursor, o.start), o.end, Math.min(o.top, height), height);
    cursor = Math.max(cursor, o.end);
  }
  push(cursor, length, 0, height);
  return out;
}

/* ── Camera occlusion (wall auto-hide) ────────────────────────────────────── */

/**
 * Inward unit normal of a wall (plan): direction rotated +90° (CCW). For the
 * default L template this points into the room on both walls.
 */
export function wallInwardNormal(angleDeg: number): {
  readonly x: number;
  readonly y: number;
} {
  const rad = ((angleDeg + 90) * Math.PI) / 180;
  return { x: Math.cos(rad), y: Math.sin(rad) };
}

/**
 * Walls between the camera and the room: the camera sits on the outward side
 * of their plane (inner face not visible). Midpoint heuristic — predictable
 * and cheap; meant for the optional "ocultar muros" view mode.
 */
export function wallsOccludingCamera(
  walls: readonly {
    readonly id: string;
    readonly originXMm: number;
    readonly originYMm: number;
    readonly endXMm: number;
    readonly endYMm: number;
    readonly angleDeg: number;
  }[],
  cameraXMm: number,
  cameraYMm: number,
): ReadonlySet<string> {
  const hidden = new Set<string>();
  for (const w of walls) {
    const n = wallInwardNormal(w.angleDeg);
    const midX = (w.originXMm + w.endXMm) / 2;
    const midY = (w.originYMm + w.endYMm) / 2;
    if (n.x * (cameraXMm - midX) + n.y * (cameraYMm - midY) < 0) {
      hidden.add(w.id);
    }
  }
  return hidden;
}
