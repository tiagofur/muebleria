/**
 * F144 — historia del plano por intención (North Star §12: un gesto = una
 * intención = una entrada de undo). Módulo puro sin React.
 *
 * Cada entrada guarda un snapshot ANTERIOR de layout + de los ítems afectados
 * (completos: quantity, customDims, …) y una etiqueta para la UI
 * ("Deshacer: Mover 2 muebles"). Entradas con la misma `coalesceKey` dentro
 * de una ventana de tiempo se pliegan: la ráfaga "←←←" es UNA entrada cuyo
 * before sigue siendo el estado original.
 *
 * No usamos el CommandManager genérico de domain: el estado del plano vive en
 * el componente padre y viaja por callbacks (onChangeLayout/onUpdateItem);
 * replicamos sus semánticas (límite, labels, redo-clear) sobre snapshots.
 */

import type {
  ProjectItem,
  ProjectKitchenLayout,
} from '@muebles/domain';

export type PlanHistoryEntry = {
  /** Etiqueta de la intención (español, para "Deshacer: …"). */
  readonly intent: string;
  /** Layout anterior a la intención. */
  readonly layout: ProjectKitchenLayout;
  /** Ítems completos antes de la intención (quantity, customDims, …). */
  readonly itemSnapshots: readonly ProjectItem[];
  /** Clave de coalescing (ej. 'nudge'); sin clave = siempre entrada nueva. */
  readonly coalesceKey?: string;
  /** Marca temporal (ms) para la ventana de coalescing. */
  readonly ts: number;
};

/** Ventana por defecto para plegar ráfagas (ms). */
export const PLAN_HISTORY_COALESCE_MS = 1200;

export const PLAN_HISTORY_LIMIT = 30;

/**
 * Pushea una entrada al stack de undo con coalescing. Devuelve el nuevo
 * stack (límite aplicado). Cuando el tope tiene la misma coalesceKey y está
 * dentro de la ventana, la nueva entrada NO se apila: se conserva el before
 * original del tope (deshacer vuelve al estado previo a la ráfaga) y sólo se
 * refresca su ts para extender la ventana.
 */
export function pushPlanHistory(
  stack: readonly PlanHistoryEntry[],
  entry: PlanHistoryEntry,
  opts: { readonly coalesceMs?: number } = {},
): readonly PlanHistoryEntry[] {
  const window = opts.coalesceMs ?? PLAN_HISTORY_COALESCE_MS;
  const top = stack[stack.length - 1];
  if (
    top &&
    entry.coalesceKey !== undefined &&
    top.coalesceKey === entry.coalesceKey &&
    entry.ts - top.ts <= window
  ) {
    const rest = stack.slice(0, -1);
    return [...rest, { ...top, ts: entry.ts }];
  }
  return [...stack.slice(-(PLAN_HISTORY_LIMIT - 1)), entry];
}

/** Etiqueta del próximo undo ("Deshacer: …") o null. */
export function undoLabelOf(
  stack: readonly PlanHistoryEntry[],
): string | null {
  return stack[stack.length - 1]?.intent ?? null;
}

/** Etiqueta del próximo redo ("Rehacer: …") o null. */
export function redoLabelOf(
  stack: readonly PlanHistoryEntry[],
): string | null {
  return stack[stack.length - 1]?.intent ?? null;
}

/**
 * El snapshot de ítems "después" que acompaña un undo/redo: la contracara de
 * la entrada que se restaurará, para que el redo vuelva al estado que el
 * usuario veía antes de deshacer. Usa el estado actual de los ítems de la
 * entrada (post-intención) cuando el caller lo pasa.
 */
export function snapshotItems(
  items: readonly ProjectItem[],
  itemIds: readonly string[],
): readonly ProjectItem[] {
  const ids = new Set(itemIds);
  return items.filter((i) => ids.has(i.id));
}
