# Review — feature F011

**Veredicto:** APPROVED  
**Feature:** F011 — seed_data  
**Reviewer:** reviewer agent  
**Date:** 2026-07-15  
**Handoff:** `progress/impl_F011.md`

## Acceptance criteria → evidence

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| 1 | App nueva abre con seed sin error (CAT-06, OPT-03, MOD-07) | PASS | `createSeedWorkspace()` → plantilla catalog + modules + draft demo (`packages/storage/src/seed.ts` L19–24). Web initial state: `useState(() => createSeedWorkspace())` (`apps/web/src/App.tsx` L404). Missing file → seed (`jsonFileStorage.ts` L35). Tests: `seed.test.ts` (materials/edges/hw/groups/modules/demo), `workspace.test.ts` (load missing → demo), `App.test.ts` CAT-06 / OPT-03 seed catalogs. |
| 2 | Cotización MOD-GAB-01 × 1 con choices plantilla reproduce precio plantilla | PASS | Demo project: MOD-GAB-01 × 1, `plantillaChoices`, margin 1.35, laborFixed 1200 (`plantillaDemo.ts` L520–549). Golden GAB-only: `plantillaGabOnlyExpected` / `GAB_ONLY_GOLDEN`. Tests: `engine.test.ts` GAB-only golden; `seed.test.ts` demo price vs expected. Independent recompute matches expected (see below). |
| 3 | Export de esa cotización produce Optimizer.xlsx esperado | PASS | `generateCutRows(plantillaGabOnlyProject)` equals `modGab01CutRows.json` (8 board rows, no hardware) — `optimizerExport.test.ts` F011 + fixture tests. Web path: `buildOptimizerExport(demo, seed.catalog)` → ok + `.xlsx` (`exportOptimizer.test.ts` F011). Seed cut-row shape asserted in `seed.test.ts`. |

### Independent GAB-only golden recompute (reviewer)

From BOM dims × unit costs in fixture (waste 0):

| Field | Manual | Fixture expected | Δ |
|-------|-------:|-----------------:|--:|
| materialsCost | 285.24184 | 285.24184 | 0 |
| edgeTotal | 136.126 | 136.126 | ~0 |
| hardwareTotal | 203 (= 2×35 + 45 + 4×15 + 40×0.5 + 4×2) | 203 | 0 |
| directCost | 624.36784 | 624.36784 | 0 |
| salePrice | 624.36784 × 1.35 + 1200 = 2042.896584 | 2042.896584 | 0 |

Dual-module golden still green (salePrice 4113.05916). GAB-only is **not** the dual Resumen total — intentional and documented (acceptance is MOD-GAB-01 × 1 only; laborFixed stays project-level 1200, not pro-rated).

### Seed completeness (spot-check)

| Area | Codes / shape | Result |
|------|---------------|--------|
| Materials CAT-06 | TAB-ARA-BLA, TAB-MAD-FRE, TAB-MDF-3 + costPerM2 > 0 | PASS |
| Edges | CAN-ARA-BLA / CAN-MAD-FRE / CAN-MDF-3 linked by display name | PASS |
| Hardware | HER-BIS-CL, JAL, PATA, TOR, CORR, SOP | PASS |
| Groups OPT-03 | INTERIOR, FRENTE, FONDO, BISAGRA, CORREDERA (required + members) | PASS |
| Modules MOD-07 | MOD-GAB-01 (INTERIOR/FRENTE + BISAGRA/FIXED), MOD-CAJ-01 (INTERIOR/FRENTE/FONDO + CORREDERA) | PASS |
| Demo project | draft "Demo plantilla", qty 1, plantillaChoices | PASS |

### Intentional divergences (documented — OK)

- `wastePercent = 0` (F014 later)
- `laborModular = 0` (Excel only B17 fixed labor)
- No IVA (Excel pre-tax)
- Edge by material display name (Excel VLOOKUP)
- laborFixedCost not pro-rated by module count

### Out of scope / no leakage

F012 snapshot, F013 hardware list export, F014 waste UI, F015 duplicate — not present in seed path. Fixture `wastePercent: 0` is domain field default, not F014 UI.

## Architecture boundaries (C3)

| Check | Result |
|-------|--------|
| domain pure (no react/electron/fs/xlsx) | PASS — fixtures + engine only; no forbidden imports |
| storage imports domain types + fixtures only | PASS — `seed.ts` uses `@muebles/domain` + `@muebles/domain/fixtures` |
| UI no formulas in seed path | PASS — seed composition in storage/domain fixtures; App only initializes workspace |
| excel only serializes cut rows | PASS — F011 adds fixture assert on same `generateCutRows` → `optimizerExport` path |
| Sin `console.log` debug in production sources reviewed | PASS (smoke script log only under excel fixtures) |

## Conventions

- camelCase modules (`seed.ts`, `plantillaDemo.ts`) + colocated `seed.test.ts` — PASS  
- Domain fixtures exported via package `./fixtures` entry — PASS  
- `createPlantillaDemoProject()` clones choices to avoid fixture mutation — PASS  
- Spanish product name "Demo plantilla"; English identifiers — PASS  
- Documented divergences in fixture header + golden tests — PASS  

