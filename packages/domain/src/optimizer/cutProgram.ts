/**
 * Validated guillotine cut program core (#650, entrega A — incremento 1).
 *
 * Represents, validates and reproduces a cut program over rectangular board
 * regions: explicit region identity/geometry, divisions identified by parent,
 * axis of advance, relative measure and kerf band, terminal leaves
 * (piece / remnant / waste) and expected-piece references.
 *
 * This module is geometry and program identity only. It does not optimize
 * (the existing heuristics stay untouched), does not recalculate BOM or edge
 * deduction, does not project UI and does not serialize PTX. Those consumers
 * integrate this core in later increments of #650.
 *
 * Local region/cut identifiers are deterministic within one program. They are
 * NOT FurnitureInstance, DesignRevision or ProductionRelease identities.
 */

import { ValidationError } from '../errors';

/** Schema id of the cut program contract (new identifiers use granete.*). */
export const CUT_PROGRAM_SCHEMA_VERSION = 'granete.cut-program.v1';

/**
 * Axis of advance/separation of a division: the relative measure is taken
 * along this axis of the parent region, starting at the parent origin. The
 * saw line is perpendicular to the axis and spans the parent's full extent on
 * the other axis — the line crosses the active region, not necessarily the
 * whole board. This is not an ambiguous "horizontal/vertical line" label.
 */
export type CutProgramAxis = 'x' | 'y';

/** Immutable axis-aligned rectangle in board coordinates (mm). */
export interface CutProgramRect {
  readonly xMm: number;
  readonly yMm: number;
  /** Extent along X (mm). */
  readonly lengthMm: number;
  /** Extent along Y (mm). */
  readonly widthMm: number;
}

/** Terminal classification of a leaf region. */
export type CutProgramTerminalKind = 'piece' | 'remnant' | 'waste';

/** Region declared in a program, with explicit geometry. */
export interface CutProgramRegion {
  readonly regionId: string;
  readonly rect: CutProgramRect;
}

/** One guillotine division; array order in the program is execution order. */
export interface CutProgramDivision {
  readonly cutId: string;
  readonly parentRegionId: string;
  readonly axis: CutProgramAxis;
  /** Relative measure kept from the parent origin along the axis (mm). */
  readonly keptExtentMm: number;
  /** Blade band consumed along the axis (mm); zero kerf is admitted. */
  readonly kerfMm: number;
  readonly keptRegionId: string;
  /**
   * Region produced on the far side of the kerf band. Omitted ONLY when no
   * solid rest exists: kerf-only divisions (blade consumes the remainder
   * exactly) and blade-exit divisions (remainder smaller than the blade).
   * A solid rest must always be declared.
   */
  readonly restRegionId?: string;
  /**
   * Explicit marker that this pass lets the blade exit the parent (remainder
   * smaller than the blade band). Only valid when the blade overhang beyond
   * the parent consumes material already removed — an earlier kerf band or
   * exterior trim — never live material. The recorded band is clipped to the
   * parent, so the blade is counted exactly once and nothing live is cut.
   */
  readonly bladeExitsParent?: boolean;
}

/** Terminal declaration: a leaf that is a piece, remnant/offcut or waste. */
export interface CutProgramTerminalDeclaration {
  readonly regionId: string;
  readonly kind: CutProgramTerminalKind;
  /**
   * Reference to the expected piece identity (e.g. part code). Required for
   * kind 'piece'. No new business identity is minted here: the ref only links
   * the leaf to a demand that already exists elsewhere.
   */
  readonly pieceRef?: string;
}

/** Program input: board region, all declared regions, divisions, terminals. */
export interface CutProgramInput {
  readonly schemaVersion: string;
  readonly boardRegionId: string;
  readonly regions: readonly CutProgramRegion[];
  readonly divisions: readonly CutProgramDivision[];
  readonly terminals: readonly CutProgramTerminalDeclaration[];
}

