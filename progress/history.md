# Bitácora histórica (append-only)

> Cada vez que se cierra una sesión, su resumen se añade aquí.
> No edites entradas anteriores. Solo añades al final.

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
