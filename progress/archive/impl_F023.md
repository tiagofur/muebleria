# F023 — ui_dashboard (implementer handoff)

**Status:** implemented, ready for reviewer  
**Feature list:** leave `in_progress` (do not mark `done`)  
**Date:** 2026-07-15

## Summary

App home is a real Dashboard in `@muebles/ui`. Shell computes stats/recent list from workspace + domain sale-price estimates and passes presentation props. `HomePlaceholder` removed; default nav remains `'home'`.

## Acceptance matrix

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | App opens on Dashboard, not Materials | `App.tsx`: `useState<AppNavId>('home')` + `navId === 'home' ? <Dashboard …/>` |
| 2 | 4 stat cards correct from workspace | Shell `dashboardStats` via `countActiveProjects` (draft+quoted), `sumMonthlyQuotedTotal`, `countModules`, `countActiveMaterials` |
| 3 | Recent = last 5 by `updatedAt` desc | `selectRecentProjects(projects, 5)` + tests |
| 4 | Click recent → project detail | `onOpenProject` → `projectsOpenId` + nav `projects`; `ProjectsScreen.openProjectId` effect |
| 5 | Quick actions navigate / create | `onNewProject` / `onNewModule` increment `requestCreateKey` + nav; screens open create modal |
| 6 | Reactive to workspace | Props from parent `useMemo` on `projects` / `materials` / `modules` / `projectEstimates` |
| 7 | Mobile stats 2 columns | `dashboard.css`: `repeat(2, 1fr)` default; `repeat(4, 1fr)` from 900px |

## Monthly total choice

**Sum sale prices for `quoted` + `accepted` projects whose `updatedAt` year-month (ISO prefix / UTC) matches the current UTC calendar month.**

- Sale amounts from existing `projectEstimates` (priceSnapshot if present, else `calcProjectBreakdown` in shell).
- UI never runs cost formulas; helper only sums precomputed numbers.
- Draft projects excluded even if updated this month.

## Prop contracts (open-from-outside)

### `ProjectsScreen`
- `openProjectId?: string | null` — open detail when set and id exists
- `requestCreateKey?: number` — increment to open create meta modal (0 = no-op)

### `ModulesScreen`
- `requestCreateKey?: number` — increment to open create modal (0 = no-op)

## Files touched

### New
- `packages/ui/src/dashboard/Dashboard.tsx`
- `packages/ui/src/dashboard/dashboard.css`
- `packages/ui/src/dashboard/dashboardHelpers.ts`
- `packages/ui/src/dashboard/dashboardHelpers.test.ts`
- `packages/ui/src/dashboard/Dashboard.test.tsx`
- `packages/ui/src/dashboard/index.ts`
- `progress/impl_F023.md`

### Updated
- `packages/ui/src/index.ts` — export Dashboard + helpers
- `packages/ui/src/index.test.ts` — F023 surface
- `packages/ui/src/projects/ProjectsScreen.tsx` — open-from-outside
- `packages/ui/src/projects/ProjectsScreen.test.tsx` — handoff tests
- `packages/ui/src/modules/ModulesScreen.tsx` — requestCreateKey
- `packages/ui/src/modules/ModulesScreen.test.tsx` — handoff test
- `apps/web/src/App.tsx` — Dashboard wiring, remove HomePlaceholder
- `apps/web/src/app.css` — remove home-placeholder styles
- `apps/web/src/designSystemShell.test.ts` — F023 contracts
- `progress/current.md`

## Design notes

- Tokens only (`docs/design.md` §3); cards/buttons §5; Lucide `strokeWidth={1.5}`
- Spanish labels; English identifiers
- `prefers-reduced-motion` on card hover transitions
- No design.md §6.1 — implemented from feature_list + §4–5 patterns

## Verification

```bash
pnpm --filter @muebles/ui test
pnpm --filter @muebles/ui typecheck
pnpm --filter @muebles/web test
pnpm --filter @muebles/web typecheck
```

Run the above before review approval. Implementer session had no shell runner in agent tools; static wiring matches tests added above.

## Out of scope

- Slice E Login
- Marking F023 `done` (reviewer)
