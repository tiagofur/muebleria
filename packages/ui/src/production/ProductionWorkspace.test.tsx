/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@granete/domain';
import { ProductionWorkspace } from './ProductionWorkspace';

/**
 * P0-2c (pre-demo audit): "Abrir en Producción" navigates to /orders/{id},
 * but the queue only lists projects with materialsRelease. An accepted
 * project without the release dead-ended on "Orden no encontrada" — the
 * workspace must explain the missing warehouse step instead.
 */

function baseProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Cocina QA',
    customerId: 'c1',
    currency: 'MXN',
    marginFactor: 1.35,
    laborFixedCost: 0,
    status: 'accepted',
    hasDigitalThreadContext: false,
    items: [],
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:00.000Z',
    ...overrides,
  };
}

afterEach(cleanup);

function renderWorkspace(
  projects: readonly Project[],
  lookupProject?: (id: string) => Project | undefined,
  onOpenWarehouse?: () => void,
) {
  return render(
    <ProductionWorkspace
      projects={projects}
      lookupProject={lookupProject}
      onOpenWarehouse={onOpenWarehouse}
      orderProjectId="p1"
      orderTab="resumen"
      onOrderTabChange={() => {}}
      onOpenOrder={() => {}}
      onBackToQueue={() => {}}
      onOpenDesign={() => {}}
      customerLabelFor={() => 'Cliente'}
      salePriceFor={() => null}
      resolveCutRows={() => ({ rows: null })}
      onExportOptimizer={() => {}}
      onExportHardware={() => {}}
      onMarkProduced={() => {}}
    />,
  );
}

describe('ProductionWorkspace order routing (P0-2c)', () => {
  it('guides to material release when accepted but not released', () => {
    const acceptedNoRelease = baseProject(); // accepted, sin materialsRelease
    const onOpenWarehouse = vi.fn();
    renderWorkspace(
      [],
      (id) => (id === 'p1' ? acceptedNoRelease : undefined),
      onOpenWarehouse,
    );
    const guidance = screen.getByTestId('prod-order-pending-release');
    expect(guidance.textContent).toContain('Falta liberar materiales');
    expect(guidance.textContent).toContain('Almacén');
    expect(guidance.textContent).toContain('Paso 1');
    fireEvent.click(screen.getByRole('button', { name: 'Ir a Almacén' }));
    expect(onOpenWarehouse).toHaveBeenCalledTimes(1);
  });

  it('keeps the real missing-order state for unknown ids', () => {
    renderWorkspace([]);
    const missing = screen.getByTestId('prod-order-missing');
    expect(missing.textContent).toContain('Orden no encontrada');
  });

  it('keeps the not-ready state for draft projects found via lookup', () => {
    const draft = baseProject({ status: 'draft' });
    renderWorkspace([], (id) => (id === 'p1' ? draft : undefined));
    expect(screen.getByTestId('prod-order-not-ready')).toBeTruthy();
  });

  it('keeps a modern accepted project without a canonical release out of production', () => {
    const modernAcceptedWithoutRelease = baseProject({
      hasDigitalThreadContext: true,
    });
    renderWorkspace(
      [],
      (id) => (id === 'p1' ? modernAcceptedWithoutRelease : undefined),
    );
    expect(screen.getByTestId('prod-order-not-ready')).toBeTruthy();
    expect(screen.queryByTestId('prod-order-pending-release')).toBeNull();
  });
});
