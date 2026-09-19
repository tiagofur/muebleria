import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GLB_POLICY_LIMITS,
  GlbFormatError,
  assetPointToGlb,
  collectGlbVertices,
  glbPointToAssetMm,
  nearestGlbVertex,
  parseGlbContainer,
  validateGlbSelfContainedPolicy,
} from './glbRepresentation';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const canonicalGlb = new Uint8Array(
  readFileSync(join(root, 'contracts/fixtures/glb-parity-bracket.glb')),
);

function splitChunks(container: Uint8Array): [string, Uint8Array] {
  const view = new DataView(container.buffer, container.byteOffset, container.byteLength);
  const jsonLength = view.getUint32(12, true);
  const jsonText = new TextDecoder().decode(container.subarray(20, 20 + jsonLength));
  let binChunk = new Uint8Array(0);
  const binHeaderOffset = 20 + jsonLength;
  if (binHeaderOffset + 8 <= container.length) {
    const binLength = view.getUint32(binHeaderOffset, true);
    binChunk = container.subarray(binHeaderOffset + 8, binHeaderOffset + 8 + binLength);
  }
  return [jsonText, binChunk];
}

function rebuildContainer(jsonText: string): Uint8Array {
  const [, binChunk] = splitChunks(canonicalGlb);
  const jsonBytes = new TextEncoder().encode(jsonText);
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const binPad = (4 - (binChunk.length % 4)) % 4;
  const jsonLength = jsonBytes.length + jsonPad;
  const binLength = binChunk.length + binPad;
  const total = 12 + 8 + jsonLength + 8 + binLength;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonLength);
  view.setUint32(20 + jsonLength, binLength, true);
  view.setUint32(24 + jsonLength, 0x004e4942, true);
  out.set(binChunk, 28 + jsonLength);
  return out;
}

function rebuildContainerWithDoc(doc: unknown): Uint8Array {
  return rebuildContainer(JSON.stringify(doc));
}

describe('glbRepresentation coordinate conversion', () => {
  it('round-trips asset mm <-> GLB metres Y-up for the canonical convention', () => {
    const space = { sourceUnits: 'm' as const, upAxis: 'y' as const };
    const asset: [number, number, number] = [17.0, 23.0, 11.0];
    const glb = assetPointToGlb(space, asset);
    expect([...glb]).toEqual([0.017, 0.011, -0.023]);
    const back = glbPointToAssetMm(space, glb);
    expect(back[0]).toBeCloseTo(17.0, 9);
    expect(back[1]).toBeCloseTo(23.0, 9);
    expect(back[2]).toBeCloseTo(11.0, 9);
  });

  it('is the identity map for Z-up millimetre files', () => {
    const space = { sourceUnits: 'mm' as const, upAxis: 'z' as const };
    const asset: [number, number, number] = [1.5, -2.5, 3.5];
    expect([...glbPointToAssetMm(space, assetPointToGlb(space, asset))]).toEqual(asset);
  });

  it('scales every declared unit exactly once', () => {
    const asset: [number, number, number] = [25.4, 25.4, 25.4];
    expect(glbPointToAssetMm({ sourceUnits: 'inch', upAxis: 'z' }, [1, 1, 1])).toEqual(asset);
    expect(glbPointToAssetMm({ sourceUnits: 'cm', upAxis: 'z' }, [1, 1, 1])).toEqual([10, 10, 10]);
    expect(glbPointToAssetMm({ sourceUnits: 'm', upAxis: 'z' }, [1, 1, 1])).toEqual([
      1000, 1000, 1000,
    ]);
  });
});

