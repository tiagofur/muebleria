# Review — feature F008

**Veredicto:** APPROVED  
**Feature:** F008 — ui_module_editor  
**Reviewer:** reviewer agent  
**Date:** 2026-07-15  
**Handoff:** `progress/impl_F008.md`

## Acceptance criteria → evidence

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| 1 | CRUD de módulos (MOD-01 a MOD-04) | PASS | `ModulesScreen` controlled: code, name, notes, external dims, baseLaborCost; board parts (qty, L, A, grain, L1/L2/W1/W2, optionRole); hardware lines (qty, role or fixed hardwareId, descriptionOverride). Shell `createModule` / `updateModule` / `deleteModule` via `draftToModule` (`apps/web/src/App.tsx` L60–105, L522–538). Unique code via `validateModuleCode`. |
| 2 | Picker optionRole solo grupos disponibles | PASS | `optionGroupsForBoardParts` → kind board\|edge; `optionGroupsForHardware` → kind hardware (`moduleHelpers.ts` L173–185). Selects in editor only list those groups (`ModulesScreen.tsx` L521–537, L637–655). Tests: `moduleHelpers.test.ts` L91–103; `App.test.ts` L164–175. |
| 3 | Preview de costo con motor de dominio (MOD-06) | PASS | Shell `computeModuleCostPreview` uses `requiredGroupCodesForModule` + `defaultOptionChoicesForModule` + `canShowPricePreview` + `calcProjectBreakdown` (`App.tsx` L111–164, L348–365). UI only displays `QuoteBreakdown` props (`ModulesScreen.tsx` L700–751). No m² / margin / sale formulas in `packages/ui`. Test: `App.test.ts` L183–214. |
| 4 | MOD-GAB-01 y MOD-CAJ-01 seed con roles (MOD-07) | PASS | Seed in `plantillaDemo.ts` (`modGab01` / `modCaj01`); loaded via `createSeedWorkspace`. GAB: INTERIOR/FRENTE + BISAGRA + FIXED hw; CAJ: INTERIOR/FRENTE/FONDO + CORREDERA. Asserted by `SEED_MODULE_CODES` + `App.test.ts` L143–162. |

### PRD MOD-01..07 detail

| ID | Result | Notes |
|----|--------|-------|
| MOD-01 | PASS | CRUD + code/name/notes/external dims + baseLaborCost |
| MOD-02 | PASS | Board parts with qty, L, A, grain, 4 edge flags, optionRole |
| MOD-03 | PASS | MVP edge flags L1/L2/W1/W2 (EDGE group v1.1 not required) |
| MOD-04 | PASS | Hardware by optionRole or fixed hardwareId (`mode` role\|fixed) |
| MOD-05 | N/A | Out of scope for F008 (F015) |
| MOD-06 | PASS | Defaults + domain engine; blocked if missing groups / resolve fails |
| MOD-07 | PASS | MOD-GAB-01 / MOD-CAJ-01 in seed with correct roles |

## Architecture boundaries (C3)

| Check | Result |
|-------|--------|
| UI no fórmulas de costo / m² / ML / margen | PASS — UI only formats `costPreview.*` with `toFixed(2)`; no `calcProjectBreakdown` / engine in `packages/ui/src/modules/*` |
| UI imports from domain | PASS — type-only (`Module`, `OptionGroup`, `QuoteBreakdown`, etc.); helpers import types only |
| UI no accede a `fs` / electron / xlsx | PASS |
| Apps = shell + domain engine for price | PASS — `calcProjectBreakdown` only in `apps/web` (`App.tsx` L18, L155); mapping `draftToModule` is wiring |
| Controlled parent state | PASS — parent owns `modules`; screen is presentation |
| Domain purity untouched | PASS — F008 did not change domain engine formulas |
| Sin `console.log` debug | PASS — none in modules UI or App production sources |

## Conventions

- Module headers + camelCase helpers (`moduleHelpers.ts`); PascalCase screen (`ModulesScreen.tsx`) — PASS  
- Immutable updates in shell: spread / map / filter (`App.tsx`) — PASS  
- Spanish UI labels/messages; English identifiers — PASS  
- Colocated helper tests (12) + package surface export smoke (F008 block in `index.test.ts`) — PASS  
- Matches F006/F007 catalog UI patterns (controlled screen + shell wiring) — PASS  

## Verification (docs/verification.md)

