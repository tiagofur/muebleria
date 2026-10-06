// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { EngineeringDashboard } from './EngineeringDashboard';
import type { Project, EngineeringLog } from '@granete/domain';

type ProjectWithCustomer = Project & { readonly customerLabel?: string };

const logInProgress: EngineeringLog = {
  startedBy: 'u1',
  startedAt: '2026-08-01T10:00:00Z',
  revision: 1,
};

const logDocumented: EngineeringLog = {
  startedBy: 'u1',
  startedAt: '2026-08-01T10:00:00Z',
  generatedBy: 'u1',
  generatedAt: '2026-08-02T14:00:00Z',
  revision: 1,
};

const logSent: EngineeringLog = {
  startedBy: 'u2',
  startedAt: '2026-08-01T10:00:00Z',
  generatedBy: 'u2',
  generatedAt: '2026-08-02T14:00:00Z',
  sentToProductionBy: 'u2',
  sentToProductionAt: '2026-08-03T09:00:00Z',
  revision: 2,
};

const mockProjects: ProjectWithCustomer[] = [
  {
    id: 'p1',
    name: 'Cocina Moderna',
    customerLabel: 'Cliente A',
    status: 'accepted',
    hasDigitalThreadContext: false,
    items: [{ id: 'i1', moduleId: 'm1', quantity: 2, optionChoices: {} }],
    currency: 'MXN',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  } as unknown as ProjectWithCustomer,
  {
    id: 'p2',
    name: 'Placard Walk-in',
    customerLabel: 'Cliente B',
    status: 'accepted',
    hasDigitalThreadContext: false,
    items: [{ id: 'i2', moduleId: 'm2', quantity: 1, optionChoices: {} }],
    currency: 'MXN',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    engineeringLog: logInProgress,
  } as unknown as ProjectWithCustomer,
  {
    id: 'p3',
    name: 'Escritorio Ejecutivo',
    customerLabel: 'Cliente C',
    status: 'accepted',
    hasDigitalThreadContext: false,
    items: [{ id: 'i3', moduleId: 'm3', quantity: 1, optionChoices: {} }],
    currency: 'MXN',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    engineeringLog: logDocumented,
  } as unknown as ProjectWithCustomer,
  {
    id: 'p4',
    name: 'Mueble TV',
    customerLabel: 'Cliente D',
    status: 'produced',
    hasDigitalThreadContext: false,
    items: [{ id: 'i4', moduleId: 'm4', quantity: 1, optionChoices: {} }],
    currency: 'MXN',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    engineeringLog: logSent,
  } as unknown as ProjectWithCustomer,
];

const mockEngineers = [
  { id: 'u1', name: 'Carlos Ruiz' },
  { id: 'u2', name: 'María López' },
];

