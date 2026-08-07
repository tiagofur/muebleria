/**
 * Shared kitchen plan helper functions — used by both KitchenPlanPanel
 * (editor) and PresentationKitchenPlanSlide (read-only presentation).
 * Extracted to avoid DRY violations between the two components.
 */

import type {
  Module,
  Project,
  ProjectItem,
} from '@muebles/domain';
import {
  defaultMeasurePresetId,
  resolveModuleMeasurePreset,
} from '@muebles/domain';

/** Resolve the width (mm) of a project item based on its module preset or external dims. */
export function moduleWidth(
  item: ProjectItem,
  modules: readonly Module[],
): number {
  const mod = modules.find((m) => m.id === item.moduleId);
  if (!mod) return 600;
  try {
    const preset = resolveModuleMeasurePreset(
      mod,
      item.measurePresetId?.trim() || defaultMeasurePresetId(mod) || undefined,
    );
    if (preset) return preset.width;
  } catch { /* fall through */ }
  return mod.externalDims?.width ?? 600;
}

/** Compute all footprints (instances) for a project's items. */
export function allFootprints(
  project: Project,
  modules: readonly Module[],
): { itemId: string; instanceIndex: number; width: number; height: number; depth: number }[] {
  const out: { itemId: string; instanceIndex: number; width: number; height: number; depth: number }[] = [];
  for (const item of project.items) {
    const mod = modules.find((m) => m.id === item.moduleId);
    let w = 600; let h = 720; let d = 560;
    if (mod) {
      try {
        const preset = resolveModuleMeasurePreset(
          mod, item.measurePresetId?.trim() || defaultMeasurePresetId(mod) || undefined,
        );
        if (preset) { w = preset.width; h = preset.height; d = preset.depth; }
        else if (mod.externalDims) { w = mod.externalDims.width; h = mod.externalDims.height; d = mod.externalDims.depth; }
      } catch {
        if (mod.externalDims) { w = mod.externalDims.width; h = mod.externalDims.height; d = mod.externalDims.depth; }
      }
    }
    const qty = Math.max(1, item.quantity);
    for (let i = 0; i < qty; i++) {
      out.push({ itemId: item.id, instanceIndex: i, width: w, height: h, depth: d });
    }
  }
  return out;
}

/** Display label for an item instance (e.g. "MOD-GAB-01 — Gabinete (copia 2)"). */
export function itemLabel(
  itemId: string,
  instanceIndex: number,
  project: Project,
  modules: readonly Module[],
): string {
  const item = project.items.find((i) => i.id === itemId);
  const mod = modules.find((m) => m.id === item?.moduleId);
  const base = mod ? `${mod.code} — ${mod.name}` : itemId;
  const qty = item?.quantity ?? 1;
  return qty > 1 ? `${base} (copia ${instanceIndex + 1})` : base;
}
