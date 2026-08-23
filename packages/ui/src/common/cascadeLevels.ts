/**
 * cascadeLevels — cascada de filtros por nivel de categoría compartida por
 * los navegadores de Proyectar (Biblioteca de muebles F141, Tableros F142).
 * Un renglón de chips por nivel; el último renglón aparece sólo si el nivel
 * tiene hijos. Pura y testeable.
 */

import type { CategoryNode } from '@muebles/domain';
import { childrenOf } from '@muebles/domain';

export type CascadeLevelRow = {
  readonly options: readonly CategoryNode[];
  readonly selectedId: string | null;
};

/**
 * Descarta ids que dejaron de existir o que ya no cuelgan del nivel anterior
 * (categorías renombradas/re-migradas del catálogo).
 */
export function sanitizeCategoryPath(
  categories: readonly CategoryNode[],
  path: readonly string[],
): string[] {
  const valid: string[] = [];
  let parent: string | undefined;
  for (const id of path) {
    const exists = categories.some(
      (c) => c.id === id && (c.parentId ?? undefined) === parent,
    );
    if (!exists) break;
    valid.push(id);
    parent = id;
  }
  return valid;
}

/**
 * Renglones de la cascada: uno por nivel seleccionado + el siguiente nivel
 * disponible (sólo si tiene hijos).
 */
export function cascadeLevels(
  categories: readonly CategoryNode[],
  path: readonly string[],
): CascadeLevelRow[] {
  const rows: CascadeLevelRow[] = [];
  let parent: string | undefined;
  for (const selectedId of path) {
    rows.push({ options: childrenOf(categories, parent), selectedId });
    parent = selectedId;
  }
  const next = childrenOf(categories, parent);
  if (next.length > 0) {
    rows.push({ options: next, selectedId: null });
  }
  return rows;
}

/** Label por nivel: Categoría / Subcategoría / Nivel N. */
export function cascadeLevelLabel(index: number): string {
  if (index === 0) return 'Categoría';
  if (index === 1) return 'Subcategoría';
  return `Nivel ${index + 1}`;
}
