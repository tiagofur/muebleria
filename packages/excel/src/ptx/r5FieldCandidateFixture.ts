/**
 * #793 — representative frozen RELEASE fixture for the productive r5 gate.
 *
 * Deterministic, synthetic, NO private data: fixed ids, fixed fingerprint,
 * fixed catalog engineering inputs. It exists so the r5 productive route
 * (release truth → neutral label projection → ResolvedCuttingJob → adapter
 * 1.4.0 → spec-checked bytes → field pack) is exercised end-to-end by tests
 * and by the final-review field-pack generator through the SAME code path a
 * real liberated release takes — never through the #789/#791 LAB golden
 * builder (that fixture is frozen evidence, not a productive source).
 *
 * Scenario coverage (issue #793 acceptance):
 * - TWO physical units of ONE module definition → the second takes the -L2
 *   workshop suffix (frozen occurrence ordinal 2);
 * - a quantity>1 row (PUERTA ×2) exercising the -C2 physical copy suffix;
 * - asymmetric edge patterns (3+1, length-only, none) over one band code;
 * - TWO board materials (main 2440×1220 + fondo 1700×700) so by-material
 *   grouping and multi-MATERIALS rows are real;
 * - a NO-GRAIN fondo piece (640×1100) that only fits the 1700×700 board
 *   ROTATED — proving part-local pre-rotation PARTS_REQ dimensions survive
 *   optimizer rotation on the productive route;
 * - EXPLICIT CNC machining authority on the fondo parts only (every unit);
 *   every other piece carries no machining authority → empty
 *   DRAWING/BARCODE1 (never inferred from names or descriptions).
 */

import {
  manufacturingLabelProjectionFromDemand,
  optimizeCutPlan,
  releaseBaseFromDemand,
  releaseCutRowsFromDemand,
  type Catalog,
  type CutPlan,
  type CutPlanConfig,
  type MachineOutputSelection,
  type ManufacturingLabelProjection,
  type ManufacturingMachiningAuthority,
  type ProductionCutRow,
  type ReleaseCuttingDemandView,
} from '@granete/domain';

export const R5_GATE_PROJECT_ID = 'ptx-793-field-gate';

export const R5_GATE_RELEASE_ID = '1c0d7930-0000-4000-8000-0000000000f1';
export const R5_GATE_DESIGN_REVISION_ID = '1c0d7930-0000-4000-8000-0000000000f2';
export const R5_GATE_RELEASE_NUMBER = 1;
export const R5_GATE_DESIGN_REVISION_NUMBER = 3;
/** Deterministic fingerprint (hex, sha256- pattern) — fixture identity, not a real release hash. */
export const R5_GATE_MANUFACTURING_FINGERPRINT = `sha256-${'7930ab'.repeat(10)}793a`;

export const R5_GATE_UNIT_1_INSTANCE_ID = '1c0d7930-0000-4000-8000-0000000000u1';
export const R5_GATE_UNIT_2_INSTANCE_ID = '1c0d7930-0000-4000-8000-0000000000u2';
export const R5_GATE_MODULE_ID = 'mod-793-rack';
export const R5_GATE_MODULE_CODE = 'MOD-793';

export const R5_GATE_MAIN_MATERIAL_CODE = 'MDF-793-18';
export const R5_GATE_FONDO_MATERIAL_CODE = 'MDF-793-FONDO-18';
export const R5_GATE_EDGE_CODE = 'C-793-ABS-1';

/** Parts with EXPLICIT frozen CNC machining authority in this fixture. */
export const R5_GATE_CNC_PART_IDS = ['part-fondo'] as const;

export const R5_GATE_MACHINING_AUTHORITY: ManufacturingMachiningAuthority = {
  provenance: 'fixture-793-gate-machining',
  machiningPartIds: [...R5_GATE_CNC_PART_IDS],
};

