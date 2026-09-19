import { type AssemblyBasis, applyAssemblyBasis } from './agregadoAssembly';

/**
 * GLB representation contract (#669).
 *
 * A GLB revision is a derived (or directly uploaded) web representation of a
 * hardware 3D asset. The contract keeps a single interpretation chain shared
 * with SketchUp (#668):
 *
 *   worldPoint = T_furniture x T_assembly x T_member x inverse(T_mountFrame) x P_asset
 *
 * The GLB file itself lives in its authored coordinate space (glTF convention:
 * meters, +Y up). The ONLY place where units/axes are converted is this module
 * (the GLB boundary), producing asset-space millimetres (+Z up, the same space
 * the MountFrame refers to). MountFrame semantics are never reinterpreted for
 * the web: after {@link glbPointToAssetMm} the common chain applies unchanged.
 */

export type GlbSourceUnits = 'mm' | 'cm' | 'm' | 'inch';
export type GlbUpAxis = 'y' | 'z';

/** Declared coordinate space of a GLB file, mirroring HardwareAssetOrigin (#667). */
export interface GlbCoordinateSpace {
  readonly sourceUnits: GlbSourceUnits;
  readonly upAxis: GlbUpAxis;
}

export const GLB_SOURCE_UNITS_TO_MM: Readonly<Record<GlbSourceUnits, number>> = {
  mm: 1.0,
  cm: 10.0,
  m: 1000.0,
  inch: 25.4,
};

export function isGlbSourceUnits(value: unknown): value is GlbSourceUnits {
  return value === 'mm' || value === 'cm' || value === 'm' || value === 'inch';
}

export function isGlbUpAxis(value: unknown): value is GlbUpAxis {
  return value === 'y' || value === 'z';
}

/**
 * Convert a GLB-space point (declared units, declared up axis) into asset-space
 * millimetres (+Z up). This is the single, explicit unit/axis normalization of
 * the GLB boundary; applying it twice or skipping it is a detectable defect
 * (see the #669 sensitivity tests).
 *
 * Y-up -> Z-up right-handed map: asset = (X, -Z, Y) * unitScale.
 */
export function glbPointToAssetMm(
  space: GlbCoordinateSpace,
  p: readonly [number, number, number] | Float32Array,
): readonly [number, number, number] {
  const scale = GLB_SOURCE_UNITS_TO_MM[space.sourceUnits];
  const x = p[0] * scale;
  const y = p[1] * scale;
  const z = p[2] * scale;
  if (space.upAxis === 'z') {
    return [x, y, z];
  }
  return [x, -z, y];
}

/** Inverse of {@link glbPointToAssetMm}: asset-space mm (+Z up) -> GLB space. */
export function assetPointToGlb(
  space: GlbCoordinateSpace,
  p: readonly [number, number, number],
): readonly [number, number, number] {
  const inverse = 1.0 / GLB_SOURCE_UNITS_TO_MM[space.sourceUnits];
  if (space.upAxis === 'z') {
    return [p[0] * inverse, p[1] * inverse, p[2] * inverse];
  }
  return [p[0] * inverse, p[2] * inverse, -p[1] * inverse];
}

// --- Minimal structural GLB container reader --------------------------------
//
// Purpose: contract-level inspection (self-containment policy, vertex extraction
// for parity/inspection) without a full glTF runtime. The renderer uses
// three.js GLTFLoader; this reader keeps domain/storage tests independent of
// the render stack and mirrors the Go upload-side validator.

export const GLB_MAGIC = 0x46546c67;
const GLB_CHUNK_TYPE_JSON = 0x4e4f534a;
const GLB_CHUNK_TYPE_BIN = 0x004e4942;
const GLB_COMPONENT_TYPE_FLOAT = 5126;

export interface ParsedGlbContainer {
  readonly jsonText: string;
  readonly json: GlbJsonDocument;
  readonly bin: Uint8Array | undefined;
}

export interface GlbJsonDocument {
  readonly asset?: { version?: unknown; generator?: unknown };
  readonly scene?: unknown;
  readonly scenes?: readonly unknown[];
  readonly nodes?: readonly unknown[];
  readonly meshes?: readonly unknown[];
  readonly buffers?: readonly { byteLength?: unknown; uri?: unknown }[];
  readonly bufferViews?: readonly {
    buffer?: unknown;
    byteOffset?: unknown;
    byteLength?: unknown;
  }[];
  readonly accessors?: readonly {
    bufferView?: unknown;
    byteOffset?: unknown;
    componentType?: unknown;
    count?: unknown;
    type?: unknown;
    min?: unknown;
    max?: unknown;
  }[];
  readonly images?: readonly { uri?: unknown; bufferView?: unknown; mimeType?: unknown }[];
  readonly extensionsRequired?: readonly unknown[];
  readonly extensionsUsed?: readonly unknown[];
  [key: string]: unknown;
}

