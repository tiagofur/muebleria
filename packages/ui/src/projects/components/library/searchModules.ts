/**
 * searchModules — búsqueda tolerante de módulos del catálogo para la
 * biblioteca lateral de Proyectar (F141 / #309). Pura y testeable en jsdom:
 * normaliza acentos/mayúsculas/espacios y matchea nombre, código o el nombre
 * de cualquier categoría de la ruta del módulo.
 */

import type { CategoryNode, Module } from '@granete/domain';
import { categoryPath } from '@granete/domain';

/** Normaliza texto para búsqueda: minúsculas, sin diacríticos, espacios colapsados. */
export function normalizeSearchText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function moduleSearchHays(
  mod: Module,
  categories: readonly CategoryNode[],
): string {
  const parts = [mod.name ?? '', mod.code ?? ''];
  for (const node of categoryPath(mod.categoryId, categories)) {
    parts.push(node.name);
  }
  return normalizeSearchText(parts.join(' '));
}

/**
 * Filtra módulos por query tolerante. Query vacía ⇒ devuelve todos (sin
 * filtrar por texto). El orden del catálogo se preserva (sin scoring v1).
 */
export function searchModules(
  modules: readonly Module[],
  query: string,
  categories: readonly CategoryNode[] = [],
): Module[] {
  const q = normalizeSearchText(query);
  if (!q) return [...modules];
  const terms = q.split(' ');
  return modules.filter((mod) => {
    const hays = moduleSearchHays(mod, categories);
    return terms.every((t) => hays.includes(t));
  });
}
