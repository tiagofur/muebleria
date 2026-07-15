# Slice B — Project × Customer picker

> **Date:** 2026-07-15  
> **Scope:** Replace free-text “Cliente” on project create/edit meta modal with a catalog customer picker.  
> **Non-goals:** F023 dashboard, Login wiring, feature_list status changes, full CustomersScreen embed.

---

## What changed

### Contract (`ProjectDraft`)
| Field | Role |
|-------|------|
| `customerId: string` | **Primary** — selected catalog customer id |
| `customerName?: string` | **Only** for “Nuevo cliente” create path (empty when picking existing) |

### Meta form (`ProjectsScreen`)
- Create/edit Modal MD uses a **`<select id="prj-client">`** labeled **Cliente**.
- Options: customer **name** (+ ` (inactivo)` when inactive). Value = `customer.id`.
- Default list: **active** customers only via `customersForProjectPicker`.
- Edit with inactive/orphan customer: that customer is still included so the select stays valid.
- Checkbox **Nuevo cliente** switches to a free-text name field; submit sends `customerId: ''` + `customerName`.
- Validation: empty selection → Spanish **«Seleccioná un cliente.»** (no free-text-only primary path).
- Submit payload uses real `customerId` (no `customerId: draft.customerName` bridge).

### Shell (`App.tsx`)
- Replaced `findOrCreateCustomer(name)` as the only path with `resolveCustomerFromDraft(draft, customers)`:
  1. If `draft.customerId` non-empty → use it **without** inventing a customer.
  2. Else if `draft.customerName` non-empty → match by name or create active customer, then attach id.
- Cards/detail unchanged: `resolveCustomerName(project.customerId, customers)`.

### Helpers
- `customersForProjectPicker(customers, selectedCustomerId?)` — pure picker list builder.
- `validateProjectDraft` requires `customerId` **or** new-customer `customerName`.
- `projectToDraft` maps `customerId` only (clears `customerName`).

---

## Files touched

| File | Change |
|------|--------|
| `packages/ui/src/projects/projectHelpers.ts` | Draft contract, validation, picker helper |
| `packages/ui/src/projects/projectHelpers.test.ts` | Validation / picker / draft tests |
| `packages/ui/src/projects/ProjectsScreen.tsx` | Select + Nuevo cliente + payload |
| `packages/ui/src/projects/ProjectsScreen.test.tsx` | Picker, create/update id, validation, inactive |
| `packages/ui/src/projects/index.ts` | Export `customersForProjectPicker` |
| `packages/ui/src/index.ts` | Re-export helper |
| `apps/web/src/App.tsx` | `resolveCustomerFromDraft` |

---

## Tests added/updated

- Picker present as `select` with label Cliente; options by name.
- Create with selected `customerId` (e.g. `cust-bruno`).
- Create rejects empty customer → «Seleccioná un cliente.»
- Create via **Nuevo cliente** → `customerId: ''` + `customerName`.
- Edit keeps current id; can switch to another id.
- Inactive current customer appears as `Name (inactivo)`.
- Unit: `customersForProjectPicker` active / inactive selected / orphan placeholder.

---

## Verification

Run from repo root:

```bash
pnpm --filter @muebles/ui test
pnpm --filter @muebles/ui typecheck
pnpm --filter @muebles/web test
pnpm --filter @muebles/web typecheck
# preferred:
./init.sh
```

**Implementer note:** code + tests written in this slice. Orchestrator should re-run the commands above and paste results before treating Slice B as fully closed if the agent environment could not execute them.

---

## Residual

1. **Slice C** — shell hygiene (OPT-05 ModulePricePreviewDemo).
2. **F023** — dashboard.
3. Login tokens + gate / design.md polish — out of scope.
