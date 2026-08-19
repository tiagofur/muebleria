# Review — feature F010

**Veredicto:** APPROVED  
**Feature:** F010 — ui_export  
**Reviewer:** reviewer agent  
**Date:** 2026-07-15  
**Handoff:** `progress/impl_F010.md`

## Acceptance criteria → evidence

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| 1 | Export web (browser download) EXP-07 | PASS | `buildOptimizerExport` validates → `generateCutRows` → `optimizerExport` (`apps/web/src/exportOptimizer.ts` L42–77). `downloadOptimizerXlsx` creates Blob + `<a download>` with injectable deps (L105–126). Wired in `App.handleExportOptimizer` (`App.tsx` L720–737) → `ProjectsScreen` `onExport`. Tests: `exportOptimizer.test.ts` L25–127; `App.test.ts` L400–443. |
| 2 | Export desktop (Electron dialog) EXP-06 | PASS | Contract `ElectronAPI.showSaveDialog` + `writeExcelFile` (`apps/desktop/src/electronApi.ts` L14–18) matches `docs/technical_design.md` §4. `exportOptimizerDesktop` dialog → write / cancel (`exportAdapter.ts` L27–38). Main handlers: `createExcelIpcHandlers` (`ipcHandlers.ts` L24–46). Preload bridge: `registerElectronApi` (`preload.ts` L20–33). Tests: `exportAdapter.test.ts` (5 cases — save path, cancel, filters `.xlsx`, buffer write, `getElectronAPI`). No full BrowserWindow packaging (intentional; handoff). |
| 3 | Lista accionable si validación falla (módulo, pieza, campo) | PASS | Domain `ExportIssue` + `collectExportIssues` (`packages/domain/src/exportIssues.ts`). UI `ExportIssueList` renders message + meta `módulo · pieza · campo · opción` (`ExportIssueList.tsx` L23–55). `ProjectsScreen` shows list when `exportErrors.length > 0` (L623–625). Shell sets errors on `!result.ok` (`App.tsx` L729–731). Tests: missing options assert `field === 'optionChoices'`, `moduleCode`, `optionGroupCode` (`exportIssues.test.ts` L51–68; `App.test.ts` L445–474). |
| 4 | Export bloqueado si faltan opciones / VAL-01..07; sin herrajes EXP-05 | PASS | Missing required options → issues, no bytes (`exportOptimizer.ts` L46–48; tests web + domain). VAL-05 empty items / no board parts (`exportIssues.test.ts` L70–103). VAL-01 dims (`L105–148`). VAL-06 inactive material (`L150–160`). VAL-02/03/06 also via `validateBoardPart` / `validateHardwareLine` / `resolveBom` when structure clean. EXP-05: `generateCutRows` board-only (`engine.ts` L739–741); fixture 8 rows no hardware (`optimizerExport.test.ts` L95–100; `engine.test.ts` EXP-05). Pipeline never feeds hardware to excel. |

### PRD detail map

| ID | Result | Notes |
|----|--------|-------|
| VAL-01 | PASS | `validateBoardPart` → `field: lengthMm/widthMm` + `partId` |
| VAL-02 | PASS | Material resolution via `resolveBom` when options present |
| VAL-03 | PASS | `validateHardwareLine` on each line (integrity before export) |
| VAL-04 | PASS | Edges remain typed model (prior domain); not re-validated as freeform |
| VAL-05 | PASS | Message `no hay piezas de tablero para exportar`, `field: boardParts` |
| VAL-06 | PASS | Inactive material blocked via `resolveBom` → issue `field: active` |
| VAL-07 | PASS | Empty description / optionRole / codes surface as issues or prior catalog rules |
| EXP-05 | PASS | Cut list + excel fixtures exclude hardware |
| EXP-06 | PASS | Dialog path unit-tested with injectable deps |
| EXP-07 | PASS | Blob download unit-tested + App wiring |

## Architecture boundaries (C3)

| Check | Result |
|-------|--------|
| domain pure (no react/electron/fs/xlsx) | PASS — `exportIssues.ts` only domain + `engine` / `errors` |
| UI no fórmulas / no fs / no xlsx | PASS — `ExportIssueList` presentation only; button invokes shell `onExport` |
| excel only serializes cut rows | PASS — unchanged production path; shell calls `optimizerExport(rows)` |
| Apps = thin shells | PASS — web: validate/cut/xlsx/download; desktop: dialog+write adapters |
| UI no import electron | PASS — desktop API stays in `apps/desktop` |
| Errores DomainError / ExportIssue | PASS — `domainErrorToExportIssue`; catch maps `DomainError` |
| Sin `console.log` debug | PASS — none in F010 production sources |

## Conventions

- camelCase modules (`exportIssues.ts`, `exportOptimizer.ts`, `exportAdapter.ts`) + colocated `*.test.ts` — PASS  
- `ExportIssue` / `ElectronAPI` PascalCase; immutable `readonly` fields — PASS  
- Header purpose comments; ESM; single quotes — PASS  
- Spanish UI copy (`Exportar Optimizer`, lista de errores); English identifiers — PASS  
- Injectable deps for browser DOM / Electron dialog (testable without real Electron) — PASS  
- Package exports: domain `collectExportIssues`; ui `ExportIssueList`; desktop `exportOptimizerDesktop` — PASS  

