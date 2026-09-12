/**
 * Anti-leak guard (PR 6 / spec #4148): commercial quote export excludes ambient
 * materials.
 *
 * Since #642/3 the client-facing cotización is rendered exclusively from the
 * frozen QuoteCommercialSnapshot of one exact revision — ambient materials
 * never enter snapshot lines/units, and the renderers invent no strings. The
 * guard keeps proving the final artifact: it unzips the exported xlsx and
 * asserts no ambient identifier (id/code/name) appears in the workbook's
 * shared strings (where xlsx stores every string cell).
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { buildCommercialQuoteExport } from './exportCommercialQuote';
import { exactQ2Fixture } from './exports/exactCommercialQuoteFixtures';

const AMBIENT_FLOOR = {
  id: 'amb-floor-ceramic',
  code: 'AMB-FLOOR-01',
  name: 'Porcelanato piso cerámico',
};
const AMBIENT_WALL = {
  id: 'amb-wall-porcelain',
  code: 'AMB-WALL-01',
  name: 'Porcelanato muro',
};
const AMBIENT_TOKENS = [
  AMBIENT_FLOOR.id,
  AMBIENT_WALL.id,
  AMBIENT_FLOOR.code,
  AMBIENT_WALL.code,
  AMBIENT_FLOOR.name,
  AMBIENT_WALL.name,
];

/** Unzip the xlsx and return the shared-strings document (all string cells). */
async function sharedStringsXml(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const file = zip.file('xl/sharedStrings.xml');
  return file ? await file.async('string') : '';
}

describe('anti-leak guard: exact commercial export excludes ambient materials', () => {
  it('exported workbook shared strings contain no ambient identifier', async () => {
    // The exact-revision export only sees the frozen snapshot — an obra whose
    // kitchen references ambient materials exports the same frozen lines.
    const result = await buildCommercialQuoteExport(exactQ2Fixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const xml = await sharedStringsXml(result.bytes);
    for (const token of AMBIENT_TOKENS) {
      expect(xml).not.toContain(token);
    }
  });
});
