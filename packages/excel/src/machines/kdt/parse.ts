/**
 * KDTPanelFormat reader (#1005 K2) — deliberately independent of the writer
 * (format.ts): it re-derives its own view from raw bytes and shares no
 * helpers with it, so round-trip tests prove real invertibility instead of
 * comparing a structure against itself (BHX02/BHX03 pattern).
 *
 * Covers the full OBSERVED grammar of the 417-sample corpus
 * (docs/machines/kdt-xml-format.md):
 * - TypeNo 1 (Vertical Hole) and 2 (Horizontal Hole) fully typed;
 * - TypeNo 3/5/6/7 parsed structurally (real samples carry them);
 * - TypeNo values outside the census (e.g. the never-observed 4) are
 *   surfaced as `unknown` operations — recorded, never dropped silently.
 *
 * Encoding: UTF-8 without BOM, CRLF line endings. A missing/extra BOM or a
 * lone-LF stream is a parse error — the reader validates the transport the
 * profile declares instead of tolerating anything.
 */

import type {} from './document';

export class KdtParseError extends Error {
  constructor(message: string) {
    super(`kdt parse: ${message}`);
    this.name = 'KdtParseError';
  }
}

export interface KdtParsedVertex {
  readonly x1Mm: number;
  readonly y1Mm: number;
  readonly bulge: number;
  readonly banding: number;
  readonly description?: string;
}

export interface KdtParsedPanel {
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly thicknessMm: number;
  readonly name: string;
  readonly outline: readonly KdtParsedVertex[];
}

export interface KdtParsedTypedOperation {
  readonly kind: 'vertical-hole' | 'horizontal-hole';
  readonly typeNo: 1 | 2;
  readonly fields: Readonly<Record<string, number>>;
}

export interface KdtParsedStructuralOperation {
  readonly kind: 'structural';
  readonly typeNo: 3 | 5 | 6 | 7;
  readonly typeName: string;
  readonly fields: Readonly<Record<string, number>>;
}

export interface KdtParsedUnknownOperation {
  readonly kind: 'unknown';
  readonly typeNo: number;
  readonly fields: Readonly<Record<string, number>>;
}

export type KdtParsedOperation =
  | KdtParsedTypedOperation
  | KdtParsedStructuralOperation
  | KdtParsedUnknownOperation;

export interface KdtParsedDocument {
  readonly panel: KdtParsedPanel;
  readonly operations: readonly KdtParsedOperation[];
}

function decode(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new KdtParseError('BOM UTF-8 no esperada (el corpus observado va sin BOM)');
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (text.includes('\n') && !text.includes('\r\n')) {
    throw new KdtParseError('line endings LF: el formato declara CRLF');
  }
  return text;
}

function blockOf(text: string, tag: string): string {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const start = text.indexOf(open);
  const end = text.lastIndexOf(close);
  if (start === -1 || end === -1 || end < start) {
    throw new KdtParseError(`bloque <${tag}> ausente o mal cerrado`);
  }
  return text.slice(start + open.length, end);
}

/** Simple <Tag>value</Tag> pairs inside a block — machine-generated grammar. */
function scalarFields(block: string): Map<string, string> {
  const fields = new Map<string, string>();
  const pattern = /<([A-Za-z][A-Za-z0-9]*)>([^<>]*)<\/\1>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(block)) !== null) {
    const name = match[1];
    const value = match[2];
    if (name === undefined || value === undefined) continue;
    if (!fields.has(name)) fields.set(name, value);
  }
  return fields;
}

function numberField(fields: Map<string, string>, name: string): number {
  const raw = fields.get(name);
  if (raw === undefined) throw new KdtParseError(`campo <${name}> ausente`);
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new KdtParseError(`campo <${name}>=${raw} no numérico`);
  return value;
}

function parseVertex(block: string): KdtParsedVertex {
  const fields = scalarFields(block);
  const vertex: { x1Mm: number; y1Mm: number; bulge: number; banding: number; description?: string } = {
    x1Mm: numberField(fields, 'X1'),
    y1Mm: numberField(fields, 'Y1'),
    bulge: numberField(fields, 'Bulge'),
    banding: numberField(fields, 'Banding'),
  };
  const description = fields.get('Description');
  if (description !== undefined) {
    return { ...vertex, description };
  }
  return vertex;
}