describe('EngineeringDashboard', () => {
  afterEach(cleanup);

  it('renders header, subtitle and button to work queue', () => {
    const onOpenQueue = vi.fn();
    render(
      <EngineeringDashboard
        projects={mockProjects}
        onOpenProject={vi.fn()}
        onOpenQueue={onOpenQueue}
        assignableEngineers={mockEngineers}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Dashboard de Ingeniería' })).not.toBeNull();
    const queueBtn = screen.getByTestId('eng-dash-goto-queue');
    fireEvent.click(queueBtn);
    expect(onOpenQueue).toHaveBeenCalledTimes(1);
  });

  it('renders the 4 KPI stat cards with calculated counts', () => {
    render(
      <EngineeringDashboard
        projects={mockProjects}
        onOpenProject={vi.fn()}
        onOpenQueue={vi.fn()}
        assignableEngineers={mockEngineers}
      />,
    );

    const pendingKpi = screen.getByTestId('eng-stat-kpi-pending');
    expect(within(pendingKpi).getByText('1')).not.toBeNull();
    expect(within(pendingKpi).getByText('En espera de inicio')).not.toBeNull();

    const inProgKpi = screen.getByTestId('eng-stat-kpi-in-progress');
    expect(within(inProgKpi).getByText('1')).not.toBeNull();

    const docKpi = screen.getByTestId('eng-stat-kpi-documented');
    expect(within(docKpi).getByText('1')).not.toBeNull();

    const sentKpi = screen.getByTestId('eng-stat-kpi-sent');
    expect(within(sentKpi).getByText('1')).not.toBeNull();
  });

  it('renders team workload summary', () => {
    render(
      <EngineeringDashboard
        projects={mockProjects}
        onOpenProject={vi.fn()}
        onOpenQueue={vi.fn()}
        assignableEngineers={mockEngineers}
      />,
    );

    const workloadPanel = screen.getByTestId('eng-workload-panel');
    expect(within(workloadPanel).getByText('Carlos Ruiz')).not.toBeNull();
    expect(within(workloadPanel).getByText('María López')).not.toBeNull();
  });

  it('filters project list by search query', () => {
    render(
      <EngineeringDashboard
        projects={mockProjects}
        onOpenProject={vi.fn()}
        onOpenQueue={vi.fn()}
        assignableEngineers={mockEngineers}
      />,
    );

    const searchInput = screen.getByPlaceholderText('Buscar por obra o cliente...');
    fireEvent.change(searchInput, { target: { value: 'Escritorio' } });

    expect(screen.queryByTestId('eng-row-p1')).toBeNull();
    expect(screen.getByTestId('eng-row-p3')).not.toBeNull();
  });

  it('clicking project table action calls onOpenProject', () => {
    const onOpen = vi.fn();
    render(
      <EngineeringDashboard
        projects={mockProjects}
        onOpenProject={onOpen}
        onOpenQueue={vi.fn()}
        assignableEngineers={mockEngineers}
      />,
    );

    const openBtns = screen.getAllByRole('button', { name: /Abrir/i });
    expect(openBtns.length).toBeGreaterThan(0);
    fireEvent.click(openBtns[0]!);
    expect(onOpen).toHaveBeenCalled();
  });
  // #1183 P0: sin packs el KPI muestra «—» con causa, nunca un v1.0 fabricado.
  it('marks the average-revision KPI as missing when no packs exist', () => {
    const noPacks = mockProjects.filter((p) => p.id === 'p1');
    render(
      <EngineeringDashboard
        projects={noPacks}
        onOpenProject={vi.fn()}
        onOpenQueue={vi.fn()}
      />,
    );
    const kpi = screen.getByText('Revisiones promedio').parentElement!;
    expect(kpi.textContent).toContain('—');
    expect(kpi.textContent).toContain('sin packs generados aún');
    expect(kpi.textContent).not.toContain('v1.0');
  });

  // #1183 P1: una obra sin log no inventa «Rev. 1».
  it('shows Rev. — for works without an engineering log', () => {
    render(
      <EngineeringDashboard
        projects={mockProjects}
        onOpenProject={vi.fn()}
        onOpenQueue={vi.fn()}
      />,
    );
    const p1Row = screen.getByTestId('eng-row-p1');
    expect(p1Row.textContent).toContain('Rev. —');
    // Con log real, la revisión del log se muestra tal cual.
    const p4Row = screen.getByTestId('eng-row-p4');
    expect(p4Row.textContent).toContain('Rev. 2');
  });

  // #1183 P2: el período filtra por el inicio real de ingeniería; las obras
  // sin log quedan fuera y se avisa, no se sustituye por createdAt.
  it('period filter uses the real engineering start and discloses exclusions', () => {
    render(
      <EngineeringDashboard
        projects={mockProjects}
        onOpenProject={vi.fn()}
        onOpenQueue={vi.fn()}
      />,
    );
    // p1 no tiene engineeringLog: con «Mes actual» queda fuera y se avisa.
    fireEvent.click(screen.getByRole('button', { name: 'Mes actual' }));
    expect(screen.queryByTestId('eng-row-p1')).toBeNull();
    expect(screen.getByTestId('eng-period-note').textContent).toContain(
      'sin inicio de ingeniería',
    );
    // Volver a «Todos los períodos» la restaura (y el aviso desaparece).
    fireEvent.click(screen.getByRole('button', { name: 'Todos los períodos' }));
    expect(screen.getByTestId('eng-row-p1')).not.toBeNull();
    expect(screen.queryByTestId('eng-period-note')).toBeNull();
  });

  // #1183 P3: salida honesta «Limpiar filtros» cuando nada coincide.
  it('offers to clear filters from the empty table state', () => {
    render(
      <EngineeringDashboard
        projects={mockProjects}
        onOpenProject={vi.fn()}
        onOpenQueue={vi.fn()}
      />,
    );
    fireEvent.change(
      screen.getByLabelText('Buscar en proyectos de ingeniería'),
      { target: { value: 'zzz-sin-coincidencia' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    expect(screen.getByTestId('eng-row-p1')).not.toBeNull();
    expect(
      (screen.getByLabelText('Buscar en proyectos de ingeniería') as HTMLInputElement).value,
    ).toBe('');
  });
});
