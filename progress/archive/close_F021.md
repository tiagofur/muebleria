# Closeout — F021 ui_modules_cards_detail

**Date:** 2026-07-15  
**Status:** closed (`done`)

F021 (ModulesScreen redesign: card grid with code/name/part counts/hardware counts/shell sale-price estimates; card → read-only detail with board parts + hardware lines; Edit / Nuevo → Modal LG full editor; EmptyState; SearchInput + debounced filter; domain previews only via shell `moduleEstimates` + `costPreview`) was self-verified green (domain 60, excel 14, storage 17, ui 122, web 37, desktop 7, monorepo `./init.sh`), reviewed with verdict **APPROVED** in `progress/review_F021.md` (all 7 acceptance criteria + design §4.2/§4.3 LG/§5.3 + C1–C5 pass; residual notes non-blocking — missing design §6.3 subsection, pre-existing rem in editor CSS, one inline margin, full-map estimate recompute), and harness-closed: `feature_list.json` status set to `done`, session summary appended to `progress/history.md`, and `progress/current.md` reset to idle with next feature F022 (`ui_projects_cards_detail`) still pending and not started.

## Key artifacts
- `packages/ui/src/modules/ModulesScreen.tsx` — cards + detail + Modal LG
- `packages/ui/src/modules/modules.css` — card grid + detail styles
- `packages/ui/src/modules/moduleHelpers.ts` — `filterModulesByQuery`, `formatModuleMoney`
- `packages/ui/src/modules/ModulesScreen.test.tsx` — 7 component tests
- `packages/ui/src/modules/moduleHelpers.test.ts` — helper tests
- `apps/web/src/App.tsx` — `moduleEstimates` from domain previews
- Handoff / review: `progress/impl_F021.md`, `progress/review_F021.md`

## Next
- F022 — ui_projects_cards_detail (pending; not started)
