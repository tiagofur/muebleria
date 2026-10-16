import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { Agregado, Catalog, Component, Module, Structure } from '../types';
import { resolveBom } from './bom';

/**
 * #995 K3-parity — the BOM part-id naming rule is ONE contract across
 * runtimes. Go's engine test (backend-go/internal/domain/engine/
 * bom_part_identity_parity_test.go) consumes the SAME fixture and asserts the
 * SAME sequence: if the two runtimes ever drift again, one of the two tests
 * goes red in its own CI leg instead of the browser discovering it as a dead
 * KDT/pack export («la partida liberada X no tiene routing congelado»).
 */

interface ParityFixture {
  readonly structureComponents: readonly { readonly componentId: string; readonly quantity: number }[];
  readonly moduleComponents: readonly { readonly componentId: string; readonly quantity: number }[];
  readonly agregado: {
    readonly id: string;
    readonly components: readonly { readonly componentId: string; readonly quantity: number }[];
  };
  readonly agregadoInstances: readonly {
    readonly id: string;
    readonly agregadoId: string;
    readonly quantity: number;
  }[];
  readonly expectedPartIds: readonly string[];
}

const fixture: ParityFixture = JSON.parse(
  readFileSync(join(__dirname, '../../../../contracts/bomPartIdentityParity.contract.json'), 'utf8'),
);

const board = (id: string, code: string, name: string, role: string): Component => ({
  id,
  code,
  name,
  placement: id === 'comp-puerta' ? 'puerta' : 'interno',
  geometry: { kind: 'rectangular_board', lengthMm: 700, widthMm: 500, thicknessMm: 18 },
  defaultEdges: [
    { side: 'L1', enabled: false },
    { side: 'L2', enabled: false },
    { side: 'W1', enabled: false },
    { side: 'W2', enabled: false },
  ],
  optionRoles: [role],
  active: true,
});

const catalog: Catalog = {
  materials: [
    {
      id: 'mat-body',
      code: 'MAT-BODY',
      name: 'Tablero paridad',
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
  hardware: [],
  optionGroups: [
    { id: 'og-body', code: 'BODY', name: 'Cuerpo', kind: 'board', required: true, optionIds: ['mat-body'] },
  ],
  components: [
    board('comp-lateral', 'LAT', 'Lateral', 'BODY'),
    board('comp-puerta', 'PUE', 'Puerta', 'BODY'),
    board('comp-frente-cajon', 'FCA', 'Frente Cajón', 'BODY'),
  ],
  structures: [
    {
      id: 'struct-a',
      code: 'ST-A',
      name: 'Cuerpo paridad',
      externalDims: { width: 600, height: 720, depth: 560 },
      components: fixture.structureComponents.map((entry) => ({ ...entry })),
      active: true,
    },
  ],
  agregados: [
    {
      id: fixture.agregado.id,
      code: 'CAJ',
      name: 'Cajones',
      externalDims: { width: 500, height: 120, depth: 500 },
      components: fixture.agregado.components.map((entry) => ({ ...entry })),
    } as unknown as Agregado,
  ],
  modules: [],
  optionGroups_: undefined,
} as unknown as Catalog;

const module: Module = {
  id: 'mod-a',
  code: 'MOD-A',
  name: 'Módulo paridad',
  structureId: 'struct-a',
  externalDims: { width: 600, height: 720, depth: 560 },
  components: fixture.moduleComponents.map((entry) => ({ ...entry })),
  agregados: fixture.agregadoInstances.map((entry) => ({ ...entry })),
  hardwareLines: [],
};

describe('bom part identity — Go/TS parity contract (#995 K3)', () => {
  it('names composed part ids exactly like the Go frozen BOM', () => {
    const bom = resolveBom(module, { BODY: 'mat-body' }, catalog);
    expect(bom.boardParts.map((part) => part.id)).toEqual(fixture.expectedPartIds);
  });
});
