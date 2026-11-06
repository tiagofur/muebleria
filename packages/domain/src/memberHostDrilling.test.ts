/**
 * #1554 — unit tests of the right-hand mirror in the member-host projection
 * (TS twin of Go TestMirrorMachiningProfileForRightHand_1512 and the
 * deriveMemberHostMachining integration): hole CENTER x' = HW − x, round-hole
 * whitelist, fail-closed on non-hole kinds — the CNC (Go) and the web preview
 * must drill the same pattern for a hand-right member consuming a single
 * LEFT-canonical catalog profile.
 */
import { describe, expect, it } from 'vitest';

import type { ResolvedModuleAssembly } from './agregadoAssembly';
import {
  mirrorMachiningProfileForRightHand,
  projectMemberHostDrilling,
} from './memberHostDrilling';
import type { Hardware, HardwareMachiningProfile, ResolvedBoardPart } from './types';

const canonicalProfile: HardwareMachiningProfile = {
  parts: [
    {
      id: 'pilot',
      role: 'screw',
      operations: [
        { id: 'pilot-a', kind: 'screw_pilot', diameterMm: 3.2, depthMm: 12, xMm: 20, yMm: 33.5, face: 'anchor' },
        { id: 'pilot-b', kind: 'screw_pilot', diameterMm: 3.2, depthMm: 12, xMm: 55, yMm: 33.5, face: 'anchor' },
      ],
    },
  ],
};

const canonicalHardware: Hardware = {
  id: 'hw-canonical',
  code: 'RAIL-CANON',
  name: 'Guía canónica única',
  unit: 'piece',
  costPerUnit: 0,
  active: true,
  dimensions: { widthMm: 91, heightMm: 0, depthMm: 0 },
  machining: canonicalProfile,
};

const identityBasis = {
  x: [1, 0, 0] as const,
  y: [0, 1, 0] as const,
  z: [0, 0, 1] as const,
};

function assemblyWithHand(hand: 'left' | 'right' | 'center' | undefined): ResolvedModuleAssembly {
  return {
    assemblyInstanceId: 'inst-1',
    agregadoId: 'agr-1',
    placement: { originMm: [0, 0, 0] },
    isHistorical: false,
    resolvedAssembly: {
      agregadoId: 'agr-1',
      // TS order [width, depth, height]: depth 500 → frontPlaneY = 500.
      resolvedDimensionsMm: [400, 500, 720],
      selectedVariants: [],
      rigidMembers: [
        {
          memberId: 'hand_rail',
          role: 'fixed_rail',
          hardwareId: canonicalHardware.id,
          localTransform: { translationMm: [0, 0, 0], basis: identityBasis },
          bomRole: 'non_purchasing',
          hostPlacement: 'lateral_izquierdo',
          ...(hand ? { hand } : {}),
        },
      ],
      fabricatedComponents: [],
      bomItems: [],
    },
  };
}

const lateralHost: ResolvedBoardPart = {
  id: 'side-1',
  description: 'Lateral izquierdo',
  quantity: 1,
  widthMm: 500,
  thicknessMm: 18,
  lengthMm: 720,
  grain: 0,
  edges: [],
  optionRole: 'LATERAL',
  materialId: 'mat-test',
  x: 0,
  y: 0,
  z: 0,
  componentPlacement: 'lateral_izquierdo',
};

