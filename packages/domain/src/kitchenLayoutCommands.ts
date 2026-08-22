/**
 * F143/#310 — Intenciones de manipulación del plano de Proyectar:
 * duplicate, copy/paste, pegar relativo (izq/der/esquina), compactar,
 * distribuir, alinear y centrar. Funciones puras que devuelven el layout
 * resultante más los bumps de quantity que la UI debe aplicar; cada comando
 * ejecutado es una intención = una entrada de undo (North Star §12).
 */

import {
  isFreePlacement,
  placementAabb,
  type KitchenFootprint,
} from './kitchenLayout';
import type {
  ProjectItem,
  ProjectItemPlacement,
  ProjectKitchenLayout,
} from './types';

/** Separación estándar entre muebles (mismo convenio que nextOffsetOnWall). */
export const COMMAND_GAP_MM = 20;

/** `${itemId}#${instanceIndex}` — identidad de una instancia colocable. */
export type PlacementKey = string;

export type ItemQuantityPatch = {
  readonly itemId: string;
  readonly quantity: number;
};

export type LayoutCommandErrorReason =
  | 'empty-selection'
  | 'missing-item'
  | 'missing-wall'
  | 'multi-wall'
  | 'mixed-placement'
  | 'not-placed'
  | 'too-few'
  | 'no-space'
  | 'overlap';

export type LayoutCommandResult =
  | {
      readonly ok: true;
      readonly layout: ProjectKitchenLayout;
      readonly itemPatches: readonly ItemQuantityPatch[];
      /** Claves de las instancias creadas (la UI las selecciona tras el comando). */
      readonly createdKeys: readonly PlacementKey[];
      /**
       * Tras un paste: fin (mm) de la última copia por muro, para que pegar de
       * nuevo continúe marchando hacia la derecha en vez de pisar la anterior.
       */
      readonly nextCursorByWall?: Readonly<Record<string, number>>;
    }
  | {
      readonly ok: false;
      readonly reason: LayoutCommandErrorReason;
      readonly message: string;
    };

export type ClipboardEntry = {
  readonly key: PlacementKey;
  readonly itemId: string;
  readonly instanceIndex: number;
  readonly widthMm: number;
  readonly placement: ProjectItemPlacement | null;
};

export function parsePlacementKey(
  key: PlacementKey,
): { readonly itemId: string; readonly instanceIndex: number } | null {
  const hash = key.lastIndexOf('#');
  if (hash <= 0) return null;
  const instanceIndex = Number(key.slice(hash + 1));
  if (!Number.isInteger(instanceIndex) || instanceIndex < 0) return null;
  return { itemId: key.slice(0, hash), instanceIndex };
}

export function placementKeyOf(itemId: string, instanceIndex: number): string {
  return `${itemId}#${instanceIndex}`;
}

export function footprintMap(
  footprints: readonly KitchenFootprint[],
): Map<PlacementKey, KitchenFootprint> {
  return new Map(
    footprints.map((f) => [
      `${f.itemId}#${f.instanceIndex}`,
      f as KitchenFootprint,
    ]),
  );
}

export function widthOf(
  fpByKey: Map<PlacementKey, KitchenFootprint>,
  key: PlacementKey,
): number {
  return fpByKey.get(key)?.width ?? 600;
}

export type WallSpan = {
  readonly start: number;
  readonly end: number;
  readonly elevation: ProjectItemPlacement['elevation'];
};

function spansOnWall(
  layout: ProjectKitchenLayout,
  wallId: string,
  fpByKey: Map<PlacementKey, KitchenFootprint>,
): WallSpan[] {
  const spans: WallSpan[] = [];
  for (const p of layout.placements) {
    if (p.wallId !== wallId || isFreePlacement(p)) continue;
    const w = widthOf(fpByKey, `${p.itemId}#${p.instanceIndex}`);
    spans.push({ start: p.offsetMm, end: p.offsetMm + w, elevation: p.elevation });
  }
  return spans;
}

