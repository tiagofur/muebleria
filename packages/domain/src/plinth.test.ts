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
});
