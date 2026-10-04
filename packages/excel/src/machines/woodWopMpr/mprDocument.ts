/**
 * woodWOP MPR CANDIDATE dialect (#879 B2-prep) — document model.
 *
 * Source of every grammar element: HOMAG "Description woodWOP-file"
 * 9-080-42-7190-D00 (2006, woodWOP 4.x era) — see
 * docs/machines/bhx050/woodwop-mpr/README.md for the citated subset and
 * its open questions. This is a RESEARCH/TEST artifact: the candidate
 * dialect is public-reference material, never receiver evidence. The
 * production adapter (woodWopMprAdapter) stays fail-closed and the
 * `mpr-woodwop` profile stays at r1 (zero evidenced dimensions) until the
 * client-a sample kit (b1-woodwop-evidence-kit.md) confirms or corrects
 * this dialect.
 *
 * Emitted subset only: [H head, <100 \Werkstck\, <101 \Comment\,
 * <102 \BohrVert\, <103 \BohrHoriz\, `!` terminator. Literal numbers only
 * — no expression-parser constructs ("B/2" style), so every value is
 * exactly checkable against the expected-values tables.
 */

export type MprCandidateDrillDirection = 'XP' | 'XM' | 'YP' | 'YM';

export interface MprCandidateBohrVert {
  readonly kind: 'bohr-vert';
  readonly xaMm: number;
  readonly yaMm: number;
  readonly diameterMm: number;
  readonly depthMm: number;
}

export interface MprCandidateBohrHoriz {
  readonly kind: 'bohr-horiz';
  readonly xaMm: number;
  readonly yaMm: number;
  readonly zaMm: number;
  /** Drill travel direction (enters the panel from the opposite edge). */
  readonly direction: MprCandidateDrillDirection;
  readonly diameterMm: number;
  readonly depthMm: number;
}

export type MprCandidateOperation = MprCandidateBohrVert | MprCandidateBohrHoriz;

export interface MprCandidateDocument {
  readonly piece: {
    readonly lengthMm: number;
    readonly widthMm: number;
    readonly thicknessMm: number;
    readonly name: string;
  };
  readonly operations: readonly MprCandidateOperation[];
  /** Deterministic provenance for the <101 \Comment\ rows. */
  readonly provenance: {
    readonly generator: string;
    readonly dialect: string;
    readonly pieceCode: string;
    readonly machiningFace: 'front' | 'back';
  };
}
