/**
 * #497 T5/T6 — pure helpers behind the Parámetros editor tab.
 *
 * The SERVER owns definition validity and resolved consequences (ownership
 * boundary): these helpers exist so the editor can show honest, immediate
 * feedback — composition targets, ambiguity and kind/type compatibility —
 * using the same rules the Go consumer validator enforces
 * (ValidateModuleFurnitureParameterConsumers: a behavioral binding must
 * reference exactly ONE unambiguous direct component entry, and exactly one
 * entry overall). Nothing here invents semantics.
 */

import type { FurnitureParameter, Structure } from '@granete/domain';

type AuthorableBindingKind = Extract<
  NonNullable<FurnitureParameter['binding']>['kind'],
  'componentQuantity' | 'componentCondition' | 'agregadoQuantity' | 'agregadoCondition'
>;

export type CompositionEntrySource = 'direct' | 'structure';

export type CompositionBindingEntry = {
  readonly componentId: string;
  readonly source: CompositionEntrySource;
};

/** #1386: agregado instances as binding targets, keyed by agregadoId. */
export type AgregadoBindingEntry = {
  readonly agregadoId: string;
  readonly source: CompositionEntrySource;
};

type CountedEntryView<T extends { source: CompositionEntrySource }> = T & {
  /** How many composition instances reference this target id. */
  readonly entryCount: number;
  /** How many DIRECT module instances reference this target id. */
  readonly directCount: number;
  /**
   * 'ok' = exactly one direct entry and one overall entry (the only state the
   * server accepts for the behavioral bindings). 'ambiguous' = more than one
   * entry (never auto-select; the composition must be disambiguated).
   * 'unknown' = not in the composition at all.
   */
  readonly state: 'ok' | 'ambiguous' | 'unknown';
};

export type CompositionBindingEntryView = CountedEntryView<CompositionBindingEntry>;

export type AgregadoBindingEntryView = CountedEntryView<AgregadoBindingEntry>;

function countEntryStates<K extends 'componentId' | 'agregadoId', T extends { source: CompositionEntrySource } & Record<K, string>>(
  entries: readonly T[],
  key: K,
): CountedEntryView<T>[] {
  const directCounts = new Map<string, number>();
  const allCounts = new Map<string, number>();
  for (const entry of entries) {
    const id = entry[key];
    allCounts.set(id, (allCounts.get(id) ?? 0) + 1);
    if (entry.source === 'direct') {
      directCounts.set(id, (directCounts.get(id) ?? 0) + 1);
    }
  }

  const seen = new Set<string>();
  const views: CountedEntryView<T>[] = [];
  for (const entry of entries) {
    const id = entry[key];
    if (seen.has(id)) continue;
    seen.add(id);
    const entryCount = allCounts.get(id) ?? 0;
    const directCount = directCounts.get(id) ?? 0;
    views.push({
      ...entry,
      entryCount,
      directCount,
      state: entryCount === 1 && directCount === 1 ? 'ok' : entryCount > 1 ? 'ambiguous' : 'unknown',
    });
  }
  return views;
}

/**
 * Composition entries available as binding targets: instances placed directly
 * on the module plus the ones inherited from its structure (the same walk the
 * Go consumer validator performs).
 */
export function compositionBindingEntries(
  directComponentIds: readonly string[],
  structure: Structure | undefined,
): CompositionBindingEntryView[] {
  const entries: CompositionBindingEntry[] = directComponentIds
    .filter((id) => id.trim() !== '')
    .map((componentId) => ({ componentId: componentId.trim(), source: 'direct' as const }));
  if (structure) {
    for (const instance of structure.components ?? []) {
      entries.push({ componentId: instance.componentId, source: 'structure' });
    }
  }
  return countEntryStates(entries, 'componentId');
}

/**
 * #1386: agregado instances available as binding targets — direct module
 * placements plus the ones inherited from its structure (the same walk the
 * Go consumer validator performs for agregadoQuantity/agregadoCondition).
 */
export function agregadoBindingEntries(
  directAgregadoIds: readonly string[],
  structure: Structure | undefined,
): AgregadoBindingEntryView[] {
  const entries: AgregadoBindingEntry[] = directAgregadoIds
    .filter((id) => id.trim() !== '')
    .map((agregadoId) => ({ agregadoId: agregadoId.trim(), source: 'direct' as const }));
  if (structure) {
    for (const instance of structure.agregados ?? []) {
      entries.push({ agregadoId: instance.agregadoId, source: 'structure' });
    }
  }
  return countEntryStates(entries, 'agregadoId');
}

export type BindingKindCompatibility =
  | 'compatible'
  | 'requires-integer-number'
  | 'requires-boolean';

