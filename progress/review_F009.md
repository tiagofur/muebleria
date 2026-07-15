# Review — feature F009

**Veredicto:** APPROVED  
**Feature:** F009 — ui_quotation  
**Reviewer:** reviewer agent  
**Date:** 2026-07-15  
**Handoff:** `progress/impl_F009.md`

## Acceptance criteria → evidence

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| 1 | CRUD de proyectos (PRJ-01 a PRJ-03) | PASS | `ProjectsScreen` list: create / open / delete; edit meta (name, client, currency, marginFactor, laborFixedCost, status, notes; dates read-only). Shell `createProject` / `updateProject` / `deleteProject` + item `addProjectItem` / `updateProjectItem` / `removeProjectItem` (`apps/web/src/App.tsx` L629–711). Add item: catalog module × qty ≥ 1 (`validateItemQuantity`). Per-item option pickers for required groups. Tab «Proyectos» wired. |
| 2 | Picker de opciones solo del grupo (OPT-04, PRJ-03) | PASS | `groupsForModuleItem` → required roles only; `optionsForGroup` → kind members ∩ `group.optionIds` (empty optionIds → `[]`, no full catalog dump) (`projectHelpers.ts` L130–163). UI selects built from those helpers (`ProjectsScreen.tsx` L533–564). Tests: `projectHelpers.test.ts` L238–269; `App.test.ts` L235–251. |
| 3 | Totales en vivo al cambiar opciones (PRJ-06, UX-03) | PASS | Shell `computeSelectedProjectBreakdown` → `canShowProjectPricePreview` + `calcProjectBreakdown` only in shell (`App.tsx` L354–395, L451–454). Option change → immediate `onUpdateItem` (`ProjectsScreen.tsx` L207–219). Totals section `aria-live="polite"` shows materials/edge/hardware/direct/labor modular/fija/margin/salePrice from `QuoteBreakdown` props (L575–647). Gate blocks when choices incomplete. Test: `App.test.ts` L342–391. |
| 4 | Dos ítems mismo mueble, distintas opciones (PRJ-10) | PASS | `onAddItem` appends without uniqueness on `moduleId` (`App.tsx` L659–680). Hint in UI (`ProjectsScreen.tsx` L472–475). Tests: `projectHelpers.test.ts` L284–303; `App.test.ts` L253–340 (two MOD-GAB-01 lines, different INTERIOR → different materialsCost). |
| 5 | Cambio de opción no toca módulo maestro (PRJ-09) | PASS | Only `ProjectItem.optionChoices` updated via spread; Module never mutated (`ProjectsScreen.tsx` L207–219; shell map item by id). Asserted in `App.test.ts` L290–295, L339 and `defaultChoicesForNewItem` clone check (`projectHelpers.test.ts` L273–282). |

### PRD detail map

| ID | Result | Notes |
|----|--------|-------|
| PRJ-01 | PASS | CRUD: nombre, cliente, fechas (created/updated display), notas, status |
| PRJ-02 | PASS | Items from catalog modules × qty ≥ 1; no invent-module-in-quote |
| PRJ-03 | PASS | Per-item required groups only; picker values from group membership |
| PRJ-06 | PASS | Domain `calcProjectBreakdown` in shell; UI displays DTO fields |
| PRJ-09 | PASS | Option change → item only; module master immutable |
| PRJ-10 | PASS | Duplicate moduleId lines allowed with independent choices |
| OPT-04 | PASS | `optionsForGroup` filters by optionIds |
| UX-03 | PASS | Live totals panel always visible in edit mode (blocked or values) |

## Architecture boundaries (C3)

| Check | Result |
|-------|--------|
| UI no fórmulas de costo / m² / ML / margen / venta | PASS — `formatMoney` is `toFixed(2)` only; no `calcProjectBreakdown` / `resolveBom` / engine in `packages/ui/src/projects/*` |
| UI imports from domain | PASS — type-only (`Project`, `ProjectItem`, `QuoteBreakdown`, etc.) |
| UI no accede a `fs` / electron / xlsx | PASS |
| Apps = thin shell + domain engine for price | PASS — `calcProjectBreakdown` only in `apps/web` (`App.tsx` L19, L386); helpers are gates/validation/pickers |
| Controlled parent state | PASS — parent owns `workspace.projects[]`; screen is presentation + local draft UI state |
| Domain purity untouched | PASS — F009 did not change domain engine formulas |
| Sin `console.log` debug | PASS — none in projects UI or App production sources |

## Conventions

- Module headers + camelCase helpers (`projectHelpers.ts`); PascalCase screen (`ProjectsScreen.tsx`) — PASS  
- Immutable updates in shell: spread / map / filter (`App.tsx` project/item CRUD) — PASS  
- Spanish UI labels/messages; English identifiers — PASS  
- Colocated helper tests (13) + package surface export smoke (F009 block in `index.test.ts`) — PASS  
- Matches F006–F008 catalog UI patterns (controlled screen + shell wiring) — PASS  

