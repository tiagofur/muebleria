/**
 * catalog/customers — customer registry + owner resolution (F034) and the
 * cross-store upsert used by project flows.
 */

import { resolveOwnerOnCreate, resolveOwnerOnUpdate } from '@granete/domain';
import type { Customer } from '@granete/domain';

import type { CatalogState, CatalogStoreCtx } from './shared';

type CustomersSlice = Pick<
  CatalogState,
  'createCustomer' | 'updateCustomer' | 'setCustomerActive' | 'upsertCustomers'
>;

export function createCustomersActions(ctx: CatalogStoreCtx): CustomersSlice {
  return {
    createCustomer: (draft, actor) => {
      const ownerUserId = resolveOwnerOnCreate(
        actor.id,
        actor.roles?.[0] ?? actor.role,
        draft.ownerUserId,
      );
      const item: Customer = {
        id: ctx.newId(),
        name: draft.name.trim(),
        email: draft.email.trim() || undefined,
        phone: draft.phone.trim() || undefined,
        address: draft.address.trim() || undefined,
        notes: draft.notes.trim() || undefined,
        active: true,
        ownerUserId,
      };
      ctx.saveAndToast(
        (c) => ({
          ...c,
          customers: [...(c.customers ?? []), item],
        }),
        `✓ Cliente "${item.name}" creado`,
      );
    },

    updateCustomer: (id, draft, actor) => {
      const existing = ctx.get().catalog?.customers?.find((c) => c.id === id);
      const ownerUserId = resolveOwnerOnUpdate(
        actor.role,
        existing?.ownerUserId,
        draft.ownerUserId,
      );
      ctx.saveAndToast(
        (cat) => ({
          ...cat,
          customers: (cat.customers ?? []).map((c) =>
            c.id === id
              ? {
                  ...c,
                  name: draft.name.trim(),
                  email: draft.email.trim() || undefined,
                  phone: draft.phone.trim() || undefined,
                  address: draft.address.trim() || undefined,
                  notes: draft.notes.trim() || undefined,
                  ownerUserId,
                }
              : c,
          ),
        }),
        '✓ Cambios guardados',
      );
    },

    setCustomerActive: (id, active) => {
      const target = ctx.get().catalog?.customers?.find((c) => c.id === id);
      ctx.saveAndToast(
        (cat) => ({
          ...cat,
          customers: (cat.customers ?? []).map((c) =>
            c.id === id ? { ...c, active } : c,
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

    upsertCustomers: (customers) => {
      void ctx.patch((c) => ({ ...c, customers: [...customers] }));
    },
  };
}
