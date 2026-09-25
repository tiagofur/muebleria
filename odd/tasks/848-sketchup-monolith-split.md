# #848 — SketchUp monolith split: dialog.html → css/js, dialog_controller.rb → bridges

## Objective and authority

Implement approved #848: mechanical, behavior-preserving decomposition of the
plugin's two monoliths into per-responsibility files. Owner approved the full
plan (phases, file tree, principles) in session on 2026-09-25.

- Issue: [#848](https://github.com/tiagofur/muebleria/issues/848), OPEN and
  `status:approved` at creation; one writer on this branch.
- Worktree/branch: `muebles-worktrees/sketchup-monolith-split`,
  `refactor/sketchup-monolith-split`, from `main@5a368f40` (post-#847).
- Baseline: dialog.html 7.512 lines (CSS 1.905 / markup ~890 / JS 4.718);
  dialog_controller.rb 3.766 lines / 17 modules+classes / 239 methods.

## Route

Delegated direct with this one recovery artifact. Execution order is
risk-ascending (each phase independently green and PR-able):

- **A. CSS** → `resources/css/{tokens,base,library,configurator,materials,inspector,project}.css`;
  `<link>`s in load order; token_health extended to scan `css/*.css`.
- **C. Ruby** (mechanical, before JS) → move the existing 17 modules/classes
  to `ui/bridges/*`; split only `ProjectFurnitureBridge` (placement preview vs
  project furniture panel); `DialogController` becomes the composition root.
- **B. JS** (surgical, incremental, one module per commit) → plain-script
  modules under `resources/js/` sharing state through an explicit
  `window.GraneteUI` namespace; harnesses updated to load extracted files
  per phase.

## Evidence per phase (filled as commits land)

- Phase A: commit, verify tally, RBZ sha, token_health scope.
- Phase C: commit, verify tally, rubocop clean (no new ClassLength disables).
- Phase B: commits per module, verify tally, harness loading order.

## Limitations and remaining scope

- Real-host smoke (CEF loading external css/js on macOS AND Windows) is
  required before closing: NOT_RUN until executed.
- No behavior change is in scope; anything discovered broken becomes its own
  issue.