## Verification (docs/verification.md)

| Level | Result |
|-------|--------|
| Nivel 1 domain | PASS — 39/39 (dual + GAB-only golden) |
| Nivel 2 storage | PASS — 17/17 (`seed.test.ts` 8 + workspace tmp real) |
| Nivel 2 excel | PASS — 8/8 (modGab01 fixture + plantillaGabOnlyProject) |
| Nivel 2 web | PASS — 24/24 (seed demo + Optimizer export path) |
| Nivel 2 ui / desktop | PASS — 55 / 7 (unchanged; monorepo green) |
| Nivel 3 monorepo | PASS — `./init.sh` exit 0 |
| Nivel 4 golden | PASS — GAB-only + dual; tolerance 0.01; independent recompute exact |
| Typecheck | PASS — domain, storage, excel `tsc --noEmit` |

## Commands executed (reviewer)

```text
./init.sh
  # exit 0 — domain 39, storage 17, excel 8, ui 55, web 24, desktop 7

pnpm --filter @muebles/storage exec vitest run src/seed.test.ts   # 8/8
pnpm --filter @muebles/excel exec vitest run src/optimizerExport.test.ts -t "F011|fixture: MOD-GAB"  # 2 pass
pnpm --filter @muebles/web exec vitest run src/exportOptimizer.test.ts -t "F011"  # 1 pass
pnpm --filter @muebles/domain exec vitest run src/engine.test.ts -t "GAB-only"  # 1 pass
pnpm --filter @muebles/{domain,storage,excel} typecheck  # ok
# Manual Python recompute of GAB BOM costs → exact match plantillaGabOnlyExpected
```

## Checkpoints

### C1 — El harness está completo
- [x] Archivos base: `AGENTS.md`, `init.sh`, `feature_list.json`, `progress/current.md`, `CHECKPOINTS.md`
- [x] Docs: `docs/prd.md`, `docs/architecture.md`, `docs/conventions.md`, `docs/verification.md`
- [x] Skills: leader / implementer / reviewer under `.agents/skills/`
- [x] `./init.sh` exit 0

### C2 — El estado es coherente
- [x] Como mucho una feature `in_progress` (solo F011)
- [x] Features `done` previas con monorepo tests green
- [x] `progress/current.md` describe sesión F011 activa (implemented, awaiting review)

### C3 — El código respeta la arquitectura
- [x] `packages/domain` no importa react, electron, fs, ni xlsx
- [x] `packages/ui` no implementa fórmulas de costo ni accede a fs / xlsx (seed no toca UI calc)
- [x] `packages/excel` no importa react ni electron
- [x] Errores de dominio: sin cambios problemáticos en F011; seed es data pura
- [x] Sin `console.log` de debug en sources de producción F011

### C4 — La verificación es real
- [x] `pnpm --filter @muebles/domain test` 100% (39)
- [x] Export fixture MOD-GAB-01 + plantillaGabOnlyProject green
- [x] Storage: `seed.test.ts` + `JSONFileStorage` con tempdir real
- [x] Golden GAB-only + dual dentro de tolerancia 0.01 (recompute exact)

### C5 — Cierre de sesión (post-approve, owner: leader)
- [x] Sin artefactos sospechosos en sources revisados (seed/fixtures/tests)
- [ ] `progress/history.md` entrada de **esta** sesión — pendiente al cerrar (leader)
- [ ] Feature en estado final correcto en `feature_list.json` — sigue `in_progress` (correcto pre-approve; leader marca `done`)
- [ ] `progress/current.md` limpio — pendiente al archivar sesión (leader)

> C5 open boxes are **session-close duties for the leader after approval**, not F011 defects. Reviewer does not mark `done` or close the session.

## Residual notes (non-blocking)

1. **Fixture entity IDs are stable strings** (`mat-arauco-blanco`, `mod-gab-01`, …), not UUID v4. Consistent with prior golden fixtures (F003+); acceptable for deterministic seed/tests. Production UI still uses `crypto.randomUUID()` for new entities.
2. **`apps/web/dist` may lag source** (stale bundle can still show empty projects). Source uses `createSeedWorkspace()` from storage. Rebuild on next web build; not a product defect.
3. **Demo project in seed is a product choice** (not empty `projects: []`). Aligns with CAT-06 “first open has useful data”; covered by acceptance tests.
4. **GAB-only sale includes full laborFixed 1200** — same Excel B17 semantics on a smaller BOM; documented so dual Resumen is not misread as the GAB-only target.

## Cambios requeridos

Ninguno.

## Leader next steps (not reviewer)

1. Marcar F011 `done` en `feature_list.json`.
2. Archivar sesión en `progress/history.md` y limpiar/actualizar `progress/current.md`.
3. Tomar F012 (`quote_snapshot`) como siguiente feature pending.
