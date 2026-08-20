/**
 * Hardware machining profile validation + sanitization + demo seeds (F127).
 */

import { describe, expect, it } from 'vitest';
import { ValidationError } from './errors';
import {
  countMachiningOperations,
  normalizeMachiningProfile,
  validateMachiningProfile,
} from './hardwareMachining';
import { IDS, plantillaCatalog } from './__fixtures__/plantillaDemo';
import type { HardwareMachiningProfile } from './types';

function profile(
  overrides: Partial<HardwareMachiningProfile> = {},
): HardwareMachiningProfile {
  return {
    parts: [
      {
        id: 'dowel',
        role: 'dowel',
        operations: [
          {
            id: 'dowel-8',
            kind: 'blind_hole',
            diameterMm: 8,
            depthMm: 15,
            xMm: 0,
            yMm: 0,
            face: 'anchor',
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('validateMachiningProfile', () => {
  it('acepta un perfil mínimo de una parte con una operación', () => {
    expect(() => validateMachiningProfile(profile())).not.toThrow();
  });

  it('rechaza perfil sin partes', () => {
    expect(() => validateMachiningProfile({ parts: [] })).toThrow(ValidationError);
    expect(() => validateMachiningProfile({ parts: [] })).toThrow(
      /al menos una parte/,
    );
  });

  it('rechaza roles vacíos o duplicados', () => {
    expect(() =>
      validateMachiningProfile({
        parts: [
          { id: 'a', role: ' ', operations: profile().parts[0]!.operations },
        ],
      }),
    ).toThrow(/necesita un rol/);

    const op = { ...profile().parts[0]!.operations[0]!, id: 'op-2' };
    expect(() =>
      validateMachiningProfile({
        parts: [
          profile().parts[0]!,
          { id: 'b', role: 'dowel', operations: [op] },
        ],
      }),
    ).toThrow(/Rol duplicado/);
  });

  it('rechaza ids de operación duplicados dentro de una parte', () => {
    expect(() =>
      validateMachiningProfile({
        parts: [
          {
            id: 'cam',
            role: 'cam',
            operations: [
              { id: 'x', kind: 'blind_hole', diameterMm: 15, depthMm: 13, xMm: 0, yMm: 0, face: 'anchor' },
              { id: 'x', kind: 'blind_hole', diameterMm: 15, depthMm: 13, xMm: 32, yMm: 0, face: 'anchor' },
            ],
          },
        ],
      }),
    ).toThrow(/Operación duplicada/);
  });

  it('rechaza diámetro o profundidad no positivos en kinds ciegos', () => {
    const badDiameter = {
      id: 'x',
      kind: 'blind_hole',
      diameterMm: 0,
      depthMm: 13,
      xMm: 0,
      yMm: 0,
      face: 'anchor',
    } as const;
    expect(() =>
      validateMachiningProfile({
        parts: [{ id: 'p', role: 'cam', operations: [badDiameter] }],
      }),
    ).toThrow(/diámetro mayor a 0/);

    const badDepth = {
      id: 'x',
      kind: 'blind_hole',
      diameterMm: 15,
      xMm: 0,
      yMm: 0,
      face: 'anchor',
    } as const;
    expect(() =>
      validateMachiningProfile({
        parts: [{ id: 'p', role: 'cam', operations: [badDepth] }],
      }),
    ).toThrow(/profundidad mayor a 0/);
  });

  it('rechaza pasantes con profundidad definida', () => {
    expect(() =>
      validateMachiningProfile({
        parts: [
          {
            id: 'p',
            role: 'bolt',
            operations: [
              { id: 'x', kind: 'through_hole', diameterMm: 8, depthMm: 18, xMm: 0, yMm: 0, face: 'anchor' },
            ],
          },
        ],
      }),
    ).toThrow(/pasante/);
  });

  it('rechaza escareados sin Ø interior o con Ø interior ≥ exterior', () => {
    const base = { id: 'x', kind: 'counterbore', diameterMm: 10, depthMm: 5, xMm: 0, yMm: 0, face: 'anchor' } as const;
    expect(() =>
      validateMachiningProfile({ parts: [{ id: 'p', role: 'hinge', operations: [base] }] }),
    ).toThrow(/diámetro interior/);
    expect(() =>
      validateMachiningProfile({
        parts: [{ id: 'p', role: 'hinge', operations: [{ ...base, innerDiameterMm: 10 }] }],
      }),
    ).toThrow(/menor al exterior/);
  });

  it('rechaza cara de entrada inválida y offsets no finitos', () => {
    expect(() =>
      validateMachiningProfile({
        parts: [
          {
            id: 'p',
            role: 'plate',
            operations: [
              { id: 'x', kind: 'blind_hole', diameterMm: 5, depthMm: 10, xMm: 0, yMm: 0, face: 'side' as never },
            ],
          },
        ],
      }),
    ).toThrow(/cara de entrada/);

    expect(() =>
      validateMachiningProfile({
        parts: [
          {
            id: 'p',
            role: 'plate',
            operations: [
              { id: 'x', kind: 'blind_hole', diameterMm: 5, depthMm: 10, xMm: Number.NaN, yMm: 0, face: 'anchor' },
            ],
          },
        ],
      }),
    ).toThrow(/offsets X\/Y/);
  });

  it('el error de validación carga contexto de la parte', () => {
    try {
      validateMachiningProfile({
        parts: [
          {
            id: 'cam',
            role: 'cam',
            operations: [
              { id: 'op-1', kind: 'blind_hole', diameterMm: -3, depthMm: 13, xMm: 0, yMm: 0, face: 'anchor' },
            ],
          },
        ],
      });
      expect.unreachable('debió lanzar ValidationError');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).context).toMatchObject({ part: 'cam' });
    }
  });
});

describe('normalizeMachiningProfile', () => {
  it('devuelve undefined para datos ausentes o sin partes válidas', () => {
    expect(normalizeMachiningProfile(undefined)).toBeUndefined();
    expect(normalizeMachiningProfile(null)).toBeUndefined();
    expect(normalizeMachiningProfile('nope')).toBeUndefined();
    expect(normalizeMachiningProfile({})).toBeUndefined();
    expect(normalizeMachiningProfile({ parts: [] })).toBeUndefined();
  });

  it('dropea operaciones inválidas y conserva las sanas', () => {
    const result = normalizeMachiningProfile({
      parts: [
        {
          id: 'cup',
          role: 'cup',
          operations: [
            { id: 'ok', kind: 'blind_hole', diameterMm: 35, depthMm: 12.5, xMm: 0, yMm: 0, face: 'anchor' },
            { id: 'bad-kind', kind: 'laser', diameterMm: 35, depthMm: 12.5, xMm: 0, yMm: 0, face: 'anchor' },
            { id: 'bad-diameter', kind: 'blind_hole', diameterMm: 0, depthMm: 12.5, xMm: 0, yMm: 0, face: 'anchor' },
          ],
        },
      ],
    });
    expect(result?.parts).toHaveLength(1);
    expect(result?.parts[0]?.operations).toHaveLength(1);
    expect(result?.parts[0]?.operations[0]?.id).toBe('ok');
  });

  it('stripa profundidad de pasantes y Ø interior de no-escareados', () => {
    const result = normalizeMachiningProfile({
      parts: [
        {
          id: 'p',
          role: 'bolt',
          operations: [
            { id: 'x', kind: 'through_hole', diameterMm: 8, depthMm: 18, innerDiameterMm: 5, xMm: 1, yMm: 2, face: 'opposite' },
          ],
        },
      ],
    });
    expect(result?.parts[0]?.operations[0]?.depthMm).toBeUndefined();
    expect(result?.parts[0]?.operations[0]?.innerDiameterMm).toBeUndefined();
  });

  it('dropea roles duplicados y asigna ids fallback', () => {
    const result = normalizeMachiningProfile({
      parts: [
        { role: 'cam', operations: [{ kind: 'blind_hole', diameterMm: 15, depthMm: 13, xMm: 0, yMm: 0, face: 'anchor' }] },
        { role: 'cam', operations: [{ kind: 'blind_hole', diameterMm: 15, depthMm: 13, xMm: 0, yMm: 0, face: 'anchor' }] },
      ],
    });
    expect(result?.parts).toHaveLength(1);
    expect(result?.parts[0]?.id).toBe('part-1');
    expect(result?.parts[0]?.operations[0]?.id).toBe('op-1-1');
  });

  it('un perfil válido normaliza idéntico a sí mismo', () => {
    const valid = profile();
    expect(normalizeMachiningProfile(valid)).toEqual(valid);
  });
});

describe('countMachiningOperations', () => {
  it('suma las operaciones de todas las partes', () => {
    expect(countMachiningOperations(profile())).toBe(1);
    expect(countMachiningOperations(plantillaCatalog.hardware
      .find((h) => h.id === IDS.hwBisagra)!.machining!)).toBe(3);
  });
});

describe('seeds demo de maquinado (F127 golden)', () => {
  const byId = (id: string) => plantillaCatalog.hardware.find((h) => h.id === id)!;

  it('todos los perfiles del catálogo demo son válidos', () => {
    for (const hw of plantillaCatalog.hardware) {
      const machining = hw.machining;
      if (machining) {
        expect(() => validateMachiningProfile(machining), hw.code).not.toThrow();
      }
    }
  });

  it('bisagra: taza 35 × 12.5 + 2 fijaciones a 45 mm', () => {
    const hinge = byId(IDS.hwBisagra).machining!;
    expect(hinge.parts).toHaveLength(1);
    expect(hinge.parts[0]!.role).toBe('cup');
    const [cup, fix1, fix2] = hinge.parts[0]!.operations;
    expect(cup).toMatchObject({ kind: 'blind_hole', diameterMm: 35, depthMm: 12.5 });
    expect(fix1).toMatchObject({ kind: 'screw_pilot', diameterMm: 5 });
    expect(fix2).toMatchObject({ kind: 'screw_pilot', diameterMm: 5 });
    expect(Math.abs(fix2!.yMm - fix1!.yMm)).toBe(45);
  });

  it('placa base: dos perforaciones a 32 mm (sistema 32)', () => {
    const plate = byId(IDS.hwPlacaBis).machining!;
    const ops = plate.parts[0]!.operations;
    expect(ops).toHaveLength(2);
    expect(Math.abs(ops[1]!.yMm - ops[0]!.yMm)).toBe(32);
  });

  it('taquete: un ciego Ø8 × 15 por lado', () => {
    const dowel = byId(IDS.hwTaquete).machining!;
    expect(dowel.parts[0]!.operations[0]).toMatchObject({
      kind: 'blind_hole',
      diameterMm: 8,
      depthMm: 15,
    });
  });

  it('minifix: cazuela Ø15 × 13 y perno en partes separadas', () => {
    const minifix = byId(IDS.hwMinifix).machining!;
    expect(minifix.parts.map((p) => p.role)).toEqual(['cam', 'bolt']);
    expect(minifix.parts[0]!.operations[0]).toMatchObject({
      kind: 'blind_hole',
      diameterMm: 15,
      depthMm: 13,
    });
    expect(minifix.parts[1]!.operations[0]!.kind).toBe('screw_pilot');
  });

  it('tornillo 4x50: piloto Ø3', () => {
    const screw = byId(IDS.hwTornillo).machining!;
    expect(screw.parts[0]!.operations[0]).toMatchObject({
      kind: 'screw_pilot',
      diameterMm: 3,
    });
  });

  it('herrajes sin maquinado siguen siendo cost-only (sin campo)', () => {
    expect(byId(IDS.hwJaladera).machining).toBeUndefined();
    expect(byId(IDS.hwZocloPerfil).machining).toBeUndefined();
  });
});
