/**
 * F131 — casos TS del transporte de perforaciones de herrajes posicionados
 * en AGREGADOS: fail-closed del lookup de host, instancias repetidas
 * (#388 instanceTag) y el negativo «sin perfil = sin taladros inventados».
 * El caso de paridad TS↔Go vive en agregadoPlacementDrilling.contract.test.ts.
 */

import { describe, expect, it } from 'vitest';
import {
  agregadoManualPlacementsForPart,
  resolveProjectDrilling,
} from './projectDrilling';
import type { Agregado, Catalog, Component, Module, Structure } from './types';
import {
  IDS,
  plantillaCatalogWithModules,
  plantillaProject,
} from './__fixtures__/plantillaDemo';

const placementsF131 = [
  {
    hardwareId: IDS.hwPlacaBis,
    anchorFace: 'front',
    relativePosition: { xMm: 30, yMm: 20 },
  },
] as const;

const agrDef: Agregado = {
  id: 'agr-f131',
  code: 'AGR-F131',
  name: 'Cajón F131',
  components: [
    {
      componentId: 'comp-agr-lat',
      quantity: 1,
      overrides: { hardwarePlacements: [...placementsF131] },
    },
  ],
};

const structure: Structure = {
  id: 'struct-f131',
  code: 'STRUCT-F131',
  name: 'Cuerpo F131',
  components: [],
};

describe('agregadoManualPlacementsForPart (F131)', () => {
  it('resuelve el componente anfitrión por prefijo exacto de la instancia', () => {
    const lookup = agregadoManualPlacementsForPart(
      'agr-agr-f131-u0-comp-agr-lat-copy-0',
      undefined,
      { agregados: [{ agregadoId: agrDef.id, quantity: 2 }] },
      [agrDef],
    );
    expect(lookup.unresolved).toBeUndefined();
    expect(lookup.placements).toEqual([...placementsF131]);
  });

  it('instanceTag de instancias repetidas (#388) resuelve por id persistido', () => {
    const lookup = agregadoManualPlacementsForPart(
      'agr-agr-f131-instance-i2-u1-comp-agr-lat-copy-0',
      undefined,
      {
        agregados: [
          { id: 'i1', agregadoId: agrDef.id, quantity: 1 },
          { id: 'i2', agregadoId: agrDef.id, quantity: 2 },
        ],
      },
      [agrDef],
    );
    expect(lookup.unresolved).toBeUndefined();
    expect(lookup.placements).toEqual([...placementsF131]);
  });

  it('prefijo de otra instancia distinta queda sin resolver (fail-closed)', () => {
    const lookup = agregadoManualPlacementsForPart(
      'agr-agr-f131-instance-otro-u0-comp-agr-lat-copy-0',
      undefined,
      { agregados: [{ id: 'i1', agregadoId: agrDef.id, quantity: 1 }] },
      [agrDef],
    );
    expect(lookup.unresolved).toBe('agr-agr-f131-instance-otro-u0-comp-agr-lat-copy-0');
    expect(lookup.placements).toEqual([]);
  });

  it('componente fantasma en la definición del agregado queda sin resolver', () => {
    const lookup = agregadoManualPlacementsForPart(
      'agr-agr-f131-u0-comp-fantasma-copy-0',
      undefined,
      { agregados: [{ agregadoId: agrDef.id, quantity: 1 }] },
      [agrDef],
    );
    expect(lookup.unresolved).toBe('agr-agr-f131-u0-comp-fantasma-copy-0');
  });

  it('un id no-agr no participa del lookup de agregado', () => {
    const lookup = agregadoManualPlacementsForPart(
      'mod-comp-normal-copy-1',
      undefined,
      { agregados: [{ agregadoId: agrDef.id, quantity: 1 }] },
      [agrDef],
    );
    expect(lookup.unresolved).toBeUndefined();
    expect(lookup.placements).toEqual([]);
  });
});

