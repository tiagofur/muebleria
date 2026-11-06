import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  attachVisualPins,
  createCatalogVisualAssetLookup,
  resolveAgregadoAssembly,
  type AgregadoRigidMember,
} from './agregadoAssembly';
import type { Hardware } from './types';

// #1518 F1 (was #1512): paridad TS↔Go del herraje multi-diseño (pieces con
// anclas left/right/center). Datos neutros en
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
    pieces: {
      anchor: 'left' | 'right' | 'center';
      assetId?: string;
      assetRevisionId?: string;
      sha256?: string;
      offsetMm?: { x: number; y: number; z: number };
    }[];
  }[];
  members: {
    memberId: string;
    role: string;
    hardwareId: string;
    hand: string;
    yRef: string;
    zRef: string;
    zOffsetMm?: number;
  }[];
  expected: {
    members: { memberId: string; hand: string; xCoordMm: number; zCoordMm: number; assetId: string }[];
  };
}

const FIXTURE_PATH = resolve(__dirname, '../../../contracts/fixtures/handsAssemblyParity.contract.json');
const f = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as HandsFixture;

const buildHardware = (): Hardware[] =>
  f.hardware.map((h) => ({
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
    pieces: h.pieces
      .filter((pc) => pc.assetId && pc.assetRevisionId)
      .map((pc) => ({
        anchor: pc.anchor,
        asset: {
          assetId: pc.assetId!,
          assetRevisionId: pc.assetRevisionId!,
          sha256: pc.sha256 ?? '0'.repeat(64),
        },
        ...(pc.offsetMm ? { offsetMm: pc.offsetMm } : {}),
      })),
  })) as unknown as Hardware[];

const buildAgregado = () =>
  ({
    id: 'agr-pieces',
    code: 'PIECES-SYNTH',
    rigidMembers: f.members.map(
      (m): AgregadoRigidMember => ({
        memberId: m.memberId,
        role: m.role,
        source: { kind: 'fixed', fixed: { hardwareId: m.hardwareId } },
        // ref X VACÍA a propósito: el default por ancla es lo bajo prueba.
        placement: {
          x: { offsetMm: 0 },
          y: { ref: m.yRef as 'min', offsetMm: 0 },
          z: { ref: m.zRef as 'min', offsetMm: m.zOffsetMm ?? 0 },
        },
        bomRole: 'separately_purchased',
        hand: m.hand as 'left' | 'right' | 'center',
      }),
    ),
  }) as never;

describe('handsAssemblyParity (#1518 pieces — asset y anclaje por pieza, lado TS)', () => {
  it('cada ancla resuelve su asset y su X default (left min, right max, center centro)', () => {
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
      expect(m!.localTransform.translationMm[2]).toBeCloseTo(exp.zCoordMm, 6);
      expect(m!.assetId).toBe(exp.assetId);
    }
  });
});
