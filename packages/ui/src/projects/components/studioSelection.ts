/**
 * F143 — lógica pura de selección múltiple del studio de Proyectar.
 * La selección es una lista ordenada de claves `${itemId}#${instanceIndex}`;
 * la primera es la primaria (alimenta el inspector y sirve de referencia
 * para "pegar a…"). El orden = orden de clic; Ctrl/Cmd alterna y Shift añade
 * (rango sólo en la lista, donde existe un orden visible).
 */

export type StudioSelection = {
  readonly keys: readonly string[];
  readonly anchorKey: string | null;
};

export const EMPTY_STUDIO_SELECTION: StudioSelection = {
  keys: [],
  anchorKey: null,
};

export type SelectionModifiers = {
  readonly shift?: boolean;
  readonly ctrlOrMeta?: boolean;
};

export function modifiersFromPointer(e: {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}): SelectionModifiers {
  return {
    shift: e.shiftKey,
    ctrlOrMeta: e.ctrlKey || e.metaKey,
  };
}

export function primarySelectionKey(
  selection: StudioSelection,
): string | null {
  return selection.keys[0] ?? null;
}

export function isSelected(
  selection: StudioSelection,
  key: string,
): boolean {
  return selection.keys.includes(key);
}

/** Click simple / con modificadores sobre una unidad (canvas, lista, plano 2D). */
export function applySelectionClick(
  selection: StudioSelection,
  key: string,
  modifiers: SelectionModifiers,
): StudioSelection {
  if (modifiers.ctrlOrMeta) {
    if (selection.keys.includes(key)) {
      const keys = selection.keys.filter((k) => k !== key);
      return {
        keys,
        anchorKey:
          selection.anchorKey === key ? (keys[0] ?? null) : selection.anchorKey,
      };
    }
    return { keys: [...selection.keys, key], anchorKey: key };
  }
  if (modifiers.shift) {
    // En el canvas no hay orden visible: Shift añade sin alternar.
    if (selection.keys.includes(key)) return selection;
    return { keys: [...selection.keys, key], anchorKey: selection.anchorKey };
  }
  return { keys: [key], anchorKey: key };
}

/**
 * Shift+click en la lista: rango contiguo entre el ancla y el objetivo
 * según el orden visible de `orderedKeys` (ubicadas + sin colocar).
 */
export function applySelectionRange(
  selection: StudioSelection,
  orderedKeys: readonly string[],
  toKey: string,
): StudioSelection {
  const anchor =
    selection.anchorKey && orderedKeys.includes(selection.anchorKey)
      ? selection.anchorKey
      : toKey;
  const from = orderedKeys.indexOf(anchor);
  const to = orderedKeys.indexOf(toKey);
  if (from < 0 || to < 0) {
    return { keys: [toKey], anchorKey: toKey };
  }
  const [start, end] = from <= to ? [from, to] : [to, from];
  const keys = orderedKeys.slice(start, end + 1);
  return { keys, anchorKey: anchor };
}

/** Saca claves que ya no existen (ítem borrado, cambio de ambiente, stale). */
export function pruneSelection(
  selection: StudioSelection,
  validKeys: readonly string[],
): StudioSelection {
  if (selection.keys.length === 0) return selection;
  const valid = new Set(validKeys);
  const keys = selection.keys.filter((k) => valid.has(k));
  if (keys.length === selection.keys.length) return selection;
  return {
    keys,
    anchorKey:
      selection.anchorKey !== null && valid.has(selection.anchorKey)
        ? selection.anchorKey
        : null,
  };
}
