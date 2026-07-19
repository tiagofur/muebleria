/**
 * F022 — Projects cards + detail + Modal MD.
 * @vitest-environment jsdom
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
  ProjectTemplate,
  QuoteBreakdown,
} from '@muebles/domain';
import { ProjectsScreen } from './ProjectsScreen';

const here = dirname(fileURLToPath(import.meta.url));

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
    // Option roles come from hardware lines (modules compose structures +
    // components, not board parts directly).
    hardwareLines: [
      { id: 'h1', quantity: 1, optionRole: 'INTERIOR' },
      { id: 'h2', quantity: 1, optionRole: 'FRENTE' },
    ],
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
    currency: 'MXN',
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
    currency: 'MXN',
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
  const onSaveAsTemplate = vi.fn();
  const onCreateFromTemplate = vi.fn();
  const onDeleteTemplate = vi.fn();
  const onAddItem = vi.fn();
  const onUpdateItem = vi.fn();
  const onRemoveItem = vi.fn();
  const onUpdateProjectLevelChoices = vi.fn();
  const onUpdateMeasureDefaults = vi.fn();
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
      onSaveAsTemplate={onSaveAsTemplate}
      onCreateFromTemplate={onCreateFromTemplate}
      onDeleteTemplate={onDeleteTemplate}
      onAddItem={onAddItem}
      onUpdateItem={onUpdateItem}
      onRemoveItem={onRemoveItem}
      onUpdateProjectLevelChoices={onUpdateProjectLevelChoices}
      onUpdateMeasureDefaults={onUpdateMeasureDefaults}
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
    onSaveAsTemplate,
    onCreateFromTemplate,
    onDeleteTemplate,
    onAddItem,
    onUpdateItem,
    onRemoveItem,
    onUpdateProjectLevelChoices,
    onUpdateMeasureDefaults,
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
    expect(within(card).getByText('$202.50 MXN')).toBeTruthy();
  });

  it('shows material summary when shell provides F047 data', async () => {
    const user = userEvent.setup();
    renderScreen({
      materialSummary: {
        materials: [
          {
            materialId: 'mat-1',
            code: 'TAB-A',
            name: 'Arauco Blanco',
            areaM2: 1.25,
            edgeMl: 3.2,
            boardCost: 100,
          },
        ],
        edges: [],
        hardware: [
          {
            hardwareId: 'hw-1',
            code: 'HER-1',
            description: 'Bisagra',
            unit: 'piece',
            quantity: 4,
            costPerUnit: 10,
            lineCost: 40,
          },
        ],
        totalAreaM2: 1.25,
        totalEdgeMl: 0,
        totalBoardCost: 100,
        totalEdgeCost: 0,
        totalHardwareCost: 40,
      },
      showCosts: true,
    });
    await user.click(screen.getByTestId('project-card-prj-1'));
    const summary = screen.getByTestId('project-material-summary');
    expect(summary.textContent).toContain('Arauco Blanco');
    expect(summary.textContent).toContain('1.250 m²');
    expect(summary.textContent).toContain('Bisagra');
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
    expect(screen.getByRole('heading', { name: 'Nueva cotización' })).toBeTruthy();

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
    expect(screen.getByRole('heading', { name: 'Editar cotización' })).toBeTruthy();

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
    expect(within(totals).getByText('$202.50 MXN')).toBeTruthy();
    // Export lives in sticky workspace chrome (issue #50)
    expect(screen.getByTestId('project-chrome-export')).toBeTruthy();
    expect(screen.getByTestId('project-detail-total').textContent).toMatch(
      /\$202\.50 MXN/,
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
    expect(screen.getAllByText('$202.50 MXN').length).toBeGreaterThanOrEqual(1);
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

  it('F029: project-level options block and line override badge', async () => {
    const user = userEvent.setup();
    const projectsWithLevel: Project[] = [
      {
        ...projects[0]!,
        projectLevelChoices: { INTERIOR: 'mat-b' },
        items: [
          {
            id: 'item-1',
            moduleId: 'mod-1',
            quantity: 2,
            optionChoices: { INTERIOR: 'mat-a', FRENTE: 'mat-c' },
          },
        ],
      },
    ];
    const { onUpdateProjectLevelChoices, onUpdateItem } = renderScreen({
      projects: projectsWithLevel,
    });

    await user.click(screen.getByTestId('project-card-prj-1'));
    expect(screen.getByTestId('project-level-options')).toBeTruthy();
    expect(screen.getByText('Opciones del proyecto')).toBeTruthy();
    expect(screen.getAllByText('Override').length).toBeGreaterThanOrEqual(1);

    await user.selectOptions(
      screen.getByTestId('project-level-choice-INTERIOR'),
      'mat-a',
    );
    expect(onUpdateProjectLevelChoices).toHaveBeenCalledWith('prj-1', {
      INTERIOR: 'mat-a',
    });

    await user.selectOptions(
      screen.getByTestId('item-choice-item-1-INTERIOR'),
      '',
    );
    expect(onUpdateItem).toHaveBeenCalledWith(
      'prj-1',
      expect.objectContaining({
        id: 'item-1',
        optionChoices: { FRENTE: 'mat-c' },
      }),
    );
  });

  it('keeps project options inside main column so totals stay sidebar (layout)', () => {
    const src = readFileSync(join(here, 'ProjectsScreen.tsx'), 'utf8');
    const main = src.indexOf('project-detail__main');
    const opts = src.indexOf('project-level-options');
    const items = src.indexOf('project-detail__items');
    const totals = src.indexOf('aria-label="Totales de cotización"');
    expect(main).toBeGreaterThan(-1);
    expect(main).toBeLessThan(opts);
    expect(opts).toBeLessThan(items);
    expect(items).toBeLessThan(totals);
    // main column closes before totals aside
    const between = src.slice(items, totals);
    expect(between).toContain('</div>');
    expect(between.lastIndexOf('</section>')).toBeLessThan(
      between.lastIndexOf('</div>'),
    );
  });

  it('opens create modal from requestCreateKey prop', () => {
    renderScreen({ requestCreateKey: 1 });
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Nueva cotización' })).toBeTruthy();
  });

  it('opens SM confirm modal before delete', async () => {
    const user = userEvent.setup();
    const { onDelete } = renderScreen();

    await user.click(screen.getByTestId('project-card-prj-1'));
    await user.click(screen.getByRole('button', { name: /^Eliminar$/i }));
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByRole('heading', { name: 'Eliminar cotización' }),
    ).toBeTruthy();
    expect(within(dialog).getByText(/Cocina Ana/)).toBeTruthy();
    // Toolbar still has "Eliminar"; confirm is the danger button in the dialog.
    await user.click(
      within(dialog).getByRole('button', { name: /^Eliminar$/i }),
    );
    expect(onDelete).toHaveBeenCalledWith('prj-1');
  });
});

describe('ProjectsScreen project measure defaults (#109)', () => {
  const modulesAllTypes: Module[] = [
    {
      id: 'mod-inf',
      code: 'MOD-GAB',
      name: 'Gabinete',
      furnitureType: 'inferior',
      presets: [
        { id: 'p560', name: 'Fondo 560', width: 600, height: 720, depth: 560 },
        { id: 'p590', name: 'Fondo 590', width: 600, height: 720, depth: 590 },
      ],
      hardwareLines: [],
    },
    {
      id: 'mod-sup',
      code: 'MOD-ALA',
      name: 'Alacena',
      furnitureType: 'superior',
      presets: [
        { id: 's320', name: 'Fondo 320', width: 600, height: 720, depth: 320 },
      ],
      hardwareLines: [],
    },
    {
      id: 'mod-alto',
      code: 'MOD-DES',
      name: 'Despensa',
      furnitureType: 'alto',
      presets: [
        { id: 'a2100', name: 'Alto 2100', width: 600, height: 2100, depth: 600 },
      ],
      hardwareLines: [],
    },
  ];

  it('renders the measure-defaults section with one row per furnitureType in catalog (draft project)', async () => {
    const user = userEvent.setup();
    renderScreen({ modules: modulesAllTypes });

    await user.click(screen.getByTestId('project-card-prj-1'));

    expect(screen.getByTestId('project-measure-defaults')).toBeTruthy();
    expect(screen.getByTestId('project-measure-default-inferior')).toBeTruthy();
    expect(screen.getByTestId('project-measure-default-superior')).toBeTruthy();
    expect(screen.getByTestId('project-measure-default-alto')).toBeTruthy();
  });

  it('omits the section when no onUpdateMeasureDefaults prop is passed', async () => {
    const user = userEvent.setup();
    renderScreen({ modules: modulesAllTypes, onUpdateMeasureDefaults: undefined });

    await user.click(screen.getByTestId('project-card-prj-1'));

    expect(screen.queryByTestId('project-measure-defaults')).toBeNull();
  });

  it('omits the section for closed projects (quoted/produced)', async () => {
    const user = userEvent.setup();
    renderScreen({ modules: modulesAllTypes });

    await user.click(screen.getByTestId('project-card-prj-2')); // status: 'quoted'

    expect(screen.queryByTestId('project-measure-defaults')).toBeNull();
  });

  it('updates inferior depth default live and calls onUpdateMeasureDefaults', async () => {
    const user = userEvent.setup();
    const { onUpdateMeasureDefaults } = renderScreen({ modules: modulesAllTypes });

    await user.click(screen.getByTestId('project-card-prj-1'));
    fireEvent.change(
      screen.getByTestId('project-measure-default-inferior-depth'),
      { target: { value: '560' } },
    );

    expect(onUpdateMeasureDefaults).toHaveBeenCalledTimes(1);
    const lastCall = onUpdateMeasureDefaults.mock.calls.at(-1)!;
    expect(lastCall[0]).toBe('prj-1');
    expect(lastCall[1]).toEqual({ inferior: { depth: 560 } });
  });

  it('clears the whole field when both dimensions of a type are emptied', async () => {
    const user = userEvent.setup();
    const projectsWithDefaults: Project[] = [
      {
        ...projects[0]!,
        measureDefaults: { inferior: { depth: 560 } },
      },
    ];
    const { onUpdateMeasureDefaults } = renderScreen({
      modules: modulesAllTypes,
      projects: projectsWithDefaults,
    });

    await user.click(screen.getByTestId('project-card-prj-1'));
    const depthInput = screen.getByTestId(
      'project-measure-default-inferior-depth',
    ) as HTMLInputElement;
    expect(depthInput.value).toBe('560');

    await user.clear(depthInput);

    expect(onUpdateMeasureDefaults).toHaveBeenLastCalledWith('prj-1', undefined);
  });

  it('selectModuleForAdd pre-selects the preset matching the project default (#109)', async () => {
    const user = userEvent.setup();
    // mod-inf has presets 560 and 590. Project default inferior.depth=590 should
    // pre-select the 590 preset when the module is picked in the add-item modal.
    const projectsWithDefaults: Project[] = [
      {
        ...projects[0]!,
        measureDefaults: { inferior: { depth: 590 } },
      },
    ];
    renderScreen({ modules: modulesAllTypes, projects: projectsWithDefaults });

    await user.click(screen.getByTestId('project-card-prj-1'));
    await user.click(screen.getByRole('button', { name: /Agregar mueble/i }));

    // Open the module picker and select the inferior module.
    await user.click(screen.getByLabelText('Mueble'));
    await user.click(
      screen.getByRole('option', { name: /MOD-GAB — Gabinete/i }),
    );

    const presetSelect = screen.getByTestId(
      'add-item-measure-preset',
    ) as HTMLSelectElement;
    expect(presetSelect.value).toBe('p590');
  });

  it('shows a furnitureType badge on each quote line (#109)', async () => {
    const user = userEvent.setup();
    // prj-1 has item-1 → mod-1 (default module fixture has no furnitureType →
    // badge should be absent). Add a typed module + project that uses it.
    const typedModules: Module[] = [
      {
        id: 'mod-typed-sup',
        code: 'MOD-ALA',
        name: 'Alacena',
        furnitureType: 'superior',
        presets: [
          { id: 's320', width: 600, height: 720, depth: 320 },
        ],
        hardwareLines: [],
      },
    ];
    const projectsWithTypedItem: Project[] = [
      {
        ...projects[0]!,
        items: [
          {
            id: 'item-typed',
            moduleId: 'mod-typed-sup',
            quantity: 1,
            optionChoices: {},
          },
        ],
      },
    ];
    renderScreen({ modules: typedModules, projects: projectsWithTypedItem });

    await user.click(screen.getByTestId('project-card-prj-1'));

    const badge = screen.getByTestId('project-item-type-badge-item-typed');
    expect(badge.textContent).toBe('Superior');
  });

  it('omits the furnitureType badge when module has no type (legacy)', async () => {
    const user = userEvent.setup();
    renderScreen(); // mod-1 has no furnitureType

    await user.click(screen.getByTestId('project-card-prj-1'));

    expect(
      screen.queryByTestId('project-item-type-badge-item-1'),
    ).toBeNull();
  });
});

describe('ProjectsScreen project templates (#110)', () => {
  const sampleTemplate: ProjectTemplate = {
    id: 'tmpl-test',
    name: 'Cocina test',
    currency: 'MXN',
    marginFactor: 1.35,
    laborFixedCost: 0,
    items: [
      { id: 'ti-1', moduleId: 'mod-1', quantity: 2, optionChoices: {} },
      { id: 'ti-2', moduleId: 'mod-1', quantity: 1, optionChoices: {} },
    ],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  };

  it('toolbar shows "Desde plantilla" only when templates + handler present', async () => {
    const user = userEvent.setup();
    // No templates prop → no button.
    renderScreen();
    expect(screen.queryByTestId('new-from-template-btn')).toBeNull();
    cleanup();

    // With templates + handler → button appears.
    renderScreen({
      projectTemplates: [sampleTemplate],
      onCreateFromTemplate: vi.fn(),
    });
    expect(screen.getByTestId('new-from-template-btn')).toBeTruthy();

    await user.click(screen.getByTestId('new-from-template-btn'));
    expect(screen.getByText('Crear cotización desde plantilla')).toBeTruthy();
    expect(screen.getByTestId('template-pick-tmpl-test')).toBeTruthy();
  });

  it('picker → choose template → fill name+customer → onCreateFromTemplate', async () => {
    const user = userEvent.setup();
    const { onCreateFromTemplate } = renderScreen({
      projectTemplates: [sampleTemplate],
    });

    await user.click(screen.getByTestId('new-from-template-btn'));
    await user.click(screen.getByTestId('template-pick-tmpl-test'));

    // Name input is pre-filled with the template name as a suggestion.
    const nameInput = screen.getByTestId('from-template-name') as HTMLInputElement;
    await user.clear(nameInput);
    await user.type(nameInput, 'Cocina nueva');
    await user.selectOptions(
      screen.getByTestId('from-template-customer'),
      'cust-ana',
    );
    await user.click(screen.getByRole('button', { name: /Crear cotización/i }));

    expect(onCreateFromTemplate).toHaveBeenCalledTimes(1);
    const [templateId, draft] = onCreateFromTemplate.mock.calls[0]!;
    expect(templateId).toBe('tmpl-test');
    expect(draft.name).toBe('Cocina nueva');
    expect(draft.customerId).toBe('cust-ana');
  });

  it('empty state shows "Crear desde plantilla" when templates exist', () => {
    renderScreen({
      projects: [],
      projectTemplates: [sampleTemplate],
    });
    expect(screen.getByTestId('empty-from-template-btn')).toBeTruthy();
  });

  it('chrome shows "Guardar como plantilla" on draft projects and saves', async () => {
    const user = userEvent.setup();
    const { onSaveAsTemplate } = renderScreen({
      projectTemplates: [sampleTemplate],
    });

    await user.click(screen.getByTestId('project-card-prj-1'));
    const saveBtn = screen.getByTestId('save-as-template-btn-prj-1');
    await user.click(saveBtn);

    const nameInput = screen.getByTestId(
      'save-as-template-name',
    ) as HTMLInputElement;
    expect(nameInput.value).toBe('Cocina Ana'); // defaults to project name
    await user.clear(nameInput);
    await user.type(nameInput, 'Mi plantilla');
    await user.click(screen.getByRole('button', { name: /Guardar plantilla/i }));

    expect(onSaveAsTemplate).toHaveBeenCalledWith('prj-1', 'Mi plantilla');
  });

  it('management modal lists templates with a delete button', async () => {
    const user = userEvent.setup();
    const { onDeleteTemplate } = renderScreen({
      projectTemplates: [sampleTemplate],
    });

    await user.click(screen.getByTestId('manage-templates-btn'));
    await user.click(screen.getByTestId('delete-template-tmpl-test'));

    expect(onDeleteTemplate).toHaveBeenCalledWith('tmpl-test');
  });
});
