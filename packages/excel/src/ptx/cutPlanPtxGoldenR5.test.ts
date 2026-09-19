import { describe, expect, it } from 'vitest';
import { validatePtxDocument } from './validate';
import { ptxSpecPreflightDocument } from './specPreflight';
import { verifyCutPlanPtxReadback } from './verifyCutPlanPtxReadback';
import { serializePtxDocument } from './serialize';
import type {
  PtxBoardRecord,
  PtxCutRecord,
  PtxMaterialRecord,
  PtxPartsInfRecord,
  PtxPartsReqRecord,
  PtxPartsUdiRecord,
  PtxPatternRecord,
} from './records';
import {
  GOLDEN_R5_DECIMAL_PLACES,
  GOLDEN_R5_OPTIONS,
  GOLDEN_R5_TITLE,
  buildGoldenR5Candidate,
  buildGoldenR5LabTestManifest,
  type GoldenR5LabTestManifest,
} from './cutPlanPtxGoldenR5';

const EXPECTED_GOLDEN_R5_LAB_TEST_MANIFEST = {
  fixtureId: 'ptx-cut-plan-golden-r5-lab-test-791',
  labTestOnly: true,
  machineValidated: false,
  receiverPolicyId: 'HPP250_CAD4_R5_LAB',
  title: 'LAB-R5-GOLDEN-TEST-ONLY1',
  decimalPlaces: 2,
  strictSpecPreflight: 'pattern-exchange-v1',
  partsReqDimensionPolicy: 'part-local-pre-rotation-cut',
  partsUdiPolicy: 'structural',
  offcutCutMarkers: 'function92-only',
  sha256: '239e9f7c8989c5f3756545da94a184b7b79aa1bdda797755c065301917201932',
  byteLength: 3303,
  records: 60,
  parts: 10,
  materials: 2,
  sheets: 4,
  offcuts: 1,
  partsInf: 10,
  partsUdi: 10,
  cncDrawings: 9,
} as const satisfies GoldenR5LabTestManifest;

function rows<T extends { readonly type: string }>(records: readonly { readonly type: string }[], type: T['type']): T[] {
  return records.filter((record): record is T => record.type === type);
}

describe('#791 deterministic LAB/TEST r5 golden', () => {
  it('is generated through the real pipeline and round-trips with strict validation/readback', async () => {
    const candidate = await buildGoldenR5Candidate();
    const { bytes, parsed, plan, compiled, labels } = candidate;

    expect(validatePtxDocument(parsed)).toEqual([]);
    expect(ptxSpecPreflightDocument(parsed)).toEqual([]);
    expect(
      verifyCutPlanPtxReadback(parsed, plan, compiled.mapping, {
        ...GOLDEN_R5_OPTIONS,
        partLabels: labels,
      }),
    ).toEqual([]);
    expect(serializePtxDocument(parsed, { decimalPlaces: GOLDEN_R5_DECIMAL_PLACES })).toBe(
      new TextDecoder().decode(bytes),
    );
  });

  it('covers r5 receiver policy, labels, offcuts and omitted CUT comments', async () => {
    const { parsed } = await buildGoldenR5Candidate();
    const parts = rows<PtxPartsReqRecord>(parsed.records, 'PARTS_REQ');
    const inf = rows<PtxPartsInfRecord>(parsed.records, 'PARTS_INF');
    const udi = rows<PtxPartsUdiRecord>(parsed.records, 'PARTS_UDI');
    const boards = rows<PtxBoardRecord>(parsed.records, 'BOARDS');
    const materials = rows<PtxMaterialRecord>(parsed.records, 'MATERIALS');
    const patterns = rows<PtxPatternRecord>(parsed.records, 'PATTERNS');
    const cuts = rows<PtxCutRecord>(parsed.records, 'CUTS');
    const offcuts = parsed.records.filter((record) => record.type === 'OFFCUTS');

    expect(GOLDEN_R5_TITLE).toHaveLength(24);
    expect(new Set(inf.map((row) => row.product))).toEqual(new Set(['ZZ-ALTO', 'AA-BAJO']));
    expect(new Set(inf.map((row) => row.coreMaterial))).toEqual(new Set(['MDF-BCO-18', 'MDF-ROBLE-18']));
    expect(parts).toHaveLength(inf.length);
    expect(udi).toHaveLength(inf.length);
    expect(materials).toHaveLength(2);
    expect(boards.length).toBeGreaterThanOrEqual(2);
    expect(offcuts).toHaveLength(1);

    for (const material of materials) {
      expect(material).toMatchObject({
        bookQuantity: 3,
        kerfRip: 4.4,
        kerfCrosscut: 4.4,
        rule1: 6,
        rule2: 1,
        rule3: 1,
        rule4: 1,
      });
    }
    expect(patterns.every((pattern) => pattern.maxBook === 3)).toBe(true);
    expect(cuts.every((cut) => cut.comment === undefined)).toBe(true);
    expect(cuts).toContainEqual(
      expect.objectContaining({ functionCode: 92, partReference: { kind: 'offcut', offcutIndex: 1 } }),
    );

    const cncRows = inf.filter((row) => row.drawing !== undefined);
    const emptyDrawingRows = inf.filter((row) => row.drawing === undefined);
    expect(cncRows.length).toBeGreaterThan(0);
    expect(emptyDrawingRows.length).toBeGreaterThan(0);
    expect(cncRows.every((row) => row.barcode1 !== undefined && row.barcode2 !== undefined)).toBe(true);
    expect(emptyDrawingRows.every((row) => row.barcode1 === undefined && row.barcode2 !== undefined)).toBe(true);

    expect(inf.some((row) => row.edge1 && row.edge2 && row.edge3 && row.edge4 === undefined)).toBe(true);
    expect(inf.some((row) => row.edge1 === undefined && row.edge2 === undefined && row.edge3 === undefined && row.edge4 === undefined)).toBe(true);
    expect(inf.some((row) => row.edge1 === undefined && row.edge2 === undefined && row.edge3 && row.edge4)).toBe(true);
  });

  it('has a deterministic LAB/TEST manifest derived from stable bytes', async () => {
    const first = await buildGoldenR5Candidate();
    const second = await buildGoldenR5Candidate();

    const firstManifest = buildGoldenR5LabTestManifest(first);
    const secondManifest = buildGoldenR5LabTestManifest(second);

    expect(second.bytes).toEqual(first.bytes);
    expect(secondManifest.sha256).toBe(firstManifest.sha256);
    expect(secondManifest).toEqual(firstManifest);
    expect(firstManifest).toEqual(EXPECTED_GOLDEN_R5_LAB_TEST_MANIFEST);
  });
});
