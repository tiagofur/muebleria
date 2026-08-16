/**
 * Compact QR payload for workshop piece labels and module/package labels (#141 / Dispatch).
 * Offline-friendly JSON (not a URL) for scanner apps / future deep links.
 *
 * F091 deep links: `pieceLabelQrPayloadUrl` / `moduleLabelQrPayloadUrl` wraps this same JSON v2 in a URL
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

export type ModuleLabelQrFields = {
  readonly projectId: string;
  readonly itemId: string;
  readonly factoryCode: string;
  readonly moduleCode: string;
  readonly moduleName: string;
  readonly packageIndex?: number;
  readonly totalPackages?: number;
  readonly unitIndex?: number;
  readonly unitQuantity?: number;
  readonly widthMm?: number | null;
  readonly heightMm?: number | null;
  readonly depthMm?: number | null;
  readonly revision?: string;
};

/** Versioned payload string for piece QR encoding. */
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

/** Versioned payload string for module/package QR encoding. */
export function moduleLabelQrPayload(fields: ModuleLabelQrFields): string {
  return JSON.stringify({
    v: 2,
    k: 'mod',
    projectId: fields.projectId,
    itemId: fields.itemId,
    fc: fields.factoryCode,
    mod: fields.moduleCode,
    name: fields.moduleName.slice(0, 60),
    bulto: fields.packageIndex ?? 1,
    tot: fields.totalPackages ?? 1,
    uIdx: fields.unitIndex ?? 1,
    uQty: fields.unitQuantity ?? 1,
    dims: [fields.widthMm ?? 0, fields.heightMm ?? 0, fields.depthMm ?? 0],
    rev: fields.revision ?? '',
  });
}

/** Deep-link scheme registered by the mobile app (F091). */
export const PIECE_LABEL_QR_SCHEME = 'muebles';

/**
 * URL variant of the piece payload (F091 / D7).
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

/**
 * URL variant of the module/package payload.
 */
export function moduleLabelQrPayloadUrl(
  fields: ModuleLabelQrFields,
  opts: { readonly host?: string } = {},
): string {
  const base = opts.host
    ? `https://${opts.host.replace(/^https?:\/\//, '').replace(/\/+$/, '')}/scan`
    : `${PIECE_LABEL_QR_SCHEME}://scan`;
  return `${base}#${encodeURIComponent(moduleLabelQrPayload(fields))}`;
}

const QR_URL_RE = /^(?:https?:\/\/|muebles:\/\/)\S+$/i;

/**
 * Extract the wrapped JSON payload from a deep-link URL, or null when the
 * text is not a QR URL form. Used by parsePieceLabelScan and by the mobile
 * app's link handler.
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
 * Parsed scan input for the shop floor (F089 / #240 + Module Scanning).
 * - `payload`: structured piece label QR (v2 current, v1 legacy).
 * - `modulePayload`: structured module / package label QR.
 * - `plainCode`: raw text — factory code (`GAB-01-L2`), module code, or piece ref.
 */
export type ParsedPieceLabelScan =
  | { readonly kind: 'payload'; readonly version: 1 | 2; readonly fields: PieceLabelQrFields; readonly target?: 'piece' }
  | { readonly kind: 'modulePayload'; readonly version: 2; readonly fields: ModuleLabelQrFields; readonly target: 'module' }
  | { readonly kind: 'plainCode'; readonly code: string };

function scanString(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

function scanNumber(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Parse a scanned string into a piece/module label payload or plain code.
 * Returns null only for blank input, or JSON that parses but is not a
 * label payload. Broken JSON falls back to plainCode.
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

  // 1. Check for Module / Package Label QR (k: 'mod' or fc + itemId)
  if (parsed.k === 'mod' || (parsed.fc && parsed.itemId)) {
    const factoryCode = scanString(parsed.fc);
    const moduleCode = scanString(parsed.mod) || factoryCode;
    const itemId = scanString(parsed.itemId || parsed.item);
    if (!moduleCode && !factoryCode) return null;

    const dims = Array.isArray(parsed.dims) ? parsed.dims : [];
    return {
      kind: 'modulePayload',
      version: 2,
      target: 'module',
      fields: {
        projectId: scanString(parsed.projectId || parsed.proj),
        itemId,
        factoryCode: factoryCode || moduleCode,
        moduleCode,
        moduleName: scanString(parsed.name || parsed.moduleName),
        packageIndex: scanNumber(parsed.bulto || parsed.idx) || undefined,
        totalPackages: scanNumber(parsed.tot || parsed.total) || undefined,
        unitIndex: scanNumber(parsed.uIdx) || undefined,
        unitQuantity: scanNumber(parsed.uQty) || undefined,
        widthMm: dims[0] ? scanNumber(dims[0]) : null,
        heightMm: dims[1] ? scanNumber(dims[1]) : null,
        depthMm: dims[2] ? scanNumber(dims[2]) : null,
        revision: scanString(parsed.rev) || undefined,
      },
    };
  }

  // 2. Check for Piece Label QR
  const moduleCode = scanString(parsed.module);
  if (!moduleCode) return null;
  const version = parsed.v === 2 ? 2 : 1;
  return {
    kind: 'payload',
    version,
    target: 'piece',
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
