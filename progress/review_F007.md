# Review — feature F007

**Veredicto:** APPROVED  
**Feature:** F007 — ui_option_groups  
**Reviewer:** reviewer agent  
**Date:** 2026-07-15  
**Handoff:** `progress/impl_F007.md`

## Acceptance criteria → evidence

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| 1 | CRUD de grupos (OPT-01) | PASS | `OptionGroupsScreen` controlled: fields code, name, kind, required, optionIds; `onCreate` / `onUpdate` / `onDelete`. Shell maps drafts → `OptionGroup` (`apps/web/src/App.tsx` L344–377). Unique code via `validateOptionGroupCode` + required name. |
| 2 | Picker de miembros filtrado por kind (OPT-02) | PASS | `membersForKind` maps board→materials, hardware→hardware, edge→edges; active-only by default (`optionGroupHelpers.ts` L39–60). Multi-select checkboxes only show candidates of draft.kind (`OptionGroupsScreen.tsx` L73–77, L258–285). Changing kind re-filters `optionIds` (`setKind` L99–106). Tests: `optionGroupHelpers.test.ts` OPT-02 block; `App.test.ts` L70–86. |
| 3 | Grupos semilla presentes (OPT-03) | PASS | Seed plantilla has INTERIOR, FRENTE, BISAGRA, CORREDERA (+ FONDO extra) with members (`packages/domain/src/__fixtures__/plantillaDemo.ts` L186–226). Loaded via `createSeedWorkspace`. Asserted by `SEED_OPTION_GROUP_CODES` + `App.test.ts` L58–68. Names editable via CRUD. |
| 4 | Grupo requerido sin elección bloquea preview de precio (OPT-05) | PASS | Pure gate `canShowPricePreview` — no cost math (`optionGroupHelpers.ts` L103–115). `PricePreviewGate` shows blocked message + missing labels (`PricePreviewGate.tsx`). Demo shell: empty choices → blocked; complete INTERIOR/FRENTE/BISAGRA → `calcProjectBreakdown` sale price **only in app shell** (`App.tsx` L88–115, L193–207). Tests: helpers L141–164; `App.test.ts` L87–134. |

### PRD OPT-01..05 detail

| ID | Result | Notes |
|----|--------|-------|
| OPT-01 | PASS | CRUD + code/name/kind/required/optionIds |
| OPT-02 | PASS | Members filtered by kind; only active catalog items by default |
| OPT-03 | PASS | INTERIOR / FRENTE / BISAGRA / CORREDERA in seed (FONDO also present; not required by PRD seed list) |
| OPT-04 | N/A | Out of scope for F007 (quotation picker → later projects UI / F009) |
| OPT-05 | PASS | Required roles without choice block preview; domain price only after gate ok |

## Architecture boundaries (C3)

| Check | Result |
|-------|--------|
| UI no fórmulas de costo / m² / ML / margen | PASS — helpers only member filter + code uniqueness + completeness gate; no `calcProjectBreakdown` / engine in `packages/ui/src/optionGroups/*` |
| UI no accede a `fs` / electron / xlsx | PASS — deps: `@muebles/domain` (types + no engine import in option groups), `react` |
| Apps = shell delgado + domain engine for price | PASS — `calcProjectBreakdown` only in `apps/web` `ModulePricePreviewDemo` (`App.tsx` L16, L111); UI only gates |
| Controlled parent state | PASS — parent owns `optionGroups`; screen is presentation |
| Domain purity untouched | PASS — F007 did not change domain engine formulas |
| Sin `console.log` debug | PASS — none in optionGroups or App production sources |

## Conventions

- Module headers + camelCase helpers (`optionGroupHelpers.ts`); PascalCase screens (`OptionGroupsScreen.tsx`, `PricePreviewGate.tsx`) — PASS  
- Immutable updates in shell: spread / map / filter (`App.tsx`) — PASS  
- Spanish UI labels/messages; English identifiers — PASS  
- Colocated helper tests + package surface export smoke — PASS  
- Matches F006 catalog UI patterns (controlled screen + shell wiring) — PASS  

