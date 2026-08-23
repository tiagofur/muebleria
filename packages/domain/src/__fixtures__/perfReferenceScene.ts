/**
 * F147 / #312 (P3D-6) — escena de referencia de performance para Proyectar.
 *
 * Generador puro y determinista (North Star §18): 30 ítems / 23 instancias
 * colocadas en el espacio activo ("Cocina") + un segundo espacio ("Office")
 * que también resuelve BOM aunque no se renderice — ejerce el costo real de
 * `resolveProject3DPreview` (resuelve TODOS los ítems, renderiza el espacio
 * activo). Reutiliza módulos/presets probados del catálogo LatAm del seed.
 *
 * El conteo (≥20 muebles renderizados, ≥300 piezas resueltas) lo mantiene
 * honesto `perfReferenceScene.test.ts` — si un cambio de catálogo reduce la
 * escena, el gate obliga a revisar el baseline de performance.
 */

import type {
  Project,
  ProjectItem,
  ProjectItemPlacement,
  ProjectKitchenLayout,
} from '../types';
import { seedCatalogExpandedLatAm } from './cocinaLopezDemo';
import { plantillaChoices } from './plantillaDemo';

/** Catálogo canónico contra el que resuelve la escena de referencia. */
export const perfReferenceCatalog = seedCatalogExpandedLatAm;

/** Módulo + preset + ancho conocido (mm) — pares probados del catálogo seed. */
type ModuleSpec = {
  readonly moduleId: string;
  readonly presetId: string;
  readonly widthMm: number;
};

const BAJO_800: ModuleSpec = {
  moduleId: 'mod-bajo-800',
  presetId: 'b800-p1',
  widthMm: 800,
};
const CAJONERA_3C: ModuleSpec = {
  moduleId: 'mod-caj-3c',
  presetId: 'c3c-p1',
  widthMm: 600,
};
const HORNO_600: ModuleSpec = {
  moduleId: 'mod-horno-600',
  presetId: 'horno-p1',
  widthMm: 600,
};
const FREGADERO_900: ModuleSpec = {
  moduleId: 'mod-freg-900',
  presetId: 'freg-p1',
  widthMm: 900,
};
const ALACENA_800: ModuleSpec = {
  moduleId: 'mod-ala-800',
  presetId: 'a800-p1',
  widthMm: 800,
};
const ALACENA_600: ModuleSpec = {
  moduleId: 'seed-mod-alacena-001',
  presetId: 'ala-preset-600',
  widthMm: 600,
};
const CAMPANA: ModuleSpec = {
  moduleId: 'mod-ala-camp',
  presetId: 'acamp-p1',
  widthMm: 600,
};
const ALACENA_ESQ: ModuleSpec = {
  moduleId: 'mod-ala-esq',
  presetId: 'aesq-p1',
  widthMm: 600,
};
const DESPENSA: ModuleSpec = {
  moduleId: 'seed-mod-despensa-001',
  presetId: 'des-preset-2100',
  widthMm: 600,
};
const ISLA_1200: ModuleSpec = {
  moduleId: 'mod-isla-1200',
  presetId: 'isla-p1',
  widthMm: 1200,
};

type PlacementSpec = {
  readonly itemIndex: number;
  readonly wallId: string;
  readonly elevation: 'floor' | 'wall';
  readonly offsetMm: number;
};

/**
 * Construye la fila de placements acumulando offsets por ancho conocido +
 * gap de 50 mm (determinista, sin colisiones, sin dependencia del resolver).
 */
function runOnWall(
  wallId: string,
  elevation: 'floor' | 'wall',
  specs: readonly ModuleSpec[],
  itemIndexStart: number,
  gapMm = 50,
): { placements: PlacementSpec[]; nextIndex: number; cursorMm: number } {
  let cursor = 100;
  const placements: PlacementSpec[] = [];
  let index = itemIndexStart;
  for (const spec of specs) {
    placements.push({
      itemIndex: index,
      wallId,
      elevation,
      offsetMm: cursor,
    });
    cursor += spec.widthMm + gapMm;
    index += 1;
  }
  return { placements, nextIndex: index, cursorMm: cursor };
}

