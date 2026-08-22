# Bitácora histórica (append-only)

> Cada vez que se cierra una sesión, su resumen se añade aquí.
> No edites entradas anteriores. Solo añades al final.
> Nota (2026-08-18): los artefactos que las entradas referencian
> (`review_*`, `impl_*`, `close_*`, `explore_*`) viven en `progress/archive/`.

---

## 2026-04-20 — Bootstrap del proyecto
- **Agente:** humano (Martín)
- **Cambios:** estructura inicial del arnés (AGENTS.md, init.sh, feature_list.json, docs/).
- **Resultado:** entorno listo. `./init.sh` verde.

## 2026-04-22 — Feature 1: storage_layer
- **Agente:** implementador #1
- **Plan:** crear `src/storage.py` con `load()` / `save()` atómicos y tests.
- **Cambios:** `src/storage.py`, `tests/test_storage.py`.
- **Verificación:** `./init.sh` verde, 3 tests pasan.
- **Cierre:** feature 1 marcada `done`.

## 2026-04-23 — Feature 2: note_model
- **Agente:** implementador #2
- **Plan:** dataclass `Note` con `Note.new(title, body)` y serialización dict.
- **Cambios:** `src/notes.py`, `tests/test_notes.py`.
- **Verificación:** `./init.sh` verde.
- **Cierre:** feature 2 marcada `done`.

## 2026-04-25 — Feature 3: cli_add_list
- **Agente:** implementador #3, revisado por reviewer-agent.
- **Plan:** `src/cli.py` con argparse, comandos `add` y `list`.
- **Cambios:** `src/cli.py`, `tests/test_cli.py`.
- **Verificación:** `./init.sh` verde, 7 tests pasan.
- **Cierre:** feature 3 marcada `done`. Próximo: feature 4 (show/delete).

## 2026-04-27 — Feature 4: cli_show_delete
- **Agente:** Claude Opus 4.7
- **Plan:** añadir `cmd_show` y `cmd_delete` en `src/cli.py` con manejo de `NoteNotFound` (stderr + exit 1).
- **Cambios:** `src/cli.py` (subcomandos `show`/`delete` y captura de `NoteError` en `main`), `tests/test_cli.py` (4 tests nuevos: éxito y fallo de cada comando, captura de stderr).
- **Verificación:** `./init.sh` verde, 14 tests pasan.
- **Cierre:** feature 4 marcada `done`. Próximo: feature 5 (search).

## 2026-04-27 — Feature 5: cli_search
- **Agente:** Claude Opus 4.6
- **Plan:** añadir `cmd_search` en `src/cli.py` con búsqueda case-insensitive en título y body. Sin coincidencias → NoteNotFound (stderr + exit 1).
- **Cambios:** `src/cli.py` (subcomando `search` con `cmd_search`), `tests/test_cli.py` (3 tests nuevos: coincidencia, no-coincidencia, case-insensitivity).
- **Verificación:** `./init.sh` verde, 17 tests pasan.
- **Cierre:** feature 5 marcada `done`. Todas las features completadas.

## 2026-04-29 — Feature 6: cli_edit
- **Agente:** Claude Opus 4.7 (leader) → implementer → reviewer.
- **Plan:** añadir `cmd_edit` en `src/cli.py` con `--title` y `--body` opcionales; sin flags → `NoteError`; id inexistente → `NoteNotFound`.
- **Cambios:** `src/cli.py` (subcomando `edit` y `cmd_edit` que construye una nueva instancia `Note` preservando `id`/`created_at`), `tests/test_cli.py` (5 tests: cada flag, ambos juntos, id inexistente, ausencia de flags).
- **Verificación:** `./init.sh` verde, 22 tests pasan. Reviewer APPROVED (`progress/review_cli_edit.md`).
- **Cierre:** feature 6 marcada `done`. Todas las features del proyecto completadas.

## 2026-07-15 — Feature F001: scaffold_monorepo
- **Agente:** implementer → reviewer (APPROVED en `progress/review_F001.md`).
- **Plan:** scaffold monorepo pnpm + TypeScript strict: root config, 4 packages (`domain`, `ui`, `excel`, `storage`), 2 apps (`web`, `desktop`), smoke tests y scripts `test`/`build`/`typecheck`.
- **Cambios:** `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`; `packages/{domain,ui,excel,storage}` y `apps/{web,desktop}` con `@muebles/*`, ESM, Vitest smoke; handoff `progress/impl_F001.md`.
- **Verificación:** `./init.sh`, `pnpm install`, `pnpm build`, `pnpm typecheck`, `pnpm test` verdes (7 tests / 6 workspaces). Reviewer: ACCEPTANCE + C1–C4 PASS.
- **Cierre:** F001 marcada `done`. Próximo: F002 — domain_entities.

## 2026-07-15 — Feature F002: domain_entities
- **Agente:** implementer → reviewer (APPROVED en `progress/review_F002.md`).
- **Plan:** tipos e interfaces del dominio en `packages/domain` (PRD §7.1 / technical_design §1.1): catálogo, módulo, proyecto, DTOs de resolución, errores de dominio; sin lógica de motor.
- **Cambios:** `packages/domain/src/types.ts`, `errors.ts`, `index.ts`, `types.test.ts`; handoff `progress/impl_F002.md`.
- **Verificación:** `pnpm --filter @muebles/domain test` (7 tests), typecheck/build verdes; monorepo vía `./init.sh`. Reviewer: acceptance + C1–C4 PASS; C5 de cierre harness.
- **Cierre:** F002 marcada `done`. Próximo: F003 — domain_engine (no iniciado).

## 2026-07-15 — Feature F003: domain_engine
- **Agente:** implementer → reviewer (APPROVED en `progress/review_F003.md`).
- **Plan:** motor de dominio en `packages/domain`: `resolveBom`, `calcLineCost` / line metrics, `calcProjectBreakdown`, VALs 01–07 (VAL-05 deferred F004); fixture golden desde Plantilla_Muebles.xlsx.
- **Cambios:** `packages/domain/src/engine.ts`, `engine.test.ts`, `src/__fixtures__/plantillaDemo.ts`; handoff `progress/impl_F003.md`.
- **Verificación:** `pnpm --filter @muebles/domain test` 24/24, typecheck OK; monorepo `./init.sh` + `pnpm test` verdes. Reviewer: acceptance + C1–C4 PASS; golden totals match plantilla within 0.01.
- **Cierre:** F003 marcada `done`. Próximo: F004 — excel_optimizer_export (no iniciado).

## 2026-07-15 — Feature F004: excel_optimizer_export
- **Agente:** implementer → reviewer (APPROVED en `progress/review_F004.md`).
- **Plan:** cut list de producción en domain (`generateCutRows`: EXP-02/04/05, VAL-05) + serialización XLSX en excel (`optimizerExport` A–J según Plantilla_Optimizer.xlsx) + fixture MOD-GAB-01 y smoke round-trip.
- **Cambios:** `packages/domain/src/engine.ts` (+ tests/index/fixtures export); `packages/excel/src/optimizerExport.ts` (+ test, fixtures `modGab01CutRows.json` / `smokeExport.mjs`); deps excel→domain; handoff `progress/impl_F004.md`; closeout `progress/close_F004.md`.
- **Verificación:** domain 29/29, excel 7/7, monorepo `pnpm test` + typecheck domain/excel verdes; smoke `/tmp/optimizer_smoke.xlsx`. Reviewer: acceptance + C1–C4 PASS; residual non-blocking (smoke reimplements layout, EXP-03 out of scope, dual VAL-05).
- **Cierre:** F004 marcada `done`. Próximo: F005 — storage_layer (no iniciado).

## 2026-07-15 — Feature F005: storage_layer
- **Agente:** implementer → reviewer (APPROVED en `progress/review_F005.md`).
- **Plan:** capa de persistencia JSON versionada en `packages/storage`: port `WorkspaceRepository`, seed con `SCHEMA_VERSION` + plantilla (MOD-GAB-01/MOD-CAJ-01), adapter `JSONFileStorage` con load (seed si falta) y save atómico (`.tmp` + rename), wrappers de catálogo/proyecto, tests con tempdir real.
- **Cambios:** `packages/storage/src/workspaceRepository.ts`, `seed.ts`, `jsonFileStorage.ts`, `workspace.ts`, `workspace.test.ts`, `index.ts` (+ index test / vitest aliases); handoff `progress/impl_F005.md`; closeout `progress/close_F005.md`.
- **Verificación:** storage 9/9 + typecheck; monorepo `./init.sh` + `pnpm test` verdes (domain 29/29). Reviewer: acceptance + C1–C4 PASS; residual non-blocking (no schema validation on load, atomicity via rename not crash-injected).
- **Cierre:** F005 marcada `done`. Próximo: F006 — ui_catalogs (no iniciado).

## 2026-07-15 — Feature F006: ui_catalogs
- **Agente:** implementer → reviewer (APPROVED en `progress/review_F006.md`).
- **Plan:** ABM de catálogos (MaterialBoard / EdgeBand / Hardware) en `@muebles/ui` con helpers CAT-04/CAT-05, shell web con seed in-memory browser-safe, soft-delete y validación de código único.
- **Cambios:** `packages/ui/src/catalogs/*` (helpers, table, picker, Materials/Edges/Hardware screens, CSS); `packages/storage` export `./seed`; `apps/web/src/App.tsx` + tests; handoff `progress/impl_F006.md`; closeout `progress/close_F006.md`.
- **Verificación:** ui 14/14, web 4/4, typecheck ui+web, build Vite web, monorepo `./init.sh` + `pnpm test` verdes. Reviewer: acceptance CAT-01..06 + C1–C4 PASS; residual non-blocking (sin RTL, seed in-memory only, CatalogPicker no montado en shell aún).
- **Cierre:** F006 marcada `done`. Próximo: F007 — ui_option_groups (no iniciado).

