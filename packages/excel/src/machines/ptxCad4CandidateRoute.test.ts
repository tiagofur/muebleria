/**
 * #650 PR 6 — CADmatic 4 candidate route end to end.
 *
 * real CutPlan → selected immutable CAD4 candidate profile (ptx-cadmatic-4@r2)
 * → ptxAdapter → documented PTX compiler → validated bytes → existing
 * download bundles (#591) → independent parser → semantic verifier.
 *
 * The profile GOVERNS the bytes: every effective option (headerVersion,
 * headerOrigin, trimType, decimalPlaces, encoding, lineEnding, includeVectors,
 * supportedFunctions, supportsPositiveTrim) is consumed by the adapter, an
 * unimplemented option value blocks with a specific reason, and
 * canSerialize runs the REAL compilation preflight so ready=true ⇒
 * serialize() executes. Field state stays NOT_MACHINE_VALIDATED.
 */

import { describe, expect, it } from 'vitest';
import {
  AdapterSerializationBlocked,
  DEFAULT_CUT_PLAN_CONFIG,
  divideRegion,
  optimizeCutPlan,
  type CutPlan,
  type CutPlanConfig,
  type CutPlanPlacedPiece,
  type CutPlanSheet,
  type CutProgramInput,
  type MaterialBoard,
  type OutputCompatibilityProfile,
  type ProductionCutRow,
  type ResolvedCuttingJob,
} from '@granete/domain';
import {
  GOLDEN_CONFIG,
  GOLDEN_MATERIALS,
  GOLDEN_PROJECT_ID,
  GOLDEN_ROWS,
} from '../ptx/cutPlanPtxGolden';
import { compileCutPlanToPtxDocument } from '../ptx/compileCutPlan';
import { parsePtxDocumentBytes } from '../ptx/parse';
import type { PtxMaterialRecord, PtxPartsInfRecord, PtxPartsReqRecord, PtxPartsUdiRecord } from '../ptx/records';
import { serializePtxDocumentBytes } from '../ptx/serialize';
import { ptxSpecPreflightDocument } from '../ptx/specPreflight';
import { verifyCutPlanPtxReadback } from '../ptx/verifyCutPlanPtxReadback';
import { ptxPartLabelsFromManufacturingProjection } from '../ptx/partLabels';
import { buildCadlinkFieldPack } from '../ptx/cadlinkFieldPack';
import {
  buildR5GateFixture,
  r5GateDemand,
  r5GateDemandOtherRelease,
  R5_GATE_FONDO_MATERIAL_CODE,
  R5_GATE_MAIN_MATERIAL_CODE,
  R5_GATE_EDGE_CODE,
  R5_GATE_RELEASE_NUMBER,
} from '../ptx/r5FieldCandidateFixture';
import { sha256Hex } from './digest';
import { buildCad4CandidateCuttingJob, buildFixtureCuttingJob } from './machineOutputFixtures';
import {
  evaluateSelectedCuttingOutputReadiness,
  generateSelectedCuttingOutput,
  resolveManufacturingOutputTarget,
} from './outputSelectionResolver';
import {
  CLIENT_A_HPP250_PROFILE,
  PTX_CADMATIC_4_CANDIDATE_PROFILE,
  PTX_CADMATIC_4_R3_PROFILE,
  PTX_CADMATIC_4_R4_PROFILE,
  PTX_CADMATIC_4_R5_PROFILE,
} from './profiles';
import {
  PTX_CANDIDATE_TITLE,
  PTX_POSTPROCESSOR_ADAPTER,
  PTX_R5_FIELD_TEST_TITLE,
  profileUsesDocumentedPtxCompiler,
  resolvePtxCompilerRoute,
  type PtxResolvedCuttingJob,
} from './ptxAdapter';
import type { MachineOutputSelection } from '@granete/domain';

/** Historical r4 revision: still routed by the adapter (frozen behavior). */
const CANDIDATE = PTX_CADMATIC_4_R4_PROFILE;
/** #793 current selectable revision: the productive final-gate candidate. */
const CANDIDATE_R5 = PTX_CADMATIC_4_R5_PROFILE;
/** Historical r2/r3 candidates: kept immutable; their policies stay routed. */
const CANDIDATE_R2 = PTX_CADMATIC_4_CANDIDATE_PROFILE;
const CANDIDATE_R3 = PTX_CADMATIC_4_R3_PROFILE;

function candidateSelection(): MachineOutputSelection {
  return {
    operation: 'cutting',
    machineProfileId: CLIENT_A_HPP250_PROFILE.ref.machineProfileId,
    machineProfileRevisionId: CLIENT_A_HPP250_PROFILE.ref.machineProfileRevisionId,
    outputCompatibilityProfileId: CANDIDATE.ref.outputCompatibilityProfileId,
    outputCompatibilityProfileRevisionId: CANDIDATE.ref.revisionId,
    outputCompatibilityProfileDigest: CANDIDATE.digest,
    postprocessorAdapterId: PTX_POSTPROCESSOR_ADAPTER.postprocessorAdapterId,
    postprocessorAdapterVersion: PTX_POSTPROCESSOR_ADAPTER.adapterVersion,
    postprocessorImplementationDigest: PTX_POSTPROCESSOR_ADAPTER.implementationDigest,
  };
}

function candidateJob(): ResolvedCuttingJob {
  return buildCad4CandidateCuttingJob();
}

/** #793 — the CURRENT catalog selection tuple (r5 + adapter 1.4.0 exact pins). */
function candidateR5Selection(): MachineOutputSelection {
  return {
    operation: 'cutting',
    machineProfileId: CLIENT_A_HPP250_PROFILE.ref.machineProfileId,
    machineProfileRevisionId: CLIENT_A_HPP250_PROFILE.ref.machineProfileRevisionId,
    outputCompatibilityProfileId: CANDIDATE_R5.ref.outputCompatibilityProfileId,
    outputCompatibilityProfileRevisionId: CANDIDATE_R5.ref.revisionId,
    outputCompatibilityProfileDigest: CANDIDATE_R5.digest,
    postprocessorAdapterId: PTX_POSTPROCESSOR_ADAPTER.postprocessorAdapterId,
    postprocessorAdapterVersion: PTX_POSTPROCESSOR_ADAPTER.adapterVersion,
    postprocessorImplementationDigest: PTX_POSTPROCESSOR_ADAPTER.implementationDigest,
  };
}

/** r5 gate fixture job: frozen release plan + neutral projection + mapped partLabels. */
async function r5GateJob(demand = r5GateDemand()) {
  const { plan, projection } = buildR5GateFixture(demand);
  const partLabels = await ptxPartLabelsFromManufacturingProjection(projection);
  const job: PtxResolvedCuttingJob = {
    jobId: plan.id,
    provenance: {
      projectId: plan.projectId,
      generatedAt: plan.generatedAt,
      cutPlanId: plan.id,
      cutPlanVersion: plan.version,
    },
    cutPlan: plan,
    manufacturingLabels: projection,
    partLabels,
  };
  return { job, plan, projection, partLabels };
}

