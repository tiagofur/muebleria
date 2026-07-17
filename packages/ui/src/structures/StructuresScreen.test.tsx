// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { StructuresScreen } from './StructuresScreen';
import type { Component, Structure } from '@muebles/domain';

const mockCatalogComponent: Component = {
  id: 'comp-costado',
  code: 'COM-COS-01',
  name: 'Costado Lateral',
  placement: 'lateral_izquierdo',
  geometry: {
    kind: 'rectangular_board',
    lengthMm: 720,
    widthMm: 560,
    thicknessMm: 18,
  },
  defaultEdges: [
    { side: 'L1', enabled: false },
    { side: 'L2', enabled: false },
    { side: 'W1', enabled: false },
    { side: 'W2', enabled: false },
  ],
  optionRoles: ['INTERIOR'],
  active: true,
};

const mockStructures: Structure[] = [
  {
    id: 's1',
    code: 'EST-GAB-720',
    name: 'Gabinete Bajo Estándar',
    notes: 'Estructura estándar de cocina para bajo mesada',
    active: true,
    externalDims: { width: 600, height: 720, depth: 560 },
    components: [{ componentId: 'comp-costado', quantity: 2 }],
  },
  {
    id: 's2',
    code: 'EST-ALTO-600',
    name: 'Alacena Estándar',
    notes: 'Estructura de colgar estándar',
    active: false,
    externalDims: { width: 600, height: 600, depth: 320 },
    components: [{ componentId: 'comp-costado', quantity: 2 }],
  },
];

function addCatalogComponentToDraft() {
  fireEvent.click(screen.getByTestId('structure-editor-tab-components'));
  fireEvent.click(screen.getByTestId('add-component-btn'));
  fireEvent.click(screen.getByTestId('comp-radio-COM-COS-01'));
  fireEvent.click(screen.getByTestId('confirm-add-component'));
}

describe('StructuresScreen', () => {
  afterEach(cleanup);

  it('renders list of active structures by default', () => {
    render(
      <StructuresScreen
        structures={mockStructures}
        optionGroups={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
      />
    );

    expect(screen.getByText('EST-GAB-720')).toBeTruthy();
    expect(screen.getByText('Gabinete Bajo Estándar')).toBeTruthy();
    // Default filters active only, so EST-ALTO-600 should not be rendered
    expect(screen.queryByText('EST-ALTO-600')).toBeNull();
  });

  it('renders empty state when there are no structures', () => {
    render(
      <StructuresScreen
        structures={[]}
        optionGroups={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
      />
    );

    expect(screen.getByText('Sin estructuras')).toBeTruthy();
  });

  it('opens modal and submits new structure draft', () => {
    const mockOptionGroups = [
      {
        id: 'og1',
        code: 'LATERAL',
        name: 'Lateral',
        kind: 'board' as const,
        active: true,
        required: false,
        optionIds: [],
        options: [],
      },
    ];

    const onCreate = vi.fn();
    render(
      <StructuresScreen
        structures={[]}
        optionGroups={mockOptionGroups}
        catalogComponents={[mockCatalogComponent]}
        onCreate={onCreate}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
      />
    );

    // Click on create structure button in empty state
    const newBtn = screen.getByRole('button', { name: /Crear estructura/i });
    fireEvent.click(newBtn);

    // Fill metadata
    fireEvent.change(screen.getByLabelText(/Código de Estructura/i), {
      target: { value: 'EST-TEST' },
    });
    fireEvent.change(screen.getByLabelText(/^Nombre$/i), {
      target: { value: 'Estructura de Test' },
    });
    fireEvent.change(screen.getByLabelText(/Ancho Externo \(mm\)/i), {
      target: { value: '600' },
    });
    fireEvent.change(screen.getByLabelText(/Alto Externo \(mm\)/i), {
      target: { value: '720' },
    });
    fireEvent.change(screen.getByLabelText(/Profundidad \(mm\)/i), {
      target: { value: '560' },
    });

    addCatalogComponentToDraft();

    // Submit
    fireEvent.click(screen.getByTestId('save-btn'));

    expect(onCreate).toHaveBeenCalledWith({
      code: 'EST-TEST',
      name: 'Estructura de Test',
      notes: '',
      widthMm: 600,
      heightMm: 720,
      depthMm: 560,
      active: true,
      presets: [],
      components: [{ componentId: 'comp-costado', quantity: 1 }],
    });
  });

  it('rejects save without at least one component', () => {
    const onCreate = vi.fn();
    render(
      <StructuresScreen
        structures={[]}
        optionGroups={[]}
        catalogComponents={[mockCatalogComponent]}
        onCreate={onCreate}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('create-structure-btn'));
    fireEvent.change(screen.getByTestId('input-code'), {
      target: { value: 'EST-EMPTY' },
    });
    fireEvent.change(screen.getByTestId('input-name'), {
      target: { value: 'Sin componentes' },
    });
    fireEvent.click(screen.getByTestId('save-btn'));

    expect(onCreate).not.toHaveBeenCalled();
    expect(
      screen.getByText(/al menos un componente/i),
    ).toBeTruthy();
  });

  it('filters by status chips', () => {
    render(
      <StructuresScreen
        structures={mockStructures}
        optionGroups={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
      />
    );

    expect(screen.queryByText('EST-ALTO-600')).toBeNull();

    // Click Inactivos
    fireEvent.click(screen.getByText('Inactivos'));

    expect(screen.queryByText('EST-GAB-720')).toBeNull();
    expect(screen.getByText('EST-ALTO-600')).toBeTruthy();
  });

  it('allows managing presets in modal', () => {
    const onCreate = vi.fn();
    render(
      <StructuresScreen
        structures={[]}
        optionGroups={[{ id: 'g-lateral', code: 'LATERAL', name: 'Grupo Lateral', kind: 'board', optionIds: [], required: false }]}
        catalogComponents={[mockCatalogComponent]}
        onCreate={onCreate}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
      />
    );

    // Click Nueva Estructura
    fireEvent.click(screen.getByTestId('create-structure-btn'));

    // Fill basic details
    fireEvent.change(screen.getByTestId('input-code'), { target: { value: 'EST-PRESETS' } });
    fireEvent.change(screen.getByTestId('input-name'), { target: { value: 'Estructura con Presets' } });

    // Switch to presets tab
    fireEvent.click(screen.getByTestId('structure-editor-tab-presets'));

    // Add preset
    fireEvent.click(screen.getByTestId('add-preset-btn'));
    expect(screen.getByTestId('preset-item-0')).toBeTruthy();

    fireEvent.change(screen.getByTestId('preset-name-0'), { target: { value: 'Ancho 300' } });
    fireEvent.change(screen.getByTestId('preset-width-0'), { target: { value: '300' } });
    fireEvent.change(screen.getByTestId('preset-height-0'), { target: { value: '720' } });
    fireEvent.change(screen.getByTestId('preset-depth-0'), { target: { value: '560' } });

    addCatalogComponentToDraft();

    // Submit
    fireEvent.click(screen.getByTestId('save-btn'));

    expect(onCreate).toHaveBeenCalledWith({
      code: 'EST-PRESETS',
      name: 'Estructura con Presets',
      notes: '',
      widthMm: 0,
      heightMm: 0,
      depthMm: 0,
      active: true,
      components: [{ componentId: 'comp-costado', quantity: 1 }],
      presets: [
        {
          id: expect.any(String),
          name: 'Ancho 300',
          width: 300,
          height: 720,
          depth: 560,
        },
      ],
    });
  });
});

