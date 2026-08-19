# Review — feature F023

**Veredicto:** APPROVED  
**Feature:** F023 — ui_dashboard  
**Reviewer:** reviewer agent  
**Date:** 2026-07-15  
**Handoff:** `progress/impl_F023.md`  
**Design:** `docs/design.md` §3 tokens, §3.6 reduced-motion, §3.7 Lucide, §5.1 buttons / §5.2 badges / §5.3 cards  
**Note:** `docs/design.md` has no §6.1 (feature_list reference is stale); implementation follows feature acceptance + §3–5 patterns.

## Acceptance criteria → evidence

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| 1 | App opens on Dashboard, not Materials | PASS | `apps/web/src/App.tsx` L305: `useState<AppNavId>('home')`; L930–937 mounts `<Dashboard …/>` when `navId === 'home'`. `HomePlaceholder` removed (`designSystemShell.test.ts` L47–49 asserts absence + default home). |
| 2 | 4 stat cards correct from workspace | PASS | Shell `dashboardStats` useMemo L399–407: `countActiveProjects` (draft+quoted), `sumMonthlyQuotedTotal` (quoted+accepted, UTC month, precomputed estimates), `countModules`, `countActiveMaterials`. UI renders four cards with labels/values (`Dashboard.tsx` L106–137). Helpers unit-tested (`dashboardHelpers.test.ts`). RTL: “renders four stat cards with correct numbers”. |
| 3 | Recent = last 5 by `updatedAt` desc | PASS | `selectRecentProjects(projects, 5)` L409–418; pure sort desc + slice (`dashboardHelpers.ts` L39–51). Tests cover limit default 5 and ordering. |
| 4 | Click recent → project detail | PASS | `onOpenProject` → `setProjectsOpenId` + `setNavId('projects')` (L420–423). `ProjectsScreen` effect on `openProjectId` (L208–218). RTL Dashboard click + ProjectsScreen “opens detail from openProjectId prop”. Web contract test L77–87. |
| 5 | Quick actions navigate / create | PASS | `onNewProject` increments `projectsCreateKey` + nav projects; `onNewModule` increments `modulesCreateKey` + nav modules (L425–434). Screens open create modal on `requestCreateKey` (ProjectsScreen L220–228; ModulesScreen L219–226). RTL + handoff tests. |
| 6 | Reactive to workspace | PASS | Stats/recent derived in parent `useMemo` deps on `projects`, `projectEstimates`, `modules`, `materials`, `customers`. Controlled props only — re-render when workspace state changes. No local copy of catalog in Dashboard. |
| 7 | Mobile stats 2 columns | PASS | `dashboard.css` L51–64: `repeat(2, 1fr)` default; `repeat(4, 1fr)` from `min-width: 900px`. CSS contract test in `Dashboard.test.tsx` L108–117. |

### Monthly total (implementer choice)

Documented and consistent: sum sale prices for `quoted` + `accepted` whose `updatedAt` year-month matches current UTC month; amounts from shell `projectEstimates` (priceSnapshot / `calcProjectBreakdown` in shell only). Covered by `sumMonthlyQuotedTotal` unit test (350.5 case).

## Design spot-check

| Spec | Result | Notes |
|------|--------|-------|
| Tokens only (no palette hardcode) | PASS | `dashboard.css` uses `var(--space-*)`, `var(--text-*)`, `var(--brand-*)`, `var(--surface-*)`, `var(--shadow-*)`, `var(--border-*)`, `var(--radius-*)`, durations/eases. No `#hex` / `rgb` / `hsl` literals. Fixed layout sizes (`max-width: 72rem`, icon box `2rem`) are dimensional, not palette. |
| Lucide + strokeWidth 1.5 | PASS | `LayoutDashboard`, `Plus`, `FileText`, `DollarSign`, `Package`, `Layers` all `strokeWidth={1.5}` (`Dashboard.tsx`). |
| Buttons §5.1 | PASS | One primary “Nueva cotización” (`btn btn--primary`); secondary “Nuevo mueble” (`btn`). Project BEM matches existing catalogs. |
| Status badges §5.2 | PASS | Reuses `projectStatusBadgeClass` / `status-badge` from projects surface. |
| Cards for rich items §5.3 | PASS | Recent quotes as clickable mini-cards (not table). |
| `prefers-reduced-motion` | PASS | Hover transitions on stats + recent cards wrapped in `@media (prefers-reduced-motion: no-preference)` (L78–89, L170–183). |
| focus-visible | PASS | Recent cards use `--shadow-focus` + brand border (L185–189). |
| §4.5 EmptyState full pattern | N/A / soft | Section empty is dashed message (no 48px icon CTA). Acceptable for sub-section empty; acceptance does not require catalog-level EmptyState. |

