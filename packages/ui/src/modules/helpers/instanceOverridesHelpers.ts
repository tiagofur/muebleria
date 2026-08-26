/**
 * Helpers for instance overrides, fingerprinting and live composition keying.
 */

import type { Module } from '@granete/domain';
import type { ComponentInstanceDraft, ModuleDraft } from './moduleDraftTransforms';

/**
 * Fingerprint of one instance's formula/rotation overrides (stable string).
 */
export function instanceOverridesKey(
  ov: ComponentInstanceDraft['overrides'] | undefined,
): string {
  if (!ov) return '';
  return [
    ov.lengthFormula ?? '',
    ov.widthFormula ?? '',
    ov.xFormula ?? '',
    ov.yFormula ?? '',
    ov.zFormula ?? '',
    ov.rotateX ?? '',
    ov.rotateY ?? '',
    ov.rotateZ ?? '',
  ].join('~');
}

/**
 * Fingerprint of module fields that affect BOM / 3D composition.
 * Includes per-instance formula/rotation overrides (list editor).
 */
export function moduleCompositionKey(mod: Module): string {
  const comps = (mod.components ?? [])
    .map(
      (c) =>
        `${c.componentId}:${c.quantity}:${c.placementOverride ?? ''}:${instanceOverridesKey(c.overrides)}`,
    )
    .join(',');
  const d = mod.externalDims;
  const dims = d ? `${d.width}x${d.height}x${d.depth}` : '';
  return `${mod.structureId ?? ''}|${comps}|${dims}`;
}

/** Drop empty override fields; return undefined when nothing remains. */
export function cleanInstanceOverrides(
  ov: ComponentInstanceDraft['overrides'] | undefined,
): ComponentInstanceDraft['overrides'] | undefined {
  if (!ov) return undefined;
  const next: NonNullable<ComponentInstanceDraft['overrides']> = {
    ...(ov.lengthFormula?.trim()
      ? { lengthFormula: ov.lengthFormula.trim() }
      : {}),
    ...(ov.widthFormula?.trim()
      ? { widthFormula: ov.widthFormula.trim() }
      : {}),
    ...(ov.xFormula?.trim() ? { xFormula: ov.xFormula.trim() } : {}),
    ...(ov.yFormula?.trim() ? { yFormula: ov.yFormula.trim() } : {}),
    ...(ov.zFormula?.trim() ? { zFormula: ov.zFormula.trim() } : {}),
    ...(ov.rotateX !== undefined && Number.isFinite(ov.rotateX)
      ? { rotateX: ov.rotateX }
      : {}),
    ...(ov.rotateY !== undefined && Number.isFinite(ov.rotateY)
      ? { rotateY: ov.rotateY }
      : {}),
    ...(ov.rotateZ !== undefined && Number.isFinite(ov.rotateZ)
      ? { rotateZ: ov.rotateZ }
      : {}),
    ...(ov.hardwarePlacements && ov.hardwarePlacements.length > 0
      ? { hardwarePlacements: ov.hardwarePlacements }
      : {}),
  };
  return Object.keys(next).length > 0 ? next : undefined;
}

/** Merge a partial patch into instance overrides (empty strings clear fields). */
export function patchInstanceOverrides(
  current: ComponentInstanceDraft['overrides'] | undefined,
  patch: {
    readonly lengthFormula?: string;
    readonly widthFormula?: string;
    readonly xFormula?: string;
    readonly yFormula?: string;
    readonly zFormula?: string;
    readonly rotateX?: number | null;
    readonly rotateY?: number | null;
    readonly rotateZ?: number | null;
  },
): ComponentInstanceDraft['overrides'] | undefined {
  const base: {
    lengthFormula?: string;
    widthFormula?: string;
    xFormula?: string;
    yFormula?: string;
    zFormula?: string;
    rotateX?: number;
    rotateY?: number;
    rotateZ?: number;
  } = { ...(current ?? {}) };

  if ('lengthFormula' in patch) {
    const v = patch.lengthFormula?.trim() ?? '';
    if (v) base.lengthFormula = v;
    else delete base.lengthFormula;
  }
  if ('widthFormula' in patch) {
    const v = patch.widthFormula?.trim() ?? '';
    if (v) base.widthFormula = v;
    else delete base.widthFormula;
  }
  if ('xFormula' in patch) {
    const v = patch.xFormula?.trim() ?? '';
    if (v) base.xFormula = v;
    else delete base.xFormula;
  }
  if ('yFormula' in patch) {
    const v = patch.yFormula?.trim() ?? '';
    if (v) base.yFormula = v;
    else delete base.yFormula;
  }
  if ('zFormula' in patch) {
    const v = patch.zFormula?.trim() ?? '';
    if (v) base.zFormula = v;
    else delete base.zFormula;
  }
  if ('rotateX' in patch) {
    if (patch.rotateX === null || patch.rotateX === undefined) {
      delete base.rotateX;
    } else {
      base.rotateX = patch.rotateX;
    }
  }
  if ('rotateY' in patch) {
    if (patch.rotateY === null || patch.rotateY === undefined) {
      delete base.rotateY;
    } else {
      base.rotateY = patch.rotateY;
    }
  }
  if ('rotateZ' in patch) {
    if (patch.rotateZ === null || patch.rotateZ === undefined) {
      delete base.rotateZ;
    } else {
      base.rotateZ = patch.rotateZ;
    }
  }

  return cleanInstanceOverrides(base);
}

/** One-line summary for the advanced disclosure header. */
export function instanceOverridesSummary(
  ov: ComponentInstanceDraft['overrides'] | undefined,
): string {
  if (!ov) return 'automático';
  const parts: string[] = [];
  if (ov.lengthFormula) parts.push(`L=${ov.lengthFormula}`);
  if (ov.widthFormula) parts.push(`W=${ov.widthFormula}`);
  if (ov.xFormula) parts.push(`X=${ov.xFormula}`);
  if (ov.yFormula) parts.push(`Y=${ov.yFormula}`);
  if (ov.zFormula) parts.push(`Z=${ov.zFormula}`);
  if (ov.rotateX !== undefined) parts.push(`rX=${ov.rotateX}°`);
  if (ov.rotateY !== undefined) parts.push(`rY=${ov.rotateY}°`);
  if (ov.rotateZ !== undefined) parts.push(`rZ=${ov.rotateZ}°`);
  return parts.length > 0 ? parts.join(' · ') : 'automático';
}

/**
 * Merge BoardEditor pose/dim overrides into draft components (by componentId).
 */
export function mergeBoardOverridesIntoDraft(
  draft: ModuleDraft,
  boardOverrides: Readonly<Record<string, unknown>> | undefined,
): ModuleDraft {
  if (!boardOverrides || Object.keys(boardOverrides).length === 0) {
    return draft;
  }
  return {
    ...draft,
    components: draft.components.map((c) =>
      boardOverrides[c.componentId]
        ? {
            ...c,
            overrides: boardOverrides[
              c.componentId
            ] as ComponentInstanceDraft['overrides'],
          }
        : c,
    ),
  };
}
