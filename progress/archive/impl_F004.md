# Handoff F004 — excel_optimizer_export

**Status:** implementation complete, tests green — **not marked `done`** (awaiting reviewer).  
**Feature status in feature_list.json:** `in_progress`

## What was implemented

### Domain — `generateCutRows` (architecture + EXP-02/04/05)

- **File:** `packages/domain/src/engine.ts`
- **Export:** `packages/domain/src/index.ts`
- **Signature:** `generateCutRows(project, catalog): ProductionCutRow[]`
- Resolves each project item BOM via `resolveBom`
- Board parts only (hardware never emitted — EXP-05)
- `quantity = part.quantity × item.quantity` (EXP-02)
- Material name from catalog (`material.name`)
- Edges → `L1/L2/W1/W2` as `0 | 1`
- Sort: module code → part code → description → part id (EXP-04)
- VAL-05: empty cut list → `ValidationError('no hay piezas de tablero para exportar')`

### Excel — `optimizerExport`

- **File:** `packages/excel/src/optimizerExport.ts`
- **Signature:** `optimizerExport(rows): Promise<Buffer>`
- exceljs workbook, sheet name `Plantilla`
- Row 1: Material (A1:E1) + Cubrecanto (F1:J1) merges
- Row 2 headers A–J: Cantidad, Largo, Ancho, Descripcion, Materia Prima, veta, Largo 1, Largo 2, Ancho 1, Ancho 2
- Data from row 3; maps ProductionCutRow L1…W2 → Largo 1…Ancho 2
- Empty rows throw VAL-05
- Dep: `@muebles/domain` (types + `ValidationError`)

### Fixtures / smoke

- `packages/excel/src/__fixtures__/modGab01CutRows.json` — expected MOD-GAB-01 × 1 rows
- `packages/excel/src/__fixtures__/smokeExport.mjs` → `/tmp/optimizer_smoke.xlsx`
- Domain plantilla fixtures also exported as `@muebles/domain/fixtures` for package tests

## Acceptance mapping

| Criterion | Evidence |
|-----------|----------|
| Columns A–J order | `optimizerExport.test.ts` headers assertion |
| Hardware absent (EXP-05) | `generateCutRows` tests + fixture length 8 (board only) |
| qty × project (EXP-02) | domain + excel tests with qty 2/3 |
| Deterministic order (EXP-04) | sort test on GAB + full project CAJ before GAB |
| Fixture MOD-GAB-01 × 1 | JSON equality + xlsx cell values |
| Opens without error | exceljs round-trip load; smoke file written |

## Verification run

```text
pnpm --filter @muebles/domain test  → 29 passed
pnpm --filter @muebles/excel test   → 7 passed
pnpm test                           → all workspaces green
pnpm --filter @muebles/{domain,excel} typecheck → ok
node packages/excel/src/__fixtures__/smokeExport.mjs → /tmp/optimizer_smoke.xlsx
```

## Files touched

- `feature_list.json` — F004 `in_progress`
- `progress/current.md`
- `packages/domain/src/engine.ts`
- `packages/domain/src/engine.test.ts`
- `packages/domain/src/index.ts`
- `packages/domain/package.json` — export `./fixtures`
- `packages/excel/package.json` — deps `@muebles/domain`, `@types/node`
- `packages/excel/src/optimizerExport.ts` (new)
- `packages/excel/src/optimizerExport.test.ts` (new)
- `packages/excel/src/index.ts`
- `packages/excel/src/index.test.ts`
- `packages/excel/src/__fixtures__/modGab01CutRows.json` (new)
- `packages/excel/src/__fixtures__/smokeExport.mjs` (new)
- `packages/excel/vitest.config.ts` — aliases for workspace packages
- `tsconfig.base.json` — path `@muebles/domain/fixtures`

## Reviewer notes

- Do **not** mark `done` until review APPROVED.
- Excel package still does not import engine calculation logic in production code; tests import `generateCutRows` for end-to-end fixture.
- `exportName` / name-vs-code (EXP-03 configurable) not implemented — default `material.name` only (PRD default).