/**
 * Primer offset del muro donde cabe un módulo de `widthMm` con gap a ambos
 * lados (sálo contra pares de la misma elevación; piso y colgado no chocan).
 * null cuando el muro no tiene lugar.
 */
export function firstFreeOffsetOnWall(params: {
  readonly spans: readonly WallSpan[];
  readonly widthMm: number;
  readonly elevation: ProjectItemPlacement['elevation'];
  readonly wallLengthMm: number;
  readonly gapMm?: number;
}): number | null {
  const gap = params.gapMm ?? COMMAND_GAP_MM;
  const width = Math.max(1, Math.round(params.widthMm));
  const occupied = params.spans
    .filter((s) => s.elevation === params.elevation)
    .sort((a, b) => a.start - b.start);
  const candidates = [0, ...occupied.map((s) => Math.round(s.end) + gap)];
  for (const raw of candidates) {
    const c = Math.round(raw);
    if (c + width > params.wallLengthMm + 1) continue;
    const fits = occupied.every(
      (s) => Math.round(s.end) + gap <= c || c + width + gap <= Math.round(s.start),
    );
    if (fits) return c;
  }
  return null;
}

/**
 * Contador de quantities durante un comando de creación: el próximo índice de
 * un ítem es su quantity actual (las instancias son 0..q-1 por construcción)
 * y cada creación lo incrementa.
 */
class QuantityLedger {
  private readonly quantities = new Map<string, number>();
  private readonly baseline = new Map<string, number>();

  constructor(items: readonly ProjectItem[]) {
    for (const it of items) {
      this.quantities.set(it.id, Math.max(1, it.quantity));
      this.baseline.set(it.id, Math.max(1, it.quantity));
    }
  }

  has(itemId: string): boolean {
    return this.quantities.has(itemId);
  }

  /** Reserva el siguiente instanceIndex del ítem y devuelve la clave nueva. */
  createFor(itemId: string): PlacementKey {
    const q = this.quantities.get(itemId);
    if (q === undefined) {
      throw new Error(`Item desconocido: ${itemId}`);
    }
    this.quantities.set(itemId, q + 1);
    return `${itemId}#${q}`;
  }

  patches(): readonly ItemQuantityPatch[] {
    const patches: ItemQuantityPatch[] = [];
    for (const [itemId, q] of this.quantities) {
      const before = this.baseline.get(itemId);
      if (before !== undefined && q !== before) {
        patches.push({ itemId, quantity: q });
      }
    }
    return patches;
  }
}

function wallNameOf(layout: ProjectKitchenLayout, wallId: string): string {
  return layout.walls.find((w) => w.id === wallId)?.name?.trim() || 'el muro';
}

export function findPlacement(
  layout: ProjectKitchenLayout,
  key: PlacementKey,
): ProjectItemPlacement | undefined {
  const parsed = parsePlacementKey(key);
  if (!parsed) return undefined;
  return layout.placements.find(
    (p) => p.itemId === parsed.itemId && p.instanceIndex === parsed.instanceIndex,
  );
}

function nextFreeCopyPosition(
  source: ProjectItemPlacement,
  widthMm: number,
  depthMm: number,
  peerBoxes: readonly { readonly minX: number; readonly maxX: number; readonly minY: number; readonly maxY: number }[],
  gap: number,
): { readonly freeXMm: number; readonly freeYMm: number } | null {
  const x = source.freeXMm ?? 0;
  const y = source.freeYMm ?? 0;
  const candidates = [
    { freeXMm: x + widthMm + gap, freeYMm: y },
    { freeXMm: x, freeYMm: y + depthMm + gap },
  ];
  for (const c of candidates) {
    const box = placementAabb(c.freeXMm, c.freeYMm, widthMm, depthMm, source.freeYawDeg ?? 0);
    const collides = peerBoxes.some(
      (b) =>
        box.minX < b.maxX - 1 &&
        box.maxX > b.minX + 1 &&
        box.minY < b.maxY - 1 &&
        box.maxY > b.minY + 1,
    );
    if (!collides) return c;
  }
  return null;
}

