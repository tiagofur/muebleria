# F100 — Area Tonal Theme Foundation: scope

## Objective

Create one implementation-ready foundation that makes each workshop area perceptible across the shared application frame, not only in the sidebar and page title. The result is a restrained tonal atmosphere: the main canvas and shared chrome carry the active area, while work surfaces preserve concentration and data legibility.

## Why this is first

The design and UX audits agree that the current source of truth creates the exact break the user reported: `docs/design.md §3.2.1` restricts the color of an area to navigation and an icon-chip, and the shell mounts a neutral `main` without a tonal context. Solving the foundation first prevents later screens from choosing unrelated tints, state behavior, or contrast pairs.

## In scope

1. **Design contract.** Update `docs/design.md` to replace the old prohibition with the Muebles area-context model: `area-canvas`, `area-chrome`, `area-container`, `area-border`, `area-selected`, `area-ink`, and contextual state layers. The matrix must state which shared surfaces receive each role and which remain neutral.
2. **Semantic tokens.** Add area-role tokens in `packages/ui/src/design-system/tokens.css` for Sales, Engineering, Production, and neutral Overview/Config. Each new foreground/surface pair must have an AA contrast assertion or documented verification.
3. **Shared shell propagation.** `packages/ui/src/shell/AppShell.tsx` and the web shell provide the active area context to `main` and shared chrome. The foundation covers frame-level surfaces only.
4. **Focused proof.** Add tests for route/nav-to-area resolution and area context reaching the shell. Add token/contrast coverage for the introduced roles.

## Design constraints

- Area color communicates **location**. The global brand remains the primary CTA and focus language.
- Success, warning, danger, and info communicate **state** and never become area-dependent.
- Canvas/chrome tints are low-intensity. Standard cards, data-table bodies, and form controls stay neutral or nearly neutral so eight-hour workshop work remains readable.
- No custom Apple or Material component is copied; Apple informs hierarchy and feedback, Material informs semantic roles, states, and accessibility.

## Explicit no-goals

- No information architecture, sidebar grouping, route, label, or navigation reorganization.
- No modal, drawer, button, form, card, table, toolbar, or action-placement redesign.
- No screen-by-screen migration or visual polish of individual pages beyond the shared frame effect.
- No domain, backend, persistence, or product-flow changes.
- No dark-mode expansion beyond preserving token architecture; dark mode needs its own scoped feature.

## Follow-up feature boundaries

After F100, later features may use the stable foundation to address: navigation/IA consolidation, universal page/action scaffolding, component contracts for buttons/forms/dialogs, responsive/touch hardening, and controlled screen-by-screen migration. Those are intentionally excluded so F100 can produce a small, testable, reusable contract rather than a risky visual rewrite.

## Sources

- `progress/explore_ui_design_system_audit.md` — P1 area-identity finding
- `progress/explore_ui_ux_flow_critique.md` — P1 area-identity finding
- `progress/explore_ui_platform_synthesis.md` — §§1–3, 6–7
- `docs/design.md` — current conflicting §3.2.1

skill_resolution: paths-injected
