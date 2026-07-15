# Closeout — F020 ui_catalogs_modal_list

**Date:** 2026-07-15  
**Status:** closed (`done`)

F020 (catalog list pattern: SearchInput + StatusChips + EmptyState + Modal SM for Materials, Edges, Hardware, and Option Groups; hover-revealed row actions; expandable read-only detail; 150ms debounced client search; shared primitives in `packages/ui/src/common`) was self-verified green (domain 60, ui 112, excel 14, storage 17, web 37, desktop 7, monorepo `./init.sh`), reviewed with verdict **APPROVED** in `progress/review_F020.md` (all 8 acceptance criteria + design §4.2/§4.5/§4.6/§5.3 + C1–C5 pass; residual notes non-blocking — structural actions cell with opacity reveal, OptionGroups without chips, pre-existing danger border hsl, no full-screen RTL), and harness-closed: `feature_list.json` status set to `done`, session summary appended to `progress/history.md`, and `progress/current.md` reset to idle with next feature F021 (`ui_modules_cards_detail`) still pending and not started.

## Key artifacts
- `packages/ui/src/common/SearchInput.tsx` + `searchInput.css`
- `packages/ui/src/common/StatusChips.tsx` + `statusChips.css`
- `packages/ui/src/common/EmptyState.tsx` + `emptyState.css`
- `packages/ui/src/common/useDebouncedValue.ts`
- `packages/ui/src/common/catalogListPrimitives.test.tsx` — 11 tests
- `packages/ui/src/catalogs/{Materials,Edges,Hardware}Catalog.tsx` — modal list pattern
- `packages/ui/src/catalogs/CatalogTable.tsx` + `catalogs.css` — hover actions + expand detail
- `packages/ui/src/catalogs/catalogHelpers.ts` — status + query filters
- `packages/ui/src/optionGroups/OptionGroupsScreen.tsx` — search + modal SM (no chips)
- Handoff / review: `progress/impl_F020.md`, `progress/review_F020.md`

## Next
- F021 — ui_modules_cards_detail (pending; not started)
