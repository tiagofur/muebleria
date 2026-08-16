/**
 * Compact QR payload for workshop piece labels (#141).
 * Offline-friendly JSON (not a URL) for scanner apps / future deep links.
 *
 * F091 deep links: `pieceLabelQrPayloadUrl` wraps this same JSON v2 in a URL
 * (`muebles://scan#<json>` by default, or `https://<host>/scan#<json>` when
 * the workshop registers a domain for universal/app links). Both forms parse
 * forever: plain JSON stays the default for printed labels (smaller QR), and
 * pre-F091 QRs never require reprinting — never change the JSON shape.
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

/** Deep-link scheme registered by the mobile app (F091). */
export const PIECE_LABEL_QR_SCHEME = 'muebles';

/**
 * URL variant of the payload (F091 / D7): wraps the SAME JSON v2 in a deep
 * link. Default `muebles://scan#<json>` (custom scheme, no domain setup);
 * pass `host` to emit `https://<host>/scan#<json>` once universal/app links
 * are configured. The JSON lives in the fragment (#) so it never hits a
 * server log if the URL is ever opened in a browser.
 */
export function pieceLabelQrPayloadUrl(
  fields: PieceLabelQrFields,
  opts: { readonly host?: string } = {},
): string {
  const base = opts.host
    ? `https://${opts.host.replace(/^https?:\/\//, '').replace(/\/+$/, '')}/scan`
    : `${PIECE_LABEL_QR_SCHEME}://scan`;
  return `${base}#${encodeURIComponent(pieceLabelQrPayload(fields))}`;
}

const QR_URL_RE = /^(?:https?:\/\/|muebles:\/\/)\S+$/i;

/**
 * Extract the wrapped JSON payload from a deep-link URL, or null when the
 * text is not a QR URL form. Used by parsePieceLabelScan and by the mobile
 * app's link handler (an incoming link navigates + scans in one step).
 */
export function unwrapPieceLabelQrUrl(text: string): string | null {
  const trimmed = text.trim();
  if (!QR_URL_RE.test(trimmed)) return null;
  const hashIdx = trimmed.indexOf('#');
  const fragment = hashIdx >= 0 ? trimmed.slice(hashIdx + 1) : '';
  if (!fragment) return null;
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
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
  // Deep-link form first (F091): unwrap the URL, then parse the JSON inside.
  const unwrapped = unwrapPieceLabelQrUrl(trimmed);
  const jsonText = unwrapped ?? trimmed;
  if (!jsonText.startsWith('{')) {
    return { kind: 'plainCode', code: trimmed };
  }
  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(jsonText) as unknown;
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