export class GlbFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GlbFormatError';
  }
}

/**
 * Parse and structurally validate a GLB container: magic, version 2, chunk
 * layout, JSON chunk, BIN chunk presence when the document declares a
 * buffer without a URI. Throws {@link GlbFormatError} on any violation.
 */
export function parseGlbContainer(bytes: Uint8Array): ParsedGlbContainer {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 20) {
    throw new GlbFormatError('GLB too short for header + first chunk');
  }
  const magic = view.getUint32(0, true);
  if (magic !== GLB_MAGIC) {
    throw new GlbFormatError(`invalid GLB magic 0x${magic.toString(16)} (expected glTF)`);
  }
  const version = view.getUint32(4, true);
  if (version !== 2) {
    throw new GlbFormatError(`unsupported GLB container version ${version} (expected 2)`);
  }
  const totalLength = view.getUint32(8, true);
  if (totalLength !== bytes.byteLength) {
    throw new GlbFormatError(
      `GLB length ${totalLength} does not match byte count ${bytes.byteLength}`,
    );
  }

  let offset = 12;
  let jsonText: string | undefined;
  let bin: Uint8Array | undefined;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) {
      throw new GlbFormatError('truncated GLB chunk header');
    }
    const chunkLength = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const dataStart = offset + 8;
    if (chunkLength % 4 !== 0) {
      throw new GlbFormatError('GLB chunk length must be 4-byte aligned');
    }
    if (dataStart + chunkLength > bytes.byteLength) {
      throw new GlbFormatError('GLB chunk overruns container length');
    }
    if (chunkType === GLB_CHUNK_TYPE_JSON && jsonText === undefined) {
      jsonText = new TextDecoder().decode(bytes.subarray(dataStart, dataStart + chunkLength));
    } else if (chunkType === GLB_CHUNK_TYPE_BIN && bin === undefined) {
      bin = bytes.subarray(dataStart, dataStart + chunkLength);
    }
    offset = dataStart + chunkLength;
  }
  if (jsonText === undefined) {
    throw new GlbFormatError('GLB missing JSON chunk');
  }

  let json: GlbJsonDocument;
  try {
    json = JSON.parse(jsonText) as GlbJsonDocument;
  } catch (cause) {
    throw new GlbFormatError(`GLB JSON chunk is not valid JSON: ${String(cause)}`);
  }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    throw new GlbFormatError('GLB JSON chunk must be an object');
  }
  if (json.asset?.version !== '2.0' && json.asset?.version !== 2.0) {
    throw new GlbFormatError('glTF asset.version must be "2.0"');
  }
  if (!Array.isArray(json.scenes) || json.scenes.length === 0) {
    throw new GlbFormatError('glTF document must declare at least one scene');
  }
  if (!Array.isArray(json.nodes) || json.nodes.length === 0) {
    throw new GlbFormatError('glTF document must declare at least one node');
  }
  if (!Array.isArray(json.meshes) || json.meshes.length === 0) {
    throw new GlbFormatError('glTF document must declare at least one mesh');
  }

  const buffers = json.buffers ?? [];
  if (buffers.length === 0) {
    throw new GlbFormatError('glTF document must declare its buffer');
  }
  if (buffers.length > 1) {
    throw new GlbFormatError('glTF document must declare exactly one buffer');
  }
  const firstBuffer = buffers[0];
  if (firstBuffer?.uri !== undefined && firstBuffer.uri !== null && firstBuffer.uri !== '') {
    throw new GlbFormatError('GLB buffer must be embedded (buffer.uri is forbidden)');
  }
  if (bin === undefined) {
    throw new GlbFormatError('GLB missing BIN chunk for embedded buffer');
  }
  const declaredBufferLength = firstBuffer?.byteLength;
  if (typeof declaredBufferLength !== 'number' || declaredBufferLength <= 0) {
    throw new GlbFormatError('glTF buffer.byteLength must be a positive integer');
  }
  if (declaredBufferLength > bin.byteLength) {
    throw new GlbFormatError(
      `glTF buffer.byteLength ${declaredBufferLength} exceeds BIN chunk ${bin.byteLength}`,
    );
  }

  return { jsonText, json, bin };
}

export interface GlbPolicyLimits {
  readonly maxTriangles: number;
  readonly maxMeshes: number;
  readonly maxNodes: number;
  readonly maxMaterials: number;
}

