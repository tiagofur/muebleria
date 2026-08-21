/**
 * Parametric 32mm-system joint drilling rules (F129).
 *
 * Turns declarative rules into DERIVED hardware placements that the F128
 * resolver consumes — the box drills itself: minifix+dowels for
 * side↔floor/top joints, screws for the back panel, hinge cups + plates for
 * doors (count via workshopRules). Derived placements are computed at
 * resolve time, never persisted; manual exceptions (F131) merge on top.
 *
 * Conventions (board-local, same as hardwarePlacement/F128):
 * - lateral panels: length = height, width = depth; big faces front/back.
 * - base/superior: length = module width, width = depth; length-axis end
 *   faces are board-local top/bottom.
 * - trasera: length = height, width = module width.
 * - puerta: length = height, width = door width; cups on the back (inner) face.
 * World-side mirroring (door handing, left/right handing) is the export's
 * concern (F130), not the generator's.
 */

import { snapValue } from './hardwarePlacement';
import { DEFAULT_BOARD_THICKNESS_MM } from './partDrilling';
import { suggestHingeCount } from './workshopRules';
import type {
  ComponentPlacement,
  Hardware,
  HardwarePlacement,
  JointDrillingRules,
  JointKind,
  ResolvedBoardPart,
} from './types';

export const DEFAULT_JOINT_DRILLING_RULES: JointDrillingRules = {
  gridMm: 32,
  sideToFloor: {
    minifixCode: 'HER-MIN-15',
    dowelCode: 'HER-TAQ-8X30',
    endMarginMm: 50,
    maxSpacingMm: 512,
    withDowels: true,
  },
  sideToTop: {
    minifixCode: 'HER-MIN-15',
    dowelCode: 'HER-TAQ-8X30',
    endMarginMm: 50,
    maxSpacingMm: 512,
    withDowels: true,
  },
  backPanel: {
    screwCode: 'HER-TOR-4X50',
    insetMm: 16,
    maxSpacingMm: 400,
  },
  doorHinge: {
    hingeCode: 'HER-BIS-CL',
    plateCode: 'HER-PLACA-BIS',
    cupInsetMm: 22.5,
    systemLineMm: 37,
    endMarginMm: 100,
  },
};

/** A resolved piece the generator can classify (composed modules only). */
export type JointPart = ResolvedBoardPart & {
  readonly componentPlacement?: ComponentPlacement;
};

export interface DerivedJointPlacement extends HardwarePlacement {
  /** Expanded board part id this placement drills (join key for F128). */
  readonly partId: string;
  readonly joint: JointKind;
}

export interface DeriveJointPlacementsParams {
  readonly parts: readonly JointPart[];
  readonly hardware: readonly Hardware[];
  /** Structure/module override; omitted = taller defaults. */
  readonly rules?: JointDrillingRules;
}

const LATERAL_PLACEMENTS: ReadonlySet<string> = new Set([
  'lateral_izquierdo',
  'lateral_derecho',
]);

/**
 * Merge a (possibly partial) override with the taller defaults so a rule that
 * only tunes one knob (e.g. endMarginMm) keeps the default hardware codes.
 */
function effectiveRules(
  rules?: JointDrillingRules,
): Required<Pick<JointDrillingRules, 'gridMm' | 'sideToFloor' | 'sideToTop' | 'backPanel' | 'doorHinge'>> {
  const d = DEFAULT_JOINT_DRILLING_RULES;
  return {
    gridMm: rules?.gridMm ?? d.gridMm ?? 32,
    sideToFloor: { ...d.sideToFloor, ...rules?.sideToFloor },
    sideToTop: { ...d.sideToTop, ...rules?.sideToTop },
    backPanel: { ...d.backPanel, ...rules?.backPanel },
    doorHinge: { ...d.doorHinge, ...rules?.doorHinge },
  };
}

function resolveHardwareId(
  hardware: readonly Hardware[],
  code: string | undefined,
): string | undefined {
  if (!code) return undefined;
  const target = code.trim().toLowerCase();
  const found = hardware.find((h) => h.code.trim().toLowerCase() === target);
  return found?.id;
}