| Level | Result |
|-------|--------|
| Nivel 1 domain | PASS — 29/29 (via `./init.sh`) |
| Nivel 2 ui | PASS — 40/40 including 12 `moduleHelpers` + export surface |
| Nivel 2 web | PASS — 11/11 (F006/F007 contracts + F008 MOD-06/07 + pickers) |
| Nivel 3 monorepo | PASS — `./init.sh` exit 0, all workspaces green |
| Typecheck / build | PASS — `@muebles/ui` + `@muebles/web` typecheck; Vite web production build OK |
| Golden / excel / storage | N/A for F008 UI logic; monorepo still green (domain/excel/storage untouched in scope) |

## Commands executed (reviewer)

```text
./init.sh                              # exit 0 — [OK] Entorno listo; 15 features, 1 in_progress (F008)
pnpm --filter @muebles/ui typecheck    # ok
pnpm --filter @muebles/web typecheck   # ok
pnpm --filter @muebles/ui test         # 40 passed
pnpm --filter @muebles/web test        # 11 passed
pnpm --filter @muebles/web build       # ok (Vite production)
# included in init.sh: full monorepo pnpm test → green
```

## Checkpoints

### C1 — El harness está completo
- [x] Archivos base: `AGENTS.md`, `init.sh`, `feature_list.json`, `progress/current.md`, `CHECKPOINTS.md`
- [x] Docs: `docs/prd.md`, `docs/architecture.md`, `docs/conventions.md`, `docs/verification.md`
- [x] Skills: leader / implementer / reviewer under `.agents/skills/`
- [x] `./init.sh` exit 0

### C2 — El estado es coherente
- [x] Como mucho una feature `in_progress` (solo F008)
- [x] Features `done` previas con monorepo tests green
- [x] `progress/current.md` describe sesión F008 activa (implemented, awaiting review)

### C3 — El código respeta la arquitectura
- [x] `packages/domain` no importa react, electron, fs, ni xlsx (no violado por F008)
- [x] `packages/ui` no implementa fórmulas de costo ni accede a fs
- [x] `packages/excel` no importa react ni electron (no tocado en F008)
- [x] Errores de dominio: shell try/catch en preview sin stack al usuario; form validation strings en UI
- [x] Sin `console.log` de debug en sources UI/web de producción

### C4 — La verificación es real
- [x] `pnpm --filter @muebles/domain test` 100%
- [x] UI helpers optionRole pickers + seed MOD-07 + MOD-06 domain preview asserts en web tests
- [x] Export fixture / golden motor — N/A scope F008; monorepo still green
- [x] Storage tempdir — N/A scope F008; monorepo still green

### C5 — Cierre de sesión (post-approve, owner: leader)
- [x] Sin artefactos sospechosos en sources revisados (`packages/ui/src/modules/*`, `apps/web/src/*`)
- [ ] `progress/history.md` entrada de **esta** sesión — pendiente al cerrar (leader)
- [ ] Feature en estado final correcto en `feature_list.json` — sigue `in_progress` (correcto pre-approve; leader marca `done`)
- [ ] `progress/current.md` limpio — pendiente al archivar sesión (leader)

> C5 open boxes are **session-close duties for the leader after approval**, not F008 defects. Reviewer does not mark `done` or close the session.

## Residual notes (non-blocking)

1. **No DOM / React Testing Library coverage** — `ModulesScreen` and `App` are not rendered in tests (same pattern as F006/F007). Critical pure rules are unit-tested; full CRUD interaction is code-reviewed only. Acceptable per `docs/verification.md` (“si hay tests de componente”).
2. **`App.test.ts` does not import `App`** — verifies seed + helper contracts the shell relies on, not React mount. Wiring in `App.tsx` is consistent with those contracts.
3. **Cost preview uses saved module** (`editingModuleId` → catalog module), not the live unsaved draft. User must Guardar to refresh preview. Acceptable for MOD-06 MVP.
4. **MOD-05 duplicate** intentionally out of scope (handoff + feature_list → F015).
5. **Partial external dims** in `draftToModule`: if only one dim is filled, missing axes default to `0`. Edge case; form validates non-negative when present.
6. **Inline styles** on a few form fields / empty states — polish only; does not affect acceptance.

## Cambios requeridos

Ninguno.

## Leader next steps (not reviewer)

1. Marcar F008 `done` en `feature_list.json`.
2. Archivar sesión en `progress/history.md` y limpiar/actualizar `progress/current.md`.
3. Tomar F009 (`ui_quotation`) como siguiente feature pending.
