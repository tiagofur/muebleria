/**
 * Document equivalence for the PTX subset readback (#650 PR 4 core).
 *
 * The comparison is deliberately ORDER-SENSITIVE over `records`: CUTS row
 * order encodes the nesting (CUT_INDEX tree), so a file whose rows were
 * physically reordered by SEQUENCE is a DIFFERENT document even when every
 * row is byte-identical (S03 pp.142–145; investigation §4 CUTS rule).
 *
 * A property explicitly set to `undefined` equals the same property absent:
 * both mean "column not present" for the reader and "empty cell" for the
 * writer.
 */

import type { PtxDocument } from './records';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      const va = (a as Record<string, unknown>)[key];
      const vb = (b as Record<string, unknown>)[key];
      if (va === undefined && vb === undefined) continue;
      if (!deepEqual(va, vb)) return false;
    }
    return true;
  }
  return false;
}

/** Structural, order-sensitive equivalence of two PTX documents. */
export function ptxDocumentsEqual(a: PtxDocument, b: PtxDocument): boolean {
  return deepEqual(a, b);
}

/** First difference path for diagnostics; empty when equivalent. */
export function ptxDocumentDifference(a: PtxDocument, b: PtxDocument): string | null {
  const path = firstDifference(a, b, '$');
  return path;
}

function firstDifference(a: unknown, b: unknown, path: string): string | null {
  if (a === b || (a === undefined && b === undefined)) return null;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}: length ${a.length} != ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const diff = firstDifference(a[i], b[i], `${path}[${i}]`);
      if (diff) return diff;
    }
    return null;
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      const va = (a as Record<string, unknown>)[key];
      const vb = (b as Record<string, unknown>)[key];
      if (va === undefined && vb === undefined) continue;
      const diff = firstDifference(va, vb, `${path}.${key}`);
      if (diff) return diff;
    }
    return null;
  }
  return `${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`;
}
