# F101 — Page Chrome, Toolbar & Action Hierarchy: scope

## Objective

Turn the documented page skeleton into a reusable UI contract: one shared page header, one optional toolbar, and an explicit hierarchy for primary, secondary, overflow, and contextual actions. Validate the contract with one representative migration in each work area: Ventas, Ingeniería, and Producción.

## Why now

F100 made the active work area perceptible across the shared shell. The audits identify the next break inside the canvas: `pageHeader.css` is presently a set of CSS aliases rather than an enforceable component contract, while headers and toolbars are assembled differently across screens. This feature supplies the common frame before broader screen migration; otherwise each area will keep inventing where actions and filters belong.

## In scope

1. **Design contract.** Update `docs/design.md` §4.1a and the UI DoD with a normative page-chrome anatomy: title/icon/subtitle, optional toolbar directly below the header, and action slots.
2. **Shared primitives.** Create or complete reusable `PageHeader` and `PageToolbar` primitives in `packages/ui/src/common/`, with semantic slots for title, subtitle, primary action, secondary actions, overflow actions, search, filters, tabs, and contextual controls. CSS must consume F100 area-context roles and existing tokens only.
3. **Action hierarchy.** Encode a single action grammar:
   - one visible primary action per page context;
   - secondary actions remain visible only when frequent and non-destructive;
   - low-frequency or destructive non-primary actions move into an accessible overflow/menu pattern;
   - a workspace has its primary action in exactly one level (chrome or active tab), never both;
   - unavailable actions are hidden when permission/context makes them impossible, and disabled only when the action is relevant but blocked with explanatory affordance.
4. **Representative migrations.** Migrate exactly one screen per area to prove the contract:
   - **Ventas:** `packages/ui/src/projects/components/ProjectsListView.tsx` (Cotizaciones).
   - **Ingeniería:** `packages/ui/src/engineering/EngineeringScreen.tsx` (Ingeniería).
   - **Producción:** `packages/ui/src/production/ProductionOrderViewsPanel.tsx` (Órdenes / production hub).
   Each migration places title and action hierarchy in `PageHeader` and places search/filter/tab controls in `PageToolbar` when applicable, without changing workflow behavior.
5. **Proof.** Add focused UI tests for primitive slot semantics, hierarchy constraints, overflow accessibility, and each representative screen's header/toolbar/action placement. Add screenshot or equivalent documented responsive evidence at 390px, 768px, and 1280px for the three migrated screens.

## Acceptance criteria

1. `docs/design.md` documents the shared `PageHeader` + optional `PageToolbar` anatomy, named action slots, the one-primary rule, overflow rules, workspace ownership rule, and hide-versus-disable decision; its requirements align with F100 tonal-area context and do not assign CTA or semantic-state meaning to an area color.
2. `packages/ui/src/common/PageHeader.tsx` and `packages/ui/src/common/PageToolbar.tsx` (or documented equivalent exports) provide typed, accessible primitives used without per-screen header markup duplication; `common/pageHeader.css` contains their shared layout/state treatment and uses only existing semantic tokens.
3. Primary, secondary, overflow, disabled, keyboard-focus, compact/touch, and reduced-motion states are defined for the introduced chrome controls. Icon-only controls expose accessible names; overflow is keyboard operable and preserves focus behavior.
4. Cotizaciones, Ingeniería, and Órdenes each use the same shared header/toolbar contract, retain their F100 area atmosphere, expose no more than one visible page-level primary action, and keep search, filters, and tabs immediately beneath the header when those controls exist.
5. The migrations preserve existing routing, RBAC, domain behavior, request/persistence behavior, and current screen-specific body content. Their tests assert visible action labels/roles and the placement contract rather than styling implementation details.
6. Focused UI tests, `pnpm test`, `pnpm typecheck`, `./init.sh`, the Impeccable detector, and responsive evidence at 390px / 768px / 1280px are green or explicitly recorded as environment-blocked with no invented visual approval.

## References

- `docs/design.md` §2.1, §3.2.1, §3.6.1, §4.0, §4.1a–b, §8
- `progress/explore_ui_design_system_audit.md` — primitives/adoption and P1 area identity
- `progress/explore_ui_ux_flow_critique.md` — P1 page skeleton/action hierarchy, action matrix, recommended order §296–304
- `progress/explore_ui_platform_synthesis.md` — Apple × Material action and chrome principles
- `progress/explore_f100_area_theme_scope.md`
- `packages/ui/src/common/pageHeader.css`
- `packages/ui/src/common/workspaceChrome.css`
- `packages/ui/src/projects/components/ProjectsListView.tsx`
- `packages/ui/src/engineering/EngineeringScreen.tsx`
- `packages/ui/src/production/ProductionOrderViewsPanel.tsx`

## Explicit no-goals

- No navigation, route, sidebar, RBAC, area landing, or information-architecture reorganization.
- No AI/operations consolidation, removal of temporary Órdenes, or renaming of destinations.
- No form-control, modal/drawer, card, table, status, loading/empty/error, or global button-system redesign.
- No migration of every screen, catalog, editor, dashboard, or workspace; only the three named representative screens move in this feature.
- No domain, backend, API, persistence, or product-flow change.
- No dark-mode work or screen-by-screen visual polish beyond the shared chrome and named proofs.

## Delivery boundary

F101 is a component-contract and representative-migration feature. Follow-up features may separately standardize forms/modals/states, reorganize navigation and operations, or roll this stable chrome across remaining screens.

skill_resolution: paths-injected
