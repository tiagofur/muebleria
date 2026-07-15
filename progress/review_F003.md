# Review — feature F003

**Veredicto:** APPROVED  
**Feature:** F003 — domain_engine  
**Reviewer:** reviewer agent  
**Date:** 2026-07-15  
**Handoff:** `progress/impl_F003.md`

## Acceptance criteria → evidence

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| 1 | `resolveBom` asigna material por `optionRole` | PASS | `engine.ts` `requireMaterialChoice` + `resolveBom` L434–489; tests `engine.test.ts` L148–161 and golden map L520–536 (`INTERIOR→matArauco`, `FRENTE→matMaderado`, `BISAGRA→hwBisagra`). |
| 2 | Error descriptivo si falta choice required | PASS | `ResolutionError` with message `Missing required option choice for role "…"` + `context.optionGroupCode` (`engine.ts` L162–174); test L180–192. Same pattern for required hardware roles L222–234. |
| 3 | `calcLineCost`: areaM2, edgeMl, boardCost, edgeCost, hardwareCost | PASS | Formulas match PRD §13.1–13.2 (`engine.ts` L492–629). Unit tests L260–338: 1000×500 L1+L2 → area=0.5, edgeMl=2, board=50, edge=20; waste 10% → 110; hw 2×20=40. Union dispatcher via `materialId in line`. |
| 4 | `calcProjectBreakdown`: directCost, salePrice per PRD §13 | PASS | Aggregates L698–702: `direct = mat+edge+hw`; `sale = direct*margin + laborModular + laborFixed`. Project qty multiplies lines; `baseLaborCost ?? 0`. Tests L341–436. |
| 5 | Golden MOD-GAB-01 + MOD-CAJ-01 totals match plantilla | PASS | `engine.test.ts` L497–518 + `plantillaDemo.ts` expected; independent recomputation matches expected within 0.01 (see below). `toBeCloseTo(..., 2)` used. |
| 6 | `pnpm --filter @muebles/domain test` 100% | PASS | 24/24 domain tests; monorepo `./init.sh` + `pnpm test` all green. |

## Formula spot-check (PRD §13)

### Single board part (Costado 720×590, all edges, ARAUCO 160 / canto 12)

| Metric | Formula | Value |
|--------|---------|------:|
| areaM2 | `1 * 720 * 590 / 1e6` | 0.4248 |
| edgeMl | `1 * ((1+1)*720 + (1+1)*590) / 1000` | 2.62 |
| boardCost | `0.4248 * 160 * (1+0/100)` | 67.968 |
| edgeCost | `2.62 * 12` | 31.44 |

Matches engine implementation of `calcBoardLineMetrics` / `calcBoardLineCost`.

### Project aggregates (independent recompute from fixture BOM rows)

| Field | Expected (`plantillaExpected`) | Independent recompute | Match |
|-------|-------------------------------:|----------------------:|:-----:|
| materialsCost | 792.5836 | 792.5836 | yes |
| edgeTotal | 412.238 | 412.238 | yes |
| hardwareTotal | 953 | 953 | yes |
| directCost | 2157.8216 | 2157.8216 | yes |
| laborModular | 0 | 0 | yes |
| laborFixedCost | 1200 | 1200 | yes |
| marginFactor | 1.35 | 1.35 | yes |
| salePrice | 4113.05916 | `(2157.8216 * 1.35) + 1200` = 4113.05916 | yes |

Hardware check: GAB `2*35+1*45+4*15+40*0.5+4*2=203` + CAJ `4*120+4*45+4*15+60*0.5=750` = **953**.

## Edge strategy (§13.5) vs Excel

| Rule | Engine | Tests |
|------|--------|-------|
| Explicit `optionChoices.EDGE` | preferred when edges enabled | L229–257 |
| Material-linked default by **display name** | first active `EdgeBand` with `name === material.name` | golden L531–534 |
| Edges enabled, no band | `ResolutionError` | implemented L137–148 |
| No edges enabled | `edgeBandId` omitted, `edgeCost=0` | L207–227 |

Documented intentional divergence from baking edge into material row; aligns with PRD §13.5 recommended model + seed pre-map.

## VAL coverage (§9.4)

| ID | Result | Notes |
|----|--------|-------|
| VAL-01 | PASS | `validateBoardPart` L/A > 0; enforced in `resolveBom` / `calcBoardLineCost`; test L440–459 |
| VAL-02 | PASS | Material required via option choice / resolution (`requireMaterialChoice`) |
| VAL-03 | PASS | qty > 0 (`validateHardwareLine`); hardware must exist (`requireHardwareId` / `calcHardwareLineCost`) |
| VAL-04 | PASS | Typed `EdgeAssignment.enabled: boolean`; structural check of 4 sides L1/L2/W1/W2 in `validateBoardPart` |
| VAL-05 | DEFERRED | Correctly out of engine scope; F004 export — documented in handoff + `resolveBom` JSDoc |
| VAL-06 | PASS | Inactive material/edge/hw → `ValidationError`; test L194–205 |
| VAL-07 | PASS | Empty codes/names on module + catalog entities; tests L468–494 |

