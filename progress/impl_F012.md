# Handoff F012 — quote_snapshot

## Status
Implemented and self-verified. **Not marked done** — awaiting reviewer.

## Acceptance

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | Draft projects recalculate with current catalog | `engine.test.ts` — draft ignores stale snapshot; reopen after Arauco raise → higher salePrice |
| 2 | Closed projects keep prices from close moment | `engine.test.ts` Escenario B — quoted + expensive catalog still returns frozen salePrice |
| 3 | PRD Scenario B without Excel | Plantilla fixtures: draft → quoted → raise Arauco costPerM2 → closed frozen / draft higher |

## Design implemented

### Domain
- `QuotePriceSnapshot`: `capturedAt`, `breakdown`, optional unit price maps
- `Project.priceSnapshot?` (optional — `SCHEMA_VERSION` stays **1**)
- `isProjectClosed(status)` → quoted \| accepted
- `captureQuoteSnapshot(project, catalog)` → live calc + unit prices used
- `transitionProjectStatus(project, newStatus, catalog)`:
  - draft → closed: attach fresh snapshot
  - closed → draft: remove snapshot
  - quoted ↔ accepted: keep snapshot (re-freeze only if missing)
- `calcProjectBreakdown`: if closed **and** snapshot → return frozen; draft always live

### Shell / UI
- `apps/web/src/App.tsx`: create/update use `transitionProjectStatus` on status change
- `ProjectsScreen`: badge **Precios congelados** + title **Totales (congelados)** when closed with snapshot

## Tests
- Domain: +6 tests in `engine.test.ts` (Escenario B suite), +1 types construction
- Full suite: **all green** (`pnpm test`)

## Files touched
- `packages/domain/src/types.ts`
- `packages/domain/src/engine.ts`
- `packages/domain/src/index.ts`
- `packages/domain/src/engine.test.ts`
- `packages/domain/src/types.test.ts`
- `apps/web/src/App.tsx`
- `packages/ui/src/projects/ProjectsScreen.tsx`
- `packages/ui/src/projects/projects.css`
- `feature_list.json` (F012 → `in_progress`)
- `progress/current.md`

## Out of scope (not done)
- F013–F015
- schemaVersion bump
- Re-freeze on item edit while closed (only freezes on status close)

## Reviewer notes
- Verify Escenario B test name/comments match PRD §6.2
- Confirm shell does not bypass `transitionProjectStatus` when changing status
- Optional field: old JSON without `priceSnapshot` still loads
