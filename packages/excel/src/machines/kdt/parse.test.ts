import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseKdtPanelBytes,
  KdtParseError,
  type KdtParsedStructuralOperation,
} from './parse';

const SAMPLES_URL = new URL(
  '../../../../../docs/machines/client-b/samples/',
  import.meta.url,
);

function readSample(name: string): Uint8Array {
  return readFileSync(new URL(name, SAMPLES_URL));
}

describe('parseKdtPanelBytes contra muestras reales (#903 corpus)', () => {
  it('BA11025A: panel 587×540×16.5, contorno con AlignmentFace en (0,540), Q2 X1=0 y Q1 X1=587', () => {
    const doc = parseKdtPanelBytes(readSample('BA11025A.xml'));
    expect(doc.panel.lengthMm).toBe(587);
    expect(doc.panel.widthMm).toBe(540);
    expect(doc.panel.thicknessMm).toBe(16.5);
    expect(doc.panel.name).toBe('Base Superior');
    expect(doc.panel.outline).toHaveLength(4);
    const alignment = doc.panel.outline.filter((vertex) => vertex.banding === 2);
    expect(alignment).toHaveLength(1);
    expect(alignment[0]!.x1Mm).toBe(0);
    expect(alignment[0]!.y1Mm).toBe(540);
    expect(alignment[0]!.description).toBe('AlignmentFace');
    expect(doc.operations.length).toBeGreaterThan(0);
    // Verificación §7 del spec sobre la muestra real.
    const horizontal = doc.operations.filter((op) => op.kind === 'horizontal-hole');
    expect(
      horizontal.some((op) => op.fields.Quadrant === 2 && op.fields.X1 === 0),
    ).toBe(true);
    expect(
      horizontal.some((op) => op.fields.Quadrant === 1 && op.fields.X1 === 587),
    ).toBe(true);
  });

  it('EN72268A: el único Circle (TypeNo 5) del corpus se parsea estructural', () => {
    const doc = parseKdtPanelBytes(readSample('EN72268A.xml'));
    const circles = doc.operations.filter(
      (op): op is KdtParsedStructuralOperation => op.kind === 'structural' && op.typeNo === 5,
    );
    expect(circles).toHaveLength(1);
    expect(circles[0]!.fields.Radius).toBe(85);
    expect(circles[0]!.fields.Depth).toBe(16.6);
    expect(circles[0]!.typeName).toBe('Circle');
  });

  it('rechaza transportes que el perfil no declara: BOM y line endings LF', () => {
    const base = new TextDecoder().decode(readSample('BA11025A.xml'));
    expect(() => parseKdtPanelBytes(new TextEncoder().encode(`\uFEFF${base}`))).toThrow(KdtParseError);
    expect(() => parseKdtPanelBytes(new TextEncoder().encode(base.replace(/\r\n/g, '\n')))).toThrow(
      KdtParseError,
    );
  });
});
