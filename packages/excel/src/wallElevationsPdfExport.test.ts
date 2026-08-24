import { describe, expect, it } from 'vitest';
import type { Module, Project } from '@muebles/domain';
import { PDFDocument } from 'pdf-lib';
import { wallElevationsPdfExport } from './wallElevationsPdfExport';

const modules: Module[] = [
  {
    id: 'm1',
    code: 'GAB-01',
    name: 'Gabinete',
    active: true,
    externalDims: { width: 600, height: 720, depth: 560 },
    boardParts: [],
    hardwareLines: [],
  } as Module,
  {
    id: 'm2',
    code: 'ISL-01',
    name: 'Isla',
    active: true,
    externalDims: { width: 900, height: 900, depth: 600 },
    boardParts: [],
    hardwareLines: [],
  } as Module,
];

function baseProject(over: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Obra con isla',
    customerId: 'c1',
    currency: 'MXN',
    marginFactor: 1.35,
    laborFixedCost: 0,
    status: 'accepted',
    items: [
      { id: 'i1', moduleId: 'm1', quantity: 1, optionChoices: {} },
      { id: 'i2', moduleId: 'm2', quantity: 1, optionChoices: {} },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...over,
  };
}

async function pageCount(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPageCount();
}

describe('wallElevationsPdfExport (#255 hojas de isla)', () => {
  it('genera una página por muro y una hoja por isla (+anexo si hay sin colocar)', async () => {
    const project = baseProject({
      items: [
        { id: 'i1', moduleId: 'm1', quantity: 1, optionChoices: {} },
        { id: 'i2', moduleId: 'm2', quantity: 1, optionChoices: {} },
        { id: 'i3', moduleId: 'm1', quantity: 1, optionChoices: {} },
      ],
      kitchenLayout: {
        walls: [{ id: 'w1', lengthMm: 3000, angleDeg: 0, name: 'Muro A' }],
        placements: [
          {
            itemId: 'i1',
            instanceIndex: 0,
            wallId: 'w1',
            offsetMm: 0,
            elevation: 'floor',
          },
          {
            itemId: 'i2',
            instanceIndex: 0,
            wallId: '',
            offsetMm: 0,
            elevation: 'floor',
            mode: 'free',
            freeXMm: 1200,
            freeYMm: 800,
            freeYawDeg: 90,
          },
          // i3 queda sin colocar → anexo
        ],
      },
    });
    const bytes = await wallElevationsPdfExport({
      project,
      modules,
      customerName: 'Cliente Demo',
    });
    // 1 muro + 1 isla + 1 anexo (i3 sin colocar)
    expect(await pageCount(bytes)).toBe(3);
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('obra sólo-islas exporta (1 hoja, sin muros ni anexo)', async () => {
    const project = baseProject({
      kitchenLayout: {
        walls: [],
        placements: [
          {
            itemId: 'i2',
            instanceIndex: 0,
            wallId: '',
            offsetMm: 0,
            elevation: 'floor',
            mode: 'free',
            freeXMm: 0,
            freeYMm: 0,
          },
        ],
      },
      items: [{ id: 'i2', moduleId: 'm2', quantity: 1, optionChoices: {} }],
    });
    const bytes = await wallElevationsPdfExport({ project, modules });
    expect(await pageCount(bytes)).toBe(1);
  });

  it('multi-ambiente: páginas agrupadas — muros e islas del mismo ambiente juntos (#254)', async () => {
    const cocinaWall = { id: 'w1', lengthMm: 3200, angleDeg: 0, name: 'Muro A' };
    const cocinaPlacements = [
      {
        itemId: 'i1',
        instanceIndex: 0,
        wallId: 'w1',
        offsetMm: 0,
        elevation: 'floor' as const,
      },
      {
        itemId: 'i2',
        instanceIndex: 0,
        wallId: '',
        offsetMm: 0,
        elevation: 'floor' as const,
        mode: 'free' as const,
        freeXMm: 1000,
        freeYMm: 500,
      },
    ];
    const project = baseProject({
      items: [
        { id: 'i1', moduleId: 'm1', quantity: 1, optionChoices: {} },
        { id: 'i2', moduleId: 'm2', quantity: 1, optionChoices: {} },
        { id: 'i3', moduleId: 'm1', quantity: 1, optionChoices: {} },
      ],
      kitchenLayout: {
        // Top-level espeja el espacio activo (cocina), como la store real.
        walls: [cocinaWall],
        placements: cocinaPlacements,
        activeSpaceId: 'space-cocina',
        spaces: [
          {
            id: 'space-cocina',
            name: 'Cocina',
            walls: [cocinaWall],
            placements: cocinaPlacements,
          },
          {
            id: 'space-bano',
            name: 'Baño',
            walls: [{ id: 'w2', lengthMm: 2000, angleDeg: 0, name: 'Muro B' }],
            placements: [],
          },
        ],
      },
    });
    const bytes = await wallElevationsPdfExport({ project, modules });
    // Grupo Cocina (muro + isla) → grupo Baño (muro) → anexo (i3 sin colocar).
    // El orden por grupos lo garantiza groupProductionElevationsBySpace
    // (test de dominio); aquí validamos el conteo de páginas resultante.
    expect(await pageCount(bytes)).toBe(4);
  });

  it('sin muros ni islas rechaza con error explícito', async () => {
    await expect(
      wallElevationsPdfExport({ project: baseProject(), modules }),
    ).rejects.toThrow(/Sin muros ni islas/);
  });
});
