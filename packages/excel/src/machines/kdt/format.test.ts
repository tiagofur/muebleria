import { describe, expect, it } from 'vitest';
import type { KdtPanelDocument } from './document';
import { formatKdtNumber, serializeKdtPanelDocument } from './format';

function minimalDocument(): KdtPanelDocument {
  return {
    panel: {
      lengthMm: 587,
      widthMm: 540,
      thicknessMm: 16.5,
      name: 'Base Superior',
      alignmentEdge: 'x0',
    },
    operations: [
      { kind: 'vertical-hole', x1Mm: 200, y1Mm: 37, diameterMm: 8, depthMm: 12 },
      { kind: 'horizontal-hole', quadrant: 2, x1Mm: 0, y1Mm: 37, z1Mm: 8.24, diameterMm: 5, depthMm: 36 },
    ],
    provenance: {
      adapterId: 'granete-kdt',
      adapterVersion: '0.2.0',
      profileId: 'kdt-flexdrill-1200',
      profileRevision: 'r2',
    },
  };
}

describe('formatKdtNumber (forma observada del corpus)', () => {
  it('enteros sin decimales y decimales sin ceros finales', () => {
    expect(formatKdtNumber(600)).toBe('600');
    expect(formatKdtNumber(16.5)).toBe('16.5');
    expect(formatKdtNumber(8.24)).toBe('8.24');
    expect(formatKdtNumber(0)).toBe('0');
    expect(formatKdtNumber(-4)).toBe('-4');
  });

  it('falla cerrada ante valores no representables con 2 decimales', () => {
    expect(() => formatKdtNumber(0.005)).toThrow(/representable/);
    expect(() => formatKdtNumber(Number.NaN)).toThrow(/finito/);
    expect(() => formatKdtNumber(Number.POSITIVE_INFINITY)).toThrow(/finito/);
  });
});

describe('serializeKdtPanelDocument (bytes fieles al corpus)', () => {
  it('estructura byte-exacta: CRLF, sin declaración XML, indentation de 2 y AUTHOR final', () => {
    const xml = new TextDecoder().decode(serializeKdtPanelDocument(minimalDocument()));
    const lines = xml.split('\r\n');
    expect(xml.includes('\n') && !xml.includes('\r\n')).toBe(false);
    expect(lines[0]).toBe('<KDTPanelFormat>');
    expect(lines[1]).toBe('  <PANEL>');
    expect(lines[2]).toBe('    <PanelLength>587</PanelLength>');
    expect(lines[3]).toBe('    <PanelWidth>540</PanelWidth>');
    expect(lines[4]).toBe('    <PanelThickness>16.5</PanelThickness>');
    expect(lines[5]).toBe('    <PanelName>Base Superior</PanelName>');
    expect(lines).toContain('        <Banding>2</Banding>');
    expect(lines).toContain('        <Description>AlignmentFace</Description>');
    expect(lines).toContain('        <BandingColor>rgb(255,0,0)</BandingColor>');
    expect(lines).toContain('    <TypeNo>1</TypeNo>');
    expect(lines).toContain('    <TypeName>Vertical Hole</TypeName>');
    expect(lines).toContain('    <Quadrant>2</Quadrant>');
    expect(lines).toContain('    <Z1>8.24</Z1>');
    expect(lines).toContain('    <IntervalZ>0</IntervalZ>');
    expect(lines[lines.length - 1]).toBe('');
    expect(lines[lines.length - 2]).toBe('-->');
    expect(lines.filter((line) => line === '<KDTPanelFormat>')).toHaveLength(1);
    expect(xml.startsWith('<?xml')).toBe(false);
    // Orden del contorno observado: (L,W) → (L,0) → (0,0 con B2) → (0,W).
    const outlineOrder = lines
      .filter((line) => line.trim().startsWith('<X1>'))
      .map((line) => line.trim());
    expect(outlineOrder.slice(0, 4)).toEqual(['<X1>587</X1>', '<X1>587</X1>', '<X1>0</X1>', '<X1>0</X1>']);
  });

  it('alignmentEdge yWidth mueve el Banding=2 al canto Y=PanelWidth', () => {
    const doc = minimalDocument();
    const xml = new TextDecoder().decode(
      serializeKdtPanelDocument({ ...doc, panel: { ...doc.panel, alignmentEdge: 'yWidth' } }),
    );
    const vertices = xml.split('<Vertex>');
    const alignment = vertices.find((block) => block.includes('AlignmentFace'))!;
    expect(alignment).toContain('<X1>0</X1>');
    expect(alignment).toContain('<Y1>540</Y1>');
  });

  it('escapea PanelName sin romper el gramática XML', () => {
    const doc = minimalDocument();
    const xml = new TextDecoder().decode(
      serializeKdtPanelDocument({ ...doc, panel: { ...doc.panel, name: 'Panel <Test> & Compañía' } }),
    );
    expect(xml).toContain('<PanelName>Panel &lt;Test&gt; &amp; Compañía</PanelName>');
  });
});
