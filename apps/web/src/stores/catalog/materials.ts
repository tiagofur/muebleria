/**
 * catalog/materials — MaterialBoard mutations (create/update/deactivate).
 */

import {
  calcMaterialCostPerM2,
  normalizePreviewColor,
} from '@muebles/domain';
import type { MaterialDraft } from '@muebles/ui';

import type { CatalogState, CatalogStoreCtx } from './shared';
import { optionalNotes } from './shared';
import { materialPreviewFinishFields } from './materialPreview';

type MaterialsSlice = Pick<
  CatalogState,
  'createMaterial' | 'updateMaterial' | 'setMaterialActive'
>;

/**
 * F116 C1/C5: the 3D finish fields (color + PBR) are derived through
 * materialPreviewFinishFields so invalid hex never persists raw and PBR
 * values are clamped identically on create and update.
 */
export function createMaterialsActions(ctx: CatalogStoreCtx): MaterialsSlice {
  const { deps, toast } = ctx;

  return {
    createMaterial: (draft) => {
      const code = draft.code.trim();
      // Domain formula in the shell layer only (issue #14 — UI must not import calc).
      const costPerM2 = calcMaterialCostPerM2(
        draft.widthMm,
        draft.lengthMm,
        draft.boardPrice,
        draft.wastePercent,
      );
      const item = {
        id: ctx.newId(),
        code,
        name: draft.name.trim(),
        widthMm: draft.widthMm,
        lengthMm: draft.lengthMm,
        thicknessMm: draft.thicknessMm,
        grainDefault: draft.grainDefault,
        boardPrice: draft.boardPrice,
        costPerM2,
        wastePercent: draft.wastePercent,
        defaultEdgeBandId: draft.defaultEdgeBandId || undefined,
        imageUrl: draft.imageUrl?.trim() || undefined,
        previewTextureUrl: draft.previewTextureUrl?.trim() || undefined,
        previewTextureTileWidthMm:
          draft.previewTextureTileWidthMm && draft.previewTextureTileWidthMm > 0
            ? draft.previewTextureTileWidthMm
            : undefined,
        previewTextureTileLengthMm:
          draft.previewTextureTileLengthMm &&
          draft.previewTextureTileLengthMm > 0
            ? draft.previewTextureTileLengthMm
            : undefined,
        notes: optionalNotes(draft.notes),
        ...materialPreviewFinishFields(draft),
        active: true,
      };
      if (!ctx.get().catalog) return;
      ctx
        .patch((c) => ({
          ...c,
          materials: [...c.materials, item],
        }))
        .then(
          () => {
            toast({ type: 'success', message: `✓ "${code}" creado` });
          },
          () => {
            /* error toast already shown by patch */
          },
        );
    },

    updateMaterial: (id, draft) => {
      const prev = ctx.get().catalog?.materials.find((m) => m.id === id);
      const costPerM2 = calcMaterialCostPerM2(
        draft.widthMm,
        draft.lengthMm,
        draft.boardPrice,
        draft.wastePercent,
      );
      const priceChanged =
        prev != null &&
        (prev.boardPrice !== draft.boardPrice ||
          prev.wastePercent !== draft.wastePercent ||
          Math.abs(prev.costPerM2 - costPerM2) > 1e-9);

      const tileW =
        draft.previewTextureTileWidthMm && draft.previewTextureTileWidthMm > 0
          ? draft.previewTextureTileWidthMm
          : undefined;
      const tileL =
        draft.previewTextureTileLengthMm &&
        draft.previewTextureTileLengthMm > 0
          ? draft.previewTextureTileLengthMm
          : undefined;

      ctx
        .patch((c) => ({
          ...c,
          materials: c.materials.map((m) =>
            m.id === id
              ? {
                  ...m,
                  code: draft.code.trim(),
                  name: draft.name.trim(),
                  widthMm: draft.widthMm,
                  lengthMm: draft.lengthMm,
                  thicknessMm: draft.thicknessMm,
                  grainDefault: draft.grainDefault,
                  boardPrice: draft.boardPrice,
                  costPerM2,
                  wastePercent: draft.wastePercent,
                  defaultEdgeBandId: draft.defaultEdgeBandId || undefined,
                  imageUrl: draft.imageUrl?.trim() || undefined,
                  previewTextureUrl: draft.previewTextureUrl?.trim() || undefined,
                  previewTextureTileWidthMm: tileW,
                  previewTextureTileLengthMm: tileL,
                  notes: optionalNotes(draft.notes),
                  ...materialPreviewFinishFields(draft),
                }
              : m,
          ),
        }))
        .then(
          () => {
            toast({ type: 'success', message: '✓ Cambios guardados' });

            // #138: warn about draft quotes that may still use previous catalog prices.
            if (priceChanged) {
              const draftCount = deps.getDraftProjectsCount();
              if (draftCount > 0) {
                toast({
                  type: 'info',
                  message: `Precio de material actualizado. ${draftCount} ${draftCount === 1 ? 'cotización' : 'cotizaciones'} en borrador usarán el nuevo catálogo al recalcular.`,
                });
              }
            }
          },
          () => {
            /* error toast already shown by patch */
          },
        );
    },

    setMaterialActive: (id, active) => {
      const target = ctx.get().catalog?.materials.find((m) => m.id === id);
      ctx.saveAndToast(
        (c) => ({
          ...c,
          materials: c.materials.map((m) => (m.id === id ? { ...m, active } : m)),
        }),
        target
          ? active
            ? `↑ "${target.name}" reactivado`
            : `↓ "${target.name}" desactivado`
          : null,
        'info',
      );
    },
  };
}
