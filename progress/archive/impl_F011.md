# F011 — seed_data (implementer handoff)

**Status:** implemented, tests green, **not marked done** (awaiting reviewer)  
**Date:** 2026-07-15

## Acceptance

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| 1 | App nueva abre con seed sin error (CAT-06, OPT-03, MOD-07) | PASS | `createSeedWorkspace` + App initial state; `seed.test.ts`, `App.test.ts` (catalogs, groups, modules + roles, demo project) |
| 2 | Cotización MOD-GAB-01 × 1 con choices plantilla reproduce precio | PASS | `plantillaGabOnlyExpected` + `engine.test.ts` GAB-only golden + `seed.test.ts` demo price |
| 3 | Export de esa cotización produce Optimizer esperado | PASS | `modGab01CutRows.json` + `optimizerExport.test.ts` (gab + plantillaGabOnlyProject) + web seed → `buildOptimizerExport` |

## What changed

### Fixtures (`packages/domain/src/__fixtures__/plantillaDemo.ts`)
- Catalog already complete: Arauco/Maderado/MDF materials + matching edges, demo hardware, option groups INTERIOR/FRENTE/FONDO/BISAGRA/CORREDERA with members, MOD-GAB-01 / MOD-CAJ-01 with correct optionRoles.
- Added `plantillaGabOnlyProject`, `createPlantillaDemoProject()`, `plantillaGabOnlyExpected`, `GAB_ONLY_GOLDEN`.
- Kept dual-module `GOLDEN_FIXTURE` / `plantillaProject` / `plantillaExpected`.

### Seed (`packages/storage/src/seed.ts`)
- `projects: [createPlantillaDemoProject()]` — draft **"Demo plantilla"** with MOD-GAB-01 × 1 + `plantillaChoices` (margin 1.35, laborFixed 1200).
- First open shows a ready quotation (CAT-06 spirit).

### Tests
- **New:** `packages/storage/src/seed.test.ts` — full seed shape, demo project, GAB price, cut rows (no hardware).
- **Domain:** GAB-only golden next to dual golden in `engine.test.ts`.
- **Excel:** fixture assert for `plantillaGabOnlyProject` cut rows.
- **Web:** seed demo project present; seed → Optimizer export path.
- Updated storage/App tests that assumed `projects: []`.

## GAB-only expected totals

| Field | Value |
|-------|------:|
| materialsCost | 285.24184 |
| edgeTotal | 136.126 |
| hardwareTotal | 203 |
| directCost | 624.36784 |
| laborModular | 0 |
| laborFixedCost | 1200 |
| marginFactor | 1.35 |
| salePrice | 2042.896584 |

## Intentional divergences (documented in fixtures + tests)

- `wastePercent = 0` (Excel has no merma column; F014 later)
- `laborModular = 0` (Excel only project-level fixed labor B17)
- IVA none (Excel sale is pre-tax)
- Edge resolved by material display name (Excel VLOOKUP)
- Excel Resumen dual-module total ≠ GAB-only total; GAB-only uses same B16/B17 rules on GAB BOM only
- laborFixedCost is **not** pro-rated by module count

## Out of scope (not done)

- F012 quote snapshot  
- F013 hardware list export  
- F014 waste UI  
- F015 duplicate  

## Verification

```text
pnpm test  → all packages green
  domain: 39, storage: 17, excel: 8, ui: 55, web: 24, desktop: 7
```

## Reviewer checklist

1. Seed completeness vs plantilla (codes, roles, groups).
2. Demo project in seed is acceptable product choice (not empty projects).
3. GAB-only numbers vs formula recompute.
4. Optimizer path still matches `modGab01CutRows.json`.
5. No F012–F015 leakage.
