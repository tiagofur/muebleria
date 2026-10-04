/**
 * catalog/edges — EdgeBand mutations.
 */

import { normalizePreviewColor } from '@granete/domain';

import type { CatalogState, CatalogStoreCtx } from './shared';
import { optionalNotes } from './shared';

type EdgesSlice = Pick<
  CatalogState,
  'createEdge' | 'updateEdge' | 'setEdgeActive'
>;

export function createEdgesActions(ctx: CatalogStoreCtx): EdgesSlice {
  return {
    createEdge: (draft) => {
      const code = draft.code.trim();
      const previewColor = normalizePreviewColor(draft.previewColor);
      const id = ctx.newId();
      const item = {
        id,
        code,
        name: draft.name.trim(),
        thicknessMm: draft.thicknessMm,
        costPerMl: draft.costPerMl,
        notes: optionalNotes(draft.notes),
        ...(previewColor ? { previewColor } : {}),
        active: true,
      };
      // K1 #1032: settle promise for the save contract; the created id is
      // still delivered (to the quick-create link flow) once the save lands.
      return ctx
        .saveAndToast(
          (c) => ({ ...c, edges: [...c.edges, item] }),
          `✓ "${code}" creado`,
        )
        .then(() => id);
    },

    updateEdge: (id, draft) => {
      const previewColor = normalizePreviewColor(draft.previewColor);
      return ctx.saveAndToast(
        (c) => ({
          ...c,
          edges: c.edges.map((e) =>
            e.id === id
              ? {
                  ...e,
                  code: draft.code.trim(),
                  name: draft.name.trim(),
                  thicknessMm: draft.thicknessMm,
                  costPerMl: draft.costPerMl,
                  notes: optionalNotes(draft.notes),
                  previewColor,
                }
              : e,
          ),
        }),
        '✓ Cambios guardados',
      );
    },

    setEdgeActive: (id, active) => {
      const target = ctx.get().catalog?.edges.find((e) => e.id === id);
      ctx.saveAndToast(
        (c) => ({
          ...c,
          edges: c.edges.map((e) => (e.id === id ? { ...e, active } : e)),
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
