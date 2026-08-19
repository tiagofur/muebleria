/**
 * F105 — Page chrome composition: Ventas y Trabajo screens render through the
 * shared PageHeader/PageToolbar skeleton (docs/design.md §4.1a).
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Project } from '@muebles/domain';
import { Dashboard, type DashboardProps } from '../dashboard/Dashboard';
import { PlantBoardScreen } from '../production/PlantBoardScreen';
import { SalesDashboard } from './SalesDashboard';
import { ShowcaseScreen } from '../showcase/ShowcaseScreen';

afterEach(cleanup);

function expectSharedHeader(title: string, primaryLabel?: string): void {
  const header = screen.getByTestId('page-header');
  expect(
    within(header).getAllByRole('heading', { level: 2 }).map((h) => h.textContent),
  ).toEqual([title]);
  expect(header.querySelector('.page-header__icon svg')).not.toBeNull();
  const primaries = header.querySelectorAll('.btn--primary');
  if (primaryLabel) {
    expect(primaries).toHaveLength(1);
    expect(primaries[0]?.textContent).toContain(primaryLabel);
  } else {
    expect(primaries).toHaveLength(0);
  }
}

const baseDashboard: DashboardProps = {
  stats: {
    activeProjects: 1,
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
  ],
  onOpenProject: vi.fn(),
  onNewProject: vi.fn(),
  onNewModule: vi.fn(),
};

const sampleProject = {
  id: 'p1',
  name: 'Cocina Ana',
  status: 'quoted',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-12T00:00:00.000Z',
  items: [],
} as unknown as Project;

describe('F105 page chrome — Ventas y Trabajo', () => {
  it('Inicio renders shared header with one solid primary and quick action secondary', () => {
    render(<Dashboard {...baseDashboard} />);
    expectSharedHeader('Inicio', 'Nueva cotización');
    const header = screen.getByTestId('page-header');
    const quick = within(header).getByTestId('dashboard-new-module');
    // Gramática §4.1a: quick action es secundaria (.btn base), no compite.
    expect(quick.className).toBe('btn');
    expect(screen.queryByTestId('page-toolbar')).toBeNull();
  });

  it('Inicio empty workspace demotes the header primary to ghost (checklist owns it)', () => {
    render(
      <Dashboard
        {...baseDashboard}
        stats={{
          activeProjects: 0,
          monthlyQuotedTotal: 0,
          modulesCount: 0,
          activeMaterials: 0,
        }}
        projectsCount={0}
        recentProjects={[]}
        onNewMaterial={vi.fn()}
      />,
    );
    const header = screen.getByTestId('page-header');
    expect(header.querySelectorAll('.btn--primary')).toHaveLength(0);
    expect(within(header).getByTestId('dashboard-new-project').className).toContain(
      'btn--ghost',
    );
    expect(screen.getByTestId('dashboard-getting-started')).toBeDefined();
  });

  it('Dashboard de Ventas renders shared header with pipeline context and filter toolbar', () => {
    render(
      <SalesDashboard
        projects={[sampleProject]}
        onOpenProject={vi.fn()}
        onCancelProject={vi.fn()}
        vendedores={[{ id: 'v1', name: 'Ana' }]}
        currentUserId="v1"
      />,
    );
    expectSharedHeader('Dashboard de Ventas');
    expect(
      screen.getByRole('heading', { level: 2, name: 'Dashboard de Ventas' }),
    ).toBeDefined();
    const toolbar = screen.getByTestId('page-toolbar');
    expect(within(toolbar).getByLabelText('Vendedor:')).toBeDefined();
  });

  it('Estado de Planta renders read-only shared header without primary', () => {
    const project = {
      id: 'p1',
      name: 'Obra',
      status: 'accepted',
      items: [],
    } as unknown as Project;
    render(<PlantBoardScreen projects={[project]} />);
    expectSharedHeader('Estado de Planta');
  });

  it('Vitrina renders shared header with nav-label title and tab toolbar', () => {
    render(<ShowcaseScreen photos={[]} modules={[]} />);
    expectSharedHeader('Vitrina');
    const toolbar = screen.getByTestId('page-toolbar');
    expect(
      within(toolbar).getByRole('tablist', { name: 'Vistas de la Vitrina Comercial' }),
    ).toBeDefined();
    // Tab content (módulos) aporta su propia toolbar de búsqueda sin título.
    fireEvent.click(within(toolbar).getByTestId('showcase-tab-modules'));
    const toolbars = screen.getAllByTestId('page-toolbar');
    expect(
      toolbars.some((t) => within(t).queryByRole('searchbox') !== null),
    ).toBe(true);
    expect(screen.queryAllByTestId('page-header')).toHaveLength(1);
  });
});
