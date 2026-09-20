/**
 * @vitest-environment jsdom
 *
 * Cut Plan & Optimization Panel (F115) — Native 2D Cut Plan, Warehouse Requisition & Exports.
 * F126: estrategia de corte (sierra vs CNC nesting) y despacho exclusivo de export.
 */
import { describe, expect, it, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import {
  optimizeCutPlan,
  type Catalog,
  type CutPlan,
  type CutPlanSheet,
  type MaterialBoard,
  type ProductionCutRow,
  type Project,
} from '@granete/domain';
import { ProductionOrderOptimizationPanel } from './ProductionOrderOptimizationPanel';
import { loadReleaseCutPlan, saveReleaseCutPlan } from '@granete/storage';

/** Storage fake whose setItem can be told to fail (quota / rejection). */
function createStorageStub(): Storage & { failSetItem: null | 'quota' | 'reject' } {
  const store = new Map<string, string>();
  const stub = {
    failSetItem: null as null | 'quota' | 'reject',
    get length() {
      return store.size;
    },
    key: (index: number) => [...store.keys()][index] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (stub.failSetItem) {
        const err = new Error('persist failed');
        err.name = stub.failSetItem === 'quota' ? 'QuotaExceededError' : 'SecurityError';
        throw err;
      }
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
  };
  return stub as Storage & { failSetItem: null | 'quota' | 'reject' };
}

function project(): Project {
  return {
    id: 'p1',
    name: 'Cocina Ana',
    customerId: 'c1',
    currency: 'MXN',
    marginFactor: 1.35,
    laborFixedCost: 0,
    status: 'accepted',
    items: [{ id: 'i1', moduleId: 'm1', quantity: 2, optionChoices: {} }],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

const fixtureBoard: MaterialBoard = {
  id: 'mat-mdf18',
  code: 'MDF18',
  name: 'MDF Blanco 18mm',
  widthMm: 1830,
  lengthMm: 2440,
  thicknessMm: 18,
  grainDefault: true,
  boardPrice: 100,
  wastePercent: 10,
  costPerM2: 25,
  active: true,
};

function fixtureCatalog(): Catalog {
  return {
    materials: [fixtureBoard],
    edges: [],
    hardware: [],
    optionGroups: [],
    modules: [],
  };
}

/**
 * Real saw sheet from the optimizer: carries a valid cutProgram, so the
 * sequence sidebar is governed by the validated projection (#650 R3).
 */
function sawSheetFixture(): CutPlanSheet {
  const rows: ProductionCutRow[] = [
    {
      description: 'LAT-01 · Lateral · M01',
      partCode: 'LAT-01',
      partName: 'Lateral',
      moduleCode: 'M01',
      materialName: 'MDF Blanco 18mm',
      lengthMm: 800,
      widthMm: 500,
      quantity: 1,
      grain: 1,
      L1: 0,
      L2: 0,
      W1: 0,
      W2: 0,
    },
  ];
  const plan = optimizeCutPlan('p1', rows, [fixtureBoard], {
    sawKerfMm: 4,
    trim: { topMm: 10, bottomMm: 10, leftMm: 10, rightMm: 10 },
    deductEdgeBand: true,
    allowRotationNoGrain: true,
    minRemnantWidthMm: 400,
    minRemnantLengthMm: 600,
    preferLongitudinalRips: true,
    heuristic: 'guillotine-hybrid',
    cutStrategy: 'saw-guillotine',
  });
  const sheet = plan.sheets[0]!;
  expect(sheet.cutProgram).toBeDefined();
  expect(sheet.instructions.length).toBeGreaterThan(0);
  return sheet;
}

function cutPlanFixture(strategy: 'saw-guillotine' | 'cnc-nesting'): CutPlan {
  return {
    id: 'cutplan-1',
    projectId: 'p1',
    projectName: 'Cocina Ana',
    generatedAt: '2026-08-20T00:00:00.000Z',
    version: 1,
    isFrozen: false,
    config: {
      sawKerfMm: 4,
      trim: { topMm: 10, bottomMm: 10, leftMm: 10, rightMm: 10 },
      deductEdgeBand: true,
      allowRotationNoGrain: true,
      minRemnantWidthMm: 400,
      minRemnantLengthMm: 600,
      preferLongitudinalRips: true,
      cutStrategy: strategy,
      ...(strategy === 'cnc-nesting' ? { toolSpacingMm: 8 } : {}),
    },
    sheets: [
      strategy === 'saw-guillotine'
        ? sawSheetFixture()
        : {
            sheetIndex: 0,
            strategy,
            materialCode: 'MDF18',
            materialName: 'MDF Blanco 18mm',
            sheetWidthMm: 1830,
            sheetLengthMm: 2440,
            thicknessMm: 18,
            pieces: [
              {
                id: 'LAT-01-1-s0',
                partCode: 'LAT-01',
                partName: 'Lateral',
                moduleCode: 'M01',
                labelRef: 'A1',
                materialName: 'MDF Blanco 18mm',
                materialCode: 'MDF18',
                xMm: 10,
                yMm: 10,
                lengthMm: 800,
                widthMm: 500,
                originalLengthMm: 800,
                originalWidthMm: 500,
                grain: 1,
                rotated: false,
                L1: 1,
                L2: 0,
                W1: 0,
                W2: 0,
                thicknessMm: 18,
                sheetIndex: 0,
                stripIndex: 0,
                cutSequenceNumber: 1,
                status: 'pending',
              },
            ],
            remnants: [],
            instructions: [],
            netPiecesAreaM2: 0.4,
            grossSheetAreaM2: 4.47,
            usableRemnantAreaM2: 0,
            wasteAreaM2: 4.07,
            wastePercent: 91,
            yieldPercent: 9,
          },
    ],
    stats: {
      totalSheets: 1,
      totalPieces: 1,
      totalGrossAreaM2: 4.47,
      totalNetPiecesAreaM2: 0.4,
      totalUsefulRemnantsAreaM2: 0,
      totalWasteAreaM2: 4.07,
      globalWastePercent: 91,
      globalYieldPercent: 9,
      byMaterial: [],
    },
    usefulRemnants: [],
  };
}

function cutRowsFixture() {
  return [
    {
      quantity: 1,
      lengthMm: 800,
      widthMm: 500,
      description: 'Lateral · M01',
      materialName: 'MDF Blanco 18mm',
      materialCode: 'MDF18',
      grain: 1 as const,
      L1: 1 as const,
      L2: 0 as const,
      W1: 0 as const,
      W2: 0 as const,
      partCode: 'LAT-01',
      partName: 'Lateral',
      moduleCode: 'M01',
      thicknessMm: 18,
    },
  ];
}

afterEach(() => cleanup());

describe('ProductionOrderOptimizationPanel (F115)', () => {
  it('renders cut plan parameters, warehouse requisition, workspace and exports area', () => {
    render(
      <ProductionOrderOptimizationPanel
        project={project()}
        catalog={null}
        cutRows={[]}
      />,
    );
    expect(screen.getByTestId('prod-hub-optimizacion')).toBeTruthy();
    expect(screen.getByTestId('prod-opt-config')).toBeTruthy();
    expect(screen.getByTestId('prod-opt-summary')).toBeTruthy();
    expect(screen.getByTestId('prod-opt-workspace')).toBeTruthy();
    expect(screen.getByTestId('prod-opt-exports')).toBeTruthy();
    expect(screen.getByTestId('prod-opt-export-pdf-manual')).toBeTruthy();
  });
});

describe('ProductionOrderOptimizationPanel — default del taller (F133)', () => {
  it('obra sin plan arranca con el default del taller (nesting)', () => {
    render(
      <ProductionOrderOptimizationPanel
        project={project()}
        catalog={null}
        cutRows={[]}
        defaultCutStrategy="cnc-nesting"
      />,
    );
    expect((screen.getByTestId('prod-opt-strategy-nesting') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('prod-opt-strategy-saw') as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText('Espaciado fresa (mm)')).toBeTruthy();
  });

  it('sin default y sin plan sigue siendo sierra (retrocompatible)', () => {
    render(
      <ProductionOrderOptimizationPanel
        project={project()}
        catalog={null}
        cutRows={[]}
      />,
    );
    expect((screen.getByTestId('prod-opt-strategy-saw') as HTMLInputElement).checked).toBe(true);
  });

  it('el plan de la obra gana sobre el default del taller', () => {
    render(
      <ProductionOrderOptimizationPanel
        project={{ ...project(), cutPlan: cutPlanFixture('saw-guillotine') }}
        catalog={null}
        cutRows={[]}
        defaultCutStrategy="cnc-nesting"
      />,
    );
    expect((screen.getByTestId('prod-opt-strategy-saw') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText('Disco / Kerf (mm)')).toBeTruthy();
  });
});

describe('ProductionOrderOptimizationPanel — estrategia de corte (F126)', () => {
  it('el selector cambia la config: nesting muestra espaciado de fresa y oculta el kerf', () => {
    render(
      <ProductionOrderOptimizationPanel
        project={project()}
        catalog={null}
        cutRows={[]}
      />,
    );

    expect(screen.getByText('Disco / Kerf (mm)')).toBeTruthy();
    expect(screen.queryByText('Espaciado fresa (mm)')).toBeNull();

    fireEvent.click(screen.getByTestId('prod-opt-strategy-nesting'));

    expect(screen.getByText('Espaciado fresa (mm)')).toBeTruthy();
    expect(screen.queryByText('Disco / Kerf (mm)')).toBeNull();
    expect((screen.getByTestId('prod-opt-strategy-nesting') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('prod-opt-strategy-saw') as HTMLInputElement).checked).toBe(false);
  });

  it('plan sierra: exporta PDF, Optimizer XLSX y PTX (unificado y por material), y no ofrece DXF', () => {
    const onExportCutPlanPtx = vi.fn();
    render(
      <ProductionOrderOptimizationPanel
        project={{ ...project(), cutPlan: cutPlanFixture('saw-guillotine') }}
        catalog={null}
        cutRows={[]}
        onExportOptimizer={() => {}}
        onExportCutPlanDxf={() => {}}
        onExportCutPlanPtx={onExportCutPlanPtx}
      />,
    );

    expect(screen.getByTestId('prod-opt-export-pdf-manual')).toBeTruthy();
    expect(screen.getByTestId('prod-opt-export-optimizer-xlsx')).toBeTruthy();
    expect(screen.getByTestId('prod-opt-export-ptx')).toBeTruthy();
    expect(screen.queryByTestId('prod-opt-export-dxf-sheets')).toBeNull();
    expect(screen.queryByTestId('prod-opt-export-dxf-pieces')).toBeNull();

    // Default unificado: una sola descarga con el modo seleccionado.
    fireEvent.click(screen.getByTestId('prod-opt-export-ptx'));
    expect(onExportCutPlanPtx).toHaveBeenCalledWith(expect.anything(), 'unified', undefined);

    // Cambio explícito a por material: la elección operacional viaja en el click.
    fireEvent.click(screen.getByTestId('prod-opt-ptx-mode-by-material'));
    fireEvent.click(screen.getByTestId('prod-opt-export-ptx'));
    expect(onExportCutPlanPtx).toHaveBeenCalledWith(expect.anything(), 'by-material', undefined);
  });

  it('plan nesting: exporta DXF (tableros y piezas) y oculta PDF/Optimizer', () => {
    const onExportCutPlanDxf = vi.fn();
    render(
      <ProductionOrderOptimizationPanel
        project={{ ...project(), cutPlan: cutPlanFixture('cnc-nesting') }}
        catalog={null}
        cutRows={[]}
        onExportOptimizer={() => {}}
        onExportCutPlanDxf={onExportCutPlanDxf}
      />,
    );

    expect(screen.getByTestId('prod-opt-export-dxf-sheets')).toBeTruthy();
    expect(screen.getByTestId('prod-opt-export-dxf-pieces')).toBeTruthy();
    expect(screen.queryByTestId('prod-opt-export-pdf-manual')).toBeNull();
    expect(screen.queryByTestId('prod-opt-export-optimizer-xlsx')).toBeNull();

    fireEvent.click(screen.getByTestId('prod-opt-export-dxf-sheets'));
    expect(onExportCutPlanDxf).toHaveBeenCalledWith(expect.anything(), 'sheets');

    fireEvent.click(screen.getByTestId('prod-opt-export-dxf-pieces'));
    expect(onExportCutPlanDxf).toHaveBeenCalledWith(expect.anything(), 'pieces');
  });

  it('plan nesting sin secuencia: no renderiza el panel de secuencia de corte', () => {
    render(
      <ProductionOrderOptimizationPanel
        project={{ ...project(), cutPlan: cutPlanFixture('cnc-nesting') }}
        catalog={null}
        cutRows={cutRowsFixture()}
      />,
    );

    expect(screen.queryByText('Refilar bordes perimetrales')).toBeNull();
  });

  it('plan sierra: muestra la secuencia de corte del tablero activo', () => {
    render(
      <ProductionOrderOptimizationPanel
        project={{ ...project(), cutPlan: cutPlanFixture('saw-guillotine') }}
        catalog={null}
        cutRows={cutRowsFixture()}
      />,
    );

    // Real program-driven sequence: the four trim passes come first.
    const sidebar = screen.getByTestId('prod-opt-cut-sequence-sidebar');
    expect(sidebar.querySelectorAll('li').length).toBeGreaterThanOrEqual(5);
    expect(sidebar.textContent).toContain('Refilar borde');
  });
});

describe('ProductionOrderOptimizationPanel — export PTX: salida configurada, modo y preview', () => {
  function multiMaterialPlan(): CutPlan {
    const base = cutPlanFixture('saw-guillotine');
    const secondSheet = {
      ...base.sheets[0]!,
      sheetIndex: 1,
      materialCode: 'ROBLE_NORD',
      materialName: 'Roble Nórdico 18mm',
      pieces: base.sheets[0]!.pieces.map((p) => ({
        ...p,
        materialCode: 'ROBLE_NORD',
        materialName: 'Roble Nórdico 18mm',
        sheetIndex: 1,
      })),
    };
    return {
      ...base,
      sheets: [base.sheets[0]!, secondSheet],
      stats: { ...base.stats, totalSheets: 2, totalPieces: 2 },
    };
  }

  it('sin salida de máquina configurada lo dice honesto y el preview unificado muestra 1 archivo', () => {
    render(
      <ProductionOrderOptimizationPanel
        project={{ ...project(), cutPlan: cutPlanFixture('saw-guillotine') }}
        catalog={null}
        cutRows={[]}
      />,
    );
    expect(screen.getByTestId('prod-opt-cutting-output').textContent).toContain(
      'PTX genérico v1.14',
    );
    expect(screen.getByTestId('prod-opt-ptx-preview').textContent).toContain(
      'Se descargará 1 archivo PTX',
    );
    expect(screen.queryByTestId('prod-opt-cutting-output-blocked')).toBeNull();
  });

  it('muestra la salida configurada derivada del MachineOutputSelection real', () => {
    render(
      <ProductionOrderOptimizationPanel
        project={{ ...project(), cutPlan: cutPlanFixture('saw-guillotine') }}
        catalog={null}
        cutRows={[]}
        cuttingOutputTarget={{
          status: 'configured-ready',
          machineLabel: 'HOLZMA (HOMAG) HPP 250',
          formatLabel: 'PTX',
          profileLabel: 'ptx-cadmatic-5@r1',
          ready: true,
          blockerMessage: '',
        }}
      />,
    );
    expect(screen.getByTestId('prod-opt-cutting-output').textContent).toContain(
      'HOLZMA (HOMAG) HPP 250 · PTX · ptx-cadmatic-5@r1',
    );
  });

  it('salida configurada bloqueada: muestra la razón ANTES de descargar y deshabilita el botón', () => {
    render(
      <ProductionOrderOptimizationPanel
        project={{ ...project(), cutPlan: cutPlanFixture('saw-guillotine') }}
        catalog={null}
        cutRows={[]}
        cuttingOutputTarget={{
          status: 'stale',
          machineLabel: 'HOLZMA (HOMAG) HPP 250',
          formatLabel: 'PTX',
          profileLabel: 'ptx-cadmatic-4@r1',
          ready: false,
          blockerMessage:
            'No se puede generar este archivo todavía: faltan datos confirmados del formato (fileExtension).',
        }}
      />,
    );
    const blocked = screen.getByTestId('prod-opt-cutting-output-blocked');
    expect(blocked.textContent).toContain('No se puede generar este archivo todavía');
    expect(
      (screen.getByTestId('prod-opt-export-ptx') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('recalcula readiness cuando cambia el CutPlan activo antes de habilitar descarga', () => {
    const resolveCuttingOutputTarget = vi.fn(() => ({
      status: 'configured-blocked' as const,
      machineLabel: 'HOLZMA (HOMAG) HPP 250',
      formatLabel: 'PTX',
      profileLabel: 'ptx-cadmatic-4@r3',
      ready: false,
      blockerMessage: 'No se puede generar: el plan no tiene programa de corte.',
      blockerCode: 'ptx_compile.missing_cut_program',
    }));
    const activePlan = cutPlanFixture('saw-guillotine');
    render(
      <ProductionOrderOptimizationPanel
        project={{ ...project(), cutPlan: activePlan }}
        catalog={null}
        cutRows={[]}
        resolveCuttingOutputTarget={resolveCuttingOutputTarget}
        onExportCutPlanPtx={vi.fn()}
      />,
    );

    expect(resolveCuttingOutputTarget).toHaveBeenCalledWith(activePlan);
    expect(screen.getByTestId('prod-opt-cutting-output-blocked').textContent)
      .toContain('no tiene programa de corte');
    expect((screen.getByTestId('prod-opt-export-ptx') as HTMLButtonElement).disabled)
      .toBe(true);
  });

  it.each([
    {
      status: 'loading' as const,
      profileLabel: 'Cargando configuración…',
      blockerMessage: 'Esperá a que termine de cargar la configuración.',
    },
    {
      status: 'error' as const,
      profileLabel: 'Configuración no disponible',
      blockerMessage: 'No se pudo cargar la configuración de salida de máquina.',
    },
  ])(
    '$profileLabel bloquea la descarga y presenta la causa',
    ({ status, profileLabel, blockerMessage }) => {
      render(
        <ProductionOrderOptimizationPanel
          project={{ ...project(), cutPlan: cutPlanFixture('saw-guillotine') }}
          catalog={null}
          cutRows={[]}
          cuttingOutputTarget={{
            status,
            machineLabel: 'Salida de máquina',
            formatLabel: 'PTX',
            profileLabel,
            ready: false,
            blockerMessage,
          }}
          onExportCutPlanPtx={vi.fn()}
        />,
      );

      expect(screen.getByTestId('prod-opt-cutting-output').textContent).toContain(
        profileLabel,
      );
      expect(screen.getByTestId('prod-opt-cutting-output-blocked').textContent).toContain(
        blockerMessage,
      );
      expect(
        (screen.getByTestId('prod-opt-export-ptx') as HTMLButtonElement).disabled,
      ).toBe(true);
    },
  );

  it('modo por material: preview cuenta materiales → archivos dentro de un ZIP y los lista', () => {
    render(
      <ProductionOrderOptimizationPanel
        project={{ ...project(), cutPlan: multiMaterialPlan() }}
        catalog={null}
        cutRows={[]}
      />,
    );
    fireEvent.click(screen.getByTestId('prod-opt-ptx-mode-by-material'));
    expect(screen.getByTestId('prod-opt-ptx-preview').textContent).toContain(
      '2 materiales → 2 archivos PTX dentro de un ZIP',
    );
    const chips = screen.getByTestId('prod-opt-ptx-materials');
    expect(chips.textContent).toContain('MDF Blanco 18mm');
    expect(chips.textContent).toContain('Roble Nórdico 18mm');
  });

  it('modo por material sin plan: botón deshabilitado (nada que separar)', () => {
    render(
      <ProductionOrderOptimizationPanel
        project={project()}
        catalog={null}
        cutRows={[]}
      />,
    );
    fireEvent.click(screen.getByTestId('prod-opt-ptx-mode-by-material'));
    expect(
      (screen.getByTestId('prod-opt-export-ptx') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('secuencia de corte sincronizada: clic en paso de la barra lateral activa el paso', () => {
    const sampleRows: ProductionCutRow[] = [
      {
        description: 'LAT-01 · Lateral · M01',
        partCode: 'LAT-01',
        partName: 'Lateral',
        moduleCode: 'M01',
        materialName: 'MDF Blanco 18mm',
        lengthMm: 800,
        widthMm: 500,
        quantity: 1,
        grain: 1,
        L1: 0,
        L2: 0,
        W1: 0,
        W2: 0,
      },
    ];

    render(
      <ProductionOrderOptimizationPanel
        project={{ ...project(), cutPlan: cutPlanFixture('saw-guillotine') }}
        catalog={null}
        cutRows={sampleRows}
      />,
    );

    const sidebar = screen.getByTestId('prod-opt-cut-sequence-sidebar');
    expect(sidebar).toBeTruthy();
    const stepItem = sidebar.querySelector('li');
    expect(stepItem).toBeTruthy();
    expect(stepItem?.getAttribute('aria-current')).toBeNull();

    // Click on the instruction step
    fireEvent.click(stepItem!);
    expect(stepItem?.getAttribute('aria-current')).toBe('step');

    // Click "Vista general" button
    const btnGeneral = within(sidebar).getByText('Vista general');
    fireEvent.click(btnGeneral);
    expect(stepItem?.getAttribute('aria-current')).toBeNull();
  });

  it('plan legacy sin cutProgram: muestra aviso de secuencia no disponible en barra lateral', () => {
    const sampleRows: ProductionCutRow[] = [
      {
        description: 'LAT-01 · Lateral · M01',
        partCode: 'LAT-01',
        partName: 'Lateral',
        moduleCode: 'M01',
        materialName: 'MDF Blanco 18mm',
        lengthMm: 800,
        widthMm: 500,
        quantity: 1,
        grain: 1,
        L1: 0,
        L2: 0,
        W1: 0,
        W2: 0,
      },
    ];

    const basePlan = cutPlanFixture('saw-guillotine');
    const legacyPlan: CutPlan = {
      ...basePlan,
      sheets: [
        {
          ...basePlan.sheets[0]!,
          instructions: [],
          cutProgram: undefined,
        },
      ],
    };

    render(
      <ProductionOrderOptimizationPanel
        project={{ ...project(), cutPlan: legacyPlan }}
        catalog={null}
        cutRows={sampleRows}
      />,
    );

    const missingNotice = screen.getByTestId('prod-opt-missing-program-sidebar');
    expect(missingNotice).toBeTruthy();
    expect(missingNotice.textContent).toContain('Secuencia no disponible');
  });

  it('R3: programa inválido bloquea TODA secuencia aunque existan instrucciones stale', () => {
    const sampleRows: ProductionCutRow[] = [
      {
        description: 'LAT-01 · Lateral · M01',
        partCode: 'LAT-01',
        partName: 'Lateral',
        moduleCode: 'M01',
        materialName: 'MDF Blanco 18mm',
        lengthMm: 800,
        widthMm: 500,
        quantity: 1,
        grain: 1,
        L1: 0,
        L2: 0,
        W1: 0,
        W2: 0,
      },
    ];

    const basePlan = cutPlanFixture('saw-guillotine');
    const sheet = basePlan.sheets[0]!;
    // Simulate stale data: instructions exist but the current program fails
    // validation (keptExtent far beyond its parent).
    expect(sheet.instructions.length).toBeGreaterThan(0);
    const corruptSheet: CutPlanSheet = {
      ...sheet,
      cutProgram: {
        ...sheet.cutProgram!,
        divisions: sheet.cutProgram!.divisions.map((d, idx) =>
          idx === 0 ? { ...d, keptExtentMm: 99999 } : d,
        ),
      },
    };
    const stalePlan: CutPlan = { ...basePlan, sheets: [corruptSheet] };

    const { container } = render(
      <ProductionOrderOptimizationPanel
        project={{ ...project(), cutPlan: stalePlan }}
        catalog={null}
        cutRows={sampleRows}
      />,
    );

    // Board banner shows the blocked state with a reason.
    expect(screen.getByTestId('invalid-program-banner')).toBeTruthy();
    expect(screen.getByTestId('invalid-program-banner').textContent).toContain(
      'Programa de corte inválido',
    );

    // The sequence sidebar is fully gone: no clickable stale instructions.
    expect(screen.queryByTestId('prod-opt-cut-sequence-sidebar')).toBeNull();
    const blocked = screen.getByTestId('prod-opt-invalid-program-sidebar');
    expect(blocked.textContent).toContain('Secuencia bloqueada');
    expect(container.querySelectorAll('li[role="button"]')).toHaveLength(0);

    // No guillotine decoration derived from those stale instructions.
    expect(container.querySelectorAll('[data-testid^="cut-line-"]')).toHaveLength(0);
  });

  it('R4A: plan Sierra visible no sigue el selector CNC hasta regenerar', () => {
    const sampleRows: ProductionCutRow[] = [
      {
        description: 'LAT-01 · Lateral · M01',
        partCode: 'LAT-01',
        partName: 'Lateral',
        moduleCode: 'M01',
        materialName: 'MDF Blanco 18mm',
        lengthMm: 800,
        widthMm: 500,
        quantity: 1,
        grain: 1,
        L1: 0,
        L2: 0,
        W1: 0,
        W2: 0,
      },
    ];

    render(
      <ProductionOrderOptimizationPanel
        project={{ ...project(), cutPlan: cutPlanFixture('saw-guillotine') }}
        catalog={fixtureCatalog()}
        cutRows={sampleRows}
      />,
    );

    // The generated saw plan drives the result UI.
    expect(screen.getByTestId('prod-opt-cut-sequence-sidebar')).toBeTruthy();
    expect(screen.getByTestId('production-board-view').textContent).toContain('Guillotina 2D');

    // Switching the selector to CNC without regenerating changes nothing.
    fireEvent.click(screen.getByTestId('prod-opt-strategy-nesting'));
    expect(screen.getByTestId('prod-opt-cut-sequence-sidebar')).toBeTruthy();
    expect(screen.getByTestId('production-board-view').textContent).toContain('Guillotina 2D');
  });

  it('R4B: plan CNC visible no gana secuencia al cambiar el selector a Sierra sin regenerar', () => {
    const sampleRows: ProductionCutRow[] = [
      {
        description: 'LAT-01 · Lateral · M01',
        partCode: 'LAT-01',
        partName: 'Lateral',
        moduleCode: 'M01',
        materialName: 'MDF Blanco 18mm',
        lengthMm: 800,
        widthMm: 500,
        quantity: 1,
        grain: 1,
        L1: 0,
        L2: 0,
        W1: 0,
        W2: 0,
      },
    ];

    render(
      <ProductionOrderOptimizationPanel
        project={{ ...project(), cutPlan: cutPlanFixture('cnc-nesting') }}
        catalog={fixtureCatalog()}
        cutRows={sampleRows}
      />,
    );

    const boardView = () => screen.getByTestId('production-board-view');

    // Generated CNC plan: no guillotine sequence, no saw decoration.
    expect(screen.queryByTestId('prod-opt-cut-sequence-sidebar')).toBeNull();
    expect(boardView().textContent).toContain('CNC Nesting');

    // Selector back to saw WITHOUT regenerating: the visible plan stays CNC.
    fireEvent.click(screen.getByTestId('prod-opt-strategy-saw'));
    expect(screen.queryByTestId('prod-opt-cut-sequence-sidebar')).toBeNull();
    expect(boardView().textContent).toContain('CNC Nesting');

    // After actually regenerating, the new saw plan drives the UI.
    fireEvent.click(screen.getByRole('button', { name: /Generar Plan de Corte 2D/ }));
    expect(screen.getByTestId('prod-opt-cut-sequence-sidebar')).toBeTruthy();
    expect(boardView().textContent).toContain('Guillotina 2D');
  });
});

describe('ProductionOrderOptimizationPanel — #739 preparación de liberación exacta', () => {
  const demandBaseFixture = {
    releaseId: 'rel-1',
    releaseNumber: 1,
    designRevisionId: 'rev-2',
    designRevisionNumber: 2,
    manufacturingFingerprint: 'sha256-' + 'a'.repeat(64),
  };

  function renderPanel(over: Record<string, unknown> = {}) {
    const rows: ProductionCutRow[] = [
      {
        description: 'LAT-01 · Lateral · M01',
        partCode: 'LAT-01',
        partName: 'Lateral',
        moduleCode: 'M01',
        materialName: 'MDF Blanco 18mm',
        lengthMm: 800,
        widthMm: 500,
        quantity: 2,
        grain: 1,
        L1: 0,
        L2: 0,
        W1: 0,
        W2: 0,
      },
    ];
    return render(
      <ProductionOrderOptimizationPanel
        project={project()}
        catalog={fixtureCatalog()}
        cutRows={rows}
        onExportCutPlanPdf={() => undefined}
        onExportCutPlanPtx={() => undefined}
        onSaveCutPlan={() => undefined}
        {...over}
      />,
    );
  }

  it('botón PDF nunca parece habilitado sin su acción de exportación (bug #739)', () => {
    renderPanel({ onExportCutPlanPdf: undefined, initialCutPlan: cutPlanFixture('saw-guillotine') });
    const pdf = screen.getByTestId('prod-opt-export-pdf-manual');
    expect((pdf as HTMLButtonElement).disabled).toBe(true);
  });

  it('plan activo + acción presente: PDF habilitado', () => {
    renderPanel({ initialCutPlan: cutPlanFixture('saw-guillotine') });
    const pdf = screen.getByTestId('prod-opt-export-pdf-manual');
    expect((pdf as HTMLButtonElement).disabled).toBe(false);
  });

  it('cambiar parámetros bloquea exportaciones hasta regenerar (no exporta un resultado viejo)', () => {
    const pinnedPlan: CutPlan = {
      ...cutPlanFixture('saw-guillotine'),
      releaseBase: demandBaseFixture,
    };
    renderPanel({ initialCutPlan: pinnedPlan, demandGate: { mode: 'canonical', status: 'ready', base: demandBaseFixture } });
    // El plan fixture usa kerf 4: igual config → exportable.
    expect((screen.getByTestId('prod-opt-export-pdf-manual') as HTMLButtonElement).disabled).toBe(false);

    const kerfInput = screen.getByDisplayValue('4') as HTMLInputElement;
    fireEvent.change(kerfInput, { target: { value: '5' } });

    expect(screen.getByTestId('prod-opt-config-drift')).toBeDefined();
    expect((screen.getByTestId('prod-opt-export-pdf-manual') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('prod-opt-export-ptx') as HTMLButtonElement).disabled).toBe(true);

    // Regenerar con la config nueva desbloquea la exportación.
    fireEvent.click(screen.getByRole('button', { name: /Generar Plan de Corte 2D/i }));
    expect(screen.queryByTestId('prod-opt-config-drift')).toBeNull();
    expect((screen.getByTestId('prod-opt-export-pdf-manual') as HTMLButtonElement).disabled).toBe(false);
  });

  it('el plan generado desde demanda congelada lleva el pin de la liberación', () => {
    renderPanel({ demandGate: { mode: 'canonical', status: 'ready', base: demandBaseFixture } });
    fireEvent.click(screen.getByRole('button', { name: /Generar Plan de Corte 2D/i }));
    // El pin viaja en el plan generado: guardar entrega exactamente esa base.
    let saved: CutPlan | undefined;
    cleanup();
    render(
      <ProductionOrderOptimizationPanel
        project={project()}
        catalog={fixtureCatalog()}
        cutRows={[
          {
            description: 'LAT-01 · Lateral · M01',
            partCode: 'LAT-01',
            partName: 'Lateral',
            moduleCode: 'M01',
            materialName: 'MDF Blanco 18mm',
            lengthMm: 800,
            widthMm: 500,
            quantity: 2,
            grain: 1,
            L1: 0,
            L2: 0,
            W1: 0,
            W2: 0,
          },
        ]}
        demandGate={{ mode: 'canonical', status: 'ready', base: demandBaseFixture }}
        onSaveCutPlan={(plan) => {
          saved = plan;
          // Canonical callbacks confirm the write (#739 review R2).
          return { kind: 'saved' } as const;
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Generar Plan de Corte 2D/i }));
    fireEvent.click(screen.getByRole('button', { name: /Guardar Plan/i }));
    expect(saved?.releaseBase).toEqual(demandBaseFixture);
    expect(screen.getByTestId('prod-opt-save-ok')).toBeDefined();
  });

  it('un plan pineado a otra liberación no gobierna exportaciones ni guardado', () => {
    const foreignBase: CutPlan = {
      ...cutPlanFixture('saw-guillotine'),
      releaseBase: { ...demandBaseFixture, releaseId: 'rel-OTRA', releaseNumber: 7 },
    };
    renderPanel({ initialCutPlan: foreignBase, demandGate: { mode: 'canonical', status: 'ready', base: demandBaseFixture } });
    expect(screen.getByTestId('prod-opt-plan-base-mismatch')).toBeDefined();
    expect((screen.getByTestId('prod-opt-export-pdf-manual') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('prod-opt-export-ptx') as HTMLButtonElement).disabled).toBe(true);
  });

  it('guardado honesto: el éxito se declara después de persistir; el fallo se muestra', () => {
    renderPanel({ initialCutPlan: cutPlanFixture('saw-guillotine'), onSaveCutPlan: undefined });
    // Sin acción de guardado no se ofrece el botón (nada que declarar).
    expect(screen.queryByRole('button', { name: /Guardar Plan/i })).toBeNull();

    cleanup();
    render(
      <ProductionOrderOptimizationPanel
        project={project()}
        catalog={fixtureCatalog()}
        cutRows={[
          {
            description: 'LAT-01 · Lateral · M01',
            partCode: 'LAT-01',
            partName: 'Lateral',
            moduleCode: 'M01',
            materialName: 'MDF Blanco 18mm',
            lengthMm: 800,
            widthMm: 500,
            quantity: 2,
            grain: 1,
            L1: 0,
            L2: 0,
            W1: 0,
            W2: 0,
          },
        ]}
        initialCutPlan={cutPlanFixture('saw-guillotine')}
        onSaveCutPlan={() => {
          throw new Error('storage quota exceeded');
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Guardar Plan/i }));
    expect(screen.getByTestId('prod-opt-save-error')).toBeDefined();
    expect(screen.queryByTestId('prod-opt-save-ok')).toBeNull();
  });

  it('requisición previa: con demanda congelada no estima desde el proyecto vivo', () => {
    renderPanel({ demandGate: { mode: 'canonical', status: 'ready', base: demandBaseFixture } });
    expect(screen.getByTestId('prod-opt-release-requisition-note')).toBeDefined();
  });

  it('#739 review: contexto canónico cargando — un plan previo NO queda generable ni exportable', () => {
    renderPanel({
      initialCutPlan: cutPlanFixture('saw-guillotine'),
      demandGate: { mode: 'canonical', status: 'loading' },
    });
    expect((screen.getByTestId('prod-opt-generate') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('prod-opt-export-pdf-manual') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('prod-opt-export-ptx') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('prod-opt-demand-gate').textContent).toContain(
      'Esperando el despiece congelado',
    );
  });

  it('#739 review: contexto canónico con error de demanda — sin generación ni exportación del plan previo', () => {
    renderPanel({
      initialCutPlan: cutPlanFixture('saw-guillotine'),
      demandGate: {
        mode: 'canonical',
        status: 'error',
        message: 'El catálogo vigente ya no tiene los materiales de la liberación (mat-x).',
      },
    });
    expect((screen.getByTestId('prod-opt-generate') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('prod-opt-export-ptx') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('prod-opt-demand-gate').textContent).toContain('mat-x');
  });

  it('#739 review: al verificarse la base (loading → ready) la generación y exportación se habilitan', () => {
    const rows: ProductionCutRow[] = [
      {
        description: 'LAT-01 · Lateral · M01', partCode: 'LAT-01', partName: 'Lateral',
        moduleCode: 'M01', materialName: 'MDF Blanco 18mm', lengthMm: 800, widthMm: 500,
        quantity: 2, grain: 1, L1: 0, L2: 0, W1: 0, W2: 0,
      },
    ];
    const { rerender } = render(
      <ProductionOrderOptimizationPanel
        project={project()}
        catalog={fixtureCatalog()}
        cutRows={rows}
        demandGate={{ mode: 'canonical', status: 'loading' }}
      />,
    );
    expect((screen.getByTestId('prod-opt-generate') as HTMLButtonElement).disabled).toBe(true);
    rerender(
      <ProductionOrderOptimizationPanel
        project={project()}
        catalog={fixtureCatalog()}
        cutRows={rows}
        onExportCutPlanPdf={() => undefined}
        demandGate={{ mode: 'canonical', status: 'ready', base: demandBaseFixture }}
      />,
    );
    expect((screen.getByTestId('prod-opt-generate') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('prod-opt-generate'));
    expect((screen.getByTestId('prod-opt-export-pdf-manual') as HTMLButtonElement).disabled).toBe(false);
  });

  it('#739 review: cadena REAL de guardado — fallo de storage no reporta éxito y lo dice en pantalla', () => {
    const storage = createStorageStub();
    storage.failSetItem = 'quota';
    vi.stubGlobal('localStorage', storage);
    try {
      render(
        <ProductionOrderOptimizationPanel
          project={project()}
          catalog={fixtureCatalog()}
          cutRows={[
            {
              description: 'LAT-01 · Lateral · M01', partCode: 'LAT-01', partName: 'Lateral',
              moduleCode: 'M01', materialName: 'MDF Blanco 18mm', lengthMm: 800, widthMm: 500,
              quantity: 2, grain: 1, L1: 0, L2: 0, W1: 0, W2: 0,
            },
          ]}
          demandGate={{ mode: 'canonical', status: 'ready', base: demandBaseFixture }}
          onSaveCutPlan={(plan) =>
            saveReleaseCutPlan({ organizationId: 'org-a' }, plan.projectId, demandBaseFixture.releaseId, plan)
          }
        />,
      );
      fireEvent.click(screen.getByTestId('prod-opt-generate'));
      fireEvent.click(screen.getByRole('button', { name: /Guardar Plan/i }));
      expect(screen.queryByTestId('prod-opt-save-ok')).toBeNull();
      const error = screen.getByTestId('prod-opt-save-error');
      expect(error.textContent).toContain('puede perderse al recargar');
      // Nothing was persisted for the release.
      expect(
        loadReleaseCutPlan({ organizationId: 'org-a' }, 'p1', demandBaseFixture.releaseId),
      ).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('#739 review: cadena REAL de guardado — éxito confirmado y recarga devuelve exactamente el disco guardado', () => {
    const storage = createStorageStub();
    vi.stubGlobal('localStorage', storage);
    try {
      render(
        <ProductionOrderOptimizationPanel
          project={project()}
          catalog={fixtureCatalog()}
          cutRows={[
            {
              description: 'LAT-01 · Lateral · M01', partCode: 'LAT-01', partName: 'Lateral',
              moduleCode: 'M01', materialName: 'MDF Blanco 18mm', lengthMm: 800, widthMm: 500,
              quantity: 2, grain: 1, L1: 0, L2: 0, W1: 0, W2: 0,
            },
          ]}
          demandGate={{ mode: 'canonical', status: 'ready', base: demandBaseFixture }}
          onSaveCutPlan={(plan) =>
            saveReleaseCutPlan({ organizationId: 'org-a' }, plan.projectId, demandBaseFixture.releaseId, plan)
          }
        />,
      );
      // Ajuste técnico concreto: disco 5 (primer spinbutton del panel en modo sierra).
      const inputs = screen.getAllByRole('spinbutton');
      fireEvent.change(inputs[0]!, { target: { value: '5' } });
      fireEvent.click(screen.getByTestId('prod-opt-generate'));
      fireEvent.click(screen.getByRole('button', { name: /Guardar Plan/i }));
      expect(screen.getByTestId('prod-opt-save-ok')).toBeDefined();
      const saved = loadReleaseCutPlan({ organizationId: 'org-a' }, 'p1', demandBaseFixture.releaseId);
      expect(saved?.config.sawKerfMm).toBe(5);
      expect(saved?.releaseBase?.releaseId).toBe(demandBaseFixture.releaseId);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('#739 review R2: plan existente + demanda loading/error — Guardar deshabilitado y cero persistencia', () => {
    for (const gate of [
      { mode: 'canonical' as const, status: 'loading' as const },
      { mode: 'canonical' as const, status: 'error' as const, message: 'No se pudo leer el despiece congelado.' },
    ]) {
      cleanup();
      const saveSpy = vi.fn();
      render(
        <ProductionOrderOptimizationPanel
          project={project()}
          catalog={fixtureCatalog()}
          cutRows={[]}
          initialCutPlan={cutPlanFixture('saw-guillotine')}
          demandGate={gate}
          onSaveCutPlan={saveSpy}
        />,
      );
      const saveBtn = screen.getByTestId('prod-opt-save') as HTMLButtonElement;
      expect(saveBtn.disabled, JSON.stringify(gate)).toBe(true);
      // A disabled button cannot invoke the handler; assert zero persistence
      // attempts even if something forces the click path.
      fireEvent.click(saveBtn);
      expect(saveSpy).not.toHaveBeenCalled();
      expect(screen.queryByTestId('prod-opt-save-ok')).toBeNull();
      expect(screen.queryByTestId('prod-opt-save-error')).toBeNull();
    }
  });

  it('#739 review R2: callback canónico sin resultado NUNCA es éxito (void ≠ guardado)', () => {
    const pinnedPlan: CutPlan = {
      ...cutPlanFixture('saw-guillotine'),
      releaseBase: demandBaseFixture,
    };
    render(
      <ProductionOrderOptimizationPanel
        project={project()}
        catalog={fixtureCatalog()}
        cutRows={[]}
        initialCutPlan={pinnedPlan}
        demandGate={{ mode: 'canonical', status: 'ready', base: demandBaseFixture }}
        onSaveCutPlan={() => undefined}
      />,
    );
    fireEvent.click(screen.getByTestId('prod-opt-save'));
    expect(screen.queryByTestId('prod-opt-save-ok')).toBeNull();
    expect(screen.getByTestId('prod-opt-save-error').textContent).toContain(
      'no confirmó la escritura',
    );
  });

  it('#739 review R2: plan de otra liberación — Guardar bloqueado con motivo', () => {
    const foreignBase: CutPlan = {
      ...cutPlanFixture('saw-guillotine'),
      releaseBase: { ...demandBaseFixture, releaseId: 'rel-OTRA', releaseNumber: 7 },
    };
    renderPanel({
      initialCutPlan: foreignBase,
      demandGate: { mode: 'canonical', status: 'ready', base: demandBaseFixture },
    });
    expect((screen.getByTestId('prod-opt-save') as HTMLButtonElement).disabled).toBe(true);
  });

  it('#739 review: DXF canónico bloqueado con motivo visible (perforaciones del proyecto mutable)', () => {
    renderPanel({
      initialCutPlan: cutPlanFixture('cnc-nesting'),
      onExportCutPlanDxf: undefined,
      dxfUnavailableReason:
        'El DXF de esta liberación queda pendiente: sus perforaciones se resuelven hoy desde el proyecto vivo. Usá el PDF/PTX del plan congelado.',
    });
    expect((screen.getByTestId('prod-opt-export-dxf-sheets') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('prod-opt-export-dxf-pieces') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('prod-opt-dxf-unavailable').textContent).toContain('perforaciones');
  });

  it('plan legacy sin cutStrategy en la config no genera drift falso (regresión #739)', () => {
    const legacyPlan: CutPlan = {
      ...cutPlanFixture('saw-guillotine'),
      config: {
        // Pre-F126 persisted plans: no cutStrategy/toolSpacingMm fields.
        sawKerfMm: 4,
        trim: { topMm: 10, bottomMm: 10, leftMm: 10, rightMm: 10 },
        deductEdgeBand: true,
        allowRotationNoGrain: true,
        minRemnantWidthMm: 400,
        minRemnantLengthMm: 600,
        preferLongitudinalRips: true,
        heuristic: 'guillotine-hybrid',
      },
    };
    renderPanel({ initialCutPlan: legacyPlan });
    expect(screen.queryByTestId('prod-opt-config-drift')).toBeNull();
    expect((screen.getByTestId('prod-opt-export-pdf-manual') as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId('prod-opt-export-ptx') as HTMLButtonElement).disabled).toBe(false);
  });

  it('optimizer XLSX no conectado a la liberación muestra el motivo junto a la acción', () => {
    renderPanel({
      initialCutPlan: cutPlanFixture('saw-guillotine'),
      onExportOptimizer: undefined,
      optimizerUnavailableReason:
        'El Optimizer XLSX se calcula desde el proyecto vivo. Para la liberación exacta usá el PDF del plan de corte.',
    });
    const btn = screen.getByTestId('prod-opt-export-optimizer-xlsx') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByTestId('prod-opt-optimizer-unavailable').textContent).toContain(
      'usá el PDF del plan de corte',
    );
  });
});
