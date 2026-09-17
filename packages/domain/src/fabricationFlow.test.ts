/**
 * #768 — fabrication flow projection tests.
 *
 * Every step must be derived from EXISTING authorities only: canonical
 * release, durable per-release Engineering state, material evidence
 * correlated with the exact release, and materialized physical executions.
 * `Project.status` is never an input (draft obras with a release show the
 * real flow; `produced` stamps prove nothing).
 */
import { describe, expect, it } from 'vitest';
import type { Project } from './types';
import { fabricationFlowOf, hasMaterializedPhysicalWork } from './fabricationFlow';

function canonicalProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Cocina Demo',
    customerId: 'c1',
    status: 'draft',
    currency: 'MXN',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-05T00:00:00.000Z',
    items: [],
    resolvedProductionRelease: {
      source: 'canonical',
      releaseId: 'rel-1',
      releaseNumber: 1,
      designRevisionId: 'dr-2',
      designRevisionNumber: 2,
      quoteRevisionId: 'qr-1',
      manufacturingFingerprint: 'fp-1',
    },
    ...overrides,
  } as unknown as Project;
}

const correlatedRequirements = {
  releaseId: 'rel-1',
  bomFingerprint: 'fp-1',
  lines: [],
} as unknown as NonNullable<Project['materialPlanning']>['requirements'];

const materialsRelease = { releasedBy: 'u1', releasedAt: '2026-09-06T10:00:00Z' };

const partWithProgress = {
  id: 'part-1',
  productionRevision: 'rel-1',
  requiredOperations: [{ status: 'completed' }],
} as unknown as NonNullable<Project['partInstances']>[number];

function step(flowResult: ReturnType<typeof fabricationFlowOf>, id: string) {
  expect(flowResult.kind).toBe('flow');
  if (flowResult.kind !== 'flow') throw new Error('unreachable');
  const step = flowResult.flow.steps.find((s) => s.id === id);
  expect(step).toBeDefined();
  return step!;
}