/** Geometry produced by one division: kept child, kerf band, rest child. */
export interface CutProgramDivisionGeometry {
  readonly axis: CutProgramAxis;
  readonly keptExtentMm: number;
  readonly kerfMm: number;
  readonly keptRect: CutProgramRect;
  readonly kerfBandRect: CutProgramRect;
  /** null when no solid rest exists (kerf-only or blade-exit divisions). */
  readonly restRect: CutProgramRect | null;
  /** True when the blade band was clipped to the parent (gap < kerf). */
  readonly bladeExitsParent: boolean;
}

/**
 * How a kept extent separates from a parent extent under one kerf, under the
 * arithmetic policy of this module. This classifier is the single source of
 * the exact-fit / kerf-only / solid-rest / blade-exits policy (#650 PR 2):
 * heuristics must not re-implement it.
 *
 * - exact_fit: the kept extent already spans the parent (within noise). No
 *   pass exists; the region is a terminal leaf as-is.
 * - kerf_only: the remainder equals the blade band. A real pass separates the
 *   kept child and consumes the whole remainder as kerf; no solid rest.
 * - solid_rest: a normal division with kept + kerf + solid rest.
 * - blade_exits_parent: the remainder is smaller than the blade band, so the
 *   blade would leave the represented parent. Not representable by this
 *   program model without silently trimming the blade — callers must surface
 *   an identifiable limitation, never clip.
 */
export type CutProgramSeparation =
  | { readonly kind: 'exact_fit' }
  | { readonly kind: 'kerf_only' }
  | { readonly kind: 'solid_rest'; readonly restExtentMm: number }
  | { readonly kind: 'blade_exits_parent' };

export function separateExtent(
  parentExtentMm: number,
  keptExtentMm: number,
  kerfMm: number,
): CutProgramSeparation {
  const gapMm = parentExtentMm - keptExtentMm;
  if (sameMeasure(gapMm, 0)) {
    return { kind: 'exact_fit' };
  }
  if (!(gapMm > 0)) {
    return { kind: 'blade_exits_parent' };
  }
  if (sameMeasure(gapMm, kerfMm)) {
    return { kind: 'kerf_only' };
  }
  if (gapMm > kerfMm) {
    return { kind: 'solid_rest', restExtentMm: gapMm - kerfMm };
  }
  return { kind: 'blade_exits_parent' };
}

/** Kerf band of an executed division; not a region and never a leaf. */
export interface CutProgramKerfBand {
  readonly cutId: string;
  readonly bandId: string;
  readonly rect: CutProgramRect;
}

/** Executed division with authoritative (recomputed) geometry. */
export interface CutProgramTraceDivision {
  readonly order: number;
  readonly cutId: string;
  readonly parentRegionId: string;
  readonly parentRect: CutProgramRect;
  readonly axis: CutProgramAxis;
  readonly keptExtentMm: number;
  readonly kerfMm: number;
  readonly keptRegionId: string;
  readonly keptRect: CutProgramRect;
  readonly restRegionId?: string;
  readonly restRect: CutProgramRect | null;
  readonly kerfBandId: string;
  readonly kerfBandRect: CutProgramRect;
  readonly bladeExitsParent: boolean;
}

/** Terminal leaf with authoritative geometry. */
export interface CutProgramTerminalRegion {
  readonly regionId: string;
  readonly rect: CutProgramRect;
  readonly kind: CutProgramTerminalKind;
  readonly pieceRef?: string;
}

/** Full validated reproduction of a cut program. */
export interface CutProgramTrace {
  readonly schemaVersion: string;
  readonly boardRegionId: string;
  readonly boardRect: CutProgramRect;
  readonly divisions: readonly CutProgramTraceDivision[];
  readonly kerfBands: readonly CutProgramKerfBand[];
  readonly terminals: readonly CutProgramTerminalRegion[];
  readonly regionRects: ReadonlyMap<string, CutProgramRect>;
  readonly boardAreaMm2: number;
  readonly leafAreaMm2: number;
  readonly kerfAreaMm2: number;
}

/** Expected piece of a program: reference plus placement dimensions. */
export interface CutProgramExpectedPiece {
  readonly pieceRef: string;
  readonly lengthMm: number;
  readonly widthMm: number;
}