## 2026-07-15 — Feature F007: ui_option_groups
- **Agente:** implementer → reviewer (APPROVED en `progress/review_F007.md`).
- **Plan:** UI de OptionGroups en `@muebles/ui`: helpers puros (miembros por kind, code único, `canShowPricePreview`), `OptionGroupsScreen` CRUD controlado, multi-select filtrado por kind, `PricePreviewGate` + demo OPT-05 en shell web (precio solo vía domain en app).
- **Cambios:** `packages/ui/src/optionGroups/*` (helpers, screen, gate, CSS, index + tests); re-exports en `packages/ui/src/index.ts`; `apps/web/src/App.tsx` tab Grupos + demo; `apps/web/src/App.test.ts` OPT-02/03/05; handoff `progress/impl_F007.md`; closeout `progress/close_F007.md`.
- **Verificación:** ui 27/27, web 7/7, typecheck ui+web, build Vite web, monorepo `./init.sh` + `pnpm test` verdes. Reviewer: acceptance OPT-01/02/03/05 + C1–C4 PASS; residual non-blocking (sin RTL, OPT-04 out of scope).
- **Cierre:** F007 marcada `done`. Próximo: F008 — ui_module_editor (no iniciado).

## 2026-07-15 — Feature F008: ui_module_editor
- **Agente:** implementer → reviewer (APPROVED en `progress/review_F008.md`).
- **Plan:** UI de módulos en `@muebles/ui`: helpers puros (optionRole pickers, code único), `ModulesScreen` CRUD controlado (board parts + hardware lines), preview de costo solo vía domain en shell web, seed MOD-GAB-01 / MOD-CAJ-01 con roles.
- **Cambios:** `packages/ui/src/modules/*` (helpers, screen, CSS, index + tests); re-exports en `packages/ui/src/index.ts`; `apps/web/src/App.tsx` tab Muebles + `computeModuleCostPreview`; `apps/web/src/App.test.ts` MOD-06/07 + pickers; handoff `progress/impl_F008.md`; closeout `progress/close_F008.md`.
- **Verificación:** ui 40/40, web 11/11, typecheck ui+web, build Vite web, monorepo `./init.sh` + `pnpm test` verdes. Reviewer: acceptance MOD-01..04/06/07 + C1–C4 PASS; residual non-blocking (sin RTL, MOD-05 out of scope → F015, preview sobre módulo guardado).
- **Cierre:** F008 marcada `done`. Próximo: F009 — ui_quotation (no iniciado).

## 2026-07-15 — Feature F009: ui_quotation
- **Agente:** implementer → reviewer (APPROVED en `progress/review_F009.md`).
- **Plan:** UI de cotización/proyectos en `@muebles/ui`: helpers puros (pickers OPT-04/PRJ-03, validación qty, gate de preview), `ProjectsScreen` lista + editor controlado, totales en vivo solo vía domain en shell web (`calcProjectBreakdown`), PRJ-09/10 (módulo maestro inmutable; líneas duplicadas del mismo módulo con opciones distintas).
- **Cambios:** `packages/ui/src/projects/*` (helpers, screen, CSS, index + tests); re-exports en `packages/ui/src/index.ts`; `apps/web/src/App.tsx` tab Proyectos + CRUD + breakdown; `apps/web/src/App.test.ts` PRJ/OPT/UX; handoff `progress/impl_F009.md`; closeout `progress/close_F009.md`.
- **Verificación:** ui 54/54, web 15/15, typecheck ui+web, monorepo `./init.sh` + `pnpm test` verdes (domain 29, storage 9, excel 7, desktop 2). Reviewer: acceptance PRJ-01..03/06/09/10 + OPT-04 + UX-03 + C1–C4 PASS; residual non-blocking (sin RTL, export disabled → F010, meta save-then-preview, in-memory seed).
- **Cierre:** F009 marcada `done`. Próximo: F010 — ui_export (no iniciado).

## 2026-07-15 — Feature F010: ui_export
- **Agente:** implementer → reviewer (APPROVED en `progress/review_F010.md`).
- **Plan:** export Optimizer desde UI de cotización: domain `collectExportIssues` + lista accionable; web download Blob (EXP-07); desktop Electron dialog/write adapter (EXP-06); bloqueo si fallan VAL-01..07 / opciones; sin herrajes en XLSX (EXP-05).
- **Cambios:** `packages/domain/src/exportIssues.ts` (+ tests); `packages/ui` `ExportIssueList` + wiring en `ProjectsScreen`; `apps/web/src/exportOptimizer.ts` + `App.tsx` export path; `apps/desktop` `electronApi`, `ipcHandlers`, `exportAdapter`, `preload`; handoff `progress/impl_F010.md`; closeout `progress/close_F010.md`.
- **Verificación:** domain 38/38, ui 55/55, excel 7/7, web 23/23, desktop 7/7, monorepo `./init.sh` + typecheck verdes; smoke `/tmp/optimizer_smoke.xlsx`. Reviewer: acceptance EXP-06/07 + lista errores + VAL/EXP-05 + C1–C4 PASS; residual non-blocking (sin e2e Electron, sin RTL, shell web no bifurca desktop, mensajes EN/ES mixtos).
- **Cierre:** F010 marcada `done`. Próximo: F011 — seed_data (no iniciado).

## 2026-07-15 — Feature F011: seed_data
- **Agente:** implementer → reviewer (APPROVED en `progress/review_F011.md`).
- **Plan:** cerrar aceptación de seed plantilla (CAT-06 / OPT-03 / MOD-07): demo MOD-GAB-01 × 1 con choices plantilla, golden GAB-only + dual, export Optimizer del demo.
- **Cambios:** `packages/domain/src/__fixtures__/plantillaDemo.ts` (GAB-only project/expected + createPlantillaDemoProject); `packages/storage/src/seed.ts` (demo project en seed); tests seed/engine/excel/web; handoff `progress/impl_F011.md`; closeout `progress/close_F011.md`.
- **Verificación:** domain 39/39, storage 17/17, excel 8/8, ui 55/55, web 24/24, desktop 7/7; monorepo `./init.sh` + typecheck verdes. Reviewer: acceptance + C1–C4 PASS; residual non-blocking (IDs estables en fixtures, dist web puede laggear source, laborFixed no prorrateado, waste/laborModular 0 documentados).
- **Cierre:** F011 marcada `done`. Próximo: F012 — quote_snapshot (phase 3, no iniciado).

## 2026-07-15 — Feature F012: quote_snapshot
- **Agente:** implementer → reviewer (APPROVED en `progress/review_F012.md`).
- **Plan:** snapshot de precios al cerrar proyecto (`quoted`/`accepted`): draft siempre live; cerrados devuelven breakdown congelado; Escenario B plantilla sin Excel; shell vía `transitionProjectStatus` + badge UI.
- **Cambios:** `packages/domain` (`QuotePriceSnapshot`, `isProjectClosed`, `captureQuoteSnapshot`, `transitionProjectStatus`, `calcProjectBreakdown` freeze path + tests Escenario B); `apps/web/src/App.tsx`; `packages/ui` ProjectsScreen badge; handoff `progress/impl_F012.md`; closeout `progress/close_F012.md`.
- **Verificación:** domain 46/46, ui 55/55, web 24/24, storage 17, excel 8, desktop 7; monorepo `./init.sh` verde. Reviewer: acceptance + C1–C4 PASS; residual non-blocking (sin test shell freeze badge, no re-freeze en edits while closed, closed sin snapshot recalc live).
- **Cierre:** F012 marcada `done`. Próximo: F013 — hardware_list_export (no iniciado).

## 2026-07-15 — Feature F013: hardware_list_export
- **Agente:** implementer → reviewer (APPROVED en `progress/review_F013.md`).
- **Plan:** export lista de herrajes para compras (EXP-08): domain `generateHardwareList` (qty línea × qty ítem, agregación por herraje, sin tableros); excel XLSX/CSV hoja `Herrajes`; pipeline web + botón UI **Lista de herrajes**.
- **Cambios:** `packages/domain` (`HardwarePurchaseRow`, `generateHardwareList` + tests); `packages/excel` (`hardwareListExport` / CSV + tests); `apps/web` (`exportHardwareList.ts`, `App.handleExportHardwareList`); `packages/ui` ProjectsScreen prop + botón; handoff `progress/impl_F013.md`; review `progress/review_F013.md`; closeout `progress/close_F013.md`.
- **Verificación:** domain 52/52, excel 14/14, ui 55/55, web 30/30, storage 17, desktop 7; monorepo `./init.sh` verde. Reviewer: acceptance EXP-08 + formato compras + C1–C4 PASS; residual non-blocking (desktop sin cablear export, UI solo XLSX, gate `collectExportIssues` igual que Optimizer, costos live de catálogo, sin RTL click).
- **Cierre:** F013 marcada `done`. Próximo: F014 — waste_percent (no iniciado).

## 2026-07-15 — Feature F014: waste_percent
- **Agente:** implementer → reviewer (APPROVED en `progress/review_F014.md`).
- **Plan:** merma % por material (`wastePercent`): UI catálogo editable Merma (%); engine `boardCost = areaM2 × costPerM2 × (1 + waste/100)` con default 0; test unitario waste 10%.
- **Cambios:** `packages/domain` (`calcBoardLineCost` waste, tests 10% + omit→0, fixture comment); `packages/ui` MaterialsCatalog columna Merma + validación no negativa; web shell ya mapeaba draft; handoff `progress/impl_F014.md`; review `progress/review_F014.md`; closeout `progress/close_F014.md`.
- **Verificación:** domain 53/53, ui 56/56, excel 14, storage 17, web 30, desktop 7; monorepo `./init.sh` verde. Reviewer: acceptance + C1–C4 PASS; residual non-blocking (engine no valida waste negativo, sin RTL Merma, snapshot sin waste aparte, fixtures waste 0).
- **Cierre:** F014 marcada `done`. Próximo: F015 — duplicate_module_project (no iniciado).