/**
 * Which behavioral binding kinds the persisted contract allows for a
 * parameter type: the quantity kinds own an integer number, the condition
 * kinds own a boolean. dimensionColumn is projection-only and
 * structureRelationship is resolver-only — neither is authorable here.
 */
export function bindingKindCompatibility(
  parameterType: FurnitureParameter['type'],
  kind: AuthorableBindingKind,
  integer = false,
): BindingKindCompatibility {
  if (kind === 'componentQuantity' || kind === 'agregadoQuantity') {
    // The persisted contract requires an integer number for quantities.
    return parameterType === 'number' && integer ? 'compatible' : 'requires-integer-number';
  }
  return parameterType === 'boolean' ? 'compatible' : 'requires-boolean';
}

/** Authorable kinds for a parameter type, in stable display order. */
export function authorableBindingKinds(
  parameterType: FurnitureParameter['type'],
  integer = false,
): readonly {
  kind: AuthorableBindingKind;
  compatibility: BindingKindCompatibility;
}[] {
  return [
    { kind: 'componentQuantity', compatibility: bindingKindCompatibility(parameterType, 'componentQuantity', integer) },
    { kind: 'componentCondition', compatibility: bindingKindCompatibility(parameterType, 'componentCondition') },
    { kind: 'agregadoQuantity', compatibility: bindingKindCompatibility(parameterType, 'agregadoQuantity', integer) },
    { kind: 'agregadoCondition', compatibility: bindingKindCompatibility(parameterType, 'agregadoCondition') },
  ];
}

export type ReservedDimensionProjection = {
  readonly name: 'widthMm' | 'heightMm' | 'depthMm';
  readonly label: string;
  readonly unit: 'mm';
  /** "300–1200" when several candidate sizes exist, "" for a single value. */
  readonly rangeText: string;
  readonly defaultValueText: string;
};

const RESERVED_DIMENSION_SPECS: readonly {
  name: ReservedDimensionProjection['name'];
  label: string;
  base: number;
  preset: (p: { width: number; height: number; depth: number }) => number;
}[] = [
  { name: 'widthMm', label: 'Ancho (mm)', base: 0, preset: (p) => p.width },
  { name: 'heightMm', label: 'Alto (mm)', base: 0, preset: (p) => p.height },
  { name: 'depthMm', label: 'Fondo (mm)', base: 0, preset: (p) => p.depth },
];

/**
 * Read-only projections of the reserved dimensions: they are derived from the
 * module's base measures and its commercial presets (never authored as
 * parameters — the persisted boundary rejects those names).
 */
export function reservedDimensionProjections(
  externalWidth: string,
  externalHeight: string,
  externalDepth: string,
  presets: readonly { width: number; height: number; depth: number }[],
): ReservedDimensionProjection[] {
  const bases = [externalWidth, externalHeight, externalDepth].map((v) => Number(v));
  const specs = RESERVED_DIMENSION_SPECS.map((spec, index) => ({
    ...spec,
    base: bases[index] ?? 0,
  }));
  return specs.map((spec) => {
    const candidates: number[] = [];
    if (spec.base > 0) candidates.push(spec.base);
    for (const preset of presets) {
      const value = spec.preset(preset);
      if (value > 0) candidates.push(value);
    }
    const defaultValue = spec.base > 0 ? spec.base : (candidates[0] ?? 0);
    const min = candidates.length > 0 ? Math.min(...candidates) : 0;
    const max = candidates.length > 0 ? Math.max(...candidates) : 0;
    const rangeText = candidates.length > 1 ? `${min}–${max}` : '';
    return {
      name: spec.name,
      label: spec.label,
      unit: 'mm' as const,
      rangeText,
      defaultValueText: defaultValue > 0 ? `${defaultValue}` : 'sin definir',
    };
  });
}

/**
 * Renumbers sortOrder sequentially (1..n) so display order stays the single
 * source of presentation order (the projection sorts by sortOrder, then name).
 */
export function renumberSortOrders<T extends { sortOrder?: number }>(list: readonly T[]): T[] {
  return list.map((item, index) => ({ ...item, sortOrder: index + 1 }));
}

/** Moves one entry (by current display position) up or down, renumbering. */
export function moveParameterDefinition<T extends { sortOrder?: number }>(
  list: readonly T[],
  position: number,
  direction: 'up' | 'down',
): T[] {
  const target = direction === 'up' ? position - 1 : position + 1;
  if (position < 0 || position >= list.length || target < 0 || target >= list.length) {
    return [...list];
  }
  const next = [...list];
  const [moved] = next.splice(position, 1);
  if (moved === undefined) return [...list];
  next.splice(target, 0, moved);
  return renumberSortOrders(next);
}
