# Handoff — F017 ui_layout_sidebar

**Status:** implemented, self-verified, **NOT marked done** (awaiting reviewer)  
**Date:** 2026-07-15  
**Feature:** F017 — UI layout sidebar + top bar (replaces horizontal tabs)

## Summary

Replaced horizontal tab navigation with `AppShell` (dark sidebar 240px + top bar 56px + content area) per `docs/design.md` §4.1 / §3.7.

## Acceptance checklist

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | Layout = left sidebar + content, not horizontal tabs | `AppShell` + `App.tsx` uses `AppShell`; no `app-nav__tab` |
| 2 | TRABAJO (Home, Cotizaciones, Muebles) + CONFIG (Materiales, Cantos, Herrajes, Grupos) with Lucide icons | `APP_NAV_SECTIONS` + icons §3.7 |
| 3 | Active item left border brand-400 | `.app-sidebar__item.is-active { border-left-color: var(--brand-400) }` |
| 4 | Viewport &lt;900px: sidebar collapses + hamburger | `@media (max-width: 899px)` + `.app-topbar__menu` |
| 5 | All previous screens still reachable | `navId` routes to all catalogs + modules + projects + home |
| 6 | `pnpm --filter @muebles/web test` green | 35 tests pass; `@muebles/ui` 68 tests pass |

## Files touched

### New
- `packages/ui/src/shell/AppShell.tsx` — shell component + nav model
- `packages/ui/src/shell/appShell.css` — layout tokens-only styles
- `packages/ui/src/shell/index.ts` — barrel
- `packages/ui/src/shell/appShell.test.ts` — F017 unit/source guards
- `progress/impl_F017.md` — this handoff

### Modified
- `packages/ui/src/index.ts` — export `AppShell`, `APP_NAV_SECTIONS`, types
- `packages/ui/src/index.test.ts` — export surface for AppShell
- `packages/ui/src/optionGroups/optionGroups.css` — `.price-preview-demo__hint` (removed inline hex in App)
- `apps/web/src/App.tsx` — AppShell wiring; Home placeholder; `navId` routing
- `apps/web/src/app.css` — removed tabs chrome; home card only
- `apps/web/src/designSystemShell.test.ts` — F016 token checks + F017 AppShell wiring
- `feature_list.json` — F017 → `in_progress`
- `progress/current.md` — session state

## Nav map

| Section | Label | `AppNavId` | Icon | Screen |
|---------|-------|------------|------|--------|
| TRABAJO | Home | `home` | `LayoutDashboard` | `HomePlaceholder` (“Próximamente”) |
| TRABAJO | Cotizaciones | `projects` | `FileText` | `ProjectsScreen` |
| TRABAJO | Muebles | `modules` | `Package` | `ModulesScreen` |
| CONFIG | Materiales | `materials` | `Layers` | `MaterialsCatalog` |
| CONFIG | Cantos | `edges` | `Minus` | `EdgesCatalog` |
| CONFIG | Herrajes | `hardware` | `Settings2` | `HardwareCatalog` |
| CONFIG | Grupos | `optionGroups` | `ToggleLeft` | `OptionGroupsScreen` (+ price demo) |

Default route: `home`.

## Verification run

```text
pnpm --filter @muebles/ui typecheck  → ok
pnpm --filter @muebles/web typecheck → ok
pnpm --filter @muebles/ui test       → 68 passed
pnpm --filter @muebles/web test      → 35 passed
```

## Notes for reviewer

- No React Testing Library / jsdom: layout verified via source+CSS guards (same pattern as F016).
- Mobile open state is JS (`is-open`); visibility of hamburger is CSS-only (`max-width: 899px`).
- Home is intentionally a placeholder until F023 dashboard.
- “Proyectos” tab label is now “Cotizaciones” in the sidebar (design §4.1).

## Out of scope / not done by implementer

- Do **not** mark F017 `done` until reviewer approves.
- Modal (F018), toasts (F019), dashboard (F023) not started.
