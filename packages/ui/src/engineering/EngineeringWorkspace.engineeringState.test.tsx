/**
 * @vitest-environment jsdom
 *
 * #740 PR 1 — the Engineering workspace with the DURABLE per-release
 * engineering state of the pinned release: the status chip follows the
 * server-owned evidence (Pendiente → En proceso → Completa), the explicit
 * user commands appear per phase, and completion shows the honest fact plus
 * the next stage WITHOUT enabling materials or physical work. Fail-closed:
 * while the state loads (or on error) no command is offered.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Project } from '@granete/domain';
import type { ProductionOrderReadiness } from '../production/productionOrderModel';

import { EngineeringWorkspace } from './EngineeringWorkspace';

afterEach(cleanup);

function makeCanonicalProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Cocina Liberada',
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
    },
    ...overrides,
  } as unknown as Project;
}

const baseProps = {
  project: makeCanonicalProject(),
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

const pendingState = {
  status: 'ready' as const,
  phase: 'pending' as const,
  version: 0,
  completedByLabel: null,
  completedAtLabel: null,
};

const inProgressState = {
  status: 'ready' as const,
  phase: 'in_progress' as const,
  version: 1,
  completedByLabel: null,
  completedAtLabel: null,
};

const completedState = {
  status: 'ready' as const,
  phase: 'completed' as const,
  version: 2,
  completedByLabel: 'Ing. Prueba',
  completedAtLabel: '16 de sept de 2026, 12:00',
};

describe('EngineeringWorkspace — durable per-release engineering state (#740)', () => {
  it('pending: chip Pendiente + primary CTA Iniciar Ingeniería', () => {
    const onStart = vi.fn();
    render(
      <EngineeringWorkspace
        {...baseProps}
        releaseContext={readyContext}
        releaseEngineeringState={pendingState}
        onStartReleaseEngineering={onStart}
      />,
    );
    expect(screen.getByTestId('eng-entry-status').textContent).toContain('Pendiente');
    const cta = screen.getByTestId('eng-start-engineering');
    expect(cta.textContent).toContain('Iniciar Ingeniería');
    expect(screen.queryByTestId('eng-complete-engineering')).toBeNull();
    fireEvent.click(cta);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('in progress: chip En proceso + primary CTA Completar Ingeniería (no start)', () => {
    const onStart = vi.fn();
    const onComplete = vi.fn();
    render(
      <EngineeringWorkspace
        {...baseProps}
        releaseContext={readyContext}
        releaseEngineeringState={inProgressState}
        onStartReleaseEngineering={onStart}
        onCompleteReleaseEngineering={onComplete}
      />,
    );
    expect(screen.getByTestId('eng-entry-status').textContent).toContain('En proceso');
    expect(screen.queryByTestId('eng-start-engineering')).toBeNull();
    const cta = screen.getByTestId('eng-complete-engineering');
    expect(cta.textContent).toContain('Completar Ingeniería');
    fireEvent.click(cta);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onStart).not.toHaveBeenCalled();
  });

  it('completed: final fact with actor/date + honest next stage, no commands', () => {
    const onStart = vi.fn();
    const onComplete = vi.fn();
    render(
      <EngineeringWorkspace
        {...baseProps}
        releaseContext={readyContext}
        releaseEngineeringState={completedState}
        onStartReleaseEngineering={onStart}
        onCompleteReleaseEngineering={onComplete}
      />,
    );
    expect(screen.getByTestId('eng-entry-status').textContent).toContain('Completa');
    const fact = screen.getByTestId('eng-engineering-completed');
    expect(fact.textContent).toContain('Ingeniería completa');
    expect(fact.textContent).toContain('por Ing. Prueba');
    expect(fact.textContent).toContain('autorización de materiales (pendiente)');
    // Completion is final: no further engineering commands.
    expect(screen.queryByTestId('eng-start-engineering')).toBeNull();
    expect(screen.queryByTestId('eng-complete-engineering')).toBeNull();
    // No physical/material action is enabled by the fact.
    expect(screen.queryByTestId('eng-send-to-production')).toBeNull();
  });

  it('fail-closed: while loading or on error no engineering command is offered', () => {
    const { rerender } = render(
      <EngineeringWorkspace
        {...baseProps}
        releaseContext={readyContext}
        releaseEngineeringState={{ status: 'loading' }}
        onStartReleaseEngineering={() => undefined}
        onCompleteReleaseEngineering={() => undefined}
      />,
    );
    expect(screen.queryByTestId('eng-start-engineering')).toBeNull();
    expect(screen.queryByTestId('eng-complete-engineering')).toBeNull();
    // The #738 authority chip stands while the durable state resolves.
    expect(screen.getByTestId('eng-entry-status').textContent).toContain('Pendiente');

    rerender(
      <EngineeringWorkspace
        {...baseProps}
        releaseContext={readyContext}
        releaseEngineeringState={{
          status: 'error',
          message: 'No se pudo leer el estado de Ingeniería',
        }}
        onStartReleaseEngineering={() => undefined}
        onCompleteReleaseEngineering={() => undefined}
      />,
    );
    expect(screen.queryByTestId('eng-start-engineering')).toBeNull();
    expect(screen.queryByTestId('eng-complete-engineering')).toBeNull();
  });

  it('a rejected command surfaces its honest error inline', () => {
    render(
      <EngineeringWorkspace
        {...baseProps}
        releaseContext={readyContext}
        releaseEngineeringState={inProgressState}
        onCompleteReleaseEngineering={() => undefined}
        releaseEngineeringError="el estado de Ingeniería cambió: revisalo y volvé a intentar"
      />,
    );
    expect(screen.getByTestId('eng-engineering-error').textContent).toContain(
      'el estado de Ingeniería cambió',
    );
  });

  it('busy state disables the active command', () => {
    render(
      <EngineeringWorkspace
        {...baseProps}
        releaseContext={readyContext}
        releaseEngineeringState={inProgressState}
        onCompleteReleaseEngineering={() => undefined}
        releaseEngineeringBusy
      />,
    );
    expect((screen.getByTestId('eng-complete-engineering') as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