export function r5GateCatalog(): Catalog {
  return {
    materials: [
      {
        id: 'mat-793-mdf',
        code: R5_GATE_MAIN_MATERIAL_CODE,
        name: 'MDF 793 Gate 18',
        costPerM2: 10,
        wastePercent: 10,
        lengthMm: 2440,
        widthMm: 1220,
        thicknessMm: 18,
        grainDefault: true,
        boardPrice: 8,
        active: true,
      },
      {
        id: 'mat-793-fondo',
        code: R5_GATE_FONDO_MATERIAL_CODE,
        name: 'MDF 793 Fondo 18',
        costPerM2: 11,
        wastePercent: 10,
        lengthMm: 1700,
        widthMm: 700,
        thicknessMm: 18,
        grainDefault: false,
        boardPrice: 7,
        active: true,
      },
    ],
    edges: [
      {
        id: 'edge-793-abs',
        code: R5_GATE_EDGE_CODE,
        name: 'ABS blanco 1mm 793',
        thicknessMm: 1,
        costPerMl: 0.5,
        active: true,
      },
    ],
    hardware: [],
    optionGroups: [],
    modules: [
      {
        id: R5_GATE_MODULE_ID,
        code: R5_GATE_MODULE_CODE,
        name: 'Rack 793 Gate',
        externalDims: { width: 600, height: 1600, depth: 450 },
        hardwareLines: [],
      },
    ],
  };
}

export function r5GateDemand(): ReleaseCuttingDemandView {
  return {
    releaseId: R5_GATE_RELEASE_ID,
    releaseNumber: R5_GATE_RELEASE_NUMBER,
    designRevisionId: R5_GATE_DESIGN_REVISION_ID,
    designRevisionNumber: R5_GATE_DESIGN_REVISION_NUMBER,
    manufacturingFingerprint: R5_GATE_MANUFACTURING_FINGERPRINT,
    schemaVersion: 2,
    units: [
      {
        furnitureInstanceId: R5_GATE_UNIT_1_INSTANCE_ID,
        furnitureDefinitionId: R5_GATE_MODULE_ID,
        workshopOccurrenceOrdinal: 1,
        pieces: [
          {
            // 3+1 asymmetric trap: L1, L2 and W1 banded, W2 NOT.
            partId: 'part-cost',
            partCode: 'COST',
            description: 'Costado',
            quantity: 1,
            lengthMm: 1580,
            widthMm: 440,
            thicknessMm: 18,
            materialId: 'mat-793-mdf',
            edgeBandId: 'edge-793-abs',
            grain: 1,
            l1: 1,
            l2: 1,
            w1: 1,
            w2: 0,
          },
          {
            // quantity>1: physical copies take the -C2 suffix (unit 1 only).
            partId: 'part-puerta',
            partCode: 'PTA',
            description: 'Puerta',
            quantity: 2,
            lengthMm: 596,
            widthMm: 396,
            thicknessMm: 18,
            materialId: 'mat-793-mdf',
            edgeBandId: 'edge-793-abs',
            grain: 1,
            l1: 1,
            l2: 1,
            w1: 0,
            w2: 0,
          },
          {
            // No-grain piece that only fits its 1700×700 board ROTATED
            // (1100 mm exceeds the usable height) → part-local dimensions
            // must survive the rotation. EXPLICIT CNC authority.
            partId: 'part-fondo',
            partCode: 'FND',
            description: 'Fondo',
            quantity: 1,
            lengthMm: 640,
            widthMm: 1100,
            thicknessMm: 18,
            materialId: 'mat-793-fondo',
            grain: 0,
            l1: 0,
            l2: 0,
            w1: 0,
            w2: 0,
          },
          {
            // No edges, NO machining authority → empty DRAWING/BARCODE1.
            partId: 'part-rip',
            partCode: 'RIP',
            description: 'Ripiano',
            quantity: 1,
            lengthMm: 564,
            widthMm: 356,
            thicknessMm: 18,
            materialId: 'mat-793-mdf',
            grain: 1,
            l1: 0,
            l2: 0,
            w1: 0,
            w2: 0,
          },
        ],
      },
      {
        // Same definition → -L2 suffix on every code.
        furnitureInstanceId: R5_GATE_UNIT_2_INSTANCE_ID,
        furnitureDefinitionId: R5_GATE_MODULE_ID,
        workshopOccurrenceOrdinal: 2,
        pieces: [
          {
            partId: 'part-cost',
            partCode: 'COST',
            description: 'Costado',
            quantity: 1,
            lengthMm: 1580,
            widthMm: 440,
            thicknessMm: 18,
            materialId: 'mat-793-mdf',
            edgeBandId: 'edge-793-abs',
            grain: 1,
            l1: 1,
            l2: 1,
            w1: 1,
            w2: 0,
          },
          {
            partId: 'part-puerta',
            partCode: 'PTA',
            description: 'Puerta',
            quantity: 1,
            lengthMm: 596,
            widthMm: 396,
            thicknessMm: 18,
            materialId: 'mat-793-mdf',
            edgeBandId: 'edge-793-abs',
            grain: 1,
            l1: 1,
            l2: 1,
            w1: 0,
            w2: 0,
          },
        ],
      },
    ],
  };
}