## 2026-07-15 — Feature F015: duplicate_module_project
- **Agente:** implementer → reviewer (APPROVED en `progress/review_F015.md`).
- **Plan:** helpers puros de dominio para duplicar módulo/proyecto + botones UI Duplicar + wiring en shell web; tests verdes; handoff y review.
- **Cambios:** `packages/domain/src/duplicate.ts` (+ `duplicate.test.ts`, exports en `index.ts`); `packages/ui` ModulesScreen/ProjectsScreen acción **Duplicar**; `apps/web/src/App.tsx` `duplicateModuleById` / `duplicateProjectById`; handoff `progress/impl_F015.md`; closeout `progress/close_F015.md`.
- **Verificación:** domain 60/60, ui 56/56, excel 14, storage 17, web 30, desktop 7; monorepo `./init.sh` verde. Reviewer: acceptance MOD-05 + C1–C4 PASS; residual non-blocking (part.code no remapeado, Duplicar en lista no editor, sin RTL botones, desktop sin wiring).
- **Cierre:** F015 marcada `done`. F001–F015 completas. Próximo: F016 — ui_design_system (no iniciado).

## 2026-07-15 — Feature F016: ui_design_system
- **Agente:** implementer → reviewer (APPROVED en `progress/review_F016.md`) → closer.
- **Plan:** design system base docs/design.md §3: tokens.css + reset.css, Inter Google Fonts, lucide-react en @muebles/ui, migrar app.css y CSS de UI a tokens sin redesign de layout (tabs se quedan hasta F017).
- **Cambios:** `packages/ui/src/design-system/{tokens,reset}.css` + `designSystem.test.ts`; lucide + exports en package.json; migración catalogs/modules/projects/optionGroups CSS; `apps/web` index.html Inter, main.tsx imports globales, app.css tokens, designSystemShell.test.ts; handoff `progress/impl_F016.md`; review `progress/review_F016.md`; closeout `progress/close_F016.md`.
- **Verificación:** domain 60/60, ui 59/59, excel 14, storage 17, web 33/33, desktop 7; monorepo `./init.sh` verde. Reviewer: acceptance §3 + C1–C4 PASS; residual non-blocking (bordes semánticos ad-hoc hsl, inline #5f6368 en App.tsx demo, 0.9rem en tabs, mono no cargado, tabs hasta F017).
- **Cierre:** F016 marcada `done`. Próximo: F017 — ui_layout_sidebar (no iniciado).

## 2026-07-15 — Feature F017: ui_layout_sidebar
- **Agente:** implementer → reviewer+closer (APPROVED en `progress/review_F017.md`).
- **Plan:** AppShell sidebar 240px + top bar 56px según design.md §4.1; TRABAJO/CONFIG con iconos Lucide §3.7; colapso + hamburger <900px; eliminar tabs horizontales del shell web.
- **Cambios:** `packages/ui/src/shell/{AppShell.tsx,appShell.css,appShell.test.ts,index.ts}`; exports UI; `apps/web/src/App.tsx` (navId + Home placeholder); `app.css` home-only; `designSystemShell.test.ts` F017; handoff `progress/impl_F017.md`; review `progress/review_F017.md`; closeout `progress/close_F017.md`.
- **Verificación:** domain 60/60, ui 68/68, excel 14, storage 17, web 35/35, desktop 7; monorepo `./init.sh` verde. Reviewer: acceptance §4.1 + C1–C5 PASS; residual non-blocking (brand en sidebar vs ASCII topbar, sin search/user, sin RTL hamburger, dist lag, Home placeholder hasta F023).
- **Cierre:** F017 marcada `done`. Próximo: F018 — ui_modal_component (no iniciado).

## 2026-07-15 — Feature F018: ui_modal_component
- **Agente:** implementer → reviewer+closer (APPROVED en `progress/review_F018.md`).
- **Plan:** Modal reutilizable según design.md §4.3: overlay, scale+opacity, header/footer sticky, body scrollable, sm/md/lg, Esc + overlay, focus trap, body scroll lock, a11y dialog.
- **Cambios:** `packages/ui/src/common/{Modal.tsx,modal.css,Modal.test.tsx,index.ts}`; exports UI + vitest jsx/jsdom; handoff `progress/impl_F018.md`; review `progress/review_F018.md`; closeout `progress/close_F018.md`.
- **Verificación:** domain 60/60, ui 87/87, excel 14, storage 17, web 35/35, desktop 7; monorepo `./init.sh` verde. Reviewer: acceptance §4.3 + C1–C5 PASS; residual non-blocking (sin consumidores de catálogo hasta F020, overlay no focusable, MODAL_CLOSE_MS = 350).
- **Cierre:** F018 marcada `done`. Próximo: F019 — ui_toast_system (no iniciado).

## 2026-07-15 — Feature F019: ui_toast_system
- **Agente:** implementer → reviewer+closer (APPROVED en `progress/review_F019.md`).
- **Plan:** sistema de toasts compartido §4.4: ToastProvider + useToast, top-right max 3, auto-dismiss 4s + progress, tipos con tokens; wiring App create/update/deactivate/export; validación export inline.
- **Cambios:** `packages/ui/src/common/{Toast.tsx,toast.css,Toast.test.tsx,index.ts}`; exports UI; `apps/web/src/App.tsx` + designSystemShell.test.ts; handoff `progress/impl_F019.md`; review `progress/review_F019.md`; closeout `progress/close_F019.md`.
- **Verificación:** domain 60, excel 14, storage 17, ui 97, web 37, desktop 7; monorepo `./init.sh` verde. Reviewer: acceptance + design §4.4 + C1–C5 PASS; residual non-blocking (copy design vs feature-list, F020 out of scope).
- **Cierre:** F019 marcada `done`. Próximo: F020 — ui_catalogs_modal_list (no iniciado).

## 2026-07-15 — Feature F020: ui_catalogs_modal_list
- **Agente:** implementer → reviewer+closer (APPROVED en `progress/review_F020.md`).
- **Plan:** refactor catálogos a lista + SearchInput (debounce 150ms) + StatusChips + EmptyState + Modal SM; hover row actions; detail expand read-only; helpers status/query.
- **Cambios:** `packages/ui/src/common/{SearchInput,StatusChips,EmptyState,useDebouncedValue}` + tests; Materials/Edges/Hardware catalogs + OptionGroupsScreen; CatalogTable + catalogs.css; catalogHelpers status/query; handoff `progress/impl_F020.md`; review `progress/review_F020.md`; closeout `progress/close_F020.md`.
- **Verificación:** domain 60, excel 14, storage 17, ui 112, web 37, desktop 7; monorepo `./init.sh` verde. Reviewer: acceptance §4.2/§4.5/§4.6/§5.3 + C1–C5 PASS; residual non-blocking (columna acciones structural opacity-reveal, OptionGroups sin chips, hsl danger preexistente).
- **Cierre:** F020 marcada `done`. Próximo: F021 — ui_modules_cards_detail (no iniciado).

## 2026-07-15 — Feature F021: ui_modules_cards_detail
- **Agente:** implementer → reviewer+closer (APPROVED en `progress/review_F021.md`).
- **Plan:** rediseñar ModulesScreen a cards + detalle read-only + Modal LG; estimates de costo solo vía shell (`moduleEstimates` + `costPreview`).
- **Cambios:** `packages/ui/src/modules/{ModulesScreen.tsx,modules.css,moduleHelpers.ts,ModulesScreen.test.tsx,moduleHelpers.test.ts,index.ts}`; exports UI; `apps/web/src/App.tsx` moduleEstimates; handoff `progress/impl_F021.md`; review `progress/review_F021.md`; closeout `progress/close_F021.md`.
- **Verificación:** domain 60, excel 14, storage 17, ui 122, web 37, desktop 7; monorepo `./init.sh` verde. Reviewer: acceptance cards/detail/Modal LG/EmptyState + design §4.2/§4.3 LG/§5.3 + C1–C5 PASS; residual non-blocking (§6.3 ausente en design.md, rem preexistente en editor CSS, un inline margin, recompute de estimates).
- **Cierre:** F021 marcada `done`. Próximo: F022 — ui_projects_cards_detail (no iniciado).

## F023 — ui_dashboard (2026-07-15)

- **Veredicto:** APPROVED (`progress/review_F023.md`)
- **Qué:** Dashboard Home con 4 stats, cotizaciones recientes (top 5), acciones rápidas; open-from-outside a Projects/Modules.
- **Dónde:** `packages/ui/src/dashboard/*`, shell `App.tsx`, props `openProjectId` / `requestCreateKey`.
- **Tests:** ui 165 · web 39 · typecheck ui/web green.
- **Siguiente UI residual:** Slice E Login tokens + gate; Slice F polish/design.md.

## UI residual A–F + F023 (2026-07-15)

- Re-audit post-crecimiento: `progress/explore_ui_ux_reaudit.md`
- A: Project.customerId contract (no as-any)
- B: Customer picker en cotizaciones
- C: Demo OPT-05 fuera de Grupos
- D: F023 Dashboard APPROVED/done
- E: Login tokens + session gate
- F: design.md v1.1 §6 pantallas + botón Salir topbar
- Tests: ui 170 · web 50 · monorepo init green


## 2026-07-15 — Feature F025: module_hierarchical_categories
- **Agente:** implementer → reviewer (APPROVED en `progress/review_F025.md`).
- **Plan:** categorías jerárquicas 3 niveles (domain + Postgres/Go + APIWorkspace + ModulesScreen árbol/cascade + ProjectsScreen cascade).
- **Cambios:** domain `categories.ts`; Go `categories` storage/api + migrations; `apiWorkspaceRepository`; UI modules/projects; `App.tsx` wiring; handoff `impl_F025.md`; review `review_F025.md`; closeout `close_F025.md`.
- **Verificación:** `./init.sh` verde; domain 70; ui 174; web 50; `go test ./...` OK; migración Docker aplicada.
- **Cierre:** F025 marcada `done`. Sin pending en feature_list.

## 2026-07-15 — Feature F026: auth_register_admin_approval
- **Agente:** implementer + self-review APPROVED (`progress/review_F026.md`).
- **Plan:** cablear registro con aprobación admin y roles (admin/user + specialty).
- **Cambios:** session register/user role; SessionGate RegisterScreen; AppShell Usuarios admin; UsersScreen; domain UserRole `user`; IsValidUserRole; tests; handoff impl/review/close F026.
- **Verificación:** `./init.sh` verde; UI 182; web 56; go api/auth/domain OK; smoke API register→approve→login.
- **Cierre:** F026 `done`. Admin seed `tiagofur@gmail.com` / `asd123`.

## 2026-07-15 — Auditoría PRD + backlog F029–F033 / issues #35–#39
- **Agente:** Grok (sesión documentación).
- **Cambios:** `docs/prd.md` actualizado al estado real (MVP hecho, v1.1 parcial, Etapa 2 avanzada); `feature_list.json` añade F029–F033 pending; `progress/current.md` refleja backlog.
- **GitHub:** issues abiertos #35 opciones proyecto, #36 cotización comercial, #37 Ajustes, #38 Electron empaquetado, #39 atajos grilla.
- **Próximo:** F029 (#35) según harness (menor id pending).


---

## Sesión — Components catalog critique + Judgment Day (cerrada 2026-08-10)

- **Branch:** `feat/quote-projectar-ux-bridge`
- **Scope:** Critique + JD + fixes Componentes (lista/detalle/crear/editar)

### Hecho
- Critique 24/40 Acceptable
- JD Rounds 1–5
- **JUDGMENT: APPROVED** (R5 ambos jueces CLEAN)

### Fixes clave
- C1–C8: draft wipe, perforations, fórmulas, confirm desactivar, rot 0, 3D tab, placement filter, dims+fórmulas
- Session: `seedEditorDraftFromBaseline` + `setDraftLocal` en forceClose (no sticky empty)
- `consumeRequestCreateKey` modules/materials/projects
- geometrySummary fórmulas en lista/detalle; edges con preview dims

### Tests
- Suites components/modules/common relacionadas verdes

## F096 — FabricScreen v2: board por obra (2026-08-18)

Aprobada la migración de Producción de cola plana a cards por obra/estación, con DTO puro para métricas de Corte/Encintado, picking persistido por claves válidas, claims obra×estación, finish y batch auditado por ítem. La corrección final confirma antes de mutar el último claim/batch, evita batch duplicado con varios operarios y muestra la hora de inicio. Verificaciones: typecheck, suite focal UI, `pnpm test` y Go focal verdes.

## F097 — Dashboard de Producción y surtido visible (2026-08-18)

- Dashboard alineado al conjunto de obras que lista, estado explícito para
  obras sin módulos y sectores con iconografía Lucide.
- Corte/Encintado muestran únicamente el picking persistido por
  obra×categoría; no infieren stock ni asignación por material/canto.
- Revisión APPROVED (`progress/review_f097.md`); evidencia en
  `progress/implement_f097.md`.

## F098 — Instalaciones: dirección y contacto del cliente (2026-08-18)

- Aprobada en `progress/review_f098.md`.
- Las cards de Instalaciones exponen dirección, teléfono y email existentes del cliente, con wrapping seguro en phone y enlaces accionables.
- Evidencia de implementación y verificación: `progress/implement_f098.md`.

## F099 — Polish final del módulo Producción (2026-08-18)

- Aprobada en `progress/review_f099.md`.
- El dashboard de Producción se alineó al sistema compartido: tokens y `.btn`, estados de carga/error recuperables, semántica ARIA de filtros y progreso, reflujo seguro en phone y focos visibles.
- Todos los iconos Lucide del dashboard declaran `strokeWidth={1.5}` y `aria-hidden` cuando son decorativos; la regresión focal protege ambos contratos.
- Verificación: dashboard focal 6 tests, `pnpm typecheck`, `./init.sh` (domain 632, UI 966, web 257, desktop 17, mobile 36) y `git diff --check` verdes.

## 2026-08-18 — Gating por etapa del proceso (ventas → ingeniería → almacén → fábrica)

- Dominio: `processStage.ts` (`projectProcessStage`, `canReleaseMaterials`, labels ES) + `canSendToProduction` exige ingeniería documentada + `Project.materialsRelease` (`{releasedBy, releasedAt}`).
- Persistencia: `materials_release` JSONB en `projects` (migración Go aditiva 000059); mappers en `apiMappers.ts` con round-trip testeado.
- UI: Ingeniería (cola = etapa ingeniería, "Enviadas" read-only), Almacén (proyectos en etapa almacén + "Material completo"), Fábrica exige `materialsRelease`, Órdenes filtrado a etapa producción. `sendProjectToProduction` sin bypass sin log.
- Verificación: 2114 tests + `pnpm typecheck` + `go test ./internal/...` verde; server aplica 000059. Docs: `docs/project-lifecycle.md` §8.
- Pendiente explícito que quedó: event log completo `ProjectEvent[]` con KPIs de tiempos.

## 2026-08-18 — Ciclo de crítica UI: unificación v2 + craft v2.1 (score 24→28→30/40)

- Tres critiques (snapshots en `.impeccable/critique/`): 24 → 28 → 30/40; detector de 1 hallazgo a 0.
- Unificación v2 (commits `bc9c526` + `24f8923`): esqueleto único `.page-header` (aliases), 141 font-size → tokens, tokens muertos eliminados, color de área (VENTAS teal / INGENIERÍA indigo / PRODUCCIÓN naranja), `statusBadge.css` + `statCard.css` comunes, `ConfirmDialog` (0 window.confirm), destructivas `btn--danger`, copy sobrio.
- Craft v2.1: controles táctiles (radius-md, `:active` translateY, state layers), badges semánticos sin borde a saturación plena, sidebar tonal 28%, `stat-card--emphasis`, placeholder de foto con silueta tintada, login con panel de marca indigo.
- `docs/design.md` v2→v2.1 documentando cada capa. Pendiente sugerido de ese entonces (meta 32+): higiene de datos, nav, ayuda contextual — resuelto en las sesiones siguientes.

## 2026-08-18 — docs design v3.0: estándar de excelencia UI/UX (09fcf7b)

- §2.1 ADN visual Apple × Google con regla de desempate (decoración→Apple quita; completitud de sistema→Google completa); §2.2 prueba de las 8 horas; §3.3.1 semántica de elevación L0–L4; §3.6.1 state layers; §4.8 accesibilidad/teclado AA; §4.9 ayuda contextual; §7 contenido y copy (higiene de datos, formato, copy de estados); §8 Definición de Done de UI (gate 10 ítems); §4.0 touch estándar 44px.
- `reviewer` skill: recorre gate §8 (D7) + copy/a11y (D8) en su veredicto.
- Decisión: NO crear skill paralelo a impeccable — `docs/design.md` ya es su DESIGN vía `context.mjs`.

## 2026-08-18 — Review UI de /orders como test del estándar v3 (217eb7e)

- Gate §8 sobre cola + hub `/orders/:id`: 5/10 en verde; detector 0 hallazgos.
- P1: guest en deep link `/orders` → main vacío (sin redirect); higiene de datos en vivo ("schema v3" en topbar, "#111" en hint, "payload QR" en placeholder; el "teléfono crudo" resultó ser el nombre creado por un test del backend contra la DB local). P2: doble primaria simultánea, stat-card/tabla propios, fecha numérica, separadores pegados.
- El estándar quedó refinado por el test: regla de primaria "una por nivel de contexto" (§8) y workspaces tipo hub reconocidos en §4.1a. Spec §6.7 actualizada a la realidad del código (nav `orders`, rutas `/orders`, 5 tabs, despacho→Embarques).

## 2026-08-18 — Mejoras UI /orders: backlog del review implementado (d1fdc81)

- P1: redirect de guest con `navBlockedForSession` (routes.ts + tests); "schema v3" fuera del topbar; "#111" fuera del hint CNC; placeholder de Piso sin jerga; `formatIsoDate` humano es-MX «18 ago 2026» (global); medidas «400 × 720 × 590 mm»; "ML" mayúscula; cliente con ellipsis+title.
- P2: primarias por contexto (`packAsPrimary`/`exportAsPrimary` — chrome Pack es la única primaria); Resumen con `.stat-card--work` (CSS propio `prod-hub__total-card` eliminado); Herrajes con `.data-table` + números right/tabular-nums + `formatMoneyDisplay`.
- A11y: tabpanel con `aria-labelledby`; filtro Piso vacío con `EmptyState` no-results.
- Verificación: monorepo tests verdes (263 web / 974 UI), typecheck verde, detector 0; todo confirmado en vivo (admin + guest).
- P3 quedando: labels «Cut-list CSV»/«CNC pilot» (sancionados por §6.7), borde de canto redundante (dato), separadores "·" pegados en meta del hub.

## 2026-08-18 — Limpieza de documentación

- `docs/design.md` §1 (diagnóstico pre-rediseño U1–U8/I1–I8, ya resuelto) archivado en `docs/history/diagnostico-ui-pre-rediseno.md`; notas "pre-Fase 3" eliminadas (migración ya hecha); nota de extracción de statusBadge marcada completa; jerga de slice eliminada.
- `progress/current.md` reseteado a plantilla limpia; sesiones cerradas movidas a esta bitácora.

## 2026-08-18 — Limpieza integral de documentación (segunda pasada: todo el repo)

- `progress/archive/` creado: **119 artefactos de sesiones cerradas** movidos con `git mv` (close_F001–F026, impl_*, implement_f095–f099, review_*, explore_*). `progress/` queda con current.md + history.md + archive/.
- `docs/judgment-day-ui-2026-07-17.md` → `docs/history/` (sus pares ya vivían ahí).
- `docs/guia-de-uso.md` §9 corregido: el hub de Órdenes tiene 5 tabs (Resumen · Piso · Etiquetas · Herrajes · Documentos); las técnicas viven en Ingeniería y el Control de Carga en Embarques. Decía 9 tabs.
- `docs/production-module.md`: nav tree actualizado (Órdenes `/orders` sin "TEMPORAL M2", despacho en Embarques) + paths explícitos a `docs/roadmap-screens/`.
- `docs/design.md`: referencias `roadmap-screens/` → `docs/roadmap-screens/` (resolvían ambiguas).
- `docs/prd.md` §6.7: "Plan vivo" apunta a `roadmap-comercial-v2.md` (backlog canónico); app-excellence marcado histórico — se mantiene en docs/ porque production-module, prd y feature_list lo referencian como detalle.
- `AGENTS.md` (mapa): + roadmap-comercial-v2, + progress/archive/, + docs/roadmap-screens/, + docs/history/ como carpeta; app-excellence reclasificado; layout actualizado.
- Se mantienen (vigentes): cut-plan-implementation.md (plan de fases aún no ejecutado del todo), structures.md (referencia de dominio), desktop-release.md (guía evergreen), roadmap_RN/mobile-*, PRODUCT.md.
- Verificación: 974 tests UI verdes; solo docs y moves — sin cambios de código.


## F100 — Area Tonal Theme Foundation (2026-08-19)

- Aprobada en `progress/review_F100.md` sobre el commit publicado `72b0582`.
- `docs/design.md` define el contexto tonal Sales / Engineering / Production / neutral, con canvas y chrome tonal pero superficies de trabajo neutrales.
- `AppShell` propaga `data-area-context`; CTAs brand, focus y estados semánticos permanecen globales.
- Tokens incluyen roles contextuales y 16 pares de contraste AA verificados por test (mínimo 5.87:1).
- Evidencia: 22 tests focales de shell, 4 de integración web, `pnpm test`, `pnpm typecheck` y `./init.sh` verdes.

## F101 — Page Chrome, Toolbar & Action Hierarchy (2026-08-19)

- Aprobada en `progress/review_F101.md` sobre los commits publicados `b02fa83` y `d9eccfb`.
- Se incorporaron `PageHeader` y `PageToolbar` tipados y accesibles, con slots explícitos para título, acciones, overflow y controles de búsqueda/filtro/tabs.
- Cotizaciones e Ingeniería adoptaron el chrome compartido; Vistas de producción usa el header contextual y conserva la descarga de elevaciones como acción secundaria.
- La prueba de composición de `EngineeringWorkspace` garantiza que «Enviar a Producción» sigue siendo la única primaria cuando Vistas está activa.
- Verificación: tests focales, `pnpm test`, `pnpm typecheck`, `./init.sh` y detector Impeccable verdes. Evidencia responsive queda declarada como bloqueada porque no hubo Browser/screenshot/Computer Use disponible.

## F102 — Semantic Tabs: two patterns, one workspace family (2026-08-19)

- Aprobada en `progress/review_F102.md` sobre el commit publicado `183e1cd`.
- `WorkspaceTabs` unifica las vistas pares de Órdenes e Ingeniería; `WorkflowTabs` conserva el subrayado de estaciones de Fábrica.
- Se garantizan roles ARIA, paneles existentes para toda referencia `aria-controls`, roving tabindex, teclas Arrow/Home/End, count/disabled y overflow horizontal de una sola fila.
- Verificación: 33 pruebas focales, `pnpm test`, `pnpm typecheck` y `./init.sh` verdes; evidencia visual declarada bloqueada por ausencia de herramientas de captura.

## 2026-08-19 — F103 UI/UX Documentation Sync & Executable Source Contract

- Sincronizada la documentación UI/UX con `apps/web/src/routes.ts` → `NAV_PATHS`
  y guards ejecutables; rutas y RBAC narrativos ya no son autoridad.
- Documentados F100–F102 como **implemented** y formularios, overlays, AA global,
  targets de 44px, z-index, motion y rollout responsive como **planned**.
- Normalizados aliases históricos como **deprecated** y corregidas las reglas de
  ruta/RBAC de Órdenes, Embarques e Instalaciones tras revisión independiente.
- Verificación: JSON válido, matriz de 24 `AppNavId` contrastada y `git diff --check`.
- Commit: `649b6fc` (`docs(ui): synchronize UX design contracts`).

## F104 — Page Chrome Rollout I: Catálogos y Librería (2026-08-19)

- Aprobada en `progress/review_F104.md`.
- Las 9 pantallas de catálogos/librería (Materiales, Cantos, Herrajes, Acabados, Grupos, Muebles, Estructuras, Componentes, Agregados) migraron al esqueleto único `PageHeader`/`PageToolbar` con icon-chip de área y una primaria por nivel.
- Título «Catálogo de Acabados» → «Acabados» (§4.1b) y copy sentence-case en Agregados; iconos normalizados a strokeWidth 1.5.
- Verificación: 12 tests nuevos de composición, UI 1006/1006, typecheck, `./init.sh`, detector 0 hallazgos y smoke visual 390/768/1280 sin overflow.
- Antes de esta feature: critique de estandarización 28/40 (`progress/explore_ui_standardization_critique.md`) y registro del programa F104–F111 a pedido del dueño.

## F112 — Área Library (Catálogos + Librería) en oliva/sage (2026-08-19)

- Aprobada en `progress/review_F112.md`; familia elegida por el dueño entre
  3 propuestas (oliva/ciruela/violeta).
- Nuevo contexto `library` (hue 95) con contrato F100 completo: rampa primitiva,
  roles tonales, sidebar/topbar, variante stat-card y placeholder de Muebles.
- 20 pares AA verificados por test (library mínimo 6.59:1); integración web de
  rutas actualizada; docs/design.md §3.2.1 con la taxonomía de 5 contextos.
- Verificación: UI 1008/1008, typecheck, ./init.sh, detector 0 y smoke visual
  con canvas oliva rgb(247,250,245) en /materials y /modules.

## F105 — Page Chrome Rollout II: Ventas y Trabajo (2026-08-19)

- Aprobada en `progress/review_F105.md`.
- Inicio, Dashboard de Ventas, Clientes, Vitrina y Estado de Planta migran al
  esqueleto único `PageHeader`/`PageToolbar` con icon-chips del mapa §3.7.
- Vitrina reestructurada: el header lo posee `ShowcaseScreen`, los tabs viven
  en la toolbar y los cuerpos (Portafolio/Módulos) ya no duplican título.
- Título «Vitrina» alineado al label de nav; CSS huérfano podado
  (dashboard/plant-board title-icon, showcase/portfolio headers, alias de
  pageHeader.css sin uso).
- Verificación: 5 tests nuevos de composición, UI 1013/1013, typecheck,
  ./init.sh, detector 0, smoke 1280/390 sin overflow con una primaria en Inicio.

## F106 — Page Chrome Rollout III: Producción, Almacén y Config (2026-08-19)

- Aprobada en `progress/review_F106.md`.
- Las 7 pantallas restantes (Dashboard de Producción, Producción/estaciones,
  Embarques, Instalaciones, Almacén, Ajustes, Usuarios) migran a PageHeader
  con icon-chips del mapa §3.7 y contexto (stats/toggle/badge) en
  contextualControls.
- A11y: icon-only de Usuarios (recargar, sectores, rol deshabilitado) con
  aria-label.
- Limpieza mayor de pageHeader.css: sólo queda vivo el alias `.prod-queue__*`
  (hub de Órdenes); icon-chips y header CSS locales retirados.
- Verificación: 7 tests nuevos, UI 1020/1020, typecheck, ./init.sh, detector 0,
  smoke /settings 1280/390 (rutas admin cubiertas por tests; guest redirige).
- Con esto el esqueleto único §4.1a cubre todas las pantallas de lista/página
  del producto (F104–F106 completos).

## F107 — Área tonal calibrada (2026-08-19)

- Aprobada en `progress/review_F107.md`.
- Canvas de área L 97→95 con croma al alza y chrome L 94→92 (un paso sobre el
  canvas) en las 5 áreas; escalera completa canvas 95 → chrome 92 →
  selected ~91 → container 89. Surfaces de trabajo, brand y semánticos
  intactos (aserciones literales en test).
- Perceptibilidad demostrada por cálculo CIELAB (dE76 vs `--surface-app`:
  canvas 2.6–7.9 y chrome 5.9–14.5, antes 0.3–3.5 que se leía gris neutro) y
  codificada como test de regresión de calibración en `appShell.test.ts`.
- 20 pares AA recalculados; mínimo 5.87:1 (sales/container). docs/design.md
  §3.2.1 con nueva guía "Intensidad calibrada".
- Verificación: UI tests completos, typecheck, ./init.sh verde. Icon-chip
  coverage cubierta por tests de rollout F104–F106.

## F108 — Contraste AA medido (2026-08-19)

- Aprobada en `progress/review_F108.md`.
- `--text-muted` → hsl(230 12% 46%): >=4.59:1 en blanco, surface-app, card,
  hover, input y selected (antes 4.10/3.82); placeholder del search hereda el
  fix. `--warning-700` → hsl(38 80% 32%): 4.92:1 sobre warning-50 y 5.21:1
  sobre blanco (antes 3.68). Placeholder de login: blanco 60% (5.77:1 sobre
  card brand-800, peor caso; antes ~3.1–3.7).
- Nuevo `design-system/textContrast.test.ts` (25 tests): pares texto×surface,
  pares de badge semántico, guard de alpha de login. Los badges (-xs 12px
  semibold) no califican como large text → se exige 4.5:1.
- docs/design.md §3.2 valores y §4.8 tabla de valores medidos actualizados.
- Verificación: tests completos, typecheck, ./init.sh verde. Nota: uso de
  `--warning-800` sin token en productionManagerDashboard.css queda como
  deuda de vocabularios (F111).

## F109 — Semantic Tabs Rollout (2026-08-19)

- Aprobada en `progress/review_F109.md`.
- 16 superficies migradas al contrato único de common/Tabs.tsx: 4 editors +
  ProductionQueue (peer), Despiece/Labels/Paperless (workflow ordenado),
  purchasing completo (peer), Showcase, PresentationMode, KitchenPlanSlide,
  SpatialStudio (3 tablists). Rationale peer-vs-workflow por superficie en la
  review.
- TabDefinition extendido: title/icon/alert (hacia atrás compatible);
  `.tabs__alert` con tokens warning.
- CSS legacy .tab-bar/.tab-btn eliminado de tabs.css (~150 líneas) +
  selectores huérfanos podados en 7 archivos de feature. Copy-mode de labels
  pasó a toggle aria-pressed (.prod-seg-btn), no tablist.
- Gate test nuevo `common/tabsRollout.test.ts`: 0 role=tablist y 0 tab-btn
  fuera del primitivo. Tests focales nuevos por superficie (contract ARIA +
  roving).
- Verificación: suites focales verde, ./init.sh completo, typecheck, detector
  0 hallazgos. Deuda menor anotada: StructureEditorAgregadosPanel sin id de
  tabpanel estático (compartido por dos editors).

## F110 — Overlays al contrato único (2026-08-19)

- Aprobada en `progress/review_F110.md`.
- Nuevo primitivo `common/FullscreenDialog` (F110): portal, role=dialog +
  aria-labelledby, focus trap, Esc (desactivable para capas anidadas),
  restore de foco y scroll lock; superficie edge-to-edge tokenizada.
  Exportado del barrel common y del paquete.
- SectorAssignment, CsvExportConfigModal y OnboardingTourModal migran a
  Modal (sin backdrop/Esc/focus casero; onboarding sigue skippable vía un
  único handleDismiss).
- Lightbox de Vitrina y PresentationMode migran a FullscreenDialog. Esc de
  presentación en capas (shortcuts → onClose) queda como único camino
  (escapeEnabled=false). Lightbox gana navegación por flechas.
- CSS de features reducido a contenido; backdrop rgba del lightbox
  reemplazado por token. Tests focales keyboard/SR por overlay (labelledby,
  Esc, trap, restore, close con nombre accesible).
- Verificación: focused verde (169+19 y 71/71), ./init.sh completo,
  typecheck, detector 0 hallazgos.

## F111 — Vocabularios y sistema (P2): badges, stats, touch, labels, z-index (2026-08-19)

- Migración de badges locales (`catalog-badge`, `sales-badge`, `users-role-badge`, `eng-badge`) a `.status-badge` / `.meta-chip` neutral (§5.2).
- Migración de stats locales (`dashboard`, `engineering`, `production`, `purchasing`, `sales`) a `.stat-card` compartido.
- Botón primario de internal-comms migrado al botón estándar `.btn`.
- Elevación de `--touch-min` a 2.75rem (44px) por §4.0 y adopción de escala canónica de z-index (`--z-base` a `--z-tooltip`).
- Desambiguación de labels de navegación en AppShell (`Dashboard Ventas` y `Dashboard Producción`) y Cmd+K.
- Gate test de colores literales añadido a `packages/ui/src/design-system/designSystem.test.ts`.
- Verificación: `./init.sh` pasa al 100%, `pnpm typecheck` verde, monorepo limpio.


## F124 — Estrategia de corte CNC nesting: motor MaxRects (2026-08-20)

- `CutStrategy ('saw-guillotine'|'cnc-nesting')` opcional en `CutPlanConfig` y `CutPlanSheet.strategy` — retrocompatible con `Project.cutPlan` persistido (JSONB Go sin cambios).
- `optimizer/nesting.ts`: MaxRects Best Short Side Fit; espaciado de herramienta `toolSpacingMm` (default 8mm) inflando el rect usado en los 4 lados → sin solapes y holgura ≥ spacing en ≥1 eje (verificado por stress test del reviewer: 200 seeds × spacing 0–12).
- `unrollRows`/`PlacementResult`/regla de retazo útil extraídos a `optimizer/pieces.ts` (compartido, sin ciclos).
- Dispatch por estrategia en `optimizeSingleMaterial`; camino sierra intacto (tests preexistentes sin cambios).
- Remanentes: subset disjunto greedy por área para stats sin doble conteo.
- Fixture determinista kerf 12 vs spacing 4: sierra 3 tableros → nesting 1.
- Verificación: `pnpm test` completo (2376), `pnpm typecheck` 7 workspaces, review APPROVED (code), push a origin.

## F125 — Exportador DXF R12 para plan de corte nesting (2026-08-20)

- `packages/excel/src/dxfCutPlanExport.ts`: writer ASCII DXF R12 propio (sin deps nuevas), unidades mm, Y arriba.
- Variantes: `sheets` (tableros en fila con contorno, encabezado material/espesor, retazos útiles) y `pieces` (piezas sueltas en grilla con material, para nesting externo).
- Capas TABLERO/PIEZA/ETIQUETA/VETA/PERF/RETAZO; etiquetas partCode+medidas+módulo+labelRef+cantos; texto sanitizado ASCII.
- Veta con flecha (VETA); perforaciones opcionales en PERF solo en caras front/back y piezas no rotadas (espejo/canto indefinido sin convención de máquina).
- Tests: golden ×2 + estructura R12 + conteos por capa + ASCII + ValidationError (79/79 excel; 2333 total).
- Review: código aprobado con validación DXF por parser propio del reviewer; fix de proceso (push + bitácora) y filtro de caras adoptados.

## F126 — UI: selector de tipo de corte y export exclusivo (2026-08-20)

- `ProductionOrderOptimizationPanel`: «Tipo de corte: Sierra | CNC Nesting» (toggles `aria-pressed`); config adaptativa (kerf+refilados ↔ espaciado de fresa); secuencia de cortes solo en sierra.
- Export exclusivo según la estrategia del plan generado: sierra → PDF taller + Optimizer XLSX (card nueva) + placeholder seccionadoras; nesting → DXF (tableros nesteados / piezas sueltas) reemplazando el placeholder «Próximamente».
- Wiring completo: EngineeringWorkspace → ShellView → useExportHandlers (toast+busy) → exportCutPlanDxf.ts → dxfCutPlanExport (@muebles/excel); MIME .dxf.
- Tests: 6 en el panel (swap de inputs, exclusividad por modo, variantes DXF, secuencia condicional). Suite total 2338 verde; typecheck 7 workspaces.
- Review: APPROVED con fix de typo de copy («nesteado») aplicado; emojis→Lucide y btn--secondary listados como polish futuro (no mezclados).
- Spec del tab actualizada: docs/roadmap-screens/02-ingenieria.md.

## F127 — Perfiles de maquinado en catálogo de herrajes (perforaciones CNC — 1/5) (2026-08-20)

- Re-escpeo de F081 con el dueño del producto: perforaciones CNC driven-by-herraje como datos estructurados (sin CSG), DXF por capas como salida (importable en SCM Maestro), sistema 32mm como defaults, coords desde cantos, reglas automáticas + excepciones manuales. Serie F127–F132 creada; F132 (post-procesador SCM nativo) postergado hasta confirmar máquina.
- `MachiningOperation` (blind_hole/through_hole/counterbore/screw_pilot; Ø, profundidad, offsets x/y mm, face anchor|opposite) + `HardwareMachiningPart` (rol) + `HardwareMachiningProfile` en `types.ts`, colgado de `Hardware.machining?` (retrocompatible).
- `hardwareMachining.ts`: `validateMachiningProfile` (ValidationError accionable con contexto de parte/operación), `normalizeMachiningProfile` (sanitización leniente — garbage never enters), `countMachiningOperations`.
- Seeds paridad TS/Go para los 4 básicos: bisagra (taza Ø35×12.5 + 2 fijaciones Ø5 a 45mm), placa base nueva HER-PLACA-BIS (2×Ø5 a 32mm — sistema 32), taquete HER-TAQ-8X30 (ciego Ø8×15 por lado), minifix juego HER-MIN-15 (cazuela Ø15×13 + piloto perno Ø5×12 en partes separadas), tornillo 4×50 (piloto Ø3×35).
- UI: `HardwareMachiningSection.tsx` — disclosure «Maquinado CNC» en el modal de herraje (auto-open si el ítem tiene perfil, patrón F117), edición de partes/operaciones, validación en submit vía dominio, resumen en fila expandida; CSS tokens-only en `catalogs.css`.
- Persistencia completa: apiMappers TS (normaliza en ingest, null legacy), store web (create/update/drop), Go struct + scan/insert/update JSONB, migración aditiva `000063_hardware_machining` (embed automático).
- Tests: domain +22 (validación/normalize/golden seeds), storage +3 (round-trip API), ui +5 (editor), web +2 (store preserva perfil), Go `TestHardware_PersistsMachiningProfile` integración real Postgres (nil preservado, clear on update, dos partes con profundidades). Suite 2376 + typecheck 7/7 + go test verdes.
- Review: APPROVED tras fixes (push + imports fusionados en catalog/hardware.ts); evidencia en `progress/review_F127.md`.

## F133 — Tipo de corte por defecto del taller (2026-08-20)

- Surge de uso real: el usuario no encontraba el cambio sierra→nesting (vive en
  Ingeniería → tab Optimización, por obra, F126) y el fallback para obras sin plan
  estaba hardcodeado a Sierra. F133 agrega el default de taller con precedencia
  **plan de la obra → default del taller → sierra**.
- `CutStrategy` movida a `types.ts` (re-export en `optimizer/types.ts`, sin ciclo);
  `WorkshopSettings.defaultCutStrategy?` + validación del union en `resolveWorkshopSettings`
  (basura → saw-guillotine). Mappers API snake_case (`default_cut_strategy`).
- Ajustes → Ingeniería y Producción: fieldset «Tipo de corte» con radios Sierra
  (guillotina) | CNC nesting + hint de precedencia; panel de Optimización inicializa
  con `plan ?? defaultCutStrategy ?? sierra`; wiring ShellView → EngineeringWorkspace → panel.
- Paridad Go: `WorkshopSettings.DefaultCutStrategy`, SELECT/UPSERT + normalize,
  migración aditiva `000064` (TEXT nullable). Tests: domain +4, storage +3, ui +5,
  SettingsScreen payloads; suite 2391, typecheck 7/7, go test verde. Review APPROVED
  (`progress/review_F133.md`).

### Incidente de proceso (resuelto)

El primer commit de F133 (`4fbfe80`) mezcló por accidente trabajo PTX/settings del
taller que apareció en el working tree **en paralelo** durante la sesión (PTX por
material + tab Ajustes de Ingeniería). Se partió la historia: `abbcb10` = trabajo
del taller verificado verde standalone (domain 690, excel 85, web 290), `997bf3b` =
F133 pura; el reviewer verificó `git diff 4fbfe80 997bf3b` vacío (split exacto) y
se reemplazó el commit mixto por force-with-lease. Lección: `git add -A` ciega
mezcla trabajo paralelo; agregar por lista explícita de archivos o `git add -p`.

### Deuda anotada (follow-ups)

- Settings PTX (`ptxExportMode`, `defaultSawKerfMm`, trims, `deductEdgeBand`) sin
  paridad Go — en modo server se pierden al recargar (falta de la sesión PTX, no de F133).
- Botón «Por Material (ZIP)» del panel usa `btn--secondary` (clase inexistente) —
  fix del lado PTX. Estilos inline px en Settings (deuda heredada del patrón PTX).

## F128 — Motor de resolución: placements + perfiles → agujeros por pieza (2026-08-21)

- Implementada originalmente en `cb21e4a` por sesión paralela (junto con wiring
  adelantado del DXF de corte, parte del scope F130 aceptado por el dueño).
- Motor puro `partDrillingResolver.ts`: `resolvePartDrilling(piece, placements?, catalog?)`
  → `ResolvedPartDrilling` con `HoleDefinition` reales por cara en coords desde
  cantos (convención face-planes: front/back x=ancho y=largo; left/right x=espesor
  y=largo; top/bottom x=ancho y=espesor — misma que hardwarePlacement), issues
  estructuradas (DEPTH_EXCEEDS_MATERIAL, HOLE_OUT_OF_BOUNDS, HOLE_COLLISION en
  cara y entre caras opuestas), dedupe 0.1mm, modo `strict` con ValidationError,
  fórmulas paramétricas con el boardEnv de placements, fallback a heurísticas F074
  marcado con `fallbackUsed`. Reactividad testeada: mover placement mueve agujeros,
  cambiar herraje adapta Ø/profundidad.
- Review en 3 rondas (veredicto final APPROVED):
  1. `cb21a4a` rechazada: fallback F074 con HOLE_OUT_OF_BOUNDS falsos (convención
     de ejes vieja), contrato resolver↔DXF inconsistente, copy LaTeX `$(0,0)$`.
  2. `4dd56ab`: heurística F074 realineada a face-planes (+tests lateral/fondo),
     proyección PERF del DXF con swap documentado (goldens byte-idénticos), copy.
  3. `7fed3e9`: colisión entre caras opuestas comparaba siempre contra el espesor;
     ahora usa la dimensión del eje normal del par (left/right→ancho, top/bottom→largo)
     — crítico para las filas sistema 32 de F129. +4 tests (24 en el resolver).
- Suite final: 2422 monorepo (domain 716), typecheck 7/7, HEAD == origin.
- Notas para backlog (no bloqueantes): defaults de espesor divergentes (resolver
  `?? 15` vs heurística `?? 18`); `resolvePartForPlacement` cae a `parts[0]` sin
  match de rol; wiring productivo resolver→export (prop `drilling`) es F130.

## F129 — Reglas de unión paramétricas sistema 32 (2026-08-21)

- El mueble estándar se perfora solo: `deriveJointHardwarePlacements` (dominio puro)
  genera placements derivados que el motor F128 resuelve. Defaults de taller:
  minifix+taquetes (extremos 50, intermedios cada 512, taquetes a ±32 exacto),
  fondo tornillos perímetro (inset 16, máx 400), bisagra cup 22.5 / placa a
  línea de sistema D−37 / extremos 100, grilla 32 con snap en intermedios.
  Cantidad de bisagras via `suggestHingeCount` (workshopRules).
- Reglas declarativas referencian herrajes por CÓDIGO (portables entre
  workspaces); overrides parciales se mergean con defaults (effectiveRules).
  `Structure.jointDrillingRules?` (JSONB aditivo 000065, paridad Go camelCase,
  drilling-only: NO bump de revisión BOM ni viaja en structureRevision).
- `BoardPart/ResolvedBoardPart.componentPlacement?` — el BOM expone el
  placement del componente (bom.ts expansión+resolución) para clasificar piezas.
- `HardwarePlacement.derivedMachining?`: maquinado de aplicación que reemplaza
  el perfil de catálogo por placement — el fondo usa piloto PASANTE Ø3 (el
  tornillo catálogo es ciego 35mm; contrafactual del reviewer: 6 errores
  DEPTH_EXCEEDS_MATERIAL sin el override). Resolver: derivedMachining ?? catálogo.
- Corrección física fina: cazuela a T_piso/2 EXACTO del extremo (floor() la
  sacaba 0.5mm del canto con el Arauco 15mm del demo); espesores siempre del
  material resuelto, nunca 18 fijo (literal unificado a DEFAULT_BOARD_THICKNESS_MM).
- Golden del gabete demo (300×720×590) contra BOM real + integración F129→F128
  pieza por pieza sin issues; round-trip mappers (+2). Suite 2439, typecheck 7/7,
  go test verde. Review APPROVED (`progress/review_F129.md`).
- Notas para F131: override «por módulo» aún solo vía parámetro del generador
  (sin campo en Module); `horizontal[0]!.thicknessMm` asume espesor uniforme
  por unión; handing/espejo de puerta sigue siendo concern del export (F130).

## F130 — Export DXF de perforaciones por cara + reporte (2026-08-21)

- Primer entregable importable en máquina: el DXF de nesting lleva las
  perforaciones REALES (placements manuales + uniones derivadas F129 + motor
  F128) del proyecto completo.
- **Dominio**: `generateCutRowsWithLinks` (cut.ts — rows + links con
  partId/labelRef/ResolvedBoardPart por línea; generateCutRows delega) y
  `resolveProjectDrilling` (projectDrilling.ts): ensambla por pieza manual
  (instancias estructura+módulo, convención `-copy-N`) + derivado (partId) y
  resuelve con F128. Patterns keyeados por labelRef (único por línea; partCode
  'P01' colisiona entre módulos); data schema `muebles.drilling-data.v1`
  intacto; fallback F074 marcado por pieza; quantity×N no duplica.
- **DXF**: capas dinámicas por cara+Ø — `PERF_F<Ø>` / `PERF_B<Ø>` (back
  ESPEJADO en eje ancho: el operador voltea la pieza y corre las coordenadas
  tal cual; verificado por el reviewer con ejecución) / `PERF_CANTO<Ø>`
  (proyectado al canto para agregados horizontales). Capa = selección de
  herramienta (SCM Maestro capa→tool); profundidad vive en el reporte.
  Join labelRef con fallback partCode; layer table dinámico; goldens
  regenerados (delta exacto: capas nuevas).
- **Wiring**: DXF del tab Ingeniería con drilling real (best-effort); reporte
  del hub con fuente real + fallback heurístico (catalog enhebrado
  Workspace→Hub→hook); pack ZIP agrega `perforaciones_<obra>.json`.
- Suite 2444, typecheck 7/7. Review APPROVED (`progress/review_F130.md`).
- Notas F131: blindar rama back/espejo con test persistido; manual placements
  de agregados (prefijo `agr-`); first-wins partId→módulo cuando dos módulos
  comparten estructura con dims distintas; colisión de nombre de capa con Ø
  no enteros (7.5→8).

## F131 — Editor visual 2D de perforaciones por cara + gizmo 3D (2026-08-21)

- `PieceFaceDrillingEditor` (preview3d, SVG): una cara por vez con las dimensiones
  del face-plane del dominio, grilla 32, agujeros REALES del motor F128 (manual +
  derivado), anclas arrastrables con snap 32 (helper puro `snappedPlacementPatch`
  con `snapValue` del dominio — drag explícito limpia fórmulas) y validaciones
  inline del motor con hole ofensivo resaltado. Sin catálogo degrada a grilla+anclas.
- Integrado en la sección Herrajes del PartInspector (prop opcional hardwareCatalog).
- **Deuda F070 saldada**: HardwarePlacementGizmo montado en el viewport — BoardMesh
  lo renderiza para la pieza seleccionada con placements, posicionado en
  localPosition del resolved, snap 32, editable vía props opcionales
  `rawHardwarePlacements`/`onUpdateHardwarePlacement` (thread
  FurnitureScene3D→SceneContent→ModuleGroup→BoardMesh); read-only sin ellos.
- Gates: radiogroup (no tablist local), tokens only. Review en 2 rondas (fixes:
  snapValue del dominio en vez de snap duplicado en UI, tokens de fuente/padding,
  plural, docs). Suite 2453, typecheck 7/7. APPROVED (`progress/review_F131.md`).
- Follow-up anotado: ningún shell cablea aún hardwareCatalog/rawHardwarePlacements
  al inspector/escena — el camino editable full se ejercita hoy vía tests; conectar
  en la próxima iteración de Proyectar/Ingeniería.

## Cierre de la serie de perforaciones CNC (F127–F131, 2026-08-20/21)

F081 re-escpeada en 5 features, todas done y revisadas:
catálogo de maquinado (F127) → motor de resolución (F128) → reglas de unión
sistema 32 (F129) → export DXF por caras + reporte (F130) → editor visual +
gizmo (F131). F132 (post-procesador SCM nativo) queda postergada hasta
confirmar máquina/software del taller — el flujo oficial hacia SCM es el DXF
por capas de F130, importable en Maestro con asignación capa→herramienta.

## Issue #299 / F134 — Operational Core O0: guardrails, roles, auth y Data Truth (2026-08-21)

Implementación (ronda 1):

- **OC-001** `init.sh` estricto: sin `|| true`, node/pnpm obligatorios cuando
  existe monorepo, agrega `pnpm typecheck` y sección Go (`go test ./...`),
  exit 1 en cualquier fallo. Harness apunta a fuentes v2 (prd-v2,
  operational-core-v1).
- **OC-002** CI remota `.github/workflows/ci.yml`: validación de ledger +
  typecheck/tests TS + go test.
- **OC-004** `UserRole`/`ProductRole` consolidados como alias del mismo set de
  8 roles canónicos (TS suma `gerente_produccion` y `almacen`; Go ya era
  canónico). `USER_ROLES` exportado en domain.
- **OC-005** `PublicUserDTO` + `ToPublicUserDTO(s)` en backend: login, refresh,
  admin users y staff serializan DTO explícito;
  `TestPublicUserDTONeverLeaksSecrets` (además `PasswordHash` tiene `json:"-"`).
- **OC-006** `packages/domain/src/dataTruth.ts`
  (`actual|estimated|forecast|proxy|missing` + labels ES): heurísticas
  etiquetadas `proxy` (piezas ~8/mód, m² ~2.8/mód, ml ~14/mód, herrajes ~4/mód;
  días en almacén `proxy|missing` vía createdAt, sin camino `actual` aún);
  agregados degradan a `proxy`/`missing` si algún proyecto usa heurística; la
  UI muestra «estimada» condicionada al origin del dominio. Tests
  `dataTruth.test.ts`.
- **OC-003** DS-10/DS-11/DS-17 resueltos en documentation-sync;
  `docs/verification.md` actualizado.

Review (ronda 2, `progress/review_issue-299.md`): CHANGES_REQUESTED inicial por
cierre defectuoso y overclaims del walkthrough. Correcciones aplicadas:

- CI: pnpm tomado de `packageManager` (el pin manual v9 chocaba con pnpm@11.1.2),
  Go 1.25.x (go.mod declara 1.25.0), **Postgres service container + DATABASE_URL**
  (sin él los tests de integración de storage se saltaban con `t.Skip` y la CI
  daba un verde falso), push sólo en main/master (las ramas quedan cubiertas
  por pull_request).
- `structures_108_test.go`: aplica migraciones sobre base fresca (CI).
- `HandleOperatorsBySector` también serializa `PublicUserDTOs`.
- Paridad de roles TS↔Go ahora es contract fixture real: `contracts/roles.json`
  compartido por ambos tests (docs/architecture.md §7).
- Cierre de sesión correcto: F134 dada de alta en el ledger.

Verificación: `./init.sh` verde completo (harness, typecheck, suite TS, go test
incluida integración de storage contra Postgres).

Post-cierre — la CI remota cazó dos falsos-verdes locales (OC-002 cumplió):

- pnpm@11.1.2 requiere Node >= 22.13: el job TS con Node 20 crasheaba
  (`node:sqlite` inexistente). CI pasó a Node 22.
- `apps/desktop/build/icon.png` estaba ignorado por `.gitignore` (`build/`):
  el test F075 pasaba local por el archivo sin trackear y fallaba en checkout
  limpio. El asset ahora se trackea (negación puntual en .gitignore).

CI verde: run 32514021227 (ledger + TS typecheck/tests + go test con Postgres
service).

Deuda anotada: `daysInWarehouse` seguirá siendo proxy hasta que exista un
evento real de depósito; media access (URLs firmadas) sigue pendiente de
docs/architecture.md §11.

## Issue #303 / F137 — Operational Core O4: instalación profesional, Field Issues, Punch y Closeout (2026-08-21)

La instalación pasó de un botón `loaded → installed` a un subproceso real por obra:
`InstallationJob` con múltiples `InstallationVisit` (fecha, crew, arrival/start/end,
notas, fotos, unidades trabajadas, resultado), `FieldIssue` con estados
open/action_required/blocked/resolved/verified (reapertura por verificación fallida)
y vínculo a mueble/pieza, `PunchItem` con owner/due/severidad/flag bloqueante y
cierre con evidencia obligatoria, y closeout/conformidad auditado tras gates
server-authoritative (OC-070..OC-074).

Decisiones clave:

- OC-074 con triple defensa: el PUT agregado del proyecto no puede escribir
  `installation` (columna sólo escrita por los endpoints dedicados, dentro de
  `MutateProjectInstallation` con SELECT FOR UPDATE); `POST /events` y el dual-write
  del agregado rechazan `client_signed_off`/`project_closed` cuando fallan gates;
  el endpoint de closeout evalúa gates contra estado lockeado. `installed` en todo
  NO cierra el proyecto solo.
- Status del job derivado del trabajo real (visitas + evento
  `installation_completed`), nunca almacenado. `complete_installation` es hito de
  planta auditable (alimenta KPI installationHours) con RBAC propio (produccion
  puede); sign-off/cierre son de gerentes.
- Punch balance (abierto/cerrado) en `deriveProjectStage`: múltiples punch items
  coexisten sin hacks; `punch_opened/closed` se auditan por ítem.
- Paridad TS↔Go vía `contracts/installationStatuses.json` + tests espejo de
  gates/transiciones/summary en ambos lados.
- Web: `InstallationJobPanel` dentro de `InstalacionesScreen` (board `.ship-board`
  existente): visitas, incidencias con transiciones legales, punch con evidencia y
  panel de cierre con gates que explican cómo resolverse; preserva el avance físico
  por unidad de F136. Store con espejo server (`setInstallationJob`) y camino local
  puro (`applyInstallationProject`).

Review (progress/review_F137.md): CHANGES_REQUESTED con 3 defects menores de
copy/formato (botones «volver», fechas ISO crudas, un accidente de formato en
AppContent) + 2 recomendaciones (badge del job por status, toast local con
sujeto). Todos aplicados; suites re-verificadas en verde. El revisor validó
además arquitectura, paridad, RBAC, la triple defensa OC-074 y la migración
000070 (aditiva, reversible).

Verificación final: domain 836 · storage 143 · excel 89 · ui 1169 · mobile 45 ·
desktop 17 · web 301 · `pnpm typecheck` OK · `go test ./...` OK.

## Issue #302 / F138 — Operational Core O3: MRP ligero, reservas, compras, QC y retrabajo (2026-08-21)

**Feature:** F138 — `operational_core_o3` — done · **Rama:** `feat/f138-mrp-qc`

Conecta BOM liberado → materiales → producción y registra calidad/retrabajo
(OC-050..OC-054 + OC-060..OC-062).

Qué se implementó:

- **MRP ligero (OC-050..054):** `MaterialRequirement` materializado sólo desde
  el `ProductionRelease` (bomFingerprint; sin heurísticas); stock conceptual
  `onHand/reserved/available/incoming/required/shortage` como funciones puras
  (warehouse + cobertura por obra); reservas por obra
  `active/released/consumed` con caps contra disponibilidad de TODAS las obras;
  shortage → PO draft con allocation a obra; PO extendida con `unitCost`
  snapshot por línea, `requiredBy`/`expectedAt`, `poLineCost`/`poTotalCost`;
  `materialsRelease` con evidencia (3 gates: requerimientos derivados, líneas
  cubiertas, reservas respaldadas por stock) y override auditado que emite
  `materials_release_overridden` + `materials_ready` live (antes sólo backfill).
- **QC y retrabajo (OC-060..062):** `QualityIssue` (7 categorías,
  open→resolved→verified con reopen, vínculo pieza/mueble/unidad);
  `ReworkAction` rework/refabricate/scrap/accept_as_is con
  `materialCost`/`laborMinutes` (job costing) y efecto físico en la pieza
  (reabrir ruta / scrapped) en la misma tx; checklist QC por unidad (6 puntos
  de production-flow-v2 §10) y gate server-side que bloquea
  `module_qc → packaged` sin QC aprobado ni issues abiertos, con override de
  supervisor auditado (espejo local en el store para offline).
- **Persistencia/paridad:** migraciones 000071 (projects.material_planning
  JSONB), 000072 (projects.quality JSONB), 000073 (columnas PO);
  contracts/materialPlanning.json + qualityStatuses.json con parity TS↔Go
  (tests espejo de vocabularios/transiciones/gates); endpoints
  server-authoritative (GET/derive/reserve/release + issue/transition/rework/
  qc/override) con SELECT FOR UPDATE, stock+plannings+POs en la tx, RBAC por
  evento y auditoría en la misma tx. FIX de paridad incluido: rbac.go no tenía
  quality_issue_reported/rework_started.
- **Anti-smuggling OC-054:** el PUT agregado del proyecto dejó de escribir
  `materials_release` (la liberación sólo corre por el endpoint con
  evidencia/eventos); planning/quality ni siquiera viajan en el PUT.
- **UI:** `MaterialPlanningPanel` (cobertura/reservas/shortage/gates con
  override, labels de catálogo) dentro de las cards de Almacén (botón
  «Planificar y liberar» abre el panel en vez de liberar a ciegas);
  `QualityPanel` (issues + rework con costing + checklist QC + override
  supervisor) en la estación Embalaje de Producción; wiring AppContent con
  mirror server en modo API y acciones puras offline; `roleCanSuperviseFloor`
  TS nuevo (paridad Go).

Review (progress/review_F138.md): CHANGES_REQUESTED con 3 defects menores —
labels crudos de material en la cobertura (§7.2), planning local aplicado en
vez del devuelto por el server en modo API, ids crudos en QualityPanel — todos
aplicados (el campo de pieza pasó a select con `partCode · U<idx>`) y suites
re-verificadas en verde. Recomendaciones R1 (marcar `≈` en tableros, la
estimación ya está rotulada en la sección) y R2 (consumo de reservas al
despachar picking: `consumePlannedMaterials` existe en dominio, falta cablear
en purchasingStore.togglePick) quedan como deuda explícita.

Verificación final: domain 875 (+39) · storage 147 (+4) · ui 1186 (+13) ·
web 301 · mobile 45 · desktop 17 · excel 89 · `pnpm typecheck` OK ·
`go test ./...` OK.

### F138 — deuda de review saldada (2026-08-21, mismo PR #321)

- **R2 (consumo de reservas al picking):** endpoint
  `POST /api/projects/{id}/materials/consume` con `ConsumePlannedMaterials`
  (Go, espejo de la acción pura TS), repo `consumeMaterials`, hook
  `onDespachado` en `purchasingStore.togglePick` y consumo en
  `AppContent.handleTogglePick` (planning del server en modo API; acción pura
  en offline). Semántica corregida en TS y Go: reservas `consumed` cubren la
  línea en cobertura/gates OC-054 sin contar como reservadas en la
  disponibilidad del depósito; desmarcar revierte stock, nunca el consumo.
- **R1 (data truth):** la tabla de cobertura marca `≈` las líneas de tableros
  con title "Planchas estimadas del BOM liberado".

Verificación: domain 877 · storage 147 · ui 1187 · web 301 · mobile 45 ·
desktop 17 · excel 89 · `pnpm typecheck` OK · `go test ./...` OK.
