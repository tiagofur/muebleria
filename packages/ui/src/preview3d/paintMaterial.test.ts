import { describe, expect, it } from 'vitest';
import {
  canApplyMaterial,
  decodePaintDrag,
  decodeUnplacedDrag,
  encodePaintDrag,
  encodeUnplacedDrag,
  resolvePaintSurface,
  type ResolvedIntersect,
} from './paintMaterial';

describe('resolvePaintSurface', () => {
  it('returns floor when the closest intersect is floor', () => {
    const hits: ResolvedIntersect[] = [
      { kind: 'floor', distance: 100 },
      { kind: 'wall', wallId: 'w1', distance: 200 },
    ];
    expect(resolvePaintSurface(hits)).toEqual({ kind: 'floor' });
  });

  it('returns wall when the closest intersect is a wall', () => {
    const hits: ResolvedIntersect[] = [
      { kind: 'wall', wallId: 'w1', distance: 100 },
      { kind: 'floor', distance: 200 },
    ];
    expect(resolvePaintSurface(hits)).toEqual({ kind: 'wall', wallId: 'w1' });
  });

  it('skips non-paintable intersects and finds the next paintable', () => {
    const hits: ResolvedIntersect[] = [
      { kind: 'part' as unknown as 'floor', distance: 50 },
      { kind: 'floor', distance: 100 },
    ] as ResolvedIntersect[];
    expect(resolvePaintSurface(hits)).toEqual({ kind: 'floor' });
  });

  it('returns null when wall intersect lacks wallId', () => {
    const hits: ResolvedIntersect[] = [{ kind: 'wall', distance: 100 }];
    expect(resolvePaintSurface(hits)).toBeNull();
  });

  it('returns null for empty intersects', () => {
    expect(resolvePaintSurface([])).toBeNull();
  });
});

describe('canApplyMaterial', () => {
  it('any material → floor target: allowed', () => {
    expect(canApplyMaterial('floor', { kind: 'floor' })).toBe(true);
    expect(canApplyMaterial(undefined, { kind: 'floor' })).toBe(true);
  });

  it('any material → wall target: allowed', () => {
    expect(canApplyMaterial('floor', { kind: 'wall', wallId: 'w1' })).toBe(true);
    expect(canApplyMaterial('wall', { kind: 'wall', wallId: 'w1' })).toBe(true);
  });

  it('any material → ceiling target: allowed', () => {
    expect(canApplyMaterial('ceiling', { kind: 'ceiling' })).toBe(true);
    expect(canApplyMaterial('floor', { kind: 'ceiling' })).toBe(true);
  });
});

describe('encode/decode paint drag', () => {
  it('round-trips a floor payload', () => {
    const payload = { materialId: 'am-1', surfaceType: 'floor' as const };
    const encoded = encodePaintDrag(payload);
    expect(decodePaintDrag(encoded)).toEqual(payload);
  });

  it('round-trips a wall payload', () => {
    const payload = { materialId: 'am-2', surfaceType: 'wall' as const };
    const encoded = encodePaintDrag(payload);
    expect(decodePaintDrag(encoded)).toEqual(payload);
  });

  it('round-trips a ceiling payload (F065 fix)', () => {
    const payload = { materialId: 'am-3', surfaceType: 'ceiling' as const };
    const encoded = encodePaintDrag(payload);
    expect(decodePaintDrag(encoded)).toEqual(payload);
  });

  it('decode returns null for null input', () => {
    expect(decodePaintDrag(null)).toBeNull();
  });

  it('decode returns null for empty string', () => {
    expect(decodePaintDrag('')).toBeNull();
  });

  it('decode returns null for corrupt JSON', () => {
    expect(decodePaintDrag('{not json')).toBeNull();
  });

  it('decode returns null for valid JSON with wrong shape', () => {
    expect(decodePaintDrag(JSON.stringify({ other: 'x' }))).toBeNull();
    expect(
      decodePaintDrag(JSON.stringify({ materialId: 'x', surfaceType: 'invalid' })),
    ).toBeNull();
    expect(
      decodePaintDrag(JSON.stringify({ surfaceType: 'floor' })),
    ).toBeNull();
  });
});

// ─── F065 encode/decode de ítem sin colocar ──────────────────────────────────

describe('encodeUnplacedDrag / decodeUnplacedDrag', () => {
  const validPayload = {
    itemId: 'item-1',
    instanceIndex: 0,
    widthMm: 600,
    heightMm: 720,
    depthMm: 560,
  };

  it('round-trips a valid payload', () => {
    const encoded = encodeUnplacedDrag(validPayload);
    expect(decodeUnplacedDrag(encoded)).toEqual(validPayload);
  });

  it('round-trips with instanceIndex > 0', () => {
    const p = { ...validPayload, instanceIndex: 2 };
    expect(decodeUnplacedDrag(encodeUnplacedDrag(p))).toEqual(p);
  });

  it('returns null for null input', () => {
    expect(decodeUnplacedDrag(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(decodeUnplacedDrag('')).toBeNull();
  });

  it('returns null for corrupt JSON', () => {
    expect(decodeUnplacedDrag('{bad')).toBeNull();
  });

  it('returns null when itemId is missing', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { itemId: _id, ...rest } = validPayload;
    expect(decodeUnplacedDrag(JSON.stringify(rest))).toBeNull();
  });

  it('returns null when widthMm is a string instead of number', () => {
    expect(
      decodeUnplacedDrag(
        JSON.stringify({ ...validPayload, widthMm: '600' }),
      ),
    ).toBeNull();
  });

  it('returns null when instanceIndex is missing', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { instanceIndex: _idx, ...rest } = validPayload;
    expect(decodeUnplacedDrag(JSON.stringify(rest))).toBeNull();
  });
});
