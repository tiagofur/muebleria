import { describe, expect, it } from 'vitest';

import { resolveBom } from './engine/bom';
import { resolvedHardwareNotices } from './hingeDemand';
import type {
  Catalog,
  Component,
  EdgeAssignment,
  Module,
  OptionChoices,
  ResolvedHardwareLine,
} from './types';

// #1579 — the last-band warning travels on the band line of the resolved BOM
// (TS mirror of Go's TestHingeBandOverflowCarriesNotice): a door taller than
// the hinge table's last band takes the maximum AND the quote says so.

const NO_EDGES: readonly EdgeAssignment[] = [
  { side: 'L1', enabled: false },
  { side: 'L2', enabled: false },
  { side: 'W1', enabled: false },
  { side: 'W2', enabled: false },
];

function doorModuleFixture(doorHeightMm: number): {
  readonly module: Module;
  readonly catalog: Catalog;
  readonly choices: OptionChoices;
} {
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
    hardwareLines: [],
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
        costPerUnit: 10,
        active: true,
        hingeDemand: {
          bands: [
            { upToHeightMm: 900, hinges: 2 },
            { upToHeightMm: 1600, hinges: 3 },
            { upToHeightMm: 2000, hinges: 4 },
            { upToHeightMm: 2400, hinges: 5 },
          ],
        },
      },
    ],
    optionGroups: [],
    components: [door],
    structures: [
      {
        id: 'st-1',
        code: 'EST',
        name: 'Cuerpo',
        components: [{ componentId: 'comp-pue', quantity: 1 }],
        agregados: [],
        active: true,
      },
    ],
    agregados: [],
    modules: [],
  };
  return { module, catalog, choices: { FRENTE: 'mat-1', BISAGRA: 'hw-bisagra' } };
}

const bandLines = (lines: readonly ResolvedHardwareLine[]): readonly ResolvedHardwareLine[] =>
  lines.filter((line) => line.id.startsWith('hingeband-'));

describe('#1579 — aviso de desborde en la línea de banda', () => {
  it('una puerta de 2600 toma el máximo (5) y la línea lleva el aviso', () => {
    const { module, catalog, choices } = doorModuleFixture(2600);
    const lines = bandLines(resolveBom(module, choices, catalog).hardwareLines);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.quantity).toBe(5);
    expect(lines[0]!.notice).toBe(
      'La puerta mide 2600 mm: supera la última banda de la tabla (2400 mm). Se aplican 5 bisagras por puerta.',
    );
    expect(resolvedHardwareNotices(lines)).toEqual([
      'La puerta mide 2600 mm: supera la última banda de la tabla (2400 mm). Se aplican 5 bisagras por puerta.',
    ]);
  });

  it('la última banda (2400) está dentro de la tabla: misma cantidad, sin aviso ni clave', () => {
    const { module, catalog, choices } = doorModuleFixture(2400);
    const lines = bandLines(resolveBom(module, choices, catalog).hardwareLines);
    expect(lines[0]!.quantity).toBe(5);
    expect('notice' in lines[0]!).toBe(false);
    expect(resolvedHardwareNotices(lines)).toEqual([]);
  });

  it('sin tabla en la bisagra manda la escalera de librería: 2100 compra 5 y no hay aviso', () => {
    const { module, catalog, choices } = doorModuleFixture(2100);
    const { hingeDemand: _dropped, ...plainHinge } = catalog.hardware[0]!;
    const withoutTable: Catalog = { ...catalog, hardware: [plainHinge] };
    const line = bandLines(resolveBom(module, choices, withoutTable).hardwareLines)[0]!;
    expect(line.quantity).toBe(5);
    expect('notice' in line).toBe(false);
  });

  it('sin tabla, un desborde de la escalera de librería también se avisa (deja de ser silencioso)', () => {
    // Owner decision 3: the clamp above the LAST ROW warns — the library
    // ladder is a table too. The quantity is the one it always was (5).
    const { module, catalog, choices } = doorModuleFixture(2600);
    const { hingeDemand: _dropped, ...plainHinge } = catalog.hardware[0]!;
    const withoutTable: Catalog = { ...catalog, hardware: [plainHinge] };
    const line = bandLines(resolveBom(module, choices, withoutTable).hardwareLines)[0]!;
    expect(line.quantity).toBe(5);
    expect(line.notice).toBe(
      'La puerta mide 2600 mm: supera la última banda de la tabla (2400 mm). Se aplican 5 bisagras por puerta.',
    );
  });
});

describe('resolvedHardwareNotices', () => {
  it('devuelve avisos únicos en orden de aparición y descarta vacíos', () => {
    expect(
      resolvedHardwareNotices([
        { notice: '  La puerta mide 2600 mm: supera la última banda. ' },
        { notice: 'La puerta mide 2600 mm: supera la última banda.' },
        {},
        { notice: '   ' },
        { notice: 'Otro aviso' },
      ]),
    ).toEqual([
      'La puerta mide 2600 mm: supera la última banda.',
      'Otro aviso',
    ]);
    expect(resolvedHardwareNotices([{ id: 'x', quantity: 1 } as never])).toEqual([]);
  });
});
