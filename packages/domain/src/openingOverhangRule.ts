/**
 * Overhang rule (#1138, case C) — the millimetres a v1 bottom_overhang
 * selection resolves with. Since #1531 the server takes them from the grip
 * styles (20 by default, A4); the overlay blob is retired.
 */

export type OpeningOverhangRule = {
  readonly version: 1;
  /** Positive integer millimetres the front extends below the body. */
  readonly overhangMm: number;
};
