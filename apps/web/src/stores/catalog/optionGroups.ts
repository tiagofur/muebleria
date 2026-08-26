/**
 * catalog/optionGroups — OptionGroup CRUD. Hard delete with REST on auth
 * (saveCatalog is upsert-only, so the FE must DELETE or rows reappear).
 */

import type { OptionGroup } from '@granete/domain';

import type { CatalogState, CatalogStoreCtx } from './shared';

type OptionGroupsSlice = Pick<
  CatalogState,
  'createOptionGroup' | 'updateOptionGroup' | 'deleteOptionGroup'
>;

export function createOptionGroupsActions(ctx: CatalogStoreCtx): OptionGroupsSlice {
  return {
    createOptionGroup: (draft) => {
      const code = draft.code.trim();
      const item: OptionGroup = {
        id: ctx.newId(),
        code,
        name: draft.name.trim(),
        kind: draft.kind,
        required: draft.required,
        optionIds: [...draft.optionIds],
      };
      ctx.saveAndToast(
        (c) => ({ ...c, optionGroups: [...c.optionGroups, item] }),
        `✓ "${code}" creado`,
      );
    },

    updateOptionGroup: (id, draft) => {
      ctx.saveAndToast(
        (c) => ({
          ...c,
          optionGroups: c.optionGroups.map((g) =>
            g.id === id
              ? {
                  ...g,
                  code: draft.code.trim(),
                  name: draft.name.trim(),
                  kind: draft.kind,
                  required: draft.required,
                  optionIds: [...draft.optionIds],
                }
              : g,
          ),
        }),
        '✓ Cambios guardados',
      );
    },

    deleteOptionGroup: async (id) => {
      const saved = await ctx.patchSaved((c) => ({
        ...c,
        optionGroups: c.optionGroups.filter((g) => g.id !== id),
      }));
      if (!saved) return;
      const ok = await ctx.hardDeleteOnAuth(`/catalog/option-groups/${id}`);
      if (ok) {
        ctx.toast({ type: 'info', message: 'Grupo de opciones eliminado' });
      }
    },
  };
}
