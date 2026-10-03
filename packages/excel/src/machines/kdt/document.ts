/**
 * KDTPanelFormat document model (#1005 K2) — the subset of the studied
 * grammar (docs/machines/kdt-xml-format.md) Granete emits today.
 *
 * The WRITER consumes these types; the READER (parse.ts) is deliberately
 * independent — it re-derives its own view from bytes and never imports the
 * writer's helpers, so the round-trip tests prove real invertibility
 * instead of comparing a structure against itself.
 *
 * Grooves/routing (TypeNo 3/6/7) exist in the corpus but NOT in Granete's
 * resolved machining model yet: the writer refuses them and the reader
 * parses them structurally so real samples validate end to end.
 */

export type KdtAlignmentEdge = 'x0' | 'yWidth';

export interface KdtPanelIdentity {
  /** PanelLength: dimension along the machine X axis (mm). */
  readonly lengthMm: number;
  /** PanelWidth: dimension along the machine Y axis (mm). */
  readonly widthMm: number;
  readonly thicknessMm: number;
  /** Free descriptive text; the machine does not machine by name. */
  readonly name: string;
  /** Which edge carries the single AlignmentFace (Granete policy r1: 'x0'). */
  readonly alignmentEdge: KdtAlignmentEdge;
}

export interface KdtVerticalHoleOperation {
  readonly kind: 'vertical-hole';
  readonly x1Mm: number;
  readonly y1Mm: number;
  readonly diameterMm: number;
  readonly depthMm: number;
}

/** KDT quadrant: 1 = X=PanelLength, 2 = X=0, 3 = Y=PanelWidth, 4 = Y=0. */
export type KdtQuadrant = 1 | 2 | 3 | 4;

export interface KdtHorizontalHoleOperation {
  readonly kind: 'horizontal-hole';
  readonly quadrant: KdtQuadrant;
  readonly x1Mm: number;
  readonly y1Mm: number;
  /** Height of the hole axis from the panel TOP face (≈ thickness / 2). */
  readonly z1Mm: number;
  readonly diameterMm: number;
  readonly depthMm: number;
}

export type KdtPanelOperation = KdtVerticalHoleOperation | KdtHorizontalHoleOperation;

export interface KdtPanelDocument {
  readonly panel: KdtPanelIdentity;
  readonly operations: readonly KdtPanelOperation[];
  /** Deterministic provenance for the AUTHOR comment (machine ignores it). */
  readonly provenance: {
    readonly adapterId: string;
    readonly adapterVersion: string;
    readonly profileId: string;
    readonly profileRevision: string;
  };
}
