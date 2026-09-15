import { describe, expect, it } from 'vitest';

import {
  planMatchesReleaseBase,
  releaseBaseFromDemand,
  releaseCutRowsFromDemand,
  type ReleaseCuttingDemandView,
} from './engineeringCuttingDemand';
import type { Catalog, MaterialBoard, EdgeBand, Module } from './types';

function material(id: string, name: string, over: Partial<MaterialBoard> = {}): MaterialBoard {
  return {
    id,
    code: `CODE-${id}`,
    name,
    widthMm: 1830,
    lengthMm: 2440,
    thicknessMm: 18,
    grainDefault: false,
    boardPrice: 100,
    wastePercent: 10,
    costPerM2: 10,
    active: true,
    ...over,
  };
}

function edge(id: string, thicknessMm = 1): EdgeBand {
  return {
    id,
    code: `EDGE-${id}`,
    name: `Canto ${id}`,
    thicknessMm,
    costPerMl: 2,
    active: true,
  };
}

function moduleFixture(id: string, code: string): Module {
  return {
    id,
    code,
    name: code,
    baseLaborCost: 0,
    boardParts: [],
    hardwareLines: [],
    createdAt: '',
    updatedAt: '',
  } as unknown as Module;
}

function catalogFixture(): Catalog {
  return {
    materials: [material('mat-1', 'MDF Blanco 18'), material('mat-2', 'Roble 18')],
    edges: [edge('edge-1', 1)],
    hardware: [],
    optionGroups: [],
    modules: [moduleFixture('def-a', 'MOD-BAJO-600')],
  } as unknown as Catalog;
}

function demandFixture(over: Partial<ReleaseCuttingDemandView> = {}): ReleaseCuttingDemandView {
  return {
    releaseId: 'rel-1',
    releaseNumber: 1,
    designRevisionId: 'rev-2',
    designRevisionNumber: 2,
    manufacturingFingerprint: 'sha256-' + 'a'.repeat(64),
    schemaVersion: 2,
    units: [
      {
        furnitureInstanceId: 'fi-1',
        furnitureDefinitionId: 'def-a',
        pieces: [
          {
            partId: 'part-front',
            partCode: 'FRENTE',
            description: 'Frente',
            quantity: 1,
            lengthMm: 650,
            widthMm: 720,
            thicknessMm: 18,
            materialId: 'mat-1',
            edgeBandId: 'edge-1',
            grain: 1,
            l1: 1,
            l2: 0,
            w1: 0,
            w2: 1,
            optionRole: 'FRENTE',
          },
          {
            partId: 'part-shelf',
            description: 'Estante',
            quantity: 2,
            lengthMm: 590,
            widthMm: 560,
            thicknessMm: 18,
            materialId: 'mat-2',
            grain: 0,
            l1: 0,
            l2: 0,
            w1: 0,
            w2: 0,
          },
        ],
      },
      {
        furnitureInstanceId: 'fi-2',
        furnitureDefinitionId: 'def-a',
        pieces: [
          {
            partId: 'part-front',
            partCode: 'FRENTE',
            description: 'Frente',
            quantity: 1,
            lengthMm: 600,
            widthMm: 720,
            thicknessMm: 18,
            materialId: 'mat-1',
            grain: 1,
            l1: 1,
            l2: 0,
            w1: 0,
            w2: 1,
          },
        ],
      },
    ],
    ...over,
  };
}

describe('releaseCutRowsFromDemand (#739)', () => {
  it('preserves unit/occurrence identity, quantities, frozen dims, material, grain, edges and thickness', () => {
    const rows = releaseCutRowsFromDemand(demandFixture(), catalogFixture());

    expect(rows).toHaveLength(3);
    const [front1, shelf, front2] = rows;

    // Occurrence identity: unit + part, never deduplicated across units.
    expect(front1?.labelRef).toBe('fi-1:part-front');
    expect(front2?.labelRef).toBe('fi-2:part-front');
    expect(shelf?.labelRef).toBe('fi-1:part-shelf');

    // Frozen dimensions are the release truth (650 for fi-1, 600 for fi-2).
    expect(front1?.lengthMm).toBe(650);
    expect(front2?.lengthMm).toBe(600);
    expect(shelf?.quantity).toBe(2);

    // Grain and edge flags mirror the frozen projection.
    expect(front1?.grain).toBe(1);
    expect(front1?.L1).toBe(1);
    expect(front1?.W2).toBe(1);
    expect(front1?.L2).toBe(0);
    expect(shelf?.grain).toBe(0);

    // Effective thickness + edge band resolution come as explicit inputs.
    expect(front1?.thicknessMm).toBe(18);
    expect(front1?.edgeBandThicknessMm).toBe(1);
    expect(front1?.edgeBandCode).toBe('EDGE-edge-1');

    // Material identity is matched by id; labels/formats come from the
    // current catalog as explicit engineering inputs.
    expect(front1?.materialName).toBe('MDF Blanco 18');
    expect(front1?.materialCode).toBe('CODE-mat-1');
    expect(shelf?.materialName).toBe('Roble 18');

    // Description keeps the workshop F048 convention with the module label.
    expect(front1?.description).toBe('FRENTE · Frente · MOD-BAJO-600');
    expect(front1?.partCode).toBe('FRENTE');
    expect(front1?.moduleCode).toBe('MOD-BAJO-600');
  });

  it('fails closed when a frozen material is no longer in the catalog (no default sheet format)', () => {
    const catalog = catalogFixture();
    const broken = { ...catalog, materials: catalog.materials.filter((m) => m.id !== 'mat-2') };
    expect(() => releaseCutRowsFromDemand(demandFixture(), broken)).toThrowError(/mat-2/);
  });

  it('fails closed when a frozen edge band is no longer in the catalog (no silent zero deduction)', () => {
    const catalog = catalogFixture();
    const broken = { ...catalog, edges: [] };
    expect(() => releaseCutRowsFromDemand(demandFixture(), broken)).toThrowError(/edge-1/);
  });

  it('falls back to the definition id as the module label when the module left the catalog', () => {
    const catalog = { ...catalogFixture(), modules: [] };
    const rows = releaseCutRowsFromDemand(demandFixture(), catalog);
    expect(rows[0]?.moduleCode).toBe('def-a');
    // The piece demand itself is untouched — only the display label degrades.
    expect(rows[0]?.lengthMm).toBe(650);
  });
});

describe('release base pin (#739)', () => {
  it('derives the base from the demand and matches only the exact pins', () => {
    const demand = demandFixture();
    const base = releaseBaseFromDemand(demand);
    const plan = { releaseBase: base } as never;

    expect(planMatchesReleaseBase(plan, base)).toBe(true);
    expect(planMatchesReleaseBase(plan, { ...base, releaseId: 'rel-2' })).toBe(false);
    expect(
      planMatchesReleaseBase(plan, { ...base, manufacturingFingerprint: 'sha256-' + 'b'.repeat(64) }),
    ).toBe(false);
    expect(planMatchesReleaseBase({} as never, base)).toBe(false);
    expect(planMatchesReleaseBase(plan, null)).toBe(false);
  });
});