/** r5 compile options exactly as the route resolves them, plus the mapped labels. */
async function r5RouteCompileOptions() {
  const route = resolvePtxCompilerRoute(CANDIDATE_R5).config!;
  const { partLabels } = await r5GateJob();
  return { ...route.compileOptions, partLabels } as const;
}

/** Mutated profile variant for governance tests (digest intentionally stale — routing is by id+revision). */
function profileVariant(dimensionOverrides: Record<string, string | number | boolean>): OutputCompatibilityProfile {
  return {
    ...CANDIDATE,
    dimensions: { ...CANDIDATE.dimensions, ...dimensionOverrides },
  };
}

const TRIM0_CONFIG: CutPlanConfig = {
  ...DEFAULT_CUT_PLAN_CONFIG,
  sawKerfMm: 4,
  trim: { topMm: 0, bottomMm: 0, leftMm: 0, rightMm: 0 },
};

function makeRow(params: {
  quantity: number;
  lengthMm: number;
  widthMm: number;
  grain: 0 | 1;
  partCode: string;
  materialName?: string;
  materialCode?: string;
}): ProductionCutRow {
  return {
    quantity: params.quantity,
    lengthMm: params.lengthMm,
    widthMm: params.widthMm,
    description: `${params.partCode} lab`,
    materialName: params.materialName ?? 'Lab Board 18',
    materialCode: params.materialCode ?? (params.materialName ? 'ALT18' : 'LAB18'),
    grain: params.grain,
    L1: 0,
    L2: 0,
    W1: 0,
    W2: 0,
    partCode: params.partCode,
    partName: params.partCode,
    labelRef: `MOD-LAB-${params.partCode}`,
    moduleCode: 'M01',
    thicknessMm: 18,
  };
}

/** Plan real de dos materiales para el modo by-material. */
function twoMaterialPlan(): CutPlan {
  const materials: MaterialBoard[] = [
    ...GOLDEN_MATERIALS,
    {
      id: 'mat-alt',
      code: 'ALT18',
      name: 'Lab Alt 18',
      costPerM2: 12,
      wastePercent: 10,
      lengthMm: 800,
      widthMm: 600,
      thicknessMm: 18,
      grainDefault: true,
      boardPrice: 6,
      active: true,
    },
  ];
  const rows = [
    ...GOLDEN_ROWS.map((row, index) => ({
      ...row,
      labelRef: `MOD-LAB-P${String(index + 1).padStart(2, '0')}`,
    })),
    makeRow({ quantity: 1, lengthMm: 500, widthMm: 400, grain: 1, partCode: 'C', materialName: 'Lab Alt 18' }),
  ];
  return optimizeCutPlan('lab-650-two-materials', rows, materials, TRIM0_CONFIG);
}

function labPiece(
  id: string,
  rect: { xMm: number; yMm: number; lengthMm: number; widthMm: number },
  partCode: string,
  overrides: Partial<CutPlanPlacedPiece> = {},
): CutPlanPlacedPiece {
  return {
    id,
    partCode,
    partName: partCode,
    moduleCode: 'M01',
    labelRef: id,
    materialName: 'Lab Board 18',
    materialCode: 'LAB18',
    xMm: rect.xMm,
    yMm: rect.yMm,
    lengthMm: rect.lengthMm,
    widthMm: rect.widthMm,
    originalLengthMm: rect.lengthMm,
    originalWidthMm: rect.widthMm,
    grain: 1,
    rotated: false,
    L1: 0,
    L2: 0,
    W1: 0,
    W2: 0,
    thicknessMm: 18,
    sheetIndex: 0,
    stripIndex: 0,
    cutSequenceNumber: 1,
    ...overrides,
  };
}

/** Job wrapper for hand-built single-sheet plans (negative cases). */
function jobWithSheet(sheet: CutPlanSheet, config: CutPlanConfig): ResolvedCuttingJob {
  return {
    jobId: `lab-negative-${sheet.sheetIndex}`,
    provenance: { projectId: 'lab-650', generatedAt: '2026-09-11T00:00:00.000Z' },
    cutPlan: {
      id: 'cutplan-lab-negative',
      projectId: 'lab-650',
      generatedAt: '2026-09-11T00:00:00.000Z',
      version: 1,
      isFrozen: false,
      config,
      sheets: [sheet],
      stats: {
        totalSheets: 1,
        totalPieces: sheet.pieces.length,
        totalGrossAreaM2: 0,
        totalNetPiecesAreaM2: 0,
        totalUsefulRemnantsAreaM2: 0,
        totalWasteAreaM2: 0,
        globalWastePercent: 0,
        globalYieldPercent: 0,
        byMaterial: [],
      },
      usefulRemnants: [],
    },
  };
}

function sheetWithProgram(program: CutProgramInput, pieces: readonly CutPlanPlacedPiece[], overrides: Partial<CutPlanSheet> = {}): CutPlanSheet {
  return {
    sheetIndex: 0,
    strategy: 'saw-guillotine',
    materialCode: 'LAB18',
    materialName: 'Lab Board 18',
    sheetWidthMm: 600,
    sheetLengthMm: 1000,
    thicknessMm: 18,
    pieces,
    remnants: [],
    instructions: [],
    cutProgram: program,
    netPiecesAreaM2: 0.12,
    grossSheetAreaM2: 0.6,
    usableRemnantAreaM2: 0,
    wasteAreaM2: 0.48,
    wastePercent: 80,
    yieldPercent: 20,
    ...overrides,
  };
}

function minimalProgram(kerfMm = 4): { program: CutProgramInput; keptRect: { xMm: number; yMm: number; lengthMm: number; widthMm: number } } {
  const board = { xMm: 0, yMm: 0, lengthMm: 1000, widthMm: 600 };
  const division = divideRegion(board, 'x', 400, kerfMm);
  const program: CutProgramInput = {
    schemaVersion: 'granete.cut-program.v1',
    boardRegionId: 'board',
    regions: [
      { regionId: 'board', rect: board },
      { regionId: 'kept', rect: division.keptRect },
      { regionId: 'rest', rect: division.restRect! },
    ],
    divisions: [
      {
        cutId: 'cut-1',
        parentRegionId: 'board',
        axis: 'x',
        keptExtentMm: 400,
        kerfMm,
        keptRegionId: 'kept',
        restRegionId: 'rest',
      },
    ],
    terminals: [
      { regionId: 'kept', kind: 'piece', pieceRef: 'p1-s0' },
      { regionId: 'rest', kind: 'waste' },
    ],
  };
  return { program, keptRect: division.keptRect };
}

