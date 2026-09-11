/**
 * ProductionBoardView — strategy-aware & authoritative cut program rendering (#650 PR 3).
 *
 * Valida:
 * 1. Plan con programa válido: Guillotina 2D, líneas procedentes del programa,
 *    marcador de 1er corte, y navegación interactiva paso a paso.
 * 2. Plan anterior sin programa: piezas visibles, banner honesto de regeneración,
 *    sin líneas inventadas ni 1er corte heurístico.
 * 3. Programa inválido: banner de error con motivo y bloqueo de secuencia.
 * 4. CNC nesting: sin decoraciones de sierra ni secuencias guillotina.
 *
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  optimizeCutPlan,
  type CutPlanConfig,
  type CutPlanSheet,
  type CutProgramInput,
  type CutStrategy,
  type MaterialBoard,
  type ProductionCutRow,
} from '@granete/domain';
import { ProductionBoardView } from './ProductionBoardView';

afterEach(cleanup);

const testBoard: MaterialBoard = {
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

function createOptimizedSawSheet(): CutPlanSheet {
  const rows: ProductionCutRow[] = [
    {
      description: 'Lateral',
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
    {
      description: 'Piso',
      partCode: 'PISO-01',
      partName: 'Piso',
      moduleCode: 'M01',
      materialName: 'MDF Blanco 18mm',
      lengthMm: 600,
      widthMm: 500,
      quantity: 1,
      grain: 1,
      L1: 0,
      L2: 0,
      W1: 0,
      W2: 0,
    },
  ];

  const config: CutPlanConfig = {
    sawKerfMm: 4,
    trim: { topMm: 10, bottomMm: 10, leftMm: 10, rightMm: 10 },
    deductEdgeBand: false,
    allowRotationNoGrain: false,
    minRemnantLengthMm: 500,
    minRemnantWidthMm: 400,
    preferLongitudinalRips: true,
    heuristic: 'guillotine-hybrid',
    cutStrategy: 'saw-guillotine',
  };

  const plan = optimizeCutPlan('proj-test', rows, [testBoard], config);
  return plan.sheets[0]!;
}

function legacySheetFixture(strategy?: CutStrategy): CutPlanSheet {
  return {
    sheetIndex: 0,
    strategy,
    materialCode: 'MDF18',
    materialName: 'MDF Blanco 18mm',
    sheetWidthMm: 1830,
    sheetLengthMm: 2440,
    pieces: [
      {
        id: 'p1-s0',
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
    remnants: [
      {
        id: 'rem-1',
        sheetIndex: 0,
        xMm: 10,
        yMm: 520,
        lengthMm: 900,
        widthMm: 500,
        areaM2: 0.45,
        materialName: 'MDF Blanco 18mm',
        materialCode: 'MDF18',
        isUseful: true,
      },
    ],
    instructions: [],
    netPiecesAreaM2: 0.4,
    grossSheetAreaM2: 4.47,
    usableRemnantAreaM2: 0.45,
    wasteAreaM2: 3.62,
    wastePercent: 81,
    yieldPercent: 9,
    // Note: cutProgram is intentionally undefined to simulate legacy plan
  };
}

describe('ProductionBoardView — integración con programa de corte (#650 PR 3)', () => {
  it('plan optimizado con programa válido: muestra Guillotina 2D, 1er corte, líneas y navegación paso a paso', () => {
    const sheet = createOptimizedSawSheet();
    expect(sheet.cutProgram).toBeDefined();

    const { container } = render(<ProductionBoardView sheet={sheet} />);

    // Título de guillotina con orientación
    expect(screen.getByText(/Guillotina 2D/)).toBeTruthy();

    // Marcador de 1er corte primario proveniente del programa (badge y leyenda)
    expect(screen.getAllByText(/1er CORTE/i).length).toBeGreaterThanOrEqual(1);

    // Líneas de corte renderizadas en SVG
    const cutGroups = container.querySelectorAll('[data-testid^="cut-line-"]');
    expect(cutGroups.length).toBeGreaterThan(0);

    // Barra de navegación paso a paso
    const stepNav = screen.getByTestId('production-board-step-nav');
    expect(stepNav).toBeTruthy();

    // Botones de navegación
    const btnGeneral = screen.getByTestId('step-nav-general');
    const btnNext = screen.getByTestId('step-nav-next');
    expect(btnGeneral).toBeTruthy();
    expect(btnNext).toBeTruthy();

    // Avanzar al paso 1
    fireEvent.click(btnNext);
    expect(screen.getByTestId('step-info-summary')).toBeTruthy();
    expect(screen.getByText(/Pasada #1 de/)).toBeTruthy();

    // Verificar que SVG renderiza región activa, banda y línea de pasada activa
    expect(screen.getByTestId('step-active-region')).toBeTruthy();
    expect(screen.getByTestId('step-cut-line')).toBeTruthy();
    expect(screen.getByTestId('step-kerf-band')).toBeTruthy();

    // Volver a vista general
    fireEvent.click(btnGeneral);
    expect(screen.queryByTestId('production-board-step-card')).toBeNull();
  });

  it('plan anterior sin programa: muestra piezas, banner honesto de regeneración y NO inventa líneas', () => {
    const onRegenerate = vi.fn();
    const legacy = legacySheetFixture('saw-guillotine');

    const { container } = render(
      <ProductionBoardView sheet={legacy} onRegeneratePlan={onRegenerate} />,
    );

    // Título básico
    expect(screen.getByText(/Guillotina 2D/)).toBeTruthy();

    // Banner honesto presente
    const banner = screen.getByTestId('missing-program-banner');
    expect(banner).toBeTruthy();
    expect(screen.getByText(/Plan anterior sin programa/)).toBeTruthy();

    // Botón de regeneración funcional
    const regenBtn = screen.getByTestId('btn-regenerate-from-banner');
    fireEvent.click(regenBtn);
    expect(onRegenerate).toHaveBeenCalledTimes(1);

    // NO debe haber líneas de corte inventadas ni marcador de primer corte
    const cutGroups = container.querySelectorAll('[data-testid^="cut-line-"]');
    expect(cutGroups.length).toBe(0);
    expect(screen.queryByText(/1er Corte/i)).toBeNull();

    // Piezas y retazos siguen visibles
    expect(screen.getByText(/1 piezas/)).toBeTruthy();
    expect(screen.getByText(/RETAZO 900×500/)).toBeTruthy();
  });

  it('programa inválido: muestra banner de error con motivo y bloquea secuencia', () => {
    const invalidProgram: CutProgramInput = {
      schemaVersion: 'granete.cut-program.v1',
      boardRegionId: 'non-existent-root',
      regions: [],
      divisions: [],
      terminals: [],
    };
    const sheetWithBadProgram: CutPlanSheet = {
      ...legacySheetFixture('saw-guillotine'),
      cutProgram: invalidProgram,
    };

    const { container } = render(<ProductionBoardView sheet={sheetWithBadProgram} />);

    // Banner de error visible
    const errorBanner = screen.getByTestId('invalid-program-banner');
    expect(errorBanner).toBeTruthy();
    expect(screen.getByText(/Programa de corte inválido/)).toBeTruthy();

    // Secuencia de corte bloqueada (sin barra de pasos ni líneas)
    expect(screen.queryByTestId('production-board-step-nav')).toBeNull();
    const cutGroups = container.querySelectorAll('[data-testid^="cut-line-"]');
    expect(cutGroups.length).toBe(0);
  });

  it('sheet nesting: título CNC Nesting, sin decoraciones de sierra ni secuencia', () => {
    const nestingSheet = legacySheetFixture('cnc-nesting');
    const { container } = render(<ProductionBoardView sheet={nestingSheet} />);

    expect(screen.getByText(/CNC Nesting/)).toBeTruthy();
    expect(screen.queryByText(/Guillotina 2D/)).toBeNull();

    // Sin líneas de sierra, sin marcador de 1er corte, sin barra de pasos
    const cutGroups = container.querySelectorAll('[data-testid^="cut-line-"]');
    expect(cutGroups.length).toBe(0);
    expect(screen.queryByText(/1er [Cc]orte/)).toBeNull();
    expect(screen.queryByTestId('production-board-step-nav')).toBeNull();

    // Piezas y retazos visibles
    expect(screen.getByText(/1 piezas/)).toBeTruthy();
    expect(screen.getByText(/RETAZO 900×500/)).toBeTruthy();
  });

  it('cambio de tablero reinicia la selección de paso: sin índice ni traza obsoletos', () => {
    // Two real sheets of the same material (repeated local program ids):
    // a small board forces a second sheet for the third piece.
    const smallBoard: MaterialBoard = {
      id: 'mat-small',
      code: 'MDF18',
      name: 'MDF Blanco 18mm',
      widthMm: 600,
      lengthMm: 1000,
      thicknessMm: 18,
      grainDefault: true,
      boardPrice: 100,
      wastePercent: 10,
      costPerM2: 25,
      active: true,
    };
    const rows: ProductionCutRow[] = [
      {
        description: 'Gran pieza',
        materialName: 'MDF Blanco 18mm',
        lengthMm: 900,
        widthMm: 560,
        quantity: 3,
        grain: 1,
        L1: 0,
        L2: 0,
        W1: 0,
        W2: 0,
      },
    ];
    const plan = optimizeCutPlan('proj-reset', rows, [smallBoard], {
      sawKerfMm: 4,
      trim: { topMm: 10, bottomMm: 10, leftMm: 10, rightMm: 10 },
      deductEdgeBand: false,
      allowRotationNoGrain: false,
      minRemnantLengthMm: 500,
      minRemnantWidthMm: 400,
      preferLongitudinalRips: true,
      heuristic: 'guillotine-hybrid',
      cutStrategy: 'saw-guillotine',
    });
    expect(plan.sheets.length).toBeGreaterThanOrEqual(2);
    const sheetA = plan.sheets[0]!;
    const sheetB = plan.sheets[1]!;

    const onSelectStep = vi.fn();
    let selected: number | null = null;
    onSelectStep.mockImplementation((idx: number | null) => {
      selected = idx;
    });
    const view = (sheet: CutPlanSheet) => (
      <ProductionBoardView
        sheet={sheet}
        selectedStepIndex={selected}
        onSelectStep={onSelectStep}
      />
    );
    const { rerender } = render(view(sheetA));

    // Select a step on board A (controlled echo, like the panel does).
    fireEvent.click(screen.getByTestId('step-nav-next'));
    rerender(view(sheetA));
    expect(screen.getByTestId('step-info-summary')).toBeTruthy();
    expect(onSelectStep).toHaveBeenLastCalledWith(0);

    // Switching to board B resets the selection explicitly.
    rerender(view(sheetB));
    rerender(view(sheetB));
    expect(onSelectStep).toHaveBeenLastCalledWith(null);
    expect(screen.queryByTestId('step-info-summary')).toBeNull();

    // The rendered trace belongs to board B only (no stale lines from A).
    const cutLines = document.querySelectorAll('[data-testid^="cut-line-"]');
    expect(cutLines.length).toBeGreaterThan(0);
    for (const line of Array.from(cutLines)) {
      const testId = line.getAttribute('data-testid')!;
      expect(testId.startsWith(`cut-line-b${sheetB.sheetIndex}-`)).toBe(true);
    }
  });

  it('R5: reemplazo real del programa en mismo sheet/material reinicia la selección', () => {
    // Two plans over the same board/material: sheets[0] share sheetIndex and
    // materialCode but carry DIFFERENT cutProgram objects.
    const board: MaterialBoard = {
      id: 'mat-small',
      code: 'MDF18',
      name: 'MDF Blanco 18mm',
      widthMm: 600,
      lengthMm: 1000,
      thicknessMm: 18,
      grainDefault: true,
      boardPrice: 100,
      wastePercent: 10,
      costPerM2: 25,
      active: true,
    };
    const mkRows = (len: number): ProductionCutRow[] => [
      {
        description: 'Pieza',
        materialName: 'MDF Blanco 18mm',
        lengthMm: len,
        widthMm: 560,
        quantity: 1,
        grain: 1,
        L1: 0,
        L2: 0,
        W1: 0,
        W2: 0,
      },
    ];
    const config: CutPlanConfig = {
      sawKerfMm: 4,
      trim: { topMm: 10, bottomMm: 10, leftMm: 10, rightMm: 10 },
      deductEdgeBand: false,
      allowRotationNoGrain: false,
      minRemnantLengthMm: 500,
      minRemnantWidthMm: 400,
      preferLongitudinalRips: true,
      heuristic: 'guillotine-hybrid',
      cutStrategy: 'saw-guillotine',
    };
    const planA = optimizeCutPlan('proj-r5a', mkRows(880), [board], config);
    const planB = optimizeCutPlan('proj-r5b', mkRows(660), [board], config);
    const sheetA = planA.sheets[0]!;
    const sheetB = planB.sheets[0]!;
    expect(sheetA.sheetIndex).toBe(sheetB.sheetIndex);
    expect(sheetA.materialCode).toBe(sheetB.materialCode);
    expect(sheetA.cutProgram).not.toBe(sheetB.cutProgram);

    // Uncontrolled selection on program A.
    const { rerender } = render(<ProductionBoardView sheet={sheetA} />);
    fireEvent.click(screen.getByTestId('step-nav-next'));
    expect(screen.getByTestId('step-info-summary')).toBeTruthy();

    // A different program for the same sheet/material must reset it.
    rerender(<ProductionBoardView sheet={sheetB} />);
    expect(screen.queryByTestId('step-info-summary')).toBeNull();
  });

  it('R2: medida decimal 333.3 visible en resumen, selector y badge — sin redondeo', () => {
    const sheet: CutPlanSheet = {
      sheetIndex: 0,
      materialCode: 'MDF18',
      materialName: 'MDF Blanco 18mm',
      sheetWidthMm: 500,
      sheetLengthMm: 1000,
      pieces: [
        {
          id: 'DEC-1',
          partCode: 'DEC-01',
          partName: 'Decimal',
          moduleCode: 'M01',
          labelRef: 'D1',
          materialName: 'MDF Blanco 18mm',
          materialCode: 'MDF18',
          xMm: 0,
          yMm: 0,
          lengthMm: 333.3,
          widthMm: 500,
          originalLengthMm: 333.3,
          originalWidthMm: 500,
          grain: 0,
          rotated: false,
          L1: 0,
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
      netPiecesAreaM2: 0.17,
      grossSheetAreaM2: 0.5,
      usableRemnantAreaM2: 0,
      wasteAreaM2: 0.33,
      wastePercent: 66,
      yieldPercent: 34,
      cutProgram: {
        schemaVersion: 'granete.cut-program.v1',
        boardRegionId: 'board',
        regions: [
          { regionId: 'board', rect: { xMm: 0, yMm: 0, lengthMm: 1000, widthMm: 500 } },
          { regionId: 'piece', rect: { xMm: 0, yMm: 0, lengthMm: 333.3, widthMm: 500 } },
          { regionId: 'rest', rect: { xMm: 336.5, yMm: 0, lengthMm: 663.5, widthMm: 500 } },
        ],
        divisions: [
          {
            cutId: 'cut-dec',
            parentRegionId: 'board',
            axis: 'x',
            keptExtentMm: 333.3,
            kerfMm: 3.2,
            keptRegionId: 'piece',
            restRegionId: 'rest',
          },
        ],
        terminals: [
          { regionId: 'piece', kind: 'piece', pieceRef: 'DEC-1' },
          { regionId: 'rest', kind: 'waste' },
        ],
      },
    };

    const { container } = render(<ProductionBoardView sheet={sheet} />);

    // Selector option shows 333.3, not 333/334.
    const select = screen.getByTestId('step-nav-select') as HTMLSelectElement;
    expect(select.textContent).toContain('333.3');
    expect(select.textContent).not.toContain('333 mm');

    // Step summary keeps the decimal.
    fireEvent.change(select, { target: { value: '0' } });
    const summary = screen.getByTestId('step-info-summary');
    expect(summary.textContent).toContain('333.3 mm');
    expect(summary.textContent).toContain('3.2 mm');

    // SVG badge keeps the decimal too.
    expect(container.textContent).toContain('Corte #1 (333.3mm)');
    expect(container.textContent).not.toContain('Corte #1 (333mm)');
  });
});
