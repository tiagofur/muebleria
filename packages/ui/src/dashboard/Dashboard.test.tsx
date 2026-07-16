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
  projectsCount: 2,
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
  onNewMaterial: vi.fn(),
};

describe('Dashboard loading (issue #30)', () => {
  it('shows PageLoading when loading is true', () => {
    render(
      <Dashboard
        {...baseProps}
        loading
        onOpenProject={vi.fn()}
        onNewProject={vi.fn()}
        onNewModule={vi.fn()}
      />,
    );
    expect(screen.getByTestId('dashboard-loading')).toBeTruthy();
    expect(screen.queryByText('Cocina Ana')).toBeNull();
  });
});

function renderDashboard(overrides: Partial<DashboardProps> = {}) {
  const onOpenProject = overrides.onOpenProject ?? vi.fn();
  const onNewProject = overrides.onNewProject ?? vi.fn();
  const onNewModule = overrides.onNewModule ?? vi.fn();
  const onNewMaterial = overrides.onNewMaterial ?? vi.fn();
  const result = render(
    <Dashboard
      {...baseProps}
      {...overrides}
      onOpenProject={onOpenProject}
      onNewProject={onNewProject}
      onNewModule={onNewModule}
      onNewMaterial={onNewMaterial}
    />,
  );
  return {
    ...result,
    onOpenProject,
    onNewProject,
    onNewModule,
    onNewMaterial,
  };
}

afterEach(() => {
  cleanup();
});

describe('Dashboard (F023)', () => {
  it('renders four stat cards with correct numbers', () => {
    renderDashboard();
    expect(screen.getByTestId('stat-active-projects').textContent).toContain('3');
    expect(screen.getByTestId('stat-monthly-quoted').textContent).toContain(
      '$1,250.50 MXN',
    );
    expect(
      screen.getByTestId('stat-monthly-quoted').className,
    ).toContain('dashboard-stat--emphasis');
    expect(screen.getByTestId('stat-modules').textContent).toContain('12');
    expect(screen.getByTestId('stat-materials').textContent).toContain('8');
    expect(screen.getByText('Cotizaciones activas')).toBeTruthy();
    expect(screen.getByText('Total cotizado del mes')).toBeTruthy();
    expect(screen.getByText('Muebles en catálogo')).toBeTruthy();
    expect(screen.getByText('Materiales activos')).toBeTruthy();
  });

  it('renders recent quotes and opens project on click', async () => {
    const user = userEvent.setup();
    const { onOpenProject } = renderDashboard();

    expect(screen.getByText('Cotizaciones recientes')).toBeTruthy();
    expect(screen.getByText('Cocina Ana')).toBeTruthy();
    expect(screen.getByText('Ana López')).toBeTruthy();
    expect(screen.getByText('$202.50 MXN')).toBeTruthy();

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

  it('shows EmptyState without second primary when there are no recent projects', () => {
    renderDashboard({ recentProjects: [] });
    const empty = screen.getByTestId('empty-state');
    expect(empty).toBeTruthy();
    expect(
      screen.getByText(/No hay cotizaciones todavía/i),
    ).toBeTruthy();
    expect(screen.queryByTestId('dashboard-recent-prj-1')).toBeNull();
    // Header keeps the only primary; EmptyState has no CTA (no dual primary).
    expect(empty.querySelector('button')).toBeNull();
    expect(screen.getByTestId('dashboard-new-project').className).toContain(
      'btn--primary',
    );
  });

  it('hides getting-started when workspace has modules or projects', () => {
    renderDashboard();
    expect(screen.queryByTestId('dashboard-getting-started')).toBeNull();
  });

  it('shows getting-started on empty workspace and fires CTAs', async () => {
    const user = userEvent.setup();
    const { onNewMaterial, onNewModule, onNewProject } = renderDashboard({
      stats: {
        activeProjects: 0,
        monthlyQuotedTotal: 0,
        modulesCount: 0,
        activeMaterials: 0,
      },
      projectsCount: 0,
      recentProjects: [],
    });

    expect(screen.getByTestId('dashboard-getting-started')).toBeTruthy();
    expect(screen.getByText('Primeros pasos')).toBeTruthy();
    expect(screen.getByTestId('getting-started-material-action')).toBeTruthy();
    expect(screen.getByTestId('getting-started-module-action')).toBeTruthy();
    expect(screen.getByTestId('getting-started-project-action')).toBeTruthy();

    // Empty-home focus: no zero stats / empty recent; header CTAs are not primary.
    expect(screen.queryByTestId('stat-active-projects')).toBeNull();
    expect(screen.queryByTestId('stat-materials')).toBeNull();
    expect(screen.queryByText(/No hay cotizaciones todavía/i)).toBeNull();
    expect(screen.getByTestId('dashboard-new-project').className).toContain(
      'btn--ghost',
    );
    expect(screen.getByTestId('dashboard-new-project').className).not.toContain(
      'btn--primary',
    );
    expect(
      screen.getByTestId('getting-started-material-action').className,
    ).toContain('btn--primary');

    await user.click(screen.getByTestId('getting-started-material-action'));
    expect(onNewMaterial).toHaveBeenCalledTimes(1);
    await user.click(screen.getByTestId('getting-started-module-action'));
    expect(onNewModule).toHaveBeenCalledTimes(1);
    await user.click(screen.getByTestId('getting-started-project-action'));
    expect(onNewProject).toHaveBeenCalledTimes(1);
  });

  it('marks material step done when materials exist but no modules/projects', () => {
    renderDashboard({
      stats: {
        activeProjects: 0,
        monthlyQuotedTotal: 0,
        modulesCount: 0,
        activeMaterials: 3,
      },
      projectsCount: 0,
      recentProjects: [],
    });
    expect(screen.getByTestId('dashboard-getting-started')).toBeTruthy();
    expect(screen.getByTestId('getting-started-material-done').textContent).toMatch(
      /3 materiales activos/,
    );
    expect(screen.queryByTestId('getting-started-material-action')).toBeNull();
    expect(screen.getByTestId('getting-started-module-action')).toBeTruthy();
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
