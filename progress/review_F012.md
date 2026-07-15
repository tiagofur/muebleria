# Review — feature F012

**Veredicto:** APPROVED  
**Feature:** F012 — quote_snapshot  
**Reviewer:** reviewer agent  
**Date:** 2026-07-15  
**Handoff:** `progress/impl_F012.md`

## Acceptance criteria → evidence

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| 1 | Draft projects recalculate with current catalog | PASS | `calcProjectBreakdown` always uses `calcLiveProjectBreakdown` for non-closed status (`engine.ts` L846–853). Draft ignores stale `priceSnapshot` (`engine.test.ts` L571–595). Reopen after Arauco raise → higher `salePrice` / `materialsCost` (`engine.test.ts` L520–534). |
| 2 | Closed projects keep prices from close moment | PASS | Closed + snapshot returns `project.priceSnapshot.breakdown` without re-reading catalog (`engine.ts` L850–851). Escenario B: after Arauco `costPerM2` 160 → 1600, closed still equals sale at close and plantilla `materialsCost` (`engine.test.ts` L485–518). `quoted` ↔ `accepted` keeps same snapshot object / `capturedAt` (L537–556). |
| 3 | PRD Scenario B reproducible without Excel | PASS | Suite `quote snapshot — Escenario B (PRD §6.2 / §7.4)` uses plantilla fixtures only (`plantillaProject`, `plantillaCatalogWithModules`, `plantillaExpected`). Flow: draft live → close quoted + freeze → raise Arauco → closed frozen / draft higher. Aligns with PRD §4.3 Escenario B and §7.4 policies 1–2. |

### Independent logic check (reviewer)

| Path | Expected (PRD §7.4) | Implementation |
|------|---------------------|----------------|
| `draft` | always live catalog | `!isProjectClosed` → live (`engine.ts` L846–853); stale snapshot stripped on draft→draft transition (L833–837) |
| `quoted` / `accepted` with snapshot | freeze unit prices / breakdown | early return frozen breakdown |
| close (`draft` → closed) | attach fresh snapshot | `captureQuoteSnapshot` via live calc + unit maps (L806–811, L777–788) |
| reopen (closed → `draft`) | drop snapshot | omit `priceSnapshot` (L814–819) |
| closed ↔ closed | keep freeze | keep existing snapshot; re-capture only if missing (L822–830) |

Shell wiring: create/update project status goes through `transitionProjectStatus` (`App.tsx` L651–656, L677–682) — does not set `status` / `priceSnapshot` by hand. UI badge is presentation-only (`isProjectClosed` + presence of snapshot → "Precios congelados" / "Totales (congelados)", `ProjectsScreen.tsx` L603–616).

SCHEMA_VERSION stays **1** (optional field) — correct for backward-compatible load of workspaces without `priceSnapshot`.

## Architecture boundaries (C3)

| Check | Result |
|-------|--------|
| domain pure (no react/electron/fs/xlsx) | PASS — snapshot API in `engine.ts` / `types.ts` only; no forbidden imports |
| UI no cost formulas | PASS — UI displays `QuoteBreakdown` props + badge; `isProjectClosed` is status predicate only, not pricing math |
| Apps = thin shell | PASS — shell calls domain `transitionProjectStatus` / `calcProjectBreakdown`; no freeze logic reinvented |
| Immutability | PASS — transitions return new `Project` via spread; no in-place mutation |
| Sin `console.log` debug in reviewed F012 sources | PASS |

## Conventions

- Types `QuotePriceSnapshot`, functions `isProjectClosed` / `captureQuoteSnapshot` / `transitionProjectStatus` — PASS  
- Optional `Project.priceSnapshot?` + readonly maps — PASS  
- Tests colocated in `engine.test.ts` / `types.test.ts` with arrange–act–assert and plantilla fixtures — PASS  
- Spanish UI copy ("Precios congelados"); English identifiers — PASS  
- Exports from `packages/domain/src/index.ts` — PASS  

