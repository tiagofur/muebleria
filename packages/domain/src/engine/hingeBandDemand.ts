/**
 * #1078 — hinge demand collector (TS engine mirror of
 * backend-go/internal/domain/engine/hinge_demand.go).
 *
 * Same ladder, same single source of truth: placements (#1210) > band
 * (#1078) > bulk line. A door's band demand resolves its identity through
 * the effective option choices exactly like placements do — a role without
 * a choice contributes nothing (the quote gate demands the group), a broken
 * choice fails closed. The fixed bulk BISAGRA line stops governing once the
 * band covers its resolved hardware.
 *
 * Door identification: composed parts carry componentPlacement 'puerta' (Go
 * keys on the material role FRENTE — the seed/UI couple both to the same
 * component, and the shared contract fixture pins the COUNT authority on
 * both stacks).
 */
import {
  HINGE_DEMAND_DESCRIPTION,
  HINGE_DEMAND_LINE_PREFIX,
  hingeDemandNotice,
  hingeDemandRole,
  resolveHingeCount,
  type HingeCount,
  type HingeDemandPolicy,
} from '../hingeDemand';
import { resolvePlacementHardwareId } from '../hardwarePlacement';
import { ResolutionError } from '../errors';
import type {
  Hardware,
  HardwareLine,
  OptionChoices,
  ResolvedBom,
  ResolvedHardwareLine,
} from '../types';

/** The pieces the band reads off a resolved/composed part. */
export interface HingeBandPart {
  readonly componentPlacement?: string;
  readonly optionRole?: string;
  readonly catalogComponentId?: string;
  readonly lengthMm: number;
  readonly widthMm: number;
  readonly quantity: number;
}

/** The factory overlay shape the TS resolve consumes (catalog-carried). */
export type CatalogHingePolicySource = {
  readonly doorHingeDemand?: HingeDemandPolicy;
  readonly componentOverrides?: Readonly<
    Record<string, { readonly hingeDemand?: HingeDemandPolicy }>
  >;
};

/** Component exception > factory family; nil = library ladder downstream. */
export function hingePolicyForComponent(
  policy: CatalogHingePolicySource | undefined,
  catalogComponentId: string | undefined,
): HingeDemandPolicy | undefined {
  if (policy && catalogComponentId) {
    const exception = policy.componentOverrides?.[catalogComponentId]?.hingeDemand;
    if (exception) return exception;
  }
  return policy?.doorHingeDemand;
}

/**
 * The policy ONE door buys under (#1579). Ladder, first match wins:
 *  1. the door component's exception (explicit authored intent);
 *  2. the table declared by the hinge effectively chosen for that door — so
 *     two hinges in the same group buy differently;
 *  3. the factory-wide family.
 * Undefined everywhere inherits the library ladder inside `resolveHingeCount`.
 * The hinge's table never carries a role: the role still comes from the
 * exception/factory rungs (`hingePolicyForComponent`). Mirrors
 * domain.FactoryConstructionPolicy.HingeDemandForDoor.
 */
export function hingePolicyForDoor(
  policy: CatalogHingePolicySource | undefined,
  catalogComponentId: string | undefined,
  hinge?: Pick<Hardware, 'hingeDemand'>,
): HingeDemandPolicy | undefined {
  if (policy && catalogComponentId) {
    const exception = policy.componentOverrides?.[catalogComponentId]?.hingeDemand;
    if (exception) return exception;
  }
  if (hinge?.hingeDemand) return hinge.hingeDemand;
  return policy?.doorHingeDemand;
}

export interface HingeBandDemand {
  readonly counts: ReadonlyMap<string, number>;
  readonly lines: readonly ResolvedHardwareLine[];
}

/**
 * Derive band demand for a module's doors. placementCounts are the #1210
 * counts — positions win, the band stays out for covered hardware.
 */