describe('glbRepresentation container reader', () => {
  it('parses the canonical fixture and finds its reference vertices', () => {
    const parsed = parseGlbContainer(canonicalGlb);
    expect(parsed.json.asset?.version).toBe('2.0');
    expect(validateGlbSelfContainedPolicy(parsed)).toEqual([]);
    const vertices = collectGlbVertices(parsed);
    expect(vertices.length).toBeGreaterThanOrEqual(12 * 3);
    const p0 = nearestGlbVertex(vertices, [0.017, 0.011, -0.023]);
    expect(p0[0]).toBeCloseTo(0.017, 6);
  });

  it('rejects a broken magic', () => {
    const broken = new Uint8Array(canonicalGlb);
    broken[0] = 0x58;
    expect(() => parseGlbContainer(broken)).toThrow(GlbFormatError);
  });

  it('rejects a truncated container', () => {
    const truncated = canonicalGlb.subarray(0, canonicalGlb.length - 8);
    expect(() => parseGlbContainer(truncated)).toThrow(GlbFormatError);
  });

  it('rejects a length that does not match the byte count', () => {
    const mutated = new Uint8Array(canonicalGlb);
    mutated[8] = mutated[8] + 4;
    expect(() => parseGlbContainer(mutated)).toThrow(GlbFormatError);
  });

  it('rejects a JSON chunk that is not valid JSON', () => {
    const mutated = new Uint8Array(canonicalGlb);
    mutated[20] = 0x7b; // corrupt the first JSON byte
    mutated[21] = 0x7b;
    expect(() => parseGlbContainer(mutated)).toThrow(/valid JSON/);
  });

  it('rejects non-self-contained documents through the policy', () => {
    const base = parseGlbContainer(canonicalGlb);
    const rebuild = (mutate: (doc: Record<string, unknown>) => void) => {
      const doc = JSON.parse(base.jsonText) as Record<string, unknown>;
      mutate(doc);
      return { ...base, json: doc as never };
    };

    const withExternalBuffer = rebuild((doc) => {
      (doc.buffers as { uri?: string }[])[0].uri = 'https://external.example/bracket.bin';
    });
    expect(
      validateGlbSelfContainedPolicy(withExternalBuffer).join('\n'),
    ).not.toContain('buffer'); // the container parser is the authority for the buffer URI:
    expect(() =>
      parseGlbContainer(rebuildContainerWithDoc(withExternalBuffer.json as never)),
    ).toThrow(/forbidden/);

    const withExternalImage = rebuild((doc) => {
      doc.images = [{ uri: 'https://external.example/tex.png' }];
    });
    expect(validateGlbSelfContainedPolicy(withExternalImage)[0]).toContain(
      'images[0].uri must be omitted',
    );

    const withRequiredExtension = rebuild((doc) => {
      doc.extensionsRequired = ['KHR_draco_mesh_compression'];
    });
    expect(validateGlbSelfContainedPolicy(withRequiredExtension)[0]).toContain(
      'required extensions are not supported',
    );

    const withBigLimitsExceeded = rebuild((doc) => {
      doc.meshes = Array.from({ length: 3 }, () => (doc.meshes as unknown[])[0]);
    });
    expect(
      validateGlbSelfContainedPolicy(withBigLimitsExceeded, {
        ...DEFAULT_GLB_POLICY_LIMITS,
        maxMeshes: 2,
      })[0],
    ).toContain('mesh count 3 exceeds limit 2');
  });

  it('enforces the shared #669 validation contract case by case', () => {
    const contract = JSON.parse(
      readFileSync(join(root, 'contracts/fixtures/glb-validation-cases.json'), 'utf8'),
    ) as {
      readonly fixture: string;
      readonly cases: readonly {
        readonly name: string;
        readonly expect: 'valid' | 'invalid';
        readonly mutation:
          | null
          | { readonly type: 'bytes'; readonly offset: number; readonly hex: string }
          | { readonly type: 'truncate'; readonly bytesFromEnd: number }
          | { readonly type: 'json-set'; readonly path: string; readonly value: unknown };
      }[];
    };
    expect(contract.cases.length).toBeGreaterThanOrEqual(15);

    const setPath = (doc: Record<string, unknown>, path: string, value: unknown) => {
      const segments = path.split('.');
      let current: unknown = doc;
      for (let i = 0; i < segments.length - 1; i++) {
        const key = segments[i];
        const container = current as Record<string, unknown>;
        const next: unknown = container[key];
        if (i + 1 < segments.length && /^\d+$/.test(segments[i + 1] ?? '')) {
          const array = next as unknown[];
          current = array[Number(segments[i + 1])];
          i += 1;
        } else {
          current = next;
        }
      }
      (current as Record<string, unknown>)[segments[segments.length - 1]] = value;
    };

    for (const testCase of contract.cases) {
      const mutated = (() => {
        if (testCase.mutation === null) return canonicalGlb;
        const mutation = testCase.mutation;
        if (mutation.type === 'bytes') {
          const out = new Uint8Array(canonicalGlb);
          const patch = mutation.hex.match(/.{2}/g) ?? [];
          patch.forEach((byte, index) => {
            out[mutation.offset + index] = parseInt(byte, 16);
          });
          return out;
        }
        if (mutation.type === 'truncate') {
          return canonicalGlb.subarray(0, canonicalGlb.length - mutation.bytesFromEnd);
        }
        const [canonicalJsonText] = splitChunks(canonicalGlb);
        const doc = JSON.parse(canonicalJsonText) as Record<string, unknown>;
        setPath(doc, mutation.path, mutation.value);
        return rebuildContainer(JSON.stringify(doc));
      })();

      if (testCase.expect === 'valid') {
        const parsed = parseGlbContainer(mutated);
        expect(validateGlbSelfContainedPolicy(parsed), testCase.name).toEqual([]);
        expect(collectGlbVertices(parsed).length, testCase.name).toBeGreaterThan(0);
      } else {
        let rejected = false;
        try {
          const parsed = parseGlbContainer(mutated);
          rejected =
            validateGlbSelfContainedPolicy(parsed).length > 0 ||
            collectGlbVertices(parsed).length === 0;
        } catch {
          rejected = true;
        }
        expect(rejected, `${testCase.name} must be rejected`).toBe(true);
      }
    }
  });
});
