/**
 * F023 — Dashboard home screen.
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Dashboard, type DashboardProps } from './Dashboard';

const baseProps: DashboardProps = {
  stats: {
    activeProjects: 3,
    monthlyQuotedTotal: 1250.5,
    modulesCount: 12,
    activeMaterials: 8,
  },
  recentProjects: [
    {
      id: 'prj-1',
      name: 'Cocina Ana',
      customerLabel: 'Ana López',
      status: 'draft',
      updatedAt: '2026-07-12T10:00:00.000Z',
      salePrice: 202.5,
    },
    {
      id: 'prj-2',
      name: 'Living Pedro',
      customerLabel: 'Pedro Ruiz',
      status: 'quoted',
      updatedAt: '2026-07-10T08:00:00.000Z',
      salePrice: null,
    },
  ],
  onOpenProject: vi.fn(),
  onNewProject: vi.fn(),
  onNewModule: vi.fn(),
};

function renderDashboard(overrides: Partial<DashboardProps> = {}) {
  const onOpenProject = overrides.onOpenProject ?? vi.fn();
  const onNewProject = overrides.onNewProject ?? vi.fn();
  const onNewModule = overrides.onNewModule ?? vi.fn();
  const result = render(
    <Dashboard
      {...baseProps}
      {...overrides}
      onOpenProject={onOpenProject}
      onNewProject={onNewProject}
      onNewModule={onNewModule}
    />,
  );
  return { ...result, onOpenProject, onNewProject, onNewModule };
}

afterEach(() => {
  cleanup();
});

describe('Dashboard (F023)', () => {
  it('renders four stat cards with correct numbers', () => {
    renderDashboard();
    expect(screen.getByTestId('stat-active-projects').textContent).toContain('3');
    expect(screen.getByTestId('stat-monthly-quoted').textContent).toContain(
      '1250.50',
    );
    expect(screen.getByTestId('stat-modules').textContent).toContain('12');
    expect(screen.getByTestId('stat-materials').textContent).toContain('8');
    expect(screen.getByText('Proyectos activos')).toBeTruthy();
    expect(screen.getByText('Total cotizado del mes')).toBeTruthy();
    expect(screen.getByText('Módulos en catálogo')).toBeTruthy();
    expect(screen.getByText('Materiales activos')).toBeTruthy();
  });

  it('renders recent quotes and opens project on click', async () => {
    const user = userEvent.setup();
    const { onOpenProject } = renderDashboard();

    expect(screen.getByText('Cotizaciones recientes')).toBeTruthy();
    expect(screen.getByText('Cocina Ana')).toBeTruthy();
    expect(screen.getByText('Ana López')).toBeTruthy();
    expect(screen.getByText('202.50')).toBeTruthy();

    await user.click(screen.getByTestId('dashboard-recent-prj-1'));
    expect(onOpenProject).toHaveBeenCalledWith('prj-1');
  });

  it('fires quick actions', async () => {
    const user = userEvent.setup();
    const { onNewProject, onNewModule } = renderDashboard();

    await user.click(screen.getByTestId('dashboard-new-project'));
    expect(onNewProject).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId('dashboard-new-module'));
    expect(onNewModule).toHaveBeenCalledTimes(1);
  });

  it('shows empty message when there are no recent projects', () => {
    renderDashboard({ recentProjects: [] });
    expect(
      screen.getByText(/No hay cotizaciones todavía/i),
    ).toBeTruthy();
    expect(screen.queryByTestId('dashboard-recent-prj-1')).toBeNull();
  });

  it('uses 2-column stat grid on mobile (CSS contract)', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = dirname(fileURLToPath(import.meta.url));
    const text = readFileSync(join(here, 'dashboard.css'), 'utf8');
    expect(text).toContain('grid-template-columns: repeat(2, 1fr)');
    expect(text).toMatch(/repeat\(4,\s*1fr\)/);
    expect(text).toContain('prefers-reduced-motion');
  });
});
