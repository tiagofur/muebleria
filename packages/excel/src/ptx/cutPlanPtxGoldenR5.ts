/**
 * #791 — deterministic LAB/TEST r5 golden fixture.
 *
 * Generated only through the real pipeline:
 * engineering rows -> optimizeCutPlan -> buildPtxPartLabels ->
 * compileCutPlanToPtxDocument -> strict spec-checked serialize/parse ->
 * validate/spec preflight/readback. LAB ONLY / NOT MACHINE VALIDATED: this is
 * not a productive profile/adapter export and makes no CADmatic acceptance
 * claim.
 */

import { createHash } from 'node:crypto';
import { optimizeCutPlan, type CutPlan } from '@granete/domain';
import type { CompileCutPlanToPtxOptions, CompiledPtxCandidate } from './compileCutPlan';
import { compileCutPlanToPtxDocument } from './compileCutPlan';
import { buildPtxPartLabels, type PtxPartLabelData, type PtxPartLabelInput } from './partLabels';
import { parsePtxDocumentBytes } from './parse';
import type {
  PtxBoardRecord,
  PtxMaterialRecord,
  PtxPartsInfRecord,
  PtxPartsReqRecord,
  PtxPartsUdiRecord,
  PtxDocument,
} from './records';
import { serializePtxDocumentBytesSpecChecked } from './specPreflight';
import { HPP250_CAD4_R5_LAB_RECEIVER_POLICY } from './receiverPolicy';
import {
  AA_MODULE_CODE,
  LABELS_GOLDEN_MATERIALS,
  LABELS_GOLDEN_PROJECT_ID,
  LABELS_GOLDEN_CNC_SCOPE,
  LABELS_GOLDEN_OPTIONS,
  labelInputs,
  scenarioRows,
} from './cutPlanPtxLabelsGolden';

export const GOLDEN_R5_PROJECT_ID = `${LABELS_GOLDEN_PROJECT_ID}-receiver`;
export const GOLDEN_R5_TITLE = 'LAB-R5-GOLDEN-TEST-ONLY1';
export const GOLDEN_R5_DECIMAL_PLACES = 2;

export const GOLDEN_R5_CONFIG = {
  sawKerfMm: 4.4,
  trim: {
    topMm: 0,
    bottomMm: 10,
    leftMm: 10,
    rightMm: 0,
  },
  deductEdgeBand: true,
  allowRotationNoGrain: true,
  minRemnantWidthMm: 300,
  minRemnantLengthMm: 400,
  preferLongitudinalRips: true,
  heuristic: 'guillotine-hybrid',
} as const;

export const GOLDEN_R5_OPTIONS: CompileCutPlanToPtxOptions = {
  ...LABELS_GOLDEN_OPTIONS,
  title: GOLDEN_R5_TITLE,
  decimalPlaces: GOLDEN_R5_DECIMAL_PLACES,
  receiverPolicy: HPP250_CAD4_R5_LAB_RECEIVER_POLICY,
};

export function goldenR5EngineeringRows() {
  return scenarioRows();
}

/** One no-CNC part proves empty DRAWING/BARCODE1 while the rest carry CNC refs. */
export function goldenR5LabelInputs(): readonly PtxPartLabelInput[] {
  return labelInputs('R5').map((input) => ({
    ...input,
    hasCncMachining: input.row.labelRef !== `${AA_MODULE_CODE}-P02`,
    cncScope:
      input.row.labelRef === `${AA_MODULE_CODE}-P02`
        ? undefined
        : LABELS_GOLDEN_CNC_SCOPE,
  }));
}

export interface GoldenR5Candidate {
  readonly labels: readonly PtxPartLabelData[];
  readonly plan: CutPlan;
  readonly compiled: CompiledPtxCandidate;
  readonly bytes: Uint8Array;
  readonly parsed: PtxDocument;
}

/**
 * Deterministic LAB/TEST manifest for the #791 r5 golden bytes.
 *
 * LAB / TEST ONLY — NOT MACHINE VALIDATED. This is not a productive #793
 * profile/adapter manifest and does not publish CADmatic/CADLink acceptance.
 */
