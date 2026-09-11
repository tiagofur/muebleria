/**
 * Internal registration helper for the guillotine heuristics (#650, PR 2).
 *
 * Records regions, divisions and terminals WHILE the heuristics pack, so the
 * emitted CutProgramInput is the program that produced the placement — never
 * a later reconstruction from piece coordinates. This is plumbing shared by
 * the heuristics: not a framework, not a plugin registry and not a
 * manufacturing authority. Every geometry/validation rule stays in
 * cutProgram.ts (separateExtent / divideRegion / executeCutProgram).
 */

import { ValidationError } from '../errors';
import {
  CUT_PROGRAM_SCHEMA_VERSION,
  divideRegion,
  separateExtent,
  type CutProgramAxis,
  type CutProgramDivision,
  type CutProgramInput,
  type CutProgramRect,
  type CutProgramRegion,
  type CutProgramTerminalDeclaration,
  type CutProgramTerminalKind,
} from './cutProgram';
import { isUsefulRemnant } from './pieces';
import type { CutPlanConfig, CutTrimMargins } from './types';

/**
 * Region reference handed back to the heuristics: identity plus geometry.
 * The heuristics use these as their free rectangles, so a selected FreeRect
 * always carries the identity and geometry of the program region that
 * produced it.
 */
export interface RegisteredRegion {
  readonly regionId: string;
  readonly x: number;
  readonly y: number;
  readonly length: number;
  readonly width: number;
}

export interface SeparateRegionResult {
  /** Kept child, or the parent itself on an exact fit (no pass exists). */
  readonly kept: RegisteredRegion;
  /** Solid rest beyond the kerf band, or null when nothing remains. */
  readonly rest: RegisteredRegion | null;
  /** True when an actual saw pass was registered for this separation. */
  readonly cutHappened: boolean;
}

function toRect(region: RegisteredRegion): CutProgramRect {
  return { xMm: region.x, yMm: region.y, lengthMm: region.length, widthMm: region.width };
}

export class CutProgramSheetBuilder {
  private readonly regionsById = new Map<string, RegisteredRegion>();
  private readonly outRegions: CutProgramRegion[] = [];
  private readonly outDivisions: CutProgramDivision[] = [];
  private readonly outTerminals: CutProgramTerminalDeclaration[] = [];
  private cutSeq = 0;

  constructor(board: {
    readonly boardRegionId: string;
    readonly x: number;
    readonly y: number;
    readonly length: number;
    readonly width: number;
  }) {
    const region: RegisteredRegion = {
      regionId: board.boardRegionId,
      x: board.x,
      y: board.y,
      length: board.length,
      width: board.width,
    };
    this.regionsById.set(region.regionId, region);
    this.outRegions.push({ regionId: region.regionId, rect: toRect(region) });
  }

  region(regionId: string): RegisteredRegion {
    const region = this.regionsById.get(regionId);
    if (!region) {
      throw new ValidationError(`Región no registrada: ${regionId}`, {
        code: 'cut_plan.region_not_registered',
        regionId,
      });
    }
    return region;
  }

  /**
   * Registers one guillotine separation of a parent region along an axis,
   * recomputing the children geometry with the core. Exact fits register no
   * pass (the parent region is returned as the kept region). A remainder
   * smaller than the blade band is admitted as an explicit blade-exit pass
   * (band clipped to the parent): every region produced by these heuristics
   * has its far edges on board/trim borders or earlier kerf boundaries, so
   * the blade overhang never cuts live material. Hand-built programs must
   * only declare such passes when that physical guarantee holds.
   */
  divide(params: {
    readonly parentRegionId: string;
    readonly axis: CutProgramAxis;
    readonly keptExtentMm: number;
    readonly kerfMm: number;
    readonly cutId?: string;
    readonly keptRegionId?: string;
    readonly restRegionId?: string;
    readonly pieceRef?: string;
  }): SeparateRegionResult {
    const parent = this.region(params.parentRegionId);
    const parentExtentMm = params.axis === 'x' ? parent.length : parent.width;
    const separation = separateExtent(parentExtentMm, params.keptExtentMm, params.kerfMm);
    if (separation.kind === 'exact_fit') {
      return { kept: parent, rest: null, cutHappened: false };
    }

    const geometry = divideRegion(toRect(parent), params.axis, params.keptExtentMm, params.kerfMm, {
      allowBladeExit: true,
    });
    const cutId = params.cutId ?? `cut-${++this.cutSeq}`;
    const keptRegionId = params.keptRegionId ?? `${cutId}:kept`;
    const kept: RegisteredRegion = {
      regionId: keptRegionId,
      x: geometry.keptRect.xMm,
      y: geometry.keptRect.yMm,
      length: geometry.keptRect.lengthMm,
      width: geometry.keptRect.widthMm,
    };
    this.register(kept);
    let rest: RegisteredRegion | null = null;
    const bladeExitsParent = geometry.bladeExitsParent ? true : undefined;
    if (geometry.restRect) {
      const restRegionId = params.restRegionId ?? `${cutId}:rest`;
      rest = {
        regionId: restRegionId,
        x: geometry.restRect.xMm,
        y: geometry.restRect.yMm,
        length: geometry.restRect.lengthMm,
        width: geometry.restRect.widthMm,
      };
      this.register(rest);
      this.outDivisions.push({
        cutId,
        parentRegionId: params.parentRegionId,
        axis: params.axis,
        keptExtentMm: params.keptExtentMm,
        kerfMm: params.kerfMm,
        keptRegionId,
        restRegionId,
        bladeExitsParent,
      });
    } else {
      this.outDivisions.push({
        cutId,
        parentRegionId: params.parentRegionId,
        axis: params.axis,
        keptExtentMm: params.keptExtentMm,
        kerfMm: params.kerfMm,
        keptRegionId,
        bladeExitsParent,
      });
    }
    return { kept, rest, cutHappened: true };
  }

