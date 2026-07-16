/**
 * F022 — Projects cards + detail + Modal MD.
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import type {
  Customer,
  EdgeBand,
  Hardware,
  MaterialBoard,
  Module,
  OptionGroup,
  Project,
  QuoteBreakdown,
} from '@muebles/domain';
import { ProjectsScreen } from './ProjectsScreen';

const optionGroups: OptionGroup[] = [
  {
    id: 'g1',
    code: 'INTERIOR',
    name: 'Interior',
    kind: 'board',
    required: true,
    optionIds: ['mat-a', 'mat-b'],
  },
  {
    id: 'g2',
    code: 'FRENTE',
    name: 'Frente',
    kind: 'board',
    required: true,
    optionIds: ['mat-c'],
  },
];

const materials: MaterialBoard[] = [
  {
    id: 'mat-a',
    code: 'TAB-A',
    name: 'Blanco',
    widthMm: 1830,
    lengthMm: 2440,
    thicknessMm: 18,
    grainDefault: false,
    boardPrice: 44.65,
    costPerM2: 10,
    wastePercent: 0,
    active: true,
  },
  {
    id: 'mat-b',
    code: 'TAB-B',
    name: 'Roble',
    widthMm: 1830,
    lengthMm: 2440,
    thicknessMm: 18,
    grainDefault: true,
    boardPrice: 53.58,
    costPerM2: 12,
    wastePercent: 0,
    active: true,
  },
  {
    id: 'mat-c',
    code: 'TAB-C',
    name: 'Nougat',
    widthMm: 1830,
    lengthMm: 2440,
    thicknessMm: 18,
    grainDefault: true,
    boardPrice: 62.51,
    costPerM2: 14,
    wastePercent: 0,
    active: true,
  },
];

const edges: EdgeBand[] = [];
const hardware: Hardware[] = [];

const modules: Module[] = [
  {
    id: 'mod-1',
    code: 'MOD-GAB-01',
    name: 'Bajo mesada',
    boardParts: [
      {
        id: 'p1',
        description: 'Lateral',
        quantity: 1,
        lengthMm: 720,
        widthMm: 560,
        edges: [],
        optionRole: 'INTERIOR',
      },
      {
        id: 'p2',
        description: 'Puerta',
        quantity: 1,
        lengthMm: 700,
        widthMm: 300,
        edges: [],
        optionRole: 'FRENTE',
      },
    ],
    hardwareLines: [],
  },
];

const customers: Customer[] = [
  {
    id: 'cust-ana',
    name: 'Ana López',
    active: true,
  },
  {
    id: 'cust-bruno',
    name: 'Bruno',
    active: true,
  },
];

const projects: Project[] = [
  {
    id: 'prj-1',
    name: 'Cocina Ana',
    customerId: 'cust-ana',
    currency: 'UYU',
    marginFactor: 1.35,
    laborFixedCost: 0,
    status: 'draft',
    items: [
      {
        id: 'item-1',
        moduleId: 'mod-1',
        quantity: 2,
        optionChoices: { INTERIOR: 'mat-a', FRENTE: 'mat-c' },
      },
    ],
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z',
  },
  {
    id: 'prj-2',
    name: 'Dormitorio',
    customerId: 'cust-bruno',
    currency: 'UYU',
    marginFactor: 1.4,
    laborFixedCost: 100,
    status: 'quoted',
    items: [],
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-13T00:00:00.000Z',
  },
];

const sampleBreakdown: QuoteBreakdown = {
  materialsCost: 100,
  edgeTotal: 20,
  hardwareTotal: 30,
  laborModular: 0,
  laborFixedCost: 0,
  directCost: 150,
  salePrice: 202.5,
  marginFactor: 1.35,
};

function renderScreen(
  props: Partial<ComponentProps<typeof ProjectsScreen>> = {},
) {
  const onCreate = vi.fn();
  const onUpdate = vi.fn();
  const onDelete = vi.fn();
  const onDuplicate = vi.fn();
  const onAddItem = vi.fn();
  const onUpdateItem = vi.fn();
  const onRemoveItem = vi.fn();
  const onSelectionChange = vi.fn();
  const onExport = vi.fn();
  const onExportHardware = vi.fn();
  const result = render(
    <ProjectsScreen
      projects={projects}
      modules={modules}
      optionGroups={optionGroups}
      materials={materials}
      edges={edges}
      hardware={hardware}
      customers={customers}
      onCreate={onCreate}
      onUpdate={onUpdate}
      onDelete={onDelete}
      onDuplicate={onDuplicate}
      onAddItem={onAddItem}
      onUpdateItem={onUpdateItem}
      onRemoveItem={onRemoveItem}
      onSelectionChange={onSelectionChange}
      breakdown={null}
      projectEstimates={{ 'prj-1': 202.5, 'prj-2': null }}
      onExport={onExport}
      onExportHardware={onExportHardware}
      {...props}
    />,
  );
  return {
    ...result,
    onCreate,
    onUpdate,
    onDelete,
    onDuplicate,
    onAddItem,
    onUpdateItem,
    onRemoveItem,
    onSelectionChange,
    onExport,
    onExportHardware,
  };
}

afterEach(() => {
  cleanup();
});

describe('ProjectsScreen F022', () => {
  it('renders project list as rich cards (not a table)', () => {
    renderScreen();
    expect(screen.getByLabelText('Lista de cotizaciones')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Cotizaciones' })).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    const card = screen.getByTestId('project-card-prj-1');
    expect(within(card).getByText('Cocina Ana')).toBeTruthy();
    expect(within(card).getByText('Ana López')).toBeTruthy();
    expect(within(card).getByText('Borrador')).toBeTruthy();
    expect(within(card).getByText(/1 mueble/)).toBeTruthy();
    expect(within(card).getByText('202.50')).toBeTruthy();
  });

  it('opens detail on card click with sticky chrome and back navigation', async () => {
    const user = userEvent.setup();
    const { onSelectionChange } = renderScreen();

    await user.click(screen.getByTestId('project-card-prj-1'));
    expect(screen.getByTestId('project-detail')).toBeTruthy();
    expect(screen.getByTestId('project-detail-chrome')).toBeTruthy();
    expect(screen.getByTestId('project-detail-total')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Cocina Ana' })).toBeTruthy();
    expect(screen.getByTestId('project-chrome-export')).toBeTruthy();
    expect(onSelectionChange).toHaveBeenCalledWith('prj-1');

    await user.click(screen.getByRole('button', { name: /^Lista$/i }));
    expect(screen.queryByTestId('project-detail')).toBeNull();
    expect(screen.getByLabelText('Lista de cotizaciones')).toBeTruthy();
    expect(onSelectionChange).toHaveBeenCalledWith(null);
  });

  it('opens Modal MD for new project metadata with customer picker', async () => {
    const user = userEvent.setup();
    const { onCreate } = renderScreen();

    await user.click(screen.getByRole('button', { name: /Nueva cotización/i }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Nuevo proyecto' })).toBeTruthy();

    const clientTrigger = screen.getByLabelText('Cliente');
    expect(clientTrigger.tagName).toBe('BUTTON');
    await user.click(clientTrigger);
    const listbox = screen.getByRole('listbox');
    expect(
      within(listbox).getByRole('option', { name: /Ana López/i }),
    ).toBeTruthy();
    expect(
      within(listbox).queryByRole('option', { name: /inactivo/i }),
    ).toBeNull();
    await user.click(within(listbox).getByRole('option', { name: /^Bruno$/i }));

    await user.type(screen.getByLabelText('Nombre'), 'Oficina');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Oficina',
        customerId: 'cust-bruno',
        customerName: '',
      }),
    );
  });

  it('rejects create when customer is not selected', async () => {
    const user = userEvent.setup();
    const { onCreate } = renderScreen();

    await user.click(screen.getByRole('button', { name: /Nueva cotización/i }));
    await user.type(screen.getByLabelText('Nombre'), 'Sin cliente');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByText(/Seleccioná un cliente/i)).toBeTruthy();
  });

  it('creates via Nuevo cliente name path without pre-selected id', async () => {
    const user = userEvent.setup();
    const { onCreate } = renderScreen();

    await user.click(screen.getByRole('button', { name: /Nueva cotización/i }));
    await user.type(screen.getByLabelText('Nombre'), 'Oficina');
    await user.click(screen.getByLabelText('Nuevo cliente'));
    await user.type(screen.getByLabelText('Cliente'), 'Carla Nueva');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Oficina',
        customerId: '',
        customerName: 'Carla Nueva',
      }),
    );
  });

  it('opens Modal MD to edit project from detail', async () => {
    const user = userEvent.setup();
    const { onUpdate } = renderScreen();

    await user.click(screen.getByTestId('project-card-prj-1'));
    await user.click(screen.getByRole('button', { name: /^Editar$/i }));
    expect(screen.getByRole('heading', { name: 'Editar proyecto' })).toBeTruthy();

    const clientTrigger = screen.getByLabelText('Cliente');
    expect(clientTrigger.tagName).toBe('BUTTON');
    expect(clientTrigger.textContent).toMatch(/Ana López/);

    const nameInput = screen.getByLabelText('Nombre');
    await user.clear(nameInput);
    await user.type(nameInput, 'Cocina renovada');
    await user.click(clientTrigger);
    await user.click(screen.getByRole('option', { name: /Bruno/i }));
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(onUpdate).toHaveBeenCalledWith(
      'prj-1',
      expect.objectContaining({
        name: 'Cocina renovada',
        customerId: 'cust-bruno',
      }),
    );
  });

  it('includes inactive current customer in edit picker', async () => {
    const user = userEvent.setup();
    const inactiveCustomers: Customer[] = [
      { id: 'cust-ana', name: 'Ana López', active: false },
      { id: 'cust-bruno', name: 'Bruno', active: true },
    ];
    renderScreen({ customers: inactiveCustomers });

    await user.click(screen.getByTestId('project-card-prj-1'));
    await user.click(screen.getByRole('button', { name: /^Editar$/i }));

    const clientTrigger = screen.getByLabelText('Cliente');
    expect(clientTrigger.textContent).toMatch(/Ana López \(inactivo\)/);
    await user.click(clientTrigger);
    expect(
      screen.getByRole('option', { name: /Ana López \(inactivo\)/i }),
    ).toBeTruthy();
  });

  it('opens Modal MD to add furniture with module/qty/options', async () => {
    const user = userEvent.setup();
    const { onAddItem } = renderScreen();

    await user.click(screen.getByTestId('project-card-prj-1'));
    await user.click(screen.getByRole('button', { name: /Agregar mueble/i }));
    expect(screen.getByRole('heading', { name: 'Agregar mueble' })).toBeTruthy();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Mueble')).toBeTruthy();
    expect(within(dialog).getByLabelText('Cantidad')).toBeTruthy();
    expect(within(dialog).getByLabelText(/Interior/)).toBeTruthy();

    await user.click(within(dialog).getByRole('button', { name: 'Agregar' }));
    expect(onAddItem).toHaveBeenCalledWith(
      'prj-1',
      expect.objectContaining({
        moduleId: 'mod-1',
        quantity: 1,
        optionChoices: expect.objectContaining({
          INTERIOR: 'mat-a',
          FRENTE: 'mat-c',
        }),
      }),
    );
  });

  it('shows sticky totals panel from domain breakdown props', async () => {
    const user = userEvent.setup();
    renderScreen({ breakdown: sampleBreakdown, previewBlocked: false });

    await user.click(screen.getByTestId('project-card-prj-1'));
    const totals = screen.getByLabelText('Totales de cotización');
    expect(within(totals).getByText('Precio de venta')).toBeTruthy();
    expect(within(totals).getByText('202.50')).toBeTruthy();
    // Export lives in sticky workspace chrome (issue #50)
    expect(screen.getByTestId('project-chrome-export')).toBeTruthy();
    expect(screen.getByTestId('project-detail-total').textContent).toMatch(
      /202\.50/,
    );
  });

  it('shows loading status in totals when breakdownLoading', async () => {
    const user = userEvent.setup();
    renderScreen({
      breakdown: sampleBreakdown,
      breakdownLoading: true,
    });

    await user.click(screen.getByTestId('project-card-prj-1'));
    const loading = screen.getByTestId('breakdown-loading');
    expect(loading.getAttribute('aria-busy')).toBe('true');
    expect(loading.textContent).toMatch(/Recalculando/i);
  });

  it('shows error alert in totals when breakdownError (still shows values)', async () => {
    const user = userEvent.setup();
    renderScreen({
      breakdown: sampleBreakdown,
      breakdownError:
        'No se pudo recalcular en el servidor; mostrando valores locales',
    });

    await user.click(screen.getByTestId('project-card-prj-1'));
    const alert = screen.getByTestId('breakdown-error');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toMatch(/valores locales/i);
    expect(screen.getAllByText('202.50').length).toBeGreaterThanOrEqual(1);
  });

  it('disables export and shows message when preview blocked', async () => {
    const user = userEvent.setup();
    renderScreen({
      breakdown: null,
      previewBlocked: true,
      missingGroups: ['FRENTE'],
    });

    await user.click(screen.getByTestId('project-card-prj-1'));
    const exportBtn = screen.getByRole('button', {
      name: /Exportar Optimizer/i,
    }) as HTMLButtonElement;
    expect((exportBtn as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.getByText(/completá las opciones obligatorias/i),
    ).toBeTruthy();
  });

  it('shows EmptyState when there are no projects', () => {
    renderScreen({ projects: [] });
    expect(screen.getByText('No hay cotizaciones')).toBeTruthy();
    expect(
      screen.getAllByRole('button', { name: /Nueva cotización/i }).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('opens detail from openProjectId prop (Dashboard handoff)', () => {
    const { onSelectionChange } = renderScreen({ openProjectId: 'prj-1' });
    expect(screen.getByTestId('project-detail')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Cocina Ana' })).toBeTruthy();
    expect(onSelectionChange).toHaveBeenCalledWith('prj-1');
  });

  it('opens create modal from requestCreateKey prop', () => {
    renderScreen({ requestCreateKey: 1 });
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Nuevo proyecto' })).toBeTruthy();
  });

  it('opens SM confirm modal before delete', async () => {
    const user = userEvent.setup();
    const { onDelete } = renderScreen();

    await user.click(screen.getByTestId('project-card-prj-1'));
    await user.click(screen.getByRole('button', { name: /^Eliminar$/i }));
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByRole('heading', { name: 'Eliminar proyecto' }),
    ).toBeTruthy();
    expect(within(dialog).getByText(/Cocina Ana/)).toBeTruthy();
    // Toolbar still has "Eliminar"; confirm is the danger button in the dialog.
    await user.click(
      within(dialog).getByRole('button', { name: /^Eliminar$/i }),
    );
    expect(onDelete).toHaveBeenCalledWith('prj-1');
  });
});
