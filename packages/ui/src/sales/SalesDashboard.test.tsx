// @vitest-environment jsdom
/**
 * SalesDashboard tests.
 *
 * Verifies monthly stats, pipeline, client rankings, project list, and alerts.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SalesDashboard } from './SalesDashboard';
import type { Project, ProjectStatus } from '@muebles/domain';

/* ── Helpers ────────────────────────────────────────────────────────────── */

function makeProject(
  overrides: Partial<Project> & { readonly id: string; readonly name: string },
): Project {
  return {
    id: overrides.id,
    name: overrides.name,
    status: overrides.status ?? ('draft' as ProjectStatus),
    customerId: overrides.customerId ?? 'cust-1',
    createdAt: overrides.createdAt ?? '2026-01-15T10:00:00Z',
    updatedAt: overrides.updatedAt ?? '2026-08-10T14:30:00Z',
    currency: 'MXN',
    marginFactor: 1,
    laborFixedCost: 0,
    items: [],
    ...(overrides.priceSnapshot !== undefined
      ? { priceSnapshot: overrides.priceSnapshot }
      : {}),
  } as Project;
}

/* ── Tests ──────────────────────────────────────────────────────────────── */

describe('SalesDashboard', () => {
  afterEach(cleanup);

  it('shows empty state when no projects', () => {
    render(
      <SalesDashboard projects={[]} onOpenProject={vi.fn()} />,
    );

    expect(screen.getByText('Sin proyectos')).toBeDefined();
  });

  it('renders monthly stats section', () => {
    const projects = [
      makeProject({ id: 'p1', name: 'Cocina A', status: 'quoted' }),
      makeProject({ id: 'p2', name: 'Cocina B', status: 'accepted' }),
    ];

    render(<SalesDashboard projects={projects} onOpenProject={vi.fn()} />);

    expect(screen.getByText('Resumen de Ventas')).toBeDefined();
    expect(screen.getByText('Este mes')).toBeDefined();
    expect(screen.getByText('Totales')).toBeDefined();
  });

  it('renders client rankings', () => {
    const projects = [
      makeProject({ id: 'p1', name: 'A', status: 'quoted', customerId: 'c1' }),
      makeProject({ id: 'p2', name: 'B', status: 'accepted', customerId: 'c1' }),
      makeProject({ id: 'p3', name: 'C', status: 'produced', customerId: 'c2' }),
    ];

    render(<SalesDashboard projects={projects} onOpenProject={vi.fn()} />);

    expect(screen.getByText('Top clientes por valor')).toBeDefined();
    expect(screen.getByText('Top clientes por proyectos')).toBeDefined();
  });

  it('renders project list', () => {
    const projects = [
      makeProject({ id: 'p1', name: 'Cocina Moderna', status: 'quoted' }),
      makeProject({ id: 'p2', name: 'Estudio Executive', status: 'accepted' }),
    ];

    render(<SalesDashboard projects={projects} onOpenProject={vi.fn()} />);

    expect(screen.getByText('Cocina Moderna')).toBeDefined();
    expect(screen.getByText('Estudio Executive')).toBeDefined();
    expect(screen.getByText('Todos los proyectos')).toBeDefined();
  });

  it('calls onOpenProject when project row is clicked', () => {
    const onOpen = vi.fn();
    const projects = [
      makeProject({ id: 'p1', name: 'Test Project', status: 'quoted' }),
    ];

    render(<SalesDashboard projects={projects} onOpenProject={onOpen} />);

    const buttons = screen.getAllByRole('button');
    const projectButton = buttons.find((btn) =>
      btn.textContent?.includes('Test Project'),
    );

    expect(projectButton).toBeDefined();
    fireEvent.click(projectButton!);

    expect(onOpen).toHaveBeenCalledWith('p1');
  });

  it('shows alerts for old quotes (>7 days)', () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 10);

    const projects = [
      makeProject({
        id: 'p1',
        name: 'Old Quote',
        status: 'quoted',
        updatedAt: oldDate.toISOString(),
      }),
    ];

    render(<SalesDashboard projects={projects} onOpenProject={vi.fn()} />);

    expect(screen.getByText('Alertas')).toBeDefined();
    expect(screen.getByText(/sin respuesta/)).toBeDefined();
  });

  it('does not show alerts for recent quotes', () => {
    const projects = [
      makeProject({
        id: 'p1',
        name: 'Fresh Quote',
        status: 'quoted',
        updatedAt: new Date().toISOString(),
      }),
    ];

    render(<SalesDashboard projects={projects} onOpenProject={vi.fn()} />);

    expect(screen.queryByText('Alertas')).toBeNull();
  });

  it('renders pipeline bar when projects exist', () => {
    const projects = [
      makeProject({ id: 'p1', name: 'A', status: 'quoted' }),
      makeProject({ id: 'p2', name: 'B', status: 'accepted' }),
    ];

    render(<SalesDashboard projects={projects} onOpenProject={vi.fn()} />);

    expect(screen.getByLabelText('Pipeline de ventas')).toBeDefined();
  });

  it('does not render pipeline bar when no projects', () => {
    render(<SalesDashboard projects={[]} onOpenProject={vi.fn()} />);

    expect(screen.queryByLabelText('Pipeline de ventas')).toBeNull();
  });

  it('shows vendedor subtitle when isVendedor is true', () => {
    const projects = [
      makeProject({ id: 'p1', name: 'X', status: 'draft' }),
    ];

    render(
      <SalesDashboard
        projects={projects}
        onOpenProject={vi.fn()}
        isVendedor={true}
      />,
    );

    expect(screen.getByText('Tus estadísticas y proyectos del mes.')).toBeDefined();
    expect(screen.getByText('Mis proyectos')).toBeDefined();
  });

  it('shows team subtitle when isVendedor is false', () => {
    const projects = [
      makeProject({ id: 'p1', name: 'X', status: 'draft' }),
    ];

    render(
      <SalesDashboard
        projects={projects}
        onOpenProject={vi.fn()}
        isVendedor={false}
      />,
    );

    expect(screen.getByText('Pipeline comercial y estadísticas del equipo.')).toBeDefined();
    expect(screen.getByText('Todos los proyectos')).toBeDefined();
  });

  it('shows client with multiple projects in rankings', () => {
    const projects = [
      makeProject({ id: 'p1', name: 'A', status: 'quoted', customerId: 'c1' }),
      makeProject({ id: 'p2', name: 'B', status: 'accepted', customerId: 'c1' }),
      makeProject({ id: 'p3', name: 'C', status: 'produced', customerId: 'c1' }),
      makeProject({ id: 'p4', name: 'D', status: 'quoted', customerId: 'c2' }),
    ];

    render(<SalesDashboard projects={projects} onOpenProject={vi.fn()} />);

    // Client c1 should appear in rankings with 3 projects
    const rankings = screen.getAllByText(/3 proyectos/);
    expect(rankings.length).toBeGreaterThanOrEqual(1);
  });
});