/**
 * Arithmetic-only comparison policy: absorbs IEEE-754 representation noise
 * of decimal inputs with a relative 1e-9 epsilon — nanometre scale on
 * board-scale lengths (≈ 2.4e-6 mm at 2440 mm) and under 0.005 mm² on
 * board-scale areas (~4.5e6 mm²). It is NOT a manufacturing tolerance and
 * NOT the 2 mm visual-grouping tolerance: millimetre-scale errors always
 * fail these checks. Non-finite values are never equivalent to anything.
 */
const ARITHMETIC_RELATIVE_EPSILON = 1e-9;

function sameMeasure(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return false;
  }
  return Math.abs(a - b) <= ARITHMETIC_RELATIVE_EPSILON * Math.max(1, Math.abs(a), Math.abs(b));
}

/** a <= b accepting arithmetic-representation noise only. */
function atMost(a: number, b: number): boolean {
  return a < b || sameMeasure(a, b);
}

/** a >= b accepting arithmetic-representation noise only. */
function atLeast(a: number, b: number): boolean {
  return a > b || sameMeasure(a, b);
}

function sameRect(a: CutProgramRect, b: CutProgramRect): boolean {
  return (
    sameMeasure(a.xMm, b.xMm) &&
    sameMeasure(a.yMm, b.yMm) &&
    sameMeasure(a.lengthMm, b.lengthMm) &&
    sameMeasure(a.widthMm, b.widthMm)
  );
}

/**
 * Whether a claimed rect matches an executed rect under the arithmetic
 * policy. The optimizer integration uses it to prove that executed piece
 * leaves correspond to the real placements, position included; it accepts
 * representation noise only, never real geometric differences.
 */
export function cutProgramRectMatches(claim: CutProgramRect, executed: CutProgramRect): boolean {
  return sameRect(claim, executed);
}

function rectArea(rect: CutProgramRect): number {
  return rect.lengthMm * rect.widthMm;
}

function fail(code: string, message: string, context: Record<string, unknown>): never {
  throw new ValidationError(message, { code, ...context });
}

function assertRect(rect: CutProgramRect, label: string, context: Record<string, unknown>): void {
  const { xMm, yMm, lengthMm, widthMm } = rect;
  if (
    !Number.isFinite(xMm) ||
    !Number.isFinite(yMm) ||
    !Number.isFinite(lengthMm) ||
    !Number.isFinite(widthMm) ||
    lengthMm <= 0 ||
    widthMm <= 0
  ) {
    fail('cut_program.region_invalid', `Región ${label} con dimensiones no representables`, {
      ...context,
      rect,
    });
  }
}

function kerfBandIdOf(cutId: string): string {
  return `kerf:${cutId}`;
}

/**
 * Divides an available rectangular region along an axis.
 *
 * The kept child occupies the first `keptExtentMm` of the parent along the
 * axis, starting at the parent origin. The kerf band of `kerfMm` follows it;
 * when a solid remainder exists, the rest child fills the far side of the
 * parent. All parts are contained in the parent, pairwise disjoint, and
 * conserve the parent's surface.
 *
 * Supported domain (edge cases made explicit, policy owned by separateExtent):
 * - all measures must be finite; NaN/Infinity are rejected;
 * - parent dimensions must be positive;
 * - `keptExtentMm` must be > 0 and `kerfMm` >= 0;
 * - exact_fit (kept already spans the parent) is NOT a division: the region
 *   is declared a terminal leaf with no fictitious pass;
 * - kerf_only (remainder equals the blade band) is a valid division that
 *   produces only the kept child plus the kerf band — no zero-area rest
 *   region is fabricated;
 * - blade_exits_parent (remainder smaller than the blade band) is rejected by
 *   default: the blade is never silently shortened nor counted twice. With
 *   the explicit `allowBladeExit` option the pass is admitted as a band
 *   clipped to the parent (see the policy note inside divideRegion); the
 *   caller is responsible for the physical guarantee that the overhang only
 *   consumes already-removed material;
 * - kerf 0 is admitted: the band is reported with zero area and is never a
 *   physical region, so no invalid region is fabricated.
 */
