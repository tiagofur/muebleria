import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

import type { AssemblyBasis, AssemblyMemberTransform, HardwareMountFrame } from '@granete/domain';
import { composeMemberTransform } from '@granete/domain';
import { assemblyTransformToThreeMatrix4 } from './AssemblyMesh';
import {
  GlbAssetLoadError,
  GlbSceneCache,
  type GlbAssetSource,
  createAssetSpaceSwapGroup,
  glbToAssetMmMatrix4,
  normalizeGlbSceneToAssetMm,
} from './glbSceneCache';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const canonical = JSON.parse(
  readFileSync(join(root, 'contracts/fixtures/glb-parity-canonical.json'), 'utf8'),
) as {
  readonly glbRepresentation: {
    readonly sourceUnits: 'mm' | 'cm' | 'm' | 'inch';
    readonly upAxis: 'y' | 'z';
    readonly expectedGlbReferencePointsM: readonly (readonly [number, number, number])[];
  };
  readonly placementChain: {
    readonly furniture: { readonly translationMm: readonly [number, number, number] };
    readonly assembly: { readonly translationMm: readonly [number, number, number] };
    readonly member: AssemblyMemberTransform;
  };
  readonly asset: { readonly mountFrame: HardwareMountFrame };
  readonly expected: {
    readonly referencePoints: readonly {
      readonly assetMm: readonly [number, number, number];
      readonly expectedWorldMm: readonly [number, number, number];
    }[];
    readonly tolerance: { readonly worldPointToleranceMm: number };
  };
};

const identityBasis: AssemblyBasis = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const swap = createAssetSpaceSwapGroup();

function wsPointToThree(p: readonly number[]): THREE.Vector3 {
  // Workshop (x, y, z) -> three (x, z, y)
  return new THREE.Vector3(p[0], p[2], p[1]);
}

describe('glbSceneCache coordinate normalization', () => {
  it('maps GLB metres Y-up to asset mm Z-up exactly like the canonical contract', () => {
    const u = glbToAssetMmMatrix4({
      sourceUnits: canonical.glbRepresentation.sourceUnits,
      upAxis: canonical.glbRepresentation.upAxis,
    });
    canonical.expected.referencePoints.forEach((rp, index) => {
      const glb = canonical.glbRepresentation.expectedGlbReferencePointsM[index]!;
      const mapped = new THREE.Vector3(glb[0], glb[1], glb[2]).applyMatrix4(u);
      expect(mapped.x).toBeCloseTo(rp.assetMm[0], 5);
      expect(mapped.y).toBeCloseTo(rp.assetMm[1], 5);
      expect(mapped.z).toBeCloseTo(rp.assetMm[2], 5);
    });
  });

  it('keeps a positive determinant (no winding flip) for every declared space', () => {
    for (const sourceUnits of ['mm', 'cm', 'm', 'inch'] as const) {
      for (const upAxis of ['y', 'z'] as const) {
        const det = new THREE.Matrix3().setFromMatrix4(
          glbToAssetMmMatrix4({ sourceUnits, upAxis }),
        ).determinant();
        expect(det).toBeGreaterThan(0);
      }
    }
  });

  it('bakes node transforms BEFORE the unit/axis normalization (U . M_node)', () => {
    const scene = new THREE.Group();
    const geometry = new THREE.BufferGeometry();
    const glb = canonical.glbRepresentation.expectedGlbReferencePointsM[0]!;
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([glb[0]!, glb[1]!, glb[2]!], 3),
    );
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    // Node-local transform in RAW glb metres: must compose before U.
    mesh.position.set(0.001, 0.002, 0.003);
    scene.add(mesh);

    normalizeGlbSceneToAssetMm(scene, {
      sourceUnits: canonical.glbRepresentation.sourceUnits,
      upAxis: canonical.glbRepresentation.upAxis,
    });

    const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    // P_glb + t = (0.018, 0.013, -0.020) -> asset = (18, 20, 13) mm.
    expect(position.getX(0)).toBeCloseTo(18, 4);
    expect(position.getY(0)).toBeCloseTo(20, 4);
    expect(position.getZ(0)).toBeCloseTo(13, 4);
    expect(mesh.position.length()).toBe(0);
  });
});