## Architecture boundaries (C3)

| Check | Result |
|-------|--------|
| `packages/ui` no cost formulas | PASS | `dashboardHelpers` only counts, sorts, sums precomputed numbers, formats money. No `calcProjectBreakdown` / BOM / m². |
| Domain engine stays in shell | PASS | `projectEstimates` in `App.tsx` L380–391 via domain; Dashboard receives numbers only. |
| No fs / xlsx / electron in UI | PASS | Dashboard surface is React presentation + pure helpers. |
| Apps as thin shell | PASS | Wiring + open-from-outside keys in `App.tsx`; presentation in `@muebles/ui`. |
| No debug `console.log` | PASS | Not present in dashboard or App touch set. |

## Diseño UI/UX (fase 4)

- D1: [x] Variables CSS del design system (no hardcoded palette)
- D2: [x] Home dashboard pattern from feature acceptance (no design §6.1 exists)
- D3: [x] Modales N/A on Dashboard itself; create handoff reuses existing Projects/Modules Modal (F018)
- D4: [x] Toasts N/A for Dashboard (F019 wiring untouched)
- D5: [x] Solo Lucide con `strokeWidth={1.5}`
- D6: [x] Animaciones con `prefers-reduced-motion`

## Checkpoints

- C1: [x] Harness files present (`AGENTS.md`, `init.sh`, docs, skills, `feature_list.json`, `progress/current.md`, `CHECKPOINTS.md`)
- C2: [x] Single `in_progress` (F023); `progress/current.md` describes active session
- C3: [x] Architecture boundaries respected for F023 touch set
- C4: [x] Feature-level tests present at correct packages (ui helpers + component RTL; web shell contract; open-from-outside on projects/modules). See Verification.
- C5: [ ] Not closed by reviewer — feature remains `in_progress` until closer archives; no session history write from this role

## Verification

| Command / check | Result |
|-----------------|--------|
| Static test surface | PASS — new: `dashboardHelpers.test.ts`, `Dashboard.test.tsx`; updated: `index.test.ts` (F023 export), `ProjectsScreen.test.tsx`, `ModulesScreen.test.tsx`, `designSystemShell.test.ts` (app.css post-move + F023 wiring) |
| `apps/web/src/designSystemShell.test.ts` app.css contract | PASS (source) — allows comment-only `app.css` after home styles moved to UI; optional rules must use `var(--` |
| Orchestrator prior run (`progress/current.md`) | Reported ui 165 / web 39 + typecheck OK |
| Shell runner in this reviewer session | **Unavailable** (no terminal tool). Verdict relies on static evidence + orchestrator green claim + test code review. Closer should re-run `./init.sh` before marking `done` if environment allows. |

## Files reviewed

- `packages/ui/src/dashboard/*` (Dashboard, helpers, CSS, tests, index)
- `packages/ui/src/index.ts` / `index.test.ts`
- `packages/ui/src/projects/ProjectsScreen.tsx` + test (openProjectId / requestCreateKey)
- `packages/ui/src/modules/ModulesScreen.tsx` + test (requestCreateKey)
- `apps/web/src/App.tsx` (home wiring)
- `apps/web/src/app.css`, `designSystemShell.test.ts`

## Non-blocking suggestions (do not block APPROVED)

1. Optional: promote dashboard recent empty state to shared `EmptyState` (§4.5) for visual consistency with catalogs.
2. Feature_list still references `docs/design.md §6.1` — consider updating references in a docs hygiene pass (out of F023 scope).

## Cambios requeridos

None.