export function buildPerfReferenceProject(): Project {
  // ── Espacio activo "Cocina": 23 instancias en 3 muros + isla ──────────
  const mainFloor = [BAJO_800, CAJONERA_3C, HORNO_600, FREGADERO_900, BAJO_800, CAJONERA_3C];
  const mainWall = [ALACENA_800, ALACENA_600, CAMPANA, ALACENA_ESQ, ALACENA_800, ALACENA_600];
  const retFloor = [DESPENSA, BAJO_800, CAJONERA_3C];
  const retWall = [ALACENA_600, ALACENA_800];
  const shortFloor = [CAJONERA_3C, BAJO_800];
  const shortWall = [ALACENA_600, CAMPANA];

  const cocinaSpecs: readonly (readonly ModuleSpec[])[] = [
    mainFloor,
    mainWall,
    retFloor,
    retWall,
    shortFloor,
    shortWall,
  ];
  const cocinaItemSpecs = cocinaSpecs.flat();
  const cocinaCount = cocinaItemSpecs.length; // 22 en muros
  const islaIndex = cocinaCount; // índice 22

  // ── Espacio 2 "Office": 7 ítems colocados (resuelven, no renderizan) ──
  const officeFloorA = [BAJO_800, CAJONERA_3C, BAJO_800];
  const officeWallA = [ALACENA_800, ALACENA_600];
  const officeFloorB = [HORNO_600, CAJONERA_3C];
  const officeSpecs = [officeFloorA, officeWallA, officeFloorB].flat();
  const officeCount = officeSpecs.length; // 7

  const allSpecs = [...cocinaItemSpecs, ISLA_1200, ...officeSpecs];
  const items: ProjectItem[] = allSpecs.map((spec, i) => ({
    id: `perf-item-${String(i + 1).padStart(2, '0')}`,
    moduleId: spec.moduleId,
    measurePresetId: spec.presetId,
    // Cajoneras duplicadas (quantity 2): piezas ×2 en BOM y segunda instancia
    // colocada — acerca el conteo de piezas al mínimo del §18 sin inflar
    // artificialmente el número de ítems.
    quantity: spec.moduleId === 'mod-caj-3c' ? 2 : 1,
    optionChoices: { ...plantillaChoices },
  }));

  let next = 0;
  const cocinaPlacements: ProjectItemPlacement[] = [];
  for (const [specs, wallId, elevation] of [
    [mainFloor, 'perf-wall-main', 'floor'],
    [mainWall, 'perf-wall-main', 'wall'],
    [retFloor, 'perf-wall-ret', 'floor'],
    [retWall, 'perf-wall-ret', 'wall'],
    [shortFloor, 'perf-wall-short', 'floor'],
    [shortWall, 'perf-wall-short', 'wall'],
  ] as const) {
    const run = runOnWall(wallId, elevation, specs, next);
    cocinaPlacements.push(
      ...run.placements.map((p) => ({
        itemId: items[p.itemIndex]!.id,
        instanceIndex: 0,
        wallId: p.wallId,
        offsetMm: p.offsetMm,
        elevation: p.elevation,
      })),
    );
    next = run.nextIndex;
  }
  // Isla: placement libre al centro del ambiente.
  cocinaPlacements.push({
    itemId: items[islaIndex]!.id,
    instanceIndex: 0,
    wallId: '',
    offsetMm: 0,
    elevation: 'floor',
    mode: 'free',
    freeXMm: 2200,
    freeYMm: 2400,
  });

  // Segundas instancias (instanceIndex 1) de las cajoneras quantity-2 del
  // espacio activo — índices según el orden plano de cocinaItemSpecs:
  // main floor 0..5, main wall 6..11, ret floor 12..14, short floor 17..18.
  cocinaPlacements.push(
    { itemId: items[1]!.id, instanceIndex: 1, wallId: 'perf-wall-main', offsetMm: 5700, elevation: 'floor' },
    { itemId: items[5]!.id, instanceIndex: 1, wallId: 'perf-wall-main', offsetMm: 6350, elevation: 'floor' },
    { itemId: items[14]!.id, instanceIndex: 1, wallId: 'perf-wall-ret', offsetMm: 2300, elevation: 'floor' },
    { itemId: items[17]!.id, instanceIndex: 1, wallId: 'perf-wall-short', offsetMm: 1650, elevation: 'floor' },
  );

  let officeNext = islaIndex + 1;
  const officePlacements: ProjectItemPlacement[] = [];
  for (const [specs, wallId, elevation] of [
    [officeFloorA, 'perf-wall-office-a', 'floor'],
    [officeWallA, 'perf-wall-office-a', 'wall'],
    [officeFloorB, 'perf-wall-office-b', 'floor'],
  ] as const) {
    const run = runOnWall(wallId, elevation, specs, officeNext);
    officePlacements.push(
      ...run.placements.map((p) => ({
        itemId: items[p.itemIndex]!.id,
        instanceIndex: 0,
        wallId: p.wallId,
        offsetMm: p.offsetMm,
        elevation: p.elevation,
      })),
    );
    officeNext = run.nextIndex;
  }

  const cocinaLayout: ProjectKitchenLayout = {
    baseClearanceMm: 100,
    wallCabinetZMm: 1400,
    showCountertop: true,
    floorMaterialId: 'amb-floor-porcelanato',
    wallMaterialId: 'amb-wall-yeso-blanco',
    walls: [
      {
        id: 'perf-wall-main',
        name: 'Muro Principal',
        lengthMm: 7000,
        angleDeg: 0,
        originXMm: 0,
        originYMm: 0,
      },
      {
        id: 'perf-wall-ret',
        name: 'Muro Retorno',
        lengthMm: 3000,
        angleDeg: 90,
        originXMm: 7000,
        originYMm: 0,
      },
      {
        id: 'perf-wall-short',
        name: 'Muro Corto',
        lengthMm: 2400,
        angleDeg: 270,
        originXMm: 0,
        originYMm: 0,
      },
    ],
    placements: cocinaPlacements,
  };

  const kitchenLayout: ProjectKitchenLayout = {
    ...cocinaLayout,
    activeSpaceId: 'perf-space-cocina',
    spaces: [
      { id: 'perf-space-cocina', name: 'Cocina', ...cocinaLayout },
      {
        id: 'perf-space-office',
        name: 'Office',
        baseClearanceMm: 100,
        wallCabinetZMm: 1400,
        showCountertop: false,
        walls: [
          {
            id: 'perf-wall-office-a',
            name: 'Muro Office A',
            lengthMm: 3200,
            angleDeg: 0,
            originXMm: 0,
            originYMm: 0,
          },
          {
            id: 'perf-wall-office-b',
            name: 'Muro Office B',
            lengthMm: 2000,
            angleDeg: 90,
            originXMm: 3200,
            originYMm: 0,
          },
        ],
        placements: officePlacements,
      },
    ],
  };

  return {
    id: 'proj-perf-reference-3d',
    name: 'Perf referencia 3D (30 muebles, 2 ambientes)',
    customerId: 'cust-plantilla-2',
    currency: 'MXN',
    marginFactor: 1.35,
    laborFixedCost: 1500,
    status: 'draft',
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
    items,
    kitchenLayout,
  };
}

export const PERF_REFERENCE_PROJECT_ID = 'proj-perf-reference-3d';
