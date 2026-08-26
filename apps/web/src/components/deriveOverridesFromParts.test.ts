/**
 * Tests for deriveOverridesFromParts — the core of BoardEditor persistence (gap #1).
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import type { ResolvedBoardPart } from '@granete/domain';
import { deriveOverridesFromParts } from './deriveOverridesFromParts';

function makePart(
  id: string,
  overrides: Partial<ResolvedBoardPart> = {},
): ResolvedBoardPart {
  return {
    id,
    description: 'Part',
    quantity: 1,
    lengthMm: 720,
    widthMm: 560,
    grain: 0,
    edges: [],
    optionRole: 'INTERIOR',
    materialId: 'mat-1',
    ...overrides,
  } as ResolvedBoardPart;
}

describe('deriveOverridesFromParts (gap #1 — BoardEditor persistence)', () => {
  it('returns empty map when nothing changed', () => {
    const parts = [makePart('comp-a-copy-0', { x: 0, y: 0, z: 0 })];
    expect(deriveOverridesFromParts(parts, parts)).toEqual({});
  });

  it('produces xFormula/yFormula when pose changed', () => {
    const original = [makePart('comp-a-copy-0', { x: 0, y: 10, z: 0 })];
    const edited = [makePart('comp-a-copy-0', { x: 50, y: 10, z: 0 })];
    const result = deriveOverridesFromParts(edited, original);
    expect(result['comp-a']).toEqual({ xFormula: '50' });
  });

  it('produces lengthFormula/widthFormula when dims changed', () => {
    const original = [makePart('comp-b-copy-0', { lengthMm: 720, widthMm: 560 })];
    const edited = [makePart('comp-b-copy-0', { lengthMm: 700, widthMm: 560 })];
    const result = deriveOverridesFromParts(edited, original);
    expect(result['comp-b']).toEqual({ lengthFormula: '700' });
  });

  it('produces rotateX/Y/Z as numbers (not strings)', () => {
    const original = [makePart('comp-c-copy-0', { rotateX: 0, rotateY: 0, rotateZ: 0 })];
    const edited = [makePart('comp-c-copy-0', { rotateX: 90, rotateY: 0, rotateZ: 0 })];
    const result = deriveOverridesFromParts(edited, original);
    expect(result['comp-c']).toEqual({ rotateX: 90 });
  });

  it('keys overrides by componentId (parses part.id pattern)', () => {
    const original = [
      makePart('comp-lateral-copy-0', { x: 0 }),
      makePart('comp-puerta-copy-0', { x: 0 }),
    ];
    const edited = [
      makePart('comp-lateral-copy-0', { x: 100 }),
      makePart('comp-puerta-copy-0', { x: 0 }),
    ];
    const result = deriveOverridesFromParts(edited, original);
    expect(Object.keys(result)).toEqual(['comp-lateral']);
    expect(result['comp-lateral']).toEqual({ xFormula: '100' });
  });

  it('handles multiple changed fields on the same part', () => {
    const original = [makePart('comp-x-copy-0', { x: 0, y: 0, lengthMm: 720, rotateZ: 0 })];
    const edited = [makePart('comp-x-copy-0', { x: 50, y: 20, lengthMm: 700, rotateZ: 45 })];
    const result = deriveOverridesFromParts(edited, original);
    expect(result['comp-x']).toEqual({
      xFormula: '50',
      yFormula: '20',
      lengthFormula: '700',
      rotateZ: 45,
    });
  });

  it('skips parts not in original (duplicates — not persisted this milestone)', () => {
    const original = [makePart('comp-a-copy-0', { x: 0 })];
    const edited = [
      makePart('comp-a-copy-0', { x: 50 }),
      makePart('comp-a-copy-1', { x: 30 }), // new copy from duplicate
    ];
    const result = deriveOverridesFromParts(edited, original);
    expect(Object.keys(result)).toEqual(['comp-a']);
  });
});