export function divideRegion(
  parent: CutProgramRect,
  axis: CutProgramAxis,
  keptExtentMm: number,
  kerfMm: number,
  options?: { readonly allowBladeExit?: boolean },
): CutProgramDivisionGeometry {
  assertRect(parent, 'padre', {});
  if (axis !== 'x' && axis !== 'y') {
    fail('cut_program.axis_invalid', 'Eje de división debe ser "x" o "y"', { axis });
  }
  if (!Number.isFinite(keptExtentMm) || keptExtentMm <= 0) {
    fail('cut_program.measure_invalid', 'Medida relativa de corte debe ser finita y > 0', {
      keptExtentMm,
      axis,
    });
  }
  if (!Number.isFinite(kerfMm) || kerfMm < 0) {
    fail('cut_program.kerf_invalid', 'Kerf debe ser finito y >= 0', { kerfMm, axis });
  }

  const parentExtent = axis === 'x' ? parent.lengthMm : parent.widthMm;
  const separation = separateExtent(parentExtent, keptExtentMm, kerfMm);
  if (separation.kind === 'exact_fit') {
    fail(
      'cut_program.cut_at_border_unsupported',
      'La región ya coincide con la medida: declárala hoja terminal, no una pasada ficticia',
      { keptExtentMm, kerfMm, parentExtent, axis, separation: separation.kind },
    );
  }
  if (separation.kind === 'blade_exits_parent' && options?.allowBladeExit !== true) {
    fail(
      'cut_program.cut_at_border_unsupported',
      'Corte al borde no soportado: el disco saldría del padre; no se recorta silenciosamente',
      { keptExtentMm, kerfMm, parentExtent, axis, separation: separation.kind },
    );
  }

  // Blade-exit policy (explicit, never silent): the remainder is smaller than
  // the blade band, so the pass consumes the whole remainder as a band
  // CLIPPED to the parent and the blade overhang continues into material
  // already removed outside the region (an earlier kerf band or exterior
  // trim). The caller opts in only when that physical guarantee holds — the
  // optimizer's region chains always do, because every region far edge is a
  // board/trim edge or an earlier kerf boundary, never live material. The
  // blade is counted exactly once; nothing live is cut.
  const gapMm = parentExtent - keptExtentMm;
  const bandExtentMm =
    separation.kind === 'blade_exits_parent'
      ? gapMm
      : kerfMm;
  const restExtentMm = separation.kind === 'solid_rest' ? separation.restExtentMm : null;

  const geometry =
    axis === 'x'
      ? {
          axis,
          keptExtentMm,
          kerfMm,
          keptRect: { xMm: parent.xMm, yMm: parent.yMm, lengthMm: keptExtentMm, widthMm: parent.widthMm },
          kerfBandRect: { xMm: parent.xMm + keptExtentMm, yMm: parent.yMm, lengthMm: bandExtentMm, widthMm: parent.widthMm },
          restRect:
            restExtentMm === null
              ? null
              : { xMm: parent.xMm + keptExtentMm + kerfMm, yMm: parent.yMm, lengthMm: restExtentMm, widthMm: parent.widthMm },
          bladeExitsParent: separation.kind === 'blade_exits_parent',
        }
      : {
          axis,
          keptExtentMm,
          kerfMm,
          keptRect: { xMm: parent.xMm, yMm: parent.yMm, lengthMm: parent.lengthMm, widthMm: keptExtentMm },
          kerfBandRect: { xMm: parent.xMm, yMm: parent.yMm + keptExtentMm, lengthMm: parent.lengthMm, widthMm: bandExtentMm },
          restRect:
            restExtentMm === null
              ? null
              : { xMm: parent.xMm, yMm: parent.yMm + keptExtentMm + kerfMm, lengthMm: parent.lengthMm, widthMm: restExtentMm },
          bladeExitsParent: separation.kind === 'blade_exits_parent',
        };

  const representable = (r: CutProgramRect | null): boolean =>
    r === null ||
    (Number.isFinite(r.xMm) &&
      Number.isFinite(r.yMm) &&
      Number.isFinite(r.lengthMm) &&
      Number.isFinite(r.widthMm));
  if (
    !representable(geometry.keptRect) ||
    !representable(geometry.kerfBandRect) ||
    !representable(geometry.restRect)
  ) {
    fail('cut_program.geometry_not_representable', 'Geometría resultante no finita y no representable', {
      keptExtentMm,
      kerfMm,
      axis,
    });
  }

  return geometry;
}