## Verification (docs/verification.md)

| Level | Result |
|-------|--------|
| Nivel 1 domain | PASS — 29/29 (via `./init.sh`) |
| Nivel 2 ui | PASS — 27/27 including 12 `optionGroupHelpers` + export surface |
| Nivel 2 web | PASS — 7/7 (F006 contracts + F007 OPT-02/03/05) |
| Nivel 3 monorepo | PASS — `./init.sh` exit 0, all workspaces green |
| Typecheck / build | PASS — `@muebles/ui` + `@muebles/web` typecheck; Vite web production build OK |
| Golden / excel / storage | N/A for F007 logic; monorepo still green |

## Commands executed (reviewer)

```text
./init.sh                              # exit 0 — [OK] Entorno listo; 15 features, 1 in_progress (F007)
pnpm --filter @muebles/ui typecheck    # ok
pnpm --filter @muebles/web typecheck   # ok
pnpm --filter @muebles/ui test         # 27 passed
pnpm --filter @muebles/web test        # 7 passed
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
- [x] Como mucho una feature `in_progress` (solo F007)
- [x] Features `done` previas con monorepo tests green
- [x] `progress/current.md` describe sesión F007 activa (implemented, awaiting review)

### C3 — El código respeta la arquitectura
- [x] `packages/domain` no importa react, electron, fs, ni xlsx (no violado por F007)
- [x] `packages/ui` no implementa fórmulas de costo ni accede a fs
- [x] `packages/excel` no importa react ni electron (no tocado en F007)
- [x] Errores de dominio: N/A en UI gate (form validation strings; shell catches domain errors for preview without stack to user)
- [x] Sin `console.log` de debug en sources UI/web de producción

### C4 — La verificación es real
- [x] `pnpm --filter @muebles/domain test` 100%
- [x] UI helpers OPT-01/02/05 + seed OPT-03 asserts en web tests
- [x] Export fixture / golden motor — N/A scope F007; monorepo still green
- [x] Storage tempdir — N/A scope F007; monorepo still green

### C5 — Cierre de sesión (post-approve, owner: leader)
- [x] Sin artefactos sospechosos en sources revisados (`packages/ui/src/optionGroups/*`, `apps/web/src/*`)
- [ ] `progress/history.md` entrada de **esta** sesión — pendiente al cerrar (leader)
- [ ] Feature en estado final correcto en `feature_list.json` — sigue `in_progress` (correcto pre-approve; leader marca `done`)
- [ ] `progress/current.md` limpio — pendiente al archivar sesión (leader)

> C5 open boxes are **session-close duties for the leader after approval**, not F007 defects. Reviewer does not mark `done` or close the session.

## Residual notes (non-blocking)

1. **No DOM / React Testing Library coverage** — `OptionGroupsScreen`, `PricePreviewGate`, and `App` are not rendered in tests (same pattern as F006). Critical pure rules are unit-tested; full CRUD interaction is code-reviewed only. Acceptable per `docs/verification.md` (“si hay tests de componente”).
2. **`App.test.ts` does not import `App`** — verifies seed + helper contracts the shell relies on, not React mount. Wiring in `App.tsx` is consistent with those contracts.
3. **OPT-04 quotation picker** intentionally out of scope (handoff + feature_list).
4. **Inline style** on demo intro paragraph in `App.tsx` L133 — polish only; does not affect acceptance.
5. **Gate does not re-validate that choice id is still a member of the group** — empty/missing choice blocks; stale ids would fail later in domain resolve (shell try/catch shows “No se pudo calcular…”). Acceptable for F007 preview gate.

## Cambios requeridos

Ninguno.

## Leader next steps (not reviewer)

1. Marcar F007 `done` en `feature_list.json`.
2. Archivar sesión en `progress/history.md` y limpiar/actualizar `progress/current.md`.
3. Tomar F008 (`ui_module_editor`) como siguiente feature pending.
