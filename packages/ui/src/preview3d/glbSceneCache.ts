import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  type GlbCoordinateSpace,
  GLB_SOURCE_UNITS_TO_MM,
  parseGlbContainer,
  validateGlbSelfContainedPolicy,
} from '@granete/domain';

/**
 * GLB asset loading for web consumers (#669).
 *
 * The cache is keyed by the EXACT revision digest and normalizes the parsed
 * scene ONCE into asset-space millimetres (+Z up, the space the MountFrame
 * refers to). This is the single unit/axis conversion of the GLB boundary —
 * the rigid placement chain (T_member x inverse(T_mountFrame) etc.) applies
 * unchanged afterwards, exactly like SketchUp. Double or omitted conversion
 * is detectable by the #669 parity suites.
 *
 * Instance scenes are clones sharing geometry/materials; nothing mutates the
 * cached template after normalization.
 */

export type GlbLoadFailureKind = 'corrupt' | 'inaccessible' | 'unsupported';

export class GlbAssetLoadError extends Error {
  readonly kind: GlbLoadFailureKind;
  readonly revisionId: string;
  readonly sha256: string;

  constructor(kind: GlbLoadFailureKind, revisionId: string, sha256: string, detail: string) {
    super(`GLB ${kind} (revision ${revisionId}): ${detail}`);
    this.name = 'GlbAssetLoadError';
    this.kind = kind;
    this.revisionId = revisionId;
    this.sha256 = sha256;
  }
}

/** Session-scoped byte source for exact GLB revisions. */
export interface GlbAssetSource {
  readonly ownerKey: string;
  loadBytes(assetId: string, revisionId: string, sha256: string): Promise<ArrayBuffer>;
}

export interface GlbRepresentationRef {
  readonly assetId?: string;
  readonly revisionId: string;
  readonly sha256: string;
  readonly sourceUnits: GlbCoordinateSpace['sourceUnits'];
  readonly upAxis: GlbCoordinateSpace['upAxis'];
}

/** Normalization matrix glb -> asset mm (+Z up): asset = U . glb. det = +s^3. */
export function glbToAssetMmMatrix4(space: GlbCoordinateSpace): THREE.Matrix4 {
  const s = GLB_SOURCE_UNITS_TO_MM[space.sourceUnits];
  const m = new THREE.Matrix4();
  if (space.upAxis === 'z') {
    m.makeScale(s, s, s);
    return m;
  }
  // (X, Y, Z) -> (sX, -sZ, sY): rows of the 3x3 block.
  m.set(
    s, 0, 0, 0,
    0, 0, -s, 0,
    0, s, 0, 0,
    0, 0, 0, 1,
  );
  return m;
}

/**
 * Bake the unit/axis normalization into a parsed glTF scene (mutates the
 * template once, before any instance clone exists). Determinant stays +s^3
 * (positive), so triangle winding and normals are preserved by
 * BufferGeometry.applyMatrix4.
 *
 * glTF node transforms operate on RAW file coordinates, so each mesh is baked
 * with U . M_node (normalize AFTER the node transform) and the hierarchy is
 * flattened: the cached template holds meshes at identity under one group.
 */
export function normalizeGlbSceneToAssetMm(
  scene: THREE.Object3D,
  space: GlbCoordinateSpace,
): void {
  const u = glbToAssetMmMatrix4(space);
  scene.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) meshes.push(mesh);
  });
  const holder = new THREE.Group();
  holder.name = 'granete-glb-asset-mm';
  for (const mesh of meshes) {
    const baked = u.clone().multiply(mesh.matrixWorld);
    mesh.geometry.applyMatrix4(baked);
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
    mesh.position.set(0, 0, 0);
    mesh.quaternion.identity();
    mesh.scale.set(1, 1, 1);
    mesh.matrixAutoUpdate = true;
    mesh.updateMatrix();
    holder.add(mesh);
  }
  scene.clear();
  scene.add(holder);
}

/**
 * Constant workshop<->three axis swap S = [[1,0,0],[0,0,1],[0,1,0]] (three Y =
 * workshop Z). The render path composes S with the conjugated placement
 * matrices (see assemblyTransformToThreeMatrix4): memberGroup(S.M.S) *
 * swapGroup(S) * assetPoint = S.M.assetPoint. det(S) = -1 is handled by the
 * renderer's flipSided path, so asset-space geometry needs no winding change.
 */
