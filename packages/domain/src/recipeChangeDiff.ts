/**
 * Recipe change simulation contract (#1369, slice 1).
 *
 * The backend resolves the current and candidate recipes and returns this
 * classified diff; the web CONSUMES it verbatim (server authority — React never
 * re-resolves). Single wire authority: contracts/fixtures/recipe-change-diff-canonical.json,
 * produced by Go `engine.SimulateRecipeChange` and frozen by both CIs.
 *
 * `parseRecipeChangeDiff` is the fail-closed boundary: an unknown state or
 * change kind is a contract break and throws — never a silent fallback row.
 */

export type RecipeChangeState = 'valid' | 'no_changes' | 'partially_invalid';

export type RecipeChangeKind =
  | 'added'
  | 'removed'
  | 'unchanged'
  | 'moved'
  | 'hardware_changed'
  | 'resized'
  | 'changed'
  | 'rejected'
  | 'quantity_changed';

export type RecipeMemberChange = {
  readonly memberId: string;
  readonly change: RecipeChangeKind;
  readonly role?: string;
  readonly hardwareIdBefore?: string;
  readonly hardwareIdAfter?: string;
  readonly bomRoleBefore?: string;
  readonly bomRoleAfter?: string;
  readonly translationBeforeMm?: readonly [number, number, number];
  readonly translationAfterMm?: readonly [number, number, number];
  readonly translationDeltaMm?: readonly [number, number, number];
};

export type RecipeBoardDims = {
  readonly widthMm: number;
  readonly lengthMm: number;
  readonly quantity: number;
};

export type RecipeBoardChange = {
  readonly componentId: string;
  readonly change: RecipeChangeKind;
  readonly before?: RecipeBoardDims;
  readonly after?: RecipeBoardDims;
  readonly translationDeltaMm?: readonly [number, number, number];
};

export type RecipeSelectedVariant = {
  readonly variantSetId: string;
  readonly hardwareId: string;
  readonly nominalDimensionMm: number;
};

/** A candidate variant set with no fitting nominal: alternatives, never a clamp. */
export type RecipeVariantRejection = {
  readonly requestedSpaceMm: number;
  readonly requiredClearanceMm: number;
  readonly availableNominals: readonly number[];
  /** Nominals that WOULD fit the requested space; empty = the user must change dims or recipe. */
  readonly fittingNominals: readonly number[];
};

export type RecipeVariantChange = {
  readonly variantSetId: string;
  readonly change: RecipeChangeKind;
  readonly before?: RecipeSelectedVariant;
  readonly after?: RecipeSelectedVariant;
  readonly rejection?: RecipeVariantRejection;
};

export type RecipeConsumptionChange = {
  readonly hardwareId: string;
  readonly role: string;
  readonly change: RecipeChangeKind;
  readonly quantityBefore: number;
  readonly quantityAfter: number;
};

export type RecipeChangeSummary = {
  readonly added: number;
  readonly removed: number;
  readonly moved: number;
  readonly resized: number;
  readonly rejected: number;
  readonly totalChanges: number;
};

export type RecipeChangeDiff = {
  readonly state: RecipeChangeState;
  readonly params: { readonly widthMm: number; readonly depthMm: number; readonly heightMm: number };
  readonly candidateResolved: boolean;
  readonly members: readonly RecipeMemberChange[];
  readonly boards: readonly RecipeBoardChange[];
  readonly variants: readonly RecipeVariantChange[];
  readonly consumption: readonly RecipeConsumptionChange[];
  readonly summary: RecipeChangeSummary;
};

/** Wire body of POST /api/catalog/agregados/{id}/recipe-change/simulate. */
export type RecipeChangeSimulationResponse = {
  readonly agregadoId: string;
  /** If-Match the apply (PUT) must carry; stale → 412 → simulate again. */
  readonly currentVersion: number;
  readonly diff: RecipeChangeDiff;
};

const STATES: ReadonlySet<string> = new Set<RecipeChangeState>(['valid', 'no_changes', 'partially_invalid']);
const KINDS: ReadonlySet<string> = new Set<RecipeChangeKind>([
  'added',
  'removed',
  'unchanged',
  'moved',
  'hardware_changed',
  'resized',
  'changed',
  'rejected',
  'quantity_changed',
]);

