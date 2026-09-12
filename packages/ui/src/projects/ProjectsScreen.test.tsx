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
import { resetRequestCreateKeyConsumers } from '../common/consumeRequestCreateKey';
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
} from '@granete/domain';
import type {
  ProjectCommercialSummary,
  QuoteCommercialSnapshot,
  QuoteRevisionItem,
} from '@granete/storage';
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
    phone: '+52 322 100 0001',
    active: true,
  },
  {
    id: 'cust-bruno',
    name: 'Bruno',
    phone: '+52 322 100 0002',
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
  discountPercent: 0,
  discountAmount: 0,
};

const defaultCommercialSummaries: ReadonlyMap<string, ProjectCommercialSummary> = new Map([
  [
    'prj-1',
    {
      projectId: 'prj-1',
      projectName: 'Cocina Ana',
      quoteStatus: 'draft',
      quoteRevisionNumber: 1,
      isLegacy: false,
      furnitureQuantity: 1,
      saleTotal: 202.5,
      currency: 'MXN',
      commercialActivityAt: '2026-07-12T00:00:00.000Z',
    },
  ],
  [
    'prj-2',
    {
      projectId: 'prj-2',
      projectName: 'Dormitorio',
      quoteStatus: 'published',
      quoteRevisionNumber: 1,
      isLegacy: false,
      furnitureQuantity: 0,
      saleTotal: null,
      currency: 'MXN',
      commercialActivityAt: '2026-07-13T00:00:00.000Z',
    },
  ],
]);

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
  const baseProps: ComponentProps<typeof ProjectsScreen> = {
    projects,
    modules,
    optionGroups,
    materials,
    edges,
    hardware,
    customers,
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
    breakdown: null,
    projectEstimates: { 'prj-1': 202.5, 'prj-2': null },
    commercialSummaries: defaultCommercialSummaries,
    commercialSummariesStatus: 'ready',
    onExport,
    onExportHardware,
  };
  const result = render(<ProjectsScreen {...baseProps} {...props} />);
  const rerenderWith = (next: Partial<ComponentProps<typeof ProjectsScreen>>) => {
    result.rerender(<ProjectsScreen {...baseProps} {...next} />);
  };
  return {
    ...result,
    rerenderWith,
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
  resetRequestCreateKeyConsumers();
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
    expect(within(card).getByText(/Borrador/)).toBeTruthy();
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
            purchaseQuantity: 4,
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
    // Draft: factory export is not a chrome CTA (lives in Producción when plant-ready).
    expect(screen.queryByTestId('project-chrome-export')).toBeNull();
    expect(onSelectionChange).toHaveBeenCalledWith('prj-1');

    await user.click(
      screen.getByRole('button', { name: /Volver a la lista|^Lista$/i }),
    );
    expect(screen.queryByTestId('project-detail')).toBeNull();
    expect(screen.getByLabelText('Lista de cotizaciones')).toBeTruthy();
    expect(onSelectionChange).toHaveBeenCalledWith(null);
  });

  it('draft chrome has advanced tools collapsed and no legacy send action', async () => {
    const user = userEvent.setup();
    renderScreen({ onChangeStatus: vi.fn() });

    await user.click(screen.getByTestId('project-card-prj-1'));

    const chrome = screen.getByTestId('project-detail-chrome');
    expect(screen.queryByTestId('project-send-quote')).toBeNull();
    expect(screen.queryByTestId('project-accept-quote')).toBeNull();
    // Draft: Optimizer is not a chrome button (factory path is Producción).
    expect(screen.queryByTestId('project-chrome-export')).toBeNull();
    // Advanced tools start closed — kitchen plan not in DOM until toggle.
    expect(screen.getByTestId('project-quote-tools')).toBeTruthy();
    expect(screen.queryByTestId('project-tools-panel-kitchen')).toBeNull();
    await user.click(screen.getByTestId('project-tools-kitchen'));
    expect(screen.getByTestId('project-tools-panel-kitchen')).toBeTruthy();
    expect(
      screen.getByTestId('project-tools-kitchen').getAttribute('aria-pressed'),
    ).toBe('true');
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
    // Draft fixture: Optimizer is not a quote chrome action.
    expect(screen.queryByTestId('project-chrome-export')).toBeNull();
    expect(screen.getByTestId('project-detail-total').textContent).toMatch(
      /\$202\.50 MXN/,
    );
  });

  it('renders the exact accepted revision instead of conflicting project status', async () => {
    const user = userEvent.setup();
    const onOpenReconciliation = vi.fn();
    renderScreen({
      breakdown: sampleBreakdown,
      quoteAuthority: {
        kind: 'ready',
        revisionId: 'quote-2',
        revisionNumber: 2,
        status: 'accepted',
        projectName: 'Cocina congelada Q2',
        customerId: 'cust-bruno',
        customerName: 'Cliente congelado Q2',
        furnitureQuantity: 7,
        currency: 'USD',
        capturedAt: '2026-09-10T12:00:00Z',
        onRetry: vi.fn(),
      },
      onChangeStatus: vi.fn(),
      onOpenReconciliation,
    });

    await user.click(screen.getByTestId('project-card-prj-1'));
    const detail = screen.getByTestId('project-detail');
    expect(within(detail).getByRole('heading', { name: 'Cocina congelada Q2' })).toBeTruthy();
    expect(screen.getByTestId('project-detail-chrome').textContent).toContain('Cliente congelado Q2');
    expect(screen.getByTestId('project-detail-chrome').textContent).toContain('7 muebles');
    expect(screen.getByTestId('project-detail-chrome').textContent).not.toContain('Margen ×1.35');
    expect(screen.queryByTestId('project-material-summary')).toBeNull();
    expect(within(detail).getByText('Q2 · Aceptada')).toBeTruthy();
    expect(screen.getByTestId('project-detail-total').textContent).toContain('$202.50 USD');
    expect(screen.queryByTestId('project-chrome-edit')).toBeNull();
    expect(screen.queryByTestId('project-send-quote')).toBeNull();
    expect(screen.queryByTestId('project-accept-quote')).toBeNull();

    await user.click(screen.getByTitle('Enviar WhatsApp a Cliente congelado Q2'));
    expect((screen.getByLabelText('Número de Teléfono / WhatsApp:') as HTMLInputElement).value).toBe('+52 322 100 0002');
    expect((screen.getByLabelText('Mensaje a Enviar:') as HTMLTextAreaElement).value).toContain('Cocina congelada Q2');
  });

  it.each([
    ['loading', { kind: 'loading' as const }],
    ['error', { kind: 'error' as const, message: 'No se pudo cargar.', onRetry: vi.fn() }],
    ['empty', { kind: 'empty' as const, message: 'Creá Q1.' }],
  ])('does not leak mutable project identity while authority is %s', async (_label, quoteAuthority) => {
    const user = userEvent.setup();
    renderScreen({ breakdown: null, quoteAuthority });

    await user.click(screen.getByTestId('project-card-prj-1'));
    const chrome = screen.getByTestId('project-detail-chrome');
    expect(chrome.textContent).not.toContain('Cocina Ana');
    expect(chrome.textContent).not.toContain('Ana López');
    expect(chrome.textContent).not.toContain('MXN');
    expect(chrome.textContent).not.toContain('Margen ×1.35');
    expect(chrome.textContent).not.toContain('1 mueble');
    expect(screen.queryByTestId('project-material-summary')).toBeNull();
  });

  it('#642 legacy recovery: shows persisted furniture read-only, honest unavailability and modernize action', async () => {
    const user = userEvent.setup();
    const onOpenReconciliation = vi.fn();
    const legacyItems = [
      {
        furnitureInstanceId: 'fi-legacy-1',
        furnitureDefinitionId: 'mod-1',
        parameters: { widthMm: 600, heightMm: 720, depthMm: 560 },
        materialChoices: { INTERIOR: 'mat-a' },
        lifecycleStatus: 'active' as const,
      },
      {
        furnitureInstanceId: 'fi-legacy-2',
        furnitureDefinitionId: 'mod-1',
        parameters: { widthMm: 650, heightMm: 720, depthMm: 560 },
        materialChoices: { INTERIOR: 'mat-b' },
        lifecycleStatus: 'active' as const,
      },
      {
        furnitureInstanceId: 'fi-legacy-3',
        furnitureDefinitionId: 'mod-1',
        parameters: { widthMm: 700, heightMm: 720, depthMm: 560 },
        materialChoices: { INTERIOR: 'mat-b' },
        lifecycleStatus: 'removed' as const,
      },
    ];
    renderScreen({
      breakdown: null,
      quoteAuthority: {
        kind: 'legacy',
        revisionId: 'quote-1',
        revisionNumber: 1,
        status: 'published',
        items: legacyItems,
        createdAt: '2026-01-10T10:00:00Z',
        publishedAt: '2026-01-11T10:00:00Z',
        acceptedAt: null,
        message:
          'Esta revisión fue creada antes del historial comercial congelado. Los muebles y configuraciones originales siguen disponibles; algunos datos históricos, como el precio total exacto, no pueden verificarse.',
        onRetry: vi.fn(),
      },
      onOpenReconciliation,
    });

    await user.click(screen.getByTestId('project-card-prj-1'));

    // Test A — the persisted units render; no empty screen, no "Sin cotización".
    const detail = screen.getByTestId('project-detail');
    expect(within(detail).getByTestId('quote-legacy-badge').textContent).toContain('Q1 · Cotización anterior');
    for (const item of legacyItems) {
      expect(within(detail).getByTestId(`quote-legacy-unit-${item.furnitureInstanceId}`)).toBeTruthy();
    }
    expect(within(detail).getByTestId('quote-legacy-dimensions-fi-legacy-2').textContent).toBe('650×720×560 mm');
    expect(within(detail).getAllByText(/Material INTERIOR: mat-/)).toHaveLength(3);
    expect(within(detail).getAllByText(/Definición: mod-1/)).toHaveLength(3);
    expect(detail.textContent).not.toContain('Sin cotización');

    // Current catalog names assist recognition but are explicitly marked —
    // never presented as frozen history of the legacy revision.
    expect(within(detail).getAllByText(/\(etiqueta actual\)/).length).toBeGreaterThan(0);

    // Real lifecycle timestamps surface in the chrome meta.
    expect(within(detail).getByTestId('quote-legacy-meta').textContent).toContain('publicada');

    // Test B — no fake money: the historical total is honestly unavailable.
    expect(within(detail).getByTestId('legacy-price-unavailable').textContent).toContain('No disponible con precisión');
    expect(within(detail).getByTestId('project-detail-total').textContent).not.toContain('$202.50');
    expect(within(detail).getByTestId('project-detail-total').textContent).not.toContain('$0');

    // The modernize action routes to the reconciliation flow with the exact
    // legacy revision; the legacy revision itself is never edited.
    await user.click(within(detail).getAllByTestId('legacy-modernize-btn')[0]!);
    expect(onOpenReconciliation).toHaveBeenCalledWith('prj-1', 'quote-1');
  });

  it('#642 legacy recovery: persisted fields never change with the mutable catalog — only marked current labels do', async () => {
    const user = userEvent.setup();
    const legacyAuthority = {
      kind: 'legacy' as const,
      revisionId: 'quote-1',
      revisionNumber: 1,
      status: 'accepted' as const,
      items: [
        {
          furnitureInstanceId: 'fi-legacy-1',
          furnitureDefinitionId: 'mod-1',
          parameters: { widthMm: 600, heightMm: 720, depthMm: 560 },
          materialChoices: { INTERIOR: 'mat-a' },
          lifecycleStatus: 'active' as const,
        },
      ],
      createdAt: '2026-01-10T10:00:00Z',
      message: 'Esta revisión fue creada antes del historial comercial congelado.',
      onRetry: vi.fn(),
    };
    const { rerenderWith } = renderScreen({ breakdown: null, quoteAuthority: legacyAuthority });
    await user.click(screen.getByTestId('project-card-prj-1'));
    const unitBefore = screen.getByTestId('quote-legacy-unit-fi-legacy-1').textContent;
    expect(unitBefore).toContain('Definición: mod-1');
    expect(unitBefore).toContain('Material INTERIOR: mat-a');

    // Catalog names change afterwards (module + material): the persisted ids,
    // parameters and choices stay identical — only the explicitly marked
    // "etiqueta actual" hint follows the live catalog.
    rerenderWith({
      modules: [{ ...modules[0]!, name: 'Módulo Renombrado 2027' }],
      materials: materials.map((m) => ({ ...m, name: `${m.name} v2` })),
      breakdown: null,
      quoteAuthority: legacyAuthority,
    });
    const unitAfter = screen.getByTestId('quote-legacy-unit-fi-legacy-1').textContent;
    expect(unitAfter).toContain('Definición: mod-1');
    expect(unitAfter).toContain('Material INTERIOR: mat-a');
    expect(unitAfter).toContain('600×720×560 mm');
    expect(unitAfter).not.toContain('Bajo mesada');
    expect(unitAfter).toContain('(etiqueta actual)');
  });

  it('renders exact QuoteRevision furniture, dimensions and finishes from commercial snapshot instead of mutable project.items', async () => {
    const user = userEvent.setup();
    renderScreen({
      breakdown: sampleBreakdown,
      quoteAuthority: {
        kind: 'ready',
        revisionId: 'quote-2',
        revisionNumber: 2,
        status: 'accepted',
        projectName: 'Cocina congelada Q2',
        customerId: 'cust-bruno',
        customerName: 'Cliente congelado Q2',
        furnitureQuantity: 2,
        currency: 'MXN',
        capturedAt: '2026-09-10T12:00:00Z',
        onRetry: vi.fn(),
        snapshot: {
          schema: 'granete.quote-commercial-snapshot.v1',
          capturedAt: '2026-09-10T12:00:00Z',
          currency: 'MXN',
          customer: { id: 'cust-bruno', name: 'Cliente congelado Q2' },
          project: { id: 'prj-1', name: 'Cocina congelada Q2' },
          breakdown: {
            materialsCost: 100,
            edgeTotal: 20,
            hardwareTotal: 30,
            directCost: 150,
            laborModular: 50,
            laborFixedCost: 50,
            marginFactor: 1.35,
            salePrice: 270,
          },
          lines: [
            {
              quoteLineId: 'line-q2-1',
              quantity: 1,
              furnitureInstanceIds: ['fi-inst-1'],
              amounts: { materialsCost: 60, edgeTotal: 10, hardwareTotal: 15, directCost: 85, laborModular: 25, salePrice: 140 },
            },
            {
              quoteLineId: 'line-q2-2',
              quantity: 1,
              furnitureInstanceIds: ['fi-inst-2'],
              amounts: { materialsCost: 40, edgeTotal: 10, hardwareTotal: 15, directCost: 65, laborModular: 25, salePrice: 110 },
            },
          ],
          units: [
            {
              furnitureInstanceId: 'fi-inst-1',
              quoteLineId: 'line-q2-1',
              moduleCode: 'MOD-ALAC-01',
              moduleName: 'Alacena Especial Q2',
              lifecycleStatus: 'active',
              options: [
                { groupCode: 'FRENTE', groupLabel: 'Frente', choiceId: 'mat-c', choiceLabel: 'Nougat Acabado Q2' },
              ],
            },
            {
              furnitureInstanceId: 'fi-inst-2',
              quoteLineId: 'line-q2-2',
              moduleCode: 'MOD-GAB-02',
              moduleName: 'Gabinete 650 mm Q2',
              lifecycleStatus: 'active',
              options: [
                { groupCode: 'INTERIOR', groupLabel: 'Interior', choiceId: 'mat-b', choiceLabel: 'Roble Veta Q2' },
              ],
            },
          ],
        },
        items: [
          {
            furnitureInstanceId: 'fi-inst-1',
            furnitureDefinitionId: 'mod-alac',
            parameters: { widthMm: 800, heightMm: 720, depthMm: 350 },
            materialChoices: { FRENTE: 'mat-c' },
            lifecycleStatus: 'active',
          },
          {
            furnitureInstanceId: 'fi-inst-2',
            furnitureDefinitionId: 'mod-gab',
            parameters: { widthMm: 650, heightMm: 720, depthMm: 560 },
            materialChoices: { INTERIOR: 'mat-b' },
            lifecycleStatus: 'active',
          },
        ],
      },
    });

    await user.click(screen.getByTestId('project-card-prj-1'));
    const detail = screen.getByTestId('project-detail');

    // Historical Q2 content must be rendered from snapshot & items:
    expect(within(detail).getByText('Alacena Especial Q2 — MOD-ALAC-01')).toBeTruthy();
    expect(within(detail).getByText('Gabinete 650 mm Q2 — MOD-GAB-02')).toBeTruthy();
    expect(within(detail).getByText(/800×720×350 mm/)).toBeTruthy();
    expect(within(detail).getByText(/650×720×560 mm/)).toBeTruthy();
    expect(within(detail).getByText(/Frente: Nougat Acabado Q2/)).toBeTruthy();
    expect(within(detail).getByText(/Interior: Roble Veta Q2/)).toBeTruthy();

    // Mutable project item ("Bajo mesada — MOD-GAB-01") must NOT be rendered:
    expect(within(detail).queryByText(/Bajo mesada — MOD-GAB-01/)).toBeNull();

    // Mutable editing controls must NOT be present in historical revision view:
    expect(within(detail).queryByRole('button', { name: /Agregar mueble/i })).toBeNull();
    expect(within(detail).queryByRole('button', { name: /Quitar/i })).toBeNull();
    expect(within(detail).queryByLabelText(/Cantidad/i)).toBeNull();
    expect(within(detail).queryByLabelText(/Medida/i)).toBeNull();
    expect(screen.queryByTestId('project-level-options')).toBeNull();
    expect(screen.queryByTestId('project-quote-tools')).toBeNull();
  });

  it('preserves distinct lines with identical names and renders quantity > 1 with unit configurations', async () => {
    const user = userEvent.setup();
    renderScreen({
      breakdown: sampleBreakdown,
      quoteAuthority: {
        kind: 'ready',
        revisionId: 'quote-2',
        revisionNumber: 2,
        status: 'accepted',
        projectName: 'Cocina congelada Q2',
        customerId: 'cust-bruno',
        customerName: 'Cliente congelado Q2',
        furnitureQuantity: 3,
        currency: 'MXN',
        capturedAt: '2026-09-10T12:00:00Z',
        onRetry: vi.fn(),
        snapshot: {
          schema: 'granete.quote-commercial-snapshot.v1',
          capturedAt: '2026-09-10T12:00:00Z',
          currency: 'MXN',
          customer: { id: 'cust-bruno', name: 'Cliente congelado Q2' },
          project: { id: 'prj-1', name: 'Cocina congelada Q2' },
          breakdown: {
            materialsCost: 150,
            edgeTotal: 30,
            hardwareTotal: 40,
            directCost: 220,
            laborModular: 80,
            laborFixedCost: 50,
            marginFactor: 1.35,
            salePrice: 380,
          },
          lines: [
            {
              quoteLineId: 'line-identical-A',
              quantity: 1,
              furnitureInstanceIds: ['fi-single-1'],
              amounts: { materialsCost: 50, edgeTotal: 10, hardwareTotal: 10, directCost: 70, laborModular: 20, salePrice: 110 },
            },
            {
              quoteLineId: 'line-identical-B',
              quantity: 2,
              furnitureInstanceIds: ['fi-multi-u1', 'fi-multi-u2'],
              amounts: { materialsCost: 100, edgeTotal: 20, hardwareTotal: 30, directCost: 150, laborModular: 60, salePrice: 270 },
            },
          ],
          units: [
            {
              furnitureInstanceId: 'fi-single-1',
              quoteLineId: 'line-identical-A',
              moduleCode: 'MOD-GAB-01',
              moduleName: 'Gabinete Bajo',
              lifecycleStatus: 'active',
              options: [{ groupCode: 'FRENTE', groupLabel: 'Frente', choiceId: 'mat-a', choiceLabel: 'Blanco' }],
            },
            {
              furnitureInstanceId: 'fi-multi-u1',
              quoteLineId: 'line-identical-B',
              moduleCode: 'MOD-GAB-01',
              moduleName: 'Gabinete Bajo',
              lifecycleStatus: 'active',
              options: [{ groupCode: 'FRENTE', groupLabel: 'Frente', choiceId: 'mat-a', choiceLabel: 'Blanco' }],
            },
            {
              furnitureInstanceId: 'fi-multi-u2',
              quoteLineId: 'line-identical-B',
              moduleCode: 'MOD-GAB-01',
              moduleName: 'Gabinete Bajo',
              lifecycleStatus: 'active',
              options: [{ groupCode: 'FRENTE', groupLabel: 'Frente', choiceId: 'mat-b', choiceLabel: 'Roble Especial' }],
            },
          ],
        },
        items: [
          {
            furnitureInstanceId: 'fi-single-1',
            parameters: { widthMm: 600, heightMm: 720, depthMm: 560 },
            materialChoices: { FRENTE: 'mat-a' },
            lifecycleStatus: 'active',
          },
          {
            furnitureInstanceId: 'fi-multi-u1',
            parameters: { widthMm: 600, heightMm: 720, depthMm: 560 },
            materialChoices: { FRENTE: 'mat-a' },
            lifecycleStatus: 'active',
          },
          {
            furnitureInstanceId: 'fi-multi-u2',
            parameters: { widthMm: 650, heightMm: 720, depthMm: 560 },
            materialChoices: { FRENTE: 'mat-b' },
            lifecycleStatus: 'active',
          },
        ],
      },
    });

    await user.click(screen.getByTestId('project-card-prj-1'));
    const detail = screen.getByTestId('project-detail');

    // Both lines must be preserved as distinct cards (data-testid with quoteLineId):
    expect(screen.getByTestId('quote-line-line-identical-A')).toBeTruthy();
    expect(screen.getByTestId('quote-line-line-identical-B')).toBeTruthy();

    // Line B has 2 units with different width and options:
    const lineB = screen.getByTestId('quote-line-line-identical-B');
    expect(within(lineB).getByText(/600×720×560 mm/)).toBeTruthy();
    expect(within(lineB).getByText(/650×720×560 mm/)).toBeTruthy();
    expect(within(lineB).getByText(/Roble Especial/)).toBeTruthy();
  });

  it('shows dedicated loading and error states for items without fallback to mutable project.items', async () => {
    const user = userEvent.setup();
    const { unmount } = renderScreen({
      breakdown: null,
      quoteAuthority: { kind: 'loading' },
    });

    await user.click(screen.getByTestId('project-card-prj-1'));
    const detail = screen.getByTestId('project-detail');
    expect(within(detail).getByText(/Cargando muebles de la cotización/i)).toBeTruthy();
    expect(within(detail).queryByText(/Bajo mesada — MOD-GAB-01/)).toBeNull();

    unmount();

    const onRetry = vi.fn();
    renderScreen({
      breakdown: null,
      quoteAuthority: { kind: 'error', message: 'Fallo de red al obtener la cotización.', onRetry },
    });
    await user.click(screen.getByTestId('project-card-prj-1'));
    const errorDetail = screen.getByTestId('project-detail');
    expect(within(screen.getByTestId('project-items-error')).getByText(/Fallo de red al obtener la cotización/i)).toBeTruthy();
    expect(within(errorDetail).queryByText(/Bajo mesada — MOD-GAB-01/)).toBeNull();
    await user.click(within(errorDetail).getAllByRole('button', { name: /Reintentar/i })[0]!);
    expect(onRetry).toHaveBeenCalled();
  });

  it('Q2 accepted preserves names, materials and dimensions after mutable project and catalog are modified', async () => {
    const user = userEvent.setup();
    const mutatedProjects: Project[] = [
      {
        ...projects[0]!,
        name: 'Nombre Mutado Actual',
        items: [
          {
            id: 'item-mutated',
            moduleId: 'mod-mutated',
            quantity: 99,
            optionChoices: { INTERIOR: 'mat-mutated' },
          },
        ],
      },
    ];
    const mutatedModules: Module[] = [
      {
        id: 'mod-1',
        code: 'MOD-MUTATED',
        name: 'Nombre de Catálogo Cambiado',
        hardwareLines: [],
      },
    ];
    const mutatedMaterials: MaterialBoard[] = [
      {
        ...materials[0]!,
        name: 'Material Borrado o Cambiado',
      },
    ];

    renderScreen({
      projects: mutatedProjects,
      modules: mutatedModules,
      materials: mutatedMaterials,
      breakdown: sampleBreakdown,
      quoteAuthority: {
        kind: 'ready',
        revisionId: 'quote-2',
        revisionNumber: 2,
        status: 'accepted',
        projectName: 'Cocina congelada Q2',
        customerId: 'cust-bruno',
        customerName: 'Cliente congelado Q2',
        furnitureQuantity: 1,
        currency: 'MXN',
        capturedAt: '2026-09-10T12:00:00Z',
        onRetry: vi.fn(),
        snapshot: {
          schema: 'granete.quote-commercial-snapshot.v1' as const,
          capturedAt: '2026-09-10T12:00:00Z',
          currency: 'MXN',
          customer: { id: 'cust-bruno', name: 'Cliente congelado Q2' },
          project: { id: 'prj-1', name: 'Cocina congelada Q2' },
          breakdown: {
            materialsCost: 100,
            edgeTotal: 20,
            hardwareTotal: 30,
            directCost: 150,
            laborModular: 50,
            laborFixedCost: 50,
            marginFactor: 1.35,
            salePrice: 270,
          },
          lines: [
            {
              quoteLineId: 'line-q2-frozen',
              quantity: 1,
              furnitureInstanceIds: ['fi-frozen-1'],
              amounts: { materialsCost: 100, edgeTotal: 20, hardwareTotal: 30, directCost: 150, laborModular: 50, salePrice: 270 },
            },
          ],
          units: [
            {
              furnitureInstanceId: 'fi-frozen-1',
              quoteLineId: 'line-q2-frozen',
              moduleCode: 'MOD-ALAC-FROZEN',
              moduleName: 'Alacena Histórica Q2',
              lifecycleStatus: 'active',
              options: [
                { groupCode: 'FRENTE', groupLabel: 'Frente', choiceId: 'mat-c', choiceLabel: 'Nougat Acabado Q2' },
              ],
            },
          ],
        },
        items: [
          {
            furnitureInstanceId: 'fi-frozen-1',
            furnitureDefinitionId: 'mod-alac',
            parameters: { widthMm: 800, heightMm: 720, depthMm: 350 },
            materialChoices: { FRENTE: 'mat-c' },
            lifecycleStatus: 'active',
          },
        ],
      },
    });

    await user.click(screen.getByTestId('project-card-prj-1'));
    const detail = screen.getByTestId('project-detail');

    // Must strictly render the frozen snapshot names, options and dimensions:
    expect(within(detail).getByText('Alacena Histórica Q2 — MOD-ALAC-FROZEN')).toBeTruthy();
    expect(within(detail).getByText(/800×720×350 mm/)).toBeTruthy();
    expect(within(detail).getByText(/Frente: Nougat Acabado Q2/)).toBeTruthy();
    expect(within(detail).getByText('ID: fi-frozen-1')).toBeTruthy();
    expect(within(detail).getByText('Activa')).toBeTruthy();

    // Mutated project item & catalog names must NEVER be rendered:
    expect(within(detail).queryByText(/Nombre Mutado Actual/)).toBeNull();
    expect(within(detail).queryByText(/Nombre de Catálogo Cambiado/)).toBeNull();
    expect(within(detail).queryByText(/Material Borrado o Cambiado/)).toBeNull();
    expect(within(detail).queryByText(/item-mutated/)).toBeNull();
  });

  it('switches projects and authorities cleanly without mixing header and rows of different authorities', async () => {
    const authorityPrj1 = {
      kind: 'ready' as const,
      revisionId: 'quote-1-p1',
      revisionNumber: 1,
      status: 'accepted' as const,
      projectName: 'Cocina Ana Congelada Q1',
      customerId: 'cust-ana',
      customerName: 'Ana López',
      furnitureQuantity: 1,
      currency: 'MXN',
      capturedAt: '2026-09-10T12:00:00Z',
      onRetry: vi.fn(),
      snapshot: {
        schema: 'granete.quote-commercial-snapshot.v1' as const,
        capturedAt: '2026-09-10T12:00:00Z',
        currency: 'MXN',
        customer: { id: 'cust-ana', name: 'Ana López' },
        project: { id: 'prj-1', name: 'Cocina Ana Congelada Q1' },
        breakdown: {
          materialsCost: 50,
          edgeTotal: 10,
          hardwareTotal: 10,
          directCost: 70,
          laborModular: 30,
          laborFixedCost: 0,
          marginFactor: 1.35,
          salePrice: 135,
        },
        lines: [
          {
            quoteLineId: 'line-p1-1',
            quantity: 1,
            furnitureInstanceIds: ['fi-p1-1'],
            amounts: { materialsCost: 50, edgeTotal: 10, hardwareTotal: 10, directCost: 70, laborModular: 30, salePrice: 135 },
          },
        ],
        units: [
          {
            furnitureInstanceId: 'fi-p1-1',
            quoteLineId: 'line-p1-1',
            moduleCode: 'MOD-P1',
            moduleName: 'Mueble Proyecto 1',
            lifecycleStatus: 'active' as const,
            options: [],
          },
        ],
      },
      items: [
        {
          furnitureInstanceId: 'fi-p1-1',
          parameters: { widthMm: 600, heightMm: 720, depthMm: 560 },
          materialChoices: {},
          lifecycleStatus: 'active' as const,
        },
      ],
    };

    const authorityPrj2 = {
      kind: 'ready' as const,
      revisionId: 'quote-1-p2',
      revisionNumber: 1,
      status: 'accepted' as const,
      projectName: 'Dormitorio Bruno Congelado Q1',
      customerId: 'cust-bruno',
      customerName: 'Bruno',
      furnitureQuantity: 1,
      currency: 'USD',
      capturedAt: '2026-09-11T12:00:00Z',
      onRetry: vi.fn(),
      snapshot: {
        schema: 'granete.quote-commercial-snapshot.v1' as const,
        capturedAt: '2026-09-11T12:00:00Z',
        currency: 'USD',
        customer: { id: 'cust-bruno', name: 'Bruno' },
        project: { id: 'prj-2', name: 'Dormitorio Bruno Congelado Q1' },
        breakdown: {
          materialsCost: 80,
          edgeTotal: 20,
          hardwareTotal: 20,
          directCost: 120,
          laborModular: 50,
          laborFixedCost: 0,
          marginFactor: 1.4,
          salePrice: 240,
        },
        lines: [
          {
            quoteLineId: 'line-p2-1',
            quantity: 1,
            furnitureInstanceIds: ['fi-p2-1'],
            amounts: { materialsCost: 80, edgeTotal: 20, hardwareTotal: 20, directCost: 120, laborModular: 50, salePrice: 240 },
          },
        ],
        units: [
          {
            furnitureInstanceId: 'fi-p2-1',
            quoteLineId: 'line-p2-1',
            moduleCode: 'MOD-P2',
            moduleName: 'Placard Proyecto 2',
            lifecycleStatus: 'active' as const,
            options: [],
          },
        ],
      },
      items: [
        {
          furnitureInstanceId: 'fi-p2-1',
          parameters: { widthMm: 1200, heightMm: 2200, depthMm: 600 },
          materialChoices: {},
          lifecycleStatus: 'active' as const,
        },
      ],
    };

    const { rerenderWith } = renderScreen({
      openProjectId: 'prj-1',
      quoteAuthority: authorityPrj1,
    });

    // Detail for prj-1 is rendered:
    expect(screen.getByTestId('project-detail-chrome').textContent).toContain('Cocina Ana Congelada Q1');
    expect(screen.getByText('Mueble Proyecto 1 — MOD-P1')).toBeTruthy();
    expect(screen.getByText(/600×720×560 mm/)).toBeTruthy();

    // Now switch to prj-2 with authorityPrj2:
    rerenderWith({
      openProjectId: 'prj-2',
      quoteAuthority: authorityPrj2,
    });

    const chrome2 = screen.getByTestId('project-detail-chrome');
    expect(chrome2.textContent).toContain('Dormitorio Bruno Congelado Q1');
    expect(chrome2.textContent).not.toContain('Cocina Ana');

    expect(screen.getByText('Placard Proyecto 2 — MOD-P2')).toBeTruthy();
    expect(screen.getByText(/1200×2200×600 mm/)).toBeTruthy();
    expect(screen.queryByText('Mueble Proyecto 1 — MOD-P1')).toBeNull();
  });

  it('preserves usable pre-Q1 draft workflow to add items, modify dimensions, choices, and create Q1', async () => {
    const user = userEvent.setup();
    const onAddItem = vi.fn();
    const onOpenReconciliation = vi.fn();
    renderScreen({
      openProjectId: 'prj-1',
      quoteAuthority: {
        kind: 'empty',
        message: 'Esta obra todavía no tiene una revisión de cotización. Creá Q1 para fijar su verdad comercial.',
      },
      onAddItem,
      onOpenReconciliation,
    });

    const detail = screen.getByTestId('project-detail');
    // Pre-Q1 empty authority allows normal drafting:
    expect(within(detail).getByRole('button', { name: /Agregar mueble/i })).toBeTruthy();
    expect(within(detail).getByRole('button', { name: /Crear nueva revisión/i })).toBeTruthy();
    expect(within(detail).getByLabelText(/Medida/i)).toBeTruthy();
    expect(within(detail).getByLabelText(/Cantidad/i)).toBeTruthy();

    // Clicking "Crear nueva revisión" invokes reconciliation/creation flow:
    await user.click(within(detail).getByRole('button', { name: /Crear nueva revisión/i }));
    expect(onOpenReconciliation).toHaveBeenCalledWith('prj-1', undefined);
  });

  it('handles non-dollar currency, visible real zero, hidden amounts, and terminal units', async () => {
    const eurSnapshot: QuoteCommercialSnapshot = {
      schema: 'granete.quote-commercial-snapshot.v1',
      capturedAt: '2026-09-10T12:00:00Z',
      currency: 'EUR',
      customer: { id: 'cust-1', name: 'Cliente Euro' },
      project: { id: 'prj-1', name: 'Obra en Euros' },
      breakdown: {
        materialsCost: 100,
        edgeTotal: 20,
        hardwareTotal: 30,
        directCost: 150,
        laborModular: 50,
        laborFixedCost: 50,
        marginFactor: 1.35,
        salePrice: 270,
      },
      lines: [
        {
          quoteLineId: 'line-eur-zero',
          quantity: 1,
          furnitureInstanceIds: ['fi-zero'],
          amounts: { materialsCost: 0, edgeTotal: 0, hardwareTotal: 0, directCost: 0, laborModular: 0, salePrice: 0 },
        },
        {
          quoteLineId: 'line-eur-terminal',
          quantity: 0,
          furnitureInstanceIds: ['fi-term'],
          amounts: { materialsCost: 0, edgeTotal: 0, hardwareTotal: 0, directCost: 0, laborModular: 0, salePrice: 0 },
        },
      ],
      units: [
        {
          furnitureInstanceId: 'fi-zero',
          quoteLineId: 'line-eur-zero',
          moduleCode: 'MOD-ZERO',
          moduleName: 'Mueble Gratuito Promocional',
          lifecycleStatus: 'active',
          options: [],
        },
        {
          furnitureInstanceId: 'fi-term',
          quoteLineId: 'line-eur-terminal',
          moduleCode: 'MOD-TERM',
          moduleName: 'Mueble Retirado Histórico',
          lifecycleStatus: 'removed',
          options: [],
        },
      ],
    };

    const eurItems: QuoteRevisionItem[] = [
      {
        furnitureInstanceId: 'fi-zero',
        parameters: { widthMm: 500, heightMm: 720, depthMm: 400 },
        materialChoices: {},
        lifecycleStatus: 'active',
      },
      {
        furnitureInstanceId: 'fi-term',
        parameters: { widthMm: 600, heightMm: 720, depthMm: 400 },
        materialChoices: {},
        lifecycleStatus: 'removed',
      },
    ];

    // Case A: showCosts: true (authorized visibility). Legitimate zero price is preserved and shown with EUR currency:
    const { rerenderWith } = renderScreen({
      openProjectId: 'prj-1',
      showCosts: true,
      quoteAuthority: {
        kind: 'ready',
        revisionId: 'q-eur',
        revisionNumber: 2,
        status: 'accepted',
        projectName: 'Obra en Euros',
        customerId: 'cust-1',
        customerName: 'Cliente Euro',
        furnitureQuantity: 1,
        currency: 'EUR',
        capturedAt: '2026-09-10T12:00:00Z',
        onRetry: vi.fn(),
        snapshot: eurSnapshot,
        items: eurItems,
      },
    });

    const detail = screen.getByTestId('project-detail');

    // R1: Currency is EUR (not project's MXN) and uses standard money formatter
    const zeroLineEl = screen.getByTestId('quote-line-line-eur-zero');
    expect(within(zeroLineEl).getByText('$0.00 EUR')).toBeTruthy();

    // R3: Terminal unit has quantity 0, status badge "Retirada", UUID in technical metadata
    const termLine = screen.getByTestId('quote-line-line-eur-terminal');
    expect(within(termLine).getByText('Mueble Retirado Histórico — MOD-TERM')).toBeTruthy();
    expect(within(termLine).getByText('Retirada')).toBeTruthy();
    expect(within(termLine).getByText('0')).toBeTruthy();
    expect(within(termLine).getByText('ID: fi-term')).toBeTruthy();

    // R2: When showCosts is false (cost-blind / hidden amounts), price div must NOT be shown as $0.00
    rerenderWith({
      openProjectId: 'prj-1',
      showCosts: false,
      quoteAuthority: {
        kind: 'ready',
        revisionId: 'q-eur',
        revisionNumber: 2,
        status: 'accepted',
        projectName: 'Obra en Euros',
        customerId: 'cust-1',
        customerName: 'Cliente Euro',
        furnitureQuantity: 1,
        currency: 'EUR',
        capturedAt: '2026-09-10T12:00:00Z',
        onRetry: vi.fn(),
        snapshot: eurSnapshot,
        items: eurItems,
      },
    });

    const zeroLine = screen.getByTestId('quote-line-line-eur-zero');
    expect(within(zeroLine).queryByText('$0.00 EUR')).toBeNull();
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

  it('shows export-blocked message when preview blocked (draft keeps export out of chrome)', async () => {
    const user = userEvent.setup();
    renderScreen({
      breakdown: null,
      previewBlocked: true,
      missingGroups: ['FRENTE'],
    });

    await user.click(screen.getByTestId('project-card-prj-1'));
    // Draft: Optimizer is not a chrome button (factory path is Producción).
    expect(screen.queryByTestId('project-chrome-export')).toBeNull();    expect(
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

  it('filters the list by status chips (Fase 2 UI)', async () => {
    const user = userEvent.setup();
    renderScreen();

    expect(screen.getByTestId('project-status-chips')).toBeTruthy();
    expect(screen.getByTestId('project-card-prj-1')).toBeTruthy();
    expect(screen.getByTestId('project-card-prj-2')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /^Borrador$/i }));
    expect(screen.getByTestId('project-card-prj-1')).toBeTruthy();
    expect(screen.queryByTestId('project-card-prj-2')).toBeNull();

    await user.click(screen.getByRole('button', { name: /^Publicada$/i }));
    expect(screen.queryByTestId('project-card-prj-1')).toBeNull();
    expect(screen.getByTestId('project-card-prj-2')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /^Todas$/i }));
    expect(screen.getByTestId('project-card-prj-1')).toBeTruthy();
    expect(screen.getByTestId('project-card-prj-2')).toBeTruthy();
  });

  it('opens detail from openProjectId prop (Dashboard handoff)', () => {
    const { onSelectionChange } = renderScreen({ openProjectId: 'prj-1' });
    expect(screen.getByTestId('project-detail')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Cocina Ana' })).toBeTruthy();
    // URL→state restore must not echo back to the shell/router.
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it('deep-link restore does not echo to the router (no /quotes ↔ /quotes/:id loop)', async () => {
    const user = userEvent.setup();
    const { onSelectionChange } = renderScreen({ openProjectId: 'prj-1' });

    // Mount restore is silent: no initial null publish, no re-publish of the id.
    expect(screen.getByTestId('project-detail')).toBeTruthy();
    expect(onSelectionChange).not.toHaveBeenCalled();

    // Local intent still publishes — exactly once per user action.
    await user.click(
      screen.getByRole('button', { name: /Volver a la lista|^Lista$/i }),
    );
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    expect(onSelectionChange).toHaveBeenCalledWith(null);

    await user.click(screen.getByTestId('project-card-prj-1'));
    expect(onSelectionChange).toHaveBeenCalledTimes(2);
    expect(onSelectionChange).toHaveBeenCalledWith('prj-1');
  });

  it('keeps deep-linked selection while projects load async (direct refresh / post-login remount)', () => {
    const { onSelectionChange, rerenderWith } = renderScreen({
      openProjectId: 'prj-1',
      projects: [],
    });

    // Store fetch pending: the screen must not wipe the URL handoff by
    // publishing null while the list is still empty.
    expect(onSelectionChange).not.toHaveBeenCalled();

    // Projects arrive after mount; the detail opens without echoing.
    rerenderWith({ openProjectId: 'prj-1', projects });
    expect(screen.getByTestId('project-detail')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Cocina Ana' })).toBeTruthy();
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it('clears selection when the open project disappears (deleted elsewhere)', () => {
    const { onSelectionChange, rerenderWith } = renderScreen({
      openProjectId: 'prj-1',
    });
    expect(screen.getByTestId('project-detail')).toBeTruthy();

    rerenderWith({
      openProjectId: 'prj-1',
      projects: projects.filter((p) => p.id !== 'prj-1'),
    });
    expect(screen.queryByTestId('project-detail')).toBeNull();
    expect(onSelectionChange).toHaveBeenCalledWith(null);
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

  it('keeps project options inside main column so totals stay sidebar (layout)', async () => {
    // F058b: the detail layout lives in ProjectDetailView. After the section
    // extraction (ProjectOptionsSection / ProjectItemsSection /
    // ProjectTotalsAside) the markers live in different files, so we assert
    // against the rendered DOM order instead of source strings.
    const user = userEvent.setup();
    renderScreen();
    await user.click(screen.getByTestId('project-card-prj-1'));

    const detail = document.body;
    const opts = screen.getByTestId('project-level-options');
    const items = screen.getByLabelText('Ítems de cotización');
    const totals = screen.getByLabelText('Totales de cotización');
    const main = detail.querySelector('.project-detail__main');

    // options + items live inside the main column; totals is rendered after it.
    expect(main).not.toBeNull();
    expect(main!.contains(opts)).toBe(true);
    expect(main!.contains(items)).toBe(true);
    expect(main!.contains(totals)).toBe(false);
    // DOM order: options before items before totals.
    expect(opts.compareDocumentPosition(items)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(items.compareDocumentPosition(totals)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('opens create modal from requestCreateKey prop', () => {
    renderScreen({ requestCreateKey: 1 });
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Nueva cotización' })).toBeTruthy();
  });

  it('opens SM confirm modal before delete (Eliminar under Más)', async () => {
    const user = userEvent.setup();
    const { onDelete } = renderScreen();

    await user.click(screen.getByTestId('project-card-prj-1'));
    // Wave 4: destructive action is under Más, not a permanent chrome danger btn.
    expect(
      screen.queryByRole('button', { name: /^Eliminar$/i }),
    ).toBeNull();
    await user.click(screen.getByRole('button', { name: /^Más$/i }));
    await user.click(screen.getByRole('menuitem', { name: /^Eliminar$/i }));
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByRole('heading', { name: 'Eliminar cotización' }),
    ).toBeTruthy();
    expect(within(dialog).getByText(/Cocina Ana/)).toBeTruthy();
    await user.click(
      within(dialog).getByRole('button', { name: /^Eliminar$/i }),
    );
    expect(onDelete).toHaveBeenCalledWith('prj-1');
  });

  it('chrome keeps Presentar + Editar visible and parks overflow in Más', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByTestId('project-card-prj-1'));
    expect(screen.getByTestId('project-chrome-actions')).toBeTruthy();
    expect(screen.getByTestId('project-chrome-edit')).toBeTruthy();
    // Presentar moved to Más dropdown to reduce chrome clutter.
    await user.click(screen.getByRole('button', { name: /^Más$/i }));
    expect(screen.getByRole('menuitem', { name: /presentar/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /^Duplicar$/i })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /^Eliminar$/i })).toBeTruthy();
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
    expect(screen.queryByRole('button', { name: /Más acciones/i })).toBeNull();
    cleanup();

    // With templates + handler → button appears.
    renderScreen({
      projectTemplates: [sampleTemplate],
      onCreateFromTemplate: vi.fn(),
    });
    await user.click(screen.getByRole('button', { name: /Más acciones/i }));
    expect(screen.getByRole('menuitem', { name: 'Desde plantilla' })).toBeTruthy();

    await user.click(screen.getByRole('menuitem', { name: 'Desde plantilla' }));
    expect(screen.getByText('Crear cotización desde plantilla')).toBeTruthy();
    expect(screen.getByTestId('template-pick-tmpl-test')).toBeTruthy();
  });

  it('picker → choose template → fill name+customer → onCreateFromTemplate', async () => {
    const user = userEvent.setup();
    const { onCreateFromTemplate } = renderScreen({
      projectTemplates: [sampleTemplate],
    });

    await user.click(screen.getByRole('button', { name: /Más acciones/i }));
    await user.click(screen.getByRole('menuitem', { name: 'Desde plantilla' }));
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

  it('empty state shows "Crear desde plantilla" as secondary inside EmptyState', () => {
    renderScreen({
      projects: [],
      projectTemplates: [sampleTemplate],
    });
    const empty = screen.getByTestId('empty-state');
    const secondary = screen.getByTestId('empty-from-template-btn');
    expect(empty.contains(secondary)).toBe(true);
    expect(secondary.className).not.toMatch(/btn--primary/);
    // Header primary only — EmptyState primary + secondary without dual primary.
    const emptyPrimaries = empty.querySelectorAll('.btn--primary');
    expect(emptyPrimaries.length).toBe(1);
  });

  it('chrome shows "Guardar como plantilla" under Más and saves', async () => {
    const user = userEvent.setup();
    const { onSaveAsTemplate } = renderScreen({
      projectTemplates: [sampleTemplate],
    });

    await user.click(screen.getByTestId('project-card-prj-1'));
    await user.click(screen.getByRole('button', { name: /^Más$/i }));
    await user.click(
      screen.getByRole('menuitem', { name: /Guardar como plantilla/i }),
    );

    const nameInput = screen.getByTestId(
      'save-as-template-name',
    ) as HTMLInputElement;
    expect(nameInput.value).toBe('Cocina Ana'); // defaults to project name
    await user.clear(nameInput);
    await user.type(nameInput, 'Mi plantilla');
    await user.click(screen.getByRole('button', { name: /Guardar plantilla/i }));

    expect(onSaveAsTemplate).toHaveBeenCalledWith('prj-1', 'Mi plantilla');
  });

  it('PROD-0.2: plant-ready chrome prefers Abrir en Producción; factory exports leave quote Más', async () => {
    const user = userEvent.setup();
    const onOpenInProduction = vi.fn();
    const onMarkProduced = vi.fn();
    const accepted: Project = {
      ...projects[0]!,
      id: 'prj-acc',
      name: 'Obra aceptada',
      status: 'accepted',
    };
    renderScreen({
      projects: [accepted],
      projectEstimates: { 'prj-acc': 500 },
      onOpenInProduction,
      onMarkProduced,
      canMarkProduced: true,
      onExportProductionPack: vi.fn(),
      onExportHardware: vi.fn(),
      onExportPieceLabels: vi.fn(),
    });

    await user.click(screen.getByTestId('project-card-prj-acc'));

    const openBtn = screen.getByTestId('project-open-in-production');
    expect(openBtn.className).toMatch(/btn--primary/);
    // Factory actions leave chrome when hub is wired.
    expect(screen.queryByTestId('project-chrome-export')).toBeNull();
    expect(screen.queryByTestId('project-mark-produced')).toBeNull();

    await user.click(openBtn);
    expect(onOpenInProduction).toHaveBeenCalledWith('prj-acc');

    // Quote Más: hub entry only — no Optimizer / herrajes / etiquetas / pack.
    await user.click(screen.getByRole('button', { name: /^Más$/i }));
    expect(
      screen.getByRole('menuitem', { name: /Abrir en Producción/i }),
    ).toBeTruthy();
    expect(
      screen.queryByRole('menuitem', { name: /Exportar Optimizer/i }),
    ).toBeNull();
    expect(
      screen.queryByRole('menuitem', { name: /Lista de herrajes/i }),
    ).toBeNull();
    expect(
      screen.queryByRole('menuitem', { name: /Etiquetas/i }),
    ).toBeNull();
    expect(
      screen.queryByRole('menuitem', { name: /Pack producción/i }),
    ).toBeNull();
  });

  it('#642: an accepted QuoteRevision without a ProductionRelease is NOT plant-ready', async () => {
    const user = userEvent.setup();
    const onOpenInProduction = vi.fn();
    const draftWithAcceptedQuote: Project = {
      ...projects[0]!,
      id: 'prj-draft-q2',
      name: 'Obra con Q2 aceptada',
      status: 'draft',
    };
    renderScreen({
      projects: [draftWithAcceptedQuote],
      projectEstimates: { 'prj-draft-q2': 500 },
      onOpenInProduction,
      quoteAuthority: {
        kind: 'ready',
        revisionId: 'quote-2',
        revisionNumber: 2,
        status: 'accepted',
        projectName: 'Obra con Q2 aceptada',
        customerId: 'cust-ana',
        customerName: 'Ana López',
        furnitureQuantity: 1,
        currency: 'MXN',
        capturedAt: '2026-09-11T12:00:00Z',
        onRetry: vi.fn(),
      },
    });

    await user.click(screen.getByTestId('project-card-prj-draft-q2'));

    // Commercial acceptance alone never unlocks manufacturing surfaces.
    expect(screen.queryByTestId('project-open-in-production')).toBeNull();
    expect(screen.queryByTestId('project-chrome-export')).toBeNull();
    expect(screen.queryByTestId('project-mark-produced')).toBeNull();
    expect(onOpenInProduction).not.toHaveBeenCalled();
  });

  it('#642: a canonical ProductionRelease unlocks the production chrome while Project.status stays draft', async () => {
    const user = userEvent.setup();
    const onOpenInProduction = vi.fn();
    const releasedDraft: Project = {
      ...projects[0]!,
      id: 'prj-released-draft',
      name: 'Obra liberada P1',
      status: 'draft',
      resolvedProductionRelease: {
        source: 'canonical',
        releaseId: 'rel-p1',
        releaseNumber: 1,
        quoteRevisionId: 'quote-2',
        designRevisionId: 'rev-r2',
        designRevisionNumber: 2,
        frozenRouting: true,
        status: 'active',
      },
    };
    renderScreen({
      projects: [releasedDraft],
      projectEstimates: { 'prj-released-draft': 500 },
      onOpenInProduction,
      onMarkProduced: vi.fn(),
      canMarkProduced: true,
      quoteAuthority: {
        kind: 'ready',
        revisionId: 'quote-2',
        revisionNumber: 2,
        status: 'accepted',
        projectName: 'Obra liberada P1',
        customerId: 'cust-ana',
        customerName: 'Ana López',
        furnitureQuantity: 1,
        currency: 'MXN',
        capturedAt: '2026-09-11T12:00:00Z',
        onRetry: vi.fn(),
      },
    });

    await user.click(screen.getByTestId('project-card-prj-released-draft'));

    // The canonical manufacturing authority — not Project.status, not the
    // accepted quote alone — unlocks production.
    const openBtn = screen.getByTestId('project-open-in-production');
    expect(openBtn.className).toMatch(/btn--primary/);
    // mark-produced stays bound to the literal project lifecycle (draft here).
    expect(screen.queryByTestId('project-mark-produced')).toBeNull();

    await user.click(openBtn);
    expect(onOpenInProduction).toHaveBeenCalledWith('prj-released-draft');
  });

  it('#642: a legacy accepted Project.status never bypasses the release authority on a modern project', async () => {
    const user = userEvent.setup();
    const onOpenInProduction = vi.fn();
    const legacyStampedModern: Project = {
      ...projects[0]!,
      id: 'prj-legacy-stamp',
      name: 'Obra con stamp legacy',
      status: 'accepted',
    };
    renderScreen({
      projects: [legacyStampedModern],
      projectEstimates: { 'prj-legacy-stamp': 500 },
      onOpenInProduction,
      quoteAuthority: {
        kind: 'ready',
        revisionId: 'quote-3',
        revisionNumber: 3,
        status: 'published',
        projectName: 'Obra con stamp legacy',
        customerId: 'cust-ana',
        customerName: 'Ana López',
        furnitureQuantity: 1,
        currency: 'MXN',
        capturedAt: '2026-09-11T12:00:00Z',
        onRetry: vi.fn(),
      },
    });

    await user.click(screen.getByTestId('project-card-prj-legacy-stamp'));

    // Modern project (Digital Thread quote revisions exist): the accidental
    // legacy status must NOT silently authorize production without a
    // canonical ProductionRelease — the UI tells the same story as the
    // server, which rejects the release command.
    expect(screen.queryByTestId('project-open-in-production')).toBeNull();
    expect(screen.queryByTestId('project-chrome-export')).toBeNull();
    expect(onOpenInProduction).not.toHaveBeenCalled();
  });

  it.each([
    ['loading', { kind: 'loading' as const }],
    ['error', { kind: 'error' as const, message: 'No se pudo cargar la autoridad comercial.', onRetry: vi.fn() }],
  ])('#642: quote authority %s is UNKNOWN, not pre-DT — legacy fallback fails closed', async (_label, quoteAuthority) => {
    const user = userEvent.setup();
    const onOpenInProduction = vi.fn();
    const stampedWhileUnknown: Project = {
      ...projects[0]!,
      id: 'prj-unknown-authority',
      name: 'Obra con autoridad desconocida',
      status: 'accepted',
    };
    renderScreen({
      projects: [stampedWhileUnknown],
      projectEstimates: { 'prj-unknown-authority': 500 },
      onOpenInProduction,
      quoteAuthority,
    });

    await user.click(screen.getByTestId('project-card-prj-unknown-authority'));

    // A residual legacy status must never unlock production while we still
    // don't know whether a modern Digital Thread quote exists.
    expect(screen.queryByTestId('project-open-in-production')).toBeNull();
    expect(screen.queryByTestId('project-chrome-export')).toBeNull();
    expect(onOpenInProduction).not.toHaveBeenCalled();
  });

  it('#642: true pre-DT projects keep the legacy accepted/produced compatibility', async () => {
    const user = userEvent.setup();
    const onOpenInProduction = vi.fn();
    const preDT: Project = {
      ...projects[0]!,
      id: 'prj-predt',
      name: 'Obra pre-Digital Thread',
      status: 'accepted',
    };
    renderScreen({
      projects: [preDT],
      projectEstimates: { 'prj-predt': 500 },
      onOpenInProduction,
      // No Digital Thread quote revisions exist: compatibility-only branch.
      quoteAuthority: { kind: 'empty', message: 'Esta obra todavía no tiene una revisión de cotización.' },
    });

    await user.click(screen.getByTestId('project-card-prj-predt'));

    const openBtn = screen.getByTestId('project-open-in-production');
    expect(openBtn.className).toMatch(/btn--primary/);
    await user.click(openBtn);
    expect(onOpenInProduction).toHaveBeenCalledWith('prj-predt');
  });

  it('management modal lists templates with a delete button', async () => {
    const user = userEvent.setup();
    const { onDeleteTemplate } = renderScreen({
      projectTemplates: [sampleTemplate],
    });

    await user.click(screen.getByRole('button', { name: /Más acciones/i }));
    await user.click(screen.getByRole('menuitem', { name: 'Gestionar plantillas' }));
    await user.click(screen.getByTestId('delete-template-tmpl-test'));

    expect(onDeleteTemplate).toHaveBeenCalledWith('tmpl-test');
  });

  it('does not auto-open Proyectar after add; shows place cue banner', async () => {
    const user = userEvent.setup();
    const onUpdateKitchenLayout = vi.fn();
    renderScreen({ onUpdateKitchenLayout });

    await user.click(screen.getByTestId('project-card-prj-1'));
    expect(screen.getByTestId('project-detail')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /Agregar mueble/i }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Agregar' }));

    // Studio must stay closed — cotizar ≠ proyectar.
    expect(screen.queryByTestId('project-spatial-studio')).toBeNull();
    expect(screen.getByTestId('project-detail')).toBeTruthy();

    const cue = screen.getByTestId('project-post-add-place-cue');
    expect(cue.getAttribute('role')).toBe('status');
    expect(cue.textContent).toMatch(/Mueble agregado a la cotización/i);

    await user.click(screen.getByTestId('project-post-add-place-cue-open'));
    expect(screen.getByTestId('project-spatial-studio')).toBeTruthy();
    expect(
      screen.getByTestId('spatial-studio-filter-unplaced').className,
    ).toMatch(/filter--on/);
  });
});


describe('F101 page chrome migration', () => {
  it('places the Cotizaciones action hierarchy above its search and filters', () => {
    renderScreen();
    const header = screen.getByTestId('page-header');
    const toolbar = screen.getByTestId('page-toolbar');
    expect(header.compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(header).getByRole('button', { name: /Nueva cotización/i })).toBeTruthy();
    expect(within(toolbar).getByRole('searchbox', { name: 'Buscar cotizaciones' })).toBeTruthy();
  });
});

describe('#642 / 2A commercial summaries dataset states', () => {
  const summaryFor = (overrides: Partial<ProjectCommercialSummary>): ProjectCommercialSummary => ({
    projectId: 'prj-1',
    projectName: 'Cocina Ana',
    quoteStatus: 'accepted',
    quoteRevisionNumber: 2,
    isLegacy: false,
    furnitureQuantity: 1,
    saleTotal: 202.5,
    currency: 'MXN',
    commercialActivityAt: '2026-07-12T00:00:00.000Z',
    ...overrides,
  });

  it('BLOCKER 5: request error is not "Sin cotización" — banner, disabled filters, no legacy price', async () => {
    const user = userEvent.setup();
    renderScreen({ commercialSummariesStatus: 'error' });

    // The explicit error banner is rendered with retry.
    expect(screen.getByTestId('commercial-summaries-error')).toBeTruthy();
    expect(screen.getByText('No se pudo cargar la información comercial.')).toBeTruthy();

    // No per-card "Sin cotización" verdict and no legacy estimate price.
    const grid = screen.getByLabelText('Lista de cotizaciones');
    expect(within(grid).queryByText('Sin cotización')).toBeNull();
    expect(within(grid).queryByText('$202.50 MXN')).toBeNull();

    // Commercial filters are disabled while the dataset is failed.
    const chips = screen.getByTestId('project-status-chips');
    for (const chip of within(chips).getAllByRole('button')) {
      expect((chip as HTMLButtonElement).disabled).toBe(true);
    }
    await user.click(within(chips).getByRole('button', { name: 'Sin cotización' }));
    // The filter did not apply: every project stays visible.
    expect(screen.getByTestId('project-card-prj-1')).toBeTruthy();
    expect(screen.getByTestId('project-card-prj-2')).toBeTruthy();

    // Card badges honestly report unavailability.
    expect(screen.getAllByTestId('commercial-status-badge-error').length).toBe(2);
  });

  it('BLOCKER 5: loading keeps navigation identity only, badge pending, no commercial truth', () => {
    renderScreen({ commercialSummaries: undefined, commercialSummariesStatus: 'loading' });

    expect(screen.getAllByTestId('commercial-status-badge-loading').length).toBe(2);
    expect(screen.queryByText('$202.50 MXN')).toBeNull();
    // Mutable quantity and customer identity stay hidden while pending.
    expect(screen.queryByText(/mueble/)).toBeNull();
    expect(screen.queryByText('Ana López')).toBeNull();
    expect(within(screen.getByLabelText('Lista de cotizaciones')).queryByText('Sin cotización')).toBeNull();
  });

  it('ready + quoteStatus none renders current identity with honest "Sin cotización"', () => {
    renderScreen({
      commercialSummaries: new Map([
        ['prj-1', summaryFor({ quoteStatus: 'none', quoteRevisionNumber: undefined, saleTotal: undefined, furnitureQuantity: 0, commercialActivityAt: null })],
        ['prj-2', summaryFor({ projectId: 'prj-2', projectName: 'Dormitorio', quoteStatus: 'none', quoteRevisionNumber: undefined, saleTotal: undefined, furnitureQuantity: 0, commercialActivityAt: null })],
      ]),
      commercialSummariesStatus: 'ready',
    });

    const card = screen.getByTestId('project-card-prj-1');
    expect(within(card).getByText('Sin cotización')).toBeTruthy();
    expect(within(card).getByText('Cocina Ana')).toBeTruthy();
    expect(within(card).getByText('Ana López')).toBeTruthy();
    expect(within(card).getByText('0 muebles')).toBeTruthy();
    expect(within(card).queryByText(/Act\./)).toBeNull();
  });

  it('BLOCKER 2: a valid snapshot owns the frozen card identity (name, customer, currency)', () => {
    renderScreen({
      commercialSummaries: new Map([
        ['prj-1', summaryFor({
          projectName: 'Cocina López (congelada)',
          customerName: 'Ana López (congelada)',
          currency: 'EUR',
          saleTotal: 150,
        })],
        ['prj-2', summaryFor({ projectId: 'prj-2', projectName: 'Dormitorio', quoteStatus: 'published', quoteRevisionNumber: 1, saleTotal: null })],
      ]),
      commercialSummariesStatus: 'ready',
    });

    const card = screen.getByTestId('project-card-prj-1');
    expect(within(card).getByText('Cocina López (congelada)')).toBeTruthy();
    expect(within(card).getByText('Ana López (congelada)')).toBeTruthy();
    expect(within(card).queryByText('Cocina Ana')).toBeNull();
  });

  it('BLOCKER 3/§11: a historical revision whose only unit is removed shows 0 muebles', () => {
    renderScreen({
      commercialSummaries: new Map([
        ['prj-1', summaryFor({ furnitureQuantity: 0, quoteStatus: 'accepted' })],
        ['prj-2', summaryFor({ projectId: 'prj-2', projectName: 'Dormitorio', quoteStatus: 'published', quoteRevisionNumber: 1, saleTotal: null })],
      ]),
      commercialSummariesStatus: 'ready',
    });

    expect(within(screen.getByTestId('project-card-prj-1')).getByText('0 muebles')).toBeTruthy();
  });

  it('ready + legacy revision shows the legacy badge without fabricating a frozen price', () => {
    renderScreen({
      commercialSummaries: new Map([
        ['prj-1', summaryFor({ quoteStatus: 'published', isLegacy: true, saleTotal: undefined, furnitureQuantity: 1 })],
        ['prj-2', summaryFor({ projectId: 'prj-2', projectName: 'Dormitorio', quoteStatus: 'published', quoteRevisionNumber: 1, saleTotal: null })],
      ]),
      commercialSummariesStatus: 'ready',
    });

    const card = screen.getByTestId('project-card-prj-1');
    expect(within(card).getByText('Cotización anterior')).toBeTruthy();
    expect(within(card).queryByText('$202.50 MXN')).toBeNull();
  });

  it('ready + accepted with newer draft surfaces "Q3 en borrador" secondary line', () => {
    renderScreen({
      commercialSummaries: new Map([
        ['prj-1', summaryFor({ quoteStatus: 'accepted', quoteRevisionNumber: 2, activeDraftRevisionNumber: 3 })],
        ['prj-2', summaryFor({ projectId: 'prj-2', projectName: 'Dormitorio', quoteStatus: 'published', quoteRevisionNumber: 1, saleTotal: null })],
      ]),
      commercialSummariesStatus: 'ready',
    });

    expect(within(screen.getByTestId('project-card-prj-1')).getByText('Q3 en borrador')).toBeTruthy();
  });
});
