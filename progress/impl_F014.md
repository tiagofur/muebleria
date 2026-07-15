# Handoff F014 — waste_percent

**Status:** implemented, tests green — awaiting reviewer  
**Feature:** F014 — Merma % por material  
**Do not mark `done` without reviewer approval**

## Acceptance

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | Campo editable en UI de catálogo de materiales | `MaterialsCatalog`: form field Merma (%) (`mat-waste`), draft default `0`, table column Merma (%), `validateNonNegativeNumber(..., 'Merma')` |
| 2 | `boardCost = areaM2 × costPerM2 × (1 + waste/100)` | `packages/domain/src/engine.ts` `calcBoardLineCost`: `waste = material.wastePercent ?? 0` then formula |
| 3 | Test unitario con waste 10% reproducible | `engine.test.ts`: part 1000×1000, costPerM2 100, waste 10 → boardCost 110 |

## What was already in place (pre-audit)

- Domain type `MaterialBoard.wastePercent?`
- Engine applies waste in `calcBoardLineCost`
- UI form + non-negative validation + draft default 0
- Web shell `createMaterial` / `updateMaterial` map `wastePercent`
- Seed/golden fixtures use `wastePercent: 0` (Excel has no merma)

## Gaps closed this session

1. **Table display** — Materials catalog columns now include Merma (%) (`wastePercent ?? 0`).
2. **Domain tests** — strengthened 10% case (asserts area + formula) + new default-omit → 0 test.
3. **UI validator test** — explicit Merma negative rejection via shared helper.

## Files touched

- `packages/ui/src/catalogs/MaterialsCatalog.tsx` — Merma column
- `packages/ui/src/catalogs/catalogHelpers.test.ts` — Merma validation
- `packages/domain/src/engine.test.ts` — waste 10% + default 0
- `packages/domain/src/__fixtures__/plantillaDemo.ts` — comment only
- `feature_list.json` — F014 `in_progress`
- `progress/current.md` — session state

## Tests (all green)

| Package | Result |
|---------|--------|
| domain | 53/53 |
| ui | 56/56 |
| excel | 14/14 |
| storage | 17/17 |
| web | 30/30 |
| desktop | 7/7 |
| typecheck | all packages OK |

Golden plantilla tests remain waste 0 → unchanged totals.

## Reviewer notes

- Domain does not throw on negative waste (catalog ABM UI rejects; engine trusts stored catalog). Optional field defaults with `?? 0`.
- MVP default 0% kept for seed/fixtures so plantilla golden stays stable.
- No web-specific RTL for the Merma input (controlled form pattern matches other catalog fields).

## Out of scope (not done)

- F015 duplicate module/project
- Domain-level ValidationError for negative wastePercent
- Propagating waste into quote snapshot fields beyond live boardCost recompute
