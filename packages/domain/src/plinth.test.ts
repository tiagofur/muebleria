import { describe, expect, it } from 'vitest';
import {
  applyBaseModeToHardwareLines,
  filterComponentInstancesForBaseMode,
  plinthStripMeters,
  resolveBoardOptionChoiceId,
  resolveModuleBaseClearanceMm,
  resolveModuleBaseMode,
  ZOCLO_BOARD_ROLE,
  ZOCLO_STRIP_ROLE,
  PATAS_ROLE,
} from './plinth';
import type { Component, HardwareLine, ModuleComponentInstance } from './types';

describe('plinth', () => {
  it('resolves base mode and clearance', () => {
    expect(resolveModuleBaseMode({})).toBe('none');
    expect(
      resolveModuleBaseMode({ baseMode: 'plinth_board' }),
    ).toBe('plinth_board');
    expect(resolveModuleBaseClearanceMm({ baseMode: 'none' })).toBe(0);
    expect(
      resolveModuleBaseClearanceMm({ baseMode: 'plinth_board' }),
    ).toBe(100);
    expect(
      resolveModuleBaseClearanceMm(
        { baseMode: 'plinth_board', baseClearanceMm: 120 },
        80,
      ),
    ).toBe(80);
  });

  it('inherits FRENTE for ZOCLO, PUERTA and FRENTE_CAJON board material choice', () => {
    expect(
      resolveBoardOptionChoiceId(ZOCLO_BOARD_ROLE, {
        FRENTE: 'mat-front',
      }),
    ).toBe('mat-front');
    expect(
      resolveBoardOptionChoiceId(ZOCLO_BOARD_ROLE, {
        ZOCLO: 'mat-zoclo',
        FRENTE: 'mat-front',
      }),
    ).toBe('mat-zoclo');
    expect(
      resolveBoardOptionChoiceId('PUERTA', {
        FRENTE: 'mat-front',
      }),
    ).toBe('mat-front');
    expect(
      resolveBoardOptionChoiceId('FRENTE_CAJON', {
        FRENTE: 'mat-front',
      }),
    ).toBe('mat-front');
    expect(
      resolveBoardOptionChoiceId('PUERTA', {
        PUERTA: 'mat-door',
        FRENTE: 'mat-front',
      }),
    ).toBe('mat-door');
    expect(resolveBoardOptionChoiceId('INTERIOR', {})).toBeUndefined();
  });

  it('computes strip meters from width', () => {
    expect(plinthStripMeters(600)).toBe(0.6);
    expect(plinthStripMeters(1200, 1)).toBe(1.2);
    expect(plinthStripMeters(1000, 2)).toBe(2);
  });

  it('filters zoclo board components by mode', () => {
    const components: Component[] = [
      {
        id: 'c-zoclo',
        code: 'ZOC-F',
        name: 'Zoclo frontal',
        placement: 'custom',
        geometry: {
          kind: 'rectangular_board',
          lengthMm: 600,
          widthMm: 100,
          thicknessMm: 18,
        },
        defaultEdges: [],
        optionRoles: [ZOCLO_BOARD_ROLE],
        active: true,
      },
      {
        id: 'c-side',
        code: 'LAT',
        name: 'Lateral',
        placement: 'custom',
        geometry: {
          kind: 'rectangular_board',
          lengthMm: 560,
          widthMm: 720,
          thicknessMm: 18,
        },
        defaultEdges: [
          { side: 'L1', enabled: false },
          { side: 'L2', enabled: false },
          { side: 'W1', enabled: false },
          { side: 'W2', enabled: false },
        ],
        optionRoles: ['INTERIOR'],
        active: true,
      },
    ];
    const instances: ModuleComponentInstance[] = [
      { componentId: 'c-zoclo', quantity: 1 },
      { componentId: 'c-side', quantity: 2 },
    ];
    expect(
      filterComponentInstancesForBaseMode(instances, components, 'none'),
    ).toHaveLength(1);
    expect(
      filterComponentInstancesForBaseMode(
        instances,
        components,
        'plinth_board',
      ),
    ).toHaveLength(2);
  });

  it('rewrites strip and legs hardware quantities', () => {
    const lines: HardwareLine[] = [
      {
        id: 'h1',
        quantity: 1,
        optionRole: ZOCLO_STRIP_ROLE,
        hardwareId: 'hw-strip',
      },
      {
        id: 'h2',
        quantity: 0,
        optionRole: PATAS_ROLE,
        hardwareId: 'hw-leg',
      },
      {
        id: 'h3',
        quantity: 2,
        optionRole: 'BISAGRA',
        hardwareId: 'hw-hinge',
      },
    ];
    const strip = applyBaseModeToHardwareLines(lines, 'plinth_strip', 800);
    expect(strip).toHaveLength(2); // strip + hinge
    expect(strip.find((l) => l.optionRole === ZOCLO_STRIP_ROLE)!.quantity).toBe(
      0.8,
    );
    expect(strip.find((l) => l.optionRole === 'BISAGRA')).toBeTruthy();

    const legs = applyBaseModeToHardwareLines(lines, 'legs', 900);
    expect(legs.find((l) => l.optionRole === PATAS_ROLE)!.quantity).toBe(5); // 4 + 1 extra
    expect(legs.find((l) => l.optionRole === ZOCLO_STRIP_ROLE)).toBeUndefined();
  });

  it('determines exposed plinth sides based on layout neighbors (F088)', async () => {
    const { plinthSidesForPlacement, plinthReturnDepthMm } = await import('./plinth');

    // Return depth calculation
    expect(plinthReturnDepthMm(580)).toBe(530);

    const layout = {
      walls: [
        {
          id: 'w1',
          name: 'Muro Principal',
          lengthMm: 3000,
          thicknessMm: 150,
          heightMm: 2400,
          angleDeg: 0,
        },
      ],
      placements: [
        { itemId: 'i1', wallId: 'w1', offsetMm: 200, instanceIndex: 0, elevation: 'floor' as const },
        { itemId: 'i2', wallId: 'w1', offsetMm: 800, instanceIndex: 0, elevation: 'floor' as const },
        { itemId: 'island', wallId: '', mode: 'free' as const, offsetMm: 0, instanceIndex: 0, elevation: 'floor' as const, freeXMm: 1000, freeYMm: 1000, freeYawDeg: 0 },
      ],


    };


    const widthOf = (id: string) => (id === 'i1' || id === 'i2' ? 600 : 1200);

    // Island: all 3 sides exposed
    const islandSides = plinthSidesForPlacement(layout, layout.placements[2]!, widthOf);
    expect(islandSides).toEqual({ left: true, right: true, back: true });

    // Item 1 (offset 200..800): left is exposed (200mm to wall end), right is covered by item 2 (starts at 800)
    const i1Sides = plinthSidesForPlacement(layout, layout.placements[0]!, widthOf);
    expect(i1Sides.left).toBe(true);
    expect(i1Sides.right).toBe(false);
    expect(i1Sides.back).toBe(false);

    // Item 2 (offset 800..1400): left is covered by item 1, right is exposed (1400 < 3000)
    const i2Sides = plinthSidesForPlacement(layout, layout.placements[1]!, widthOf);
    expect(i2Sides.left).toBe(false);
    expect(i2Sides.right).toBe(true);
    expect(i2Sides.back).toBe(false);
  });

  it('synthesizes side returns for plinth_board and strip when sides are exposed (F088)', async () => {
    const { applyBaseTreatment, SYNTHETIC_ZOCLO_PART_CODE, SYNTHETIC_ZOCLO_SIDE_CODE } = await import('./plinth');

    const result = applyBaseTreatment(
      'MOD-01',
      [],
      [],
      'plinth_board',
      100, // height B
      600, // width W
      580, // depth D
      { left: true, right: false, back: false },
    );

    expect(result.parts).toHaveLength(2); // 1 front + 1 left side return
    expect(result.parts[0]!.code).toBe(SYNTHETIC_ZOCLO_PART_CODE);
    expect(result.parts[0]!.lengthMm).toBe(600);
    expect(result.parts[0]!.widthMm).toBe(100);

    expect(result.parts[1]!.code).toBe(SYNTHETIC_ZOCLO_SIDE_CODE);
    expect(result.parts[1]!.lengthMm).toBe(530); // 580 - 50 recess
    expect(result.parts[1]!.widthMm).toBe(100);
  });
});

