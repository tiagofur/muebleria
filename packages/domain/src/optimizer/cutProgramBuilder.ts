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
  private readonly liberatedWasteRegionIds = new Set<string>();
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
   * (band clipped to the parent); executeCutProgram verifies at validation
   * time that the overhang covers no live material. `leadingBand` mirrors the
   * layout ([rest][band][kept], kept anchored at the far end) for near-side
   * trim passes.
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
    readonly leadingBand?: boolean;
    readonly trim?: boolean;
  }): SeparateRegionResult {
    const parent = this.region(params.parentRegionId);
    const separation = separateExtent(
      params.axis === 'x' ? parent.length : parent.width,
      params.keptExtentMm,
      params.kerfMm,
    );
    if (separation.kind === 'exact_fit') {
      return { kept: parent, rest: null, cutHappened: false };
    }

    const geometry = divideRegion(toRect(parent), params.axis, params.keptExtentMm, params.kerfMm, {
      allowBladeExit: true,
      leadingBand: params.leadingBand === true,
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
    const leadingBand = params.leadingBand === true ? true : undefined;
    const trim = params.trim === true ? true : undefined;
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
        leadingBand,
        trim,
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
        leadingBand,
        trim,
      });
    }
    return { kept, rest, cutHappened: true };
  }

  markTerminal(
    regionId: string,
    kind: CutProgramTerminalKind,
    pieceRef?: string,
    options?: { readonly liberated?: boolean },
  ): void {
    this.region(regionId);
    this.outTerminals.push({ regionId, kind, pieceRef, liberated: options?.liberated });
  }

  markPieceTerminal(regionId: string, pieceRef: string): void {
    this.markTerminal(regionId, 'piece', pieceRef);
  }

  /**
   * Waste leaf whose material leaves the working surface with its producing
   * division (trim strips are discarded with the trim pass). This explicit
   * handling precondition is what later blade overhangs may cross.
   */
  markLiberatedWasteTerminal(regionId: string): void {
    this.liberatedWasteRegionIds.add(regionId);
    this.markTerminal(regionId, 'waste', undefined, { liberated: true });
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

  /**
   * Region ids of waste leaves declared liberated (trim strips). Used to keep
   * the presentation-level remnant list free of trim garbage while the
   * program still accounts for it.
   */
  getLiberatedWasteRegionIds(): ReadonlySet<string> {
    return this.liberatedWasteRegionIds;
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
 * Semantics of the TOTAL margin (the optimizer's existing convention): the
 * margin is the whole band removed from the raw board, so under a configured
 * blade of `kerfMm` each trim pass yields solid waste of `margin - kerfMm`
 * plus a real blade band of `kerfMm` adjacent to the usable region — e.g.
 * margin 10 with blade 4 leaves solid 0..6, band 6..10 and usable from 10.
 * The blade is never added on top of the margin (no 6000 + 2400 double
 * count) and a zero-area band is never recorded for a positive blade.
 *
 * Edge cases are explicit: margin == kerf consumes the whole margin as a
 * kerf-only pass; margin < kerf clips the band to the margin and lets the
 * blade exit through the board edge (bladeExitsParent), instead of hiding
 * the situation behind a zero-kerf partition. Near-side trims (left/bottom)
 * use leading bands ([solid][band][kept]); far-side trims (right/top) use
 * the normal layout ([kept][band][solid]). Mapping is explicit — bottom
 * margin at the Y origin, top at the far edge — with no silent top/bottom or
 * Y-axis inversion. Usable coordinates and piece positions are unchanged by
 * this representation; how trims are later serialized to PTX is a separate
 * decision (#650 entrega B).
 */
export function registerTrimDivisions(
  builder: CutProgramSheetBuilder,
  trim: CutTrimMargins,
  kerfMm: number,
): RegisteredRegion {
  let region = builder.region('board');

  if (trim.leftMm > 0) {
    const sep = builder.divide({
      parentRegionId: region.regionId,
      axis: 'x',
      leadingBand: true,
      keptExtentMm: region.length - trim.leftMm,
      kerfMm,
      cutId: 'trim:left',
      restRegionId: 'trim:left',
      trim: true,
    });
    if (sep.rest) {
      builder.markLiberatedWasteTerminal(sep.rest.regionId);
    }
    region = sep.kept;
  }
  if (trim.rightMm > 0) {
    const sep = builder.divide({
      parentRegionId: region.regionId,
      axis: 'x',
      keptExtentMm: region.length - trim.rightMm,
      kerfMm,
      cutId: 'trim:right',
      restRegionId: 'trim:right',
      trim: true,
    });
    if (sep.rest) {
      builder.markLiberatedWasteTerminal(sep.rest.regionId);
    }
    region = sep.kept;
  }
  if (trim.bottomMm > 0) {
    const sep = builder.divide({
      parentRegionId: region.regionId,
      axis: 'y',
      leadingBand: true,
      keptExtentMm: region.width - trim.bottomMm,
      kerfMm,
      cutId: 'trim:bottom',
      restRegionId: 'trim:bottom',
      trim: true,
    });
    if (sep.rest) {
      builder.markLiberatedWasteTerminal(sep.rest.regionId);
    }
    region = sep.kept;
  }
  if (trim.topMm > 0) {
    const sep = builder.divide({
      parentRegionId: region.regionId,
      axis: 'y',
      keptExtentMm: region.width - trim.topMm,
      kerfMm,
      cutId: 'trim:top',
      restRegionId: 'trim:top',
      trim: true,
    });
    if (sep.rest) {
      builder.markLiberatedWasteTerminal(sep.rest.regionId);
    }
    region = sep.kept;
  }

  return region;
}
