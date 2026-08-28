# F102 — Semantic Tabs: two patterns, one workspace family

## Objective

Normalize tab navigation into exactly two semantic patterns:

1. **Workflow / station tabs:** underline tabs for ordered production stages
   (`Corte → Encintado → Armado → Embalaje`).
2. **Workspace peer tabs:** one shared pill-tab family for peer views within a
   project/order workspace.

The visible divergence in the two captured workspaces is not intentional. Both
the Producción order hub (`Resumen · Piso · Etiquetas · Herrajes · Documentos`)
and the Ingeniería workspace (`Resumen · Módulos · Despiece · Etiquetas ·
Herrajes · Vistas · Optimización · Documentos`) represent peer views and must
use the same primitive, geometry, state model, and responsive behavior.

## Why now

F100 established tonal area context and F101 established shared page chrome.
The captured screens reveal the next system-level inconsistency: three visual
tab treatments are being read as three meanings even though only two meanings
exist. A production station is a sequential workflow; an order or engineering
workspace is peer navigation. This feature makes that distinction explicit,
then migrates only the two workspaces that demonstrate the duplicate peer-tab
family.

## In scope

1. **Normative design contract.** Update `docs/design.md` with a Tabs section
   that names and constrains the two patterns, their semantic eligibility,
   visual hierarchy, keyboard behavior, state matrix, and responsive overflow.
   The contract must state that a new visual variant requires a distinct user
   task, not a local styling preference.
2. **Shared primitives.** Establish documented, typed accessible primitives
   (or a documented compatible consolidation of existing primitives) for:
   - `WorkflowTabs` / station tabs with the underline treatment;
   - `WorkspaceTabs` with the unified pill treatment.
   Both consume tokens and F100 contextual roles without turning the active
   tab into an area-specific CTA or semantic status.
3. **Unified workspace-pill specification.** The common peer-tab family owns
   height, padding, radius, typography, gap, borders, active/hover/pressed/
   focus-visible/disabled states, optional count badge, and panel relation.
   Production and Engineering may differ only in labels, item count, and
   domain content—not in geometry or selection language.
4. **Targeted migrations only.** Migrate exactly these peer workspaces:
   - `ProductionOrderHub` under `/orders/:projectId` (`Resumen`, `Piso`,
     `Etiquetas`, `Herrajes`, `Documentos`);
   - `EngineeringWorkspace` (`Resumen`, `Módulos`, `Despiece`, `Etiquetas`,
     `Herrajes`, `Vistas`, `Optimización`, `Documentos`).
   Preserve their routes, labels, active-tab state, permissions, and tab-panel
   content. Do not convert the station screen to pills.
5. **Accessibility.** Both primitives expose `role="tablist"`, `role="tab"`,
   and linked `role="tabpanel"` semantics where they switch in-place panels;
   one active tab has `aria-selected="true"` and `tabIndex=0`, while inactive
   tabs use `tabIndex=-1`. Implement roving tabindex with Arrow Left/Right,
   Home, and End; Enter/Space activation follows the existing navigation model
   and focus/selection state must remain announced. Focus remains visibly
   distinct from selection, icon-only affordances retain names, and the motion
   respects `prefers-reduced-motion`.
6. **Responsive contract.** Peer tabs remain a single horizontal tab row. On
   narrow viewports they scroll horizontally rather than wrap into ambiguous
   rows; the active tab is reachable and brought into view without hiding
   labels or trapping horizontal page scroll. Station tabs use the same
   overflow/accessibility safeguards while retaining their underline pattern.
   Validate 390px, 768px, and 1280px.
7. **Proof.** Add focused primitive and integration tests covering semantic
   roles/ARIA linkage, roving keyboard navigation, selection, count badges,
   focus-visible treatment contract, reduced-motion-safe interaction, and
   overflow/scroller hooks. Cover both migrated workspaces and regression-test
   the station underline pattern. Run focused tests, `pnpm test`, `pnpm
   typecheck`, `./init.sh`, and the Impeccable detector; record visual evidence
   or an actual environment block without inventing approval.

## Acceptance criteria

1. The app exposes exactly two documented tab patterns: workflow/station
   underline and workspace peer pill; usage rules make the semantic distinction
   reviewable.
2. Producción order hub and Ingeniería workspace render through the same
   workspace-peer tab family with identical state and responsive contracts.
3. Fabric station tabs preserve their underline pattern and station workflow
   behavior, while adopting the shared a11y/overflow baseline if needed.
4. Tabs are fully keyboard operable through roving tabindex and express
   `tablist` / `tab` / `tabpanel` relationships without selection being
   conveyed by color alone.
5. At 390px / 768px / 1280px, all labels remain discoverable and the tab row
   has no accidental wrapping, clipped active item, or page-level horizontal
   overflow.
6. Existing deep links, RBAC, routing, workspace action hierarchy, domain
   behavior, persistence, and panel content remain unchanged.
7. Focused UI tests, `pnpm test`, `pnpm typecheck`, `./init.sh`, and the
   Impeccable detector are green; unavailable screenshot tooling is reported
   as blocked evidence, never replaced by a claim of visual approval.

## Explicit no-goals

- No navigation or information-architecture reorganization, including AI or
  Operations consolidation, destination renames, sidebar changes, or route
  changes.
- No forms, modals/drawers, button, card, table, status, loading, empty, or
  error-state redesign.
- No migration of all editors, all catalog screens, or every local tab-like
  control; scope is the two named peer workspaces plus station-pattern
  regression coverage.
- No changes to project workflow, process-stage WIP, domain, backend, API,
  persistence, or RBAC rules.
- No dark-mode or broader visual-polish campaign.

## Delivery boundary

F102 is a design-system tab normalization with two targeted workspace
migrations. Navigation/operations reorganization and component families such
as forms or modals remain independent follow-up features.

## References

- User captures, 2026-08-19: Producción hub, Producción stations, Ingeniería
  workspace
- `docs/design.md` §2.1, §3.2.1, §3.6.1, §4.0, §4.1a, §4.8, §6.7, §6.7a, §8
- `progress/explore_ui_design_system_audit.md` — P1 primitives/adoption and
  state-system findings
- `progress/explore_ui_ux_flow_critique.md` — navigation and consistency
  findings
- `progress/explore_ui_platform_synthesis.md` — Apple × Material division of
  responsibility
- `progress/explore_f101_page_chrome_scope.md`

## Key Learnings:

1. Station navigation communicates ordered workflow, so its underline pattern
   is semantically correct and must not be merged into peer workspace tabs.
2. The two captured workspaces both represent peer views; their different pill
   geometry is drift, not a product distinction.
3. A tab family is incomplete without keyboard roving behavior, ARIA linkage,
   and a narrow-screen overflow rule.
