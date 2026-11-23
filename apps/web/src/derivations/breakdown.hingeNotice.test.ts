import { describe, expect, it } from 'vitest';

import type { Catalog, Component, EdgeAssignment, Module } from '@granete/domain';

import { computeModuleCostPreview } from './breakdown';

// #1579 — el preview de costo del editor lleva los avisos del motor hasta la
// pantalla: una puerta más alta que la última banda de la tabla de bisagras
// sale junto al costo, sin bloquearlo.

const NO_EDGES: readonly EdgeAssignment[] = [
  { side: 'L1', enabled: false },
  { side: 'L2', enabled: false },
  { side: 'W1', enabled: false },
  { side: 'W2', enabled: false },
];

function catalogWithDoor(doorHeightMm: number): { module: Module; catalog: Catalog } {
  const door: Component = {
    id: 'comp-pue',
    code: 'PUERTA',
    name: 'Puerta',
    placement: 'puerta',
    geometry: { kind: 'rectangular_board', lengthMm: doorHeightMm, widthMm: 600, thicknessMm: 18 },
    defaultEdges: NO_EDGES,
    optionRoles: ['FRENTE'],
    active: true,
  };
  const module: Module = {
    id: 'mod-1',
    code: 'MOD-PUE',
    name: 'Con puerta',
    structureId: 'st-1',
    externalDims: { width: 600, height: doorHeightMm, depth: 560 },
    // La línea por rol declara el grupo de bisagras al preview (así tiene una
    // elección por defecto); al cotizar, la banda por altura la reemplaza.
    hardwareLines: [{ id: 'hl-bisagra', quantity: 2, optionRole: 'BISAGRA' }],
  };
  const catalog: Catalog = {
    materials: [
      {
        id: 'mat-1',
        code: 'MEL-18',
        name: 'Melamina 18',
        widthMm: 1830,
        lengthMm: 2440,
        thicknessMm: 18,
        grainDefault: true,
        boardPrice: 100,
        wastePercent: 0,
        costPerM2: 100,
        active: true,
      },
    ],
    edges: [],
    hardware: [
      {
        id: 'hw-bisagra',
        code: 'BIS-CL110',
        name: 'Bisagra cierre lento',
        unit: 'piece',
        costPerUnit: 68,
        active: true,
        hingeDemand: {
          bands: [
            { upToHeightMm: 900, hinges: 2 },
            { upToHeightMm: 2400, hinges: 5 },
          ],
        },
      },
    ],
    optionGroups: [
      { id: 'og-frente', code: 'FRENTE', name: 'Frente', kind: 'board', required: true, optionIds: ['mat-1'] },
      { id: 'og-bisagra', code: 'BISAGRA', name: 'Bisagra', kind: 'hardware', required: true, optionIds: ['hw-bisagra'] },
    ],
    components: [door],
    structures: [
      {
        id: 'st-1',
        code: 'EST',
        name: 'Cuerpo',
        // placementOverride es la forma en que se autoran las puertas reales:
        // el gate de opciones lo usa para exigir (y pre-elegir) la bisagra.
        components: [{ componentId: 'comp-pue', quantity: 1, placementOverride: 'puerta' }],
        agregados: [],
        active: true,
      },
    ],
    agregados: [],
    modules: [module],
  };
  return { module, catalog };
}

describe('computeModuleCostPreview — avisos del motor (#1579)', () => {
  it('una puerta de 2600 sale con el aviso y el costo del máximo, sin bloquear', () => {
    const { module, catalog } = catalogWithDoor(2600);
    const preview = computeModuleCostPreview(module, catalog);

    expect(preview.previewBlocked).toBe(false);
    expect(preview.costPreview).not.toBeNull();
    // 5 bisagras (el máximo de la tabla) a $68.
    expect(preview.costPreview!.hardwareTotal).toBe(5 * 68);
    expect(preview.costPreview!.notices).toEqual([
      'La puerta mide 2600 mm: supera la última banda de la tabla (2400 mm). Se aplican 5 bisagras.',
    ]);
  });

  it('una puerta dentro de la tabla no produce avisos', () => {
    const { module, catalog } = catalogWithDoor(720);
    const preview = computeModuleCostPreview(module, catalog);

    expect(preview.previewBlocked).toBe(false);
    expect(preview.costPreview!.hardwareTotal).toBe(2 * 68);
    expect(preview.costPreview!.notices).toEqual([]);
  });
});
