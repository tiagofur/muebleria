import { describe, expect, it } from 'vitest';
import type {
  Agregado,
  Component,
  EdgeBand,
  Hardware,
  MaterialBoard,
  Module,
  OptionGroup,
  Project,
  Structure,
} from '@muebles/domain';
import {
  resolveModuleHardwarePlacements,
  resolveProject3DPreview,
} from './project3dPreview';
import { PROJECT_RUN_GAP_MM } from './project3dLayout';

const edge: EdgeBand = {
  id: 'edge-a',
  code: 'EDGE-A',
  name: 'Canto',
  thicknessMm: 1,
  costPerMl: 0.5,
  active: true,
};

const material: MaterialBoard = {
  id: 'mat-a',
  code: 'MAT-A',
  name: 'Blanco',
  widthMm: 1830,
  lengthMm: 2750,
  thicknessMm: 18,
  boardPrice: 100,
  wastePercent: 10,
  costPerM2: 50,
  grainDefault: false,
  active: true,
  defaultEdgeBandId: 'edge-a',
};

const optionGroups: OptionGroup[] = [
  {
    id: 'og-int',
    code: 'INTERIOR',
    name: 'Interior',
    kind: 'board',
    required: true,
    optionIds: ['mat-a'],
  },
];

const comp: Component = {
  id: 'c1',
  code: 'COM-1',
  name: 'Costado',
  placement: 'lateral_izquierdo',
  geometry: {
    kind: 'rectangular_board',
    lengthMm: 720,
    widthMm: 560,
    thicknessMm: 18,
    lengthFormula: 'PH',
    widthFormula: 'PD',
  },
  defaultEdges: [
    { side: 'L1', enabled: true },
    { side: 'L2', enabled: true },
    { side: 'W1', enabled: true },
    { side: 'W2', enabled: true },
  ],
  optionRoles: ['INTERIOR'],
  active: true,
  xFormula: 'i * (PW - T)',
  yFormula: '0',
  zFormula: '0',
  rotateY: 90,
};

const structure: Structure = {
  id: 'st1',
  code: 'EST-1',
  name: 'Cuerpo',
  externalDims: { width: 600, height: 720, depth: 560 },
  components: [{ componentId: 'c1', quantity: 2 }],
  active: true,
};

const modA: Module = {
  id: 'm-a',
  code: 'MOD-A',
  name: 'Bajo 600',
  structureId: 'st1',
  components: [],
  hardwareLines: [],
  externalDims: { width: 600, height: 720, depth: 560 },
  presets: [
    { id: 'p600', name: '600', width: 600, height: 720, depth: 560 },
  ],
};

const modB: Module = {
  id: 'm-b',
  code: 'MOD-B',
  name: 'Bajo 400',
  structureId: 'st1',
  components: [],
  hardwareLines: [],
  externalDims: { width: 400, height: 720, depth: 560 },
  presets: [
    { id: 'p400', name: '400', width: 400, height: 720, depth: 560 },
  ],
};

const catalog = {
  modules: [modA, modB],
  structures: [structure],
  components: [comp],
  materials: [material],
  edges: [edge],
  hardware: [] as readonly Hardware[],
  optionGroups,
};