function expectBlockedWithDetail(job: ResolvedCuttingJob, profile: OutputCompatibilityProfile, detailContains: string): void {
  const readiness = PTX_POSTPROCESSOR_ADAPTER.canSerialize(job, profile);
  expect(readiness.ready).toBe(false);
  const matching = readiness.reasons.filter((r) => r.detail.includes(detailContains));
  expect(matching.length, JSON.stringify(readiness.reasons)).toBeGreaterThan(0);
  // Preflight and execution never diverge: serialize blocks for the SAME cause.
  let thrown: unknown = null;
  try {
    PTX_POSTPROCESSOR_ADAPTER.serialize(job, profile);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(AdapterSerializationBlocked);
  const details = (thrown as AdapterSerializationBlocked).reasons.map((r) => r.detail).join('; ');
  expect(details).toContain(detailContains);
}

/** r5 catalog-current selection readiness (bare job — label authority gates). */
function expectSelectedR5ReadinessBlocked(job: ResolvedCuttingJob, code: string): void {
  const resolved = evaluateSelectedCuttingOutputReadiness(job.cutPlan, candidateR5Selection());
  expect(resolved.status).toBe('CONFIGURED');
  if (resolved.status !== 'CONFIGURED') return;
  expect(resolved.readiness.ready).toBe(false);
  expect(resolved.readiness.reasons.map((reason) => reason.code)).toContain(code);
}

// ---------------------------------------------------------------------------
// Ruta candidata: ready ⇒ serialize, bytes gobernados por el perfil
// ---------------------------------------------------------------------------

describe('CADmatic 4 candidato (ptx-cadmatic-4@r2) — ruta del compilador documentado', () => {
  it('canSerialize listo con un plan real y serialize produce PTX documentado verificable', async () => {
    const job = candidateJob();
    expect(profileUsesDocumentedPtxCompiler(CANDIDATE)).toBe(true);

    const readiness = PTX_POSTPROCESSOR_ADAPTER.canSerialize(job, CANDIDATE);
    expect(readiness.ready).toBe(true);
    expect(readiness.reasons).toEqual([]);

    const bytes = PTX_POSTPROCESSOR_ADAPTER.serialize(job, CANDIDATE);
    const text = new TextDecoder().decode(bytes);
    // PTX documentado (registros CSV), no el formato INI del serializer legacy.
    expect(text.startsWith('HEADER,')).toBe(true);
    expect(text).not.toContain('[HEADER]');
    expect(text.includes('\r\n')).toBe(true);
    expect(text).toContain(`HEADER,1,${PTX_CANDIDATE_TITLE},0,0,1`);

    const parsed = parsePtxDocumentBytes(bytes);
    const route = resolvePtxCompilerRoute(CANDIDATE);
    expect(route.config).toBeDefined();
    const issues = verifyCutPlanPtxReadback(parsed, job.cutPlan, compileCutPlanToPtxDocument(job.cutPlan, route.config!.compileOptions).mapping, route.config!.compileOptions);
    expect(issues).toEqual([]);
    // Sólo funciones del subconjunto soportado llegan a los bytes.
    const functions = new Set(
      parsed.records.filter((r) => r.type === 'CUTS').map((r) => (r as { functionCode: number }).functionCode),
    );
    for (const code of functions) {
      expect([0, 1, 2, 3]).toContain(code);
    }
  });

  it('el perfil gobierna los bytes: idénticos a compilar directamente con las opciones del perfil', () => {
    const job = candidateJob();
    const route = resolvePtxCompilerRoute(CANDIDATE);
    expect(route.config).toBeDefined();
    const direct = compileCutPlanToPtxDocument(job.cutPlan, route.config!.compileOptions);
    const directText = new TextDecoder().decode(
      serializePtxDocumentBytes(direct.document, {
        decimalPlaces: route.config!.compileOptions.decimalPlaces,
        lineEnding: route.config!.lineEnding,
      }),
    );
    const adapterText = new TextDecoder().decode(PTX_POSTPROCESSOR_ADAPTER.serialize(job, CANDIDATE));
    expect(adapterText).toBe(directText);
  });

  it('decimalPlaces gobierna la representabilidad: insuficiente bloquea; suficiente no inventa ceros', () => {
    // Con medidas decimales (333.3, kerf 3.2) la resolución del perfil decide
    // qué es serializable: dp=0 bloquea con el error exacto de magnitud y
    // dos resoluciones suficientes (dp=1 y dp=2) producen los MISMOS bytes —
    // el serializador nunca rellena ceros, así que la precisión acota el
    // dominio aceptado en vez de reescribir los valores.
    const rows = [makeRow({ quantity: 1, lengthMm: 333.3, widthMm: 200, grain: 1, partCode: 'D' })];
    const plan = optimizeCutPlan('lab-650-decimal-gov', rows, GOLDEN_MATERIALS, {
      ...TRIM0_CONFIG,
      sawKerfMm: 3.2,
    });
    const job: ResolvedCuttingJob = {
      jobId: 'lab-decimal-gov',
      provenance: { projectId: 'lab-650', generatedAt: '2026-09-11T00:00:00.000Z' },
      cutPlan: plan,
    };
    expectBlockedWithDetail(job, profileVariant({ decimalPlaces: 0 }), 'ptx_compile.magnitude_not_representable');

    const one = new TextDecoder().decode(PTX_POSTPROCESSOR_ADAPTER.serialize(job, profileVariant({ decimalPlaces: 1 })));
    const two = new TextDecoder().decode(PTX_POSTPROCESSOR_ADAPTER.serialize(job, profileVariant({ decimalPlaces: 2 })));
    expect(one).toContain('333.3');
    expect(one).toBe(two);
  });

  it('cambiar headerVersion del perfil cambia el HEADER', () => {
    const job = candidateJob();
    const text = new TextDecoder().decode(
      PTX_POSTPROCESSOR_ADAPTER.serialize(job, profileVariant({ headerVersion: '1.08' })),
    );
    expect(text.startsWith('HEADER,1.08,')).toBe(true);
  });

  it('lineEnding del perfil se aplica (lf produce bytes sin CRLF)', () => {
    const job = candidateJob();
    const lf = PTX_POSTPROCESSOR_ADAPTER.serialize(job, profileVariant({ lineEnding: 'lf' }));
    const text = new TextDecoder().decode(lf);
    expect(text.includes('\r\n')).toBe(false);
    expect(text.includes('\n')).toBe(true);
  });

  it('r2 conserva includeVectors=true; r3 lo bloquea por contrato', () => {
    const job = candidateJob();
    const without = parsePtxDocumentBytes(PTX_POSTPROCESSOR_ADAPTER.serialize(job, CANDIDATE));
    expect(without.records.filter((r) => r.type === 'VECTORS')).toHaveLength(0);

    const withVectorsProfile = {
      ...CANDIDATE_R2,
      dimensions: { ...CANDIDATE_R2.dimensions, includeVectors: true },
    };
    const parsed = parsePtxDocumentBytes(PTX_POSTPROCESSOR_ADAPTER.serialize(job, withVectorsProfile));
    expect(parsed.records.filter((r) => r.type === 'VECTORS').length).toBeGreaterThan(0);
    const route = resolvePtxCompilerRoute(withVectorsProfile);
    const issues = verifyCutPlanPtxReadback(
      parsed,
      job.cutPlan,
      compileCutPlanToPtxDocument(job.cutPlan, route.config!.compileOptions).mapping,
      route.config!.compileOptions,
    );
    expect(issues).toEqual([]);

    const r3Readiness = PTX_POSTPROCESSOR_ADAPTER.canSerialize(
      job,
      profileVariant({ includeVectors: true }),
    );
    expect(r3Readiness.reasons).toContainEqual(expect.objectContaining({
      code: 'ptx_compile.profile_option_unsupported',
      dimension: 'includeVectors',
    }));
    expectBlockedWithDetail(job, profileVariant({ includeVectors: true }), 'VECTORS=off');
  });

  it('r4 (como r3) con refilados positivos exige TRIM_TYPE=1', () => {
    const profile = profileVariant({ trimType: 0 });
    const readiness = PTX_POSTPROCESSOR_ADAPTER.canSerialize(candidateJob(), profile);
    expect(readiness.reasons).toContainEqual(expect.objectContaining({
      code: 'ptx_compile.profile_option_unsupported',
      dimension: 'trimType',
    }));
    expectBlockedWithDetail(candidateJob(), profile, 'refilados positivos exige trimType=1');
  });

  it('opciones de perfil no implementadas bloquean con causa específica (nunca decorativas)', () => {
    const job = candidateJob();
    expectBlockedWithDetail(job, profileVariant({ encoding: 'utf-8' }), 'encoding');
    expectBlockedWithDetail(job, profileVariant({ lineEnding: 'cr' }), 'lineEnding');
    expectBlockedWithDetail(job, profileVariant({ decimalPlaces: 9 }), 'decimalPlaces');
    expectBlockedWithDetail(job, profileVariant({ supportsPositiveTrim: 'yes' }), 'supportsPositiveTrim');
    expectBlockedWithDetail(job, profileVariant({ unit: 'in' }), 'unit');
    // Dimensión efectiva ausente → evidencia faltante (copia profunda: el
    // perfil constante es compartido e inmutable para el resto de la suite).
    const missingOrigin = { ...CANDIDATE, dimensions: { ...CANDIDATE.dimensions } };
    delete missingOrigin.dimensions.headerOrigin;
    expect(
      PTX_POSTPROCESSOR_ADAPTER.canSerialize(job, missingOrigin).reasons.map((r) => r.code),
    ).toContain('FIELD_FORMAT_EVIDENCE_REQUIRED');
  });

  it('supportedFunctions del perfil filtra de verdad: sin fase 3, un plan que la requiere se bloquea', () => {
    // El golden necesita FUNCTION 3 (recut de B); un perfil que sólo permita
    // 0,1,2 debe bloquear el output — el subconjunto declarado gobierna.
    const job = candidateJob();
    expectBlockedWithDetail(job, profileVariant({ supportedFunctions: '0,1,2' }), 'fuera del subconjunto');
  });
});

// ---------------------------------------------------------------------------
// Negativos: preflight específico y serialize bloquea por la misma causa
// ---------------------------------------------------------------------------

describe('CADmatic 4 candidato — preflight bloquea con causa específica', () => {
  it('hoja sin cutProgram (plan legado del fixture #348)', () => {
    const job = buildFixtureCuttingJob();
    // r4 (historical revision) still routes and blocks on the exact cause.
    expectBlockedWithDetail(job, CANDIDATE, 'ptx_compile.missing_cut_program');
    // r5 (current catalog selection) fails closed on its own hard gates
    // FIRST — a legacy plan without frozen label authority never reaches a
    // compile, and never falls back to r4/ptx-generic/legacy bytes.
    expectSelectedR5ReadinessBlocked(job, 'ptx_compile.label_authority_missing');
  });

  it('CNC nesting no es representable en guillotina', () => {
    const { program, keptRect } = minimalProgram();
    const sheet = sheetWithProgram(program, [labPiece('p1-s0', keptRect, 'P1')], {
      strategy: 'cnc-nesting',
    });
    expectBlockedWithDetail(jobWithSheet(sheet, TRIM0_CONFIG), CANDIDATE, 'ptx_compile.nesting_not_representable');
  });

  it('r2 inmutable: refilados positivos siguen bloqueados con trim_unsupported', () => {
    const rows = [makeRow({ quantity: 1, lengthMm: 450, widthMm: 320, grain: 1, partCode: 'A' })];
    const plan = optimizeCutPlan('lab-650-trims', rows, GOLDEN_MATERIALS, DEFAULT_CUT_PLAN_CONFIG);
    expectBlockedWithDetail(
      { jobId: 'lab-trims', provenance: { projectId: 'lab-650', generatedAt: '2026-09-11T00:00:00.000Z' }, cutPlan: plan },
      CANDIDATE_R2,
      'ptx_compile.trim_unsupported',
    );
  });

  it('fase 4 no soportada', () => {
    const board = { xMm: 0, yMm: 0, lengthMm: 1000, widthMm: 600 };
    const d1 = divideRegion(board, 'x', 900, 4);
    const d2 = divideRegion(d1.keptRect, 'y', 500, 4);
    const d3 = divideRegion(d2.keptRect, 'x', 800, 4);
    const d4 = divideRegion(d3.keptRect, 'y', 400, 4);
    const program: CutProgramInput = {
      schemaVersion: 'granete.cut-program.v1',
      boardRegionId: 'board',
      regions: [
        { regionId: 'board', rect: board },
        { regionId: 'k1', rect: d1.keptRect },
        { regionId: 'r1', rect: d1.restRect! },
        { regionId: 'k2', rect: d2.keptRect },
        { regionId: 'r2', rect: d2.restRect! },
        { regionId: 'k3', rect: d3.keptRect },
        { regionId: 'r3', rect: d3.restRect! },
        { regionId: 'k4', rect: d4.keptRect },
        { regionId: 'r4', rect: d4.restRect! },
      ],
      divisions: [
        { cutId: 'd1', parentRegionId: 'board', axis: 'x', keptExtentMm: 900, kerfMm: 4, keptRegionId: 'k1', restRegionId: 'r1' },
        { cutId: 'd2', parentRegionId: 'k1', axis: 'y', keptExtentMm: 500, kerfMm: 4, keptRegionId: 'k2', restRegionId: 'r2' },
        { cutId: 'd3', parentRegionId: 'k2', axis: 'x', keptExtentMm: 800, kerfMm: 4, keptRegionId: 'k3', restRegionId: 'r3' },
        { cutId: 'd4', parentRegionId: 'k3', axis: 'y', keptExtentMm: 400, kerfMm: 4, keptRegionId: 'k4', restRegionId: 'r4' },
      ],
      terminals: [
        { regionId: 'k4', kind: 'piece', pieceRef: 'p1-s0' },
        { regionId: 'r1', kind: 'waste' },
        { regionId: 'r2', kind: 'waste' },
        { regionId: 'r3', kind: 'waste' },
        { regionId: 'r4', kind: 'waste' },
      ],
    };
    const sheet = sheetWithProgram(program, [labPiece('p1-s0', d4.keptRect, 'P1')]);
    const job = jobWithSheet(sheet, TRIM0_CONFIG);
    expectBlockedWithDetail(job, CANDIDATE, 'ptx_compile.phase_unsupported');
    expectSelectedR5ReadinessBlocked(job, 'ptx_compile.label_authority_missing');
  });

  it('espesor ausente: sin default industrial', () => {
    const { program, keptRect } = minimalProgram();
    const sheet = sheetWithProgram(program, [labPiece('p1-s0', keptRect, 'P1')], { thicknessMm: undefined });
    expectBlockedWithDetail(jobWithSheet(sheet, TRIM0_CONFIG), CANDIDATE, 'ptx_compile.material_thickness_missing');
  });

  it('identidad de material no ASCII: fail closed, sin mutilación', () => {
    const { program, keptRect } = minimalProgram();
    const sheet = sheetWithProgram(program, [labPiece('p1-s0', keptRect, 'P1')], { materialCode: 'MDFÁ' });
    expectBlockedWithDetail(jobWithSheet(sheet, TRIM0_CONFIG), CANDIDATE, 'ptx_compile.identity_not_ascii');
  });

  it('decimal no representable en la resolución del perfil', () => {
    const rows = [makeRow({ quantity: 1, lengthMm: 333.3, widthMm: 200, grain: 1, partCode: 'D' })];
    const plan = optimizeCutPlan('lab-650-decimal', rows, GOLDEN_MATERIALS, { ...TRIM0_CONFIG, sawKerfMm: 3.2 });
    expectBlockedWithDetail(
      { jobId: 'lab-decimal', provenance: { projectId: 'lab-650', generatedAt: '2026-09-11T00:00:00.000Z' }, cutPlan: plan },
      profileVariant({ decimalPlaces: 0 }),
      'ptx_compile.magnitude_not_representable',
    );
  });

  it('programa inválido (geometría declarada inconsistente)', () => {
    const board = { xMm: 0, yMm: 0, lengthMm: 1000, widthMm: 600 };
    const division = divideRegion(board, 'x', 400, 4);
    const program: CutProgramInput = {
      schemaVersion: 'granete.cut-program.v1',
      boardRegionId: 'board',
      regions: [
        { regionId: 'board', rect: board },
        { regionId: 'kept', rect: { ...division.keptRect, widthMm: 599 } },
        { regionId: 'rest', rect: division.restRect! },
      ],
      divisions: [
        { cutId: 'cut-1', parentRegionId: 'board', axis: 'x', keptExtentMm: 400, kerfMm: 4, keptRegionId: 'kept', restRegionId: 'rest' },
      ],
      terminals: [
        { regionId: 'kept', kind: 'piece', pieceRef: 'p1-s0' },
        { regionId: 'rest', kind: 'waste' },
      ],
    };
    const sheet = sheetWithProgram(program, [labPiece('p1-s0', division.keptRect, 'P1')]);
    expectBlockedWithDetail(jobWithSheet(sheet, TRIM0_CONFIG), CANDIDATE, 'ptx_compile.program_invalid');
  });
});

// ---------------------------------------------------------------------------
// #650 acceptance: selected profile → adapter → existing download → readback
// ---------------------------------------------------------------------------

describe('CADmatic 4 r5 productivo (#793) — descarga existente y manifest exacto', () => {
  it('unified: un bundle con manifest r5 + adapter 1.4.0, filename industrial y hashes deterministas', async () => {
    const { plan, projection } = buildR5GateFixture();
    const bundles = await generateSelectedCuttingOutput(plan, candidateR5Selection(), 'unified', {
      manufacturingLabels: projection,
    });
    expect(bundles).toHaveLength(1);
    const [bundle] = bundles;
    expect(bundle!.artifact.kind).toBe('ptx');
    expect(bundle!.artifact.fileName.endsWith('.ptx')).toBe(true);

    expect(bundle!.manifest.outputCompatibilityProfile).toEqual({
      outputCompatibilityProfileId: 'ptx-cadmatic-4',
      revisionId: 'r5',
    });
    expect(bundle!.manifest.postprocessorAdapter).toEqual({
      postprocessorAdapterId: 'granete-ptx',
      adapterVersion: '1.4.0',
      implementationDigest: PTX_POSTPROCESSOR_ADAPTER.implementationDigest,
    });
    // #781/#793: the CADmatic 4 lane delivers the conservative short ASCII
    // industrial file name (G + 12 hex of the CutPlan identity), never the
    // descriptive project slug.
    expect(bundle!.artifact.fileName).toMatch(/^G[0-9A-F]{12}\.ptx$/);
    expect(bundle!.manifest.validationStatus).toBe('NOT_TESTED');
    expect(bundle!.manifest.compatibilityEvidence).toEqual({ claim: 'notClaimed' });
    expect(bundle!.manifest.nonProductionValidationArtifact).toBe(true);
    expect(bundle!.manifest.provenance.cutPlanId).toBe(plan.id);
    expect(bundle!.manifest.provenance.cutPlanVersion).toBe(plan.version);
    // #739/#793: the frozen release pins reach the manifest (never reported
    // as missing provenance on a release plan).
    expect(bundle!.manifest.provenance.productionReleaseId).toBe(plan.releaseBase?.releaseId);
    expect(bundle!.manifest.missingProvenance).not.toContain('productionReleaseId');

    // El PTX documentado llega al archivo descargado (registro CSV, no INI),
    // con el título fijo r5 dentro del límite documentado de 25 caracteres.
    const text = new TextDecoder().decode(bundle!.artifact.bytes);
    expect(text.startsWith('HEADER,')).toBe(true);
    expect(text).toContain(`HEADER,1,${PTX_R5_FIELD_TEST_TITLE},0,0,1`);
    expect(PTX_R5_FIELD_TEST_TITLE.length).toBeLessThanOrEqual(25);
    expect(await sha256Hex(bundle!.artifact.bytes)).toBe(bundle!.artifact.sha256);

    const again = await generateSelectedCuttingOutput(plan, candidateR5Selection(), 'unified', {
      manufacturingLabels: projection,
    });
    expect(again[0]!.artifact.sha256).toBe(bundle!.artifact.sha256);
  });

  it('by-material: un bundle por material con su subconjunto de etiquetas, sin fugas ni omisiones', async () => {
    const { plan, projection } = buildR5GateFixture();
    const materials = [...new Set(plan.sheets.map((s) => s.materialCode))];
    expect(materials.sort()).toEqual(
      [R5_GATE_FONDO_MATERIAL_CODE, R5_GATE_MAIN_MATERIAL_CODE].sort(),
    );

    const bundles = await generateSelectedCuttingOutput(
      plan,
      candidateR5Selection(),
      'by-material',
      { manufacturingLabels: projection },
    );
    expect(bundles).toHaveLength(materials.length);
    expect(new Set(bundles.map((b) => b.artifact.fileName)).size).toBe(bundles.length);
    expect(new Set(bundles.map((b) => b.manifest.jobId)).size).toBe(bundles.length);

    for (const [index, bundle] of bundles.entries()) {
      const text = new TextDecoder().decode(bundle.artifact.bytes);
      expect(text.startsWith('HEADER,')).toBe(true);
      expect(bundle.manifest.outputCompatibilityProfile.revisionId).toBe('r5');
      // By-material keeps the industrial base token plus a 1-based group
      // index — compact, ASCII, collision-safe.
      expect(bundle.artifact.fileName).toMatch(new RegExp(`^G[0-9A-F]{12}-${index + 1}\\.ptx$`));
    }
  });

  it('E2E productivo (#793 §39): frozen job → r5 → canSerialize ready → serialize → parse → spec preflight → readback → field pack', async () => {
    const { plan, projection } = buildR5GateFixture();
    const selection = candidateR5Selection();
    const resolved = resolveManufacturingOutputTarget(selection, 'cutting');
    expect(resolved.status === 'CONFIGURED' && resolved.readiness.ready).toBe(true);

    const [bundle] = await generateSelectedCuttingOutput(plan, selection, 'unified', {
      manufacturingLabels: projection,
    });
    const bytes = bundle!.artifact.bytes;

    // Independent parse + strict spec preflight (#788) on the exact bytes.
    const parsed = parsePtxDocumentBytes(bytes);
    expect(ptxSpecPreflightDocument(parsed)).toEqual([]);

    // Semantic readback against the SAME route options + mapped labels.
    const compileOptions = await r5RouteCompileOptions();
    const compiled = compileCutPlanToPtxDocument(plan, compileOptions);
    expect(verifyCutPlanPtxReadback(parsed, plan, compiled.mapping, compileOptions)).toEqual([]);
    // The compile route and the productive serialization produce the same
    // document (spec-checked bytes of the compiled doc === bundle bytes).
    const { serializePtxDocumentBytesSpecChecked } = await import('../ptx/specPreflight');
    expect(
      serializePtxDocumentBytesSpecChecked(compiled.document, {
        decimalPlaces: compileOptions.decimalPlaces,
        lineEnding: '\r\n',
      }),
    ).toEqual(bytes);

    // #792/#793 field pack with the REAL productive identity pins — every
    // gate (parse/validate/spec/readback/receiver policy) re-runs inside the
    // builder before a single file exists.
    const pack = await buildCadlinkFieldPack({
      ptxFilename: bundle!.artifact.fileName,
      ptxBytes: bytes,
      cutPlan: plan,
      mapping: compiled.mapping,
      compileOptions,
      identityPins: {
        machineProfileId: selection.machineProfileId,
        machineProfileRevisionId: selection.machineProfileRevisionId,
        outputCompatibilityProfileId: selection.outputCompatibilityProfileId,
        outputCompatibilityProfileRevisionId: selection.outputCompatibilityProfileRevisionId,
        outputCompatibilityProfileDigest: selection.outputCompatibilityProfileDigest!,
        postprocessorAdapterId: selection.postprocessorAdapterId,
        postprocessorAdapterVersion: selection.postprocessorAdapterVersion,
        postprocessorImplementationDigest: selection.postprocessorImplementationDigest,
      },
    });
    expect(pack.candidateFilename).toBe(bundle!.artifact.fileName);
    expect(pack.ptxSha256).toBe(bundle!.artifact.sha256);
    const names = pack.files.map((file) => file.name);
    for (const expected of [
      bundle!.artifact.fileName,
      'manifest.json',
      'expected_identity.json',
      'README_FIELD_TEST.txt',
      'CHECKSUMS.sha256',
    ]) {
      expect(names).toContain(expected);
    }
    const manifestFile = pack.files.find((file) => file.name === 'manifest.json')!;
    const manifest = JSON.parse(new TextDecoder().decode(manifestFile.bytes));
    expect(manifest.supportStatus).toEqual({
      status: 'NOT_TESTED',
      compatibilityClaim: 'notClaimed',
      note: expect.any(String),
    });
    expect(manifest.identity.outputCompatibilityProfile).toEqual({
      id: 'ptx-cadmatic-4',
      revisionId: 'r5',
      digest: CANDIDATE_R5.digest,
    });
    expect(manifest.identity.postprocessorAdapter).toEqual({
      id: 'granete-ptx',
      version: '1.4.0',
      implementationDigest: PTX_POSTPROCESSOR_ADAPTER.implementationDigest,
    });
    expect(manifest.candidate.title).toBe(PTX_R5_FIELD_TEST_TITLE);
  });

  it('r5 usa la política de receiver productiva en los bytes (BOOK/KERF/RULE + TRIM geometry)', async () => {
    const { job } = await r5GateJob();
    const parsed = parsePtxDocumentBytes(PTX_POSTPROCESSOR_ADAPTER.serialize(job, CANDIDATE_R5));
    const materials = parsed.records.filter(
      (record): record is PtxMaterialRecord => record.type === 'MATERIALS',
    );
    expect(materials.length).toBeGreaterThan(0);
    for (const material of materials) {
      expect(material.bookQuantity).toBe(3);
      expect(material.kerfRip).toBe(4.4);
      expect(material.kerfCrosscut).toBe(4.4);
      expect(material.rule1).toBe(6);
      expect(material.rule2).toBe(1);
      expect(material.rule3).toBe(1);
      expect(material.rule4).toBe(1);
      // Recut trio: OMIT_NO_OVERRIDE → absent (never the samples' 20/20/0).
      expect(material.trimHead).toBeUndefined();
      expect(material.trimFRct).toBeUndefined();
      expect(material.trimVRct).toBeUndefined();
      // Geometry TRIM authority: executed margins (10/10), absent on the far
      // sides without a pass (undefined ≠ 0).
      expect(material.trimFRip).toBe(10);
      expect(material.trimFXct).toBe(10);
      expect(material.trimVRip).toBeUndefined();
      expect(material.trimVXct).toBeUndefined();
    }
  });

  it('pins históricos stale bloquean con causa accionable (sin retargetear)', () => {
    const oldRevision = { ...candidateR5Selection(), outputCompatibilityProfileRevisionId: 'r1' };
    const r1 = resolveManufacturingOutputTarget(oldRevision, 'cutting');
    expect(r1.status === 'CONFIGURED' && r1.readiness.ready).toBe(false);
    expect(
      r1.status === 'CONFIGURED' ? r1.readiness.reasons.map((x) => x.code) : [],
    ).toContain('PROFILE_DIGEST_MISMATCH');

    // #793 §18: a selection persisted on r4/1.3.0 surfaces the stale blocker
    // naming the current revision — never a silent retarget to r5/1.4.0.
    const r4Pin = {
      ...candidateR5Selection(),
      outputCompatibilityProfileRevisionId: PTX_CADMATIC_4_R4_PROFILE.ref.revisionId,
      outputCompatibilityProfileDigest: PTX_CADMATIC_4_R4_PROFILE.digest,
      postprocessorAdapterVersion: '1.3.0',
      postprocessorImplementationDigest: 'e856f8e88ba4deb7077ba24f4182378a8d706591bd8831affa0b45370d56584c',
    };
    const r4 = resolveManufacturingOutputTarget(r4Pin, 'cutting');
    expect(r4.status === 'CONFIGURED' && r4.readiness.ready).toBe(false);
    expect(
      r4.status === 'CONFIGURED' ? r4.readiness.reasons.map((x) => x.detail).join('; ') : '',
    ).toContain('r5');

    const oldAdapter = {
      ...candidateR5Selection(),
      postprocessorAdapterVersion: '1.0.0',
      postprocessorImplementationDigest: '39df10ba24528b5d402a940ac2e6f9fc20b735011468013090cfc78f88511a28',
    };
    const a1 = resolveManufacturingOutputTarget(oldAdapter, 'cutting');
    expect(a1.status === 'CONFIGURED' && a1.readiness.ready).toBe(false);
    expect(
      a1.status === 'CONFIGURED' ? a1.readiness.reasons.map((x) => x.detail).join('; ') : '',
    ).toContain('1.0.0');
  });

  it('ptx-generic conserva el comportamiento legacy (sin fallback cruzado)', () => {
    const job = buildFixtureCuttingJob();
    const readiness = PTX_POSTPROCESSOR_ADAPTER.canSerialize(job, {
      ...CANDIDATE,
      ref: { outputCompatibilityProfileId: 'ptx-generic', revisionId: 'r1' },
      dimensions: {
        fileExtension: 'ptx',
        encoding: 'ascii',
        lineEnding: 'crlf',
        decimalPlaces: 1,
        headerVersion: '1.14',
        unit: 'mm',
      },
    });
    // La ruta legacy no compila el plan: un plan SIN cutProgram sigue listo
    // para el serializer legacy (comportamiento histórico intacto).
    expect(readiness.ready).toBe(true);
    const text = new TextDecoder().decode(
      PTX_POSTPROCESSOR_ADAPTER.serialize(job, {
        ...CANDIDATE,
        ref: { outputCompatibilityProfileId: 'ptx-generic', revisionId: 'r1' },
        dimensions: {
          fileExtension: 'ptx',
          encoding: 'ascii',
          lineEnding: 'crlf',
          decimalPlaces: 1,
          headerVersion: '1.14',
          unit: 'mm',
        },
      }),
    );
    expect(text).toContain('[HEADER]');
  });
});

// ---------------------------------------------------------------------------
// #793 §36/§37/§38: autoridad de etiquetas productiva, CNC scope, no-fallback
// ---------------------------------------------------------------------------

describe('CADmatic 4 r5 productivo (#793) — labels, CNC identity y hard gates', () => {
  it('r5 sin autoridad de etiquetas BLOQUEA (nunca legacy, nunca r4, nunca generic)', async () => {
    const { job } = await r5GateJob();
    const bare: PtxResolvedCuttingJob = {
      jobId: job.jobId,
      provenance: job.provenance,
      cutPlan: job.cutPlan,
    };
    const readiness = PTX_POSTPROCESSOR_ADAPTER.canSerialize(bare, CANDIDATE_R5);
    expect(readiness.ready).toBe(false);
    expect(readiness.reasons.map((r) => r.code)).toContain('ptx_compile.label_authority_missing');
    let thrown: unknown = null;
    try {
      PTX_POSTPROCESSOR_ADAPTER.serialize(bare, CANDIDATE_R5);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AdapterSerializationBlocked);
    // Same job+plan through the historical r4 revision still serializes: the
    // blocker is the r5 contract, not the plan.
    expect(PTX_POSTPROCESSOR_ADAPTER.canSerialize(bare, CANDIDATE).ready).toBe(true);
  });

  it('plan sin identidad frozen de release BLOQUEA r5 (release_identity_missing)', async () => {
    const { job } = await r5GateJob();
    const unReleased: PtxResolvedCuttingJob = {
      ...job,
      cutPlan: { ...job.cutPlan, releaseBase: undefined },
    };
    const readiness = PTX_POSTPROCESSOR_ADAPTER.canSerialize(unReleased, CANDIDATE_R5);
    expect(readiness.ready).toBe(false);
    expect(readiness.reasons.map((r) => r.code)).toContain('ptx_compile.release_identity_missing');
  });

  it('proyección de OTRA liberación BLOQUEA r5 (release_identity_mismatch)', async () => {
    const { job } = await r5GateJob();
    const other = buildR5GateFixture(r5GateDemandOtherRelease());
    const mismatched: PtxResolvedCuttingJob = {
      ...job,
      manufacturingLabels: other.projection,
    };
    const readiness = PTX_POSTPROCESSOR_ADAPTER.canSerialize(mismatched, CANDIDATE_R5);
    expect(readiness.ready).toBe(false);
    expect(readiness.reasons.map((r) => r.code)).toContain('ptx_compile.release_identity_mismatch');
  });

  it('partLabels parciales (cobertura ≠ 1:1 con la proyección) BLOQUEAN r5', async () => {
    const { job } = await r5GateJob();
    const partial: PtxResolvedCuttingJob = {
      ...job,
      partLabels: job.partLabels!.slice(0, 1),
    };
    const readiness = PTX_POSTPROCESSOR_ADAPTER.canSerialize(partial, CANDIDATE_R5);
    expect(readiness.ready).toBe(false);
    const codes = readiness.reasons.map((r) => r.code);
    expect(codes).toContain('ptx_compile.label_missing');
  });

  it('frozen release piece → PARTS_REQ.CODE exacto + PARTS_INF/PARTS_UDI correspondientes + EDGE1..4 + PRODUCT/PROD_NUM + BARCODE2', async () => {
    const { job, projection } = await r5GateJob();
    const parsed = parsePtxDocumentBytes(PTX_POSTPROCESSOR_ADAPTER.serialize(job, CANDIDATE_R5));
    const partsReq = parsed.records.filter(
      (record): record is PtxPartsReqRecord => record.type === 'PARTS_REQ',
    );
    const partsInf = parsed.records.filter(
      (record): record is PtxPartsInfRecord => record.type === 'PARTS_INF',
    );
    const partsUdi = parsed.records.filter(
      (record): record is PtxPartsUdiRecord => record.type === 'PARTS_UDI',
    );
    // One row per PHYSICAL piece: unit1 (COST, PTA, PTA-C2, FND, RIP) + unit2
    // (MOD-793-L2-P01, MOD-793-L2-P02) = 7 pieces.
    const expectedCodes = [
      'MOD-793-COST',
      'MOD-793-PTA',
      'MOD-793-PTA-C2',
      'MOD-793-FND',
      'MOD-793-RIP',
      'MOD-793-L2-COST',
      'MOD-793-L2-PTA',
    ];
    expect(partsReq.map((row) => row.code).sort()).toEqual([...expectedCodes].sort());
    expect(partsInf).toHaveLength(expectedCodes.length);
    expect(partsUdi).toHaveLength(expectedCodes.length);

    const infByPart = new Map(partsInf.map((row) => [row.partIndex, row]));
    const infOf = (code: string): PtxPartsInfRecord | undefined => {
      const partIndex = partsReq.find((row) => row.code === code)?.partIndex;
      return partIndex === undefined ? undefined : infByPart.get(partIndex);
    };

    // 3+1 asymmetric trap: L1, L2, W1 banded, W2 NOT → EDGE1/2/3 carry the
    // band, EDGE4 stays empty. (L2→EDGE1, L1→EDGE2, W1→EDGE3, W2→EDGE4.)
    const cost = infOf('MOD-793-COST')!;
    expect(cost.edge1).toBe(R5_GATE_EDGE_CODE);
    expect(cost.edge2).toBe(R5_GATE_EDGE_CODE);
    expect(cost.edge3).toBe(R5_GATE_EDGE_CODE);
    expect(cost.edge4).toBeUndefined();
    // Length-only band (PUERTA): EDGE1/EDGE2 only.
    const puerta = infOf('MOD-793-PTA')!;
    expect(puerta.edge1).toBe(R5_GATE_EDGE_CODE);
    expect(puerta.edge2).toBe(R5_GATE_EDGE_CODE);
    expect(puerta.edge3).toBeUndefined();
    expect(puerta.edge4).toBeUndefined();
    // No band at all (RIP): every EDGE empty.
    const rip = infOf('MOD-793-RIP')!;
    expect(rip.edge1).toBeUndefined();
    expect(rip.edge2).toBeUndefined();
    expect(rip.edge3).toBeUndefined();
    expect(rip.edge4).toBeUndefined();

    // PRODUCT/PROD_INFO/PROD dims/PROD_NUM from the frozen unit context;
    // ORDER carries the frozen release number.
    for (const code of expectedCodes) {
      const inf = infOf(code)!;
      expect(inf.product).toBe('MOD-793');
      expect(inf.productInfo).toBe('Rack 793 Gate');
      expect(inf.productWidth).toBe('600');
      expect(inf.productHeight).toBe('1600');
      expect(inf.productDepth).toBe('450');
      expect(inf.order).toBe(`R${R5_GATE_RELEASE_NUMBER}`);
      expect(inf.barcode2).toBe(code);
      expect(inf.coreMaterial).toBe(
        code.includes('FND') ? R5_GATE_FONDO_MATERIAL_CODE : R5_GATE_MAIN_MATERIAL_CODE,
      );
      expect(inf.labelQuantity).toBe('1');
    }
    expect(infOf('MOD-793-COST')!.productNumber).toBe('1');
    expect(infOf('MOD-793-L2-COST')!.productNumber).toBe('2');
    // The projection's frozen codes are exactly the PARTS_REQ codes.
    expect(projection.pieces.map((piece) => piece.manufacturingPartCode).sort()).toEqual(
      [...expectedCodes].sort(),
    );
  });

  it('dimensiones part-local pre-rotación: la pieza rotada conserva su marco local en PARTS_REQ', async () => {
    const { job, plan } = await r5GateJob();
    const fondoPiece = plan.sheets
      .flatMap((sheet) => sheet.pieces)
      .find((piece) => piece.labelRef === 'MOD-793-FND');
    expect(fondoPiece).toBeDefined();
    expect(fondoPiece!.rotated).toBe(true);
    const parsed = parsePtxDocumentBytes(PTX_POSTPROCESSOR_ADAPTER.serialize(job, CANDIDATE_R5));
    const fondoRow = parsed.records.find(
      (record): record is PtxPartsReqRecord =>
        record.type === 'PARTS_REQ' && record.code === 'MOD-793-FND',
    );
    expect(fondoRow).toBeDefined();
    // Local cut frame (640×1100 finished, no edge deduction on this piece) —
    // NOT the placed (rotated) extents.
    expect(fondoRow!.length).toBe(640);
    expect(fondoRow!.width).toBe(1100);
  });

  it('CNC: autoridad explícita → DRAWING/BARCODE1 presentes y deterministas; sin autoridad → ausentes', async () => {
    const { job } = await r5GateJob();
    const bytesA = PTX_POSTPROCESSOR_ADAPTER.serialize(job, CANDIDATE_R5);
    const bytesB = PTX_POSTPROCESSOR_ADAPTER.serialize(job, CANDIDATE_R5);
    const parseInf = (bytes: Uint8Array) => {
      const parsed = parsePtxDocumentBytes(bytes);
      const partsReq = parsed.records.filter(
        (record): record is PtxPartsReqRecord => record.type === 'PARTS_REQ',
      );
      return new Map(
        parsed.records
          .filter((record): record is PtxPartsInfRecord => record.type === 'PARTS_INF')
          .map((row) => [
            partsReq.find((req) => req.partIndex === row.partIndex)?.code ?? String(row.partIndex),
            row,
          ]),
      );
    };
    const infA = parseInf(bytesA);
    const infB = parseInf(bytesB);

    // CNC authority: the fixture's explicit machining truth covers the fondo
    // partId in every unit carrying it (unit 1 here; unit 2 has no fondo).
    const fondo = infA.get('MOD-793-FND');
    expect(fondo?.drawing).toMatch(/^D[0-9A-F]{12}$/);
    expect(fondo?.barcode1).toBe(`*${fondo?.drawing}*`);
    // Deterministic: same frozen identity + same code → same DRAWING.
    expect(infB.get('MOD-793-FND')?.drawing).toBe(fondo?.drawing);
    // No machining authority → NO DRAWING/BARCODE1 (never inferred).
    for (const code of ['MOD-793-COST', 'MOD-793-PTA', 'MOD-793-PTA-C2', 'MOD-793-RIP', 'MOD-793-L2-COST', 'MOD-793-L2-PTA']) {
      expect(infA.get(code)?.drawing).toBeUndefined();
      expect(infA.get(code)?.barcode1).toBeUndefined();
    }
  });

  it('CNC scope: misma identidad frozen → mismo DRAWING; otra liberación → DRAWING distinto', async () => {
    const { job } = await r5GateJob();
    const other = await r5GateJob(r5GateDemandOtherRelease());
    const infOf = (bytes: Uint8Array, code: string) => {
      const parsed = parsePtxDocumentBytes(bytes);
      const partsReq = parsed.records.filter(
        (record): record is PtxPartsReqRecord => record.type === 'PARTS_REQ',
      );
      const target = partsReq.find((req) => req.code === code);
      return parsed.records.find(
        (record): record is PtxPartsInfRecord =>
          record.type === 'PARTS_INF' && record.partIndex === target?.partIndex,
      );
    };
    const a = infOf(PTX_POSTPROCESSOR_ADAPTER.serialize(job, CANDIDATE_R5), 'MOD-793-FND');
    const b = infOf(PTX_POSTPROCESSOR_ADAPTER.serialize(job, CANDIDATE_R5), 'MOD-793-FND');
    const c = infOf(
      PTX_POSTPROCESSOR_ADAPTER.serialize(other.job, CANDIDATE_R5),
      'MOD-793-FND',
    );
    expect(a?.drawing).toBe(b?.drawing);
    expect(c?.drawing).toBeDefined();
    expect(c?.drawing).not.toBe(a?.drawing);
  });

  it('scope CNC vacío con autoridad BLOQUEA en el mapeo (nunca un D<>) degenerado', async () => {
    const { projection } = await r5GateJob();
    const broken = {
      ...projection,
      cncScope: '',
      pieces: projection.pieces.map((piece) =>
        piece.hasCncMachining === true ? { ...piece, hasCncMachining: true as const } : piece,
      ),
    };
    await expect(ptxPartLabelsFromManufacturingProjection(broken)).rejects.toThrow(
      /scope CNC\/release congelado/i,
    );
  });
});
