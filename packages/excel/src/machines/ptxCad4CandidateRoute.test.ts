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
import { serializePtxDocumentBytes } from '../ptx/serialize';
import { verifyCutPlanPtxReadback } from '../ptx/verifyCutPlanPtxReadback';
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
} from './profiles';
import {
  PTX_CANDIDATE_TITLE,
  PTX_POSTPROCESSOR_ADAPTER,
  profileUsesDocumentedPtxCompiler,
  resolvePtxCompilerRoute,
} from './ptxAdapter';
import type { MachineOutputSelection } from '@granete/domain';

/** Current selectable CADmatic 4 revision (#661 r3): the download-route candidate. */
const CANDIDATE = PTX_CADMATIC_4_R3_PROFILE;
/** Historical r2 candidate: kept immutable; its trim=0 policy stays routed. */
const CANDIDATE_R2 = PTX_CADMATIC_4_CANDIDATE_PROFILE;

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
    ...GOLDEN_ROWS,
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

function expectSelectedReadinessBlocked(job: ResolvedCuttingJob, code: string): void {
  const resolved = evaluateSelectedCuttingOutputReadiness(job.cutPlan, candidateSelection());
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

  it('includeVectors=true emite VECTORS verificados por el readback; false no emite ninguno', () => {
    const job = candidateJob();
    const without = parsePtxDocumentBytes(PTX_POSTPROCESSOR_ADAPTER.serialize(job, CANDIDATE));
    expect(without.records.filter((r) => r.type === 'VECTORS')).toHaveLength(0);

    const withVectorsProfile = profileVariant({ includeVectors: true });
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
    expectBlockedWithDetail(job, CANDIDATE, 'ptx_compile.missing_cut_program');
    expectSelectedReadinessBlocked(job, 'ptx_compile.missing_cut_program');
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
    expectSelectedReadinessBlocked(job, 'ptx_compile.phase_unsupported');
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

describe('CADmatic 4 candidato — descarga existente (#591) y manifest exacto', () => {
  it('unified: un bundle con manifest r3 + adapter 1.2.0 y hashes deterministas', async () => {
    const plan = candidateJob().cutPlan;
    const bundles = await generateSelectedCuttingOutput(plan, candidateSelection());
    expect(bundles).toHaveLength(1);
    const [bundle] = bundles;
    expect(bundle!.artifact.kind).toBe('ptx');
    expect(bundle!.artifact.fileName.endsWith('.ptx')).toBe(true);

    expect(bundle!.manifest.outputCompatibilityProfile).toEqual({
      outputCompatibilityProfileId: 'ptx-cadmatic-4',
      revisionId: 'r3',
    });
    expect(bundle!.manifest.postprocessorAdapter).toEqual({
      postprocessorAdapterId: 'granete-ptx',
      adapterVersion: '1.2.0',
      implementationDigest: PTX_POSTPROCESSOR_ADAPTER.implementationDigest,
    });
    expect(bundle!.manifest.validationStatus).toBe('NOT_TESTED');
    expect(bundle!.manifest.compatibilityEvidence).toEqual({ claim: 'notClaimed' });
    expect(bundle!.manifest.nonProductionValidationArtifact).toBe(true);
    expect(bundle!.manifest.provenance.cutPlanId).toBe(plan.id);
    expect(bundle!.manifest.provenance.cutPlanVersion).toBe(plan.version);

    // El PTX documentado llega al archivo descargado (registro CSV, no INI).
    const text = new TextDecoder().decode(bundle!.artifact.bytes);
    expect(text.startsWith('HEADER,')).toBe(true);
    expect(await sha256Hex(bundle!.artifact.bytes)).toBe(bundle!.artifact.sha256);

    const again = await generateSelectedCuttingOutput(plan, candidateSelection());
    expect(again[0]!.artifact.sha256).toBe(bundle!.artifact.sha256);
  });

  it('by-material: un bundle por material, sin fugas ni omisiones', async () => {
    const plan = twoMaterialPlan();
    const materials = [...new Set(plan.sheets.map((s) => s.materialCode))];
    expect(materials.length).toBeGreaterThanOrEqual(2);

    const bundles = await generateSelectedCuttingOutput(plan, candidateSelection(), 'by-material');
    expect(bundles).toHaveLength(materials.length);
    expect(new Set(bundles.map((b) => b.artifact.fileName)).size).toBe(bundles.length);
    expect(new Set(bundles.map((b) => b.manifest.jobId)).size).toBe(bundles.length);

    for (const bundle of bundles) {
      const text = new TextDecoder().decode(bundle.artifact.bytes);
      expect(text.startsWith('HEADER,')).toBe(true);
      expect(bundle.manifest.outputCompatibilityProfile.revisionId).toBe('r3');
    }
  });

  it('golden end-to-end: selección r3 → adapter → bytes descargados → parser → verifier === []', async () => {
    const plan = optimizeCutPlan(GOLDEN_PROJECT_ID, GOLDEN_ROWS, GOLDEN_MATERIALS, GOLDEN_CONFIG);
    const resolved = resolveManufacturingOutputTarget(candidateSelection(), 'cutting');
    expect(resolved.status === 'CONFIGURED' && resolved.readiness.ready).toBe(true);

    const [bundle] = await generateSelectedCuttingOutput(plan, candidateSelection());
    const parsed = parsePtxDocumentBytes(bundle!.artifact.bytes);
    const route = resolvePtxCompilerRoute(CANDIDATE);
    const { mapping } = compileCutPlanToPtxDocument(plan, route.config!.compileOptions);
    expect(verifyCutPlanPtxReadback(parsed, plan, mapping, route.config!.compileOptions)).toEqual([]);
    expect(parsed.header.title).toBe(PTX_CANDIDATE_TITLE);
  });

  it('pins históricos stale bloquean con causa accionable (sin retargetear)', () => {
    const oldRevision = { ...candidateSelection(), outputCompatibilityProfileRevisionId: 'r1' };
    const r1 = resolveManufacturingOutputTarget(oldRevision, 'cutting');
    expect(r1.status === 'CONFIGURED' && r1.readiness.ready).toBe(false);
    expect(
      r1.status === 'CONFIGURED' ? r1.readiness.reasons.map((x) => x.code) : [],
    ).toContain('PROFILE_DIGEST_MISMATCH');

    const oldAdapter = {
      ...candidateSelection(),
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
