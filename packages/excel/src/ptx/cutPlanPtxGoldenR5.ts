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

import { optimizeCutPlan, type CutPlan } from '@granete/domain';
import type { CompileCutPlanToPtxOptions, CompiledPtxCandidate } from './compileCutPlan';
import { compileCutPlanToPtxDocument } from './compileCutPlan';
import { buildPtxPartLabels, type PtxPartLabelData, type PtxPartLabelInput } from './partLabels';
import { parsePtxDocumentBytes } from './parse';
import type { PtxDocument } from './records';
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
