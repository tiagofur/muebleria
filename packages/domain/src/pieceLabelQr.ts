/**
 * Compact QR payload for workshop piece labels (#141).
 * Offline-friendly JSON (not a URL) for scanner apps / future deep links.
 */

export type PieceLabelQrFields = {
  readonly projectId: string;
  readonly moduleCode: string;
  readonly partCode?: string;
  readonly description: string;
  readonly materialCode: string;
  readonly lengthMm: number;
  readonly widthMm: number;
  /** Piece quantity (v2) — how many identical pieces share this label. */
  readonly quantity?: number;
  /** Edge-banded sides shorthand, e.g. "L1+W2" (v2). Empty = none. */
  readonly edgeSides?: string;
  /** Assigned edge band code (v2) — which band to load in the machine. */
  readonly edgeCode?: string;
  /** Production order revision, e.g. "2" (v2) — regenerations differ. */
  readonly revision?: string;
};

/** Versioned payload string for QR encoding. */
export function pieceLabelQrPayload(fields: PieceLabelQrFields): string {
  return JSON.stringify({
    v: 2,
    projectId: fields.projectId,
    module: fields.moduleCode,
    part: fields.partCode ?? '',
    desc: fields.description.slice(0, 80),
    material: fields.materialCode,
    L: fields.lengthMm,
    W: fields.widthMm,
    qty: fields.quantity ?? 1,
    edges: fields.edgeSides ?? '',
    edge: fields.edgeCode ?? '',
    rev: fields.revision ?? '',
  });
}
