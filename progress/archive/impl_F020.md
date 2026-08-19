# Handoff — F020 ui_catalogs_modal_list

**Status:** implemented, self-verified, **NOT marked done** (awaiting reviewer)  
**Date:** 2026-07-15  
**Feature:** F020 — UI catalogs list + search + chips + modal SM

## Summary

Refactored Materials, Edges, Hardware, and Option Groups from permanent side-by-side form layout into **list + SearchInput + status chips + EmptyState + Modal SM** (design.md §4.2 / §4.5 / §4.6 / §5.3). Shared primitives live in `packages/ui/src/common`. Row hover reveals actions; click expands read-only inline detail. Controlled props unchanged — **App.tsx not modified**. Domain purity preserved (no cost logic in UI).

## Acceptance checklist

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | No permanent inline form beside table | Forms only inside `<Modal size="sm">`; `.catalog-layout` is single-column flex |
| 2 | SearchInput realtime filter debounce ~150ms | `SEARCH_DEBOUNCE_MS = 150` + `useDebouncedValue` in each catalog; SearchInput optional `onDebouncedChange` |
| 3 | Chips Todos/Activos/Inactivos replace checkbox | `StatusChips`; no “Mostrar inactivos” in catalog screens |
| 4 | Create opens Modal SM | `startCreate` → `modalOpen` + empty draft; `size="sm"` |
| 5 | Edit opens Modal SM prefilled | `startEdit` → draft from entity; modal title “Editar …” |
| 6 | EmptyState + Lucide + CTA when no items | `EmptyState` with Layers / Minus / Settings2 / ToggleLeft |
| 7 | Row hover reveals actions (no permanent actions column preferred) | CSS opacity 0 → 1 on `:hover` / `:focus-within`; head is visually-hidden “Acciones” |
| 8 | Existing helper tests stay green | `catalogHelpers.test.ts` + monorepo `pnpm test` green |

## Shared API (new)

```ts
// packages/ui/src/common
SearchInput({ value, onChange, onDebouncedChange?, placeholder?, debounceMs? })
StatusChips({ value: 'all' | 'active' | 'inactive', onChange })
EmptyState({ icon, title, description?, actionLabel?, onAction? })
useDebouncedValue(value, delayMs = 150)
SEARCH_DEBOUNCE_MS // 150

// packages/ui/src/catalogs/catalogHelpers
type CatalogStatusFilter = 'all' | 'active' | 'inactive'
filterCatalogItems(items, { status?, showInactive?, query?, matchItem? })
matchesCodeOrName(item, normalizedQuery)
```

## UX details (beyond minimum acceptance)

- Click row → expand read-only detail panel with all fields + Editar / Desactivar|Reactivar (or Eliminar for option groups)
- Codes rendered in mono
- Active badges: “● Activo / ● Inactivo”
- Touch devices (`hover: none`): actions always visible
- Option groups: search only (no active field → no status chips)
- Default chip filter: **Activos** (same default visibility as old checkbox off)

## Files touched

### New
- `packages/ui/src/common/SearchInput.tsx` + `searchInput.css`
- `packages/ui/src/common/StatusChips.tsx` + `statusChips.css`
- `packages/ui/src/common/EmptyState.tsx` + `emptyState.css`
- `packages/ui/src/common/useDebouncedValue.ts`
- `packages/ui/src/common/catalogListPrimitives.test.tsx` (11 tests)
- `progress/impl_F020.md` — this handoff

### Modified
- `packages/ui/src/common/index.ts` — export primitives
- `packages/ui/src/catalogs/catalogHelpers.ts` — status + query filter
- `packages/ui/src/catalogs/catalogHelpers.test.ts` — status/query tests (legacy showInactive kept)
- `packages/ui/src/catalogs/CatalogTable.tsx` — hover actions, expand detail, a11y
- `packages/ui/src/catalogs/catalogs.css` — list layout, hover actions, detail panel
- `packages/ui/src/catalogs/MaterialsCatalog.tsx`
- `packages/ui/src/catalogs/EdgesCatalog.tsx`
- `packages/ui/src/catalogs/HardwareCatalog.tsx`
- `packages/ui/src/catalogs/index.ts`
- `packages/ui/src/optionGroups/OptionGroupsScreen.tsx`
- `packages/ui/src/index.ts` — re-exports F020 surface
- `packages/ui/src/index.test.ts` — F020 export surface
- `feature_list.json` — F020 → `in_progress`
- `progress/current.md` — session state

### Not modified
- `apps/web/src/App.tsx` (props contract unchanged)
- `packages/domain/**`

## Verification run

```text
pnpm --filter @muebles/ui typecheck  → ok
pnpm --filter @muebles/web typecheck → ok
pnpm --filter @muebles/ui test       → 112 passed
pnpm test                            → all packages green
  domain 60 · excel 14 · storage 17 · ui 112 · web 37 · desktop 7
```

## Notes for reviewer

- Controlled components: create/update/deactivate/reactivate/delete still shell-owned callbacks.
- Validation errors remain **inline in the modal form** (not toast) per design §4.4.
- Legacy `showInactive` on `filterCatalogItems` preserved for back-compat tests.
- Option groups never had active/inactive; chips only on materials/edges/hardware.