export interface GoldenR5LabTestManifest {
  readonly fixtureId: 'ptx-cut-plan-golden-r5-lab-test-791';
  readonly labTestOnly: true;
  readonly machineValidated: false;
  readonly receiverPolicyId: string;
  readonly title: string;
  readonly decimalPlaces: number;
  readonly strictSpecPreflight: CompileCutPlanToPtxOptions['strictSpecPreflight'];
  readonly partsReqDimensionPolicy: CompileCutPlanToPtxOptions['partsReqDimensionPolicy'];
  readonly partsUdiPolicy: CompileCutPlanToPtxOptions['partsUdi'];
  readonly offcutCutMarkers: CompileCutPlanToPtxOptions['offcutCutMarkers'];
  readonly sha256: string;
  readonly byteLength: number;
  readonly records: number;
  readonly parts: number;
  readonly materials: number;
  readonly sheets: number;
  readonly offcuts: number;
  readonly partsInf: number;
  readonly partsUdi: number;
  readonly cncDrawings: number;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function recordsOf<T extends { readonly type: string }>(
  records: readonly { readonly type: string }[],
  type: T['type'],
): T[] {
  return records.filter((record): record is T => record.type === type);
}

export function buildGoldenR5LabTestManifest(candidate: GoldenR5Candidate): GoldenR5LabTestManifest {
  const { bytes, parsed } = candidate;
  const partsInf = recordsOf<PtxPartsInfRecord>(parsed.records, 'PARTS_INF');
  const receiverPolicyId = GOLDEN_R5_OPTIONS.receiverPolicy?.id;

  if (receiverPolicyId === undefined) {
    throw new Error('Golden r5 LAB/TEST manifest requires an explicit receiver policy id');
  }

  return {
    fixtureId: 'ptx-cut-plan-golden-r5-lab-test-791',
    labTestOnly: true,
    machineValidated: false,
    receiverPolicyId,
    title: GOLDEN_R5_TITLE,
    decimalPlaces: GOLDEN_R5_DECIMAL_PLACES,
    strictSpecPreflight: GOLDEN_R5_OPTIONS.strictSpecPreflight,
    partsReqDimensionPolicy: GOLDEN_R5_OPTIONS.partsReqDimensionPolicy,
    partsUdiPolicy: GOLDEN_R5_OPTIONS.partsUdi,
    offcutCutMarkers: GOLDEN_R5_OPTIONS.offcutCutMarkers,
    sha256: sha256(bytes),
    byteLength: bytes.byteLength,
    records: parsed.records.length,
    parts: recordsOf<PtxPartsReqRecord>(parsed.records, 'PARTS_REQ').length,
    materials: recordsOf<PtxMaterialRecord>(parsed.records, 'MATERIALS').length,
    sheets: recordsOf<PtxBoardRecord>(parsed.records, 'BOARDS').length,
    offcuts: parsed.records.filter((record) => record.type === 'OFFCUTS').length,
    partsInf: partsInf.length,
    partsUdi: recordsOf<PtxPartsUdiRecord>(parsed.records, 'PARTS_UDI').length,
    cncDrawings: partsInf.filter((row) => row.drawing !== undefined).length,
  };
}

export async function buildGoldenR5Candidate(): Promise<GoldenR5Candidate> {
  const labels = await buildPtxPartLabels(goldenR5LabelInputs());
  const plan = optimizeCutPlan(
    GOLDEN_R5_PROJECT_ID,
    goldenR5EngineeringRows(),
    LABELS_GOLDEN_MATERIALS,
    GOLDEN_R5_CONFIG,
    'LAB R5 Golden Test',
  );
  const compiled = compileCutPlanToPtxDocument(plan, {
    ...GOLDEN_R5_OPTIONS,
    partLabels: labels,
  });
  const bytes = serializePtxDocumentBytesSpecChecked(compiled.document, {
    decimalPlaces: GOLDEN_R5_DECIMAL_PLACES,
  });
  const parsed = parsePtxDocumentBytes(bytes);

  return { labels, plan, compiled, bytes, parsed };
}