describe('fabricationFlowOf — authority mapping (#768)', () => {
  it('Caso A: release + Ingeniería pendiente → design/release done, ingeniería current con acción Iniciar', () => {
    const result = fabricationFlowOf(canonicalProject(), {
      kind: 'phase',
      phase: 'pending',
    });
    expect(step(result, 'design').status).toBe('done');
    expect(step(result, 'release').status).toBe('done');
    expect(step(result, 'release').detail).toBe('Liberación #1 · Diseño R2');
    const eng = step(result, 'engineering');
    expect(eng.status).toBe('current');
    expect(eng.stateLabel).toBe('Pendiente');
    expect(step(result, 'materials').status).toBe('pending');
    expect(step(result, 'production').status).toBe('pending');
    if (result.kind !== 'flow') throw new Error('unreachable');
    expect(result.flow.nextAction).toBe('start-engineering');
    expect(result.flow.nextActionLabel).toBe('Iniciar Ingeniería');
  });

  it('Caso B: Ingeniería en proceso → acción Completar Ingeniería', () => {
    const result = fabricationFlowOf(canonicalProject(), {
      kind: 'phase',
      phase: 'in_progress',
    });
    expect(step(result, 'engineering').stateLabel).toBe('En proceso');
    if (result.kind !== 'flow') throw new Error('unreachable');
    expect(result.flow.nextAction).toBe('complete-engineering');
    expect(result.flow.nextActionLabel).toBe('Completar Ingeniería');
  });

  it('Caso C: Ingeniería completa + requerimientos correlacionados sin stamp → Materiales current, acción Autorizar materiales', () => {
    const result = fabricationFlowOf(
      canonicalProject({
        materialPlanning: { requirements: correlatedRequirements } as Project['materialPlanning'],
      }),
      { kind: 'phase', phase: 'completed' },
    );
    expect(step(result, 'engineering').status).toBe('done');
    const materials = step(result, 'materials');
    expect(materials.status).toBe('current');
    expect(materials.label).toBe('Materiales pendientes');
    expect(step(result, 'production').status).toBe('pending');
    expect(step(result, 'production').label).toBe('Producción');
    if (result.kind !== 'flow') throw new Error('unreachable');
    expect(result.flow.nextAction).toBe('prepare-materials');
    expect(result.flow.nextActionLabel).toBe('Autorizar materiales');
  });

  it('Caso D: materiales autorizados → Listo para producción, SIN acción y SIN "iniciada"', () => {
    const result = fabricationFlowOf(
      canonicalProject({
        materialPlanning: { requirements: correlatedRequirements } as Project['materialPlanning'],
        materialsRelease,
      }),
      { kind: 'phase', phase: 'completed' },
    );
    expect(step(result, 'materials').status).toBe('done');
    expect(step(result, 'materials').label).toBe('Materiales autorizados');
    const production = step(result, 'production');
    expect(production.status).toBe('current');
    expect(production.label).toBe('Listo para producción');
    if (result.kind !== 'flow') throw new Error('unreachable');
    expect(result.flow.nextAction).toBeNull();
  });

  it('Caso E: evidencia física real → En producción (nunca por Project.status)', () => {
    const result = fabricationFlowOf(
      canonicalProject({
        materialPlanning: { requirements: correlatedRequirements } as Project['materialPlanning'],
        materialsRelease,
        partInstances: [partWithProgress],
        status: 'draft',
      }),
      { kind: 'phase', phase: 'completed' },
    );
    const production = step(result, 'production');
    expect(production.status).toBe('current');
    expect(production.label).toBe('En producción');
  });

  it('Project.status produced SIN evidencia física NO inicia producción', () => {
    const result = fabricationFlowOf(
      canonicalProject({
        status: 'produced',
        materialPlanning: { requirements: correlatedRequirements } as Project['materialPlanning'],
        materialsRelease,
      }),
      { kind: 'phase', phase: 'completed' },
    );
    expect(step(result, 'production').label).toBe('Listo para producción');
  });

  it('unidad avanzada (status ≠ awaiting_parts) también es evidencia física', () => {
    expect(
      hasMaterializedPhysicalWork({
        moduleUnits: [
          { productionRevision: 'rel-1', status: 'assembling' },
        ],
      } as unknown as Pick<Project, 'partInstances' | 'moduleUnits'>),
    ).toBe(true);
    expect(
      hasMaterializedPhysicalWork({
        moduleUnits: [
          { productionRevision: 'rel-1', status: 'awaiting_parts' },
        ],
      } as unknown as Pick<Project, 'partInstances' | 'moduleUnits'>),
    ).toBe(false);
  });

  it('trabajo físico de una liberación ANTERIOR sigue siendo trabajo real (la discontinuidad la explica el banner)', () => {
    const result = fabricationFlowOf(
      canonicalProject({
        resolvedProductionRelease: {
          source: 'canonical',
          releaseId: 'rel-2',
          releaseNumber: 2,
          designRevisionId: 'dr-3',
          designRevisionNumber: 3,
        } as Project['resolvedProductionRelease'],
        partInstances: [partWithProgress],
      }),
      { kind: 'phase', phase: 'pending' },
    );
    expect(step(result, 'production').label).toBe('En producción');
  });

  it('Sin release (legacy/pre-DT) → no-release: la superficie no inventa flujo', () => {
    const legacy = {
      id: 'p2',
      status: 'accepted',
      hasDigitalThreadContext: false,
      engineeringLog: { sentToProductionAt: '2026-09-02T00:00:00Z' },
      materialsRelease,
    } as unknown as Project;
    expect(fabricationFlowOf(legacy)).toEqual({ kind: 'no-release' });
    expect(fabricationFlowOf({ ...canonicalProject(), resolvedProductionRelease: undefined })).toEqual(
      { kind: 'no-release' },
    );
  });

  it('requerimientos de OTRA liberación o huella incompatible NO derivan materiales', () => {
    const otherRelease = fabricationFlowOf(
      canonicalProject({
        materialPlanning: {
          requirements: { ...correlatedRequirements, releaseId: 'rel-otra' },
        } as Project['materialPlanning'],
      }),
      { kind: 'phase', phase: 'completed' },
    );
    expect(step(otherRelease, 'materials').status).toBe('pending');

    const badFingerprint = fabricationFlowOf(
      canonicalProject({
        materialPlanning: {
          requirements: { ...correlatedRequirements, bomFingerprint: 'fp-otro' },
        } as Project['materialPlanning'],
      }),
      { kind: 'phase', phase: 'completed' },
    );
    expect(step(badFingerprint, 'materials').status).toBe('pending');
  });

  it('stamp legacy SIN derivación correlacionada NO autoriza materiales', () => {
    const result = fabricationFlowOf(
      canonicalProject({ materialsRelease }),
      { kind: 'phase', phase: 'completed' },
    );
    expect(step(result, 'materials').status).toBe('pending');
    expect(step(result, 'production').status).toBe('pending');
  });

  it('estado de Ingeniería no demostrable → paso unconfirmed, sin acción (fail closed)', () => {
    for (const evidence of [
      { kind: 'unknown' } as const,
      { kind: 'loading' } as const,
      { kind: 'unconfirmed' } as const,
    ]) {
      const result = fabricationFlowOf(canonicalProject(), evidence);
      const eng = step(result, 'engineering');
      expect(eng.status).toBe('unconfirmed');
      if (result.kind !== 'flow') throw new Error('unreachable');
      expect(result.flow.nextAction).toBeNull();
    }
  });

  it('loading/unconfirmed conservan el fallback honesto de la superficie (#738) y su detalle', () => {
    const loading = fabricationFlowOf(canonicalProject(), { kind: 'loading' });
    const engLoading = step(loading, 'engineering');
    expect(engLoading.stateLabel).toBe('Pendiente');
    expect(engLoading.detail).toBe('Verificando…');

    const unconfirmed = fabricationFlowOf(canonicalProject(), { kind: 'unconfirmed' });
    expect(step(unconfirmed, 'engineering').detail).toBe('Pendiente de confirmar');

    const unknown = fabricationFlowOf(canonicalProject(), { kind: 'unknown' }, {
      unknownEngineeringLabel: 'Sin verificar',
    });
    expect(step(unknown, 'engineering').stateLabel).toBe('Sin verificar');
  });

  it('materiales pendientes SIN Ingeniería completa no son el paso current (casos A/B: ○ Materiales)', () => {
    const result = fabricationFlowOf(
      canonicalProject({
        materialPlanning: { requirements: correlatedRequirements } as Project['materialPlanning'],
      }),
      { kind: 'phase', phase: 'in_progress' },
    );
    expect(step(result, 'materials').status).toBe('pending');
    if (result.kind !== 'flow') throw new Error('unreachable');
    expect(result.flow.nextAction).toBe('complete-engineering');
  });
});