function freePeerBoxes(
  layout: ProjectKitchenLayout,
  fpByKey: Map<PlacementKey, KitchenFootprint>,
  extraPlacements: readonly ProjectItemPlacement[],
  excludeKey: PlacementKey,
): { readonly minX: number; readonly maxX: number; readonly minY: number; readonly maxY: number }[] {
  const boxes: { minX: number; maxX: number; minY: number; maxY: number }[] = [];
  const all = [...layout.placements, ...extraPlacements];
  for (const p of all) {
    const key = `${p.itemId}#${p.instanceIndex}`;
    if (key === excludeKey || !isFreePlacement(p)) continue;
    const fp = fpByKey.get(key);
    boxes.push(
      placementAabb(
        p.freeXMm ?? 0,
        p.freeYMm ?? 0,
        fp?.width ?? 600,
        fp?.depth ?? 600,
        p.freeYawDeg ?? 0,
      ),
    );
  }
  return boxes;
}

/**
 * Duplicar la selección: cada instancia genera una copia del mismo ítem
 * (quantity+1, BOM/precio consistentes) trasladada a la derecha del span del
 * grupo en su muro (conserva el arreglo relativo). Islas se copian al costado
 * o debajo; fuentes sin colocar generan copias sin colocar. Atómico: si
 * alguna copia no tiene lugar, el comando falla sin tocar nada.
 */
export function duplicateSelectionCommand(params: {
  readonly layout: ProjectKitchenLayout;
  readonly items: readonly ProjectItem[];
  readonly footprints: readonly KitchenFootprint[];
  readonly keys: readonly PlacementKey[];
  readonly gapMm?: number;
}): LayoutCommandResult {
  const { layout, items, footprints, keys } = params;
  const gap = params.gapMm ?? COMMAND_GAP_MM;
  if (keys.length === 0) {
    return { ok: false, reason: 'empty-selection', message: 'No hay muebles seleccionados.' };
  }
  const fpByKey = footprintMap(footprints);
  const ledger = new QuantityLedger(items);
  const newPlacements: ProjectItemPlacement[] = [];
  const createdKeys: PlacementKey[] = [];

  // Span de la selección por muro para trasladar el grupo conservando el arreglo.
  const wallEntries = new Map<string, { offset: number; width: number }[]>();
  for (const key of keys) {
    const p = findPlacement(layout, key);
    if (!p || isFreePlacement(p)) continue;
    const list = wallEntries.get(p.wallId) ?? [];
    list.push({ offset: p.offsetMm, width: widthOf(fpByKey, key) });
    wallEntries.set(p.wallId, list);
  }
  const wallDelta = new Map<string, number>();
  for (const [wallId, entries] of wallEntries) {
    const start = Math.min(...entries.map((e) => e.offset));
    const end = Math.max(...entries.map((e) => e.offset + e.width));
    wallDelta.set(wallId, end - start + gap);
  }

  for (const key of keys) {
    const parsed = parsePlacementKey(key);
    if (!parsed || !ledger.has(parsed.itemId)) continue;
    const source = findPlacement(layout, key) ?? null;
    const width = widthOf(fpByKey, key);
    const depth = fpByKey.get(key)?.depth ?? 600;
    const createdKey = ledger.createFor(parsed.itemId);
    createdKeys.push(createdKey);

    if (!source) {
      continue; // copia sin colocar
    }
    if (isFreePlacement(source)) {
      const pos = nextFreeCopyPosition(
        source,
        width,
        depth,
        freePeerBoxes(layout, fpByKey, newPlacements, key),
        gap,
      );
      if (!pos) {
        return {
          ok: false,
          reason: 'no-space',
          message:
            'No queda lugar libre al costado de la isla. Mové un mueble y volvé a duplicar.',
        };
      }
      newPlacements.push({
        ...source,
        instanceIndex: parsePlacementKey(createdKey)!.instanceIndex,
        freeXMm: pos.freeXMm,
        freeYMm: pos.freeYMm,
      });
      continue;
    }

    const wall = layout.walls.find((w) => w.id === source.wallId);
    if (!wall) {
      return {
        ok: false,
        reason: 'missing-wall',
        message: `El muro donde estaba el mueble ya no existe (${wallNameOf(layout, source.wallId)}).`,
      };
    }
    const delta = wallDelta.get(source.wallId) ?? width + gap;
    const desired = source.offsetMm + delta;
    const wallSpans = [
      ...spansOnWall(layout, source.wallId, fpByKey),
      ...spansOf(newPlacements, source.wallId, fpByKey),
    ];
    const clashAt = (offset: number): boolean =>
      wallSpans.some(
        (s) =>
          s.elevation === source.elevation &&
          s.start + 1 < offset + width &&
          offset + 1 < s.end,
      );
    let offset: number | null =
      desired + width <= wall.lengthMm + 1 && !clashAt(desired) ? desired : null;
    if (offset === null) {
      offset = firstFreeOffsetOnWall({
        spans: wallSpans,
        widthMm: width,
        elevation: source.elevation,
        wallLengthMm: wall.lengthMm,
        gapMm: gap,
      });
    }
    if (offset === null) {
      return {
        ok: false,
        reason: 'no-space',
        message: `No queda lugar en ${wallNameOf(layout, source.wallId)} para la copia. Liberá espacio o duplicá en otro muro.`,
      };
    }
    const copy: ProjectItemPlacement = {
      ...source,
      instanceIndex: parsePlacementKey(createdKey)!.instanceIndex,
      offsetMm: offset,
    };
    newPlacements.push(copy);
  }

  return {
    ok: true,
    layout: { ...layout, placements: [...layout.placements, ...newPlacements] },
    itemPatches: ledger.patches(),
    createdKeys,
  };
}

