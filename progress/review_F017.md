# Review — feature F017

**Veredicto:** APPROVED  
**Feature:** F017 — ui_layout_sidebar (AppShell sidebar + top bar, replaces tabs)  
**Reviewer:** reviewer + closer agent  
**Date:** 2026-07-15  
**Handoff:** `progress/impl_F017.md`  
**Design:** `docs/design.md` §4.1 + §3.7

## Acceptance criteria → evidence

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| 1 | Layout = left sidebar + content area, not horizontal tabs | PASS | `packages/ui/src/shell/AppShell.tsx`: `app-layout` / `app-sidebar` / `app-layout__main` / `app-content`. `apps/web/src/App.tsx` wraps screens in `AppShell`; no `app-nav__tab` / `CatalogTab` in source. Guards: `appShell.test.ts` L87–96, `designSystemShell.test.ts` L38–48 |
| 2 | Sidebar sections TRABAJO + CONFIG with Lucide icons | PASS | `APP_NAV_SECTIONS`: TRABAJO = Home / Cotizaciones / Muebles; CONFIG = Materiales / Cantos / Herrajes / Grupos. Icons §3.7: `LayoutDashboard`, `FileText`, `Package`, `Layers`, `Minus`, `Settings2`, `ToggleLeft`. Tests: `appShell.test.ts` L30–77 |
| 3 | Active item left border brand visible | PASS | `.app-sidebar__item.is-active { border-left-color: var(--brand-400) }` in `appShell.css` L111–116; active class wired in `AppShell.tsx` L145–148 |
| 4 | Viewport &lt;900px: sidebar collapses + hamburger | PASS | `@media (max-width: 899px)`: sidebar `translateX(-100%)`, `.is-open` → `translateX(0)`, `.app-topbar__menu { display: inline-flex }`, backdrop. Hamburger `Menu`/`X` in top bar (`AppShell.tsx` L171–184). Guards: `appShell.test.ts` L121–133 |
| 5 | Navigation between sections works as before | PASS | All prior screens still routed via `navId`: materials, edges, hardware, optionGroups (+ price demo), modules, projects; plus `home` placeholder. `designSystemShell.test.ts` L51–70 |
| 6 | `pnpm --filter @muebles/web test` green | PASS | web 35/35; monorepo `./init.sh` exit 0 (domain 60, excel 14, storage 17, ui 68, web 35, desktop 7) |

### Design §4.1 / §3.7 spot-check

| Spec | Result | Notes |
|------|--------|-------|
| Sidebar 240px, `--surface-sidebar`, inverse text | PASS | `width: 240px`; `background: var(--surface-sidebar)`; `color: var(--text-inverse)` |
| Top bar 56px, `--surface-card` + `--shadow-sm` | PASS | `height: 56px`; card surface + `box-shadow: var(--shadow-sm)` |
| Content `--surface-app`, padding `--space-6` | PASS | `.app-content` |
| Active left border `--brand-400` | PASS | see acceptance #3 |
| Lucide only, `strokeWidth={1.5}`, nav size 16 | PASS | icons + hamburger 20px (toolbar-ish); no non-Lucide UI icons |
| Collapse &lt;900px | PASS | 899px media query |
| No prototype hex in shell CSS | PASS | `appShell.test.ts` L136–140; `app.css` home card uses tokens only |

## Architecture boundaries (C3)

| Check | Result |
|-------|--------|
| domain pure | PASS — no domain changes |
| UI no cost formulas / no fs / no xlsx | PASS — shell is presentation + controlled nav ids only |
| excel / storage untouched | PASS |
| Apps thin shell | PASS — `App.tsx` wires `AppShell` + screens only |
| No debug `console.log` | PASS in shell |

## Conventions

- Shell under `packages/ui/src/shell/` with colocated CSS + tests — PASS  
- Exported from `@muebles/ui` (`AppShell`, `APP_NAV_SECTIONS`, types) — PASS  
- Source/CSS guards (no RTL/jsdom) consistent with F016 pattern — PASS  
- Tokens only for layout chrome — PASS  

## Diseño UI/UX (fase 4)

- D1: [x] Variables CSS del design system (no hardcoded palette in shell)
- D2: [x] Patrón layout general §4.1 (sidebar + content, no tabs)
- D3: [x] Modales N/A (F018)
- D4: [x] Toasts N/A (F019)
- D5: [x] Solo Lucide con `strokeWidth={1.5}`
- D6: [x] Slide transition under `prefers-reduced-motion: no-preference`

## Checkpoints

- C1: [x] Harness completo; `./init.sh` exit 0
- C2: [x] Una sola `in_progress` (F017) at review time; session documented; post-close → done + idle
- C3: [x] Boundaries respetados
- C4: [x] Tests monorepo verdes (ui 68, web 35, domain 60, …)
- C5: [x] Closeout: `history.md` entry, `feature_list` F017=`done`, `current.md` idle → F018, `close_F017.md`

## Residual notes (non-blocking — no CHANGES_REQUESTED)

1. ASCII mockup §4.1 shows brand across the top bar; implementation puts brand mark in the sidebar (Linear-style). Acceptance bullets and token rules still satisfied.
2. Top-bar search/user affordances from the mockup are out of scope (not in F017 acceptance).
3. No RTL/jsdom interaction tests for hamburger open/close — verified via source + CSS guards (same approach as F016).
4. `apps/web/dist` may still contain pre-F017 tab chrome until rebuild; source of truth is `apps/web/src`.
5. Home is a “Próximamente” placeholder until F023 dashboard (documented in handoff).

## Verification

| Level | Result |
|-------|--------|
| Nivel 2 ui | PASS — 68/68 (incl. 8 AppShell guards) |
| Nivel 2 web | PASS — 35/35 |
| Nivel 1 domain / excel / storage / desktop | PASS — 60 / 14 / 17 / 7 |
| Nivel 3 monorepo | PASS — `./init.sh` exit 0 |

## Commands executed (reviewer)

```text
./init.sh
  # exit 0 — domain 60, excel 14, storage 17, ui 68, web 35, desktop 7
```

## Verdict rationale

All six acceptance criteria pass against source, design §4.1/§3.7, architecture boundaries, and green monorepo tests. No required changes.
