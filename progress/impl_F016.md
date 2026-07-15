# Handoff F016 — ui_design_system

**Status:** implemented, tests green — awaiting reviewer  
**Feature:** F016 — UI design system: tokens, reset, Inter, Lucide  
**Do not mark `done` without reviewer approval**

## Acceptance

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | `packages/ui/src/design-system/tokens.css` with `--brand-*`, `--surface-*`, `--text-*`, `--shadow-*`, `--space-*`, `--radius-*`, `--duration-*`, `--ease-*` | File created from `docs/design.md` §3.1–3.6; `designSystem.test.ts` asserts families + spot tokens |
| 2 | `packages/ui/src/design-system/reset.css` imported globally | File created; `apps/web/src/main.tsx` imports tokens then reset before App |
| 3 | Inter from Google Fonts in `apps/web/index.html` | preconnect + Inter 400/500/600/700 stylesheet links |
| 4 | `lucide-react` in `packages/ui/package.json` | dependency `lucide-react`; no icon usage yet (F017+) |
| 5 | No visual regression of app behavior; all tests green | `./init.sh` green (domain 60, ui 59, excel 14, storage 17, web 33, desktop 7); vite build OK |
| 6 | Generic colors (`#1a73e8`, `#f0f2f5`, `system-ui`) removed from `app.css`; use tokens | `app.css` uses `var(--brand-500)`, surfaces, spacing; `designSystemShell.test.ts` guards |

## Implementation

### Design system (`packages/ui/src/design-system/`)

- `tokens.css` — full token set (typography, brand, surfaces, text, semantic, borders, shadows, spacing, radius, motion)
- `reset.css` — modern minimal reset; body uses token fallbacks; reduced-motion + focus-visible
- Package exports:
  - `@muebles/ui/design-system/tokens.css`
  - `@muebles/ui/design-system/reset.css`

### Web shell

- `index.html` — Google Fonts Inter
- `main.tsx` — global CSS order: tokens → reset → App → `app.css`
- `app.css` — shell chrome only; token-based nav tabs (keep tabs for F016; sidebar is F017)
- Vite/Vitest aliases: exact `@muebles/ui` + `@muebles/ui/design-system` subpath; CSS mock uses full-id regex

### Token migration (no layout redesign)

- `catalogs.css`, `modules.css`, `projects.css`, `optionGroups.css` — hardcoded greys/blues swapped to tokens
- Light polish: `box-shadow: var(--shadow-sm|xs)` on cards/tables; `transition: var(--transition-colors)` on buttons/tabs/inputs

## Files touched

- `packages/ui/src/design-system/tokens.css` — new
- `packages/ui/src/design-system/reset.css` — new
- `packages/ui/src/design-system/designSystem.test.ts` — new
- `packages/ui/package.json` — lucide-react + CSS exports
- `packages/ui/src/catalogs/catalogs.css` — tokens
- `packages/ui/src/modules/modules.css` — tokens
- `packages/ui/src/projects/projects.css` — tokens
- `packages/ui/src/optionGroups/optionGroups.css` — tokens
- `apps/web/index.html` — Inter
- `apps/web/src/main.tsx` — global design-system imports
- `apps/web/src/app.css` — tokens only
- `apps/web/src/App.tsx` — removed local `app.css` import (moved to main)
- `apps/web/src/designSystemShell.test.ts` — new
- `apps/web/vite.config.ts` / `vitest.config.ts` — alias fixes
- `feature_list.json` — F016 `in_progress`
- `progress/current.md` — session state

## Tests (all green via `./init.sh`)

| Package | Result |
|---------|--------|
| domain | 60/60 |
| ui | 59/59 (+3 design system) |
| excel | 14/14 |
| storage | 17/17 |
| web | 33/33 (+3 shell design system) |
| desktop | 7/7 |
| typecheck + vite build | OK |

## Reviewer notes

- Lucide is installed only; icons land in F017 (sidebar).
- A few semantic borders still use ad-hoc `hsl(...)` tints where no dedicated border token exists (info/success/danger panels) — fills still use semantic surface tokens.
- Reset zeroes list styles globally; lists that need bullets re-declare `list-style: disc` (export issues, missing options).
- Navigation remains horizontal tabs until F017.

## Out of scope (not done)

- F017 sidebar layout
- F018+ modals, toasts, empty states, iconography in UI
- Dark mode
- JetBrains Mono font load (token defined, not linked)