describe('resolveProjectDrilling con agregado (#1413 F131)', () => {
  // Herraje sin perfil de mecanizado: las correderas montan en superficie
  // (autoringManualMachiningProfiles Go: perfil ausente = 0 taladros).
  const hwSinPerfil = {
    id: 'hw-f131-sin-perfil',
    code: 'HER-SIN-PERFIL',
    name: 'Corredera sin perfil F131',
    unit: 'piece',
    costPerUnit: 100,
    active: true,
  } as const;

  const agrSinPerfil: Agregado = {
    id: 'agr-f131-sp',
    code: 'AGR-F131-SP',
    name: 'Cajón F131 sin perfil',
    components: [
      {
        componentId: 'comp-agr-lat',
        quantity: 1,
        overrides: {
          hardwarePlacements: [{ ...placementsF131[0], hardwareId: hwSinPerfil.id }],
        },
      },
    ],
  };

  const compAgrLat: Component = {
    id: 'comp-agr-lat',
    code: 'COM-AGR-LAT',
    name: 'Lateral de Cajón F131',
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

  const modF131: Module = {
    id: 'mod-f131',
    code: 'MOD-F131',
    name: 'Módulo F131',
    externalDims: { width: 600, height: 720, depth: 590 },
    furnitureType: 'inferior',
    structureId: structure.id,
    components: [],
    agregados: [
      { id: 'i1', agregadoId: agrDef.id, quantity: 1 },
      { id: 'i2', agregadoId: agrDef.id, quantity: 1 },
    ],
    hardwareLines: [],
  };

  const catalog: Catalog = {
    ...plantillaCatalogWithModules,
    hardware: [...plantillaCatalogWithModules.hardware, hwSinPerfil],
    components: [...(plantillaCatalogWithModules.components ?? []), compAgrLat],
    agregados: [agrDef, agrSinPerfil],
    structures: [...(plantillaCatalogWithModules.structures ?? []), structure],
    modules: [...plantillaCatalogWithModules.modules, modF131],
  };

  const result = resolveProjectDrilling({
    project: {
      ...plantillaProject,
      items: [
        {
          id: 'item-f131',
          moduleId: modF131.id,
          quantity: 1,
          optionChoices: { INTERIOR: IDS.matArauco },
        },
      ],
    },
    catalog,
    generatedAt: '2026-10-30T00:00:00.000Z',
  });

  const patternForPart = (partId: string) => {
    const link = result.links.find((l) => l.partId === partId);
    expect(link, `link para ${partId}`).toBeDefined();
    return result.patterns.find((p) => p.pieceCode === link!.labelRef);
  };

  it('instancias repetidas del agregado taladran su pieza con el instanceTag correcto', () => {
    for (const tag of ['i1', 'i2']) {
      const pattern = patternForPart(`agr-agr-f131-instance-${tag}-u0-comp-agr-lat-copy-0`);
      expect(pattern!.fallbackUsed).toBe(false);
      // HER-PLACA-BIS: 2 pilotos tornillo a ±16mm del ancla (sistema 32).
      // El `type` lo clasifica inferHoleType por nombre del herraje (plantilla
      // = 'hinge'); F131 fija el transporte: ancla + offsets en la pieza.
      expect(pattern!.holes).toEqual([
        expect.objectContaining({ diameterMm: 5, xMm: 30, yMm: 4 }),
        expect.objectContaining({ diameterMm: 5, xMm: 30, yMm: 36 }),
      ]);
    }
  });

  it('sin perfil de mecanizado no se inventan taladros', () => {
    // La corredera sin perfil es la ÚNICA definición de agregado usada aquí.
    const catalogSP: Catalog = {
      ...catalog,
      modules: [
        ...catalog.modules.filter((m) => m.id !== modF131.id),
        { ...modF131, id: 'mod-f131-sp', code: 'MOD-F131-SP', agregados: [{ id: 'j1', agregadoId: agrSinPerfil.id, quantity: 1 }] },
      ],
    };
    const resultSP = resolveProjectDrilling({
      project: {
        ...plantillaProject,
        items: [
          {
            id: 'item-f131-sp',
            moduleId: 'mod-f131-sp',
            quantity: 1,
            optionChoices: { INTERIOR: IDS.matArauco },
          },
        ],
      },
      catalog: catalogSP,
      generatedAt: '2026-10-30T00:00:00.000Z',
    });
    const agrSinPlacement: Agregado = {
      ...agrSinPerfil,
      components: [{ componentId: 'comp-agr-lat', quantity: 1 }],
    };
    const catalogBase: Catalog = {
      ...catalogSP,
      agregados: catalogSP.agregados?.map((a) => (a.id === agrSinPerfil.id ? agrSinPlacement : a)),
    };
    const resultBase = resolveProjectDrilling({
      project: {
        ...plantillaProject,
        items: [
          {
            id: 'item-f131-sp',
            moduleId: 'mod-f131-sp',
            quantity: 1,
            optionChoices: { INTERIOR: IDS.matArauco },
          },
        ],
      },
      catalog: catalogBase,
      generatedAt: '2026-10-30T00:00:00.000Z',
    });
    const pattern = resultSP.patterns.find((p) => p.partName.includes('F131'));
    expect(pattern).toBeDefined();
    const baseline = resultBase.patterns.find((p) => p.partName.includes('F131'));
    expect(baseline).toBeDefined();
    // Sin perfil, el placement no aporta NINGÚN agujero: el patrón queda en
    // fallback F074 y es byte-idéntico a la misma pieza SIN el placement —
    // cualquier taladro inventado del placement rompería esta igualdad.
    expect(pattern!.fallbackUsed).toBe(true);
    expect(pattern!.holes).toEqual(baseline!.holes);
    expect(resultSP.resolutionIssues).toEqual([]);
  });
});
