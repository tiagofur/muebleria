import { describe, expect, it } from 'vitest';

import { resolveBom } from './engine/bom';
import type {
  Agregado,
  Catalog,
  Component,
  EdgeAssignment,
  HardwareLine,
  Module,
  OptionChoices,
} from './types';

// #1579 characterization (TS mirror of
// backend-go/.../hinge_agregado_characterization_test.go): the hinge lines the
// TS resolve produces TODAY for aggregate doors (AGR-PUE-* recipe shape). The
// pins keep the per-hinge table and the count rule from moving what the web
// shows today for recipes that declare no countRule.
//
// OBSERVED behavior, not an endorsement of it — see the Go twin.

interface Scenario {
  readonly name: string;
  readonly height: number;
  readonly role: string;
  readonly placements: number;
  readonly bulk: boolean;
}

const BULK: HardwareLine = { id: 'agr-bulk', quantity: 2, optionRole: 'BISAGRA' };

const SCENARIOS: readonly Scenario[] = (['FRENTES', 'FRENTE'] as const).flatMap((role) =>
  [
    { tag: 'placements', placements: 2, bulk: false },
    { tag: 'placements+bulk', placements: 2, bulk: true },
    { tag: 'bulk-only', placements: 0, bulk: true },
  ].flatMap((shape) =>
    [720, 2100].map((height) => ({
      name: `${role} ${shape.tag} ${height}`,
      height,
      role,
      placements: shape.placements,
      bulk: shape.bulk,
    })),
  ),
);

const NO_EDGES: readonly EdgeAssignment[] = [
  { side: 'L1', enabled: false },
  { side: 'L2', enabled: false },
  { side: 'W1', enabled: false },
  { side: 'W2', enabled: false },
];

const door = (role: string): Component => ({
  id: 'comp-door',
  code: 'PUERTA',
  name: 'Puerta',
  placement: 'puerta',
  geometry: {
    kind: 'rectangular_board',
    lengthMm: 700,
    widthMm: 500,
    thicknessMm: 18,
    lengthFormula: 'PH',
    widthFormula: 'PW',
  },
  defaultEdges: NO_EDGES,
  optionRoles: [role],
  active: true,
});

const side: Component = {
  id: 'comp-side-izq',
  code: 'COS',
  name: 'Costado Izq.',
  placement: 'lateral_izquierdo',
  geometry: { kind: 'rectangular_board', lengthMm: 700, widthMm: 500, thicknessMm: 18, lengthFormula: 'PH', widthFormula: 'PD' },
  defaultEdges: NO_EDGES,
  optionRoles: ['INTERIOR'],
  active: true,
};

const hingePlacements = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    optionRole: 'BISAGRA',
    anchorFace: 'back' as const,
    relativePosition: { xMm: 20.5, yMm: 90, xFormula: 'PW-20.5', yFormula: `PH-${90 * (i + 1)}` },
  }));

const build = (sc: Scenario): { module: Module; catalog: Catalog; choices: OptionChoices } => {
  const agregado: Agregado = {
    id: 'agr-pue',
    code: 'AGR-PUE-DER',
    name: 'Puerta Derecha',
    active: true,
    components: [
      {
        componentId: 'comp-door',
        quantity: 1,
        placementOverride: 'puerta',
        ...(sc.placements > 0 ? { overrides: { hardwarePlacements: hingePlacements(sc.placements) } } : {}),
      },
    ],
    hardwareLines: sc.bulk ? [BULK] : [],
  };
  const module: Module = {
    id: 'mod-1',
    code: 'MOD-PUE',
    name: 'Con puerta agregado',
    structureId: 'st-1',
    externalDims: { width: 600, height: sc.height, depth: 560 },
    agregados: [{ id: 'inst-door', agregadoId: 'agr-pue', quantity: 1 }],
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
    hardware: [{ id: 'hw-bisagra', code: 'BIS-CL110', name: 'Bisagra cierre lento', unit: 'piece', costPerUnit: 10, active: true }],
    optionGroups: [],
    components: [side, door(sc.role)],
    structures: [
      { id: 'st-1', code: 'EST', name: 'Cuerpo', components: [{ componentId: 'comp-side-izq', quantity: 1 }], agregados: [], active: true },
    ],
    agregados: [agregado],
    modules: [],
  };
  const choices: OptionChoices = { INTERIOR: 'mat-1', [sc.role]: 'mat-1', BISAGRA: 'hw-bisagra' };
  return { module, catalog, choices };
};

// Pins (observed 2026-11-23 on main 879ae6a7):
//   - the module-door band collector sees the aggregate door (it keys on the
//     'puerta' placement, not on the material role), so demand is N by height
//     whatever the recipe authors;
//   - role-based recipe placements contribute NO demand unless the instance
//     itself overrides the role, so the drawn/drilled 2 positions never reach
//     the quote;
//   - aggregate bulk lines are not deduped against the band (bulk + N).
const pinned = (shape: 'placements' | 'placements+bulk' | 'bulk-only', height: number): readonly string[] => {
  const band = `hingeband-hw-bisagra×${height <= 900 ? 2 : height <= 1600 ? 3 : height <= 2000 ? 4 : 5}`;
  return shape === 'placements' ? [band] : ['agr-bulk-agr-inst-door-u0×2', band].sort();
};

describe('#1579 characterization — puertas-agregado (TS, comportamiento previo fijado)', () => {
  it('toda receta sin countRule resuelve exactamente las líneas de bisagra de hoy', () => {
    for (const sc of SCENARIOS) {
      const { module, catalog, choices } = build(sc);
      const bom = resolveBom(module, choices, catalog);
      const lines = bom.hardwareLines
        .filter((line) => line.hardwareId === 'hw-bisagra')
        .map((line) => `${line.id}×${line.quantity}`)
        .sort();
      expect(lines, sc.name).toEqual(pinned(sc.bulk ? (sc.placements > 0 ? 'placements+bulk' : 'bulk-only') : 'placements', sc.height));
    }
  });
});
