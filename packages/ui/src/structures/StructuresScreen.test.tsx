// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StructuresScreen } from './StructuresScreen';
import type { Component, Structure } from '@granete/domain';

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
      agregados: [],
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
      agregados: [],
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

  it('#108: shows revision badge normalized to Rev 1 for legacy structures', () => {
    render(
      <StructuresScreen
        structures={mockStructures}
        optionGroups={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
      />,
    );

    // mockStructures[0] has no explicit revision; the badge must normalize to 1.
    const badge = screen.getByTestId('structure-revision-EST-GAB-720');
    expect(badge.textContent).toBe('Rev 1');
  });

  it('renders 3D preview tab in structure editor', () => {
    render(
      <StructuresScreen
        structures={mockStructures}
        optionGroups={[]}
        catalogComponents={[mockCatalogComponent]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
      />
    );

    // Click on create structure button
    fireEvent.click(screen.getByTestId('create-structure-btn'));

    // Critique: no separate Vista 3D tab — live 3D lives on Componentes
    expect(screen.queryByTestId('structure-editor-tab-preview3d')).toBeNull();
    fireEvent.click(screen.getByTestId('structure-editor-tab-components'));
    expect(screen.getByTestId('structure-editor-panel-components')).toBeTruthy();
    // Empty body badge + empty CTA
    expect(
      screen
        .getByTestId('structure-editor-tab-components')
        .querySelector('.tabs__alert'),
    ).toBeTruthy();
    expect(screen.getByTestId('components-empty')).toBeTruthy();
  });

  it('critique: tab order General → Componentes → Agregados → Presets; save jumps to components', () => {
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
      />,
    );

    fireEvent.click(screen.getByTestId('create-structure-btn'));
    const tabs = screen.getByTestId('structure-editor-tablist');
    const tabButtons = tabs.querySelectorAll('[role="tab"]');
    expect(tabButtons[0]?.getAttribute('data-testid')).toBe(
      'structure-editor-tab-general',
    );
    expect(tabButtons[1]?.getAttribute('data-testid')).toBe(
      'structure-editor-tab-components',
    );
    expect(tabButtons[2]?.getAttribute('data-testid')).toBe(
      'structure-editor-tab-agregados',
    );
    expect(tabButtons[3]?.getAttribute('data-testid')).toBe(
      'structure-editor-tab-presets',
    );

    fireEvent.change(screen.getByTestId('input-code'), {
      target: { value: 'EST-X' },
    });
    fireEvent.change(screen.getByTestId('input-name'), {
      target: { value: 'Sin piezas' },
    });
    fireEvent.click(screen.getByTestId('save-btn'));
    expect(screen.getByTestId('form-error').textContent).toMatch(/componente/i);
    expect(screen.getByTestId('structure-editor-panel-components').hidden).toBe(
      false,
    );
  });

  it('F109: structure editor uses WorkspaceTabs (tablist contract + roving arrows)', async () => {
    const user = userEvent.setup();
    render(
      <StructuresScreen
        structures={[]}
        optionGroups={[]}
        catalogComponents={[mockCatalogComponent]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId('create-structure-btn'));

    const tablist = screen.getByTestId('structure-editor-tablist');
    expect(tablist.getAttribute('role')).toBe('tablist');

    const general = screen.getByTestId('structure-editor-tab-general');
    expect(general.getAttribute('role')).toBe('tab');
    expect(general.getAttribute('aria-controls')).toBe(
      'structure-editor-panel-general',
    );
    const panel = screen.getByTestId('structure-editor-panel-general');
    expect(panel.getAttribute('role')).toBe('tabpanel');
    expect(panel.getAttribute('aria-labelledby')).toBe(
      'structure-editor-tab-general',
    );

    // Empty components → "!" alert with tooltip.
    const components = screen.getByTestId('structure-editor-tab-components');
    expect(components.querySelector('.tabs__alert')).toBeTruthy();
    expect(components.getAttribute('title')).toBe(
      'Agregá al menos un componente',
    );

    // Arrow-key roving: selection + focus move together.
    general.focus();
    await user.keyboard('{ArrowRight}');
    expect(components.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(components);
  });

  it('critique: preset labeled fields and exterior hint on general', () => {
    render(
      <StructuresScreen
        structures={[]}
        optionGroups={[]}
        catalogComponents={[mockCatalogComponent]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('create-structure-btn'));
    expect(screen.getByTestId('structure-exterior-hint').textContent).toMatch(
      /referencia del cuerpo/i,
    );

    fireEvent.click(screen.getByTestId('structure-editor-tab-presets'));
    fireEvent.click(screen.getByTestId('add-preset-btn'));
    expect(screen.getByTestId('preset-width-0')).toBeTruthy();
    expect(screen.getByTestId('preset-height-0')).toBeTruthy();
    expect(screen.getByLabelText(/^Ancho \(mm\)$/i)).toBeTruthy();
  });

  it('detail workspace shows exterior metric, components and history disclosure', () => {
    render(
      <StructuresScreen
        structures={mockStructures}
        optionGroups={[]}
        catalogComponents={[mockCatalogComponent]}
        catalogMaterials={[]}
        catalogEdges={[]}
        catalogHardware={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('EST-GAB-720'));
    expect(screen.getByTestId('structure-detail')).toBeTruthy();
    expect(screen.getByTestId('structure-detail-metric').textContent).toMatch(
      /600/,
    );
    expect(screen.getByTestId('structure-detail-dims')).toBeTruthy();
    expect(screen.getByTestId('structure-detail-components').textContent).toMatch(
      /COM-COS-01|Costado/,
    );
    expect(screen.getByTestId('structure-detail-history')).toBeTruthy();
    expect(screen.getByTestId('structure-detail-notes').textContent).toMatch(
      /bajo mesada/i,
    );
  });

  it('shows a Vista 3D button in the detail that opens the 3D modal', () => {
    render(
      <StructuresScreen
        structures={mockStructures}
        optionGroups={[]}
        catalogComponents={[mockCatalogComponent]}
        catalogMaterials={[]}
        catalogEdges={[]}
        catalogHardware={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
      />,
    );

    // Click on the structure card summary to open the detail view.
    fireEvent.click(screen.getByText('EST-GAB-720'));

    // The detail chrome exposes a "Vista 3D" button (read-only, no edit needed).
    const view3DBtn = screen.getByTestId('structure-detail-view-3d');
    expect(view3DBtn).toBeTruthy();

    // Clicking it opens the 3D modal.
    fireEvent.click(view3DBtn);
    expect(screen.getByTestId('structure-3d-modal')).toBeTruthy();
  });

  it('F155: detail chrome groups Desactivar/Eliminar behind Más (§4.1a.2)', async () => {
    const user = userEvent.setup();
    const onDeactivate = vi.fn();
    render(
      <StructuresScreen
        structures={mockStructures}
        optionGroups={[]}
        catalogComponents={[mockCatalogComponent]}
        catalogMaterials={[]}
        catalogEdges={[]}
        catalogHardware={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onDeactivate={onDeactivate}
        onReactivate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('EST-GAB-720'));

    // Chrome: Vista 3D + Editar (única primaria) + Más; destructivas ocultas.
    expect(screen.getByTestId('structure-detail-view-3d')).toBeTruthy();
    expect(screen.getByTestId('structure-detail-edit')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Desactivar$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Eliminar$/i })).toBeNull();

    await user.click(screen.getByRole('button', { name: /^Más$/i }));
    expect(
      screen.getByRole('menu', { name: 'Más acciones de la estructura' }),
    ).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /^Desactivar$/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /^Eliminar$/i })).toBeTruthy();

    // Desactivar desde el menú llama al mismo handler.
    await user.click(screen.getByRole('menuitem', { name: /^Desactivar$/i }));
    expect(onDeactivate).toHaveBeenCalledWith('s1');
  });

  it('F155: Eliminar desde Más abre la confirmación destructiva', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(
      <StructuresScreen
        structures={mockStructures}
        optionGroups={[]}
        catalogComponents={[mockCatalogComponent]}
        catalogMaterials={[]}
        catalogEdges={[]}
        catalogHardware={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={onDelete}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('EST-GAB-720'));
    await user.click(screen.getByRole('button', { name: /^Más$/i }));
    await user.click(screen.getByRole('menuitem', { name: /^Eliminar$/i }));

    expect(screen.getByTestId('delete-confirm-modal')).toBeTruthy();
    await user.click(screen.getByTestId('confirm-delete-btn'));
    expect(onDelete).toHaveBeenCalledWith('s1');
  });

  it('F155: estructura inactiva ofrece Reactivar (no Desactivar) en Más', async () => {
    const user = userEvent.setup();
    const onReactivate = vi.fn();
    render(
      <StructuresScreen
        structures={mockStructures}
        optionGroups={[]}
        catalogComponents={[mockCatalogComponent]}
        catalogMaterials={[]}
        catalogEdges={[]}
        catalogHardware={[]}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={onReactivate}
      />,
    );

    // Chip "Inactivos" para ver la estructura inactiva y abrir su detalle.
    fireEvent.click(screen.getByRole('button', { name: /^Inactivos$/i }));
    fireEvent.click(screen.getByText('EST-ALTO-600'));

    await user.click(screen.getByRole('button', { name: /^Más$/i }));
    expect(screen.getByRole('menuitem', { name: /^Reactivar$/i })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /^Desactivar$/i })).toBeNull();

    await user.click(screen.getByRole('menuitem', { name: /^Reactivar$/i }));
    expect(onReactivate).toHaveBeenCalledWith('s2');
  });

  it('F155: sin canMutate no hay menú Más ni Editar en el detalle', () => {
    render(
      <StructuresScreen
        structures={mockStructures}
        optionGroups={[]}
        catalogComponents={[mockCatalogComponent]}
        catalogMaterials={[]}
        catalogEdges={[]}
        catalogHardware={[]}
        canMutate={false}
        onCreate={vi.fn()}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        onDeactivate={vi.fn()}
        onReactivate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('EST-GAB-720'));
    expect(screen.queryByRole('button', { name: /^Más$/i })).toBeNull();
    expect(screen.queryByTestId('structure-detail-edit')).toBeNull();
  });
});

