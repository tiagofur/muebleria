/**
 * Hierarchical module categories — pure helpers (MOD-09 / PRJ-11).
 * Depth: root = 1, max = 3 levels.
 */

import type { Module, ModuleCategory } from './types';
import { ValidationError } from './errors';

/** Maximum depth of a category node (root is depth 1). */
export const MAX_CATEGORY_DEPTH = 3 as const;

/** Sentinel filter: modules with no categoryId. */
export const UNCATEGORIZED_FILTER = '__uncategorized__' as const;

export type CategoryFilterId = string | typeof UNCATEGORIZED_FILTER | null;

function byIdMap(
  categories: readonly ModuleCategory[],
): Map<string, ModuleCategory> {
  return new Map(categories.map((c) => [c.id, c]));
}

/**
 * Depth of a category (1 = root). Returns 0 if id is missing from the set.
 */
export function categoryDepth(
  categoryId: string | undefined,
  categories: readonly ModuleCategory[],
): number {
  if (!categoryId) return 0;
  const map = byIdMap(categories);
  let depth = 0;
  let current: string | undefined = categoryId;
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current)) {
      throw new ValidationError('Category hierarchy has a cycle', {
        categoryId: current,
      });
    }
    seen.add(current);
    const node = map.get(current);
    if (!node) return 0;
    depth += 1;
    if (depth > MAX_CATEGORY_DEPTH + 1) {
      throw new ValidationError('Category hierarchy exceeds max depth', {
        categoryId,
        maxDepth: MAX_CATEGORY_DEPTH,
      });
    }
    current = node.parentId;
  }
  return depth;
}

/** Direct children of parentId (undefined = roots), sorted by sortOrder then name. */
export function childrenOf(
  categories: readonly ModuleCategory[],
  parentId?: string,
): ModuleCategory[] {
  const list = categories.filter((c) =>
    parentId === undefined
      ? c.parentId === undefined || c.parentId === ''
      : c.parentId === parentId,
  );
  return [...list].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.name.localeCompare(b.name, 'es');
  });
}

/** All descendant ids of rootId (not including rootId). */
export function collectDescendantIds(
  rootId: string,
  categories: readonly ModuleCategory[],
): string[] {
  const result: string[] = [];
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const child of categories) {
      if (child.parentId === id) {
        result.push(child.id);
        queue.push(child.id);
      }
    }
  }
  return result;
}

/**
 * Height of subtree rooted at categoryId: 1 if leaf, else 1 + max child height.
 */
export function subtreeHeight(
  categoryId: string,
  categories: readonly ModuleCategory[],
): number {
  const kids = childrenOf(categories, categoryId);
  if (kids.length === 0) return 1;
  let maxChild = 0;
  for (const k of kids) {
    maxChild = Math.max(maxChild, subtreeHeight(k.id, categories));
  }
  return 1 + maxChild;
}

/**
 * Validate placing a category under parentId.
 * - For create: movingId undefined, subtreeHeight = 1
 * - For move: movingId set; resulting depth of deepest descendant must be ≤ 3
 * Throws ValidationError if invalid.
 */
export function assertCategoryPlacement(
  parentId: string | undefined,
  categories: readonly ModuleCategory[],
  options?: {
    readonly movingId?: string;
    readonly name?: string;
  },
): void {
  const movingId = options?.movingId;
  if (movingId && parentId === movingId) {
    throw new ValidationError('A category cannot be its own parent', {
      categoryId: movingId,
    });
  }
  if (movingId && parentId) {
    const descendants = collectDescendantIds(movingId, categories);
    if (descendants.includes(parentId)) {
      throw new ValidationError('Cannot move a category under its descendant', {
        categoryId: movingId,
        parentId,
      });
    }
  }

  const parentDepth = parentId ? categoryDepth(parentId, categories) : 0;
  if (parentId && parentDepth === 0) {
    throw new ValidationError('Parent category not found', { parentId });
  }
  if (parentDepth >= MAX_CATEGORY_DEPTH) {
    throw new ValidationError(
      `Categories cannot exceed ${MAX_CATEGORY_DEPTH} levels`,
      { parentId, parentDepth, maxDepth: MAX_CATEGORY_DEPTH },
    );
  }

  const height = movingId ? subtreeHeight(movingId, categories) : 1;
  const resultingMaxDepth = parentDepth + height;
  if (resultingMaxDepth > MAX_CATEGORY_DEPTH) {
    throw new ValidationError(
      `Categories cannot exceed ${MAX_CATEGORY_DEPTH} levels`,
      {
        parentId,
        parentDepth,
        subtreeHeight: height,
        resultingMaxDepth,
        maxDepth: MAX_CATEGORY_DEPTH,
      },
    );
  }

  const name = options?.name?.trim();
  if (name !== undefined && name.length === 0) {
    throw new ValidationError('Category name is required');
  }
}

