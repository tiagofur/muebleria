# Closeout — F009 ui_quotation

**Date:** 2026-07-15  
**Status:** closed (`done`)

F009 (UI de cotización/proyectos en `@muebles/ui`: helpers puros `groupsForModuleItem` / `optionsForGroup` / `validateItemQuantity` / preview gate, `ProjectsScreen` lista + editor controlado con CRUD de proyectos e ítems, pickers de opciones por grupo, totales en vivo solo como props desde shell web vía `calcProjectBreakdown`, líneas duplicadas del mismo módulo con opciones independientes, sin mutar módulo maestro) was self-verified green (`pnpm --filter @muebles/ui test` 54/54, `pnpm --filter @muebles/web test` 15/15, typecheck ui+web, monorepo `./init.sh` + `pnpm test`), reviewed with verdict **APPROVED** in `progress/review_F009.md` (acceptance PRJ-01..03/06/09/10, OPT-04, UX-03 and C1–C4 pass; no required changes; residual notes non-blocking — no RTL, export placeholder → F010, meta save-then-preview, in-memory seed), and harness-closed: `feature_list.json` status set to `done`, session summary appended to `progress/history.md`, and `progress/current.md` reset to idle with next feature F010 (`ui_export`) still pending and not started.
