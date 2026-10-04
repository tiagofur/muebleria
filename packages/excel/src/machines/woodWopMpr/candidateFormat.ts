/**
 * woodWOP MPR CANDIDATE dialect writer (#879 B2-prep).
 *
 * Grammar per HOMAG 9-080-42-7190-D00 (docs/machines/bhx050/woodwop-mpr/):
 * fixed block sequence — `[H` data head, `<100 \Werkstck\`, `<101
 * \Comment\`, process macros `<102 \BohrVert\` / `<103 \BohrHoriz\`,
 * terminated by `!`. Parameter rows carry quoted values; the candidate
 * emits literal numbers only (no expression-parser constructs).
 *
 * The exact required-field set of the client's `[H` head and the byte
 * encoding/EOL of their installation are OPEN QUESTIONS (see the research
 * pack README); the candidate emits the documented conservative form and
 * exists to be DIFFED against the real b1-kit samples — not to claim
 * receiver compatibility.
 */

import type { MprCandidateDocument } from './candidateDocument';
import { assertExactTwoDecimals, formatKdtNumber } from '../kdt/format';

const CRLF = '\r\n';

/** Observed candidate identity for the <101 \Comment\ rows. */
export const MPR_CANDIDATE_GENERATOR = 'granete-mpr-candidate';
export const MPR_CANDIDATE_DIALECT = 'woodwop-mpr-4.x-public-reference';

function bohrVertLines(operation: Extract<MprCandidateDocument['operations'][number], { kind: 'bohr-vert' }>): string[] {
  return [
    '<102 \\BohrVert\\',
    `XA="${formatKdtNumber(operation.xaMm)}"`,
    `YA="${formatKdtNumber(operation.yaMm)}"`,
    'BM="SS"',
    `TI="${formatKdtNumber(operation.depthMm)}"`,
    `DU="${formatKdtNumber(operation.diameterMm)}"`,
    'AN="1"',
  ];
}

function bohrHorizLines(operation: Extract<MprCandidateDocument['operations'][number], { kind: 'bohr-horiz' }>): string[] {
  return [
    '<103 \\BohrHoriz\\',
    `XA="${formatKdtNumber(operation.xaMm)}"`,
    `YA="${formatKdtNumber(operation.yaMm)}"`,
    `ZA="${formatKdtNumber(operation.zaMm)}"`,
    `BM="${operation.direction}"`,
    `TI="${formatKdtNumber(operation.depthMm)}"`,
    `DU="${formatKdtNumber(operation.diameterMm)}"`,
    'AN="1"',
  ];
}

export function serializeMprCandidateDocument(document: MprCandidateDocument): Uint8Array {
  const { piece } = document;
  for (const dimension of [piece.lengthMm, piece.widthMm, piece.thicknessMm]) {
    assertExactTwoDecimals(dimension, 'pieza');
  }
  const lines: string[] = [
    '[H',
    `VERSION="4.0"`,
    `INCH="0"`,
    `VIEW="NOMIRROR"`,
    `_BSX=${piece.lengthMm.toFixed(6)}`,
    `_BSY=${piece.widthMm.toFixed(6)}`,
    `_BSZ=${piece.thicknessMm.toFixed(6)}`,
    '<100 \\Werkstck\\',
    `LA="${formatKdtNumber(piece.lengthMm)}"`,
    `BR="${formatKdtNumber(piece.widthMm)}"`,
    `DI="${formatKdtNumber(piece.thicknessMm)}"`,
    '<101 \\Comment\\',
    `KM="${document.provenance.generator} ${document.provenance.dialect}"`,
    `KM="pieza ${document.provenance.pieceCode} cara ${document.provenance.machiningFace}: ${piece.name}"`,
  ];
  for (const operation of document.operations) {
    lines.push(
      ...(operation.kind === 'bohr-vert' ? bohrVertLines(operation) : bohrHorizLines(operation)),
    );
  }
  lines.push('!');
  return new TextEncoder().encode(lines.join(CRLF) + CRLF);
}
