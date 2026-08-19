// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { EngineeringScreen } from './EngineeringScreen';
import type { Project } from '@muebles/domain';
import type { EngineeringLog } from '@muebles/domain';

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
  revision: 2,
};

const logSent: EngineeringLog = {
  ...logDocumented,
  sentToProductionBy: 'u1',
  sentToProductionAt: '2026-08-03T09:00:00Z',
  revision: 3,
};

const mockProjects: ProjectWithCustomer[] = [
  {
    id: 'p1',
    name: 'Cocina Moderna',
    customerLabel: 'Cliente A',
    status: 'accepted',
    items: [],
    currency: 'MXN',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  } as unknown as ProjectWithCustomer,
  {
    id: 'p2',
    name: 'Placard Walk-in',
    customerLabel: 'Cliente B',
    status: 'accepted',
    items: [],
    currency: 'MXN',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    engineeringLog: logInProgress,
  } as unknown as ProjectWithCustomer,
  {
    id: 'p3',
    name: 'Escritorio Ejecutivo',
    status: 'accepted',
    items: [],
    currency: 'MXN',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    engineeringLog: logDocumented,
  } as unknown as ProjectWithCustomer,
];

describe('EngineeringScreen', () => {
  afterEach(cleanup);

  it('renders project list', () => {
    render(
      <EngineeringScreen
        projects={mockProjects}
        onStartEngineering={vi.fn()}
        onOpenProject={vi.fn()}
      />,
    );
    expect(screen.getByText('Cocina Moderna')).not.toBeNull();
    expect(screen.getByText('Placard Walk-in')).not.toBeNull();
    expect(screen.getByText('Escritorio Ejecutivo')).not.toBeNull();
  });

  it('shows engineering status badges', () => {
    render(
      <EngineeringScreen
        projects={mockProjects}
        onStartEngineering={vi.fn()}
        onOpenProject={vi.fn()}
      />,
    );
    // Each status appears twice: once as a filter button, once as a row badge.
    expect(screen.getAllByText('Pendiente').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('En proceso').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Documentado').length).toBeGreaterThanOrEqual(1);
  });

  it('filters by search', () => {
    render(
      <EngineeringScreen
        projects={mockProjects}
        onStartEngineering={vi.fn()}
        onOpenProject={vi.fn()}
      />,
    );
    const searchInput = screen.getByPlaceholderText('Buscar proyecto...');
    fireEvent.change(searchInput, { target: { value: 'Escritorio' } });
    expect(screen.queryByText('Cocina Moderna')).toBeNull();
    expect(screen.queryByText('Placard Walk-in')).toBeNull();
    expect(screen.getByText('Escritorio Ejecutivo')).not.toBeNull();
  });

  it('filters by status', () => {
    render(
      <EngineeringScreen
        projects={mockProjects}
        onStartEngineering={vi.fn()}
        onOpenProject={vi.fn()}
      />,
    );
    // Click the "Documentado" stat card to filter.
    const documentedButton = screen.getByTestId('eng-stat-documented');
    fireEvent.click(documentedButton);
    expect(screen.queryByText('Cocina Moderna')).toBeNull();
    expect(screen.queryByText('Placard Walk-in')).toBeNull();
    expect(screen.getByText('Escritorio Ejecutivo')).not.toBeNull();
  });

  it('"Iniciar ingeniería" button calls onStartEngineering', () => {
    const onStart = vi.fn();
    render(
      <EngineeringScreen
        projects={mockProjects}
        onStartEngineering={onStart}
        onOpenProject={vi.fn()}
      />,
    );
    const startBtn = screen.getByRole('button', { name: /Iniciar$/i });
    fireEvent.click(startBtn);
    expect(onStart).toHaveBeenCalledWith('p1');
  });

  it('clicking project row calls onOpenProject', () => {
    const onOpen = vi.fn();
    render(
      <EngineeringScreen
        projects={mockProjects}
        onStartEngineering={vi.fn()}
        onOpenProject={onOpen}
      />,
    );
    const row = screen.getByText('Placard Walk-in');
    fireEvent.click(row);
    expect(onOpen).toHaveBeenCalledWith('p2');
  });

  it('empty state when no projects', () => {
    render(
      <EngineeringScreen
        projects={[]}
        onStartEngineering={vi.fn()}
        onOpenProject={vi.fn()}
      />,
    );
    expect(screen.getByText('No hay obras para ingeniería')).not.toBeNull();
  });

  it('excludes drafts from the queue and moves sent works to "Enviadas"', () => {
    const projects: ProjectWithCustomer[] = [
      ...mockProjects,
      {
        id: 'draft1',
        name: 'Borrador',
        status: 'draft',
        items: [],
        currency: 'MXN',
        createdAt: '2026-08-01T00:00:00Z',
        updatedAt: '2026-08-01T00:00:00Z',
      } as unknown as ProjectWithCustomer,
      {
        id: 'sent1',
        name: 'Obra Enviada',
        customerLabel: 'Cliente C',
        status: 'produced',
        items: [],
        currency: 'MXN',
        createdAt: '2026-08-01T00:00:00Z',
        updatedAt: '2026-08-01T00:00:00Z',
        engineeringLog: logSent,
      } as unknown as ProjectWithCustomer,
    ];
    render(
      <EngineeringScreen
        projects={projects}
        onStartEngineering={vi.fn()}
        onOpenProject={vi.fn()}
      />,
    );
    // Draft never appears.
    expect(screen.queryByText('Borrador')).toBeNull();
    // Sent work is in the read-only section, not in the working queue stats
    // (3 queue projects: p1 pending, p2 in_progress, p3 documented).
    expect(screen.getByTestId('eng-sent-sent1')).not.toBeNull();
    expect(screen.getByText('En almacén')).not.toBeNull();
    expect(screen.getByTestId('eng-stat-pending').textContent).toContain('1');
  });
});


describe('F101 page chrome migration', () => {
  it('places Ingeniería search directly beneath the shared header', () => {
    render(
      <EngineeringScreen
        projects={mockProjects}
        onStartEngineering={vi.fn()}
        onOpenProject={vi.fn()}
      />,
    );
    const header = screen.getByTestId('page-header');
    const toolbar = screen.getByTestId('page-toolbar');
    expect(header.compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(header).getByRole('heading', { name: 'Ingeniería' })).toBeTruthy();
    expect(within(toolbar).getByRole('searchbox', { name: 'Buscar proyecto de ingeniería' })).toBeTruthy();
  });
});
