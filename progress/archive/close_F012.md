# Closeout — F012 quote_snapshot

**Date:** 2026-07-15  
**Status:** closed (`done`)

F012 (snapshot de cotización: al pasar a `quoted`/`accepted` se congela el breakdown y precios unitarios usados; draft siempre recalcula con catálogo actual; Escenario B del PRD sin Excel — draft live → close freeze → subir Arauco → cerrado conserva totales / draft sube) was self-verified green (domain 46/46, ui 55/55, web 24/24, storage 17, excel 8, desktop 7, monorepo `./init.sh`), reviewed with verdict **APPROVED** in `progress/review_F012.md` (acceptance draft live / closed freeze / Escenario B + C1–C4 pass; no required changes; residual notes non-blocking — no shell/UI freeze-badge integration test, no re-freeze on item edits while closed, closed without snapshot recalculates live until closed↔closed re-capture, meta changes while closed do not alter frozen totals), and harness-closed: `feature_list.json` status set to `done`, session summary appended to `progress/history.md`, and `progress/current.md` reset to idle with next feature F013 (`hardware_list_export`, phase 3) still pending and not started.

## Key artifacts
- Domain: `QuotePriceSnapshot`, `isProjectClosed`, `captureQuoteSnapshot`, `transitionProjectStatus`; `calcProjectBreakdown` returns frozen breakdown when closed + snapshot present
- Shell: `App.tsx` routes status changes through `transitionProjectStatus`
- UI: ProjectsScreen badge "Precios congelados" / "Totales (congelados)" (presentation only)
- SCHEMA_VERSION remains **1** (optional field)

## Next
- F013 — hardware_list_export (pending; not started)