/** True if creating/moving under parentId is allowed. */
export function canPlaceCategory(
  parentId: string | undefined,
  categories: readonly ModuleCategory[],
  movingId?: string,
): boolean {
  try {
    assertCategoryPlacement(parentId, categories, { movingId });
    return true;
  } catch {
    return false;
  }
}

/**
 * Set of category ids matching a filter node (node + all descendants).
 * null filter = no category restriction.
 */
export function categoryFilterIdSet(
  filterId: CategoryFilterId,
  categories: readonly ModuleCategory[],
): Set<string> | null {
  if (filterId === null) return null;
  if (filterId === UNCATEGORIZED_FILTER) return new Set();
  return new Set([filterId, ...collectDescendantIds(filterId, categories)]);
}

/**
 * Filter modules by category tree node (includes descendants) or uncategorized.
 * filterId null = all modules.
 */
export function filterModulesByCategory(
  modules: readonly Module[],
  filterId: CategoryFilterId,
  categories: readonly ModuleCategory[],
): Module[] {
  if (filterId === null) return [...modules];
  if (filterId === UNCATEGORIZED_FILTER) {
    return modules.filter((m) => !m.categoryId);
  }
  const allowed = categoryFilterIdSet(filterId, categories)!;
  return modules.filter((m) => m.categoryId && allowed.has(m.categoryId));
}

/** Breadcrumb path from root to category (inclusive). */
export function categoryPath(
  categoryId: string | undefined,
  categories: readonly ModuleCategory[],
): ModuleCategory[] {
  if (!categoryId) return [];
  const map = byIdMap(categories);
  const path: ModuleCategory[] = [];
  let current: string | undefined = categoryId;
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current)) break;
    seen.add(current);
    const node = map.get(current);
    if (!node) break;
    path.unshift(node);
    current = node.parentId;
  }
  return path;
}

/** Cascade select levels: roots, then children of selected L1, etc. */
export function cascadeOptions(
  categories: readonly ModuleCategory[],
  selected: {
    readonly level1Id?: string;
    readonly level2Id?: string;
    readonly level3Id?: string;
  },
): {
  readonly level1: ModuleCategory[];
  readonly level2: ModuleCategory[];
  readonly level3: ModuleCategory[];
} {
  const level1 = childrenOf(categories, undefined);
  const level2 = selected.level1Id
    ? childrenOf(categories, selected.level1Id)
    : [];
  const level3 = selected.level2Id
    ? childrenOf(categories, selected.level2Id)
    : [];
  return { level1, level2, level3 };
}

/**
 * Effective category id from cascade picks (deepest selected).
 */
export function cascadeSelectedCategoryId(selected: {
  readonly level1Id?: string;
  readonly level2Id?: string;
  readonly level3Id?: string;
}): string | undefined {
  return selected.level3Id || selected.level2Id || selected.level1Id || undefined;
}

/** Expand categoryId into cascade level ids. */
export function cascadeFromCategoryId(
  categoryId: string | undefined,
  categories: readonly ModuleCategory[],
): {
  readonly level1Id?: string;
  readonly level2Id?: string;
  readonly level3Id?: string;
} {
  const path = categoryPath(categoryId, categories);
  return {
    level1Id: path[0]?.id,
    level2Id: path[1]?.id,
    level3Id: path[2]?.id,
  };
}