describe('mirrorMachiningProfileForRightHand (#1512 M3, #1554)', () => {
  it('espeja el CENTRO del agujero con x\' = HW − x y preserva lo demás', () => {
    const mirrored = mirrorMachiningProfileForRightHand(canonicalProfile, 91);
    expect(mirrored).not.toBeNull();
    const ops = mirrored!.parts[0]!.operations;
    expect(ops.map((o) => o.xMm)).toEqual([71, 36]); // 91−20, 91−55
    expect(ops[0]!.diameterMm).toBe(3.2);
    expect(ops[0]!.depthMm).toBe(12);
    expect(ops[0]!.yMm).toBe(33.5);
    expect(ops[0]!.id).toBe('pilot-a');
  });

  it('un agujero centro-simétrico mapea a sí mismo', () => {
    const profile: HardwareMachiningProfile = {
      parts: [
        {
          id: 'p',
          role: 'cup',
          operations: [
            { id: 'cup', kind: 'blind_hole', diameterMm: 35, depthMm: 12.5, xMm: 45.5, yMm: 9, face: 'anchor' },
          ],
        },
      ],
    };
    const mirrored = mirrorMachiningProfileForRightHand(profile, 91);
    expect(mirrored!.parts[0]!.operations[0]!.xMm).toBe(45.5);
  });

  it('fail-closed: una operación no-taladro (counterbore) NO se espeja', () => {
    const profile: HardwareMachiningProfile = {
      parts: [
        {
          id: 'p',
          role: 'cup',
          operations: [
            { id: 'cup', kind: 'blind_hole', diameterMm: 35, xMm: 45.5, yMm: 9, face: 'anchor' },
            { id: 'bore', kind: 'counterbore', diameterMm: 5, xMm: 45.5, yMm: 9, face: 'anchor' },
          ],
        },
      ],
    };
    expect(mirrorMachiningProfileForRightHand(profile, 91)).toBeNull();
  });
});

describe('proyección member-host con hand right (#1554 — el gap CNC vs preview)', () => {
  it('miembro right + herraje canónico único: la proyección TS ESPEJA el patrón (igual que el CNC Go)', () => {
    const result = projectMemberHostDrilling({
      assemblies: [assemblyWithHand('right')],
      parts: [lateralHost],
      hardwareCatalog: [canonicalHardware],
    });
    expect(result.issues).toEqual([]);
    const holes = result.holesByPartId.get('side-1') ?? [];
    expect(holes).toHaveLength(2);
    // Espejado: x' = 91−20 = 71 y 91−55 = 36; en el marco board-local de la
    // lateral el eje corre inverso → 429/464 (mismo math que el golden del
    // fixture compartido para hand_rail_canonical).
    const xs = holes.map((h) => h.xMm).sort((a, b) => a - b);
    expect(xs).toEqual([36, 71]);
    const ys = holes.map((h) => h.yMm).sort((a, b) => a - b);
    expect(ys).toEqual([429, 464]);
    expect(holes.every((h) => h.face === 'back' && h.diameterMm === 3.2 && h.depthMm === 12)).toBe(true);
  });

  it('SIN hand el mismo herraje NO se espeja (control del gap): el patrón cae distinto', () => {
    const result = projectMemberHostDrilling({
      assemblies: [assemblyWithHand(undefined)],
      parts: [lateralHost],
      hardwareCatalog: [canonicalHardware],
    });
    expect(result.issues).toEqual([]);
    const holes = result.holesByPartId.get('side-1') ?? [];
    const xs = holes.map((h) => h.xMm).sort((a, b) => a - b);
    expect(xs).toEqual([20, 55]);
    const ys = holes.map((h) => h.yMm).sort((a, b) => a - b);
    expect(ys).toEqual([445, 480]);
  });

  it('fail-closed: hand right con counterbore en el perfil → issue exacto y CERO agujeros', () => {
    const withCounterbore: Hardware = {
      ...canonicalHardware,
      machining: {
        parts: [
          {
            id: 'p',
            role: 'cup',
            operations: [
              { id: 'cup', kind: 'blind_hole', diameterMm: 35, depthMm: 12, xMm: 45.5, yMm: 9, face: 'anchor' },
              { id: 'bore', kind: 'counterbore', diameterMm: 5, depthMm: 4, xMm: 45.5, yMm: 9, face: 'anchor' },
            ],
          },
        ],
      },
    };
    const result = projectMemberHostDrilling({
      assemblies: [assemblyWithHand('right')],
      parts: [lateralHost],
      hardwareCatalog: [withCounterbore],
    });
    expect(result.holesByPartId.size).toBe(0);
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain('MEMBER_HOST_HAND_MIRROR_UNSUPPORTED_KIND');
  });
});
