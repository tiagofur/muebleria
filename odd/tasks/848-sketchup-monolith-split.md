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

## Delivery

- Strategy: **stacked-to-main**. Each child is a focused review slice that
  ultimately lands on `main`; there is no final integrator branch. The parent
  maps local commits to the eventual parent/child PR bases before publication.
- C2 was the Ruby preview/workflow extraction slice; its historical evidence is retained below. Current tolerance ownership is C3 `Host::PlacementEnvironment`.

## Evidence per phase (filled as commits land)

- Phase A: commit, verify tally, RBZ sha, token_health scope.
- Phase C / C2: **historical completed extraction before C3 and #851 merge**. The inherited
  multi-file extraction moves the design workflow and placement-preview portions
  of `ProjectFurnitureBridge` into their existing bridge files, then wires the
  composition root and test helper. Route: delegated direct, triggered by the
  inherited extraction spanning six Ruby/harness files. Strict TDD is enabled;
  this recovery begins from an inherited dirty pure move, so no fabricated RED
  applies. Any net-new corrective behavior requires an observed focused RED;
  inherited behavior is validated with the existing suite. Required checks:
  `rake verify` and `python3 scripts/verify_affected.py --base origin/main --plan`.
  V2 real SketchUp smoke is NOT_RUN. Recovery readback found all 92 original
  bridge methods exactly once across the three modules (no omissions or new
  methods); Ruby syntax and whitespace checks pass. The host-default Ruby
  `4.0.6` cannot install locked `commonmarker-0.23.12`,
  but the checked-in Ruby `3.2.11` runtime is available through
  `~/.rbenv/shims`. `PATH="$HOME/.rbenv/shims:$PATH" BUNDLE_FROZEN=true
  bundle install` completed with 61 locked gems and did not alter `Gemfile` or
  `Gemfile.lock`. The first full `bundle exec rake verify` supplied the required
  RED for the inherited extraction: moving the placement methods left
  `UNIT_EPSILON` in `ProjectFurnitureBridge`, causing 8 failures and 18 errors.
  C2 restored the tolerance after extraction; C3 later moved its current ownership to `Host::PlacementEnvironment`.
  The rerun passed: RuboCop 249 files / 0 offenses; Ruby unit suite 1132 runs,
  7438 assertions, 0 failures/errors/skips; contract suite 6 runs, 4007
  assertions, 0 failures/errors/skips; RBZ sha256
  `e3b4647cef47cf8b2abe7a6cfceede792fa92ced1389f311e339413fea5c35f4`.
  C2 acceptance: `PlacementPreviewBridge` owns preview lifecycle, anchors/snap,
  and commit/cancel; current `UNIT_EPSILON` ownership is `Host::PlacementEnvironment`; `ProjectFurnitureBridge` owns the project
  panel and FurnitureInstance operations; `DesignWorkflowBridge` owns
  publish/validate orchestration. `DialogController` explicitly composes their
  callback registration. Context reduction is concrete: the source project
  bridge fell from 1,644 to about 311 lines; preview and workflow now occupy
  about 932 and 440 lines. Approximate C2 source accounting is MOVE-ONLY
  2,700 touched lines (1,350 removed + about 1,350 relocated), WIRING about 30
  lines (requires/includes/callback composition), and BEHAVIOR-CORRECTION about
  15 lines (the moved tolerance plus direct regression coverage). The focused
  placement suite passed (42 runs, 263 assertions), and final verification on
  Ruby 3.2.11 passed: RuboCop 249 files / 0 offenses; Ruby unit suite 1134
  runs, 7442 assertions, 0 failures/errors/skips; contract suite 6 runs, 4007
  assertions, 0 failures/errors/skips; RBZ sha256
  `159c04dc9d22fd3402bf08bf5d39aa8e6dcabbd75e4f9e286d9e6789fd11788e`.
  `git diff --check` and `verify_affected --plan` pass; manifests remain
  unchanged. Delivery is `stacked-to-main`, not an integrator branch: C2 is a
  focused child review slice that can ultimately land on `main`. Local topology
  is ambiguous for that PR mapping: the only feature branch contains the prior
  Phase A and C1 commits above local `main`/`origin/main` at `5a368f40`, and no
  local parent/child slice branches exist. No remote state was read or inferred;
  the parent must choose the eventual PR bases before publication.
- Phase B: commits per module, verify tally, harness loading order.

## C3 — Placement environment extraction

Completed from `main@d13e0c41fad7a6dcf389f83b04d8a1b95a773658`: refactor-only extraction of host geometry discovery. `PlacementPreviewBridge` extraction boundary was 932→631 lines; final documentation-only cleanup leaves it at 628 lines; `Host::PlacementEnvironment` is 324 total lines including its 11-line contract header (313 move-only implementation lines) and owns `UNIT_EPSILON`, base planes, snap targets, frames, envelopes, and geometry helpers. It exposes only the two providers; lifecycle/wiring remains in the bridge.

- [x] C3.1 RED: missing environment constant.
- [x] C3.2 GREEN: move-only boundary and API ownership tests.
- [x] C3.3 Ruby 3.2.11: focused 43/264; RuboCop 250/0; units 1134/7441; contracts 6/4043; RBZ `f1ad870ed0fbcc4125cbf5f4ca71a955a3f851a9d358e9427039427752ab6e69`; diff-check and affected plan pass.
- [x] C3.4 One work unit committed; final amendment handoff records its hash. V2 host smoke NOT_RUN.

## Limitations and remaining scope

- Real-host smoke (CEF loading external css/js on macOS AND Windows) is
  required before closing: NOT_RUN until executed.
- No behavior change is in scope; anything discovered broken becomes its own
  issue.
