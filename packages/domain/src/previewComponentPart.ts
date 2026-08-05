/**
 * Resolve a single catalog component into a positioned {@link ResolvedBoardPart}
 * for live 3D preview in the component editor.
 *
 * This mirrors the per-axis pose resolution in `engine/bom.ts` but operates on a
 * standalone component (no Module / Structure wrapper) against reference container
 * dimensions (PW/PH/PD/T) the editor supplies. The editor only presents; this lives
 * in domain so no formula evaluation happens in React (PRODUCT.md "UI no calcula").
 */

import type { ResolvedBoardPart } from './types';
import { evaluatePartFormula } from './engine/shared';
import { defaultPoseForPlacement, type PlacementDims } from './spatialPlacement';

export type ComponentPreviewInput = {
  readonly id?: string;
  readonly code?: string;
  readonly description?: string;
  readonly placement: string;
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly thicknessMm: number;
  readonly lengthFormula?: string;
  readonly widthFormula?: string;
  readonly xFormula?: string;
  readonly yFormula?: string;
  readonly zFormula?: string;
  /** null = use placement default; 0 is a valid explicit rotation */
  readonly rotateX?: number | null;
  readonly rotateY?: number | null;
  readonly rotateZ?: number | null;
  readonly optionRole?: string;
  readonly materialId?: string;
};

export type ComponentPreviewOptions = {
  readonly copyIndex?: number;
  readonly quantity?: number;
};

/**
 * Preview is tolerant to partial/invalid formulas — the user is typing them
 * live. Return null on failure so the caller falls back to a safe value,
 * instead of crashing the editor. The production engine (resolveBom) stays
 * strict because saved data is already validated.
 */
function tryEvaluate(
  formula: string,
  dims: Parameters<typeof evaluatePartFormula>[1],
  contextInfo: Parameters<typeof evaluatePartFormula>[2],
): number | null {
  try {
    return evaluatePartFormula(formula, dims, contextInfo);
  } catch {
    return null;
  }
}

/**
 * Resolve a preview part for one component copy against the given container dims.
 *
 * @param input   Component-like fields (geometry + formulas + rotation overrides).
 * @param dims    Container reference: PW (width), PH (height), PD (depth), T (thickness).
 * @param options Copy index (default 0) and quantity (default 1) — affect the placement pose.
 */
export function previewPartForComponent(
  input: ComponentPreviewInput,
  dims: PlacementDims,
  options: ComponentPreviewOptions = {},
): ResolvedBoardPart {
  const { PW, PH, PD, T } = dims;
  const i = options.copyIndex ?? 0;
  const quantity = options.quantity ?? 1;

  // Geometry: parent dims back-fill W/H/D when a component has no size yet,
  // mirroring bom.ts geomDims ({W:PW, H:PH, D:PD, ...}).
  const geomDims = { W: PW, H: PH, D: PD, PW, PH, PD, T };
  const lengthFormula = input.lengthFormula?.trim();
  const widthFormula = input.widthFormula?.trim();
  const geomCtx = (field: 'length' | 'width') => ({
    structureCode: input.code ?? '',
    partDescription: input.description ?? '',
    field,
  });
  const lengthMm = lengthFormula
    ? tryEvaluate(lengthFormula, geomDims, geomCtx('length')) ?? Math.max(input.lengthMm, 1)
    : Math.max(input.lengthMm, 1);
  const widthMm = widthFormula
    ? tryEvaluate(widthFormula, geomDims, geomCtx('width')) ?? Math.max(input.widthMm, 1)
    : Math.max(input.widthMm, 1);
  const thicknessMm = Math.max(input.thicknessMm || T, 1);

  // Placement pose (only used on axes/formulas that aren't explicitly set).
  const placementPose = defaultPoseForPlacement(input.placement, dims, i, quantity);

  // Spatial: per-axis formula wins, otherwise the placement pose.
  // Inside spatial formulas H = thickness (bom.ts:411 `const H = T`).
  const spatialDims = { W: widthMm, H: thicknessMm, D: lengthMm, PW, PH, PD, T, i };
  const ctx = (field: 'x' | 'y' | 'z') => ({
    structureCode: input.code ?? '',
    partDescription: input.description ?? '',
    field,
  });
  const x = input.xFormula?.trim()
    ? tryEvaluate(input.xFormula, spatialDims, ctx('x')) ?? placementPose.x
    : placementPose.x;
  const y = input.yFormula?.trim()
    ? tryEvaluate(input.yFormula, spatialDims, ctx('y')) ?? placementPose.y
    : placementPose.y;
  const z = input.zFormula?.trim()
    ? tryEvaluate(input.zFormula, spatialDims, ctx('z')) ?? placementPose.z
    : placementPose.z;

  // Rotations: explicit (incl. 0) wins over placement default; null means "auto".
  const rotateX = input.rotateX ?? placementPose.rotateX;
  const rotateY = input.rotateY ?? placementPose.rotateY;
  const rotateZ = input.rotateZ ?? placementPose.rotateZ;

  return {
    id: input.id ?? 'preview',
    code: input.code,
    description: input.description ?? 'Componente de prueba',
    quantity: 1,
    lengthMm,
    widthMm,
    thicknessMm,
    grain: 0,
    edges: [],
    optionRole: input.optionRole ?? 'INTERIOR',
    materialId: input.materialId ?? 'preview-material',
    x,
    y,
    z,
    rotateX,
    rotateY,
    rotateZ,
  };
}
