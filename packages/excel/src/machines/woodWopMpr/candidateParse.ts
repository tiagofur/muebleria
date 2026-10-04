/**
 * woodWOP MPR CANDIDATE dialect reader (#879 B2-prep).
 *
 * Deliberately independent of the writer (candidateFormat.ts) — shares no
 * helpers, so round-trip tests prove real invertibility (BHX02 pattern).
 * Parses exactly the candidate subset: [H head, <100 \Werkstck\,
 * <101 \Comment\, <102 \BohrVert\, <103 \BohrHoriz\, `!` terminator.
 * Anything outside the subset is a parse error — the candidate never
 * guesses at undocumented grammar.
 */

import type {
  MprCandidateDocument,
  MprCandidateDrillDirection,
} from './candidateDocument';

export class MprCandidateParseError extends Error {
  constructor(message: string) {
    super(`mpr candidate parse: ${message}`);
    this.name = 'MprCandidateParseError';
  }
}

export interface MprCandidateParsedOperation {
  readonly macro: 'bohr-vert' | 'bohr-horiz';
  readonly fields: Readonly<Record<string, string>>;
}

export interface MprCandidateParsedDocument {
  readonly piece: {
    readonly lengthMm: number;
    readonly widthMm: number;
    readonly thicknessMm: number;
  };
  readonly comments: readonly string[];
  readonly operations: readonly MprCandidateParsedOperation[];
}

function decode(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new MprCandidateParseError('BOM UTF-8 no esperada');
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (text.includes('\n') && !text.includes('\r\n')) {
    throw new MprCandidateParseError('line endings LF: el candidato declara CRLF');
  }
  return text;
}

function numericField(fields: Map<string, string>, name: string, context: string): number {
  const raw = fields.get(name);
  if (raw === undefined) throw new MprCandidateParseError(`<${context}>: falta ${name}`);
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new MprCandidateParseError(`<${context}>: ${name}="${raw}" no es un literal numérico (el candidato no emite expresiones)`);
  }
  return value;
}

const KNOWN_MACROS = new Set(['100', '101', '102', '103']);

/** Splits the file into `<n \Name\` blocks; rejects anything outside the subset. */
function splitProcessBlocks(text: string): { id: string; body: string }[] {
  const blocks: { id: string; body: string }[] = [];
  const pattern = /<(\d+) \\([^\\]*)\\\r?\n([\s\S]*?)(?=<\d+ \\|!|$)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const id = match[1];
    if (id === undefined || !KNOWN_MACROS.has(id)) {
      throw new MprCandidateParseError(`macro <${String(id)}> fuera del subconjunto candidato`);
    }
    blocks.push({ id, body: match[3] ?? '' });
  }
  if (blocks.length === 0) {
    throw new MprCandidateParseError('sin bloques de proceso <100');
  }
  return blocks;
}

function fieldsOf(body: string): Map<string, string> {
  const fields = new Map<string, string>();
  const pattern = /([A-Z_][A-Z0-9_]*)="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    const name = match[1];
    const value = match[2];
    if (name === undefined || value === undefined || fields.has(name)) continue;
    fields.set(name, value);
  }
  // KM rows repeat by design (multiple comments).
  return fields;
}

export function parseMprCandidateBytes(bytes: Uint8Array): MprCandidateParsedDocument {
  const text = decode(bytes);
  if (!text.startsWith('[H\r\n')) {
    throw new MprCandidateParseError('el archivo no abre con el data head [H');
  }
  if (!text.endsWith('!\r\n')) {
    throw new MprCandidateParseError('el archivo no termina con el descriptor !');
  }
  const headerFields = fieldsOf(text.slice(0, text.indexOf('<100')));
  const inch = headerFields.get('INCH');
  if (inch !== '0') {
    throw new MprCandidateParseError(`INCH="${String(inch)}": el subconjunto candidato es métrico`);
  }

  const piece = { lengthMm: 0, widthMm: 0, thicknessMm: 0 };
  const comments: string[] = [];
  const operations: MprCandidateParsedOperation[] = [];
  for (const block of splitProcessBlocks(text)) {
    if (block.id === '100') {
      const fields = fieldsOf(block.body);
      piece.lengthMm = numericField(fields, 'LA', '100');
      piece.widthMm = numericField(fields, 'BR', '100');
      piece.thicknessMm = numericField(fields, 'DI', '100');
    } else if (block.id === '101') {
      for (const km of block.body.matchAll(/KM="([^"]*)"/g)) {
        comments.push(km[1] ?? '');
      }
    } else {
      const fields = fieldsOf(block.body);
      const macro = block.id === '102' ? 'bohr-vert' : 'bohr-horiz';
      const drillMode = fields.get('BM');
      if (macro === 'bohr-vert') {
        // Doc §9.2.1: ciclos documentados LS/SS/LSL/SSS/LSU/LSLU (o
        // subprogramas NC) — el candidato sólo emite y acepta SS.
        if (drillMode !== 'SS') {
          throw new MprCandidateParseError(
            `<102>: BM="${String(drillMode)}" fuera del subconjunto candidato`,
          );
        }
      } else {
        const direction = drillMode;
        if (direction !== 'XP' && direction !== 'XM' && direction !== 'YP' && direction !== 'YM') {
          throw new MprCandidateParseError(`BM="${String(direction)}" fuera del subconjunto candidato`);
        }
        void (direction satisfies MprCandidateDrillDirection);
      }
      operations.push({ macro, fields: Object.fromEntries(fields) });
    }
  }
  if (piece.lengthMm <= 0 || piece.widthMm <= 0 || piece.thicknessMm <= 0) {
    throw new MprCandidateParseError('bloque <100 \\Werkstck\\ ausente o incompleto');
  }
  return { piece, comments, operations };
}