function assertDivisionPartition(
  parentRect: CutProgramRect,
  geometry: CutProgramDivisionGeometry,
  cutId: string,
): void {
  const { keptRect, kerfBandRect, restRect } = geometry;
  // Containment uses the same arithmetic policy as equality and area checks:
  // a recomputed far edge that exceeds the parent far edge by pure IEEE-754
  // noise (e.g. 2440.0000000000005 vs 2440) is contained; geometry is never
  // silently trimmed to pass validation.
  const contained = (r: CutProgramRect): boolean =>
    atLeast(r.xMm, parentRect.xMm) &&
    atLeast(r.yMm, parentRect.yMm) &&
    atMost(r.xMm + r.lengthMm, parentRect.xMm + parentRect.lengthMm) &&
    atMost(r.yMm + r.widthMm, parentRect.yMm + parentRect.widthMm);
  const areasSum =
    rectArea(keptRect) + rectArea(kerfBandRect) + (restRect ? rectArea(restRect) : 0);
  if (!contained(keptRect) || !contained(kerfBandRect) || (restRect && !contained(restRect))) {
    fail('cut_program.invariant_violated', 'Resultado fuera del padre', { cutId });
  }
  if (!sameMeasure(areasSum, rectArea(parentRect))) {
    fail('cut_program.invariant_violated', 'Hijos + kerf no conservan la superficie del padre', {
      cutId,
    });
  }
}

/**
 * Validates and reproduces a cut program.
 *
 * Every division is recomputed from its parent, axis, relative measure and
 * kerf; geometries declared by the input are only accepted when they match the
 * recomputation within the arithmetic policy. Each parent must exist and be
 * available (created earlier, never consumed, never terminal). No region is
 * consumed twice, no orphan or disconnected region survives, and every leaf
 * must be declared terminal — an incomplete program presented as finished is
 * rejected. Leaves plus kerf bands must conserve the board surface.
 *
 * The returned trace is built exclusively from executed geometry: the board
 * root is copied, each division consumes the executed rectangle of its parent,
 * and recomputed children become the executed regions for later cuts,
 * terminals, boardRect, regionRects and area totals. Declared geometry is
 * inspection-only, so a difference accepted as representation noise never
 * becomes output authority and the result shares no mutable object with the
 * input.
 *
 * Throws ValidationError (context carries a machine-readable `code` plus the
 * cut/region/piece that caused the problem and how many divisions had been
 * executed when validation stopped). A failed program never yields a partial
 * trace as if it were valid.
 */
