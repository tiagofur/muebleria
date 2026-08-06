import { describe, expect, it } from 'vitest';
import type { ProductionCutRow } from './types';
import { buildCncPilotDocument, cncPilotDocumentToJson } from './cncPilot';

const rows: ProductionCutRow[] = [
  {
    quantity: 2,
    lengthMm: 720,
    widthMm: 560,
    description: 'LAT · Lateral · GAB-01',
    materialName: 'Blanco',
    grain: 0,
    L1: 1,
    L2: 0,
    W1: 0,
    W2: 0,
    partCode: 'LAT',
    moduleCode: 'GAB-01',
  },
];

describe('cncPilot (PROD-3.3 / #111)', () => {
  it('builds pilot document with rect outlines from cut rows', () => {
    const doc = buildCncPilotDocument({
      projectId: 'p1',
      projectName: 'Cocina',
      cutRows: rows,
      generatedAt: '2026-03-01T00:00:00.000Z',
      productionRevision: 2,
    });
    expect(doc.schema).toBe('muebles.cnc-pilot.v1');
    expect(doc.pieces).toHaveLength(1);
    expect(doc.pieces[0]!.pieceCode).toBe('GAB-01-LAT');
    expect(doc.pieces[0]!.outline).toEqual({
      kind: 'rect',
      lengthMm: 720,
      widthMm: 560,
    });
    expect(doc.note).toMatch(/Optimizer/i);
  });

  it('serializes stable JSON', () => {
    const doc = buildCncPilotDocument({
      projectId: 'p1',
      projectName: 'Cocina',
      cutRows: rows,
      generatedAt: '2026-03-01T00:00:00.000Z',
    });
    const json = cncPilotDocumentToJson(doc);
    expect(json).toContain('"schema": "muebles.cnc-pilot.v1"');
    expect(JSON.parse(json).pieces[0].quantity).toBe(2);
  });
});
