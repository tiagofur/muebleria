import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  type AssemblyBasis,
  type AssemblyMemberTransform,
  type HardwareMountFrame,
  composeMemberTransform,
  deriveAssetNormalization,
} from './agregadoAssembly';
import {
  type GlbCoordinateSpace,
  applyAssemblyPlacement,
  collectGlbVertices,
  glbPointToAssetMm,
  multiplyAssemblyPlacements,
  nearestGlbVertex,
  parseGlbContainer,
  validateGlbSelfContainedPolicy,
} from './glbRepresentation';

// --- #669 Gate P0: SKP <-> GLB parity (canonical contract) ------------------
//
// Single numeric authority: contracts/fixtures/glb-parity-canonical.json.
// The committed GLB (contracts/fixtures/glb-parity-bracket.glb) carries the
// bytes produced by the SketchUp host smoke through GlbWriter; this suite
// reads those exact bytes, maps them back to asset mm through the declared
// unit/axis conversion (the ONLY GLB-boundary normalization) and pushes them
// through the production chain
//
//   world = T_furniture x T_assembly x T_member x inverse(T_mountFrame) x P
//
// The expected world points are hand-derived constants in the canonical file
// (independent arithmetic, also equal to the #668 host-measured evidence), so
// this suite fails loudly under any drift between SketchUp and the web path.

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const canonicalPath = join(root, 'contracts/fixtures/glb-parity-canonical.json');
const glbPath = join(root, 'contracts/fixtures/glb-parity-bracket.glb');

interface CanonicalFixture {
  readonly asset: {
    readonly nominalExtentsMm: readonly [number, number, number];
    readonly referencePointsAssetMm: readonly (readonly [number, number, number])[];
    readonly mountFrame: HardwareMountFrame;
  };
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
  readonly expected: {
    readonly assetNormalization: {
      readonly translationMm: readonly [number, number, number];
      readonly basis: AssemblyBasis;
    };
    readonly effectiveMemberTransform: AssemblyMemberTransform;
    readonly referencePoints: readonly {
      readonly assetMm: readonly [number, number, number];
      readonly expectedWorldMm: readonly [number, number, number];
    }[];
    readonly pairwiseDistancesMm: Readonly<Record<string, number>>;
    readonly rigidity: { readonly scale: readonly number[]; readonly determinant: number };
    readonly tolerance: {
      readonly worldPointToleranceMm: number;
      readonly glbVertexMatchToleranceM: number;
      readonly mutantMinErrorMm: number;
    };
  };
}

const canonical = JSON.parse(readFileSync(canonicalPath, 'utf8')) as CanonicalFixture;
const glbBytes = new Uint8Array(readFileSync(glbPath));
const glbSpace: GlbCoordinateSpace = {
  sourceUnits: canonical.glbRepresentation.sourceUnits,
  upAxis: canonical.glbRepresentation.upAxis,
};
const identityBasis: AssemblyBasis = {
  x: [1, 0, 0],
  y: [0, 1, 0],
  z: [0, 0, 1],
};
const tolerance = canonical.expected.tolerance;

function worldChain(): ReturnType<typeof multiplyAssemblyPlacements> {
  const effective = composeMemberTransform(
    canonical.placementChain.member,
    canonical.asset.mountFrame,
  );
  const assemblyPlacement = multiplyAssemblyPlacements(
    {
      translationMm: canonical.placementChain.assembly.translationMm,
      basis: identityBasis,
    },
    effective,
  );
  return multiplyAssemblyPlacements(
    {
      translationMm: canonical.placementChain.furniture.translationMm,
      basis: identityBasis,
    },
    assemblyPlacement,
  );
}

function glbVertexWorldPoints(): readonly (readonly [number, number, number])[] {
  const parsed = parseGlbContainer(glbBytes);
  const issues = validateGlbSelfContainedPolicy(parsed);
  expect(issues).toEqual([]);
  const vertices = collectGlbVertices(parsed);
  return canonical.glbRepresentation.expectedGlbReferencePointsM.map((expectedGlb) => {
    const vertex = nearestGlbVertex(vertices, expectedGlb);
    const distance = Math.hypot(
      vertex[0] - expectedGlb[0],
      vertex[1] - expectedGlb[1],
      vertex[2] - expectedGlb[2],
    );
    expect(distance).toBeLessThan(tolerance.glbVertexMatchToleranceM);
    return glbPointToAssetMm(glbSpace, vertex);
  });
}

