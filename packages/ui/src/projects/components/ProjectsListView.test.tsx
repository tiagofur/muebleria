/**
 * #710 — orientation + filter recovery in the quotes list.
 * Focused acceptance suite for the results summary row and "Limpiar filtros"
 * with visible results. Commercial dataset authority (#642 / 2A) is asserted
 * as preserved, not re-specified here.
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import type { Customer, Project } from '@granete/domain';
import type { ProjectCommercialSummary } from '@granete/storage';
import { ProjectsListView } from './ProjectsListView';

const customers: Customer[] = [
  { id: 'cust-ana', name: 'Ana López', phone: '+52 1', active: true },
  { id: 'cust-bruno', name: 'Bruno', phone: '+52 2', active: true },
];

const projects: Project[] = [
  {
    id: 'prj-1',
    name: 'Cocina Ana',
    customerId: 'cust-ana',
    currency: 'MXN',
    marginFactor: 1.35,
    laborFixedCost: 0,
    status: 'draft',
    items: [],
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z',
  },
  {
    id: 'prj-2',
    name: 'Dormitorio',
    customerId: 'cust-bruno',
    currency: 'MXN',
    marginFactor: 1.4,
    laborFixedCost: 0,
    status: 'quoted',
    items: [],
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-13T00:00:00.000Z',
  },
];

function summaryFor(overrides: Partial<ProjectCommercialSummary>): ProjectCommercialSummary {
  return {
    projectId: 'prj-1',
    projectName: 'Cocina Ana',
    quoteStatus: 'draft',
    quoteRevisionNumber: 1,
    isLegacy: false,
    furnitureQuantity: 1,
    saleTotal: 202.5,
    currency: 'MXN',
    commercialActivityAt: '2026-07-12T00:00:00.000Z',
    ...overrides,
  };
}

const commercialSummaries: ReadonlyMap<string, ProjectCommercialSummary> = new Map([
  ['prj-1', summaryFor({})],
  ['prj-2', summaryFor({
    projectId: 'prj-2',
    projectName: 'Dormitorio',
    quoteStatus: 'published',
  })],
]);

function renderView(props: Partial<ComponentProps<typeof ProjectsListView>> = {}) {
  const onClearFilters = vi.fn();
  const onNewProject = vi.fn();
  const onFromTemplate = vi.fn();
  const onManageTemplates = vi.fn();
  const onOpenProject = vi.fn();
  const baseProps: ComponentProps<typeof ProjectsListView> = {
    projects,
    filtered: projects,
    customers,
    projectTemplates: undefined,
    search: '',
    statusFilter: 'all',
    commercialSummaries,
    commercialSummariesStatus: 'ready',
    commercialFiltersDisabled: false,
    isTrulyEmpty: false,
    isFilterEmpty: false,
    canMutate: true,
    hasCreateFromTemplate: false,
    hasDeleteTemplate: false,
    onSearchChange: vi.fn(),
    onStatusFilterChange: vi.fn(),
    onClearFilters,
    onNewProject,
    onFromTemplate,
    onManageTemplates,
    onOpenProject,
  };
  const result = render(<ProjectsListView {...baseProps} {...props} />);
  const rerenderWith = (next: Partial<ComponentProps<typeof ProjectsListView>>) => {
    result.rerender(<ProjectsListView {...baseProps} {...next} />);
  };
  return {
    ...result,
    rerenderWith,
    onClearFilters,
    onNewProject,
    onFromTemplate,
    onManageTemplates,
    onOpenProject,
  };
}

afterEach(() => {
  cleanup();
});

describe('#710 visible results summary + clear filters (ProjectsListView)', () => {
  it('1. full set: correct counter, plural and no clear action without filters', () => {
    renderView();

    expect(screen.getByTestId('projects-results-summary').textContent).toBe(
      'Mostrando 2 de 2 cotizaciones',
    );
    expect(screen.queryByRole('button', { name: 'Limpiar filtros' })).toBeNull();
  });

  it('1b. full set of one: singular noun', () => {
    renderView({ projects: [projects[0]!], filtered: [projects[0]!] });

    expect(screen.getByTestId('projects-results-summary').textContent).toBe(
      'Mostrando 1 de 1 cotización',
    );
    expect(screen.queryByRole('button', { name: 'Limpiar filtros' })).toBeNull();
  });

  it('2. search subset: counter derives from filtered and clear is offered with results', async () => {
    const user = userEvent.setup();
    const { onClearFilters } = renderView({
      search: 'Cocina',
      filtered: [projects[0]!],
    });

    expect(screen.getByTestId('projects-results-summary').textContent).toBe(
      'Mostrando 1 de 2 cotizaciones',
    );
    expect(screen.getByTestId('project-card-prj-1')).toBeTruthy();
    expect(screen.queryByTestId('project-card-prj-2')).toBeNull();

    await user.click(screen.getByTestId('projects-clear-filters'));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it('3. status filter without search text still offers the clear action', () => {
    renderView({ statusFilter: 'draft', filtered: [projects[0]!] });

    expect(screen.getByTestId('projects-results-summary').textContent).toBe(
      'Mostrando 1 de 2 cotizaciones',
    );
    expect(screen.getByTestId('projects-clear-filters')).toBeTruthy();
  });

  it('4. debounce transition: counter follows filtered, never the live search text', () => {
    const { rerenderWith } = renderView({
      search: 'Cocina',
      filtered: [projects[0]!],
    });

    // User emptied the searchbox; filtered still holds the previous subset.
    rerenderWith({ search: '', filtered: [projects[0]!] });
    expect(screen.getByTestId('projects-results-summary').textContent).toBe(
      'Mostrando 1 de 2 cotizaciones',
    );
    // Restricted results still on screen → recovery action must survive.
    expect(screen.getByTestId('projects-clear-filters')).toBeTruthy();

    // Debounce delivers the full set: counter updates and the action retires.
    rerenderWith({ search: '', filtered: projects });
    expect(screen.getByTestId('projects-results-summary').textContent).toBe(
      'Mostrando 2 de 2 cotizaciones',
    );
    expect(screen.queryByTestId('projects-clear-filters')).toBeNull();

    // New search typed, full set still rendered: counter does not run ahead.
    rerenderWith({ search: 'Dormitorio', filtered: projects });
    expect(screen.getByTestId('projects-results-summary').textContent).toBe(
      'Mostrando 2 de 2 cotizaciones',
    );
    expect(screen.getByTestId('projects-clear-filters')).toBeTruthy();
  });

  it('5. zero matches: single clear action and preserved empty state', async () => {
    const user = userEvent.setup();
    const { onClearFilters } = renderView({
      search: 'inexistente',
      filtered: [],
      isFilterEmpty: true,
    });

    expect(screen.getByTestId('empty-state-no-results')).toBeTruthy();
    expect(screen.queryByTestId('projects-clear-filters')).toBeNull();
    // Exactly one visible recovery action: the EmptyState one.
    const clearButtons = screen.getAllByRole('button', { name: 'Limpiar filtros' });
    expect(clearButtons.length).toBe(1);
    await user.click(clearButtons[0]!);
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it('6. truly empty list: authorized create actions only, no summary nor clear', () => {
    renderView({
      projects: [],
      filtered: [],
      isTrulyEmpty: true,
      isFilterEmpty: false,
    });

    expect(screen.getByTestId('empty-state')).toBeTruthy();
    expect(screen.getByText('No hay cotizaciones')).toBeTruthy();
    expect(screen.queryByTestId('projects-results-summary')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Limpiar filtros' })).toBeNull();
    // Header + EmptyState CTAs are the pre-existing authorized create actions.
    expect(screen.getAllByRole('button', { name: 'Nueva cotización' }).length).toBe(2);
  });

  it('7. read-only: can clear filters but gets no create action', async () => {
    const user = userEvent.setup();
    const { onClearFilters } = renderView({
      search: 'Cocina',
      filtered: [projects[0]!],
      canMutate: false,
    });

    await user.click(screen.getByTestId('projects-clear-filters'));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Nueva cotización' })).toBeNull();
  });

  it('8. commercial error keeps banner + retry; the summary describes navigation only', async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    const view = renderView({
      commercialSummariesStatus: 'error',
      commercialSummariesError: 'boom',
      onRetryCommercialSummaries: retry,
    });

    expect(view.getByTestId('commercial-summaries-error')).toBeTruthy();
    expect(screen.getAllByTestId('commercial-status-badge-error').length).toBe(2);
    // The row coexists with the banner — it never replaces the error state.
    expect(screen.getByTestId('projects-results-summary').textContent).toBe(
      'Mostrando 2 de 2 cotizaciones',
    );

    await user.click(view.getByRole('button', { name: 'Reintentar' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('8b. commercial loading keeps pending badges; the summary still counts cards', () => {
    renderView({
      commercialSummaries: undefined,
      commercialSummariesStatus: 'loading',
      commercialFiltersDisabled: true,
    });

    expect(screen.getAllByTestId('commercial-status-badge-loading').length).toBe(2);
    expect(screen.getByTestId('projects-results-summary').textContent).toBe(
      'Mostrando 2 de 2 cotizaciones',
    );
  });

  it('9. clearing never triggers navigation, creation or template actions', async () => {
    const user = userEvent.setup();
    const spies = renderView({
      search: 'Cocina',
      statusFilter: 'draft',
      filtered: [projects[0]!],
    });

    await user.click(screen.getByTestId('projects-clear-filters'));

    expect(spies.onClearFilters).toHaveBeenCalledTimes(1);
    expect(spies.onNewProject).not.toHaveBeenCalled();
    expect(spies.onOpenProject).not.toHaveBeenCalled();
    expect(spies.onFromTemplate).not.toHaveBeenCalled();
    expect(spies.onManageTemplates).not.toHaveBeenCalled();
  });

  it('keyboard: Enter activates the row clear action', async () => {
    const user = userEvent.setup();
    const { onClearFilters } = renderView({
      search: 'Cocina',
      filtered: [projects[0]!],
    });

    screen.getByTestId('projects-clear-filters').focus();
    await user.keyboard('{Enter}');
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it('cards grid stays intact: one card per project, revisions/furniture never counted', () => {
    renderView({ search: 'Cocina', filtered: [projects[0]!] });

    const grid = screen.getByLabelText('Lista de cotizaciones');
    const cards = within(grid).getAllByRole('button');
    // Only the visible card button (no extra card-level actions added).
    expect(cards.length).toBe(1);
    expect(screen.getByTestId('projects-results-summary').textContent).toContain('1 de 2');
  });
});