/** Same release with a DIFFERENT frozen fingerprint (CNC scope collision test). */
export function r5GateDemandOtherRelease(): ReleaseCuttingDemandView {
  return {
    ...r5GateDemand(),
    releaseId: '1c0d7930-0000-4000-8000-000000000ff1',
    manufacturingFingerprint: `sha256-${'0a973b'.repeat(10)}0a9b`,
  };
}

/** Receiver-compatible plan config: kerf 4.4 + geometry trims 10/0/10/0 (#790). */
export const R5_GATE_PLAN_CONFIG: CutPlanConfig = {
  sawKerfMm: 4.4,
  trim: { topMm: 0, bottomMm: 10, leftMm: 10, rightMm: 0 },
  deductEdgeBand: true,
  allowRotationNoGrain: true,
  minRemnantWidthMm: 300,
  minRemnantLengthMm: 400,
  preferLongitudinalRips: true,
  heuristic: 'guillotine-hybrid',
};

export interface R5GateFixture {
  readonly catalog: Catalog;
  readonly demand: ReleaseCuttingDemandView;
  readonly rows: readonly ProductionCutRow[];
  readonly plan: CutPlan;
  readonly projection: ManufacturingLabelProjection;
}

/** Builds the full frozen release fixture through the REAL productive derivations. */
export function buildR5GateFixture(
  demand: ReleaseCuttingDemandView = r5GateDemand(),
): R5GateFixture {
  const catalog = r5GateCatalog();
  const rows = releaseCutRowsFromDemand(demand, catalog);
  const plan = optimizeCutPlan(
    R5_GATE_PROJECT_ID,
    rows,
    catalog.materials,
    R5_GATE_PLAN_CONFIG,
    'R793 Field Gate',
  );
  const planWithBase: CutPlan = {
    ...plan,
    releaseBase: releaseBaseFromDemand(demand),
  };
  const projection = manufacturingLabelProjectionFromDemand(demand, catalog, {
    machining: R5_GATE_MACHINING_AUTHORITY,
  });
  return { catalog, demand, rows, plan: planWithBase, projection };
}

/** Exact CADmatic 4 r5 selection tuple (machine r1 + current profile + adapter 1.4.0). */
export function r5GateSelection(
  adapter: { postprocessorAdapterId: string; adapterVersion: string; implementationDigest: string },
  profile: { ref: { outputCompatibilityProfileId: string; revisionId: string }; digest: string },
): MachineOutputSelection {
  return {
    operation: 'cutting',
    machineProfileId: 'client-a-machine-b-hpp250',
    machineProfileRevisionId: 'r1',
    outputCompatibilityProfileId: profile.ref.outputCompatibilityProfileId,
    outputCompatibilityProfileRevisionId: profile.ref.revisionId,
    outputCompatibilityProfileDigest: profile.digest,
    postprocessorAdapterId: adapter.postprocessorAdapterId,
    postprocessorAdapterVersion: adapter.adapterVersion,
    postprocessorImplementationDigest: adapter.implementationDigest,
  };
}
