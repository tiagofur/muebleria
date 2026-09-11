/**
 * Synthetic machine-output fixtures (#351 / Client A validation pack).
 *
 * CUTTING reuses the frozen `fixture-board-001` r1 CutPlan from #348
 * (packages/excel/src/ptxValidationFixture.ts) so the adapter-produced
 * generic PTX stays byte-identical to the audited golden. MACHINING is a new
 * synthetic drilling job (board 600×400×18) with vertical, horizontal and
 * mixed hole types. All identifiers are synthetic; no customer data.
 */

import type {
  ProjectDrillingData,
  ResolvedCuttingJob,
  ResolvedMachiningJob,
} from '@granete/domain';
import { optimizeCutPlan } from '@granete/domain';
import { buildPtxValidationCutPlan, PTX_VALIDATION_FIXTURE_ID } from '../ptxValidationFixture';
import {
  GOLDEN_CONFIG,
  GOLDEN_MATERIALS,
  GOLDEN_PROJECT_ID,
  GOLDEN_ROWS,
} from '../ptx/cutPlanPtxGolden';

export const FIXTURE_CUTTING_JOB_ID = 'fixture-cutting-001';
export const FIXTURE_MACHINING_JOB_ID = 'fixture-machining-001';
export const FIXTURE_JOB_GENERATED_AT = '2026-09-06T00:00:00.000Z';

/**
 * Cutting job with COMPLETE synthetic provenance — every provenance field is
 * explicit so manifests can prove they never fall back to "latest".
 */
export function buildFixtureCuttingJob(): ResolvedCuttingJob {
  const cutPlan = buildPtxValidationCutPlan();
  return {
    jobId: FIXTURE_CUTTING_JOB_ID,
    provenance: {
      projectId: PTX_VALIDATION_FIXTURE_ID,
      generatedAt: FIXTURE_JOB_GENERATED_AT,
      productionReleaseId: 'fixture-release-001',
      designRevisionId: 'fixture-design-rev-001',
      bomFingerprint: 'fixture-bom-fingerprint-001',
      cutPlanId: cutPlan.id,
      cutPlanVersion: cutPlan.version,
    },
    cutPlan,
    presentation: {
      projectName: PTX_VALIDATION_FIXTURE_ID,
      customerName: 'Fixture Operator',
      projectCode: PTX_VALIDATION_FIXTURE_ID,
    },
  };
}

/** Cutting job with partial provenance — for the missing-provenance proofs. */
export function buildFixtureCuttingJobPartialProvenance(): ResolvedCuttingJob {
  const job = buildFixtureCuttingJob();
  const { productionReleaseId: _r, designRevisionId: _d, bomFingerprint: _b, ...partial } =
    job.provenance;
  return { ...job, provenance: partial };
}

/**
 * Cutting job the DOCUMENTED PTX compiler route accepts (#650 CADmatic 4
 * candidate): a real optimizeCutPlan result over the frozen #657 golden
 * input (deterministic, trim 0, every sheet carries its validated
 * CutProgram). Used to exercise the candidate adapter end to end.
 */
export function buildCad4CandidateCuttingJob(): ResolvedCuttingJob {
  const cutPlan = optimizeCutPlan(GOLDEN_PROJECT_ID, GOLDEN_ROWS, GOLDEN_MATERIALS, GOLDEN_CONFIG);
  return {
    jobId: 'fixture-cad4-candidate-001',
    provenance: {
      projectId: GOLDEN_PROJECT_ID,
      generatedAt: FIXTURE_JOB_GENERATED_AT,
      cutPlanId: cutPlan.id,
      cutPlanVersion: cutPlan.version,
    },
    cutPlan,
  };
}

const FIXTURE_MACHINING_PATTERN = {
  pieceCode: 'fixture-module-m.fixture-panel-001',
  moduleCode: 'fixture-module-m',
  partName: 'Pieza Sintetica Panel 001',
  lengthMm: 600,
  widthMm: 400,
  materialName: 'Tablero Sintetico A 18mm',
} as const;

/** Synthetic drilling job: 600×400×18 board, vertical + horizontal + mixed types. */
export function buildFixtureMachiningJob(): ResolvedMachiningJob {
  const drilling: ProjectDrillingData = {
    schema: 'muebles.drilling-data.v1',
    projectId: FIXTURE_MACHINING_JOB_ID,
    projectName: FIXTURE_MACHINING_JOB_ID,
    generatedAt: FIXTURE_JOB_GENERATED_AT,
    totalPiecesCount: 1,
    totalHolesCount: 6,
    patterns: [
      {
        ...FIXTURE_MACHINING_PATTERN,
        holes: [
          // Vertical drilling through the large face (front/back convention).
          { face: 'back', xMm: 50, yMm: 50, diameterMm: 8, depthMm: 12, type: 'dowel' },
          { face: 'back', xMm: 550, yMm: 50, diameterMm: 8, depthMm: 12, type: 'dowel' },
          { face: 'back', xMm: 300, yMm: 350, diameterMm: 35, depthMm: 11.5, type: 'hinge' },
          { face: 'back', xMm: 300, yMm: 200, diameterMm: 5, depthMm: 10, type: 'shelf' },
          // Horizontal drilling into edge faces (left / top).
          { face: 'left', xMm: 300, yMm: 100, diameterMm: 8, depthMm: 34, type: 'minifix' },
          { face: 'top', xMm: 100, yMm: 300, diameterMm: 4, depthMm: 12, type: 'screw' },
        ],
      },
    ],
  };
  return {
    jobId: FIXTURE_MACHINING_JOB_ID,
    provenance: {
      projectId: FIXTURE_MACHINING_JOB_ID,
      generatedAt: FIXTURE_JOB_GENERATED_AT,
      productionReleaseId: 'fixture-release-001',
      designRevisionId: 'fixture-design-rev-001',
      bomFingerprint: 'fixture-bom-fingerprint-001',
    },
    drilling,
  };
}
