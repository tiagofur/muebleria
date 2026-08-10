import { describe, expect, it } from 'vitest';
import {
  canApplyMaterial,
  decodePaintDrag,
  encodePaintDrag,
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
    // Simula: primero golpea una pieza (no paintable), luego el piso
    const hits: ResolvedIntersect[] = [
      { kind: 'part' as unknown as 'floor', distance: 50 }, // no es floor/wall
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
  it('floor material → floor target: allowed', () => {
    expect(canApplyMaterial('floor', { kind: 'floor' })).toBe(true);
  });

  it('floor material → wall target: rejected', () => {
    expect(canApplyMaterial('floor', { kind: 'wall', wallId: 'w1' })).toBe(false);
  });

  it('wall material → wall target: allowed', () => {
    expect(canApplyMaterial('wall', { kind: 'wall', wallId: 'w1' })).toBe(true);
  });

  it('wall material → floor target: rejected', () => {
    expect(canApplyMaterial('wall', { kind: 'floor' })).toBe(false);
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
    expect(decodePaintDrag(JSON.stringify({ materialId: 'x' }))).toBeNull();
    expect(
      decodePaintDrag(JSON.stringify({ materialId: 'x', surfaceType: 'ceil' })),
    ).toBeNull();
    expect(
      decodePaintDrag(JSON.stringify({ surfaceType: 'floor' })),
    ).toBeNull();
  });
});
