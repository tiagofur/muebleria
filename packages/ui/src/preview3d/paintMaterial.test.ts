import { describe, expect, it } from 'vitest';
import {
  canApplyMaterial,
  decodeBoardPaintDrag,
  encodeBoardPaintDrag,
  decodeLibraryDrag,
  decodePaintDrag,
  decodeUnplacedDrag,
  encodeLibraryDrag,
  encodePaintDrag,
  encodeUnplacedDrag,
  resolveBoardPaintTarget,
  resolvePaintSurface,
  type ResolvedIntersect,
  type SceneHitNode,
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

  it('returns countertop when the closest intersect is countertop', () => {
    const hits: ResolvedIntersect[] = [
      { kind: 'countertop', distance: 50 },
      { kind: 'floor', distance: 100 },
    ];
    expect(resolvePaintSurface(hits)).toEqual({ kind: 'countertop' });
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

  it('any material → countertop target: allowed', () => {
    expect(canApplyMaterial('floor', { kind: 'countertop' })).toBe(true);
    expect(canApplyMaterial(undefined, { kind: 'countertop' })).toBe(true);
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

// ─── F141 encode/decode de tarjeta de biblioteca ────────────────────────────

describe('encodeLibraryDrag / decodeLibraryDrag', () => {
  const validPayload = {
    moduleId: 'mod-1',
    widthMm: 600,
    heightMm: 720,
    depthMm: 560,
  };

  it('round-trips a valid payload', () => {
    const encoded = encodeLibraryDrag(validPayload);
    expect(decodeLibraryDrag(encoded)).toEqual(validPayload);
  });

  it('returns null for null/empty input', () => {
    expect(decodeLibraryDrag(null)).toBeNull();
    expect(decodeLibraryDrag('')).toBeNull();
  });

  it('returns null for corrupt JSON', () => {
    expect(decodeLibraryDrag('{bad')).toBeNull();
  });

  it('returns null when moduleId is missing or empty', () => {
    expect(decodeLibraryDrag(JSON.stringify({ ...validPayload, moduleId: '' }))).toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { moduleId: _id, ...rest } = validPayload;
    expect(decodeLibraryDrag(JSON.stringify(rest))).toBeNull();
  });

  it('returns null when dims are not numbers', () => {
    expect(
      decodeLibraryDrag(JSON.stringify({ ...validPayload, depthMm: '560' })),
    ).toBeNull();
  });
});

// ─── F142 encode/decode de drag de tablero ──────────────────────────────────

describe('encodeBoardPaintDrag / decodeBoardPaintDrag', () => {
  it('round-trips a valid payload', () => {
    const encoded = encodeBoardPaintDrag({ materialId: 'mat-1' });
    expect(decodeBoardPaintDrag(encoded)).toEqual({ materialId: 'mat-1' });
  });

  it('returns null for null/corrupt/empty payloads', () => {
    expect(decodeBoardPaintDrag(null)).toBeNull();
    expect(decodeBoardPaintDrag('')).toBeNull();
    expect(decodeBoardPaintDrag('{bad')).toBeNull();
    expect(decodeBoardPaintDrag('{"materialId":""}')).toBeNull();
    expect(decodeBoardPaintDrag('{"other":1}')).toBeNull();
  });
});

// ─── F142 resolveBoardPaintTarget (target de drop de tablero) ───────────────

/** Fabrica un nodo de escena fake con userData y cadena de padres. */
function node(
  userData: Record<string, unknown>,
  parent?: unknown,
): SceneHitNode {
  return { userData, parent };
}

describe('resolveBoardPaintTarget', () => {
  it('devuelve el moduleKey del ancestro del hit más cercano', () => {
    const moduleGroup = node({ moduleKey: 'it-a#0' });
    const board = node({ boardId: 'b-1' }, moduleGroup);
    expect(resolveBoardPaintTarget([{ object: board }])).toBe('it-a#0');
  });

  it('hit más cercano sin mueble (piso/muro/techo) rechaza aunque haya un mueble detrás', () => {
    const moduleGroup = node({ moduleKey: 'it-a#0' });
    const wall = node({ wallId: 'w1' });
    const boardBehind = node({}, moduleGroup);
    expect(resolveBoardPaintTarget([{ object: wall }, { object: boardBehind }])).toBeNull();
  });

  it('mesada ambiental (boardPaintBlocked) rechaza aunque cuelgue del mueble', () => {
    const moduleGroup = node({ moduleKey: 'it-a#0' });
    const countertop = node({ countertop: true, boardPaintBlocked: true }, moduleGroup);
    expect(resolveBoardPaintTarget([{ object: countertop }])).toBeNull();
  });

  it('sin hits o cadena sin moduleKey devuelve null', () => {
    expect(resolveBoardPaintTarget([])).toBeNull();
    expect(resolveBoardPaintTarget([{ object: node({}) }])).toBeNull();
    expect(
      resolveBoardPaintTarget([{ object: node({}, node({ other: 1 })) }]),
    ).toBeNull();
  });
});
