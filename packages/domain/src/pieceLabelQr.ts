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

/**
 * Parsed scan input for the shop floor (F089 / #240).
 * - `payload`: structured label QR (v2 current, v1 legacy labels still in bins).
 * - `plainCode`: raw text — factory code (`GAB-01-L2`), module code, or piece ref.
 */
export type ParsedPieceLabelScan =
  | { readonly kind: 'payload'; readonly version: 1 | 2; readonly fields: PieceLabelQrFields }
  | { readonly kind: 'plainCode'; readonly code: string };

function scanString(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

function scanNumber(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Parse a scanned string into a label payload or plain code.
 * Returns null only for blank input, or JSON that parses but is not a
 * label payload (missing module). Broken JSON falls back to plainCode —
 * the scanner may still have read a bar code with stray characters.
 */
export function parsePieceLabelScan(text: string): ParsedPieceLabelScan | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith('{')) {
    return { kind: 'plainCode', code: trimmed };
  }
  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(trimmed) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { kind: 'plainCode', code: trimmed };
    }
    parsed = value as Record<string, unknown>;
  } catch {
    return { kind: 'plainCode', code: trimmed };
  }
  const moduleCode = scanString(parsed.module);
  if (!moduleCode) return null;
  const version = parsed.v === 2 ? 2 : 1;
  return {
    kind: 'payload',
    version,
    fields: {
      projectId: scanString(parsed.projectId),
      moduleCode,
      partCode: scanString(parsed.part) || undefined,
      description: scanString(parsed.desc),
      materialCode: scanString(parsed.material),
      lengthMm: scanNumber(parsed.L),
      widthMm: scanNumber(parsed.W),
      quantity: version === 2 ? Math.max(1, scanNumber(parsed.qty) || 1) : undefined,
      edgeSides: version === 2 ? scanString(parsed.edges) || undefined : undefined,
      edgeCode: version === 2 ? scanString(parsed.edge) || undefined : undefined,
      revision: version === 2 ? scanString(parsed.rev) || undefined : undefined,
    },
  };
}
