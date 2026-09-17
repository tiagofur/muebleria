/**
 * @vitest-environment jsdom
 *
 * #768 — the Engineering workspace renders the compact "Preparación para
 * fabricar" stepper for the pinned canonical release: cases A–D of the demo
 * flow, the shared vocabulary, and the honest text-only next step when no
 * safe action is wired. The stepper never trusts Project.status.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Project } from '@granete/domain';
import type { ProductionOrderReadiness } from '../production/productionOrderModel';

import { EngineeringWorkspace } from './EngineeringWorkspace';

afterEach(cleanup);

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
      quoteRevisionId: 'qr-2',
      manufacturingFingerprint: 'fp-1',
    },
    ...overrides,
  } as unknown as Project;
}

const baseProps = {
  project: canonicalProject(),
  modules: [],
  catalog: null,
  cutRows: [],
  labels: [],
  hardwareRows: [],
  readiness: {
    cutListOk: true,
    cutListError: null,
    cutRowCount: 3,
    moduleUnitCount: 3,
    moduleLineCount: 3,
    materialsResolved: true,
    hasKitchenLayout: false,
    hasPlacements: false,
    layoutCheckOk: true,
    optimizerGenerable: true,
    packGenerable: true,
    readyToCut: true,
    hasUnplacedItems: false,
  } satisfies ProductionOrderReadiness,
  onBack: () => undefined,
};

const readyContext = {
  state: 'ready' as const,
  view: {
    releaseNumber: 1,
    designRevisionNumber: 2,
    quoteLabel: 'Q2',
    releasedAt: '2026-09-05T10:00:00Z',
  },
};

const engineering = (phase: 'pending' | 'in_progress' | 'completed') => ({
  status: 'ready' as const,
  phase,
  version: phase === 'pending' ? 0 : phase === 'in_progress' ? 1 : 2,
  completedByLabel: phase === 'completed' ? 'Ing. Prueba' : null,
  completedAtLabel: phase === 'completed' ? '17 de sept de 2026, 12:00' : null,
});

const correlatedRequirements = {
  releaseId: 'rel-1',
  bomFingerprint: 'fp-1',
  lines: [],
};

describe('EngineeringWorkspace — Preparación para fabricar (#768)', () => {
  it('Caso A: Ingeniería pendiente con stepper completo y CTA Iniciar', () => {
    const onStart = vi.fn();
    render(
      <EngineeringWorkspace
        {...baseProps}
        releaseContext={readyContext}
        releaseEngineeringState={engineering('pending')}
        onStartReleaseEngineering={onStart}
      />,
    );
    const flow = screen.getByTestId('eng-fab-flow');
    expect(flow.getAttribute('aria-label')).toBe('Preparación para fabricar');
    expect(screen.getByTestId('eng-fab-step-design').textContent).toContain('Diseño aprobado');
    expect(screen.getByTestId('eng-fab-step-release').textContent).toContain(
      'Liberado a Ingeniería',
    );
    expect(screen.getByTestId('eng-fab-step-release').textContent).toContain(
      'Liberación #1 · Diseño R2',
    );
    expect(screen.getByTestId('eng-fab-step-engineering').textContent).toContain('Pendiente');
    expect(screen.getByTestId('eng-fab-step-materials').getAttribute('data-state')).toBe('pending');
    expect(screen.getByTestId('eng-fab-step-production').getAttribute('data-state')).toBe('pending');
    const cta = screen.getByTestId('eng-start-engineering');
    expect(cta.textContent).toContain('Iniciar Ingeniería');
    fireEvent.click(cta);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('Caso B: en proceso → CTA Completar dentro del stepper', () => {
    render(
      <EngineeringWorkspace
        {...baseProps}
        releaseContext={readyContext}
        releaseEngineeringState={engineering('in_progress')}
        onCompleteReleaseEngineering={() => undefined}
      />,
    );
    expect(screen.getByTestId('eng-fab-step-engineering').textContent).toContain('En proceso');
    expect(screen.getByTestId('eng-complete-engineering').textContent).toContain(
      'Completar Ingeniería',
    );
    expect(screen.queryByTestId('eng-start-engineering')).toBeNull();
  });

  it('Caso C: completa + materiales derivados → paso current Materiales pendientes', () => {
    render(
      <EngineeringWorkspace
        {...baseProps}
        project={canonicalProject({
          materialPlanning: { requirements: correlatedRequirements } as unknown as Project['materialPlanning'],
        })}
        releaseContext={readyContext}
        releaseEngineeringState={engineering('completed')}
      />,
    );
    const materials = screen.getByTestId('eng-fab-step-materials');
    expect(materials.getAttribute('data-state')).toBe('current');
    expect(materials.textContent).toContain('Materiales pendientes');
    expect(materials.getAttribute('aria-current')).toBe('step');
    expect(screen.getByTestId('eng-fab-step-production').getAttribute('data-state')).toBe('pending');
    // No warehouse callback wired → honest text, no dead button.
    expect(screen.getByTestId('eng-fab-next-text').textContent).toContain('Autorizar materiales');
    expect(screen.queryByTestId('eng-authorize-materials')).toBeNull();
  });

  it('Caso C con navegación: CTA Autorizar materiales abre la superficie existente', () => {
    const onAuthorize = vi.fn();
    render(
      <EngineeringWorkspace
        {...baseProps}
        project={canonicalProject({
          materialPlanning: { requirements: correlatedRequirements } as unknown as Project['materialPlanning'],
        })}
        releaseContext={readyContext}
        releaseEngineeringState={engineering('completed')}
        onAuthorizeMaterials={onAuthorize}
      />,
    );
    const cta = screen.getByTestId('eng-authorize-materials');
    expect(cta.textContent).toContain('Autorizar materiales');
    fireEvent.click(cta);
    expect(onAuthorize).toHaveBeenCalledTimes(1);
  });

  it('Caso D: materiales autorizados → Listo para producción sin acción ni "iniciada"', () => {
    render(
      <EngineeringWorkspace
        {...baseProps}
        project={canonicalProject({
          materialPlanning: { requirements: correlatedRequirements } as unknown as Project['materialPlanning'],
          materialsRelease: { releasedBy: 'u1', releasedAt: '2026-09-06T10:00:00Z' },
        })}
        releaseContext={readyContext}
        releaseEngineeringState={engineering('completed')}
      />,
    );
    expect(screen.getByTestId('eng-fab-step-materials').textContent).toContain(
      'Materiales autorizados',
    );
    const production = screen.getByTestId('eng-fab-step-production');
    expect(production.textContent).toContain('Listo para producción');
    expect(production.textContent).not.toContain('En producción');
    expect(screen.queryByTestId('eng-fab-next-text')).toBeNull();
    expect(screen.queryByRole('button', { name: /Iniciar|Completar|Autorizar/ })).toBeNull();
  });

  it('Caso E: trabajo físico real → En producción (aunque Project.status siga draft)', () => {
    render(
      <EngineeringWorkspace
        {...baseProps}
        project={canonicalProject({
          status: 'draft',
          materialPlanning: { requirements: correlatedRequirements } as unknown as Project['materialPlanning'],
          materialsRelease: { releasedBy: 'u1', releasedAt: '2026-09-06T10:00:00Z' },
          partInstances: [
            {
              id: 'part-1',
              productionRevision: 'rel-1',
              requiredOperations: [{ status: 'completed' }],
            } as unknown as NonNullable<Project['partInstances']>[number],
          ],
        })}
        releaseContext={readyContext}
        releaseEngineeringState={engineering('completed')}
      />,
    );
    expect(screen.getByTestId('eng-fab-step-production').textContent).toContain('En producción');
  });

  it('sin release pineado el stepper no se inventa (workspace legacy intacto)', () => {
    render(<EngineeringWorkspace {...baseProps} />);
    expect(screen.queryByTestId('eng-fab-flow')).toBeNull();
  });

  it('el hecho de completación conserva actor/fecha y siguiente etapa honesta', () => {
    render(
      <EngineeringWorkspace
        {...baseProps}
        releaseContext={readyContext}
        releaseEngineeringState={engineering('completed')}
      />,
    );
    const fact = screen.getByTestId('eng-engineering-completed');
    expect(fact.textContent).toContain('Ingeniería completa');
    expect(fact.textContent).toContain('por Ing. Prueba');
    expect(fact.textContent).toContain('autorización de materiales (pendiente)');
  });
});