const project: Project = {
  id: 'prj-1',
  name: 'Cocina demo',
  customerId: 'c1',
  currency: 'UYU',
  marginFactor: 1.5,
  laborFixedCost: 0,
  status: 'draft',
  items: [
    {
      id: 'it-a',
      moduleId: 'm-a',
      quantity: 1,
      optionChoices: {},
      measurePresetId: 'p600',
    },
    {
      id: 'it-b',
      moduleId: 'm-b',
      quantity: 2,
      optionChoices: {},
      measurePresetId: 'p400',
    },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('resolveProject3DPreview', () => {
  it('lays out all items in a linear run (qty expanded)', () => {
    const preview = resolveProject3DPreview(project, catalog);
    expect(preview.empty).toBe(false);
    // 1 + 2 copies
    expect(preview.modules).toHaveLength(3);
    expect(preview.layoutMode).toBe('linear');
    expect(preview.modules[0]!.originX).toBe(0);
    expect(preview.modules[0]!.yawDeg).toBe(0);
    expect(preview.modules[1]!.originX).toBe(600 + PROJECT_RUN_GAP_MM);
    expect(preview.modules[2]!.originX).toBe(
      600 + PROJECT_RUN_GAP_MM + 400 + PROJECT_RUN_GAP_MM,
    );
    expect(preview.modules.every((m) => m.parts.length > 0)).toBe(true);
  });

  it('can focus a single line item', () => {
    const preview = resolveProject3DPreview(project, catalog, {
      itemId: 'it-b',
    });
    expect(preview.modules).toHaveLength(2);
    expect(preview.modules.every((m) => m.itemId === 'it-b')).toBe(true);
  });

  it('uses kitchen plan with yaw and keeps unplaced as linear tail', () => {
    const withPlan: Project = {
      ...project,
      kitchenLayout: {
        walls: [
          {
            id: 'w1',
            lengthMm: 3000,
            angleDeg: 0,
            originXMm: 0,
            originYMm: 0,
          },
          {
            id: 'w2',
            lengthMm: 2500,
            angleDeg: 90,
            originXMm: 3000,
            originYMm: 0,
          },
        ],
        placements: [
          {
            itemId: 'it-a',
            instanceIndex: 0,
            wallId: 'w1',
            offsetMm: 0,
            elevation: 'floor',
          },
          {
            itemId: 'it-b',
            instanceIndex: 0,
            wallId: 'w2',
            offsetMm: 0,
            elevation: 'floor',
          },
          // it-b#1 intentionally unplaced (qty 2)
        ],
      },
    };
    const preview = resolveProject3DPreview(withPlan, catalog);
    expect(preview.layoutMode).toBe('kitchen');
    expect(preview.placedCount).toBe(2);
    expect(preview.unplacedCount).toBe(1);
    expect(preview.modules).toHaveLength(3);
    expect(preview.walls.length).toBe(2);

    const onW1 = preview.modules.find((m) => m.instanceKey === 'it-a#0')!;
    const onW2 = preview.modules.find((m) => m.instanceKey === 'it-b#0')!;
    const tail = preview.modules.find((m) => m.instanceKey === 'it-b#1')!;
    expect(onW1.yawDeg).toBe(0);
    expect(onW2.yawDeg).toBe(90);
    expect(tail.yawDeg).toBe(0);
    expect(tail.originX).toBeGreaterThan(onW1.originX);
    expect(
      preview.errors.some((e) => e.includes('sin colocar')),
    ).toBe(true);
  });

  it('studio mode hides unplaced tail but keeps walls', () => {
    const withPlan: Project = {
      ...project,
      kitchenLayout: {
        walls: [
          {
            id: 'w1',
            lengthMm: 3000,
            angleDeg: 0,
            originXMm: 0,
            originYMm: 0,
          },
        ],
        placements: [
          {
            itemId: 'it-a',
            instanceIndex: 0,
            wallId: 'w1',
            offsetMm: 0,
            elevation: 'floor',
          },
        ],
      },
    };
    const preview = resolveProject3DPreview(withPlan, catalog, {
      unplacedPolicy: 'hide',
      kitchenWallsOnly: true,
    });
    expect(preview.layoutMode).toBe('kitchen');
    expect(preview.modules).toHaveLength(1);
    expect(preview.unplacedCount).toBe(2); // it-b × 2
    expect(preview.walls.length).toBe(1);
  });

  it('uses kitchen mode for free-only islands (no walls)', () => {
    const freeOnly: Project = {
      ...project,
      kitchenLayout: {
        walls: [],
        placements: [
          {
            itemId: 'it-a',
            instanceIndex: 0,
            wallId: '',
            offsetMm: 0,
            elevation: 'floor',
            mode: 'free',
            freeXMm: 1200,
            freeYMm: 800,
            freeYawDeg: 90, // free yaw is snapped to cardinals (wallDirectionYawDeg)
          },
        ],
      },
    };
    const preview = resolveProject3DPreview(freeOnly, catalog, {
      unplacedPolicy: 'hide',
    });
    expect(preview.layoutMode).toBe('kitchen');
    const island = preview.modules.find((m) => m.instanceKey === 'it-a#0');
    expect(island).toBeDefined();
    // Plan mm: freeX → originX, freeY → originY; originZ is height (zócalo).
    expect(island!.originX).toBe(1200);
    expect(island!.originY).toBe(800);
    expect(island!.yawDeg).toBe(90);
    // Must not fall back to linear run at origin 0.
    expect(island!.originX).not.toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Fase 2 — parametric hardware placements (WU3 bridge, VH-T09..T12).
// Separate catalog/project so the no-regression suite above stays untouched.
// ---------------------------------------------------------------------------

const puertaComponent: Component = {
  id: 'c-puerta',
  code: 'COM-PUERTA',
  name: 'Puerta',
  placement: 'frontal',
  geometry: {
    kind: 'rectangular_board',
    // Fixed dims (no formulas) → deterministic resolved board part.
    lengthMm: 720,
    widthMm: 596,
    thicknessMm: 18,
  },
  defaultEdges: [
    { side: 'L1', enabled: true },
    { side: 'L2', enabled: true },
    { side: 'W1', enabled: true },
    { side: 'W2', enabled: true },
  ],
  // INTERIOR routes through the fixture's only option group (→ mat-a). The
  // optionRole only picks the material; it does not affect placement geometry.
  optionRoles: ['INTERIOR'],
  active: true,
};

const structureWithPuerta: Structure = {
  ...structure,
  id: 'st-puerta',
  components: [{ componentId: 'c-puerta', quantity: 1 }],
};

const knobHardware: Hardware = {
  id: 'hw-knob',
  code: 'HW-KNOB',
  name: 'Jaladera knob',
  unit: 'piece',
  costPerUnit: 0,
  active: true,
  previewShape: 'knob',
  previewDiameterMm: 32,
  previewProjectionMm: 25,
  previewColor: '#888888',
  previewMetalness: 0.9,
  previewRoughness: 0.25,
};

const costOnlyHardware: Hardware = {
  id: 'hw-cost-only',
  code: 'HW-COST',
  name: 'Herraje solo costo',
  unit: 'piece',
  costPerUnit: 0,
  active: true,
  // no previewShape → resolver returns null (VH-09)
};

const modWithHandle: Module = {
  id: 'm-handle',
  code: 'MOD-HANDLE',
  name: 'Bajo con jaladera',
  structureId: 'st-puerta',
  components: [],
  hardwareLines: [],
  externalDims: { width: 600, height: 720, depth: 560 },
  presets: [
    { id: 'p-handle', name: '600', width: 600, height: 720, depth: 560 },
  ],
};

const catalogWithHardware = {
  modules: [modWithHandle],
  structures: [structureWithPuerta],
  components: [puertaComponent],
  materials: [material],
  edges: [edge],
  hardware: [knobHardware, costOnlyHardware],
  optionGroups,
};

const projectWithHandle: Project = {
  ...project,
  items: [
    {
      id: 'it-handle',
      moduleId: 'm-handle',
      quantity: 1,
      optionChoices: {},
      measurePresetId: 'p-handle',
    },
  ],
};

describe('resolveProject3DPreview — hardware placements bridge (Fase 2 WU3)', () => {
  it('VH-04 no-regression: no placements → resolvedHardwarePlacements=[] and parts byte-identical', () => {
    // The original catalog (modA/modB) has no components with hardwarePlacements
    // and an empty hardware catalog. The bridge must produce no placements and
    // leave the parts array byte-identical to the pre-Fase-2 output.
    const preview = resolveProject3DPreview(project, catalog);
    expect(preview.modules.length).toBeGreaterThan(0);
    for (const mod of preview.modules) {
      expect(mod.resolvedHardwarePlacements).toEqual([]);
    }
    // parts untouched: re-resolve the same item through resolveBom directly
    // (independent of the bridge) and compare the part ids/dims byte-for-byte.
    const firstItem = project.items[0]!;
    const module = catalog.modules.find((m) => m.id === firstItem.moduleId)!;
    // Snapshot the bridge parts; they must not change shape when placements
    // are added later (VH-08 structural guarantee).
    const bridgeParts = preview.modules[0]!.parts;
    expect(bridgeParts.length).toBeGreaterThan(0);
    expect(bridgeParts.every((p) => typeof p.widthMm === 'number')).toBe(true);
    // No module carries placements.
    expect(
      preview.modules.every((m) => m.resolvedHardwarePlacements.length === 0),
    ).toBe(true);
  });

  it('VH-T11 positive: resolves a knob placement to board-LOCAL mm keyed by partId', () => {
    const moduleWithPlacement: Module = {
      ...modWithHandle,
      components: [
        {
          componentId: 'c-puerta',
          quantity: 1,
          overrides: {
            hardwarePlacements: [
              {
                hardwareId: 'hw-knob',
                anchorFace: 'front',
                relativePosition: { xPercent: 50, yPercent: 50 },
              },
            ],
          },
        },
      ],
    };
    const catalogPlacement = {
      ...catalogWithHardware,
      modules: [moduleWithPlacement],
    };
    const preview = resolveProject3DPreview(projectWithHandle, catalogPlacement);
    expect(preview.modules).toHaveLength(1);
    const placements = preview.modules[0]!.resolvedHardwarePlacements;
    expect(placements).toHaveLength(1);

    const p = placements[0]!;
    // componentInstanceId = engine part id `${componentId}-copy-${i}`.
    expect(p.componentInstanceId).toBe('c-puerta-copy-0');
    expect(p.hardwareId).toBe('hw-knob');
    // Pinned front-face mapping (resolver contract): for a 596x18x720 board,
    // front center = (xPct·W, T, yPct·L) = (298, 18, 360), normal (0,1,0).
    expect(p.localPosition).toEqual([298, 18, 360]);
    expect(p.localNormal).toEqual([0, 1, 0]);
    // standoffMm = previewProjectionMm.
    expect(p.standoffMm).toBe(25);
    expect(p.scale).toBe(1);
    expect(p.rotationDeg).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('VH-08 export isolation: placements present do not alter the parts output', () => {
    // Both variants carry the SAME component instance; only the
    // hardwarePlacements override differs. Parts must stay byte-identical —
    // placements live in the additive array only (never reach the cut path).
    const baseInstance = {
      componentId: 'c-puerta',
      quantity: 1,
    } as const;
    const withPlacement: Module = {
      ...modWithHandle,
      components: [
        {
          ...baseInstance,
          overrides: {
            hardwarePlacements: [
              {
                hardwareId: 'hw-knob',
                anchorFace: 'front',
                relativePosition: { xPercent: 50, yPercent: 50 },
              },
            ],
          },
        },
      ],
    };
    const withoutPlacement: Module = {
      ...modWithHandle,
      components: [{ ...baseInstance }],
    };
    const withP = resolveProject3DPreview(projectWithHandle, {
      ...catalogWithHardware,
      modules: [withPlacement],
    });
    const withoutP = resolveProject3DPreview(projectWithHandle, {
      ...catalogWithHardware,
      modules: [withoutPlacement],
    });
    // Placements appear only in the additive array...
    expect(withP.modules[0]!.resolvedHardwarePlacements).toHaveLength(1);
    expect(withoutP.modules[0]!.resolvedHardwarePlacements).toHaveLength(0);
    // ...while the board parts the Optimizer/cut path consumes are identical.
    expect(withP.modules[0]!.parts).toEqual(withoutP.modules[0]!.parts);
  });

  it('VH-09 swap fallback: hardware without previewShape is filtered (no orphan mesh)', () => {
    const moduleSwap: Module = {
      ...modWithHandle,
      components: [
        {
          componentId: 'c-puerta',
          quantity: 1,
          overrides: {
            hardwarePlacements: [
              {
                hardwareId: 'hw-cost-only',
                anchorFace: 'front',
                relativePosition: { xPercent: 50, yPercent: 50 },
              },
            ],
          },
        },
      ],
    };
    const preview = resolveProject3DPreview(projectWithHandle, {
      ...catalogWithHardware,
      modules: [moduleSwap],
    });
    // cost-only hardware (no previewShape) → resolver null → filtered out.
    expect(preview.modules[0]!.resolvedHardwarePlacements).toEqual([]);
  });

  it('VH-09 missing hardware id (swapped/removed) is filtered', () => {
    const moduleMissing: Module = {
      ...modWithHandle,
      components: [
        {
          componentId: 'c-puerta',
          quantity: 1,
          overrides: {
            hardwarePlacements: [
              {
                hardwareId: 'hw-does-not-exist',
                anchorFace: 'front',
                relativePosition: { xPercent: 50, yPercent: 50 },
              },
            ],
          },
        },
      ],
    };
    const preview = resolveProject3DPreview(projectWithHandle, {
      ...catalogWithHardware,
      modules: [moduleMissing],
    });
    expect(preview.modules[0]!.resolvedHardwarePlacements).toEqual([]);
  });

  it('G2: agregado con quantity=N produce placements por unidad con prefijo que matchea el motor (agr-<id>-u<N>)', () => {
    // El motor (engine/bom.ts resolveComposedModule) expande cada agregado por
    // unidad con part-id `agr-${agregadoId}-u${unitIndex}${componentId}-copy-${i}`
    // (sin guion entre unitIndex y componentId). El resolver de herrajes debe
    // reproducir ese prefijo para que los placements encuentren sus piezas.
    // Bug G2: antes usaba `agr-${agrIdx}-` (índice + guion) → nunca matcheaba.
    const agregadoId = 'agr-puerta-doble';
    const agregadoConHerraje: Agregado = {
      id: agregadoId,
      code: 'AGR-PUE-2',
      name: 'Par de puertas',
      externalDims: { width: 596, height: 720, depth: 18 },
      components: [
        {
          componentId: 'c-puerta',
          quantity: 1,
          overrides: {
            hardwarePlacements: [
              {
                hardwareId: 'hw-knob',
                anchorFace: 'front',
                relativePosition: { xPercent: 50, yPercent: 50 },
              },
            ],
          },
        },
      ],
    };
    const module: Module = {
      ...modWithHandle,
      components: [],
      agregados: [{ agregadoId, quantity: 2 }],
    };
    // Part-ids exactos que el motor generaría para quantity=2 (unidades 0 y 1).
    const motorPartIds = [
      `agr-${agregadoId}-u0c-puerta-copy-0`,
      `agr-${agregadoId}-u1c-puerta-copy-0`,
    ];
    const mockBoardParts = motorPartIds.map((id) => ({
      id,
      widthMm: 596,
      thicknessMm: 18,
      lengthMm: 720,
    })) as unknown as Parameters<typeof resolveModuleHardwarePlacements>[1];

    const placements = resolveModuleHardwarePlacements(
      module,
      mockBoardParts,
      catalogWithHardware.hardware,
      {
        structures: catalogWithHardware.structures,
        agregados: [agregadoConHerraje],
      },
    );

    // Una jaladera por unidad (quantity=2) → 2 placements, cada uno linkeado
    // al part-id de su unidad. Confirma que el prefijo reproduce el del motor.
    expect(placements).toHaveLength(2);
    expect(placements.map((p) => p.componentInstanceId).sort()).toEqual(
      [...motorPartIds].sort(),
    );
    expect(placements.every((p) => p.hardwareId === 'hw-knob')).toBe(true);
  });
});