export class RecipeChangeContractError extends Error {
  constructor(message: string) {
    super(`RecipeChangeDiff contract: ${message}`);
    this.name = 'RecipeChangeContractError';
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireArray(v: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(v)) throw new RecipeChangeContractError(`${path} must be an array`);
  return v;
}

function requireKind(v: unknown, path: string): RecipeChangeKind {
  if (typeof v !== 'string' || !KINDS.has(v)) {
    throw new RecipeChangeContractError(`${path} has unknown change kind ${JSON.stringify(v)}`);
  }
  return v as RecipeChangeKind;
}

function requireString(v: unknown, path: string): string {
  if (typeof v !== 'string' || v.trim() === '') {
    throw new RecipeChangeContractError(`${path} must be a non-empty string`);
  }
  return v;
}

function requireNumber(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new RecipeChangeContractError(`${path} must be a finite number`);
  }
  return v;
}

/**
 * Validates the wire shape of a simulation diff. Shape only — it never
 * recomputes a transform, a dimension or a selection.
 */
export function parseRecipeChangeDiff(input: unknown): RecipeChangeDiff {
  if (!isRecord(input)) throw new RecipeChangeContractError('diff must be an object');
  const state = input.state;
  if (typeof state !== 'string' || !STATES.has(state)) {
    throw new RecipeChangeContractError(`unknown state ${JSON.stringify(state)}`);
  }
  if (!isRecord(input.params)) throw new RecipeChangeContractError('params must be an object');
  const params = {
    widthMm: requireNumber(input.params.widthMm, 'params.widthMm'),
    depthMm: requireNumber(input.params.depthMm, 'params.depthMm'),
    heightMm: requireNumber(input.params.heightMm, 'params.heightMm'),
  };
  if (typeof input.candidateResolved !== 'boolean') {
    throw new RecipeChangeContractError('candidateResolved must be a boolean');
  }
  if (!isRecord(input.summary)) throw new RecipeChangeContractError('summary must be an object');

  const members = requireArray(input.members, 'members').map((row, i) => {
    if (!isRecord(row)) throw new RecipeChangeContractError(`members[${i}] must be an object`);
    requireString(row.memberId, `members[${i}].memberId`);
    requireKind(row.change, `members[${i}].change`);
    return row as unknown as RecipeMemberChange;
  });
  const boards = requireArray(input.boards, 'boards').map((row, i) => {
    if (!isRecord(row)) throw new RecipeChangeContractError(`boards[${i}] must be an object`);
    requireString(row.componentId, `boards[${i}].componentId`);
    requireKind(row.change, `boards[${i}].change`);
    return row as unknown as RecipeBoardChange;
  });
  const variants = requireArray(input.variants, 'variants').map((row, i) => {
    if (!isRecord(row)) throw new RecipeChangeContractError(`variants[${i}] must be an object`);
    requireString(row.variantSetId, `variants[${i}].variantSetId`);
    const change = requireKind(row.change, `variants[${i}].change`);
    if (change === 'rejected') {
      if (!isRecord(row.rejection)) {
        throw new RecipeChangeContractError(`variants[${i}] is rejected but carries no rejection`);
      }
      requireArray(row.rejection.availableNominals, `variants[${i}].rejection.availableNominals`);
      requireArray(row.rejection.fittingNominals, `variants[${i}].rejection.fittingNominals`);
    }
    return row as unknown as RecipeVariantChange;
  });
  const consumption = requireArray(input.consumption, 'consumption').map((row, i) => {
    if (!isRecord(row)) throw new RecipeChangeContractError(`consumption[${i}] must be an object`);
    requireString(row.hardwareId, `consumption[${i}].hardwareId`);
    requireKind(row.change, `consumption[${i}].change`);
    return row as unknown as RecipeConsumptionChange;
  });

  const summary = input.summary;
  for (const key of ['added', 'removed', 'moved', 'resized', 'rejected', 'totalChanges'] as const) {
    requireNumber(summary[key], `summary.${key}`);
  }

  return {
    state: state as RecipeChangeState,
    params,
    candidateResolved: input.candidateResolved,
    members,
    boards,
    variants,
    consumption,
    summary: summary as unknown as RecipeChangeSummary,
  };
}

export function parseRecipeChangeSimulationResponse(input: unknown): RecipeChangeSimulationResponse {
  if (!isRecord(input)) throw new RecipeChangeContractError('response must be an object');
  return {
    agregadoId: requireString(input.agregadoId, 'agregadoId'),
    currentVersion: requireNumber(input.currentVersion, 'currentVersion'),
    diff: parseRecipeChangeDiff(input.diff),
  };
}
