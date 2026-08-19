# Closeout — F014 waste_percent

**Date:** 2026-07-15  
**Status:** closed (`done`)

F014 (merma % por material: campo editable **Merma (%)** en catálogo de materiales; `MaterialBoard.wastePercent?`; motor `boardCost = areaM2 × costPerM2 × (1 + waste/100)` con default MVP 0% vía `?? 0`; test unitario waste 10% → boardCost 110) was self-verified green (domain 53/53, ui 56/56, excel 14, storage 17, web 30, desktop 7, monorepo `./init.sh`), reviewed with verdict **APPROVED** in `progress/review_F014.md` (acceptance + PRD §13.2 + C1–C4 pass; no required changes; residual notes non-blocking — engine trusts stored catalog for negative waste, no RTL on Merma input, quote snapshot does not store waste separately, seed/fixtures keep waste 0 for plantilla golden), and harness-closed: `feature_list.json` status set to `done`, session summary appended to `progress/history.md`, and `progress/current.md` reset to idle with next feature F015 (`duplicate_module_project`, phase 3) still pending and not started.

## Key artifacts
- Domain: `MaterialBoard.wastePercent?`, `calcBoardLineCost` applies `(1 + waste/100)`
- Domain tests: waste 10% (boardCost 110) + omit → default 0
- UI: `MaterialsCatalog` form Merma (%), table column, `validateNonNegativeNumber(..., 'Merma')`
- Web: draft → domain map on create/update material
- Handoff / review: `progress/impl_F014.md`, `progress/review_F014.md`

## Next
- F015 — duplicate_module_project (pending; not started)