## Verification (docs/verification.md)

| Level | Result |
|-------|--------|
| Nivel 1 domain | PASS — 29/29 (via `./init.sh`) |
| Nivel 2 ui | PASS — 54/54 including 13 `projectHelpers` + export surface |
| Nivel 2 web | PASS — 15/15 (prior contracts + F009 PRJ/OPT/UX wiring) |
| Nivel 3 monorepo | PASS — `./init.sh` exit 0, all workspaces green |
| Typecheck | PASS — `@muebles/ui` + `@muebles/web` `tsc --noEmit` |
| Golden / excel / storage | N/A for F009 UI scope; monorepo still green |

## Commands executed (reviewer)

```text
./init.sh                              # exit 0 — [OK] Entorno listo; 15 features, 1 in_progress (F009)
pnpm --filter @muebles/ui typecheck    # ok
pnpm --filter @muebles/web typecheck   # ok
# included in init.sh: full monorepo pnpm test → green
#   domain 29, storage 9, excel 7, ui 54, web 15, desktop 2
```

## Checkpoints

### C1 — El harness está completo
- [x] Archivos base: `AGENTS.md`, `init.sh`, `feature_list.json`, `progress/current.md`, `CHECKPOINTS.md`
- [x] Docs: `docs/prd.md`, `docs/architecture.md`, `docs/conventions.md`, `docs/verification.md`
- [x] Skills: leader / implementer / reviewer under `.agents/skills/`
- [x] `./init.sh` exit 0

### C2 — El estado es coherente
- [x] Como mucho una feature `in_progress` (solo F009)
- [x] Features `done` previas con monorepo tests green
- [x] `progress/current.md` describe sesión F009 activa (implemented, awaiting review)

### C3 — El código respeta la arquitectura
- [x] `packages/domain` no importa react, electron, fs, ni xlsx (no violado por F009)
- [x] `packages/ui` no implementa fórmulas de costo ni accede a fs
- [x] `packages/excel` no importa react ni electron (no tocado en F009)
- [x] Errores de dominio: shell try/catch en breakdown sin stack al usuario; form validation strings en UI
- [x] Sin `console.log` de debug en sources UI/web de producción

### C4 — La verificación es real
- [x] `pnpm --filter @muebles/domain test` 100%
- [x] UI helpers OPT-04/PRJ-03 pickers + PRJ-09/10 + project price gate asserts; web tests exercise domain engine for live totals
- [x] Export fixture / golden motor — N/A scope F009; monorepo still green
- [x] Storage tempdir — N/A scope F009; monorepo still green

### C5 — Cierre de sesión (post-approve, owner: leader)
- [x] Sin artefactos sospechosos en sources revisados (`packages/ui/src/projects/*`, `apps/web/src/*`)
- [ ] `progress/history.md` entrada de **esta** sesión — pendiente al cerrar (leader)
- [ ] Feature en estado final correcto en `feature_list.json` — sigue `in_progress` (correcto pre-approve; leader marca `done`)
- [ ] `progress/current.md` limpio — pendiente al archivar sesión (leader)

> C5 open boxes are **session-close duties for the leader after approval**, not F009 defects. Reviewer does not mark `done` or close the session.

## Residual notes (non-blocking)

1. **No DOM / React Testing Library coverage** — `ProjectsScreen` and `App` are not rendered in tests (same pattern as F006–F008). Critical pure rules + shell contracts are unit-tested; full CRUD interaction is code-reviewed only. Acceptable per `docs/verification.md` (“si hay tests de componente”).
2. **`App.test.ts` does not import `App`** — verifies seed + helper + domain contracts the shell relies on, not React mount. Wiring in `App.tsx` is consistent with those contracts.
3. **Meta fields (margin / labor fija) require «Guardar datos»** before totals refresh; option/qty changes update items immediately. Matches “live on option change” acceptance; same save-then-preview pattern as F008 module cost.
4. **After create, UI returns to list** — user must «Abrir cotización» to edit items. Acceptable for PRJ-01 MVP.
5. **`PricePreviewGate` reuse** encodes shell-side gate via `requiredGroupCodes={previewBlocked ? missingGroups : []}` + empty `optionChoices`. Works; slightly indirect vs a pure presentation blocked prop.
6. **Export Optimizer button** disabled placeholder (F010) — intentional out of scope.
7. **No disk persistence from web shell** — still in-memory seed; storage package not required for F009.
8. **Inline styles** on a few meta/hint blocks — polish only.

## Cambios requeridos

Ninguno.

## Leader next steps (not reviewer)

1. Marcar F009 `done` en `feature_list.json`.
2. Archivar sesión en `progress/history.md` y limpiar/actualizar `progress/current.md`.
3. Tomar F010 (`ui_export`) como siguiente feature pending.
