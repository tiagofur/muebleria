# Review — feature F014

**Veredicto:** APPROVED  
**Feature:** F014 — waste_percent (Merma % por material)  
**Reviewer:** reviewer agent  
**Date:** 2026-07-15  
**Handoff:** `progress/impl_F014.md`

## Acceptance criteria → evidence

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| 1 | Campo editable en UI de catálogo de materiales | PASS | `MaterialsCatalog.tsx`: form field **Merma (%)** (`id="mat-waste"`, L263–274), draft default `wastePercent: 0` (`emptyDraft` L32), edit path `toDraft` uses `item.wastePercent ?? 0` (L43), table column **Merma (%)** (L131–135), validate `validateNonNegativeNumber(draft.wastePercent, 'Merma')` (L93). Web shell maps draft → domain on create/update (`App.tsx` L486, L504). |
| 2 | `boardCost = areaM2 × costPerM2 × (1 + waste/100)` | PASS | `calcBoardLineCost` in `packages/domain/src/engine.ts` L544–545: `waste = material.wastePercent ?? 0` then `boardCost = areaM2 * material.costPerM2 * (1 + waste / 100)`. Matches PRD §13.2 (`docs/prd.md` L626). Type `MaterialBoard.wastePercent?` (`types.ts` L28). |
| 3 | Test unitario con waste 10% reproducible | PASS | `engine.test.ts` L287–327: part 1000×1000 → `areaM2 = 1`, `costPerM2 = 100`, `wastePercent: 10` → `boardCost` 110; also asserts formula `areaM2 * 100 * (1 + 10/100)`. Companion test omit → default 0 (L329–363). |

### PRD / independent logic

| Check | Expected | Implementation |
|-------|----------|----------------|
| PRD §13.2 boardCost | `areaM2 * costPerM2 * (1 + wastePercent/100)` | `engine.ts` L544–545 exact |
| MVP default | 0% when omitted | `?? 0` in engine + UI draft / column |
| Seed / golden | waste 0 so plantilla totals stable | fixtures `wastePercent: 0` (`plantillaDemo.ts`); golden paths still green |
| UI no formulas | presentation only | catalog field + validation; cost math stays in domain |
| Non-negative Merma | reject negatives in ABM | `validateNonNegativeNumber(..., 'Merma')` + test in `catalogHelpers.test.ts` L86–90 |

Independent arithmetic check: 1 m² × 100 $/m² × 1.10 = **110** — matches unit test.

## Architecture boundaries (C3)

| Check | Result |
|-------|--------|
| domain pure (no react/electron/fs/xlsx) | PASS — formula only in `engine.ts`; no forbidden imports in `packages/domain` |
| UI no cost formulas / no fs / no xlsx | PASS — UI stores/edits `wastePercent`; does not compute `boardCost` |
| excel unchanged for F014 scope | PASS — no excel touch required |
| Apps = thin shells | PASS — `App.tsx` maps `draft.wastePercent` into `MaterialBoard` only |
| DomainError patterns | PASS — F014 adds no new error paths; existing inactive/missing material errors unchanged |
| Sin `console.log` debug | PASS — none in domain; F014 UI sources clean |

## Conventions

- Type field `wastePercent?` optional number on `MaterialBoard` — PASS (`types.ts`)  
- camelCase ids/functions; Spanish UI labels (**Merma (%)**) — PASS  
- `readonly` entity fields — PASS  
- Colocated tests: `engine.test.ts`, `catalogHelpers.test.ts` — PASS  
- Comment only where product/why matters (plantilla fixture waste 0) — PASS  
- Does not invent cost logic in UI — PASS  

## Verification (docs/verification.md)

| Level | Result |
|-------|--------|
| Nivel 1 domain | PASS — 53/53 (includes waste 10% + default-omit 0) |
| Nivel 2 ui | PASS — 56/56 (Merma validation + prior catalog helpers) |
| Nivel 2 excel / storage / web / desktop | PASS — 14 / 17 / 30 / 7 |
| Nivel 3 monorepo | PASS — `./init.sh` exit 0 |
| Nivel 4 golden motor | PASS — plantilla paths still green with waste 0 (intentional; Excel has no merma) |

## Commands executed (reviewer)

```text
./init.sh
  # exit 0 — domain 53, excel 14, ui 56, storage 17, web 30, desktop 7; typecheck OK

pnpm --filter @muebles/domain test   # 53/53
pnpm --filter @muebles/ui test       # 56/56
```

## Checkpoints

### C1 — El harness está completo
- [x] Archivos base: `AGENTS.md`, `init.sh`, `feature_list.json`, `progress/current.md`, `CHECKPOINTS.md`
- [x] Docs: `docs/prd.md`, `docs/architecture.md`, `docs/conventions.md`, `docs/verification.md`
- [x] Skills: leader / implementer / reviewer under `.agents/skills/`
- [x] `./init.sh` exit 0

### C2 — El estado es coherente
- [x] Como mucho una feature `in_progress` (solo F014)
- [x] Features `done` previas con monorepo tests green
- [x] `progress/current.md` describe sesión F014 activa (handoff listo para reviewer)

### C3 — El código respeta la arquitectura
- [x] `packages/domain` no importa react, electron, fs, ni xlsx
- [x] `packages/ui` no implementa fórmulas de costo ni accede a fs / xlsx
- [x] `packages/excel` no importa react ni electron (no tocado)
- [x] Errores de dominio existentes intactos; F014 no introduce strings crudos de dominio
- [x] Sin `console.log` de debug en sources F014

### C4 — La verificación es real
- [x] `pnpm --filter @muebles/domain test` 100% (53)
- [x] Export fixture path N/A for F014 (no export change)
- [x] Storage path N/A for F014 (field persists via existing MaterialBoard JSON)
- [x] Golden / plantilla motor still green in monorepo (waste 0 documented)

### C5 — Cierre de sesión (post-approve, owner: leader)
- [x] Sin artefactos sospechosos en sources revisados (domain/ui/web F014 paths)
- [ ] `progress/history.md` entrada de **esta** sesión — pendiente al cerrar (leader)
- [ ] Feature en estado final correcto en `feature_list.json` — sigue `in_progress` (correcto pre-approve; leader marca `done`)
- [ ] `progress/current.md` limpio — pendiente al archivar sesión (leader)

> C5 open boxes are **session-close duties for the leader after approval**, not F014 defects. Reviewer does not mark `done` or close the session.

## Residual notes (non-blocking)

1. **Domain does not throw on negative `wastePercent`** — catalog ABM rejects negatives; engine trusts stored catalog (`?? 0` only for omit/undefined). Documented in handoff; domain-level `ValidationError` explicitly out of scope.
2. **No RTL/DOM test** on Merma input — controlled form pattern matches other catalog fields; validation covered via helper unit test.
3. **Quote snapshot fields** do not store waste separately — live recompute of `boardCost` from catalog is the cost path; freeze of snapshot is F012 scope, not a regression.
4. **Seed/fixtures keep waste 0** — intentional so Excel golden totals stay stable; product MVP default.

## Cambios requeridos

Ninguno.

## Leader next steps (not reviewer)

1. Marcar F014 `done` en `feature_list.json`.
2. Archivar sesión en `progress/history.md` y limpiar/actualizar `progress/current.md`.
3. Tomar F015 (`duplicate_module_project`) según `feature_list.json`.
