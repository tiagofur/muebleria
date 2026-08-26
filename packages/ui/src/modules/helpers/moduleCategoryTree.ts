/**
 * Module category hierarchy traversal and filtering helpers.
 */

import type { Module, ModuleCategory } from '@granete/domain';
import { childrenOf } from '@granete/domain';
import { matchesCodeOrName } from '../../catalogs/catalogHelpers';
import { formatMoneyDisplay } from '../../common/formatMoneyDisplay';

export type CategoryDraft = {
  name: string;
  parentId: string;
  sortOrder: string;
};

export function emptyCategoryDraft(): CategoryDraft {
  return { name: '', parentId: '', sortOrder: '0' };
}

export const SEED_MODULE_CODES = ['MOD-GAB-01', 'MOD-CAJ-01'] as const;

export function filterModulesByQuery(
  modules: readonly Module[],
  query: string,
): Module[] {
  const q = query.trim().toLocaleLowerCase('es-UY');
  if (!q) return [...modules];
  return modules.filter((m) =>
    matchesCodeOrName({ code: m.code, name: m.name }, q),
  );
}

/** Flat indented labels for parent picker / admin lists (DFS by sortOrder). */
export function flattenCategoriesForSelect(
  categories: readonly ModuleCategory[],
): { id: string; label: string; depth: number }[] {
  const out: { id: string; label: string; depth: number }[] = [];
  const walk = (parentId: string | undefined, depth: number) => {
    for (const c of childrenOf(categories, parentId)) {
      const indent = depth > 0 ? `${'—'.repeat(depth)} ` : '';
      out.push({ id: c.id, label: `${indent}${c.name}`, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(undefined, 0);
  return out;
}

export function formatModuleMoney(n: number | null | undefined): string {
  return formatMoneyDisplay(n);
}