function isFinitePositive(v: number | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/**
 * Fastener positions along a joint axis: first/last at endMargin, intermediates
 * inserted while gaps exceed maxSpacing, snapped to the grid. Companion dowels
 * keep the exact ±grid offset from their minifix (pair alignment beats
 * absolute grid alignment).
 */
export function jointFastenerPositions(
  spanMm: number,
  endMarginMm: number,
  maxSpacingMm: number,
  gridMm: number,
): number[] {
  if (!(spanMm > 0) || !isFinitePositive(endMarginMm)) return [];
  const first = Math.min(endMarginMm, spanMm / 2);
  const last = spanMm - first;
  if (last - first < gridMm) return [snapValue(spanMm / 2, gridMm)];

  const positions = [first];
  if (last - first > maxSpacingMm) {
    const gaps = Math.ceil((last - first) / maxSpacingMm);
    for (let i = 1; i < gaps; i++) {
      const raw = first + ((last - first) * i) / gaps;
      const snapped = snapValue(raw, gridMm);
      if (snapped > first + gridMm / 2 && snapped < last - gridMm / 2) {
        positions.push(snapped);
      }
    }
  }
  positions.push(last);
  return positions;
}

/** Hinge positions along the door height: ends + evenly spaced middles (snapped). */
export function hingePositions(
  doorHeightMm: number,
  endMarginMm: number,
  gridMm: number,
): number[] {
  const count = suggestHingeCount(doorHeightMm);
  if (count === 0 || !(doorHeightMm > 0)) return [];
  const first = Math.min(endMarginMm, doorHeightMm / 2);
  const last = doorHeightMm - first;
  if (count === 1) return [snapValue(doorHeightMm / 2, gridMm)];
  const positions = [first];
  for (let i = 1; i < count - 1; i++) {
    const raw = first + ((last - first) * i) / (count - 1);
    const snapped = snapValue(raw, gridMm);
    if (snapped > first + gridMm / 2 && snapped < last - gridMm / 2) {
      positions.push(snapped);
    }
  }
  positions.push(last);
  return positions;
}

function panelJointPlacements(
  joint: 'side-to-floor' | 'side-to-top',
  laterals: readonly JointPart[],
  horizontal: readonly JointPart[],
  hardware: readonly Hardware[],
  rules: JointDrillingRules,
  grid: number,
  out: DerivedJointPlacement[],
): void {
  if (laterals.length === 0 || horizontal.length === 0) return;
  const rule = joint === 'side-to-floor' ? rules.sideToFloor : rules.sideToTop;
  if (!rule) return;
  const endMargin = rule.endMarginMm ?? 50;
  const maxSpacing = rule.maxSpacingMm ?? 512;
  const withDowels = rule.withDowels !== false;

  for (const panel of horizontal) {
    // Board-local length-axis END faces host the bolts: 'top' and 'bottom'
    // are the two opposite ends, each meeting one lateral of the box.
    const depth = panel.widthMm;
    const positions = jointFastenerPositions(depth, endMargin, maxSpacing, grid);
    if (positions.length === 0) continue;

    const minifixId = resolveHardwareId(hardware, rule.minifixCode);
    const edgeY = (panel.thicknessMm ?? DEFAULT_BOARD_THICKNESS_MM) / 2;
    for (const pos of positions) {
      for (const face of ['bottom', 'top'] as const) {
        if (minifixId) {
          out.push({
            partId: panel.id,
            joint,
            hardwareId: minifixId,
            partRole: 'bolt',
            anchorFace: face,
            relativePosition: { xMm: pos, yMm: edgeY },
          });
        }
        if (withDowels) {
          const dowelId = resolveHardwareId(hardware, rule.dowelCode);
          if (dowelId) {
            for (const offset of [-grid, grid]) {
              const dowelPos = pos + offset;
              if (dowelPos > 0 && dowelPos < depth) {
                out.push({
                  partId: panel.id,
                  joint,
                  hardwareId: dowelId,
                  anchorFace: face,
                  relativePosition: { xMm: dowelPos, yMm: edgeY },
                });
              }
            }
          }
        }
      }
    }
  }

  // Cams on each lateral's big face, at the horizontal panel's mid-thickness
  // height (floor: from the bottom end; top: from the top end).
  const minifixId = resolveHardwareId(hardware, rule.minifixCode);
  const dowelId = withDowels ? resolveHardwareId(hardware, rule.dowelCode) : undefined;
  if (!minifixId && !dowelId) return;
  for (const lateral of laterals) {
    const depth = lateral.widthMm;
    const positions = jointFastenerPositions(depth, endMargin, maxSpacing, grid);
    const panelT = horizontal[0]!.thicknessMm || 18;
    // Cam center at the joined panel's mid-thickness — exact halves: a Ø15 cam
    // in a 15mm panel zone spans 0..15 exactly (no floor rounding, which would
    // push the circle 0.5mm past the board edge).
    const v =
      joint === 'side-to-floor'
        ? panelT / 2
        : lateral.lengthMm - panelT / 2;
    for (const pos of positions) {
      if (minifixId) {
        out.push({
          partId: lateral.id,
          joint,
          hardwareId: minifixId,
          partRole: 'cam',
          anchorFace: 'front',
          relativePosition: { xMm: pos, yMm: v },
        });
      }
      if (dowelId) {
        for (const offset of [-grid, grid]) {
          const dowelPos = pos + offset;
          if (dowelPos > 0 && dowelPos < depth) {
            out.push({
              partId: lateral.id,
              joint,
              hardwareId: dowelId,
              anchorFace: 'front',
              relativePosition: { xMm: dowelPos, yMm: v },
            });
          }
        }
      }
    }
  }
}

function backPanelPlacements(
  backs: readonly JointPart[],
  hardware: readonly Hardware[],
  rules: JointDrillingRules,
  grid: number,
  out: DerivedJointPlacement[],
): void {
  if (backs.length === 0) return;
  const rule = rules.backPanel;
  if (!rule) return;
  const screwId = resolveHardwareId(hardware, rule.screwCode);
  if (!screwId) return;
  const inset = rule.insetMm ?? 16;
  const maxSpacing = rule.maxSpacingMm ?? 400;

  // The fondo pilot is a THROUGH hole on the back panel (the catalog tornillo
  // is a 35mm blind pilot for thick members — wrong application here).
  const throughPilot = {
    parts: [
      {
        id: 'pilot',
        role: 'screw',
        operations: [
          { id: 'pilot-through', kind: 'through_hole' as const, diameterMm: 3, xMm: 0, yMm: 0, face: 'anchor' as const },
        ],
      },
    ],
  };

  for (const back of backs) {
    const W = back.widthMm;
    const H = back.lengthMm;
    if (!(W > 0) || !(H > 0)) continue;
    const xs = jointFastenerPositions(W, inset, maxSpacing, grid);
    const ys = jointFastenerPositions(H, inset, maxSpacing, grid);
    // Screws on the inner face along all 4 edges.
    for (const x of xs) {
      out.push({ partId: back.id, joint: 'back-panel', hardwareId: screwId, anchorFace: 'front', derivedMachining: throughPilot, relativePosition: { xMm: x, yMm: inset } });
      out.push({ partId: back.id, joint: 'back-panel', hardwareId: screwId, anchorFace: 'front', derivedMachining: throughPilot, relativePosition: { xMm: x, yMm: H - inset } });
    }
    for (const y of ys) {
      if (y > inset + grid / 2 && y < H - inset - grid / 2) {
        out.push({ partId: back.id, joint: 'back-panel', hardwareId: screwId, anchorFace: 'front', derivedMachining: throughPilot, relativePosition: { xMm: inset, yMm: y } });
        out.push({ partId: back.id, joint: 'back-panel', hardwareId: screwId, anchorFace: 'front', derivedMachining: throughPilot, relativePosition: { xMm: W - inset, yMm: y } });
      }
    }
  }
}

function doorHingePlacements(
  doors: readonly JointPart[],
  laterals: readonly JointPart[],
  hardware: readonly Hardware[],
  rules: JointDrillingRules,
  grid: number,
  out: DerivedJointPlacement[],
): void {
  if (doors.length === 0 || laterals.length === 0) return;
  const rule = rules.doorHinge;
  if (!rule) return;
  const hingeId = resolveHardwareId(hardware, rule.hingeCode);
  const plateId = resolveHardwareId(hardware, rule.plateCode);
  if (!hingeId && !plateId) return;
  const cupInset = rule.cupInsetMm ?? 22.5;
  const systemLine = rule.systemLineMm ?? 37;
  const endMargin = rule.endMarginMm ?? 100;

  for (const door of doors) {
    const positions = hingePositions(door.lengthMm, endMargin, grid);
    for (const y of positions) {
      if (hingeId) {
        out.push({
          partId: door.id,
          joint: 'door-hinge',
          hardwareId: hingeId,
          partRole: 'cup',
          anchorFace: 'back',
          relativePosition: { xMm: cupInset, yMm: y },
        });
      }
    }
  }
  for (const lateral of laterals) {
    const depth = lateral.widthMm;
    const positions = hingePositions(lateral.lengthMm, endMargin, grid);
    const u = Math.max(0, depth - systemLine);
    for (const y of positions) {
      if (plateId) {
        out.push({
          partId: lateral.id,
          joint: 'door-hinge',
          hardwareId: plateId,
          anchorFace: 'front',
          relativePosition: { xMm: u, yMm: y },
        });
      }
    }
  }
}

/**
 * Derive joint drilling placements for a composed module's resolved pieces.
 * Pure: same parts + rules → same placements. Pieces without a recognizable
 * componentPlacement (legacy template parts) are ignored.
 */
export function deriveJointHardwarePlacements(
  params: DeriveJointPlacementsParams,
): DerivedJointPlacement[] {
  const rules = effectiveRules(params.rules);
  const grid = rules.gridMm > 0 ? rules.gridMm : 32;
  const out: DerivedJointPlacement[] = [];

  const byPlacement = (p: string) =>
    params.parts.filter(
      (part) => part.componentPlacement === (p as ComponentPlacement),
    );
  const laterals = params.parts.filter((part) =>
    part.componentPlacement ? LATERAL_PLACEMENTS.has(part.componentPlacement) : false,
  );
  const floors = byPlacement('base');
  const tops = byPlacement('superior');
  const backs = byPlacement('trasera');
  const doors = byPlacement('puerta');

  panelJointPlacements('side-to-floor', laterals, floors, params.hardware, rules, grid, out);
  panelJointPlacements('side-to-top', laterals, tops, params.hardware, rules, grid, out);
  backPanelPlacements(backs, params.hardware, rules, grid, out);
  doorHingePlacements(doors, laterals, params.hardware, rules, grid, out);

  return out;
}