const STRUCTURAL_TYPE_NOS = new Set([3, 5, 6, 7]);
const KNOWN_FIELD_NAMES = new Set([
  'TypeNo',
  'TypeName',
  'Depth',
  'X1',
  'Y1',
  'Z1',
  'Diameter',
  'HoleNo',
  'IntervalX',
  'IntervalY',
  'IntervalZ',
  'Quadrant',
  'PlaneID',
  'BeginX',
  'BeginY',
  'EndX',
  'EndY',
  'Correction',
  'Width',
  'Radius',
  'Length',
  'Empty',
  'Close',
  'Enable',
  'CenterX',
  'CenterY',
]);

function parseOperation(block: string): KdtParsedOperation {
  const fields = scalarFields(block);
  const typeNo = numberField(fields, 'TypeNo');
  const numeric: Record<string, number> = {};
  for (const [name, raw] of fields) {
    if (name === 'TypeName') continue;
    if (!KNOWN_FIELD_NAMES.has(name)) {
      throw new KdtParseError(`campo <${name}> no pertenece al léxico observado`);
    }
    numeric[name] = Number(raw);
    if (!Number.isFinite(numeric[name])) {
      throw new KdtParseError(`campo <${name}>=${raw} no numérico`);
    }
  }
  if (typeNo === 1) {
    return { kind: 'vertical-hole', typeNo: 1, fields: numeric };
  }
  if (typeNo === 2) {
    return { kind: 'horizontal-hole', typeNo: 2, fields: numeric };
  }
  if (STRUCTURAL_TYPE_NOS.has(typeNo)) {
    return {
      kind: 'structural',
      typeNo: typeNo as 3 | 5 | 6 | 7,
      typeName: fields.get('TypeName') ?? '',
      fields: numeric,
    };
  }
  return { kind: 'unknown', typeNo, fields: numeric };
}

function splitBlocks(text: string, tag: string): readonly string[] {
  const blocks: string[] = [];
  const pattern = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const inner = match[1];
    if (inner === undefined) continue;
    blocks.push(inner);
  }
  return blocks;
}

/** Parses raw KDTPanelFormat bytes into the reader's own document view. */
export function parseKdtPanelBytes(bytes: Uint8Array): KdtParsedDocument {
  const text = decode(bytes);
  const root = blockOf(text, 'KDTPanelFormat');

  const panelBlocks = splitBlocks(root, 'PANEL');
  if (panelBlocks.length !== 1 || panelBlocks[0] === undefined) {
    throw new KdtParseError(`se esperaba exactamente un <PANEL>, hubo ${panelBlocks.length}`);
  }
  const panelBlock = panelBlocks[0];
  const panelFields = scalarFields(panelBlock);
  const outlineText = blockOf(panelBlock, 'PanelOutline');
  const vertices = splitBlocks(outlineText, 'Vertex').map(parseVertex);
  if (vertices.length < 4) {
    throw new KdtParseError(`contorno con ${vertices.length} vértices (mínimo 4)`);
  }
  const alignmentCount = vertices.filter((vertex) => vertex.banding === 2).length;
  if (alignmentCount > 1) {
    throw new KdtParseError(`${alignmentCount} vértices con Banding=2 (máximo uno)`);
  }
  const panel: KdtParsedPanel = {
    lengthMm: numberField(panelFields, 'PanelLength'),
    widthMm: numberField(panelFields, 'PanelWidth'),
    thicknessMm: numberField(panelFields, 'PanelThickness'),
    name: panelFields.get('PanelName') ?? '',
    outline: vertices,
  };

  const operations = splitBlocks(root, 'CAD').map(parseOperation);
  return { panel, operations };
}

/**
 * Typed accessor for parsed TypeNo 1/2 operations — the shape the
 * round-trip inversion consumes. Structural/unknown operations must be
 * handled by the caller explicitly.
 */
export function parsedOperationFields(operation: KdtParsedOperation): Readonly<Record<string, number>> {
  return operation.fields;
}