export function createAssetSpaceSwapGroup(): THREE.Group {
  const group = new THREE.Group();
  group.matrixAutoUpdate = false;
  group.matrix.set(
    1, 0, 0, 0,
    0, 0, 1, 0,
    0, 1, 0, 0,
    0, 0, 0, 1,
  );
  return group;
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('WebCrypto unavailable');
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export class GlbSceneCache {
  private readonly entries = new Map<string, Promise<THREE.Group>>();
  private disposed = false;

  constructor(private readonly source: GlbAssetSource) {}

  get ownerKey(): string {
    return this.source.ownerKey;
  }

  load(representation: GlbRepresentationRef): Promise<THREE.Group> {
    if (this.disposed) {
      return Promise.reject(
        new GlbAssetLoadError(
          'inaccessible',
          representation.revisionId,
          representation.sha256,
          `cache for owner '${this.source.ownerKey}' was disposed (owner switched or unmounted)`,
        ),
      );
    }
    const key = `${this.source.ownerKey}:${representation.sha256}:${representation.revisionId}`;
    const existing = this.entries.get(key);
    if (existing) return existing;

    const promise = (async () => {
      let bytes: ArrayBuffer;
      try {
        bytes = await this.source.loadBytes(
          representation.assetId ?? '',
          representation.revisionId,
          representation.sha256,
        );
      } catch (cause) {
        throw new GlbAssetLoadError(
          'inaccessible',
          representation.revisionId,
          representation.sha256,
          String(cause),
        );
      }

      try {
        const digest = await sha256Hex(bytes);
        if (`sha256-${digest}` !== representation.sha256) {
          throw new GlbAssetLoadError(
            'corrupt',
            representation.revisionId,
            representation.sha256,
            `digest mismatch: fetched bytes hash to sha256-${digest}`,
          );
        }
      } catch (error) {
        if (error instanceof GlbAssetLoadError) throw error;
        throw new GlbAssetLoadError(
          'unsupported',
          representation.revisionId,
          representation.sha256,
          `digest verification unavailable: ${String(error)}`,
        );
      }

      try {
        const parsed = parseGlbContainer(new Uint8Array(bytes));
        const issues = validateGlbSelfContainedPolicy(parsed);
        if (issues.length > 0) {
          throw new GlbAssetLoadError(
            'unsupported',
            representation.revisionId,
            representation.sha256,
            issues.join('; '),
          );
        }
      } catch (error) {
        if (error instanceof GlbAssetLoadError) throw error;
        throw new GlbAssetLoadError(
          'corrupt',
          representation.revisionId,
          representation.sha256,
          String(error),
        );
      }

      const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
        new GLTFLoader().parse(
          bytes,
          '',
          (result) => resolve(result as unknown as { scene: THREE.Group }),
          (error) => reject(error),
        );
      }).catch((cause) => {
        throw new GlbAssetLoadError(
          'corrupt',
          representation.revisionId,
          representation.sha256,
          `glTF parse failed: ${String(cause)}`,
        );
      });

      normalizeGlbSceneToAssetMm(gltf.scene, {
        sourceUnits: representation.sourceUnits,
        upAxis: representation.upAxis,
      });
      return gltf.scene;
    })();

    promise.catch(() => {
      // Failed loads are retryable: drop the rejected entry.
      this.entries.delete(key);
    });
    this.entries.set(key, promise);
    return promise;
  }

  /** Dispose every cached template (geometry/materials/textures owned here). */
  dispose(): void {
    this.disposed = true;
    for (const promise of this.entries.values()) {
      void promise
        .then((scene) => {
          scene.traverse((object) => {
            const mesh = object as THREE.Mesh;
            if (!mesh.isMesh) return;
            mesh.geometry?.dispose();
            const material = mesh.material;
            const list = Array.isArray(material) ? material : material ? [material] : [];
            for (const mat of list) {
              const textures = Object.values(mat as unknown as Record<string, unknown>);
              for (const value of textures) {
                if (value && (value as THREE.Texture).isTexture) {
                  (value as THREE.Texture).dispose();
                }
              }
              mat.dispose();
            }
          });
        })
        .catch(() => undefined);
    }
    this.entries.clear();
  }
}

/** Clone a normalized template for one instance (shares geometry/materials). */
export function cloneGlbScene(template: THREE.Group): THREE.Group {
  return template.clone(true);
}
