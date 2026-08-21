/**
 * ProductionBoardView — strategy-aware rendering (F124/F126 follow-up).
 * Saw sheets keep their guillotine decorations (strip rip lines, cross cuts,
 * 1st-cut marker); CNC nesting sheets render pieces + remnants only.
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { CutPlanSheet, CutStrategy } from '@muebles/domain';
import { ProductionBoardView } from './ProductionBoardView';

afterEach(cleanup);

function sheetFixture(strategy: CutStrategy): CutPlanSheet {
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
      {
        id: 'p2-s0',
        partCode: 'PISO-01',
        partName: 'Piso',
        moduleCode: 'M01',
        labelRef: 'A2',
        materialName: 'MDF Blanco 18mm',
        materialCode: 'MDF18',
        xMm: 820,
        yMm: 10,
        lengthMm: 600,
        widthMm: 500,
        originalLengthMm: 600,
        originalWidthMm: 500,
        grain: 1,
        rotated: false,
        L1: 0,
        L2: 0,
        W1: 0,
        W2: 0,
        thicknessMm: 18,
        sheetIndex: 0,
        stripIndex: 0,
        cutSequenceNumber: 2,
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
    netPiecesAreaM2: 0.7,
    grossSheetAreaM2: 4.47,
    usableRemnantAreaM2: 0.45,
    wasteAreaM2: 3.32,
    wastePercent: 74,
    yieldPercent: 16,
  };
}

/**
 * Cut decorations (strip rips, primary cut) span the board from edge to
 * edge — x1 starts at 0. Piece decorations (blue edge-band lines, grain
 * dashes) start inside the piece, never at the board edge.
 */
function boardEdgeCutLines(container: HTMLElement): number {
  return Array.from(container.querySelectorAll('svg line')).filter((line) => {
    const x1 = line.getAttribute('x1');
    return x1 != null && Math.abs(Number(x1)) < 0.01;
  }).length;
}

describe('ProductionBoardView — decoración por estrategia', () => {
  it('sheet sierra: título Guillotina 2D y líneas de corte dibujadas', () => {
    const { container } = render(
      <ProductionBoardView sheet={sheetFixture('saw-guillotine')} />,
    );
    expect(screen.getByText(/Guillotina 2D/)).toBeTruthy();
    // Franjas + marcador de 1er corte cruzan el tablero de orilla a orilla.
    expect(boardEdgeCutLines(container)).toBeGreaterThanOrEqual(2);
  });

  it('sheet nesting: título CNC Nesting, sin líneas guillotina ni 1er corte', () => {
    const { container } = render(
      <ProductionBoardView sheet={sheetFixture('cnc-nesting')} />,
    );
    expect(screen.getByText(/CNC Nesting/)).toBeTruthy();
    expect(screen.queryByText(/Guillotina 2D/)).toBeNull();
    // Sin rips de franja, sin cross cuts, sin marcador de 1er corte.
    expect(boardEdgeCutLines(container)).toBe(0);
    expect(screen.queryByText(/CORTE/i)).toBeNull();
    // Piezas y retazos (datos reales del sheet) siguen dibujados.
    expect(screen.getByText(/2 piezas/)).toBeTruthy();
    expect(screen.getByText(/RETAZO 900×500/)).toBeTruthy();
  });

  it('plan legacy sin strategy se trata como sierra (retrocompatible)', () => {
    const legacy = { ...sheetFixture('saw-guillotine') } as CutPlanSheet;
    delete (legacy as { strategy?: CutStrategy }).strategy;
    const { container } = render(<ProductionBoardView sheet={legacy} />);
    expect(screen.getByText(/Guillotina 2D/)).toBeTruthy();
    expect(boardEdgeCutLines(container)).toBeGreaterThanOrEqual(2);
  });
});