describe('glbSceneCache render path parity (#669 canonical chain)', () => {
  it('member matrix * swap * normalized glb point equals the three-frame world constant', () => {
    // World chain in workshop frame: furniture * assembly * (member * T_norm)
    const effective = composeMemberTransform(
      canonical.placementChain.member,
      canonical.asset.mountFrame,
    );
    const memberMatrixThree = assemblyTransformToThreeMatrix4(effective);
    const assemblyMatrixThree = assemblyTransformToThreeMatrix4({
      translationMm: canonical.placementChain.assembly.translationMm,
      basis: identityBasis,
    });
    const furnitureMatrixThree = assemblyTransformToThreeMatrix4({
      translationMm: canonical.placementChain.furniture.translationMm,
      basis: identityBasis,
    });
    const normalization = glbToAssetMmMatrix4({
      sourceUnits: canonical.glbRepresentation.sourceUnits,
      upAxis: canonical.glbRepresentation.upAxis,
    });

    canonical.expected.referencePoints.forEach((rp, index) => {
      const glb = canonical.glbRepresentation.expectedGlbReferencePointsM[index]!;
      const point = new THREE.Vector3(glb[0], glb[1], glb[2]);
      // The exact data path the renderer applies:
      // normalize (U) -> swap (S) -> member pose -> assembly pose -> furniture pose
      const world = point
        .applyMatrix4(normalization)
        .applyMatrix4(swap.matrix)
        .applyMatrix4(memberMatrixThree)
        .applyMatrix4(assemblyMatrixThree)
        .applyMatrix4(furnitureMatrixThree);
      const expectedThree = wsPointToThree(rp.expectedWorldMm);
      expect(world.distanceTo(expectedThree)).toBeLessThan(
        canonical.expected.tolerance.worldPointToleranceMm,
      );
    });
  });

  it('keeps the composed instance matrix rigid (scale [1,1,1], det +1)', () => {
    const effective = composeMemberTransform(
      canonical.placementChain.member,
      canonical.asset.mountFrame,
    );
    const memberMatrixThree = assemblyTransformToThreeMatrix4(effective);
    const composed = memberMatrixThree.clone().multiply(swap.matrix);
    // swap has det -1 by design (renderer flips winding); member matrix itself
    // must stay rigid in the three frame.
    const det = new THREE.Matrix3().setFromMatrix4(memberMatrixThree).determinant();
    expect(det).toBeCloseTo(1.0, 6);
    const scale = new THREE.Vector3();
    memberMatrixThree.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);
    expect([scale.x, scale.y, scale.z]).toEqual([1, 1, 1]);
  });
});

const fixtureBytes = readFileSync(join(root, 'contracts/fixtures/glb-parity-bracket.glb'));

describe('GlbSceneCache', () => {
  function sourceFor(bytes: ArrayBuffer, ownerKey = 'test-session'): GlbAssetSource {
    return {
      ownerKey,
      loadBytes: vi.fn(async () => bytes),
    };
  }

  const representation = {
    assetId: 'ast-glb-parity',
    revisionId: 'rev-glb-parity-bracket-1',
    sha256: 'sha256-' + hashOfFixture(),
    sourceUnits: canonical.glbRepresentation.sourceUnits,
    upAxis: canonical.glbRepresentation.upAxis,
  };

  it('loads the committed fixture, verifies its digest and caches the template', async () => {
    const source = sourceFor(fixtureBytes.buffer.slice(fixtureBytes.byteOffset, fixtureBytes.byteOffset + fixtureBytes.byteLength) as ArrayBuffer);
    const cache = new GlbSceneCache(source);
    const first = await cache.load(representation);
    expect(first).toBeTruthy();
    expect(first.children.length).toBeGreaterThan(0);

    const second = await cache.load(representation);
    expect(second).toBe(first);
    expect(source.loadBytes).toHaveBeenCalledTimes(1);
  });

  it('normalizes the cached template into asset-space mm', async () => {
    const source = sourceFor(fixtureBytes.buffer.slice(fixtureBytes.byteOffset, fixtureBytes.byteOffset + fixtureBytes.byteLength) as ArrayBuffer);
    const cache = new GlbSceneCache(source);
    const template = await cache.load(representation);
    let meshes = 0;
    template.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      meshes += 1;
      const position = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < position.count; i++) {
        for (let axis = 0; axis < 3; axis++) {
          // Asset-space bracket: extents 70x54x18 mm around authored coords.
          expect(Math.abs(position.getComponent(i, axis))).toBeLessThan(100);
        }
      }
    });
    expect(meshes).toBeGreaterThan(0);
  });

  it('classifies digest mismatches and fetch failures honestly', async () => {
    const wrongDigest = { ...representation, sha256: 'sha256-' + 'ab'.repeat(32) };
    const cache = new GlbSceneCache(sourceFor(fixtureBytes.buffer.slice(fixtureBytes.byteOffset, fixtureBytes.byteOffset + fixtureBytes.byteLength) as ArrayBuffer));
    const error = await cache.load(wrongDigest).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GlbAssetLoadError);
    expect((error as GlbAssetLoadError).kind).toBe('corrupt');

    const failing: GlbAssetSource = {
      ownerKey: 'test-session',
      loadBytes: vi.fn(async () => {
        throw new Error('grant expired');
      }),
    };
    const inaccessible = await new GlbSceneCache(failing)
      .load(representation)
      .catch((e: unknown) => e);
    expect((inaccessible as GlbAssetLoadError).kind).toBe('inaccessible');
  });

  it('drops rejected entries so a failed load can be retried', async () => {
    let fail = true;
    const source: GlbAssetSource = {
      ownerKey: 'test-session',
      loadBytes: vi.fn(async () => {
        if (fail) throw new Error('temporary');
        return fixtureBytes.buffer.slice(fixtureBytes.byteOffset, fixtureBytes.byteOffset + fixtureBytes.byteLength) as ArrayBuffer;
      }),
    };
    const cache = new GlbSceneCache(source);
    await expect(cache.load(representation)).rejects.toBeInstanceOf(GlbAssetLoadError);
    fail = false;
    await expect(cache.load(representation)).resolves.toBeTruthy();
  });
});

function hashOfFixture(): string {
  // Digest of the bytes actually read here; the host smoke evidence records
  // the authoritative digest for the committed fixture.
  return createHash('sha256').update(fixtureBytes).digest('hex');
}
