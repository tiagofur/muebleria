# #846 — SketchUp panel UX overhaul: jerarquía, consecuencia, consistencia

## Objective and authority

Implement the approved #846 (UX/UI overhaul of the Granete for SketchUp
panel) on an isolated branch. Surface-only scope: dialog HTML/CSS/JS,
selector copy, and tool affordances. Ruby bridge/domain contracts,
mutation semantics, and capabilities stay intact.

- Issue: [#846](https://github.com/tiagofur/muebleria/issues/846), OPEN
  and `status:approved` at creation; no assignee and no open PR before
  this branch. Owner directed the critique, chose the scope, expanded it
  to all findings, and authorized publication.
- Worktree/branch: `muebles-worktrees/sketchup-ux-overhaul`,
  `feat/sketchup-ux-overhaul`, from `main@1de7b1b7` (no other writer).
- No other issue's files touched; no SketchUp host automation beyond
  file-level RBZ installs with the app closed.

## Route

Delegated direct with this one recovery artifact. The critique
(`.impeccable/critique/2026-09-25T14-22-02Z__apps-sketchup-extension.md`,
28/40) drove three implementation rounds plus power-user affordances,
each verified with `bundle exec rake verify` and standalone-browser
renders at the real panel size (480×720) before commit.

## Rounds and candidate commits

1. `6d18db2a` panel IA: account popover off the header pill, Estado tab
   removed, binding card on top, DESIGN.md tokens (teal/AA/mono/btn-sm),
   single loading voice.
2. `373bba01` consequence: publish 2-click arm (6 s, Esc disarms),
   delete toast with undo hint, alert()→toast, phase-colored mutation.
3. `070e98a8` selector alignment (inline+native: title, scope by
   context, focus trap, pre-init placeholder, voseo, AA tags, sha badge).
4. `53e6938b` power user: placement-tool context menu, managed-selection
   context menu (capability-gated), typed VCB yaw (explicit ° always
   yaw; bare number stays gap under wall snap).
5. `2e4c33a5` consistency: secondary demotions, footer identity, typos.
6. `9ef6b31f`/`44c9a416`/`40200f5e` v0.1.8/0.1.9/0.1.10 owner-test bumps.
7. `07345548` configurator redesign: live preview header, one-line
   52 px param rows, presets folded into Medidas y Opciones, sticky
   action dock (mono dims + parts beside Insertar), chevron material rows.
8. `ad8ec5bc` inspector mirrors the dock inside the #476 fail-closed
   fieldset; delete stays outside (capability boundary).

## Evidence

- `rake verify` green after every round; final run at `40200f5e`:
  1131 runs / 7428 assertions / 0 failures, boundary 6 runs / 3359
  assertions, RBZ sha256 `ab6cd2770c5c919016dc17fc8031bca804a3bb9db89635216147d59c24bfb7c8`.
- New tests: token health across 4 HTML surfaces, dialog UX contracts,
  publish arm, footer version, 7 typed-yaw tool tests, configurator
  contract (incl. btn-update inside / btn-delete outside the fieldset).
- Standalone-browser visual verification at 480×720 (popover contract,
  configurator, inspector dock); DOM-measured row rhythm (52 px × 6).
- Owner-host installs with readback 105/105 files: v0.1.8, v0.1.9
  (waiter-installer after owner closed SketchUp), v0.1.10; RBZs archived
  in `muebles-worktrees/backups/granete-0.1.7-installed-2026-09-25/`.

## Limitations and remaining scope

- **TestUp real-host smoke NOT_RUN**: context menus, typed yaw in the
  real VCB, popover in CEF, sticky dock, and publish arm were verified
  standalone only. Publication is `Refs #846` + `Delivery: partial`
  until the owner smoke on the installed build passes; then the same
  issue may close complete.
- Batch materials multi-selection deliberately excluded (#498 one-
  correlated-command risk); monolith refactor deliberately excluded —
  both belong to their own issues.

## Review round (PR #847, 2026-09-25) — findings fixed

Independent review on df01bad7 found two blockers and three adjustments;
all five fixed on this branch:

1. **P1 placement-tool menu protocol** — replaced the invented
   `getContextMenuItems`/`onContextMenu` host surface with the real Tool
   protocol `getMenu(menu)`: items added via `menu.add_item(title) { … }`
   reusing `rotate!`/`cycle_anchor!`/`cancel!` through the shared
   `onContextMenu` dispatcher, separator before the destructive exit.
   Host-faithful test `RecordingMenu` asserts the arity-1 signature, the
   populated menu shape/order and that each block drives the real
   gesture; no bespoke callback is validated.
2. **P1 publish double-click traversal** — arming now hides the original
   button and reveals `binding-publish-confirm` (Cancelar / Publicar
   revisión) with the immutable-revision consequence copy; publishing
   happens ONLY from the distinct confirm action (`armPublishConfirm` /
   `startPublishOrchestration`). The 6 s timer remains as a cushion.
   Regressions: immediate double/triple click on the original button →
   0 `publish_design_revision` calls; arm + explicit confirm → exactly 1;
   cancel disarms restoring the button.
3. **P2 inspector navigation** — `.tab-btn.active` corrected to the real
   `.tab-button.active`; new `activateInspectorTab` bridge pushed by Ruby
   from `handle_select_furniture` (now dialog-aware) so "Granete: editar
   en el panel" lands on the Inspector even with `activeLibDef` set,
   while a passive selection still preserves the open configurator.
   Regression drives a class-aware tab probe through the real script.
4. **P2 account popover focus** — contextual focus on open (loginServer
   without session, Cerrar sesión with session, never a hidden control);
   closing returns focus to the connection pill; Esc/outside-click/pill
   toggle unchanged; empty-state CTAs delegate to the same path.
5. **P2 honest piece count** — `estimatedPartsLabel(def, currentValues)`:
   the definition estimate only applies while counting params sit at
   defaults; otherwise the pre-existing heuristic reads CURRENT values;
   every local number is labeled "Aprox."; with nothing estimable the
   dock defers ("Piezas: se calculan al resolver"). No resolved count is
   invented client-side — no such field reaches the dialog today and the
   backend stays the authority.

Verification for this round: `rake verify` green at the bump commit
(1132 runs / 7436 assertions / 0 failures; boundary 6 runs / 3359
assertions; deterministic RBZ sha256
`a8c23a08a2de8081710540c4af4e352279f44f658c080b0a572719129df15099`,
v0.1.11). New JS coverage: publish 25 (incl. double-click regression),
ux_states 46 (contextual focus, tab selector, bridge), inspector 71
(selection→Inspector with configurator open), parts summary 5 (new
harness). Owner smoke remains NOT_RUN — same list as above plus the real
`getMenu` menu visible in host and publish double-click on 0.1.11.
