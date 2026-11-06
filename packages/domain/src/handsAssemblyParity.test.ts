import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  attachVisualPins,
  createCatalogVisualAssetLookup,
  resolveAgregadoAssembly,
  type AgregadoRigidMember,
} from './agregadoAssembly';
import type { Agregado, Hardware } from './types';

// #1512: paridad TS↔Go del herraje multi-diseño (hands). Datos neutros en
// contracts/fixtures/handsAssemblyParity.contract.json — cada lado construye
// sus objetos tipados (patrón accessoryKitParity). El espejo Go vive en
// backend-go/internal/domain/engine/hands_assembly_parity_test.go.

interface HandsFixture {
  assembly: { widthMm: number; depthMm: number; heightMm: number };
  hardware: {
    id: string;
    code: string;
    name: string;
    widthMm: number;
    heightMm: number;
    depthMm: number;
    globalAsset: { assetId: string; assetRevisionId: string; sha256: string };
    hands: {
      left?: { assetId: string; assetRevisionId: string; sha256: string };
      right?: { assetId: string; assetRevisionId: string; sha256: string };
    };
  }[];
  members: { memberId: string; role: string; hardwareId: string; hand: string; yRef: string; zRef: string }[];
  expected: {
    members: { memberId: string; hand: string; xCoordMm: number; assetId: string }[];
  };
}

const FIXTURE_PATH = resolve(__dirname, '../../../contracts/fixtures/handsAssemblyParity.contract.json');
const f = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as HandsFixture;

const buildHardware = (): Hardware[] =>
  f.hardware.map((h): Hardware => ({
    id: h.id,
    code: h.code,
    name: h.name,
    unit: 'piece',
    costPerUnit: 0,
    active: true,
    dimensions: { widthMm: h.widthMm, heightMm: h.heightMm, depthMm: h.depthMm },
    visualAsset: {
      assetId: h.globalAsset.assetId,
      assetRevisionId: h.globalAsset.assetRevisionId,
      sha256: h.globalAsset.sha256,
    },
    hands: {
      ...(h.hands.left
        ? { left: { asset: { assetId: h.hands.left.assetId, assetRevisionId: h.hands.left.assetRevisionId, sha256: h.hands.left.sha256 } } }
        : {}),
      ...(h.hands.right
        ? { right: { asset: { assetId: h.hands.right.assetId, assetRevisionId: h.hands.right.assetRevisionId, sha256: h.hands.right.sha256 } } }
        : {}),
    },
  }));

const buildAgregado = (): Agregado =>
  ({
    id: 'agr-hands',
    code: 'HANDS-SYNTH',
    rigidMembers: f.members.map(
      (m): AgregadoRigidMember => ({
        memberId: m.memberId,
        role: m.role,
        source: { kind: 'fixed', fixed: { hardwareId: m.hardwareId } },
        // ref X VACÍA a propósito: el default por mano es lo bajo prueba.
        placement: {
          x: { offsetMm: 0 },
          y: { ref: m.yRef as 'min', offsetMm: 0 },
          z: { ref: m.zRef as 'min', offsetMm: 0 },
        },
        bomRole: 'separately_purchased',
        hand: m.hand as 'left' | 'right',
      }),
    ),
  }) as unknown as Agregado;

describe('handsAssemblyParity (#1512 — asset por mano, lado TS del contrato)', () => {
  it('cada mano resuelve su asset y su anclaje X default (left min/+, right max/−)', () => {
    const resolved = resolveAgregadoAssembly(buildAgregado(), {
      widthMm: f.assembly.widthMm,
      depthMm: f.assembly.depthMm,
      heightMm: f.assembly.heightMm,
    });
    const pinned = attachVisualPins(resolved, createCatalogVisualAssetLookup(buildHardware()));

    expect(pinned.rigidMembers).toHaveLength(f.expected.members.length);
    for (const exp of f.expected.members) {
      const m = pinned.rigidMembers.find((r) => r.memberId === exp.memberId);
      expect(m, `miembro ${exp.memberId} presente`).toBeDefined();
      expect(m!.hand).toBe(exp.hand);
      expect(m!.localTransform.translationMm[0]).toBeCloseTo(exp.xCoordMm, 6);
      expect(m!.assetId).toBe(exp.assetId);
    }
  });
});