function spansOf(
  placements: readonly ProjectItemPlacement[],
  wallId: string,
  fpByKey: Map<PlacementKey, KitchenFootprint>,
): WallSpan[] {
  return placements
    .filter((p) => p.wallId === wallId && !isFreePlacement(p))
    .map((p) => {
      const w = widthOf(fpByKey, `${p.itemId}#${p.instanceIndex}`);
      return { start: p.offsetMm, end: p.offsetMm + w, elevation: p.elevation };
    });
}

/**
 * Copiar la selección al clipboard del studio (snapshot: dims + placement).
 * Pegar crea instancias nuevas aunque la fuente se mueva o seQuite después.
 */
export function copySelectionToClipboard(params: {
  readonly layout: ProjectKitchenLayout;
  readonly keys: readonly PlacementKey[];
  readonly footprints: readonly KitchenFootprint[];
}): readonly ClipboardEntry[] {
  const fpByKey = footprintMap(params.footprints);
  const entries: ClipboardEntry[] = [];
  for (const key of params.keys) {
    const parsed = parsePlacementKey(key);
    if (!parsed) continue;
    entries.push({
      key,
      itemId: parsed.itemId,
      instanceIndex: parsed.instanceIndex,
      widthMm: widthOf(fpByKey, key),
      placement: findPlacement(params.layout, key) ?? null,
    });
  }
  return entries;
}

/**
 * Pegar el clipboard: cada entrada crea una instancia (quantity+1). En muros,
 * la copia marcha a la derecha del cursor de pegado (por defecto, a la
 * derecha de su fuente); si choca u opaca, cae al primer lugar libre del
 * muro; si no hay, el comando falla sin tocar nada. `nextCursorByWall`
 * permite repetir Ctrl+V avanzando.
 */
