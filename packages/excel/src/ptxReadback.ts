/**
 * Machine/software-neutral readback model for #348 PTX import/readback
 * validation: expected/actual structures and the operator capture template.
 *
 * PURE and OFFLINE by design: this module never connects to a machine, never
 * infers capability, never alters PTX output and never performs I/O. The
 * operator captures the "actual" side from the receiving software's own
 * reports/exports/screens; the comparator lives in ptxReadbackCompare.ts.
 *
 * Negative-proof rule: the model intentionally has NO "validated" status. A
 * green comparison is evidence for the evidence pack, never a compatibility
 * claim (docs/machines/ptx-validation.md §9).
 */

export type PtxFindingClassification =
  | 'PASS'
  | 'WARNING'
  | 'BLOCKER'
  | 'UNSUPPORTED_CAPABILITY'
  | 'NOT_OBSERVABLE';

export interface PtxExpectedMaterial {
  readonly materialCode: string;
  readonly materialName: string;
  readonly sheetLengthMm: number;
  readonly sheetWidthMm: number;
  readonly thicknessMm: number;
}

export interface PtxExpectedPart {
  readonly partCode: string;
  readonly quantity: number;
  readonly materialCode: string;
  readonly finishedLengthMm: number;
  readonly finishedWidthMm: number;
  /** Cut dims of the unrotated instance; rotated instances swap them. */
  readonly cutLengthMm: number;
  readonly cutWidthMm: number;
  readonly thicknessMm: number;
  readonly grain: 0 | 1;
  /** How many of the `quantity` instances are placed rotated. */
  readonly rotatedCount: number;
  readonly edgeBandSides: readonly string[];
  readonly edgeBandThicknessMm?: number;
  readonly barcodes: readonly string[];
}

export interface PtxExpectedReadback {
  readonly fixture: {
    readonly id: string;
    readonly revision: string;
    readonly generatedAt: string;
    readonly sourceModule: string;
    readonly exportedWith: string;
  };
  readonly job: {
    readonly jobName: string;
    readonly projectCode: string;
    readonly customer: string;
    readonly units: string;
    readonly kerfMm: number;
    readonly trimMm: {
      readonly topMm: number;
      readonly bottomMm: number;
      readonly leftMm: number;
      readonly rightMm: number;
    };
    readonly deductEdgeBand: boolean;
    readonly sheetCount: number;
    readonly placedPieceCount: number;
  };
  readonly materials: readonly PtxExpectedMaterial[];
  readonly parts: readonly PtxExpectedPart[];
  /**
   * Ordered [CUTS] steps the current serializer emits, as
   * `PATTERN:STEP_LABEL [partCode]`. Comparison is OPTIONAL_IF_RECEIVER_EXPOSES
   * and a difference is never auto-blocked (ownership of cut order is an open
   * question — docs/machines/ptx-validation.md §7).
   */
  readonly cutOrderExpected: readonly string[];
  /** Fields Granete semantics carry but the current PTX cannot represent. */
  readonly notRepresentedByCurrentPtx: readonly string[];
}

export interface PtxActualReadback {
  /** Who/where/when captured this readback (sanitized, opaque keys only). */
  readonly source: {
    readonly softwareName?: string;
    readonly softwareVersion?: string;
    readonly machineKey?: string;
    readonly capturedBy?: string;
    readonly capturedAt?: string;
    readonly notes?: string;
  };
  readonly units?: string;
  readonly kerfMm?: number;
  readonly trimMm?: {
    readonly topMm?: number;
    readonly bottomMm?: number;
    readonly leftMm?: number;
    readonly rightMm?: number;
  };
  readonly sheetCount?: number;
  readonly placedPieceCount?: number;
  readonly materials?: readonly {
    readonly materialCode?: string;
    readonly materialName?: string;
    readonly sheetLengthMm?: number;
    readonly sheetWidthMm?: number;
    readonly thicknessMm?: number;
  }[];
  readonly parts?: readonly {
    readonly partCode: string;
    readonly quantity?: number;
    readonly materialCode?: string;
    readonly materialName?: string;
    readonly finishedLengthMm?: number;
    readonly finishedWidthMm?: number;
    readonly cutLengthMm?: number;
    readonly cutWidthMm?: number;
    readonly thicknessMm?: number;
    readonly grain?: number;
    readonly rotatedCount?: number;
    readonly edgeBandThicknessMm?: number;
    readonly barcodes?: readonly string[];
  }[];
  /** Receiver-reported execution order, if it can be exported/read back. */
  readonly cutOrderObserved?: readonly string[];
}

export interface PtxReadbackFinding {
  /** Dotted path of the compared field, e.g. `parts[fixture-part-001].quantity`. */
  readonly field: string;
  readonly classification: PtxFindingClassification;
  readonly expected?: string;
  readonly actual?: string;
  readonly note?: string;
}

export interface PtxReadbackComparison {
  readonly findings: readonly PtxReadbackFinding[];
  readonly blockerCount: number;
  readonly warningCount: number;
  readonly unsupportedCount: number;
  readonly notObservableCount: number;
  readonly passCount: number;
}

/**
 * Starting template for the operator-captured readback: prefilled with the
 * expected values ONLY so the operator overwrites each field with what the
 * receiving software actually reports (or deletes it if not exposed).
 * Shipping it prefilled avoids silently inventing receiver data: every field
 * must be consciously confirmed or removed before comparison.
 */
export function buildActualReadbackTemplate(expected: PtxExpectedReadback): PtxActualReadback {
  return {
    source: {
      softwareName: '',
      softwareVersion: '',
      machineKey: '',
      capturedBy: '',
      capturedAt: '',
      notes: 'Sobrescribir cada campo con lo que el software receptor reporta; borrar lo que no exponga',
    },
    units: expected.job.units,
    kerfMm: expected.job.kerfMm,
    trimMm: { ...expected.job.trimMm },
    sheetCount: expected.job.sheetCount,
    placedPieceCount: expected.job.placedPieceCount,
    materials: expected.materials.map((m) => ({ ...m })),
    parts: expected.parts.map((p) => ({
      partCode: p.partCode,
      quantity: p.quantity,
      materialCode: p.materialCode,
      finishedLengthMm: p.finishedLengthMm,
      finishedWidthMm: p.finishedWidthMm,
      cutLengthMm: p.cutLengthMm,
      cutWidthMm: p.cutWidthMm,
      thicknessMm: p.thicknessMm,
      grain: p.grain,
      rotatedCount: p.rotatedCount,
      edgeBandThicknessMm: p.edgeBandThicknessMm,
      barcodes: [...p.barcodes],
    })),
    cutOrderObserved: [...expected.cutOrderExpected],
  };
}