describe('#669 canonical SKP/GLB parity', () => {
  it('committed GLB is a self-contained container matching the canonical contract', () => {
    const parsed = parseGlbContainer(glbBytes);
    expect(validateGlbSelfContainedPolicy(parsed)).toEqual([]);
    expect(parsed.json.asset?.version).toBe('2.0');
    expect(parsed.json.buffers?.[0]?.uri ?? '').toBe('');
    expect((parsed.json.meshes ?? []).length).toBeGreaterThan(0);
  });

  it('derived asset normalization equals the hand-derived contract constants', () => {
    const norm = deriveAssetNormalization(canonical.asset.mountFrame);
    expect([...norm.translationMm]).toEqual([...canonical.expected.assetNormalization.translationMm]);
    expect([...norm.basis.x]).toEqual([...canonical.expected.assetNormalization.basis.x]);
    expect([...norm.basis.y]).toEqual([...canonical.expected.assetNormalization.basis.y]);
    expect([...norm.basis.z]).toEqual([...canonical.expected.assetNormalization.basis.z]);
  });

  it('effective member transform (T_member x inverse(T_mountFrame)) matches the contract', () => {
    const effective = composeMemberTransform(
      canonical.placementChain.member,
      canonical.asset.mountFrame,
    );
    const expectedEffective = canonical.expected.effectiveMemberTransform;
    expect([...effective.translationMm]).toEqual([...expectedEffective.translationMm]);
    expect([...effective.basis.x]).toEqual([...expectedEffective.basis.x]);
    expect([...effective.basis.y]).toEqual([...expectedEffective.basis.y]);
    expect([...effective.basis.z]).toEqual([...expectedEffective.basis.z]);
  });

  it('reference points read from the committed GLB land on the hand-derived world constants', () => {
    const world = worldChain();
    const assetPoints = glbVertexWorldPoints();
    expect(assetPoints.length).toBe(canonical.expected.referencePoints.length);

    canonical.expected.referencePoints.forEach((expected, index) => {
      const worldPoint = applyAssemblyPlacement(world, assetPoints[index]!);
      const delta = Math.hypot(
        worldPoint[0] - expected.expectedWorldMm[0],
        worldPoint[1] - expected.expectedWorldMm[1],
        worldPoint[2] - expected.expectedWorldMm[2],
      );
      expect(delta).toBeLessThan(tolerance.worldPointToleranceMm);
    });
  });

  it('dimensions and pairwise distances are preserved through the whole chain', () => {
    const parsed = parseGlbContainer(glbBytes);
    const vertices = collectGlbVertices(parsed);
    const assetVertices = [] as [number, number, number][];
    for (let i = 0; i + 2 < vertices.length; i += 3) {
      assetVertices.push([
        vertices[i],
        vertices[i + 1],
        vertices[i + 2],
      ] as [number, number, number]);
    }
    const extents = ([0, 1, 2] as const).map((axis) => {
      const values = assetVertices.map((v) => glbPointToAssetMm(glbSpace, v)[axis]);
      return Math.max(...values) - Math.min(...values);
    });
    canonical.asset.nominalExtentsMm.forEach((nominal, axis) => {
      expect(Math.abs(extents[axis]! - nominal)).toBeLessThan(tolerance.worldPointToleranceMm);
    });

    const world = worldChain();
    const assetPoints = glbVertexWorldPoints();
    const worldPoints = assetPoints.map((p) => applyAssemblyPlacement(world, p));
    const distance = (a: readonly number[], b: readonly number[]) =>
      Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
    const distances = canonical.expected.pairwiseDistancesMm;
    const [d01, d12, d02] = [distances['p0p1'], distances['p1p2'], distances['p0p2']];
    expect(d01, 'canonical pairwise p0p1').toBeDefined();
    expect(d12, 'canonical pairwise p1p2').toBeDefined();
    expect(d02, 'canonical pairwise p0p2').toBeDefined();
    expect(distance(worldPoints[0]!, worldPoints[1]!)).toBeCloseTo(d01!, 3);
    expect(distance(worldPoints[1]!, worldPoints[2]!)).toBeCloseTo(d12!, 3);
    expect(distance(worldPoints[0]!, worldPoints[2]!)).toBeCloseTo(d02!, 3);
  });

  it('world chain stays rigid: scale [1,1,1], determinant +1, no shear, no mirror', () => {
    const world = worldChain();
    const det =
      world.basis.x[0] * (world.basis.y[1] * world.basis.z[2] - world.basis.y[2] * world.basis.z[1]) -
      world.basis.x[1]! * (world.basis.y[0]! * world.basis.z[2]! - world.basis.y[2]! * world.basis.z[0]!) +
      world.basis.x[2]! * (world.basis.y[0]! * world.basis.z[1]! - world.basis.y[1]! * world.basis.z[0]!);
    expect(det).toBeCloseTo(canonical.expected.rigidity.determinant, 6);
    const dot = (a: readonly number[], b: readonly number[]) =>
      a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
    expect(dot(world.basis.x, world.basis.y)).toBeCloseTo(0, 6);
    expect(dot(world.basis.x, world.basis.z)).toBeCloseTo(0, 6);
    expect(dot(world.basis.y, world.basis.z)).toBeCloseTo(0, 6);
    expect(Math.hypot(...world.basis.x)).toBeCloseTo(1, 6);
    expect(Math.hypot(...world.basis.y)).toBeCloseTo(1, 6);
    expect(Math.hypot(...world.basis.z)).toBeCloseTo(1, 6);
  });

  it('unit and normalization defects are detectable (mutant sensitivity)', () => {
    const expectedWorlds = canonical.expected.referencePoints.map((rp) => rp.expectedWorldMm);
    const assetPoints = glbVertexWorldPoints();
    const member = canonical.placementChain.member;
    const mountFrame = canonical.asset.mountFrame;

    const wrapWithFurnitureAssembly = (memberTransform: AssemblyMemberTransform) =>
      multiplyAssemblyPlacements(
        {
          translationMm: canonical.placementChain.furniture.translationMm,
          basis: identityBasis,
        },
        multiplyAssemblyPlacements(
          {
            translationMm: canonical.placementChain.assembly.translationMm,
            basis: identityBasis,
          },
          memberTransform,
        ),
      );

    const wrongUnitAssetPoints = (scale: number) =>
      canonical.glbRepresentation.expectedGlbReferencePointsM.map(
        (p) => glbPointToAssetMm(glbSpace, [p[0]! * scale, p[1]! * scale, p[2]! * scale]) as [number, number, number],
      );

    // Chain variants: each mutant mutates exactly one link of the composition.
    const normalizationWithBasis = (point: readonly number[], basis: AssemblyBasis) => {
      const origin = mountFrame.originMm;
      const delta = [point[0]! - origin[0], point[1]! - origin[1], point[2]! - origin[2]];
      const dotAxes = (a: readonly number[], b: readonly number[]) =>
        a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
      return [dotAxes(basis.x, delta), dotAxes(basis.y, delta), dotAxes(basis.z, delta)];
    };
    const transposedMountBasis: AssemblyBasis = {
      x: [mountFrame.basis.x[0], mountFrame.basis.y[0], mountFrame.basis.z[0]],
      y: [mountFrame.basis.x[1], mountFrame.basis.y[1], mountFrame.basis.z[1]],
      z: [mountFrame.basis.x[2], mountFrame.basis.y[2], mountFrame.basis.z[2]],
    };

    const mutants: Readonly<Record<string, { chain: ReturnType<typeof worldChain>; points: readonly (readonly [number, number, number])[] }>> = {
      unit_x25_4: { chain: worldChain(), points: wrongUnitAssetPoints(25.4) },
      unit_div25_4: { chain: worldChain(), points: wrongUnitAssetPoints(1 / 25.4) },
      unit_x1000: { chain: worldChain(), points: wrongUnitAssetPoints(1000) },
      unit_div1000: { chain: worldChain(), points: wrongUnitAssetPoints(0.001) },
      omitted: { chain: wrapWithFurnitureAssembly(member), points: assetPoints },
      double: {
        chain: wrapWithFurnitureAssembly(composeMemberTransform(composeMemberTransform(member, mountFrame), mountFrame)),
        points: assetPoints,
      },
      transposed: {
        chain: wrapWithFurnitureAssembly(member),
        points: assetPoints.map(
          (p) => normalizationWithBasis(p, transposedMountBasis) as [number, number, number],
        ),
      },
    };

    for (const [mode, { chain, points }] of Object.entries(mutants)) {
      const minError = Math.min(
        ...points.map((p, index) => {
          const expected = expectedWorlds[index]!;
          const worldPoint = applyAssemblyPlacement(chain, p);
          return Math.hypot(
            worldPoint[0]! - expected[0],
            worldPoint[1]! - expected[1],
            worldPoint[2]! - expected[2],
          );
        }),
      );
      expect(minError, `mutant ${mode} must be detectable`).toBeGreaterThan(
        tolerance.mutantMinErrorMm,
      );
    }
  });
});
