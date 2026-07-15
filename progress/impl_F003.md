# Handoff — F003 domain_engine

**Status:** implemented + tests green — **not marked done** (awaiting reviewer)  
**Date:** 2026-07-15  
**Package:** `packages/domain`

## API surface

| Export | Role |
|--------|------|
| `resolveBom(module, optionChoices, catalog)` | Template + choices → `ResolvedBom` |
| `calcBoardLineMetrics(part)` | `areaM2`, `edgeMl` |
| `calcBoardLineCost(part, catalog, qtyMul?)` | Board line costs |
| `calcHardwareLineCost(line, catalog, qtyMul?)` | Hardware line cost |
| `calcLineCost(line, catalog, qtyMul?)` | Union dispatcher |
| `calcProjectBreakdown(project, catalog)` | Full `QuoteBreakdown` (modules live in `catalog.modules`) |
| `validateBoardPart` / `validateHardwareLine` / `validateModule` / `validateCatalogEntityCodes` | VAL helpers |

Errors: `ResolutionError` (missing choice / missing catalog row), `ValidationError` (dims, inactive, empty codes). Context includes `moduleCode`, `partId`, `field`, etc.

## Formula notes (PRD §13)

```
areaM2 = qty * L * W / 1e6
edgeMl = qty * ((L1+L2)*L + (W1+W2)*W) / 1000
boardCost = areaM2 * costPerM2 * (1 + (wastePercent ?? 0)/100)
edgeCost = edgeMl * costPerMl   // 0 if no edges enabled
hardwareCost = qty * costPerUnit
directCost = materials + edges + hardware
laborModular = Σ item.qty * (module.baseLaborCost ?? 0)
salePrice = directCost * marginFactor + laborModular + laborFixedCost
```

Project item quantity multiplies part/hardware quantities inside `calcProjectBreakdown`.

## Edge band strategy (§13.5)

1. If any edge flag enabled and `optionChoices.EDGE` is set → use that edge band id.  
2. Else material-linked default: first **active** `EdgeBand` with `name === material.name` (Excel VLOOKUP-by-material-name parity).  
3. Else `ResolutionError` (edges enabled, no band).  
4. No edges enabled → `edgeBandId` omitted, `edgeCost = 0`.

## Golden expected values

| Field | Value | Source |
|-------|------:|--------|
| materialsCost | 792.5836 | Recomputed from Explosión rows + cost/m² Config A5:B7 |
| edgeTotal | 412.238 | Recomputed ML × cost/ml Config E5:F7 |
| hardwareTotal | 953 | Config A13:B18 × qtys |
| directCost | 2157.8216 | sum of above |
| laborModular | 0 | Excel has no per-module labor |
| laborFixedCost | 1200 | Resumen B17 |
| marginFactor | 1.35 | Resumen B16 |
| salePrice | 4113.05916 | `(direct * 1.35) + 1200` (Resumen B18 formula) |

**Note:** workbook `data_only` cache was empty; totals recomputed with same formulas as Excel, not read as cached cells.

### BOM sample cells

- Config materials: ARAUCO 160, MADERADO 290, MDF 75  
- Config edges: 12 / 25 / 0  
- Hardware: bisagra 35, jaladera 45, pata 15, tornillo 0.5, corredera 120, soporte 2  
- MOD-GAB-01 parts rows Explosión 5–17; MOD-CAJ-01 rows 19–30  

## Intentional divergences

- **wastePercent = 0** (Excel has no merma; F014 later).  
- **laborModular = 0** for golden (Excel only fixed labor). App still supports `baseLaborCost`.  
- **No IVA**.  
- **Edge as separate entity** linked by material name (not baked into board cost row).  
- Fixed hardware uses `hardwareId` + `optionRole: 'FIXED'` (no choice required).

## VAL coverage

| ID | Engine behavior |
|----|-----------------|
| VAL-01 | `lengthMm`/`widthMm` > 0 |
| VAL-02 | material resolved via choices |
| VAL-03 | hardware qty > 0 + exists |
| VAL-04 | typed edges; must be 4 sides |
| VAL-05 | **deferred to F004** (export empty cut list) |
| VAL-06 | inactive material/edge/hw → ValidationError |
| VAL-07 | empty codes/names on module/catalog |

## Tests run

```
pnpm --filter @muebles/domain test   # 24/24 pass
pnpm --filter @muebles/domain typecheck
```

## Residual risks

- Material-linked edge by **display name** is fragile if catalog renames; prefer explicit `EDGE` choice in production UI.  
- Optional (non-required) option groups still error if choice missing when a part uses that role — by design for cost resolution.  
- VAL-05 not in engine.  
- Golden uses stable test UUIDs/ids, not production seed UUIDs (F011 will own seed).

## Files touched

- `packages/domain/src/engine.ts` (new)
- `packages/domain/src/engine.test.ts` (new)
- `packages/domain/src/__fixtures__/plantillaDemo.ts` (new)
- `packages/domain/src/index.ts` (exports)
- `feature_list.json` (F003 → in_progress)
- `progress/current.md`