export function pasteClipboardCommand(params: {
  readonly layout: ProjectKitchenLayout;
  readonly items: readonly ProjectItem[];
  readonly footprints: readonly KitchenFootprint[];
  readonly entries: readonly ClipboardEntry[];
  readonly cursorByWall?: Readonly<Record<string, number>>;
  readonly gapMm?: number;
}): LayoutCommandResult {
  const { layout, items, footprints, entries } = params;
  const gap = params.gapMm ?? COMMAND_GAP_MM;
  if (entries.length === 0) {
    return {
      ok: false,
      reason: 'empty-selection',
      message: 'No hay nada copiado para pegar. Seleccioná muebles y usá Copiar.',
    };
  }
  const fpByKey = footprintMap(footprints);
  const ledger = new QuantityLedger(items);
  const newPlacements: ProjectItemPlacement[] = [];
  const createdKeys: PlacementKey[] = [];
  const cursorByWall: Record<string, number> = { ...(params.cursorByWall ?? {}) };

  for (const entry of entries) {
    if (!ledger.has(entry.itemId)) {
      return {
        ok: false,
        reason: 'missing-item',
        message: 'El mueble copiado ya no está en la cotización.',
      };
    }
    const createdKey = ledger.createFor(entry.itemId);
    createdKeys.push(createdKey);
    const instanceIndex = parsePlacementKey(createdKey)!.instanceIndex;
    const source = entry.placement;

    if (!source) {
      continue; // copia sin colocar
    }
    if (isFreePlacement(source)) {
      const pos = nextFreeCopyPosition(
        source,
        entry.widthMm,
        fpByKey.get(entry.key)?.depth ?? 600,
        freePeerBoxes(layout, fpByKey, newPlacements, entry.key),
        gap,
      );
      if (!pos) {
        return {
          ok: false,
          reason: 'no-space',
          message: 'No queda lugar libre para pegar la isla. Mové un mueble y volvé a pegar.',
        };
      }
      newPlacements.push({ ...source, instanceIndex, freeXMm: pos.freeXMm, freeYMm: pos.freeYMm });
      continue;
    }

    const wall = layout.walls.find((w) => w.id === source.wallId);
    if (!wall) {
      return {
        ok: false,
        reason: 'missing-wall',
        message: 'El muro donde estaba el mueble copiado ya no existe.',
      };
    }
    const spans = [
      ...spansOnWall(layout, source.wallId, fpByKey),
      ...spansOf(newPlacements, source.wallId, fpByKey),
    ];
    const cursor = cursorByWall[source.wallId] ?? source.offsetMm + entry.widthMm;
    let offset: number | null = cursor + gap;
    if (offset + entry.widthMm > wall.lengthMm + 1) {
      offset = firstFreeOffsetOnWall({
        spans,
        widthMm: entry.widthMm,
        elevation: source.elevation,
        wallLengthMm: wall.lengthMm,
        gapMm: gap,
      });
    } else {
      const desired = offset;
      const clash = spans.some(
        (s) =>
          s.elevation === source.elevation &&
          s.start + 1 < desired + entry.widthMm &&
          desired + 1 < s.end,
      );
      if (clash) {
        offset = firstFreeOffsetOnWall({
          spans,
          widthMm: entry.widthMm,
          elevation: source.elevation,
          wallLengthMm: wall.lengthMm,
          gapMm: gap,
        });
      }
    }
    if (offset === null) {
      return {
        ok: false,
        reason: 'no-space',
        message: `No queda lugar en ${wallNameOf(layout, source.wallId)} para pegar. Liberá espacio o pegá en otro muro.`,
      };
    }
    newPlacements.push({ ...source, instanceIndex, offsetMm: offset });
    cursorByWall[source.wallId] = offset + entry.widthMm;
  }

  return {
    ok: true,
    layout: { ...layout, placements: [...layout.placements, ...newPlacements] },
    itemPatches: ledger.patches(),
    createdKeys,
    nextCursorByWall: cursorByWall,
  };
}

/**
 * Pegar con referencia explícita: la copia va pegada a la izquierda/derecha
 * de la selección primaria o a la esquina (offset 0) de su muro. Determinista
 * — si no entra, rechaza con mensaje que enseña (sin fallback silencioso).
 */
