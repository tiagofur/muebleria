/**
 * @vitest-environment jsdom
 *
 * #768 — shared compact stepper: state is icon+text (never color alone),
 * `aria-current` marks the current step, the next action is a real
 * keyboard-reachable button when the surface provides one and honest text
 * when it does not.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { FabricationFlow } from '@granete/domain';
import { fabricationFlowOf } from '@granete/domain';

import { FabricationFlowSteps } from './FabricationFlowSteps';

afterEach(cleanup);

const canonicalProject = {
  id: 'p1',
  status: 'draft',
  items: [],
  resolvedProductionRelease: {
    source: 'canonical' as const,
    releaseId: 'rel-1',
    releaseNumber: 1,
    designRevisionId: 'dr-2',
    designRevisionNumber: 2,
    manufacturingFingerprint: 'fp-1',
  },
} as unknown as Parameters<typeof fabricationFlowOf>[0];

function flowOf(
  evidence?: Parameters<typeof fabricationFlowOf>[1],
): FabricationFlow {
  const result = fabricationFlowOf(canonicalProject, evidence);
  if (result.kind !== 'flow') throw new Error('expected a flow');
  return result.flow;
}

describe('FabricationFlowSteps (#768)', () => {
  it('renders the five steps with the release detail as secondary copy', () => {
    render(<FabricationFlowSteps flow={flowOf({ kind: 'phase', phase: 'in_progress' })} />);
    const section = screen.getByTestId('fab-fab-flow');
    expect(section.getAttribute('aria-label')).toBe('Preparación para fabricar');
    expect(screen.getByTestId('fab-fab-step-design').textContent).toContain('Diseño aprobado');
    expect(screen.getByTestId('fab-fab-step-release').textContent).toContain(
      'Liberación #1 · Diseño R2',
    );
    expect(screen.getByTestId('fab-fab-step-engineering').textContent).toContain('En proceso');
    expect(screen.getByTestId('fab-fab-step-materials').textContent).toContain('Materiales');
    expect(screen.getByTestId('fab-fab-step-production').textContent).toContain('Producción');
  });

  it('marks exactly the current step with aria-current="step"', () => {
    render(<FabricationFlowSteps flow={flowOf({ kind: 'phase', phase: 'pending' })} />);
    const current = screen
      .getAllByRole('listitem')
      .filter((li) => li.getAttribute('aria-current') === 'step');
    expect(current).toHaveLength(1);
    expect(current[0]!.getAttribute('data-testid')).toBe('fab-fab-step-engineering');
  });

  it('renders the surface action as a reachable button wired to the callback', () => {
    const onActivate = vi.fn();
    render(
      <FabricationFlowSteps
        flow={flowOf({ kind: 'phase', phase: 'in_progress' })}
        action={{ label: 'Completar Ingeniería', onActivate, testId: 'eng-complete-engineering' }}
      />,
    );
    const button = screen.getByTestId('eng-complete-engineering');
    expect(button.tagName).toBe('BUTTON');
    expect(button.textContent).toContain('Completar Ingeniería');
    fireEvent.click(button);
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('without a safe action the next step is honest text, never a dead button', () => {
    render(<FabricationFlowSteps flow={flowOf({ kind: 'phase', phase: 'pending' })} />);
    expect(screen.getByTestId('fab-fab-next-text').textContent).toContain('Iniciar Ingeniería');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('hides the next-step row when the flow has no next action', () => {
    const flow = flowOf({ kind: 'phase', phase: 'pending' });
    const withMaterials = fabricationFlowOf(
      {
        ...canonicalProject,
        materialPlanning: { requirements: { releaseId: 'rel-1', bomFingerprint: 'fp-1' } },
        materialsRelease: { releasedBy: 'u1', releasedAt: '2026-09-06T10:00:00Z' },
      } as Parameters<typeof fabricationFlowOf>[0],
      { kind: 'phase', phase: 'completed' },
    );
    expect(withMaterials.kind).toBe('flow');
    if (withMaterials.kind !== 'flow') throw new Error('unreachable');
    expect(flow.steps).toHaveLength(5);
    const { rerender } = render(<FabricationFlowSteps flow={flow} />);
    expect(screen.getByTestId('fab-fab-next-text')).toBeTruthy();
    rerender(<FabricationFlowSteps flow={withMaterials.flow} />);
    expect(screen.queryByTestId('fab-fab-next-text')).toBeNull();
    expect(screen.getByTestId('fab-fab-step-production').textContent).toContain(
      'Listo para producción',
    );
  });

  it('unconfirmed engineering shows the honest label and no action row', () => {
    render(<FabricationFlowSteps flow={flowOf({ kind: 'unknown' })} />);
    const engineering = screen.getByTestId('fab-fab-step-engineering');
    expect(engineering.textContent).toContain('Pendiente de confirmar');
    expect(screen.queryByTestId('fab-fab-next-text')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders per-step extras through renderDetail', () => {
    render(
      <FabricationFlowSteps
        flow={flowOf({ kind: 'phase', phase: 'completed' })}
        renderDetail={(stepId) =>
          stepId === 'engineering' ? <span data-testid="extra-fact">Ingeniería completa · hoy</span> : null
        }
      />,
    );
    expect(screen.getByTestId('extra-fact').textContent).toContain('Ingeniería completa');
  });
});