  markTerminal(regionId: string, kind: CutProgramTerminalKind, pieceRef?: string): void {
    this.region(regionId);
    this.outTerminals.push({ regionId, kind, pieceRef });
  }

  markPieceTerminal(regionId: string, pieceRef: string): void {
    this.markTerminal(regionId, 'piece', pieceRef);
  }

  /**
   * Classifies a leftover leaf with the existing useful-remnant policy. The
   * program never erases small leftovers to balance figures: they stay as
   * waste terminals even when the historical remnant list omits them.
   */
  markLeftoverTerminal(region: RegisteredRegion, config: CutPlanConfig): void {
    const kind: CutProgramTerminalKind = isUsefulRemnant(region.length, region.width, config)
      ? 'remnant'
      : 'waste';
    this.markTerminal(region.regionId, kind);
  }

  build(): CutProgramInput {
    const boardRegionId = this.outRegions[0]!.regionId;
    return {
      schemaVersion: CUT_PROGRAM_SCHEMA_VERSION,
      boardRegionId,
      regions: [...this.outRegions],
      divisions: [...this.outDivisions],
      terminals: [...this.outTerminals],
    };
  }

  private register(region: RegisteredRegion): void {
    if (this.regionsById.has(region.regionId)) {
      throw new ValidationError(`RegionId duplicado al registrar: ${region.regionId}`, {
        code: 'cut_plan.region_duplicate_id',
        regionId: region.regionId,
      });
    }
    this.regionsById.set(region.regionId, region);
    this.outRegions.push({ regionId: region.regionId, rect: toRect(region) });
  }
}

/**
 * Registers the raw board and its trim margins as explicit divisions, in a
 * fixed order (left, right, bottom, top), and returns the usable region.
 *
 * Each margin is one solid-waste separation with kerf 0: under the existing
 * optimizer semantics the margin is the whole band removed from the raw
 * board, so every retired surface is counted exactly once and stays distinct
 * from the saw kerf bands. How trims are later serialized to PTX is a
 * separate decision (#650 entrega B), not represented here. Mapping is
 * explicit — bottom margin at the Y origin, top at the far edge — with no
 * silent top/bottom or Y-axis inversion.
 */
export function registerTrimDivisions(
  builder: CutProgramSheetBuilder,
  trim: CutTrimMargins,
): RegisteredRegion {
  let region = builder.region('board');

  if (trim.leftMm > 0) {
    const sep = builder.divide({
      parentRegionId: region.regionId,
      axis: 'x',
      keptExtentMm: trim.leftMm,
      kerfMm: 0,
      cutId: 'trim:left',
      keptRegionId: 'trim:left',
    });
    builder.markTerminal(sep.kept.regionId, 'waste');
    region = sep.rest ?? region;
  }
  if (trim.rightMm > 0) {
    const sep = builder.divide({
      parentRegionId: region.regionId,
      axis: 'x',
      keptExtentMm: region.length - trim.rightMm,
      kerfMm: 0,
      cutId: 'trim:right',
      restRegionId: 'trim:right',
    });
    builder.markTerminal(sep.rest!.regionId, 'waste');
    region = sep.kept;
  }
  if (trim.bottomMm > 0) {
    const sep = builder.divide({
      parentRegionId: region.regionId,
      axis: 'y',
      keptExtentMm: trim.bottomMm,
      kerfMm: 0,
      cutId: 'trim:bottom',
      keptRegionId: 'trim:bottom',
    });
    builder.markTerminal(sep.kept.regionId, 'waste');
    region = sep.rest ?? region;
  }
  if (trim.topMm > 0) {
    const sep = builder.divide({
      parentRegionId: region.regionId,
      axis: 'y',
      keptExtentMm: region.width - trim.topMm,
      kerfMm: 0,
      cutId: 'trim:top',
      restRegionId: 'trim:top',
    });
    builder.markTerminal(sep.rest!.regionId, 'waste');
    region = sep.kept;
  }

  return region;
}
