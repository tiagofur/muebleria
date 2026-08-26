/**
 * catalog/entities — reusable library entities: module categories, modules,
 * structures (#108 revision bump), components and agregados.
 */

import {
  bumpStructureRevision,
  duplicateModule as deepCopyModule,
  suggestDuplicateCode,
} from '@granete/domain';
import type { ModuleCategory } from '@granete/domain';

import { draftToComponent, draftToModule, draftToStructure } from '../catalogMappers';
import type { CatalogState, CatalogStoreCtx } from './shared';

type EntitiesSlice = Pick<
  CatalogState,
  | 'createCategory'
  | 'updateCategory'
  | 'deleteCategory'
  | 'createModule'
  | 'updateModule'
  | 'deleteModule'
  | 'duplicateModuleById'
  | 'createStructure'
  | 'updateStructure'
  | 'deleteStructure'
  | 'setStructureActive'
  | 'createComponent'
  | 'updateComponent'
  | 'toggleComponentActive'
  | 'createAgregado'
  | 'updateAgregado'
  | 'deleteAgregado'
>;

export function createEntitiesActions(ctx: CatalogStoreCtx): EntitiesSlice {
  return {
    // --- Categories ---
    createCategory: (draft) => {
      const item: ModuleCategory = {
        id: ctx.newId(),
        name: draft.name.trim(),
        parentId: draft.parentId.trim() || undefined,
        sortOrder: Number(draft.sortOrder) || 0,
      };
      ctx.saveAndToast(
        (c) => ({
          ...c,
          categories: [...(c.categories ?? []), item],
        }),
        `✓ Categoría "${item.name}" creada`,
      );
    },

    updateCategory: (id, draft) => {
      ctx.saveAndToast(
        (cat) => ({
          ...cat,
          categories: (cat.categories ?? []).map((c) =>
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

    deleteCategory: async (id) => {
      const cats = ctx.get().catalog?.categories ?? [];
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
        categories: (c.categories ?? []).filter((cat) => cat.id !== id),
        modules: c.modules.map((m) =>
          m.categoryId === id ? { ...m, categoryId: undefined } : m,
        ),
      }));
      if (!saved) return;
      const ok = await ctx.hardDeleteOnAuth(`/catalog/categories/${id}`);
      if (ok) {
        ctx.toast({ type: 'info', message: 'Categoría eliminada' });
      }
    },

    // --- Modules ---
    createModule: (draft) => {
      const item = draftToModule(ctx.newId(), draft);
      ctx.saveAndToast(
        (c) => ({ ...c, modules: [...c.modules, item] }),
        `✓ "${item.code}" creado`,
      );
    },

    updateModule: (id, draft) => {
      ctx.saveAndToast(
        (c) => ({
          ...c,
          modules: c.modules.map((m) => (m.id === id ? draftToModule(id, draft) : m)),
        }),
        '✓ Cambios guardados',
      );
    },

    deleteModule: async (id, onModuleDeleted) => {
      const saved = await ctx.patchSaved((c) => ({
        ...c,
        modules: c.modules.filter((m) => m.id !== id),
      }));
      if (!saved) return;
      const ok = await ctx.hardDeleteOnAuth(`/catalog/modules/${id}`);
      if (ok) {
        onModuleDeleted?.(id);
        ctx.toast({ type: 'info', message: 'Módulo eliminado' });
      }
    },

    duplicateModuleById: (id) => {
      const source = ctx.get().catalog?.modules.find((m) => m.id === id);
      if (!source) return;
      const newCode = suggestDuplicateCode(
        source.code,
        ctx.get().catalog?.modules.map((m) => m.code) ?? [],
      );
      const copy = deepCopyModule(source, {
        newId: ctx.newId(),
        newCode,
        nextNestedId: ctx.newId,
      });
      ctx.saveAndToast(
        (c) => ({ ...c, modules: [...c.modules, copy] }),
        `✓ Duplicado como ${newCode}`,
      );
    },

    // --- Structures ---
    createStructure: (draft) => {
      const item = draftToStructure(ctx.newId(), draft);
      ctx.saveAndToast(
        (c) => ({
          ...c,
          structures: [...(c.structures ?? []), item],
        }),
        `✓ "${item.code}" creado`,
      );
    },

    updateStructure: (id, draft) => {
      ctx.saveAndToast(
        (c) => ({
          ...c,
          structures: (c.structures ?? []).map((s) => {
            if (s.id !== id) return s;
            // #108: editing a structure bumps its revision and pushes an immutable
            // snapshot of the previous revision into history. Quotes that already
            // pinned a prior revision keep resolving to the frozen snapshot.
            const { structure } = bumpStructureRevision(
              s,
              draftToStructure(id, draft),
            );
            return structure;
          }),
        }),
        '✓ Cambios guardados',
      );
    },

    deleteStructure: async (id) => {
      const saved = await ctx.patchSaved((c) => ({
        ...c,
        structures: (c.structures ?? []).filter((s) => s.id !== id),
      }));
      if (!saved) return;
      const ok = await ctx.hardDeleteOnAuth(`/catalog/structures/${id}`);
      if (ok) {
        ctx.toast({ type: 'info', message: 'Estructura eliminada' });
      }
    },

    setStructureActive: (id, active) => {
      ctx.saveAndToast(
        (c) => ({
          ...c,
          structures: (c.structures ?? []).map((s) =>
            s.id === id ? { ...s, active } : s,
          ),
        }),
        active ? 'Estructura activada' : 'Estructura desactivada',
        'info',
      );
    },

    // --- Components ---
    createComponent: (draft) => {
      const item = draftToComponent(ctx.newId(), draft);
      ctx.saveAndToast(
        (c) => ({
          ...c,
          components: [...(c.components ?? []), item],
        }),
        `✓ "${item.code}" creado`,
      );
    },

    updateComponent: (id, draft) => {
      ctx.saveAndToast(
        (c) => ({
          ...c,
          components: (c.components ?? []).map((comp) =>
            comp.id === id ? draftToComponent(id, draft) : comp,
          ),
        }),
        '✓ Cambios guardados',
      );
    },

    toggleComponentActive: (id) => {
      void ctx.patch((c) => ({
        ...c,
        components: (c.components ?? []).map((comp) =>
          comp.id === id ? { ...comp, active: !comp.active } : comp,
        ),
      }));
    },

    // --- Agregados ---
    createAgregado: (item) => {
      ctx.saveAndToast(
        (c) => ({
          ...c,
          agregados: [...(c.agregados ?? []), item],
        }),
        `✓ "${item.code}" creado`,
      );
    },

    updateAgregado: (item) => {
      ctx.saveAndToast(
        (c) => ({
          ...c,
          agregados: (c.agregados ?? []).map((a) => (a.id === item.id ? item : a)),
        }),
        '✓ Cambios guardados',
      );
    },

    deleteAgregado: async (id) => {
      const saved = await ctx.patchSaved((c) => ({
        ...c,
        agregados: (c.agregados ?? []).filter((a) => a.id !== id),
      }));
      if (!saved) return;
      const ok = await ctx.hardDeleteOnAuth(`/catalog/agregados/${id}`);
      if (ok) {
        ctx.toast({ type: 'info', message: 'Agregado eliminado' });
      }
    },
  };
}
