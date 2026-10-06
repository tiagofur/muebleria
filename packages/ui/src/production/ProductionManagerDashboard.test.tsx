// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Project } from '@granete/domain';
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
    hasDigitalThreadContext: false,
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
    hasDigitalThreadContext: false,
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
  it('discovers a draft project through canonical release authority only', async () => {
    const canonicalProject = {
      ...projects[0],
      id: 'canonical-draft',
      name: 'Canonical P1',
      status: 'draft',
      hasDigitalThreadContext: true,
      resolvedProductionRelease: {
        source: 'canonical',
        releaseId: 'release-p1',
        releaseNumber: 1,
        status: 'active',
      },
    } as Project;
    const unreleasedProject = {
      ...projects[0],
      id: 'unreleased-draft',
      name: 'No release',
      status: 'draft',
      hasDigitalThreadContext: true,
      resolvedProductionRelease: undefined,
    } as Project;

    render(
      <ProductionManagerDashboard
        projects={[canonicalProject, unreleasedProject]}
        repo={{
          getProductionDashboard: async () => metrics,
          getProductionActiveJobs: async () => [],
        }}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('pm-total-projects').textContent).toBe('1'),
    );
    expect(screen.getByTestId('pm-project-row-canonical-draft')).not.toBeNull();
    expect(screen.queryByTestId('pm-project-row-unreleased-draft')).toBeNull();
  });

  it('fails closed when a modern or stale payload lacks canonical authority', async () => {
    const modernWithoutRelease = {
      ...projects[0],
      id: 'modern-without-release',
      hasDigitalThreadContext: true,
      resolvedProductionRelease: undefined,
    } as Project;
    const stalePayload = {
      ...projects[0],
      id: 'stale-payload',
      hasDigitalThreadContext: undefined,
      resolvedProductionRelease: undefined,
    } as Project;

    render(
      <ProductionManagerDashboard
        projects={[modernWithoutRelease, stalePayload]}
        repo={{
          getProductionDashboard: async () => metrics,
          getProductionActiveJobs: async () => [],
        }}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('pm-total-projects').textContent).toBe('0'),
    );
    expect(
      screen.queryByTestId('pm-project-row-modern-without-release'),
    ).toBeNull();
    expect(screen.queryByTestId('pm-project-row-stale-payload')).toBeNull();
  });

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

  it('keeps dashboard icons decorative and aligned to the Lucide stroke contract', async () => {
    renderDashboard();

    await screen.findByRole('button', { name: 'Actualizar' });

    const icons = document.querySelectorAll('.pm-dashboard svg');
    expect(icons.length).toBeGreaterThan(0);
    icons.forEach((icon) => {
      expect(icon.getAttribute('stroke-width')).toBe('1.5');
      expect(icon.getAttribute('aria-hidden')).toBe('true');
    });
  });

  it('exposes toggle and sector selection states to keyboard and assistive tech', async () => {
    renderDashboard();

    const metricsToggle = await screen.findByRole('button', {
      name: 'Ver Métricas',
    });
    expect(metricsToggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(metricsToggle);
    expect(
      screen.getByRole('button', { name: 'Ocultar Métricas' }).getAttribute('aria-pressed'),
    ).toBe('true');

    const cutting = screen.getByRole('button', { name: /Corte/ });
    expect(cutting.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(cutting);
    expect(cutting.getAttribute('aria-pressed')).toBe('true');
  });

  it('announces a recoverable dashboard loading error', async () => {
    render(
      <ProductionManagerDashboard
        projects={projects}
        repo={{
          getProductionDashboard: async () => {
            throw new Error('Sin conexión');
          },
          getProductionActiveJobs: async () => [],
        }}
      />,
    );

    // #1173 P2: copy humano + detalle técnico secundario, no string crudo.
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('No pudimos cargar los datos');
    expect(alert.textContent).toContain('Sin conexión');
    expect(screen.getByRole('button', { name: 'Reintentar' })).not.toBeNull();
  });

  it('filters the obras table by sector with an exit back to «Todas» (#1173)', async () => {
    render(<ProductionManagerDashboard projects={projects} />);
    await screen.findByTestId('pm-sector-all');

    // Sin filtro: todas las obras.
    const allRows = screen.queryAllByTestId(/^pm-project-row-/);
    expect(allRows.length).toBe(projects.length);

    // Filtrar por Corte recorta la tabla (y el título lo contextualiza).
    fireEvent.click(screen.getByRole('button', { name: /Corte/ }));
    const cutRows = screen.queryAllByTestId(/^pm-project-row-/);
    expect(cutRows.length).toBeLessThan(projects.length);
    expect(screen.getByText('Proyectos en Corte')).not.toBeNull();

    // «Todas» restaura la lista completa.
    fireEvent.click(screen.getByTestId('pm-sector-all'));
    expect(screen.queryAllByTestId(/^pm-project-row-/).length).toBe(projects.length);
    expect(screen.getByText('Proyectos en Producción')).not.toBeNull();
  });

  it('marks missing server metrics as missing, not zero (#1173)', async () => {
    render(<ProductionManagerDashboard projects={projects} />);
    // Sin repo, «Completados Hoy» es «—» con causa visible, no un 0 fabricado.
    const completed = screen.getByText('Completados Hoy').parentElement!;
    expect(completed.textContent).toContain('—');
    expect(completed.textContent).toContain('sin registro del servidor');
  });
});
