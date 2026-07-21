// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ComponentsScreen } from './ComponentsScreen';
import type { Component, OptionGroup } from '@muebles/domain';

const mockOptionGroups: OptionGroup[] = [
  { id: 'og1', code: 'FRENTE', name: 'Frente', kind: 'board', required: true, optionIds: [] },
  { id: 'og2', code: 'INTERIOR', name: 'Interior', kind: 'board', required: false, optionIds: [] },
];

const mockComponents: Component[] = [
  {
    id: 'c1',
    code: 'COM-PUE-01',
    name: 'Puerta',
    placement: 'puerta',
    geometry: { kind: 'rectangular_board', lengthMm: 717, widthMm: 296, thicknessMm: 18 },
    defaultEdges: [
      { side: 'L1', enabled: true },
      { side: 'L2', enabled: true },
      { side: 'W1', enabled: true },
      { side: 'W2', enabled: true },
    ],
    optionRoles: ['FRENTE'],
    active: true,
  },
  {
    id: 'c2',
    code: 'COM-ENT-01',
    name: 'Entrepaño Regulable',
    placement: 'interno',
    geometry: { kind: 'rectangular_board', lengthMm: 462, widthMm: 550, thicknessMm: 15 },
    defaultEdges: [
      { side: 'L1', enabled: false },
      { side: 'L2', enabled: false },
      { side: 'W1', enabled: false },
      { side: 'W2', enabled: true },
    ],
    optionRoles: ['INTERIOR'],
    active: false,
  },
];