## Architecture boundaries (C3)

| Check | Result |
|-------|--------|
| `packages/domain` no react / electron / fs / xlsx | PASS — production sources import only `./errors` + `./types` |
| Runtime deps | PASS — `package.json` has **no** `dependencies` (only typescript + vitest devDeps) |
| Errors are `DomainError` subclasses | PASS — `ResolutionError` / `ValidationError` with actionable `message` + `context` |
| No `console.log` in domain production sources | PASS |
| UI does not calculate costs | N/A (F003 only domain) |
| Modules resolved from `catalog.modules` | PASS — signature `calcProjectBreakdown(project, catalog)` consistent with architecture data flow (feature_list prose still mentions separate `modules` arg; API is cleaner and correct) |

## Conventions

- TypeScript ESM, Vitest, single quotes, module header comments — PASS  
- `engine.ts` + colocated `engine.test.ts`; fixtures under `src/__fixtures__/` — PASS  
- Function names `resolveBom`, `calcLineCost`, `calcProjectBreakdown` — PASS  
- Golden expected values documented in fixture header + test comment block — PASS  
- `toBeCloseTo` for float totals — PASS  
- No `any` in engine sources — PASS  
- Intentional divergences (waste=0, laborModular=0, no IVA, edge-by-name) documented in fixture + golden test — PASS  

## Commands executed (reviewer)

```text
./init.sh                            # exit 0 — [OK] Entorno listo. Puedes empezar a trabajar.
pnpm --filter @muebles/domain test   # 24/24 (3 files)
pnpm test                            # all workspaces green
python3 independent golden recompute # matches plantillaExpected within 0.01
```

## Checkpoints

### C1 — El harness está completo
- [x] Archivos base: `AGENTS.md`, `init.sh`, `feature_list.json`, `progress/current.md`, `CHECKPOINTS.md`
- [x] Docs: `docs/prd.md`, `docs/architecture.md`, `docs/conventions.md`, `docs/verification.md`
- [x] Skills: leader / implementer / reviewer under `.agents/skills/`
- [x] `./init.sh` exit 0

### C2 — El estado es coherente
- [x] Como mucho una feature `in_progress` (solo F003)
- [x] Features `done` (F001/F002) con monorepo tests green
- [x] `progress/current.md` describe sesión F003 activa (handoff clear; not garbage)

### C3 — El código respeta la arquitectura
- [x] `packages/domain` no importa react, electron, fs, ni xlsx
- [x] `packages/ui` no implementa fórmulas ni accede a fs (no tocado)
- [x] `packages/excel` no importa react ni electron (no tocado)
- [x] Errores del dominio son `DomainError` / subclases
- [x] Sin `console.log` de debug en sources de domain

### C4 — La verificación es real
- [x] `pnpm --filter @muebles/domain test` 100% (24/24)
- [x] Export fixture — N/A (F003 no toca export; F004)
- [x] Storage tmp — N/A (F003 no implementa storage)
- [x] Golden motor (F003): totales plantilla dentro de tolerancia 0.01; `toBeCloseTo` + documented expected values

### C5 — Cierre de sesión (post-approve, owner: leader)
- [x] Sin artefactos sospechosos en domain (`src/` + fixtures; no `dist/` committed)
- [ ] `progress/history.md` entrada de **esta** sesión — pendiente al cerrar (leader)
- [ ] Feature en estado final correcto en `feature_list.json` — sigue `in_progress` (correcto pre-approve; leader marca `done`)
- [ ] `progress/current.md` limpio — pendiente al archivar sesión (leader)

> C5 open boxes are **session-close duties for the leader after approval**, not F003 defects. Reviewer does not mark `done` or close the session.

## Residual notes (non-blocking)

1. **Edge linked by display name** is fragile if catalog renames materials/edges; production UI should prefer explicit `EDGE` choice (already supported). Documented by implementer.
2. **VAL-04 incomplete-sides unit test** is thin (structure enforced in `validateBoardPart` but no dedicated “missing W2” case). Implementation is correct; optional test hardening later.
3. **VAL-05** deferred to F004 — correct boundary.
4. **feature_list.json** description still says `calcProjectBreakdown(project, modules, catalog)`; real API is `(project, catalog)` with modules in catalog — prefer updating the description when marking done (cosmetic).

## Cambios requeridos

Ninguno.

## Leader next steps (not reviewer)

1. Marcar F003 `done` en `feature_list.json`.
2. Archivar sesión en `progress/history.md` y limpiar/actualizar `progress/current.md`.
3. Tomar F004 (`excel_optimizer_export`) como siguiente feature pending.