export const DEFAULT_GLB_POLICY_LIMITS: GlbPolicyLimits = {
  maxTriangles: 2_000_000,
  maxMeshes: 512,
  maxNodes: 4_096,
  maxMaterials: 256,
};

/**
 * Enforce the #669 GLB ingestion policy on a parsed document: self-contained
 * (no external URIs anywhere), embedded images only, no required extensions,
 * structural limits. Rendering-time loaders apply the same rules; upload-time
 * Go validation mirrors them (contract parity fixtures cover the both).
 */
export function validateGlbSelfContainedPolicy(
  parsed: ParsedGlbContainer,
  limits: GlbPolicyLimits = DEFAULT_GLB_POLICY_LIMITS,
): readonly string[] {
  const issues: string[] = [];
  const { json } = parsed;

  const extensionsRequired = json.extensionsRequired ?? [];
  if (extensionsRequired.length > 0) {
    issues.push(`glTF required extensions are not supported: ${extensionsRequired.join(', ')}`);
  }

  for (const [index, image] of (json.images ?? []).entries()) {
    if (image?.uri !== undefined && image.uri !== null && image.uri !== '') {
      issues.push(`images[${index}].uri must be omitted (embedded bufferView only)`);
    }
    if (image?.bufferView === undefined || image.bufferView === null) {
      issues.push(`images[${index}] must reference an embedded bufferView`);
    }
  }

  const meshes = json.meshes ?? [];
  if (meshes.length > limits.maxMeshes) {
    issues.push(`mesh count ${meshes.length} exceeds limit ${limits.maxMeshes}`);
  }
  const nodes = json.nodes ?? [];
  if (nodes.length > limits.maxNodes) {
    issues.push(`node count ${nodes.length} exceeds limit ${limits.maxNodes}`);
  }
  const materials = (json.materials ?? []) as readonly unknown[];
  if (materials.length > limits.maxMaterials) {
    issues.push(`material count ${materials.length} exceeds limit ${limits.maxMaterials}`);
  }

  let triangles = 0;
  for (const [meshIndex, mesh] of meshes.entries()) {
    const primitives = (mesh as { primitives?: readonly unknown[] })?.primitives;
    if (!Array.isArray(primitives) || primitives.length === 0) {
      issues.push(`meshes[${meshIndex}] must declare primitives`);
      continue;
    }
    for (const [primIndex, primitive] of primitives.entries()) {
      const attributes = (primitive as { attributes?: Record<string, unknown> })?.attributes;
      if (!attributes || attributes.POSITION === undefined) {
        issues.push(`meshes[${meshIndex}].primitives[${primIndex}] must declare POSITION`);
      }
      const mode = (primitive as { mode?: unknown })?.mode;
      if (mode !== undefined && mode !== 4) {
        issues.push(
          `meshes[${meshIndex}].primitives[${primIndex}].mode ${String(mode)} is not supported (triangles only)`,
        );
      }
      const indices = (primitive as { indices?: unknown })?.indices;
      if (indices !== undefined) {
        const accessor = (json.accessors ?? [])[indices as number];
        const count = accessor?.count;
        if (typeof count === 'number') {
          triangles += count / 3;
        }
      } else if (typeof attributes?.POSITION === 'number') {
        const accessor = (json.accessors ?? [])[attributes.POSITION];
        const count = accessor?.count;
        if (typeof count === 'number') {
          triangles += count / 3;
        }
      }
    }
  }
  if (triangles > limits.maxTriangles) {
    issues.push(`triangle count ${triangles} exceeds limit ${limits.maxTriangles}`);
  }

  return issues;
}

