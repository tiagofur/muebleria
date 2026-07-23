/**
 * Shared types for the board-first editor (Fase 1).
 * These mirror the editorStore types in apps/web/src/stores/editorStore.ts
 * but live here so packages/ui doesn't depend on apps/web.
 */

export interface PartPose {
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
  readonly rotateX?: number;
  readonly rotateY?: number;
  readonly rotateZ?: number;
}

export interface PartDimensions {
  readonly lengthMm?: number;
  readonly widthMm?: number;
  readonly thicknessMm?: number;
}
