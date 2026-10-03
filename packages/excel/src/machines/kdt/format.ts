/**
 * KDTPanelFormat XML writer (#1005 K2).
 *
 * Emits ONE program per physical panel, byte-format faithful to the studied
 * corpus of 417 real production files (docs/machines/kdt-xml-format.md):
 * UTF-8 without BOM, CRLF line endings, two-space indentation, no XML
 * declaration (the observed Promob form), numeric fields with at most two
 * decimals and no trailing zeros, and the trailing AUTHOR comment the
 * machine ignores.
 *
 * Coordinates: origin (0,0) at the bottom-left of the TOP-FACE view; X along
 * PanelLength, Y along PanelWidth. The outline vertex order mirrors the
 * corpus: (L,W) → (L,0) → (0,0) → (0,W), where each <Vertex> describes the
 * edge towards the NEXT vertex (closing back to the first). Granete policy
 * marks the X=0 edge (Quadrant 2) as the AlignmentFace — one per file, the
 * deterministic machine-loading reference until field evidence (#1005 K4)
 * refines it.
 *
 * Fail-closed: every numeric field must be exactly representable within two
 * decimals — finer values throw instead of being silently rounded.
 */

import type { KdtAlignmentEdge, KdtPanelDocument } from './document';

const CRLF = '\r\n';

export const KDT_AUTHOR_COMMENT_PREFIX = '<!--AUTHOR: Granete (muebles)';
export const KDT_VERTICAL_HOLE_TYPE_NAME = 'Vertical Hole';
export const KDT_HORIZONTAL_HOLE_TYPE_NAME = 'Horizontal Hole';

/**
 * Throws for values the two-decimal XML representation cannot carry exactly.
 * The test is the FP round-trip: rounding to two decimals must return the
 * same number — 0.005-style values would silently shift a drilling
 * position, so they are refused instead of rounded.
 */
export function assertExactTwoDecimals(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`kdt: campo ${field} no es un número finito (${value})`);
  }
  if (Math.round(value * 100) / 100 !== value) {
    throw new Error(
      `kdt: campo ${field}=${value} no es representable exacto con 2 decimales; se rechaza en vez de redondear`,
    );
  }
}

/** Observed corpus form: integers without decimals, otherwise up to 2 decimals. */
export function formatKdtNumber(value: number): string {
  assertExactTwoDecimals(value, 'valor numérico');
  const fixed = value.toFixed(2);
  if (fixed.endsWith('.00')) return fixed.slice(0, -3);
  return fixed.endsWith('0') ? fixed.slice(0, -1) : fixed;
}

function vertexXml(x: number, y: number, banding: 1 | 2): string {
  const lines = [
    '      <Vertex>',
    `        <X1>${formatKdtNumber(x)}</X1>`,
    `        <Y1>${formatKdtNumber(y)}</Y1>`,
    '        <Bulge>0</Bulge>',
    `        <Banding>${banding}</Banding>`,
  ];
  if (banding === 2) {
    lines.push(
      '        <Description>AlignmentFace</Description>',
      '        <BandingColor>rgb(255,0,0)</BandingColor>',
      '        <DescriptionColor>rgb(255,0,0)</DescriptionColor>',
    );
  }
  lines.push('      </Vertex>');
  return lines.join(CRLF);
}

/**
 * Rectangular outline in the corpus order. `alignmentEdge` selects which
 * panel edge carries the single AlignmentFace: 'x0' (Quadrant 2) or
 * 'yWidth' (Quadrant 3).
 */
export function rectangularOutlineXml(
  lengthMm: number,
  widthMm: number,
  alignmentEdge: KdtAlignmentEdge,
): string {
  const vertices: ReadonlyArray<readonly [number, number, 1 | 2]> = [
    [lengthMm, widthMm, 1],
    [lengthMm, 0, 1],
    [0, 0, alignmentEdge === 'x0' ? 2 : 1],
    [0, widthMm, alignmentEdge === 'yWidth' ? 2 : 1],
  ];
  return [
    '    <PanelOutline>',
    ...vertices.map(([x, y, banding]) => vertexXml(x, y, banding)),
    '    </PanelOutline>',
  ].join(CRLF);
}

/** Escape only what PanelName can legally contain; corpus names are plain text. */
function escapePanelName(name: string): string {
  return name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function operationXmlLines(operation: KdtPanelDocument['operations'][number]): string[] {
  const common = (typeNo: number, typeName: string): string[] => [
    '  <CAD>',
    `    <TypeNo>${typeNo}</TypeNo>`,
    `    <TypeName>${typeName}</TypeName>`,
  ];
  const pattern = (): string[] => [
    '    <HoleNo>1</HoleNo>',
    '    <IntervalX>0</IntervalX>',
    '    <IntervalY>0</IntervalY>',
  ];
  if (operation.kind === 'vertical-hole') {
    return [
      ...common(1, KDT_VERTICAL_HOLE_TYPE_NAME),
      `    <Depth>${formatKdtNumber(operation.depthMm)}</Depth>`,
      `    <X1>${formatKdtNumber(operation.x1Mm)}</X1>`,
      `    <Y1>${formatKdtNumber(operation.y1Mm)}</Y1>`,
      `    <Diameter>${formatKdtNumber(operation.diameterMm)}</Diameter>`,
      ...pattern(),
      '  </CAD>',
    ];
  }
  return [
    ...common(2, KDT_HORIZONTAL_HOLE_TYPE_NAME),
    `    <Depth>${formatKdtNumber(operation.depthMm)}</Depth>`,
    `    <Quadrant>${operation.quadrant}</Quadrant>`,
    `    <X1>${formatKdtNumber(operation.x1Mm)}</X1>`,
    `    <Y1>${formatKdtNumber(operation.y1Mm)}</Y1>`,
    `    <Z1>${formatKdtNumber(operation.z1Mm)}</Z1>`,
    `    <Diameter>${formatKdtNumber(operation.diameterMm)}</Diameter>`,
    ...pattern(),
    '    <IntervalZ>0</IntervalZ>',
    '  </CAD>',
  ];
}

export function serializeKdtPanelDocument(document: KdtPanelDocument): Uint8Array {
  const lines: string[] = ['<KDTPanelFormat>', '  <PANEL>'];
  lines.push(
    `    <PanelLength>${formatKdtNumber(document.panel.lengthMm)}</PanelLength>`,
    `    <PanelWidth>${formatKdtNumber(document.panel.widthMm)}</PanelWidth>`,
    `    <PanelThickness>${formatKdtNumber(document.panel.thicknessMm)}</PanelThickness>`,
    `    <PanelName>${escapePanelName(document.panel.name)}</PanelName>`,
  );
  lines.push(
    rectangularOutlineXml(
      document.panel.lengthMm,
      document.panel.widthMm,
      document.panel.alignmentEdge,
    ),
  );
  lines.push('  </PANEL>');
  for (const operation of document.operations) {
    lines.push(...operationXmlLines(operation));
  }
  lines.push('</KDTPanelFormat>', KDT_AUTHOR_COMMENT_PREFIX);
  lines.push(`Adapter: ${document.provenance.adapterId}@${document.provenance.adapterVersion}`);
  lines.push(`Profile: ${document.provenance.profileId}@${document.provenance.profileRevision}`);
  lines.push('-->');
  return new TextEncoder().encode(lines.join(CRLF) + CRLF);
}
