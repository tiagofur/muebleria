/**
 * catalog/ambient — presentation-only materials (finishes & scene textures,
 * F086: NEVER enters BOM/cost) + their 3-level categories.
 */

import type { AmbientCategory, AmbientMaterial } from '@muebles/domain';

import type { CatalogState, CatalogStoreCtx } from './shared';
import { parsePbr } from './shared';

type AmbientSlice = Pick<
  CatalogState,
  | 'createAmbientMaterial'
  | 'updateAmbientMaterial'
  | 'setAmbientMaterialActive'
  | 'createAmbientCategory'
  | 'updateAmbientCategory'
  | 'deleteAmbientCategory'
>;

export function createAmbientActions(ctx: CatalogStoreCtx): AmbientSlice {
  return {
    createAmbientMaterial: (draft) => {
      const code = draft.code.trim();
      // Coerce form `number | ''` → `number | undefined`, clamped to [0,1].
      const roughness = parsePbr(draft.previewRoughness);
      const metalness = parsePbr(draft.previewMetalness);
      const clearcoat = parsePbr(draft.previewClearcoat);
      const item: AmbientMaterial = {
        id: ctx.newId(),
        code,
        name: draft.name.trim(),
        active: true,
        surfaceType: draft.surfaceType,
        ...(draft.categoryId?.trim()
          ? { categoryId: draft.categoryId.trim() }
          : {}),
        ...(draft.previewColor?.trim()
          ? { previewColor: draft.previewColor.trim() }
          : {}),
        ...(draft.previewTextureUrl?.trim()
          ? { previewTextureUrl: draft.previewTextureUrl.trim() }
          : {}),
        ...(draft.previewTextureTileWidthMm && draft.previewTextureTileWidthMm > 0
          ? { previewTextureTileWidthMm: draft.previewTextureTileWidthMm }
          : {}),
        ...(draft.previewTextureTileLengthMm &&
        draft.previewTextureTileLengthMm > 0
          ? { previewTextureTileLengthMm: draft.previewTextureTileLengthMm }
          : {}),
        ...(roughness !== undefined ? { previewRoughness: roughness } : {}),
        ...(metalness !== undefined ? { previewMetalness: metalness } : {}),
        ...(clearcoat !== undefined ? { previewClearcoat: clearcoat } : {}),
      };
      if (!ctx.get().catalog) return;
      ctx
        .patch((c) => ({
          ...c,
          ambientMaterials: [...(c.ambientMaterials ?? []), item],
        }))
        .then(
          () => {
            ctx.toast({ type: 'success', message: `✓ "${code}" creado` });
          },
          () => {
            /* error toast already shown by patch */
          },
        );
    },

    updateAmbientMaterial: (id, draft) => {
      // Coerce form `number | ''` → `number | undefined`, clamped to [0,1].
      const roughness = parsePbr(draft.previewRoughness);
      const metalness = parsePbr(draft.previewMetalness);
      const clearcoat = parsePbr(draft.previewClearcoat);
      ctx
        .patch((c) => ({
          ...c,
          ambientMaterials: (c.ambientMaterials ?? []).map((m) =>
            m.id === id
              ? {
                  ...m,
                  code: draft.code.trim(),
                  name: draft.name.trim(),
                  surfaceType: draft.surfaceType,
                  categoryId: draft.categoryId?.trim() || undefined,
                  ...(draft.previewColor?.trim()
                    ? { previewColor: draft.previewColor.trim() }
                    : {}),
                  ...(draft.previewTextureUrl?.trim()
                    ? { previewTextureUrl: draft.previewTextureUrl.trim() }
                    : {}),
                  ...(draft.previewTextureTileWidthMm &&
                  draft.previewTextureTileWidthMm > 0
                    ? { previewTextureTileWidthMm: draft.previewTextureTileWidthMm }
                    : {}),
                  ...(draft.previewTextureTileLengthMm &&
                  draft.previewTextureTileLengthMm > 0
                    ? { previewTextureTileLengthMm: draft.previewTextureTileLengthMm }
                    : {}),
                  ...(roughness !== undefined
                    ? { previewRoughness: roughness }
                    : {}),
                  ...(metalness !== undefined
                    ? { previewMetalness: metalness }
                    : {}),
                  ...(clearcoat !== undefined
                    ? { previewClearcoat: clearcoat }
                    : {}),
                }
              : m,
          ),
        }))
        .then(
          () => {
            ctx.toast({ type: 'success', message: '✓ Cambios guardados' });
          },
          () => {
            /* error toast already shown by patch */
          },
        );
    },

    setAmbientMaterialActive: (id, active) => {
      const target = ctx.get().catalog?.ambientMaterials?.find((m) => m.id === id);
      ctx.saveAndToast(
        (c) => ({
          ...c,
          ambientMaterials: (c.ambientMaterials ?? []).map((m) =>
            m.id === id ? { ...m, active } : m,
          ),
        }),
        target
          ? active
            ? `↑ "${target.name}" reactivado`
            : `↓ "${target.name}" desactivado`
          : null,
        'info',
      );
    },

    createAmbientCategory: (draft) => {
      const item: AmbientCategory = {
        id: ctx.newId(),
        name: draft.name.trim(),
        parentId: draft.parentId.trim() || undefined,
        sortOrder: Number(draft.sortOrder) || 0,
      };
      ctx.saveAndToast(
        (c) => ({
          ...c,
          ambientCategories: [...(c.ambientCategories ?? []), item],
        }),
        `✓ Categoría "${item.name}" creada`,
      );
    },

    updateAmbientCategory: (id, draft) => {
      ctx.saveAndToast(
        (cat) => ({
          ...cat,
          ambientCategories: (cat.ambientCategories ?? []).map((c) =>
            c.id === id
              ? {
                  ...c,
                  name: draft.name.trim(),
                  parentId: draft.parentId.trim() || undefined,
                  sortOrder: Number(draft.sortOrder) || 0,
                }
              : c,
          ),
        }),
        'Categoría actualizada',
      );
    },

    deleteAmbientCategory: async (id) => {
      const cats = ctx.get().catalog?.ambientCategories ?? [];
      const hasChildren = cats.some((c) => c.parentId === id);
      if (hasChildren) {
        ctx.toast({
          type: 'warning',
          message: 'No se puede eliminar: tiene subcategorías',
        });
        return;
      }
      const saved = await ctx.patchSaved((c) => ({
        ...c,
        ambientCategories: (c.ambientCategories ?? []).filter((cat) => cat.id !== id),
        ambientMaterials: (c.ambientMaterials ?? []).map((m) =>
          m.categoryId === id ? { ...m, categoryId: undefined } : m,
        ),
      }));
      if (!saved) return;
      const ok = await ctx.hardDeleteOnAuth(`/catalog/ambient-categories/${id}`);
      if (ok) {
        ctx.toast({ type: 'info', message: 'Categoría eliminada' });
      }
    },
  };
}
