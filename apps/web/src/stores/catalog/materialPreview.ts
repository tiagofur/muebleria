/**
 * catalog/materialPreview — normalized 3D finish fields for materials
 * (color + PBR), shared by create/update so both clamp identically.
 */

import { normalizePreviewColor } from '@muebles/domain';
import type { MaterialBoard } from '@muebles/domain';
import type { MaterialDraft } from '@muebles/ui';

import { parsePbr } from './shared';

/**
 * The color is only persisted when `normalizePreviewColor` accepts it, so an
 * invalid hex never survives into the catalog raw (F116 C5), and PBR values
 * are clamped to [0, 1] (F116 C1).
 */
export function materialPreviewFinishFields(
  draft: MaterialDraft,
): Pick<
  MaterialBoard,
  'previewColor' | 'previewRoughness' | 'previewMetalness' | 'previewClearcoat'
> {
  const previewColor = normalizePreviewColor(draft.previewColor);
  const roughness = parsePbr(draft.previewRoughness);
  const metalness = parsePbr(draft.previewMetalness);
  const clearcoat = parsePbr(draft.previewClearcoat);
  return {
    ...(previewColor ? { previewColor } : {}),
    ...(roughness !== undefined ? { previewRoughness: roughness } : {}),
    ...(metalness !== undefined ? { previewMetalness: metalness } : {}),
    ...(clearcoat !== undefined ? { previewClearcoat: clearcoat } : {}),
  };
}