## Verification

| Level | Result |
|-------|--------|
| Nivel 1 domain | PASS — 46/46 (includes +6 Escenario B + types construction) |
| Nivel 2 ui | PASS — 55/55 |
| Nivel 2 web | PASS — 24/24 |
| Nivel 2 storage / excel / desktop | PASS — monorepo green (17 / 8 / 7) |
| Nivel 3 monorepo | PASS — `./init.sh` exit 0 |

## Commands executed (reviewer)

```text
./init.sh
  # exit 0 — domain 46, storage 17, excel 8, ui 55, web 24, desktop 7

pnpm --filter @muebles/domain test   # 46/46
pnpm --filter @muebles/ui test       # 55/55
pnpm --filter @muebles/web test      # 24/24
```

## Checkpoints

### C1 — El harness está completo
- [x] Archivos base: `AGENTS.md`, `init.sh`, `feature_list.json`, `progress/current.md`, `CHECKPOINTS.md`
- [x] Docs: `docs/prd.md`, `docs/architecture.md`, `docs/conventions.md`, `docs/verification.md`
- [x] Skills: leader / implementer / reviewer under `.agents/skills/`
- [x] `./init.sh` exit 0

### C2 — El estado es coherente
- [x] Como mucho una feature `in_progress` (solo F012)
- [x] Features `done` previas con monorepo tests green
- [x] `progress/current.md` describe sesión F012 activa (implemented, awaiting review)

### C3 — El código respeta la arquitectura
- [x] `packages/domain` no importa react, electron, fs, ni xlsx
- [x] `packages/ui` no implementa fórmulas de costo ni accede a fs / xlsx
- [x] `packages/excel` no tocado por F012 (sin regresión)
- [x] Errores de dominio: sin cambios problemáticos; freeze path no introduce strings crudos
- [x] Sin `console.log` de debug en sources F012

### C4 — La verificación es real
- [x] `pnpm --filter @muebles/domain test` 100% (46)
- [x] Escenario B plantilla (sin Excel) green en `engine.test.ts`
- [x] UI / web packages green
- [x] Golden plantilla still used as baseline at close (`plantillaExpected.salePrice`)

### C5 — Cierre de sesión (post-approve, owner: leader)
- [x] Sin artefactos sospechosos en sources revisados (types/engine/ui/shell/tests)
- [ ] `progress/history.md` entrada de **esta** sesión — pendiente al cerrar (leader)
- [ ] Feature en estado final correcto en `feature_list.json` — sigue `in_progress` (correcto pre-approve; leader marca `done`)
- [ ] `progress/current.md` limpio — pendiente al archivar sesión (leader)

> C5 open boxes are **session-close duties for the leader after approval**, not F012 defects. Reviewer does not mark `done` or close the session.

## Residual notes (non-blocking)

1. **No shell/UI integration test for freeze badge / status transition** — domain coverage of Escenario B is solid; `App.test.ts` has no quoted/snapshot path. Acceptable for F012 acceptance (domain-centric); a thin shell test would harden regression later.
2. **Edits to items while closed do not re-freeze** — documented out of scope in `impl_F012.md`; existing snapshot kept. Matches F012 scope (freeze on status close).
3. **Closed project without `priceSnapshot` recalculates live** until a closed↔closed transition re-captures. Safe for SCHEMA_VERSION 1 optional field; first close always attaches snapshot via shell `transitionProjectStatus`.
4. **Meta changes while closed** (e.g. `marginFactor` on project) do not alter displayed totals — frozen breakdown wins. Consistent with freeze-at-close policy.

## Cambios requeridos

Ninguno.

## Leader next steps (not reviewer)

1. Marcar F012 `done` en `feature_list.json`.
2. Archivar sesión en `progress/history.md` y limpiar/actualizar `progress/current.md`.
3. Tomar F013 (`hardware_list_export`) como siguiente feature pending.