export function collectHingeBandDemand(params: {
  readonly parts: readonly HingeBandPart[];
  readonly catalogHardware: readonly Hardware[];
  readonly policySource?: CatalogHingePolicySource;
  readonly optionChoices: OptionChoices;
  readonly placementCounts: ReadonlyMap<string, number>;
  readonly moduleCode: string;
}): HingeBandDemand {
  const doors = params.parts.filter(
    (part) => part.componentPlacement === 'puerta',
  );
  if (doors.length === 0) {
    return { counts: new Map(), lines: [] };
  }

  // #1579: per resolved hardware; `overflowHeightMm` > 0 marks the tallest
  // door that exceeded the table's last band under that hardware.
  const quantities = new Map<
    string,
    { quantity: number; role: string; overflowHeightMm: number; overflow?: HingeCount }
  >();
  for (const door of doors) {
    const policy = hingePolicyForComponent(
      params.policySource,
      door.catalogComponentId,
    );
    const role = hingeDemandRole(policy);
    const resolution = resolvePlacementHardwareId(
      { optionRole: role },
      params.optionChoices,
    );
    if (resolution.status === 'invalid') {
      throw new ResolutionError(
        'Hinge band demand resolved an invalid identity',
        { moduleCode: params.moduleCode, field: 'hingeDemand' },
      );
    }
    if (resolution.status !== 'resolved' && resolution.status !== 'concrete') {
      continue;
    }
    const hardwareId = resolution.hardwareId;
    const known = params.catalogHardware.some((hw) => hw.id === hardwareId);
    if (!known) {
      throw new ResolutionError(
        `Hinge band demand choice for role "${role}" points at unknown hardware "${hardwareId}"`,
        { moduleCode: params.moduleCode, field: 'hingeDemand' },
      );
    }
    if (params.placementCounts.has(hardwareId)) {
      continue;
    }
    // #1579: the hinge effectively chosen for THIS door may declare its own
    // table; it outranks the factory family, the component exception
    // outranks it.
    const hinge = params.catalogHardware.find((hw) => hw.id === hardwareId);
    const count = resolveHingeCount(
      door.lengthMm,
      door.widthMm,
      hingePolicyForDoor(params.policySource, door.catalogComponentId, hinge),
    );
    const doorQty = door.quantity > 0 ? door.quantity : 1;
    const entry = quantities.get(hardwareId) ?? {
      quantity: 0,
      role,
      overflowHeightMm: 0,
    };
    entry.quantity += count.hinges * doorQty;
    if (count.aboveLastBand && door.lengthMm > entry.overflowHeightMm) {
      entry.overflowHeightMm = door.lengthMm;
      entry.overflow = count;
    }
    quantities.set(hardwareId, entry);
  }

  if (quantities.size === 0) {
    return { counts: new Map(), lines: [] };
  }
  const counts = new Map<string, number>();
  const lines: ResolvedHardwareLine[] = [];
  for (const [hardwareId, entry] of quantities) {
    counts.set(hardwareId, entry.quantity);
    const notice = entry.overflow
      ? hingeDemandNotice(entry.overflowHeightMm, entry.overflow)
      : undefined;
    lines.push({
      id: `${HINGE_DEMAND_LINE_PREFIX}${hardwareId}`,
      quantity: entry.quantity,
      descriptionOverride: HINGE_DEMAND_DESCRIPTION,
      optionRole: entry.role,
      hardwareId,
      ...(notice ? { notice } : {}),
    });
  }
  return { counts, lines };
}

/**
 * Bulk lines the band replaces (same resolved hardware), kept verbatim
 * otherwise — mirror of the placement filter, one rung down the ladder.
 */
export function moduleHardwareWithoutHingeBand(
  lines: readonly HardwareLine[],
  bandCounts: ReadonlyMap<string, number>,
  optionChoices: OptionChoices,
): HardwareLine[] {
  if (bandCounts.size === 0) return [...lines];
  return lines.filter((line) => {
    const resolution = resolvePlacementHardwareId(line, optionChoices);
    if (resolution.status === 'invalid' || resolution.status === 'unresolved') {
      return true;
    }
    return !bandCounts.has(resolution.hardwareId);
  });
}

/** Append the band demand lines to an already-resolved BOM (after #1210's). */
export function withHingeBandDemand(
  bom: ResolvedBom,
  lines: readonly ResolvedHardwareLine[],
): ResolvedBom {
  if (lines.length === 0) return bom;
  return { ...bom, hardwareLines: [...bom.hardwareLines, ...lines] };
}