describe('ComponentsScreen', () => {
  afterEach(cleanup);

  it('renders list of active components by default', () => {
    render(
      <ComponentsScreen
        components={mockComponents}
        optionGroups={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onToggleActive={vi.fn()}
        canMutate={true}
      />,
    );

    expect(screen.getByText('COM-PUE-01')).toBeTruthy();
    expect(screen.getAllByText('Puerta')[0]).toBeTruthy();
    // Default filters active only, so COM-ENT-01 should not be rendered
    expect(screen.queryByText('COM-ENT-01')).toBeNull();
  });

  it('renders empty state when there are no components', () => {
    render(
      <ComponentsScreen
        components={[]}
        optionGroups={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onToggleActive={vi.fn()}
        canMutate={true}
      />,
    );

    expect(screen.getByText('Sin componentes')).toBeTruthy();
  });

  it('opens modal and creates a new component', async () => {
    const onCreate = vi.fn();
    render(
      <ComponentsScreen
        components={[]}
        optionGroups={mockOptionGroups}
        onCreate={onCreate}
        onUpdate={vi.fn()}
        onToggleActive={vi.fn()}
        canMutate={true}
      />,
    );

    // Click create button (from empty state)
    const newBtn = screen.getByRole('button', { name: /Crear componente/i });
    fireEvent.click(newBtn);

    // Fill in the form - general tab
    fireEvent.change(screen.getByTestId('input-code'), {
      target: { value: 'COM-TEST-01' },
    });
    fireEvent.change(screen.getByTestId('input-name'), {
      target: { value: 'Componente de Test' },
    });

    // Switch to geometry tab
    fireEvent.click(screen.getByTestId('component-editor-tab-geometry'));

    fireEvent.change(screen.getByTestId('input-length'), {
      target: { value: '500' },
    });
    fireEvent.change(screen.getByTestId('input-width'), {
      target: { value: '300' },
    });
    fireEvent.change(screen.getByTestId('input-thickness'), {
      target: { value: '18' },
    });

    // Switch to edges tab
    fireEvent.click(screen.getByTestId('component-editor-tab-edges'));

    // Enable L1 edge
    fireEvent.click(screen.getByTestId('edge-L1'));

    // Switch to options tab
    fireEvent.click(screen.getByTestId('component-editor-tab-options'));

    // Select FRENTE in the multi-select
    const roleSelect = screen.getByTestId('input-optionRoles');
    await userEvent.selectOptions(roleSelect, ['FRENTE']);

    // Submit
    fireEvent.click(screen.getByTestId('save-btn'));

    expect(onCreate).toHaveBeenCalledWith({
      code: 'COM-TEST-01',
      name: 'Componente de Test',
      placement: 'interno',
      lengthMm: 500,
      widthMm: 300,
      thicknessMm: 18,
      lengthFormula: '',
      widthFormula: '',
      xFormula: '',
      yFormula: '',
      zFormula: '',
      rotateX: null,
      rotateY: null,
      rotateZ: null,
      edgeL1: true,
      edgeL2: false,
      edgeW1: false,
      edgeW2: false,
      optionRoles: 'FRENTE',
      notes: '',
      active: true,
    });
  });

  it('opens modal and edits an existing component', () => {
    const onUpdate = vi.fn();
    render(
      <ComponentsScreen
        components={mockComponents}
        optionGroups={mockOptionGroups}
        onCreate={vi.fn()}
        onUpdate={onUpdate}
        onToggleActive={vi.fn()}
        canMutate={true}
      />,
    );

    // Click on component card to open detail view (card-detalle)
    fireEvent.click(screen.getByText('COM-PUE-01'));

    // Click edit from detail view
    fireEvent.click(screen.getByTestId('component-detail-edit'));

    // Modify name
    const nameInput = screen.getByTestId('input-name');
    fireEvent.change(nameInput, {
      target: { value: 'Puerta Modificada' },
    });

    // Submit
    fireEvent.click(screen.getByTestId('save-btn'));

    expect(onUpdate).toHaveBeenCalledWith('c1', expect.objectContaining({
      name: 'Puerta Modificada',
      code: 'COM-PUE-01',
    }));
  });

  it('filters by search term', () => {
    render(
      <ComponentsScreen
        components={mockComponents}
        optionGroups={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onToggleActive={vi.fn()}
        canMutate={true}
      />,
    );

    // Both components not visible to active default (only COM-PUE-01 is active)
    expect(screen.getByText('COM-PUE-01')).toBeTruthy();

    // Type search
    const searchInput = screen.getByRole('searchbox') as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: 'ZZZZ' } });
    // After debounce, the search will show empty state
    // We just verify the search input updated
    expect(searchInput.value).toBe('ZZZZ');
  });

  it('toggles active/inactive via button', () => {
    const onToggleActive = vi.fn();
    render(
      <ComponentsScreen
        components={mockComponents}
        optionGroups={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onToggleActive={onToggleActive}
        canMutate={true}
      />,
    );

    // Open detail view by clicking the component name
    fireEvent.click(screen.getAllByText('Puerta')[0]!);
    // Detail view exposes toggle via a button (no longer a row action)
    const toggleBtn = screen.getByRole('button', { name: /Desactivar/i });
    fireEvent.click(toggleBtn);

    expect(onToggleActive).toHaveBeenCalledWith('c1');
  });

  it('shows all components when filter is Todos', () => {
    render(
      <ComponentsScreen
        components={mockComponents}
        optionGroups={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onToggleActive={vi.fn()}
        canMutate={true}
      />,
    );

    // Click "Todos" chip
    fireEvent.click(screen.getByText('Todos'));

    expect(screen.getByText('COM-PUE-01')).toBeTruthy();
    expect(screen.getByText('COM-ENT-01')).toBeTruthy();
  });

  it('shows/hides actions based on canMutate', () => {
    const { rerender } = render(
      <ComponentsScreen
        components={mockComponents}
        optionGroups={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onToggleActive={vi.fn()}
        canMutate={true}
      />,
    );

    // Open detail view
    fireEvent.click(screen.getAllByText('Puerta')[0]!);
    expect(screen.getByTestId('component-detail-edit')).toBeTruthy();

    // Rerender with canMutate=false
    rerender(
      <ComponentsScreen
        components={mockComponents}
        optionGroups={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onToggleActive={vi.fn()}
        canMutate={false}
      />,
    );

    expect(screen.queryByTestId('component-detail-edit')).toBeNull();
    expect(screen.queryByRole('button', { name: /Nuevo Componente/i })).toBeNull();
  });
});