export function executeCutProgram(program: CutProgramInput): CutProgramTrace {
  if (program.schemaVersion !== CUT_PROGRAM_SCHEMA_VERSION) {
    fail('cut_program.schema_unsupported', 'Versión de esquema del programa no soportada', {
      expected: CUT_PROGRAM_SCHEMA_VERSION,
      received: program.schemaVersion,
    });
  }

  // Declared geometry is inspected and validated only. The authoritative
  // output geometry is recomputed (executedRects): the board root is copied
  // and every division consumes and registers executed rectangles, so the
  // trace never shares mutable objects with the input and never mixes
  // declared values into the validated result.
  const declaredRects = new Map<string, CutProgramRect>();
  for (const region of program.regions) {
    if (declaredRects.has(region.regionId)) {
      fail('cut_program.region_duplicate_id', 'RegionId duplicado en el programa', {
        regionId: region.regionId,
      });
    }
    assertRect(region.rect, region.regionId, { regionId: region.regionId });
    declaredRects.set(region.regionId, region.rect);
  }

  const declaredBoardRect = declaredRects.get(program.boardRegionId);
  if (!declaredBoardRect) {
    fail('cut_program.reference_missing', 'Región de tablero no declarada', {
      regionId: program.boardRegionId,
    });
  }
  const executedRects = new Map<string, CutProgramRect>();
  const boardRect: CutProgramRect = { ...declaredBoardRect };
  executedRects.set(program.boardRegionId, boardRect);

  const cutIds = new Set<string>();
  for (const division of program.divisions) {
    if (cutIds.has(division.cutId)) {
      fail('cut_program.cut_duplicate_id', 'CutId duplicado en el programa', {
        cutId: division.cutId,
      });
    }
    cutIds.add(division.cutId);
  }

  const terminalRegionIds = new Set<string>();
  const terminalByRegion = new Map<string, CutProgramTerminalDeclaration>();
  for (const terminal of program.terminals) {
    if (terminalByRegion.has(terminal.regionId)) {
      fail('cut_program.terminal_duplicate', 'Región declarada terminal dos veces', {
        regionId: terminal.regionId,
      });
    }
    terminalByRegion.set(terminal.regionId, terminal);
    terminalRegionIds.add(terminal.regionId);
    if (terminal.kind === 'piece' && (!terminal.pieceRef || terminal.pieceRef.length === 0)) {
      fail('cut_program.piece_ref_required', 'Terminal de pieza sin referencia de pieza', {
        regionId: terminal.regionId,
      });
    }
  }
  const pieceRefs = new Set<string>();
  for (const terminal of program.terminals) {
    if (terminal.kind === 'piece' && terminal.pieceRef) {
      if (pieceRefs.has(terminal.pieceRef)) {
        fail('cut_program.piece_ref_duplicate', 'Referencia de pieza declarada en dos hojas', {
          pieceRef: terminal.pieceRef,
        });
      }
      pieceRefs.add(terminal.pieceRef);
    }
  }

  const producedBy = new Map<string, string>();
  const consumedBy = new Set<string>();
  const traceDivisions: CutProgramTraceDivision[] = [];
  const kerfBands: CutProgramKerfBand[] = [];

  for (const [index, division] of program.divisions.entries()) {
    const executedSoFar = index;
    const cutContext = { cutId: division.cutId, executedDivisions: executedSoFar };
    if (!declaredRects.has(division.parentRegionId)) {
      fail('cut_program.reference_missing', 'Región padre no declarada', {
        ...cutContext,
        regionId: division.parentRegionId,
      });
    }
    const parentRect = executedRects.get(division.parentRegionId);
    if (!parentRect) {
      fail('cut_program.parent_not_yet_available', 'El padre aún no existe al ejecutar este corte', {
        ...cutContext,
        regionId: division.parentRegionId,
      });
    }
    if (consumedBy.has(division.parentRegionId)) {
      fail('cut_program.parent_already_consumed', 'La región padre ya fue consumida por otro corte', {
        ...cutContext,
        regionId: division.parentRegionId,
      });
    }
    if (terminalRegionIds.has(division.parentRegionId)) {
      fail('cut_program.terminal_consumed', 'Una región terminal no puede recibir cortes', {
        ...cutContext,
        regionId: division.parentRegionId,
      });
    }

    let geometry: CutProgramDivisionGeometry;
    try {
      geometry = divideRegion(parentRect, division.axis, division.keptExtentMm, division.kerfMm, {
        allowBladeExit: division.bladeExitsParent === true,
      });
    } catch (error) {
      if (error instanceof ValidationError && error.context && !('cutId' in error.context)) {
        throw new ValidationError(error.message, { ...error.context, ...cutContext });
      }
      throw error;
    }
    if (geometry.bladeExitsParent !== (division.bladeExitsParent === true)) {
      fail(
        'cut_program.blade_exit_mismatch',
        'La declaración de salida de disco no coincide con la geometría recalculada',
        { ...cutContext, declared: division.bladeExitsParent === true },
      );
    }

    const keptDeclared = declaredRects.get(division.keptRegionId);
    if (!keptDeclared) {
      fail('cut_program.reference_missing', 'Región resultado (kept) no declarada', {
        ...cutContext,
        regionId: division.keptRegionId,
      });
    }
    const hasRestRegion = division.restRegionId !== undefined;
    if (hasRestRegion && geometry.restRect === null) {
      fail(
        'cut_program.unexpected_rest_region',
        'La división consume el resto exclusivamente como kerf: no declare una región resto que no existe',
        { ...cutContext, regionId: division.restRegionId },
      );
    }
    if (!hasRestRegion && geometry.restRect !== null) {
      fail(
        'cut_program.missing_rest_region',
        'La división produce un resto sólido que no está declarado: no se descarta superficie',
        {
          ...cutContext,
          restExtentMm:
            division.axis === 'x' ? geometry.restRect.lengthMm : geometry.restRect.widthMm,
        },
      );
    }
    const restDeclared = hasRestRegion ? declaredRects.get(division.restRegionId!) : undefined;
    if (hasRestRegion && !restDeclared) {
      fail('cut_program.reference_missing', 'Región resultado (rest) no declarada', {
        ...cutContext,
        regionId: division.restRegionId,
      });
    }

    for (const [childId, producingCut] of [
      [division.keptRegionId, division.cutId],
      ...(hasRestRegion ? ([[division.restRegionId!, division.cutId]] as const) : []),
    ] as const) {
      if (childId === program.boardRegionId) {
        fail('cut_program.region_produced_twice', 'El tablero no puede ser resultado de un corte', {
          ...cutContext,
          regionId: childId,
        });
      }
      const previousCut = producedBy.get(childId);
      if (previousCut !== undefined) {
        fail('cut_program.region_produced_twice', 'Región producida por dos cortes', {
          ...cutContext,
          regionId: childId,
          previousCutId: previousCut,
        });
      }
      producedBy.set(childId, producingCut);
    }

    const declaredChildren: (readonly [string, CutProgramRect, CutProgramRect])[] = [
      [division.keptRegionId, keptDeclared!, geometry.keptRect],
    ];
    if (hasRestRegion && restDeclared && geometry.restRect) {
      declaredChildren.push([division.restRegionId!, restDeclared, geometry.restRect]);
    }
    for (const [childId, declared, expected] of declaredChildren) {
      if (!sameRect(declared, expected)) {
        fail(
          'cut_program.geometry_mismatch',
          'Geometría declarada no coincide con la recalculada desde padre, eje, medida y kerf',
          { ...cutContext, regionId: childId, declared, expected },
        );
      }
    }

    assertDivisionPartition(parentRect, geometry, division.cutId);

    const bandId = kerfBandIdOf(division.cutId);
    consumedBy.add(division.parentRegionId);
    executedRects.set(division.keptRegionId, geometry.keptRect);
    if (division.restRegionId !== undefined && geometry.restRect) {
      executedRects.set(division.restRegionId, geometry.restRect);
    }
    kerfBands.push({ cutId: division.cutId, bandId, rect: geometry.kerfBandRect });
    traceDivisions.push({
      order: index + 1,
      cutId: division.cutId,
      parentRegionId: division.parentRegionId,
      parentRect,
      axis: division.axis,
      keptExtentMm: division.keptExtentMm,
      kerfMm: division.kerfMm,
      keptRegionId: division.keptRegionId,
      keptRect: geometry.keptRect,
      restRegionId: division.restRegionId,
      restRect: geometry.restRect,
      kerfBandId: bandId,
      kerfBandRect: geometry.kerfBandRect,
      bladeExitsParent: geometry.bladeExitsParent,
    });
  }

  for (const region of program.regions) {
    if (region.regionId !== program.boardRegionId && !producedBy.has(region.regionId)) {
      fail('cut_program.orphan_region', 'Región declarada que ningún corte produce', {
        regionId: region.regionId,
      });
    }
  }

  for (const regionId of executedRects.keys()) {
    if (!consumedBy.has(regionId) && !terminalRegionIds.has(regionId)) {
      fail('cut_program.incomplete_program', 'Región hoja sin declaración terminal: programa incompleto', {
        regionId,
      });
    }
  }

  const terminals: CutProgramTerminalRegion[] = program.terminals.map((terminal) => {
    const rect = executedRects.get(terminal.regionId);
    if (!rect) {
      fail('cut_program.reference_missing', 'Terminal referencia una región inexistente', {
        regionId: terminal.regionId,
      });
    }
    return {
      regionId: terminal.regionId,
      rect,
      kind: terminal.kind,
      pieceRef: terminal.pieceRef,
    };
  });

  const boardAreaMm2 = rectArea(boardRect);
  const leafAreaMm2 = terminals.reduce((sum, t) => sum + rectArea(t.rect), 0);
  const kerfAreaMm2 = kerfBands.reduce((sum, band) => sum + rectArea(band.rect), 0);
  if (!sameMeasure(leafAreaMm2 + kerfAreaMm2, boardAreaMm2)) {
    fail('cut_program.area_not_conserved', 'Hojas finales + kerf no conservan la superficie inicial', {
      boardAreaMm2,
      leafAreaMm2,
      kerfAreaMm2,
    });
  }

  return {
    schemaVersion: program.schemaVersion,
    boardRegionId: program.boardRegionId,
    boardRect,
    divisions: traceDivisions,
    kerfBands,
    terminals,
    regionRects: executedRects,
    boardAreaMm2,
    leafAreaMm2,
    kerfAreaMm2,
  };
}

