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
        // #1502: kit accesorio elegible; '' = sin link (grupo legacy).
        ...(draft.kitHardwareId ? { kitHardwareId: draft.kitHardwareId } : {}),
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
                  // #1502: '' elimina el link (unlink deliberado).
                  ...(draft.kitHardwareId
                    ? { kitHardwareId: draft.kitHardwareId }
                    : { kitHardwareId: undefined }),
                }
              : g,
          ),
        }),
        '✓ Cambios guardados',
      );
    },

    deleteOptionGroup: async (id) => {
      // #1606: hardDeleteOnAuth first under If-Match — if backend fails (e.g. 428/412/500/network),
      // the group is NOT removed from local state (never disappears "sólo en pantalla").
      const group = ctx.get().catalog?.optionGroups.find((g) => g.id === id);
      const ok = await ctx.hardDeleteOnAuth(`/catalog/option-groups/${id}`, {
        expectedVersion: group?.version,
      });
      if (!ok) return;
      await ctx.patchSaved((c) => ({
        ...c,
        optionGroups: c.optionGroups.filter((g) => g.id !== id),
      }));
      ctx.toast({ type: 'info', message: 'Grupo de opciones eliminado' });
    },
  };
}