/** Read a VEC3/FLOAT accessor referenced by index, as flat [x,y,z,...] points. */
export function readGlbVec3Accessor(
  parsed: ParsedGlbContainer,
  accessorIndex: number,
): readonly number[] {
  const { json, bin } = parsed;
  if (!bin) {
    throw new GlbFormatError('GLB BIN chunk is required to read accessors');
  }
  const accessor = (json.accessors ?? [])[accessorIndex];
  if (!accessor || typeof accessor !== 'object') {
    throw new GlbFormatError(`accessor ${accessorIndex} not found`);
  }
  if (accessor.componentType !== GLB_COMPONENT_TYPE_FLOAT) {
    throw new GlbFormatError(`accessor ${accessorIndex} componentType must be FLOAT (5126)`);
  }
  if (accessor.type !== 'VEC3') {
    throw new GlbFormatError(`accessor ${accessorIndex} type must be VEC3`);
  }
  const count = accessor.count;
  if (typeof count !== 'number' || !Number.isInteger(count) || count <= 0) {
    throw new GlbFormatError(`accessor ${accessorIndex} count must be a positive integer`);
  }
  const bufferViewIndex = accessor.bufferView;
  if (typeof bufferViewIndex !== 'number') {
    throw new GlbFormatError(`accessor ${accessorIndex} must reference a bufferView`);
  }
  const bufferView = (json.bufferViews ?? [])[bufferViewIndex];
  if (!bufferView || typeof bufferView !== 'object') {
    throw new GlbFormatError(`bufferView ${bufferViewIndex} not found`);
  }
  if (bufferView.buffer !== undefined && bufferView.buffer !== 0) {
    throw new GlbFormatError('accessors must reference the embedded buffer 0');
  }
  const byteOffset = typeof accessor.byteOffset === 'number' ? accessor.byteOffset : 0;
  const viewOffset = typeof bufferView.byteOffset === 'number' ? bufferView.byteOffset : 0;
  const viewLength = typeof bufferView.byteLength === 'number' ? bufferView.byteLength : 0;
  const byteStart = viewOffset + byteOffset;
  const byteEnd = byteStart + count * 12;
  if (byteEnd > viewOffset + viewLength || byteEnd > bin.byteLength) {
    throw new GlbFormatError(`accessor ${accessorIndex} range exceeds its bufferView`);
  }
  const out = new Array<number>(count * 3);
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  for (let i = 0; i < count; i++) {
    const base = byteStart + i * 12;
    out[i * 3] = view.getFloat32(base, true);
    out[i * 3 + 1] = view.getFloat32(base + 4, true);
    out[i * 3 + 2] = view.getFloat32(base + 8, true);
  }
  return out;
}

/**
 * Collect every POSITION vertex of the document (flat triples, GLB space).
 * Order follows mesh/primitive order; it is a locator inside the exact file
 * only, never an identity across revisions.
 */
export function collectGlbVertices(parsed: ParsedGlbContainer): readonly number[] {
  const vertices: number[] = [];
  for (const mesh of parsed.json.meshes ?? []) {
    for (const primitive of (mesh as { primitives?: readonly { attributes?: Record<string, unknown> }[] })
      .primitives ?? []) {
      const positionIndex = primitive.attributes?.POSITION;
      if (typeof positionIndex !== 'number') continue;
      vertices.push(...readGlbVec3Accessor(parsed, positionIndex));
    }
  }
  if (vertices.length === 0) {
    throw new GlbFormatError('GLB document exposes no POSITION vertices');
  }
  return vertices;
}

/**
 * Find the GLB vertex closest to an expected GLB-space point and return it.
 * Used to measure committed/exported bytes against contract constants: the
 * returned point is what the file actually contains (float32 rounded).
 */
export function nearestGlbVertex(
  vertices: readonly number[],
  target: readonly [number, number, number],
): readonly [number, number, number] {
  let best: readonly [number, number, number] | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 2 < vertices.length; i += 3) {
    const dx = vertices[i]! - target[0];
    const dy = vertices[i + 1]! - target[1];
    const dz = vertices[i + 2]! - target[2];
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = [vertices[i]!, vertices[i + 1]!, vertices[i + 2]!];
    }
  }
  if (!best) {
    throw new GlbFormatError('no vertices available');
  }
  return best;
}

// --- Placement chain composition (shared SKP/GLB math) -----------------------

export interface AssemblyPlacement {
  readonly translationMm: readonly [number, number, number];
  readonly basis: AssemblyBasis;
}

/**
 * Compose parent x child rigid transforms (parent applied after child):
 * P_out = T_parent . T_child . P. Pure rotation+translation, scale stays 1.
 */
export function multiplyAssemblyPlacements(
  parent: AssemblyPlacement,
  child: AssemblyPlacement,
): AssemblyPlacement {
  const rotatedChildTranslation = applyAssemblyBasis(parent.basis, child.translationMm);
  return {
    translationMm: [
      parent.translationMm[0] + rotatedChildTranslation[0],
      parent.translationMm[1] + rotatedChildTranslation[1],
      parent.translationMm[2] + rotatedChildTranslation[2],
    ],
    basis: {
      x: applyAssemblyBasis(parent.basis, child.basis.x),
      y: applyAssemblyBasis(parent.basis, child.basis.y),
      z: applyAssemblyBasis(parent.basis, child.basis.z),
    },
  };
}

export function applyAssemblyPlacement(
  placement: AssemblyPlacement,
  p: readonly [number, number, number],
): readonly [number, number, number] {
  const rotated = applyAssemblyBasis(placement.basis, p);
  return [
    placement.translationMm[0] + rotated[0],
    placement.translationMm[1] + rotated[1],
    placement.translationMm[2] + rotated[2],
  ];
}
