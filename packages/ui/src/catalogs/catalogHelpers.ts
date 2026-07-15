/**
 * Pure catalog UI helpers — uniqueness, active filters, search (no domain cost logic).
 */

export interface CodedCatalogItem {
  readonly id: string;
  readonly code: string;
  readonly active: boolean;
}

export interface ActiveFilterable {
  readonly active: boolean;
}

/** Status chips filter — design.md §4.6. */
export type CatalogStatusFilter = 'all' | 'active' | 'inactive';

export interface SearchableCoded {
  readonly code: string;
  readonly name: string;
}

/** Normalize business codes for comparison (trim + case-insensitive). */
export function normalizeCode(code: string): string {
  return code.trim().toLocaleUpperCase('es-UY');
}

/**
 * CAT-04: no two *active* entities of the same type may share a code.
 * Inactive codes may be reused by a new/edited active item.
 */
export function findActiveCodeConflict(
  code: string,
  items: readonly CodedCatalogItem[],
  excludeId?: string,
): CodedCatalogItem | undefined {
  const normalized = normalizeCode(code);
  if (!normalized) return undefined;
  return items.find(
    (item) =>
      item.active &&
      item.id !== excludeId &&
      normalizeCode(item.code) === normalized,
  );
}

/**
 * Validate code uniqueness for create/update.
 * Returns a Spanish error message or `null` if valid.
 */
export function validateUniqueCode(
  code: string,
  items: readonly CodedCatalogItem[],
  excludeId?: string,
): string | null {
  const trimmed = code.trim();
  if (!trimmed) {
    return 'El código es obligatorio.';
  }
  const conflict = findActiveCodeConflict(trimmed, items, excludeId);
  if (conflict) {
    return `Ya existe un ítem activo con el código "${conflict.code}".`;
  }
  return null;
}

export type FilterCatalogOptions<T> = {
  /**
   * Legacy CAT-05: when `status` is omitted, `showInactive: false` (default)
   * hides inactive rows; `true` shows all.
   */
  readonly showInactive?: boolean;
  /** Preferred filter: Todos / Activos / Inactivos chips. Overrides showInactive. */
  readonly status?: CatalogStatusFilter;
  /** Free-text query (already debounced by the UI). Matched against code + name by default. */
  readonly query?: string;
  /** Custom matcher when default code/name search is not enough. */
  readonly matchItem?: (item: T, normalizedQuery: string) => boolean;
};

function normalizeQuery(query: string): string {
  return query.trim().toLocaleLowerCase('es-UY');
}

/** Default search: code + name contains query (case-insensitive). */
export function matchesCodeOrName(
  item: SearchableCoded,
  normalizedQuery: string,
): boolean {
  if (!normalizedQuery) return true;
  const hay = `${item.code} ${item.name}`.toLocaleLowerCase('es-UY');
  return hay.includes(normalizedQuery);
}

/**
 * List filter: status chips + optional search.
 * Back-compat: without `status`, hides inactive by default (CAT-05).
 */
export function filterCatalogItems<T extends ActiveFilterable>(
  items: readonly T[],
  options?: FilterCatalogOptions<T>,
): T[] {
  let result: T[];

  if (options?.status != null) {
    switch (options.status) {
      case 'active':
        result = items.filter((item) => item.active);
        break;
      case 'inactive':
        result = items.filter((item) => !item.active);
        break;
      case 'all':
      default:
        result = [...items];
        break;
    }
  } else if (options?.showInactive) {
    result = [...items];
  } else {
    result = items.filter((item) => item.active);
  }

  const q = options?.query != null ? normalizeQuery(options.query) : '';
  if (!q) {
    return result;
  }

  if (options?.matchItem) {
    return result.filter((item) => options.matchItem!(item, q));
  }

  return result.filter((item) => {
    const coded = item as T & Partial<SearchableCoded>;
    if (typeof coded.code === 'string' && typeof coded.name === 'string') {
      return matchesCodeOrName(
        { code: coded.code, name: coded.name },
        q,
      );
    }
    return true;
  });
}

/**
 * Picker filter: only active items by default (CAT-05).
 * Pass `includeInactive: true` only for admin/debug pickers.
 */
export function filterActiveForPicker<T extends ActiveFilterable>(
  items: readonly T[],
  options?: { readonly includeInactive?: boolean },
): T[] {
  if (options?.includeInactive) {
    return [...items];
  }
  return items.filter((item) => item.active);
}

export function validateRequiredName(name: string): string | null {
  if (!name.trim()) {
    return 'El nombre es obligatorio.';
  }
  return null;
}

export function validateNonNegativeNumber(
  value: number,
  fieldLabel: string,
): string | null {
  if (!Number.isFinite(value) || value < 0) {
    return `${fieldLabel} debe ser un número mayor o igual a 0.`;
  }
  return null;
}
