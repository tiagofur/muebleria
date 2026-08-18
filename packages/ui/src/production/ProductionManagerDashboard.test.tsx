// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Project } from '@muebles/domain';
import {
  ProductionManagerDashboard,
  type DashboardMetrics,
} from './ProductionManagerDashboard';

const metrics: DashboardMetrics = {
  totalProjects: 0,
  totalItems: 0,
  totalInstalled: 0,
  avgProgress: 0,
  todayCompleted: 0,
  todayDamages: 0,
  sectors: [],
};

const projects = [
  {
    id: 'project-with-items',
    name: 'Cocina Ana',
    customerId: 'customer-1',
    status: 'accepted',
    currency: 'MXN',
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
    items: [
      { id: 'item-1', moduleId: 'module-1', quantity: 1, optionChoices: {} },
    ],
  },
  {
    id: 'project-empty',
    name: 'Closet pendiente',
    customerId: 'customer-2',
    status: 'produced',
    currency: 'MXN',
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z',
    items: [],
  },
] as unknown as readonly Project[];

function renderDashboard() {
  return render(
    <ProductionManagerDashboard
      projects={projects}
      repo={{
        getProductionDashboard: async () => metrics,
        getProductionActiveJobs: async () => [],
      }}
    />,
  );
}

afterEach(cleanup);

describe('ProductionManagerDashboard', () => {
  it('counts the same accepted and produced projects that it renders', async () => {
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByTestId('pm-total-projects').textContent).toBe('2'),
    );
    expect(screen.getByTestId('pm-project-row-project-with-items')).not.toBeNull();
    expect(screen.getByTestId('pm-project-row-project-empty')).not.toBeNull();
  });

  it('gives projects without items their own state instead of calling them completed', async () => {
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByTestId('pm-project-empty-project-empty')).not.toBeNull(),
    );
    expect(screen.getAllByText('Sin módulos cargados')).toHaveLength(2);
    expect(screen.queryByText('En Completado')).toBeNull();
  });

  it('uses Lucide SVG icons for production sectors', async () => {
    renderDashboard();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Corte/ })).not.toBeNull(),
    );
    expect(screen.getByRole('button', { name: /Corte/ }).querySelector('svg')).not.toBeNull();
  });
});