export function pasteRelativeCommand(params: {
  readonly layout: ProjectKitchenLayout;
  readonly items: readonly ProjectItem[];
  readonly footprints: readonly KitchenFootprint[];
  readonly entries: readonly ClipboardEntry[];
  readonly refKey: PlacementKey;
  readonly side: 'left' | 'right' | 'corner';
  readonly gapMm?: number;
}): LayoutCommandResult {
  const { layout, items, footprints, entries } = params;
  const gap = params.gapMm ?? COMMAND_GAP_MM;
  const ref = findPlacement(layout, params.refKey);
  if (!ref || isFreePlacement(ref)) {
    return {
      ok: false,
      reason: 'not-placed',
      message: 'Pegá con referencia a un mueble anclado a un muro.',
    };
  }
  const wall = layout.walls.find((w) => w.id === ref.wallId);
  if (!wall) {
    return {
      ok: false,
      reason: 'missing-wall',
      message: 'El muro de referencia ya no existe.',
    };
  }
  if (entries.length === 0) {
    return {
      ok: false,
      reason: 'empty-selection',
      message: 'No hay nada copiado para pegar.',
    };
  }
  const fpByKey = footprintMap(footprints);
  const ledger = new QuantityLedger(items);
  const newPlacements: ProjectItemPlacement[] = [];
  const createdKeys: PlacementKey[] = [];
  const refWidth = widthOf(fpByKey, params.refKey);

  let cursor =
    params.side === 'right'
      ? ref.offsetMm + refWidth + gap
      : params.side === 'corner'
        ? 0
        : ref.offsetMm - gap;
  const stepSign = params.side === 'left' ? -1 : 1;

  for (const entry of entries) {
    if (!ledger.has(entry.itemId)) {
      return {
        ok: false,
        reason: 'missing-item',
        message: 'El mueble copiado ya no está en la cotización.',
      };
    }
    const createdKey = ledger.createFor(entry.itemId);
    createdKeys.push(createdKey);
    const instanceIndex = parsePlacementKey(createdKey)!.instanceIndex;
    const offset = stepSign === 1 ? cursor : cursor - entry.widthMm;
    if (offset < 0 || offset + entry.widthMm > wall.lengthMm + 1) {
      return {
        ok: false,
        reason: 'no-space',
        message: `La copia no entra ${
          params.side === 'left' ? 'a la izquierda' : params.side === 'right' ? 'a la derecha' : 'en la esquina'
        } de la referencia en ${wallNameOf(layout, wall.id)}. Probá otro lado.`,
      };
    }
    const spans = [
      ...spansOnWall(layout, wall.id, fpByKey),
      ...spansOf(newPlacements, wall.id, fpByKey),
    ];
    const clash = spans.some(
      (s) =>
        s.elevation === ref.elevation &&
        s.start + 1 < offset + entry.widthMm &&
        offset + 1 < s.end,
    );
    if (clash) {
      return {
        ok: false,
        reason: 'overlap',
        message: `La copia chocaría con otro mueble en ${wallNameOf(layout, wall.id)}. Usá Pegar para buscar el primer lugar libre.`,
      };
    }
    const source = entry.placement;
    newPlacements.push({
      ...(source ?? {
        itemId: entry.itemId,
        instanceIndex,
        wallId: wall.id,
        offsetMm: offset,
        elevation: ref.elevation,
      }),
      instanceIndex,
      mode: undefined,
      wallId: wall.id,
      offsetMm: offset,
      freeXMm: undefined,
      freeYMm: undefined,
      freeYawDeg: undefined,
    });
    cursor = stepSign === 1 ? offset + entry.widthMm + gap : offset - gap;
  }

  return {
    ok: true,
    layout: { ...layout, placements: [...layout.placements, ...newPlacements] },
    itemPatches: ledger.patches(),
    createdKeys,
  };
}
