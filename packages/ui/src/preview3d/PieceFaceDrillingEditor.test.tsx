/**
 * @vitest-environment jsdom
 *
 * PieceFaceDrillingEditor (F131) — per-face 2D editor interaction:
 * face switching, engine holes, snap-32 drag and inline validation.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Hardware, HardwarePlacement, ResolvedBoardPart } from '@granete/domain';
import { PieceFaceDrillingEditor, snappedPlacementPatch } from './PieceFaceDrillingEditor';

afterEach(cleanup);

const bisagra: Hardware = {
  id: 'hw-bis',
  code: 'HER-BIS-TEST',
  name: 'Bisagra test',
  unit: 'piece',
  costPerUnit: 10,
  active: true,
  machining: {
    parts: [
      {
        id: 'cup',
        role: 'cup',
        operations: [
          { id: 'cup-35', kind: 'blind_hole', diameterMm: 35, depthMm: 12.5, xMm: 0, yMm: 0, face: 'anchor' },
        ],
      },
    ],
  },
};

const puerta: ResolvedBoardPart = {
  id: 'door-1',
  description: 'Puerta test',
  quantity: 1,
  lengthMm: 700,
  widthMm: 400,
  thicknessMm: 18,
  grain: 0,
  edges: [],
  optionRole: 'FRENTE',
  materialId: 'm1',
};

const placement: HardwarePlacement = {
  hardwareId: 'hw-bis',
  anchorFace: 'back',
  relativePosition: { xMm: 200, yMm: 100 },
};

function setup(over: { placements?: readonly HardwarePlacement[] } = {}) {
  const onUpdatePlacement = vi.fn();
  render(
    <PieceFaceDrillingEditor
      piece={puerta}
      placements={over.placements ?? [placement]}
      hardwareCatalog={[bisagra]}
      onUpdatePlacement={onUpdatePlacement}
    />,
  );
  return { onUpdatePlacement };
}

describe('PieceFaceDrillingEditor', () => {
  it('renderiza tabs de caras y abre la cara del primer placement (back)', () => {
    setup();
    expect(screen.getByTestId('face-drilling-editor-svg')).toBeTruthy();
    expect(
      (screen.getByTestId('face-drilling-editor-face-back') as HTMLButtonElement)
        .getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('dibuja los agujeros reales del motor en la cara activa', () => {
    setup();
    // Cara back 400×700 → la taza Ø35 del placement (200,100) es visible.
    expect(screen.getByTestId('face-drilling-editor-hole-0')).toBeTruthy();
    expect(screen.getByTestId('face-drilling-editor-meta').textContent).toContain(
      '1 perforación',
    );
  });

  it('cambiar de cara redibuja con las dimensiones del face-plane', () => {
    setup();
    fireEvent.click(screen.getByTestId('face-drilling-editor-face-left'));
    // Cara left: x a lo largo del espesor (18), y a lo largo del largo (700).
    expect(screen.getByTestId('face-drilling-editor-meta').textContent).toContain(
      '18 × 700 mm',
    );
    // El placement vive en back → sin agujeros ni anclas en left.
    expect(screen.queryByTestId('face-drilling-editor-anchor-0')).toBeNull();
  });

  it('el patch de drag snea a 32 mm y limpia fórmulas (helper puro)', () => {
    const patch = snappedPlacementPatch(
      { ...placement, relativePosition: { xMm: 200, yMm: 100, xFormula: 'W/2' } },
      87.8,
      392.9,
      32,
    ) as { relativePosition: { xMm: number; yMm: number; xFormula?: string } };
    expect(patch.relativePosition.xMm).toBe(96);
    expect(patch.relativePosition.yMm).toBe(384);
    expect(patch.relativePosition.xFormula).toBeUndefined();
  });

  it('pointerDown marca el ancla como arrastrable (wiring del drag)', () => {
    setup();
    const anchor = screen.getByTestId('face-drilling-editor-anchor-0');
    fireEvent.pointerDown(anchor, { pointerId: 1 });
    expect(anchor.getAttribute('class')).toContain('face-editor__anchor--dragging');
    fireEvent.pointerUp(anchor, { pointerId: 1 });
  });

  it('muestra las issues del motor inline cuando un placement es inválido', () => {
    // Taza Ø35 a x=5 en cara back de ancho 400: sobresale del canto.
    setup({ placements: [{ ...placement, relativePosition: { xMm: 5, yMm: 100 } }] });
    const issues = screen.getByTestId('face-drilling-editor-issues');
    expect(issues.textContent).toMatch(/fuera de los límites|Fuera/i);
    // El agujero ofensivo queda resaltado (clase de error).
    expect(screen.getByTestId('face-drilling-editor-hole-0').getAttribute('class')).toContain(
      'face-editor__hole--error',
    );
  });

  it('sin catálogo de herrajes no dibuja agujeros pero sí la grilla y anclas', () => {
    render(
      <PieceFaceDrillingEditor piece={puerta} placements={[placement]} />,
    );
    expect(screen.getByTestId('face-drilling-editor-svg')).toBeTruthy();
    expect(screen.queryByTestId('face-drilling-editor-hole-0')).toBeNull();
    expect(screen.getByTestId('face-drilling-editor-anchor-0')).toBeTruthy();
  });
});