## Verification (docs/verification.md)

| Level | Result |
|-------|--------|
| Nivel 1 domain | PASS — 38/38 (includes 9 `exportIssues` tests) |
| Nivel 2 excel | PASS — 7/7 (fixture + EXP-05) |
| Nivel 2 ui | PASS — 55/55 (surface export of `ExportIssueList`) |
| Nivel 2 web | PASS — 23/23 (`exportOptimizer` 6 + App 17) |
| Nivel 2 desktop | PASS — 7/7 (`exportAdapter` 5 + scaffold 2) |
| Nivel 3 monorepo | PASS — `./init.sh` exit 0, all workspaces green |
| Nivel 5 smoke export | PASS — `node packages/excel/src/__fixtures__/smokeExport.mjs` → `/tmp/optimizer_smoke.xlsx` (8 data rows) |
| Typecheck | PASS — domain, ui, excel, web, desktop `tsc --noEmit` |

## Commands executed (reviewer)

```text
./init.sh                              # exit 0 — [OK] Entorno listo; domain 38, ui 55, excel 7, storage 9, web 23, desktop 7
pnpm --filter @muebles/domain test     # 38/38
pnpm --filter @muebles/web test        # 23/23
pnpm --filter @muebles/desktop test    # 7/7
pnpm --filter @muebles/{domain,ui,excel,web,desktop} typecheck  # ok
node packages/excel/src/__fixtures__/smokeExport.mjs  # Wrote /tmp/optimizer_smoke.xlsx (8 data rows)
```

## Checkpoints

### C1 — El harness está completo
- [x] Archivos base: `AGENTS.md`, `init.sh`, `feature_list.json`, `progress/current.md`, `CHECKPOINTS.md`
- [x] Docs: `docs/prd.md`, `docs/architecture.md`, `docs/conventions.md`, `docs/verification.md`
- [x] Skills: leader / implementer / reviewer under `.agents/skills/`
- [x] `./init.sh` exit 0

### C2 — El estado es coherente
- [x] Como mucho una feature `in_progress` (solo F010)
- [x] Features `done` previas con monorepo tests green
- [x] `progress/current.md` describe sesión F010 activa (implemented, awaiting review)

### C3 — El código respeta la arquitectura
- [x] `packages/domain` no importa react, electron, fs, ni xlsx
- [x] `packages/ui` no implementa fórmulas de costo ni accede a fs / xlsx
- [x] `packages/excel` no importa react ni electron
- [x] Errores de dominio: `DomainError` / `ExportIssue` accionable; UI no expone stacks
- [x] Sin `console.log` de debug en sources de producción F010

### C4 — La verificación es real
- [x] `pnpm --filter @muebles/domain test` 100%
- [x] Export fixture / EXP-05 still green (excel + engine)
- [x] Storage tempdir — N/A scope F010; monorepo still green
- [x] Golden motor monorepo still green; F010 adds export-issue + shell delivery tests
- [x] Nivel 5 smoke export OK

### C5 — Cierre de sesión (post-approve, owner: leader)
- [x] Sin artefactos sospechosos en sources revisados (domain/ui/web/desktop export paths)
- [ ] `progress/history.md` entrada de **esta** sesión — pendiente al cerrar (leader)
- [ ] Feature en estado final correcto en `feature_list.json` — sigue `in_progress` (correcto pre-approve; leader marca `done`)
- [ ] `progress/current.md` limpio — pendiente al archivar sesión (leader)

> C5 open boxes are **session-close duties for the leader after approval**, not F010 defects. Reviewer does not mark `done` or close the session.

## Residual notes (non-blocking)

1. **Desktop sin BrowserWindow / e2e Electron** — path de diálogo+write unit-testeado con deps inyectables; empaquetado completo fuera de scope (documentado en handoff). Aceptable para este slice.
2. **Web App no bifurca a `exportOptimizerDesktop`** — solo `downloadOptimizerXlsx`. Correcto mientras no exista host Electron que monte el shell; cuando se empaquete desktop, el shell debe elegir dialog vs download vía `getElectronAPI`.
3. **Sin DOM / RTL** sobre `ExportIssueList` / click real del botón — mismo patrón F006–F009; contratos puros + wiring shell testeados.
4. **Mensajes de dominio mixtos EN/ES** — algunos heredados del engine (`Project item quantity must be > 0`); VAL-05 y opciones en español. No bloquea; unificar idioma de UX es polish futuro.
5. **Hardware se valida aunque no se exporte** — `validateHardwareLine` en `collectExportIssues` fuerza integridad del proyecto antes de export. Razonable; no viola EXP-05 (xlsx sin herrajes).

## Cambios requeridos

Ninguno.

## Leader next steps (not reviewer)

1. Marcar F010 `done` en `feature_list.json`.
2. Archivar sesión en `progress/history.md` y limpiar/actualizar `progress/current.md`.
3. Tomar F011 (`seed_data`) como siguiente feature pending.
