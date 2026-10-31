/**
 * #1413 F131 — paridad compartida TS↔Go del transporte de perforaciones de
 * herrajes posicionados en AGREGADOS. El MISMO fixture lo consume el engine
 * Go (agregado_placement_drilling_contract_test.go, camino release
 * definition-default): un placement autorado sobre un componente de agregado
 * taladra su pieza anfitriona `agr-*` en AMBOS runtimes con el mismo agujero
 * (face=anchorFace, x/y=relativePosition, Ø5, 10mm, screw — el perfil TS
 * autorado del fixture espeja el perfil estático Go de HER-PLACA-BIS).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveProjectDrilling } from './projectDrilling';
import type { Agregado, Catalog, Component, Hardware, Module, Structure } from './types';
import {
  IDS,
  plantillaCatalogWithModules,
  plantillaProject,
} from './__fixtures__/plantillaDemo';

interface PlacementDrillingFixture {
  readonly hardware: Pick<Hardware, 'id' | 'code' | 'name' | 'unit' | 'costPerUnit' | 'active' | 'machining'>;
  readonly agregado: Agregado;
  readonly agregadoInstances: readonly { agregadoId: string; quantity: number }[];
  readonly expected: {
    readonly hostPartIdUnit0: string;
    readonly hostPartIdUnit1: string;
    readonly hole: {
      readonly face: string;
      readonly xMm: number;
      readonly yMm: number;
      readonly diameterMm: number;
      readonly depthMm: number;
      readonly type: string;
    };
  };
}

const fixturePath = resolve(__dirname, '../../../contracts/agregadoPlacementDrilling.contract.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as PlacementDrillingFixture;

// The agregado's board component: the fixture carries only the identity +
// placement slice (runtime-neutral); each runtime authors its own board.
const compAgrLateral: Component = {
  id: 'comp-agr-lateral',
  code: 'COM-AGR-LAT',
  name: 'Lateral de Cajón (agregado F131)',
  placement: 'interno',
  geometry: { kind: 'rectangular_board', lengthMm: 500, widthMm: 120, thicknessMm: 18 },
  defaultEdges: [
    { side: 'L1', enabled: false },
    { side: 'L2', enabled: false },
    { side: 'W1', enabled: false },
    { side: 'W2', enabled: false },
  ],
  optionRoles: ['INTERIOR'],
  active: true,
};

const structF131: Structure = {
  id: 'struct-agr-f131',
  code: 'STRUCT-AGR-F131',
  name: 'Cuerpo F131',
  components: [],
};

const modF131: Module = {
  id: 'mod-agr-f131',
  code: 'MOD-AGR-F131',
  name: 'Módulo con agregado F131',
  externalDims: { width: 600, height: 720, depth: 590 },
  furnitureType: 'inferior',
  structureId: structF131.id,
  components: [],
  agregados: fixture.agregadoInstances,
  hardwareLines: [],
};

const catalog: Catalog = {
  ...plantillaCatalogWithModules,
  hardware: [...plantillaCatalogWithModules.hardware, fixture.hardware],
  components: [...(plantillaCatalogWithModules.components ?? []), compAgrLateral],
  agregados: [fixture.agregado],
  structures: [...(plantillaCatalogWithModules.structures ?? []), structF131],
  modules: [...plantillaCatalogWithModules.modules, modF131],
};

const project = {
  ...plantillaProject,
  items: [
    {
      id: 'item-f131',
      moduleId: modF131.id,
      quantity: 1,
      optionChoices: { INTERIOR: IDS.matArauco },
    },
  ],
};

describe('agregadoPlacementDrilling contract (#1413 F131)', () => {
  const result = resolveProjectDrilling({ project, catalog, generatedAt: '2026-10-30T00:00:00.000Z' });

  it('el placement del agregado taladra la pieza anfitriona de cada unidad con el agujero del contrato', () => {
    for (const hostPartId of [fixture.expected.hostPartIdUnit0, fixture.expected.hostPartIdUnit1]) {
      const link = result.links.find((l) => l.partId === hostPartId);
      expect(link, `link para ${hostPartId}`).toBeDefined();
      const pattern = result.patterns.find((p) => p.pieceCode === link!.labelRef);
      expect(pattern, `patrón para ${hostPartId}`).toBeDefined();
      expect(pattern!.fallbackUsed).toBe(false);
      expect(pattern!.holes).toEqual([
        {
          face: fixture.expected.hole.face,
          xMm: fixture.expected.hole.xMm,
          yMm: fixture.expected.hole.yMm,
          diameterMm: fixture.expected.hole.diameterMm,
          depthMm: fixture.expected.hole.depthMm,
          type: fixture.expected.hole.type,
          description: expect.any(String),
        },
      ]);
    }
  });

  it('sin issues de resolución ni de perforación en ninguna pieza', () => {
    expect(result.resolutionIssues).toEqual([]);
    const withIssues = result.patterns.filter((p) => p.issues.length > 0);
    expect(withIssues.map((p) => `${p.partName}: ${p.issues.map((i) => i.message).join(' | ')}`)).toEqual([]);
  });
});
