/**
 * Hardware design parts (#1417) — internal parts of a hardware's pinned SKP
 * design, declared by SketchUp component name.
 *
 * A part exists to declare per-part presentation facts that a monolithic
 * hardware cannot express:
 * - actorMembership: which presentation actor the part follows when the
 *   assembly opens (#1376 vocabulary, same as rigid members — 'body' stays
 *   with the furniture, 'actor:<id>' follows the actor). This is how ONE
 *   left/right slide design splits into fixed rail vs moving rail.
 * - finishKey: which of the hardware's partFinishes keys (F080/#1209) tints
 *   this part, so metal vs plastic parts render differently without a second
 *   SKP.
 *
 * Contract boundary: the SERVER cannot enumerate component names inside a
 * binary SKP (verified: the derive pipeline does not parse them), so contract
 * validation covers FORMAT only (non-empty unique names, valid membership,
 * known finish key shape). The SketchUp host validates declared names against
 * the actual SKP at sync time and fails explicitly — never silently.
 */

export interface HardwareDesignPart {
  /** Exact component (definition) name inside the hardware's pinned SKP. */
  readonly componentName: string;
  /**
   * #1376 membership for presentation kinematics: 'body' or 'actor:<id>'.
   * Required on parts — a part exists precisely to declare movement.
   */
  readonly actorMembership: string;
  /** Optional workshop-facing label (K4: shown instead of the raw name). */
  readonly label?: string;
  /** Optional partFinishes key (F080) that tints this part. */
  readonly finishKey?: string;
}

export const ACTOR_MEMBERSHIP_PATTERN = /^actor:\S+$/;

export function isValidActorMembership(value: string): boolean {
  return value === 'body' || ACTOR_MEMBERSHIP_PATTERN.test(value);
}

export function validateHardwareDesignParts(
  parts: readonly HardwareDesignPart[] | undefined,
): void {
  if (parts === undefined) return;
  if (!Array.isArray(parts)) {
    throw new Error('design parts must be an array when present');
  }
  const seen = new Set<string>();
  for (const [i, p] of parts.entries()) {
    if (!p || typeof p !== 'object') {
      throw new Error(`design part ${i} must be an object`);
    }
    if (!p.componentName || !p.componentName.trim()) {
      throw new Error(`design part ${i} requires a non-empty componentName`);
    }
    if (seen.has(p.componentName)) {
      throw new Error(`design part '${p.componentName}' is declared more than once`);
    }
    seen.add(p.componentName);
    if (p.actorMembership === undefined || !isValidActorMembership(p.actorMembership)) {
      throw new Error(
        `design part '${p.componentName}': invalid actorMembership '${p.actorMembership ?? ''}' (expected 'body' or 'actor:<id>')`,
      );
    }
    if (p.finishKey !== undefined && !p.finishKey.trim()) {
      throw new Error(`design part '${p.componentName}': finishKey must be non-empty when present`);
    }
    if (p.label !== undefined && !p.label.trim()) {
      throw new Error(`design part '${p.componentName}': label must be non-empty when present`);
    }
  }
}