/**
 * Checks the piece leaves of an executed program against the expected piece
 * references and dimensions of a bounded fixture.
 *
 * Matching is per identity and per dimension: matching total surface is not
 * acceptance, and two pieces of wrong dimensions do not become valid because
 * their areas add up. Two identical pieces keep distinct identities through
 * distinct pieceRefs and are never collapsed by name or measure. Expected
 * pieces cannot be omitted, duplicated or silently substituted, and piece
 * leaves without an expected reference are rejected too.
 *
 * This check is geometric identity only: it does not recalculate BOM, edge
 * deduction or catalog demand.
 */
export function checkExpectedPieces(
  trace: CutProgramTrace,
  expected: readonly CutProgramExpectedPiece[],
): void {
  const expectedRefs = new Set<string>();
  for (const piece of expected) {
    if (!Number.isFinite(piece.lengthMm) || piece.lengthMm <= 0 ||
        !Number.isFinite(piece.widthMm) || piece.widthMm <= 0) {
      fail('cut_program.piece_expected_invalid', 'Pieza esperada con dimensiones inválidas', {
        pieceRef: piece.pieceRef,
      });
    }
    if (expectedRefs.has(piece.pieceRef)) {
      fail('cut_program.piece_expected_duplicate', 'Referencia esperada duplicada en el fixture', {
        pieceRef: piece.pieceRef,
      });
    }
    expectedRefs.add(piece.pieceRef);
  }

  const pieceTerminals = trace.terminals.filter((t) => t.kind === 'piece');
  const matchedRegionIds = new Set<string>();

  for (const piece of expected) {
    const matches = pieceTerminals.filter((t) => t.pieceRef === piece.pieceRef);
    if (matches.length === 0) {
      fail('cut_program.piece_missing', 'Pieza esperada no producida por el programa', {
        pieceRef: piece.pieceRef,
        expected: { lengthMm: piece.lengthMm, widthMm: piece.widthMm },
      });
    }
    if (matches.length > 1) {
      fail('cut_program.piece_duplicated', 'Referencia de pieza producida en varias hojas', {
        pieceRef: piece.pieceRef,
      });
    }
    const match = matches[0]!;
    matchedRegionIds.add(match.regionId);
    if (
      !sameMeasure(match.rect.lengthMm, piece.lengthMm) ||
      !sameMeasure(match.rect.widthMm, piece.widthMm)
    ) {
      fail('cut_program.piece_dimension_mismatch', 'Pieza producida con dimensiones incorrectas', {
        pieceRef: piece.pieceRef,
        regionId: match.regionId,
        expected: { lengthMm: piece.lengthMm, widthMm: piece.widthMm },
        received: { lengthMm: match.rect.lengthMm, widthMm: match.rect.widthMm },
      });
    }
  }

  for (const terminal of pieceTerminals) {
    if (!matchedRegionIds.has(terminal.regionId)) {
      fail('cut_program.piece_unexpected', 'Hoja de pieza sin pieza esperada que la justifique', {
        pieceRef: terminal.pieceRef,
        regionId: terminal.regionId,
      });
    }
  }
}
