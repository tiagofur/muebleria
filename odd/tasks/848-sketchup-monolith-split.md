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

## C4.1 — Phase B pilot: granete-media.js

Started from `main@701865e4683b89e51fabd42aadf27061512f7949` (post-#852),
branch `refactor/848-dialog-js-media`. Pilot extraction that sets the Phase B
pattern: `window.GraneteUI` namespace, one authority, deterministic load
order, harnesses running the real external file, zero behavior change.

- **Extracted**: `resources/js/granete-media.js` (117 lines including the
  agent-first Owns/Consumes/Does-NOT-own header). dialog.html went 5,633 →
  5,562 lines; inline JS 4,713 → 4,631 (media block 1,159–1,231 + the
  `catalogMedia` state var moved out; 11 inline callsites now call the API).
- **Public API (5)**: `filenameFromPath`, `resolveUrl`, `requestRefresh`,
  `updateSignedUrl(filename, url)` (stores grant + clears pending +
  reapplies to DOM), `setCatalogMedia(media)` (sole catalog-media authority;
  `null`/undefined normalize to reset). **Private**: `catalogMedia`,
  `pendingMediaRefresh`, `MEDIA_REFRESH_RETRY_MS` (still 5000),
  `mediaFilenameRe`, `mediaUrls()`, `applyMediaToDom()`.
- **State ownership**: `GraneteUI.media` owns the whole media slice;
  dialog.html keeps no `catalogMedia` copy. `GraneteDialog.setCatalog`
  forwards `payload.media`; `updateMediaUrl` forwards to `updateSignedUrl`.
  Preserved quirk: `pendingMediaRefresh` deliberately survives catalog
  changes (throttle map is never reset on `setCatalogMedia`), and a received
  grant clears it — both asserted by the focused harness.
- **Load order**: markup → `js/granete-media.js` → inline bootstrap → the
  seven #498 runtime scripts (untouched, still last). The module loads
  before the inline script because inline render paths consume
  `window.GraneteUI.media` during their own initial execution; inline
  references are `window.`-qualified (vm sandboxes keep `window` and the
  context global distinct; CEF does not).
- **Harness migration**: new tiny loader `test/js/support/dialog_scripts.js`
  (dialogSources/runDialogScripts) executes the REAL granete-media.js +
  inline script in dialog.html order. Ten harnesses migrated (enrollment,
  model_binding, inspector, parts_summary, pairing, project_furniture,
  placement_preview, ux_states, publish, version_footer); publish keeps its
  granete-state/granete-preflight-review preloads and adds media first. No
  test copies module code; no assertion was deleted.
- **Focused tests**: `test/js/granete_media_test.js` — 12 tests covering
  registration + idempotent re-execution, public API shape, filename
  contract, signed-resolution without bridge calls, passthrough rules,
  miss → refresh + "" placeholder, 5s throttle window (fake clock), failed
  mint releases the flag, grant re-application to `data-media-name` DOM
  (img reveal + swatch repaint), grant clears throttle, catalog
  reset/change never keeps stale authority, re-mint replaces URL. Ruby side
  `test/unit/granete_media_js_test.rb` (4 tests) runs the harness and adds
  symbol-based structural guards: implementation lives in granete-media.js
  with its header, dialog.html loads it BEFORE the inline script, and the
  monolith no longer carries any media implementation symbol.
- **Security**: #460 SEC-3 unchanged — no credential in the webview, no
  `?token=`, short-lived per-file signed URLs, Ruby `refresh_media_url`
  on miss/expiry, retry window intact.
- **Verify** (Ruby 3.2.11 via Homebrew `ruby@3.2`; execution evidence for
  this worktree, not a new permanent architecture: the existing vendored
  native json extension is linked to Homebrew's libruby — `otool -L` on
  `vendor/bundle/.../json/ext/parser.bundle` — so the rbenv 3.2.11
  installation could not load it. Both rubies are 3.2.11; no gem reinstall,
  Gemfile or Gemfile.lock changed):
  RuboCop 251 files / 0 offenses; unit suite 1138 runs, 7478 assertions,
  0 failures/errors/skips; contract suite 6 runs, 4043 assertions, 0
  failures; `git diff --check` clean; `verify_affected --plan` passes
  (plan selects `sketchup-local-os` = `bundle exec rake verify`, green
  above). RBZ rebuilt deterministically by `package:verify`, sha256
  `c390144e643c94a6ad4eeba6bbe5a82864db10a82ec72848089baf963fdd9207`
  (supersedes the first build `961a60eb…` after the review round below).
- **Review round (owner, pre-merge)**: contract-fidelity correction —
  `requestRefresh` now calls `window.sketchup.refresh_media_url(filename)`
  exactly as the module header documents (same try/catch, retry, state and
  error semantics), and the focused harness mocks the bridge on
  `window.sketchup` like the integrated harnesses instead of a parallel
  sandbox global. No public API, constant, regex, state, DOM reapplication,
  load order, dialog.html, helper or other harness touched. Behavior
  changes: 0.
- **CI**: exact-head run recorded in the PR. **Real SketchUp host smoke:
  NOT_RUN** (CEF loading external js before the inline script still needs
  the real host per phase-level gate).

## C4.2 — granete-account.js

Started from `main@5294768d0020a2a935ab4ce105b7d449158b8c9a` (post-#853),
branch `refactor/848-dialog-js-account`. Same Phase B pattern: one state
authority, real external module, real-file harnesses, zero behavior change.

- **Extracted**: `resources/js/granete-account.js` (387 lines including the
  agent-first header). dialog.html went 5,562 → 5,267 lines; inline JS
  4,631 → 4,329 (DOM declarations + popover block + the six GraneteDialog
  bridge methods + renderSessionLicense + the bottom login/enroll/copy/
  web-devices/logout bindings moved out).
- **Public API (9)**: `init(deps)` (injects the shared `showToast`/`icon`
  helpers — no duplicated implementations), `open`, `close`, `setStatus`,
  `onEnrollResult`, `onPollResult`, `onLoginResult`, `startEnrollCountdown`,
  `clearEnrollmentTimers`. **Private**: `currentEnrollmentId`,
  `enrollPollInterval`, `enrollCountdownInterval` (single owner — the
  module), ~25 account DOM refs, `accountFocusTarget`, `renderSessionLicense`,
  `fallbackCopy`. `onLoginResult` keeps the lazy
  `window.GraneteCommercialProjection.invalidateSession()` lookup and the
  post-pairing `get_model_binding()` re-ask.
- **Bridge contract preserved**: Ruby still calls
  `window.GraneteDialog.{setStatus,onEnrollResult,onPollResult,onLoginResult}`
  via `execute_bridge` (dialog_controller.rb + session_bridge.rb —
  untouched); `startEnrollCountdown`/`clearEnrollmentTimers` have no Ruby
  callers but stay on GraneteDialog as thin delegation per the frozen
  contract. Library's two empty-state CTAs now call
  `window.GraneteUI.account.open()`. The shared document `keydown` Escape
  listener split into two (module closes the popover; the inline bootstrap
  keeps `resetPublishConfirm`), both firing in the original order. The
  popover's `btn-close` ("Cerrar panel" → `close_dialog`) stays inline: it
  is dialog chrome, not account logic; the module fetches it by id only as
  the focus fallback it already was.
- **Preserved quirks** (asserted by the focused harness): 5s poll interval;
  429/transient errors never abort enrollment; expiry cleanup lands on the
  next 1s countdown tick because the poll interval is armed after
  `startEnrollCountdown`; cancel nulls the enrollment id while reject/expiry
  do not; `loginServer` is seeded from `status.server_url` only when empty;
  web-devices URL derives by stripping trailing slashes + `/api`.
- **Load order**: markup → `js/granete-media.js` → `js/granete-account.js` →
  inline bootstrap → the seven #498 runtime scripts. The module must be
  operative before the inline script finishes because Ruby answers
  `dialog_ready` with `GraneteDialog.setStatus` immediately; the bootstrap
  calls `GraneteUI.account.init({ showToast, icon })` before `dialog_ready`.
- **Harness migration**: `test/js/support/dialog_scripts.js` now loads
  granete-media.js → granete-account.js → inline (the nine runDialogScripts
  harnesses migrated automatically; `dialog_publish_test.js` adds account to
  its explicit preload chain). No test copied module code; no assertion was
  deleted.
- **Focused tests**: `test/js/granete_account_test.js` — 30 tests covering
  registration + idempotent re-execution, public API shape, pill
  open/close + aria, outside-click and Escape dismissal, focus target
  logged-in/out, focus restoration, setStatus pill/cards/user/license
  (active/expired/none), enrollment start (server required, payload,
  button disarm, bridge absent recovery), enroll failure, code+timers on
  success, 5s poll tick payload, 429 resilience, transient retry, pending
  copy, reject/expiry cleanup, countdown expiry, cancel (incl. dead id never
  polls again), logout result, login result (projection invalidation +
  model-binding re-ask), logout click, web-devices URL derivation (with and
  without /api), clipboard copy with icon feedback and textarea fallback,
  placeholder code never copied. Ruby side
  `test/unit/granete_account_js_test.rb` (5 tests) runs the harness and adds
  symbol-based structural guards: implementation lives in granete-account.js
  with its header, dialog.html loads it after media and BEFORE the inline
  script, the monolith no longer carries any account implementation symbol,
  and GraneteDialog keeps all six wrappers as delegation plus the
  bootstrap `init` wiring.
- **Verify** (Homebrew `ruby@3.2` 3.2.11 — same vendored-bundle libruby
  linkage note as C4.1; no gem or lockfile change): RuboCop 252 files /
  0 offenses; unit suite 1143 runs, 7553 assertions, 0
  failures/errors/skips; contract suite 6 runs, 4043 assertions, 0
  failures; `git diff --check` clean; `verify_affected --plan` passes
  (plan selects `sketchup-local-os` = `bundle exec rake verify`, green
  above). RBZ rebuilt deterministically by `package:verify`, sha256
  `85615e202ff951e541de72fb11948ed989e2e73bb1fee0542a131c7a2b0a0e05`.
- **CI**: exact-head run recorded in the PR. **Real SketchUp host smoke:
  NOT_RUN** (same phase-level gate as C4.1).

## C4.3 — granete-library.js

Started from `main@9d327f0976dc1ab92a771ab815490186559eda9c` (post-#854),
branch `refactor/848-dialog-js-library`. First Phase B slice that moves a
SHARED authority (furniture definitions): `GraneteUI.library` is now the
single catalog browsing owner — dialog.html keeps no `catalog` copy and
reads through the module API.

- **Extracted**: `resources/js/granete-library.js` (602 lines including the
  agent-first header). dialog.html went 5,267 → 4,792 lines; inline JS
  4,328 → 3,845 (state vars + 12 Library DOM refs + CATEGORY_LABELS/
  formatCategoryLabel + getDefinitionDefaultDims + catalogSourceNote +
  renderLibraryState + the whole category cascade + renderFurnitureCards +
  renderLibraryBrowser + the four search/clear/retry bindings moved out).
- **Public API (7)**: `init(deps)` (injects icon,
  createFurniturePlaceholderSvg — shared with the inline configurator —,
  onSelectDefinition = showConfiguratorView hand-off, and
  getSelectedDefinitionId for the card highlight), `setCatalog(payload)`
  (array/object shapes; updates browsing state + license blocker + source
  note; the bootstrap still drives the view transition exactly as before),
  `render`, `getDefinitions`, `getCategories`, `findDefinitionById`,
  `formatCategoryLabel` (categories are Library's domain; the configurator
  badge consumes the API). **Private**: catalog, catalogCategories,
  catalogSource, licenseBlocked, searchQuery, selectedCategory,
  categoryNodeById/categoryChildren index, all cascade/card/state helpers.
- **Definitions authority**: ONE owner. `GraneteDialog.setCatalog` stays the
  Ruby-facing thin orchestrator: it delegates the browsing slice to
  `GraneteUI.library.setCatalog(payload)`, keeps assigning the
  not-yet-extracted slices (presets/materialCategories/materials/hardware/
  media), and the GraneteState "catalog" projection now reads
  `library.getDefinitions()/getCategories()`. The inline inspector fallback
  (`context.definition || …`) migrated to `library.findDefinitionById`.
  Preserved quirk: the array-payload branch still does NOT reset
  catalogHardware (pre-existing, documented, not fixed — no behavior
  change in this slice). Search/category filters survive catalog refreshes
  (pre-existing, now asserted).
- **Boundary with Configurator**: Library ends at the choice — cards call
  the injected `onSelectDefinition` (= showConfiguratorView). The
  browser↔configurator view transition (`showLibraryView`/
  `showConfiguratorView`, btn-back-to-library resetting activeLibDef) stays
  inline until C4.4. activeLibDef/libParams/libMaterialChoices/
  projectDefaultMaterials/catalogPresets untouched.
- **Boundary with Media/Account**: unchanged consumers — cards resolve via
  `GraneteUI.media.filenameFromPath/resolveUrl/requestRefresh`; the
  unauthenticated/error CTAs call `GraneteUI.account.open()`.
- **Load order**: markup → media → account → library → inline bootstrap →
  #498 runtime scripts. `library.init` runs in the bootstrap right after
  `account.init`, before the first `showLibraryView()`/`dialog_ready`.
- **Harness migration**: `test/js/support/dialog_scripts.js` loads media →
  account → library → inline (the nine runDialogScripts harnesses migrated
  automatically); `dialog_publish_test.js` adds library to its explicit
  preload chain in dialog order. No test copied module code; no assertion
  was deleted — `dialog_library_view_test.rb` implementation asserts now
  point at the module file (markup/load-order asserts stay on the HTML).
- **Focused tests**: `test/js/granete_library_test.js` — 26 tests covering
  registration + idempotent re-execution, public API shape, loading
  skeletons, local empty, unauthenticated CTA → account.open, error +
  retry → `sketchup.get_catalog`, license blocker, array legacy payload,
  L1/L2/L3 cascade, subtree-inclusive filtering, Sin categoría bucket,
  legacy flat categories, search by name/code/description, search clear,
  no-results (query vs category copy), clear-search resets both, count
  badge singular/plural, cards (aria/dims/code/badge), media path +
  SEC-3 refresh via GraneteUI.media, click + Enter → injected
  onSelectDefinition (same object), selected-definition highlight,
  formatCategoryLabel mapping, findDefinitionById, single definitions
  authority (no inline `var catalog =`), filters survive refresh. Ruby
  side `test/unit/granete_library_js_test.rb` (5 tests) runs the harness
  and adds symbol-based structural guards: implementation + header live in
  granete-library.js, dialog.html loads it between account and the inline
  script, the monolith carries no library implementation symbol,
  GraneteDialog.setCatalog keeps the delegation + GraneteState projection
  through the module API, and the bootstrap wires init/render.
- **Verify** (Homebrew `ruby@3.2` 3.2.11, same vendored-bundle note as
  C4.1/C4.2; no gem or lockfile change): RuboCop 253 files / 0 offenses;
  unit suite 1148 runs, 7667 assertions, 0 failures/errors/skips; contract
  suite 6 runs, 4043 assertions, 0 failures; every Node harness under
  test/js green; `git diff --check` clean; `verify_affected --plan` exit 0
  (selection conservatively expanded by pre-existing untracked
  `.codex/`, `.github/hooks/`, `plugin-siguiente.md` — not part of this
  slice; `sketchup-local-os` = `bundle exec rake verify` green above). RBZ
  rebuilt by `package:verify`, sha256
  `aadc8fbe43cec0b55201d950963c4f41f7e27d0bf4149839fc838bd2595fe6d7`,
  packages granete-library.js.
- **Status**: owner approved the pre-commit boundary review on 2026-09-25
  (single-writer definitions authority, Configurator/Inspector reading via
  the module API, array-branch `catalogHardware` quirk explicitly
  preserved). Committed as one work unit and published against main
  (`Refs #848`, `Delivery: partial`). **Real SketchUp host smoke: NOT_RUN**
  (same phase-level gate).



## C4.4 — granete-configurator.js

Started from `main@dbee5d203c9f11544c7b041beac470e108a11d01` (post-#856),
branch `refactor/848-dialog-js-configurator`. The last high-coupling
boundary before Material Roles/Inspector: the configurator touches params,
materials and placement at once.
**Status**: owner approved the pre-commit boundary review on 2026-09-26
(injected shared helpers, shared #469 placement handlers staying inline,
the bootstrap load-order movement of the initial unbound render, and both
documented behavior quirks), then approved the code review with a
documentation-accuracy round (onCreateProjectFurnitureResult serves the
canonical connected preview commit too; API count 15). Published against
main as PR #857 (`Refs #848`, `Delivery: partial`, `type:refactor`;
exact-head readback verified: OPEN, non-draft, base main, headSha ==
commit, MERGEABLE, issue #848 OPEN + status:approved) as one
implementation work unit (`910fa962`) plus docs-only follow-up commits
(publication record; documentation-accuracy corrections). Merge remains
human. **Real SketchUp host smoke: NOT_RUN** (same phase-level gate).

- **Extracted**: `resources/js/granete-configurator.js` (532 lines
  including the agent-first header). dialog.html went 4,792 → 4,503 lines;
  inline JS 3,845 → 3,544. Moved state: activeLibDef, libParams,
  libMaterialChoices (configuration snapshot only), catalogPresets,
  catalogCreateIntentKey, lastCatalogPlacementPayload, repeatPreviewActive +
  17 configurator DOM refs + showConfiguratorView/renderConfiguratorPreview/
  updateLibraryInsertButton/bindLibraryParamForm/registeredMeasureParams/
  renderRegisteredMeasuresButton/renderPresetChips/updateLibrarySummary +
  the whole btnInsert placement intent (intent key, idempotency, #469
  repeat, legacy fallbacks) + onInsertionResult +
  handleCreateProjectFurnitureResult (the connected catalog-lane result
  handler — Ruby reports here from BOTH the canonical #469 preview commit
  (PlacementPreviewBridge#handle_commit_catalog_preview) and the legacy
  create_project_furniture fallback; classified catalog lane).
- **Public API (15)**: init(deps), open(def), close(),
  getActiveDefinitionId(), hasActiveDefinition() (exact `!!activeLibDef`
  semantics — selection/material routing reads definition presence, not its
  id), setPresets, refreshAfterCatalog, updateInsertButton,
  rearmInsertButton, isRepeatPreviewActive, cancelRepeatPreview,
  getIntentKey, onInsertionResult, onCreateProjectFurnitureResult,
  applyMaterialChoice.
- **Injected deps (15)** — single-implementation inline helpers shared with
  the Inspector: icon, showToast, createFurniturePlaceholderSvg,
  getDefaultParams, renderParamForm, defaultMaterialChoices,
  renderMaterialSelectors, materialById, estimatedPartsLabel,
  parameterIssueMessage, isModelConnected (accessor over
  modelBindingState — Model Binding internals stay out), 
  setProjectDefaultMaterial (write into projectDefaultMaterials — Material
  Roles state stays out), switchTab, requestProjectFurniture,
  pfPlaceFailureMessage (project-side effects of the legacy create
  fallback). init fails fast listing any missing dep; no public entry
  renders before init.
- **Boundaries**: Library hand-off is call-time
  (`onSelectDefinition: function (def) { window.GraneteUI.configurator.open(def); }`).
  setCatalog delegates presets to `configurator.setPresets` (single
  authority) and the refresh tail to `configurator.refreshAfterCatalog()`
  (preserved quirk: a disappeared definition does NOT reset the active
  reference). onMaterialChoiceApplied keeps its 3 branches; the
  configurator branch delegates to `applyMaterialChoice`. The shared #469
  handlers `handlePlacementPreviewStarted/Cancelled` stay INLINE (they
  serve the Project lane too) and read the catalog entry point through
  isRepeatPreviewActive/cancelRepeatPreview/rearmInsertButton.
  onSelectionChange reads `hasActiveDefinition()`. The whole
  browser↔configurator pane transition moved into the module
  (showBrowserView private; `close()` = btn-back-to-library semantics).
- **Load-order change (the one wiring movement)**: the initial
  `renderModelBindingStatus({ state: "unbound" })` was a mid-script call in
  the model-binding section; it now runs in the bootstrap after
  `configurator.init` (it re-renders the insert button — no module may
  render before init). Verified nothing between the old and new call sites
  executes at load time (declarations/bindings only; `lastPfState` null
  either way).
- **Harness migration**: `test/js/support/dialog_scripts.js` loads media →
  account → library → configurator → inline; `dialog_publish_test.js`
  preload chain updated. Repointed (never deleted) asserts:
  `granete_library_js_test.rb` (setCatalog orchestrator: presets delegation
  + call-time hand-off + render now driven by the module's close()),
  `dialog_library_view_test.rb` (measures/presets/preview/payload/category
  label/parts dock/hardware_count moved to @configurator_js; markup asserts
  stay on the HTML).
- **Focused tests**: `test/js/granete_configurator_test.js` — 33 tests:
  registration + idempotent re-execution, public API shape, init fail-fast
  on missing deps, open/close/view transition + identity/badge, active
  definition identity (incl. id-less definition quirk), preview with
  signed media + onerror refresh + placeholder fallback, default params,
  parameter edit (state + summary + intent invalidation), summary dims
  chain, project-scoped material choice, registered measures render +
  restore + hide, presets filtered/applied/hidden, insert label
  connected/local, catalog placement payload + key, same-gesture retry
  keeps key vs invalidated gesture mints fresh, #469 repeat (fresh key,
  held button, counts in toast), legacy Move-handoff toast, failure via
  parameterIssueMessage, cancel/re-arm, legacy connected create (pure
  gesture → Project tab; prior preview payload → repeat loop without tab
  hijack; created_pending; hard failure), legacy local insert (NO
  idempotency key — original behavior), no-bridge demo timeout,
  refreshAfterCatalog fresh-object/quirk, applyMaterialChoice, structural
  no-material-catalog/no-duplicated-shared-helpers. Ruby side
  `test/unit/granete_configurator_js_test.rb` (6 tests, 178 assertions):
  harness green + symbol guards (state ownership, 15 injected deps,
  media/library boundaries, header), load order library→configurator→
  inline, monolith carries no configurator implementation symbol,
  GraneteDialog wrappers stay thin delegation + presets single authority +
  hand-off call-time only after init.
- **Verify** (Homebrew `ruby@3.2` 3.2.11, same vendored-bundle note as
  C4.1–C4.3; no gem or lockfile change): RuboCop 254 files / 0 offenses;
  unit suite 1154 runs, 7853 assertions, 0 failures/errors/skips; contract
  suite 6 runs, 4043 assertions, 0 failures; all 14 Node dialog/module
  harnesses green; `git diff --check` clean; `verify_affected --plan` exit 0
  (conservatively expanded by the pre-existing untracked `.codex/`,
  `.github/hooks/`, `plugin-siguiente.md` — not part of this slice;
  `sketchup-local-os` = `bundle exec rake verify`, green above). RBZ rebuilt
  by `package:verify`, sha256
  `afbceea21266b7d28e8b5c361a0ccb60bf17607443d82d1dca3d13ab56163cd5`,
  packages granete-configurator.js.
- **Behavior changes: 0** (target). The one ordering note: the initial
  unbound binding render now executes after module init instead of
  mid-script — same statements, same observable state, documented above.
- **Real SketchUp host smoke: NOT_RUN** (same phase-level gate as
  C4.1–C4.3).


## C4.5 — granete-finish-selector.js

Started from `main@6f252d6f969687c04dbcb17dd75765c25a6a88d6` (post-#857),
branch `refactor/848-dialog-js-finish-selector`. Extraction of the visual
material picker modal (Slice B - Miller Columns): how the user navigates,
searches, inspects and confirms a material inside the selector. NOT in
scope: material roles/assignments, catalog ownership (C4.6), the
Ruby-native selector.

- **Extracted**: `resources/js/granete-finish-selector.js` (580 lines
  including the agent-first header). dialog.html went 4,503 → 4,009 lines;
  inline JS 3,544 → 3,037 (the whole modal block lines 1334–1856: 28 DOM
  refs — including the pre-existing unused `selectorTitle` declaration
  preserved verbatim —, selectorCtx/selectorLastFocus state, the four
  category-tree helpers, open/close, breadcrumbs, Miller columns, filtered
  candidates, grid, detail inspector, apply with scope passthrough, and
  all modal bindings incl. the document keydown Esc/Enter/Tab-trap
  listener). The modal MARKUP stays in dialog.html (chrome, not module
  code).
- **Public API (3)**: `init(deps)` (five injected deps, fail-fast listing
  any missing one on open), `open(roleEntry, initialSelectedId, onApply,
  contextKind)` (exact openMaterialSelector contract), `close()`. The
  onApply callback keeps living inside selectorCtx; no render function is
  exposed.
- **Injected dependencies (5)**: `getMaterialCategories` (call-time
  accessor over the inline `catalogMaterialCategories` — a catalog refresh
  via setCatalog is picked up on the next render, asserted by the focused
  harness), `materialById`, `optionMaterialIds`, `updateMaterialSwatch`
  (shared with the inline material-role rendering), `icon`. The module
  holds NO material catalog copy (structural test refutes
  `var catalogMaterials`/`var catalogMaterialCategories` inside it).
  `catalogMaterials` itself is never directly consumed — only via
  materialById.
- **Audit result**: the ONLY external consumer of the moved block was the
  local fallback inside `renderMaterialSelectors` (triggerVisualPicker).
  The four category helpers had zero usage outside the block. The
  fallback now reads `window.GraneteUI.finishSelector.open(r,
  choices[r.role], …, ctx.context)` with the identical callback body; the
  Ruby path (`window.sketchup.open_material_selector`) stays primary and
  untouched; `material_selector.html` (native dialog) untouched.
- **Preserved quirks** (documented, not fixed): the candidate count copy
  concatenates `" opción" + "es"` producing "opciónes" (pre-existing
  spelling quirk — the harness asserts the exact string verbatim);
  `selectorTitle` is declared and never read; the keydown listener
  registration order relative to the inline `resetPublishConfirm`
  Escape listener changes (module loads earlier) but both handlers are
  independent and both still fire on every Escape, so no observable
  change.
- **Load order**: markup → media → account → library → configurator →
  **finish-selector** → inline bootstrap → #498 runtime. Bindings
  register at module load (markup exists); `finishSelector.init` runs in
  the bootstrap right after `configurator.init`, before
  `renderModelBindingStatus` and `dialog_ready`.
- **Harness migration**: `test/js/support/dialog_scripts.js` loads the
  module between configurator and inline; `dialog_publish_test.js`
  preload chain updated. Audit of existing tests found ZERO assertions on
  the inline modal symbols (the material_selector roundtrip tests cover
  the NATIVE dialog; inspector/ux_states harnesses mock the Ruby bridge),
  so nothing needed repointing — all existing harnesses stay green
  loading the real module.
- **Focused tests**: `test/js/granete_finish_selector_test.js` — 37 tests
  covering registration + idempotent re-execution (single keydown
  listener), exact public API shape, init fail-fast (full + partial),
  open (visibility, badge, search reset, focus), close + opener focus
  restore, configurator/inspector scope-label copy, empty catalog hides
  columns, L1 "Todas"+roots in sortOrder, selected-material path
  auto-expand (L1/L2/L3 + breadcrumb), progressive column clicks, subtree
  filtering, breadcrumb navigation reset, role-allowed resolver contract,
  search by name/code/manufacturer, clear button (reset + refocus), empty
  role / empty search / empty category states, count singular/plural
  (preserved quirk), card rendering (swatch, grain badge, selected check,
  tags) through the injected renderer/icon, click select + Apply enable +
  detail, double-click apply, full ficha técnica (path join, texture 4
  variants, no-code/no-manufacturer fallbacks), apply closes before
  callback with default furniture scope, project scope passthrough,
  cancel/header-close without callback, Escape (+closed no-op), Enter
  apply/disabled/in-search, Tab wrap, Shift+Tab wrap, middle-Tab not
  intercepted, call-time category accessor (catalog refresh picked up).
  Ruby side `test/unit/granete_finish_selector_js_test.rb` (6 tests, 130
  assertions): runs the harness + symbol guards (implementation + header
  live in the module, load order configurator→finish-selector→inline in
  dialog.html AND dialog_scripts.js, monolith carries no modal
  implementation symbol incl. the old `typeof openMaterialSelector`
  fallback, single catalog authority inline, Material Roles helpers stay
  inline, Ruby primary path + module fallback, bootstrap injects the five
  deps before dialog_ready).
- **Move fidelity**: normalized diff (reverse of the five mechanical
  transformations: deps plumbing, `deps.` prefix, local `categories`
  alias) against the removed block shows zero copy/logic differences.
- **Verify** (Homebrew `ruby@3.2` 3.2.11, same vendored-bundle note as
  C4.1–C4.4; no gem or lockfile change): RuboCop 255 files / 0 offenses;
  unit suite 1160 runs, 7983 assertions, 0 failures/errors/skips;
  contract suite 6 runs, 4043 assertions, 0 failures; every Node dialog/
  module harness green; `git diff --check` clean; `verify_affected --plan`
  exit 0 (`sketchup-local-os` = `bundle exec rake verify`, green above).
  RBZ rebuilt by `package:verify`, sha256
  `8572686e6ee42cedcd7691f19fbd30eb66cdf9e93a6ba25d587a85fe9bf4bf50`,
  packages granete-finish-selector.js.
- **Behavior changes: 0** (target). Documented notes: keydown
  registration order (above) and the module's `requireDeps()` fail-fast
  on open — new code path only reachable if init was skipped, which the
  bootstrap now always runs.
- **Real SketchUp host smoke: NOT_RUN** (same phase-level gate).
- **Status**: pre-commit boundary review completed and approved; committed
  as one implementation work unit (`c9976ab2`) and published against main
  as PR #859 (`Refs #848`, `Delivery: partial`, `type:refactor`). Docs-only
  follow-ups advanced the PR HEAD after publication (publication record
  `5a3c7ddb`, then this wording correction); the implementation commit is
  unchanged. Publication exact-head: PASS; CI exact-head: PASS 17/17 incl.
  the three SketchUp Ruby runners — re-verified on every pushed head;
  readback OPEN, non-draft, base main, MERGEABLE. Awaiting human merge.
  **Real SketchUp host smoke: NOT_RUN** (same phase-level gate). C4.6
  Material Roles: NOT_STARTED.


## C4.6 — granete-material-roles.js

Started from `main@ce8af2db48eed78470e6feb254fce6b5095276ba` (post-#859),
branch `refactor/848-dialog-js-material-roles`, fresh worktree
`muebles-worktrees/848-material-roles`. Extraction of the shared
material/acabados authority: `window.GraneteUI.materialRoles` is now the
single owner of the material catalog (materials + categories), the
project-default material choices, role-compatible resolution, default
choice resolution and material role rendering. NOT in scope: the Inspector
slice (its choices/selection/mutation), Model Binding, Project Furniture.

- **Extracted**: `resources/js/granete-material-roles.js` (275 lines
  including the agent-first header). dialog.html went 4,009 → 3,852 lines;
  inline JS 3,037 → 2,869 (the state vars `catalogMaterials`,
  `catalogMaterialCategories`, `projectDefaultMaterials` + the whole
  material helpers block: `materialById`, `optionMaterialIds`,
  `defaultMaterialChoices`, `materialOptionLabel`, `updateMaterialSwatch`,
  `updateMaterialMeta`, `renderMaterialSelectors`). `catalogHardware`
  stays inline (hardware is not this slice).
- **Public API (10, owner-approved names after the boundary review)**:
  `init(deps)`, `setCatalog({materials, categories})`, `getMaterials`,
  `getMaterialCategories`, `materialById`, `optionMaterialIds`,
  `defaultMaterialChoices`, `renderMaterialSelectors`,
  `updateMaterialSwatch`, `setProjectDefaultMaterial` (no legacy aliases:
  no published C4.6 contract existed yet). **Private**: the three state
  vars, `materialOptionLabel`, `updateMaterialMeta`. `updateMaterialMeta` has no
  external consumer → private. `materialOptionLabel` had ZERO consumers
  (src + tests) at extraction time → moved verbatim as pre-existing dead
  code with a documenting comment (removal is its own cleanup, not this
  behavior-preserving slice).
- **Contract clarification (owner-approved)**: the module header states
  that `projectDefaultMaterials` holds TEMPORARY, session-local dialog
  defaults for the current flow — NOT persisted project truth and NOT
  backend business truth. The historical write sites stay distinct (each
  replaced by `setProjectDefaultMaterial(role, id)`, none deduplicated).
- **Inspector context accessors**: `renderMaterialSelectors`' fallback
  heuristic (isInspector/instanceId/definitionId when no `contextInfo` is
  passed) reads `inspectorMaterialsCard`/`inspectorDef`/`selectedContext`
  through injected call-time accessors (`getInspectorMaterialsCard`,
  `getInspectorDef`, `getSelectedContext`) — the C4.4 `isModelConnected`
  pattern. Inspector state stays owned by the Inspector slice; the module
  never writes it. `renderMaterialSelectors` fail-fasts listing missing deps if
  init was skipped (bootstrap always runs init).
- **setCatalog orchestration**: `GraneteDialog.setCatalog` delegates the
  material slice (array branch → `setCatalog({materials: [],
  categories: []})`; object branch → `setCatalog({materials:
  payload.materials || [], categories: payload.materialCategories || []})`)
  and the GraneteState "catalog" projection now reads `materials:
  GraneteUI.materialRoles.getMaterials()` (live array identity — no second
  copy). Project defaults deliberately survive catalog refreshes
  (pre-existing semantics, asserted). The catalogHardware array-branch
  quirk stays untouched.
- **Boundaries**: the Configurator keeps its `libMaterialChoices` snapshot
  and consumes `defaultMaterialChoices`/`renderMaterialSelectors`/
  `materialById`/`setProjectDefaultMaterial` via its existing init deps
  (now sourced from
  materialRoles). The Finish Selector receives
  `getMaterialCategories`/`materialById`/`optionMaterialIds`/
  `updateMaterialSwatch` at bootstrap. `onMaterialChoiceApplied` keeps its 3-branch cross-domain
  routing INLINE (until the Inspector slice); only its shared
  reads/writes migrated (`setProjectDefaultMaterial`,
  `renderMaterialSelectors`, `materialById`). Inspector callbacks keep writing their own
  `inspectorMaterialChoices`; project-scope writes go through
  `materialRoles.setProjectDefaultMaterial`.
- **Ruby-native selector**: `window.sketchup.open_material_selector`
  stays PRIMARY with the exact payload; the `finishSelector.open` fallback
  is call-time. Move fidelity: 154/155 normalized lines verbatim (modulo
  the 4 accessor substitutions); the one residual is the Ruby-selector
  condition split across two lines — formatting only. The post-review
  rename is a pure API-name pass (callsites + tests), no behavior change.
- **Preserved quirks** (documented, not fixed): the "opciónes" concat and
  the dead `selectorTitle` live in the finish-selector module (untouched);
  `materialOptionLabel` dead-but-preserved; the historical
  `project_default` scope alias stays accepted alongside `project`.
- **Load order**: markup → media → account → library → configurator →
  finish-selector → **material-roles** → inline bootstrap → #498 runtime.
  Bootstrap wiring order: account.init → library.init →
  **materialRoles.init** → configurator.init → finishSelector.init →
  btnClose listener → renderModelBindingStatus → configurator.close() →
  dialog_ready.
- **Harness migration**: `test/js/support/dialog_scripts.js` loads the
  module between finish-selector and inline; `dialog_publish_test.js`
  preload chain updated. Repointed (never deleted) asserts:
  `granete_finish_selector_js_test.rb` (single-authority test flipped to
  module ownership + materialRoles wiring),
  `granete_configurator_js_test.rb` (setCatalog delegation +
  renderMaterialSelectors/setProjectDefaultMaterial wiring),
  `granete_library_js_test.rb`
  (material slice delegation + projection), `dialog_library_view_test.rb`
  (renderer asserts point at the module, incl. `material-chevron`).
- **Focused tests**: `test/js/granete_material_roles_test.js` — 30 tests:
  registration/idempotence, exact 10-entry API, catalog set/get live
  identity, reset semantics, defaults survive refresh, materialById
  found/miss, curated/invalid-filtered/all-materials option resolution,
  default choice rules (project default offered / first candidate /
  project default no longer offered / role without candidates), rendering
  visibility/structure/aria, swatch signed media via GraneteUI.media +
  color fallback, meta parts (code/thickness/grain/manufacturer), Ruby
  primary payload + no fallback call, finish-selector fallback + apply
  callback role/id/scope, Enter/Space trigger, context payloads
  (configurator default / inspector via card identity / inspector via def
  identity / explicit contextInfo), `setProjectDefaultMaterial` write
  path, init fail-fast; integrated part: orchestrator object/array payload
  semantics, GraneteState projection live-identity single authority,
  project-scope choice surviving a full refresh, inspector materials
  rendered through the module. Ruby side
  `test/unit/granete_material_roles_js_test.rb` (7 tests, 135 assertions):
  harness green + symbol guards (implementation + header in the module,
  load order finish-selector → material-roles → inline in dialog.html AND
  dialog_scripts.js, monolith carries no material implementation symbol,
  setCatalog delegation + projection, configurator/finish-selector/
  inspector consumption with wiring order materialRoles.init →
  configurator.init → finishSelector.init → renderModelBindingStatus →
  dialog_ready, Ruby-primary/fallback order, no `open_material_selector`
  left in the monolith).
- **Verify** (Homebrew `ruby@3.2` 3.2.11; fresh worktree `vendor/bundle`
  installed frozen — no Gemfile/lockfile change): RuboCop 256 files /
  0 offenses; unit suite 1167 runs, 8104 assertions, 0
  failures/errors/skips; contract suite 6 runs, 4043 assertions, 0
  failures; every Node harness under test/js green; `git diff --check`
  clean; `verify_affected --plan` exit 0 (`sketchup-local-os` = `bundle
  exec rake verify` green above; contracts drift + ci/factory unittest
  suites green). RBZ rebuilt and read back by `package:verify`, sha256
  `8217f0d271946aecd47e9f84e6b7653de901c0ba83f419b659f51dbd5d1c268f`,
  packages granete-material-roles.js (supersedes the pre-rename build
  `209a67fe…` after the owner-approved API-name refinement).
- **Behavior changes: 0** (target). Documented notes: the
  `renderMaterialSelectors` `requireDeps()` guard (new code path only
  reachable if
  init was skipped, which the bootstrap always runs) and the two-line
  reflow of the Ruby-selector condition.
- **Real SketchUp host smoke: NOT_RUN** (same phase-level gate as
  C4.1–C4.5).
- **Status**: the owner approved the pre-commit boundary review on
  2026-09-26 with a naming-only refinement (getCategories →
  getMaterialCategories, defaultChoices → defaultMaterialChoices,
  renderSelectors → renderMaterialSelectors, updateSwatch →
  updateMaterialSwatch, setProjectDefault → setProjectDefaultMaterial;
  init/setCatalog/getMaterials/materialById/optionMaterialIds kept; no
  legacy aliases) plus the session-local projectDefaults header
  clarification. The refinement was applied and the full battery
  revalidated green (tallies above). Committed as one implementation work
  unit (`016b211a84a5064e3944a0abc945e1720e219ba7`) and published
  against main as PR #860 (`Refs #848`, `Delivery: partial`,
  `type:refactor`). Exact-head readback at publication (implementation
  work unit): OPEN, non-draft, base main, headSha == 016b211a…,
  MERGEABLE, issue #848 OPEN + status:approved; CI exact-head: PASS
  16/16; PR Publication exact-head: PASS 1/1 (incl. Foundation Gate A +
  real browser proofs and the three SketchUp Ruby runners). Docs-only
  follow-ups advanced the PR HEAD afterwards (publication record
  `09f65ba4123193681ac6545293776c737ab25ae4`, stale-name corrections
  `e7ae0f97acd4318772c34e17ba2b032690e4a471`, then this evidence wording
  correction); the implementation commit is unchanged. PR exact-head
  check status is tracked live on GitHub — this artifact records only
  the publication-time readback above and never certifies its own HEAD.
  Merge remains human. **Real SketchUp host smoke: NOT_RUN** (same
  phase-level gate).


- Real-host smoke (CEF loading external css/js on macOS AND Windows) is
  required before closing: NOT_RUN until executed.
- No behavior change is in scope; anything discovered broken becomes its own
  issue.
- Remaining Phase B modules after C4.6: inspector, model-binding,
  project-furniture.

## C4.8 — granete-model-binding.js (PRE-COMMIT: awaiting owner boundary review)

Started from `main@3375d658da50d9beea0f6cbbd8a7f5cd40a5b636` (post-C4.7),
branch `refactor/848-dialog-js-model-binding`. Extraction of the Model ↔
Project/Design Binding domain per the owner's C4.8 brief: binding status/
view (#388, nine distinct states), manual bind picker + explicit rebind
review + refresh/adopt, pairing-code entry (#499), publish confirmation/
orchestration UI (#392/#847), publish availability VIEW (#466 projection
consumed call-time, never recomputed) and design-wide validation UX (#731).
Project Furniture (next slice) was NOT started: `lastPfState` and
`requestProjectFurniture` stay inline-owned and the module receives only
the temporary `invalidateProjectFurniture` invalidation seam via init.

- **Extracted**: `resources/js/granete-model-binding.js` (866 lines incl.
  the agent-first header). dialog.html went 3106 → 2376 lines; inline JS
  2089 → 1345 (binding/publish/validation DOM refs 24 + 3 + 3, the four
  copy tables, all binding/publish/validation state and render paths, all
  picker/pairing/publish/validate listeners and the document-keydown
  Escape disarm moved out). **SIZE GATE: 866 > ~800 hard target → STOP
  reported per the brief §3/§34/§36.** The candidate keeps the owner
  #848-specified single module (binding + publish confirm + validación);
  no second module was invented. Excess groups: binding+pairing ≈ 330,
  publish confirm/gate/orchestration ≈ 300, validation UX ≈ 190,
  header/API/plumbing ≈ 46. Owner decides: accept, or approve a
  responsibility split (C4.7 precedent).
- **Public API (10)**: `init(deps)` (injects the shared `showToast` and
  the temporary PF invalidation seam; registers the preflight subscription
  once), `setStatus` (UI/internal state render — the pre-C4.8
  `renderModelBindingStatus`), `onResult`, `onPublishProgress`,
  `onPublishResult`, `onDesignValidationProgress`,
  `onDesignValidationResult`, `onBindingProjects`, `onBindingDesigns`,
  `isConnected` (dep-free Configurator accessor — exact pre-C4.8 closure
  semantics: connection state, not capability). No private rendering
  helpers exposed; every entry has a real consumer.
- **Injected deps (2)**: `showToast`, `invalidateProjectFurniture`. The
  GraneteDialog wrappers delegate with unchanged Ruby-facing names;
  `onModelBindingStatus` stays a small INLINE cross-domain orchestrator
  (module `setStatus` → Commercial Projection `setBinding` → Commercial
  Bootstrap `setBinding` → connected `requestProjectFurniture()`), the
  documented temporary C4.8 → final Project Furniture seam. Commercial
  fan-out inside `handleModelBindingResult` (success + failure fail-closed
  paths) moved verbatim as call-time references — not normalized.
- **Wiring movements (documented, behavior-preserving)**: (a) the document
  keydown Escape→`resetPublishConfirm` listener registers at module load
  instead of mid-inline — same relative order against the other document
  keydown listeners (account popover, finish-selector modal register
  earlier; all fire independently on every Escape), namespace guard keeps
  re-execution from duplicating it; (b) the `window.GraneteState.subscribe("preflight")`
  registration moved from mid-inline into `init()` behind a one-time
  guard — init runs inside the same inline bootstrap pass before any
  preflight slice can be pushed, and the #498 runtime loads AFTER the
  inline script, so in the real host the subscription stays a no-op
  exactly as before (asserted by the focused harness: no GraneteState →
  no subscription; init twice → one subscription).
- **Move fidelity**: mechanical audit extracted the exact moved segments
  from git HEAD (DOM refs 1028–1051, keydown 1143–1147, block 1651–2390;
  714 non-blank lines) and diffed them against the module after
  normalization. Every non-equal opcode maps to one enumerated
  transformation: new header/IIFE/guard/deps/API plumbing, `showToast(` →
  `deps.showToast(`, `lastPfState = null;` → `deps.invalidateProjectFurniture()`
  (+2 seam comment lines), the subscribe block rehoused in
  `registerPreflightSubscription()` with the guard, the Escape listener
  repositioned within the module, and the old "initial unbound render"
  comment relocated (updated) to the bootstrap call site. Zero
  copy/condition-order/payload/copy-string differences; badge classes,
  binding-state order, stale-base arrow, pairing semantics (raw code only
  in the input, trim before send, empty → no bridge call, success clears,
  confirmationFailed, invalid keeps value, not-found/unusable clear,
  `pairing_rebind_requires_new_code` never opens the manual rebind),
  6000 ms arm timer, separate confirm action, `confirmRebind === true`
  only on the explicit rebind, exceptions-only validation cards,
  `validate_design_revision`/`publish_design_revision`/`connect_with_code`
  payloads all byte-identical.
- **Preserved quirks (documented, not fixed)**: `fillSelect` with an empty
  entries array always renders "Sin opciones disponibles" — the passed
  placeholder ("Cargando proyectos…") never shows (pre-existing; now
  asserted verbatim); `btn-bootstrap-project` still fetched by id inside
  the status render; unreachable is a "bound" state showing the saved
  binding card.
- **Harness migration**: `test/js/support/dialog_scripts.js` loads the
  module between inspector and inline; `dialog_publish_test.js` preload
  chain updated (model-binding after inspector, before the state/preflight
  preloads — mirroring dialog.html order). Repointed (never deleted)
  asserts: `granete_material_roles_js_test.rb` (initial render now
  delegates to `window.GraneteUI.modelBinding.setStatus({ state: "unbound" })`)
  and `granete_configurator_js_test.rb` (`isModelConnected` accessor now
  reads the module API). The `granete_configurator_test.js` structural
  ban on `var modelBindingState` remains valid — the state lives in the
  model-binding module, not the configurator.
- **Focused tests**: `test/js/granete_model_binding_test.js` — 46 tests:
  registration + idempotent re-execution (no duplicated element/document/
  subscription registrations), exact 10-entry API, init fail-fast (full +
  partial), all nine binding states with exact copy/badge classes/reason
  append/base label (R-number, id slice, stale arrow, "sin publicar"
  fallbacks), isConnected semantics, PF seam invalidation count + no PF
  state in module (structural), Configurator updateInsertButton seam,
  picker open/list/no-bridge fallback, project+design listing with status
  labels and unauthenticated silence, exact connect payloads
  (confirmRebind false/true), rebind review lifecycle, cancel/refresh/
  adopt, full pairing matrix, publish arm/confirm/cancel/Escape/6000 ms/
  double-click protection/disarmed no-op, blocked gate does NOT disable
  the orchestration (#731), all publicationGate blocked-copy branches,
  progress steps with detail, success (immutable R + toast + refresh +
  exceptions cleared), failure error mapping + retry label + validation
  projection supersede, validation progress/summary singular/plural/
  exceptions-only/select/navigate/no-runtime degradation, preflight
  subscription idempotence + non-preflight slices inert + real-host no-op.
  Ruby side `test/unit/granete_model_binding_js_test.rb` (8 runs, 199
  assertions): runs the harness + symbol guards (header, module owns the
  full state/render set with exact 6000/payload/confirmRebind markers,
  monolith carries no binding implementation symbol, load order inspector →
  model-binding → inline in dialog.html AND dialog_scripts.js, bootstrap
  wiring order, wrappers stay thin delegation with the commercial/PF
  orchestrator intact, lastPfState stays inline-owned, seam wiring
  asserted).
- **Verify** (Homebrew `ruby@3.2` 3.2.11, vendored bundle — same libruby
  linkage note as C4.1–C4.7; no gem or lockfile change): all 29 Node
  harnesses under test/js green; RuboCop 259 files / 0 offenses; unit
  suite 1192 runs, 8648 assertions, 0 failures/errors/skips; contract
  suite 6 runs, 4043 assertions, 0 failures; `git diff --check` clean;
  `verify_affected --base origin/main --plan` exit 0 (conservatively
  expanded by the pre-existing untracked `.codex/`, `.github/hooks/`,
  `plugin-siguiente.md` — not part of this slice); contracts drift +
  ci/factory unittest suites green. RBZ rebuilt + `package:verify`,
  sha256 `c433159288a2c89089da3aa5a6bb84ffa33cf4e9ae018fcbb6f836b17ee04ef3`,
  packages granete-model-binding.js.
- **Behavior changes: 0** (target). Documented wiring movements above.
- **Real SketchUp host smoke: NOT_RUN** (same phase-level gate).
- **Size decision (owner-approved tolerance, NOT a precedent)**: the
  candidate measures 866 lines against the #848 ~800 target. The owner
  reviewed and accepted 866 as within the approximate ~800 tolerance
  (excess ≈ 8%): the module keeps ONE cohesive responsibility (binding +
  publish confirm + validación, exactly the #848 Phase B boundary), the
  excess is contract header/DOM refs/copy tables/plumbing rather than new
  logical complexity, and a split now would introduce an artificial
  frontier with new bidirectional seams. Contrast with C4.7, where 965
  lines exposed a REAL natural boundary (furniture vs child Inspector)
  and the split was therefore approved. No artificial line reduction, no
  compression, no useful-comment removal, no second module, and no
  invented size exception beyond this documented owner decision.
- **Status (owner pre-commit boundary review: APPROVED for
  publication)**: the ratifications below are recorded BEFORE the commit
  — this artifact does NOT claim committed/PR-published/CI-green states
  for its own HEAD (those are future/dynamic remote states): boundary
  ratified exactly as reported (authority + 4 copy tables + 10-entry
  public API + 2 injected deps, no rename); Project Furniture seam
  approved (lastPfState stays inline-owned; the connected reload stays in
  the inline onModelBindingStatus cross-domain wrapper); Configurator
  seam approved (module accessor, updateInsertButton call-time);
  Commercial behavior approved as-is (no normalization, no added
  Bootstrap fan-out); pairing/rebind byte-semantics approved; publish/
  validation defenses approved (6000 ms, armed-first click, separate
  confirm, double-click protection, cancel/Escape disarm, exceptions-only,
  exact FurnitureInstance identity, navigate region "primary");
  GraneteState subscription movement to init() approved as a documented
  wiring movement (same bootstrap pass; real-host no-op preserved;
  harness-with-preload subscription preserved; one-time guard, no
  duplicated listeners on re-init); Escape listener in the module approved
  (one listener, no stopPropagation, no Account/Finish-Selector
  interaction change). Behavior changes: 0. Real SketchUp host smoke:
  NOT_RUN. Project Furniture: NOT_STARTED (final Phase B slice).

## C4.7 — granete-inspector.js + granete-inspector-child.js
## (boundary-adjusted; owner-approved)

Started from `main@9d5638ccb4c401ad69f7fe630b73a0e3dc07b0a0`, branch
`refactor/848-dialog-js-inspector`. After the owner-approved boundary
adjustment (below) the candidate was updated onto current
`main@b2532d457d9d0853869610908801acd3462218b5` (#862 diff verified
PTX/excel/docs only — zero SketchUp overlap, fast-forward kept the
uncommitted work) and re-verified in full from that base. Extraction of the
Inspector surface: the working selection context, top-level routing and
furniture rendering, capability-driven actions, bridge result handlers and
the hardware catalog slice (`granete-inspector.js`) plus the child
part/hardware/aggregate surface with #467 part authoring and #468 hardware
placement/substitution (`granete-inspector-child.js`). **Status: pre-commit
review 2 APPROVED by the owner for commit/publication. The owner ratified
the architecture (main/child boundary, capabilityEnabled shared inline
helper, hardware catalog ownership in the main module, the child
`activeChildContext` same-reference rule) with behavior changes: 0 and Real
SketchUp host smoke NOT_RUN. This section records the STABLE evidence of
the implementation work unit, verified from base `b2532d45`; it does not
self-certify the PR's future exact head — the dynamic exact-head state
(Publication/CI) lives in GitHub.**

- **Public size metrics (baseline = real main `b2532d45` → final, the
  numbers the PR reports)**: dialog.html 3851 → 3106 lines; inline JS
  2869 → 2091 lines (measured from git with the same wc/regex method as
  every C4.x slice; owner-brief estimate said 3852/2867 — the measured
  baseline governs). New modules: `granete-inspector.js` 517 lines,
  `granete-inspector-child.js` 549 lines. Additional context only, NOT a
  baseline: the intermediate single-module candidate measured dialog 3066 /
  inline 2067 / inspector 965.
- **Approved boundary adjustment (owner decision, pre-commit review 1 → 2;
  NOT an exception)**: the first candidate measured 965 lines against the
  hard #848 ≤~800-per-new-JS requirement and was STOPPED. The owner
  approved a responsibility split into a second coherent module — the
  CHILD lane (part/hardware/aggregate rendering, breadcrumb, #467 part
  authoring, #468 hardware placement/substitution) — explicitly rejecting
  a utils/common dump and any additional module, and later RATIFIED the
  split in pre-commit review 2. Behavior changes: 0 (mechanical fidelity
  audit below).
- **granete-inspector.js owns (517 lines incl. header)**:
  selectedContext (sole authority), inspectorDef, inspectorParams,
  inspectorMaterialChoices, catalogHardware (single dialog-side owner:
  setCatalog object branch delegates, array branch preserves the
  historical non-reset, GraneteState projection reads the live
  reference), top-level routing (null/unmanaged/furniture/child
  dispatch), furniture Inspector render, update/delete flows,
  material-choice bridge orchestration, activateInspectorTab,
  selected-context publication to GraneteMutation, manufacturing card
  visibility. Public API unchanged from the audited 11 entries.
  Injected deps (8): the audited 7 + `capabilityEnabled` (§ below).
  Child kinds route through `GraneteUI.inspectorChild.render(context)` —
  the SAME context object, no clone — and every top-level re-render
  drops the lane via `GraneteUI.inspectorChild.hide()` inside
  hideInspectorViews.
- **granete-inspector-child.js owns (549 lines incl. header)**:
  renderChildInspector, renderBreadcrumb, renderChildFacts,
  renderCapabilityList, the child DOM refs (child view, breadcrumb, kind
  badge, origin/owner notes, facts, capabilities, goto-furniture, the
  #468 hw placement/conflict set incl. hwSubstitutionFeedback, the #467
  part authoring set), provenance/origin/owner notes, renderPartAuthoringCard/Feedback,
  partPositionFromInputs, submitPartMutation and all child listeners
  (#468 offset/substitution, #467 move/viewport/duplicate/add/remove,
  granete-mutation-state feedback). Public API (3, all with consumers):
  `init`, `render`, `hide`. Injected deps (3): showToast,
  capabilityEnabled, getHardwareCatalog (call-time accessor — the
  catalog slice stays owned by the main module; verified at call time by
  the focused harness). Child lane state: `activeChildContext` references
  the SAME object the Inspector routed — owner-brief option A: set only
  by render, cleared by hide, never a clone, no second selection
  authority (handlers only fire while the child view is visible, and
  every selection change re-renders or hides the lane, so the reference
  tracks the Inspector's selectedContext exactly). Documented in the
  module header.
- **capabilityEnabled (owner-brief §3 decision, RATIFIED in review 2)**:
  the audit proved it
  pure/stateless (only reads `context.capabilities[name].supported`; no
  module state) and used by BOTH the furniture and child paths. The
  preferred owner (granete-inspector.js) would have required exposing a
  new main-API entry beyond the audited §7 list or a main→child handoff
  API; the owner-brief sanctioned alternative applies — the helper
  returns to its pre-C4.7 single implementation inline in dialog.html
  (its historical location) and is injected into BOTH Inspector modules
  via init. No third helper module; no public-API changes on either
  module. requireDeps on the main module now lists 8 (fail-fast).
- **Bootstrap order**: account.init → library.init →
  **inspectorChild.init** (showToast, capabilityEnabled, call-time
  getHardwareCatalog wrapper) → **inspector.init** (+capabilityEnabled
  dep) → materialRoles.init → configurator.init → finishSelector.init →
  renderModelBindingStatus → configurator.close → dialog_ready. Load
  order: markup → media → account → library → configurator →
  finish-selector → material-roles → **inspector-child** →
  **inspector** → inline → #498 runtime. Child loads before the
  Inspector so the routing resolves `GraneteUI.inspectorChild` at call
  time (both registered before the inline bootstrap; no init cycle, no
  render before init). Ruby/GraneteDialog knowledge unchanged: the five
  Ruby-facing wrappers still delegate ONLY to
  `window.GraneteUI.inspector.*`; nothing Ruby-facing mentions
  inspectorChild.
- **Move fidelity (mechanical line-level audit of the split)**: the
  965-line candidate was reconstructed verbatim and diffed region by
  region against the two modules. Child DOM refs block: identical +
  blank-line separators only. Capability/badge tables: identical + one
  blank line. Renderer block (renderChildInspector →
  renderCapabilityList): exactly 3 enumerated transformations —
  `requireDeps()` + `activeChildContext = context;` inserted at the
  renderChildInspector entry, `catalogHardware || []` →
  `deps.getHardwareCatalog() || []` (1 site), `capabilityEnabled(` →
  `deps.capabilityEnabled(` (4 sites in renderPartAuthoringCard).
  Listener block (btnGotoFurniture, #468 offset/substitution, #467 part
  handlers, granete-mutation-state): byte-identical modulo the single
  enumerated `selectedContext` → `activeChildContext` substitution.
  capabilityEnabled body restored in dialog.html verbatim (modulo
  indent + a new comment). Main module retained code: identical except
  the enumerated requireDeps line, the shared-helper comment tweak, the
  two delegation lines and blank-line collapses around the dropped
  blocks. Zero copy/condition-order/payload/capability-check/timeout/
  listener-count/copy-string differences; selectedContext reference
  semantics proven by the harnesses (mutation ctx === routed context
  object). New lines in both modules: headers, IIFE/namespace guards,
  deps/requireDeps plumbing, the child hide()/API mapping.
- **Preserved quirks / documented notes** (behavior changes: 0): the
  requireDeps fail-fast is a new path only reachable if init were
  skipped (the bootstrap always inits before dialog_ready — C4.5/C4.7-r1
  precedent; child `hide()` stays dep-free like the main accessors);
  child listener registration happens at child-module load (before
  inspector-module load; the same handler count and bodies — same
  independent-handler rationale as C4.7 r1); the child hardware view now
  reads the catalog through the injected call-time accessor, which
  returns the owner's live `catalogHardware` — identical values and
  identity per render; the delegation adds no fallback: if the child
  module were missing, the main module fails loudly (no silent
  degradation).
- **Harness migration**: `test/js/support/dialog_scripts.js` loads the
  child module between material-roles and the inspector (mirrors
  dialog.html); `dialog_publish_test.js` preload chain updated.
  `granete_inspector_test.js` keeps the main-focused coverage (26
  tests; the 8 child-specific tests were REPOINTED, never deleted) plus
  a new routing test proving child kinds delegate with the same
  reference and every other render drops the lane; its structural test
  now also guards the shared capability helper (dialog ×1, injected ×2,
  neither module defines it) and the delegation lines. New
  `granete_inspector_child_test.js` (23 tests) drives the REAL child
  module across the full child minimum list (child general:
  part/hardware/aggregate render, breadcrumb, owner path/scan/ambiguous/
  none, facts, capabilities; hardware: manual/derived/unknown, anchor
  labels, offset prefill, derived lock, replacement compatibility,
  drilling conflict incl. default remediation, offset mutation,
  substitution; part: structural hidden, authorable visible, XYZ
  prefill, per-button capability gating, move, viewport, duplicate/add/
  remove, mutation feedback; plus registration/API, init contract and
  lane hygiene). Structural Ruby: `granete_inspector_js_test.rb` (9
  runs, 195 assertions — threshold 30→25 documented as the repoint, not
  a weakening) now guards delegation-without-child-regrowth; new
  `granete_inspector_child_js_test.rb` (8 runs, 146 assertions) guards
  the child header/ownership, no selectedContext/catalog/materialRoles/
  mutation authority, #467/#468 living here, load order (dialog +
  loader), child init wired before inspector.init, the shared
  capability helper contract, and no child DOM refs in the main module.
  Repointed structural suites re-run individually green:
  granete_library_js_test 5/118, granete_material_roles_js_test 7/137,
  granete_configurator_js_test 6/180, dialog_library_view_test 13/177.
  `dialog_inspector_test.js` integration continues unchanged through
  the real chain: 71 checks green.
- **Verify (from `main@b2532d45`, Homebrew ruby@3.2 3.2.11 vendored
  bundle)**: all 28 Node harnesses green (exit 0). `bundle exec rake
  verify`: RuboCop 258 files / 0 offenses; unit 1184 runs, 8449
  assertions, 0 failures/errors/skips; contract suite 6 runs, 4043
  assertions, 0 failures. RBZ rebuilt + `package:verify`, sha256
  `132c95abc29e518237ecf95744ea9b4f3a77e9ceb746ed00587725ed6e01d4b2`;
  readback confirms BOTH `granete_for_sketchup/resources/js/
  granete-inspector.js` AND `granete-inspector-child.js` inside the RBZ.
  `git diff --check` clean; `verify_affected --base origin/main --plan`
  exit 0 (conservatively expanded by the pre-existing untracked
  `.codex/`, `.github/hooks/`, `plugin-siguiente.md` — not part of this
  slice); openapi drift + repo CI/factory unittest suites pass. Real
  SketchUp host smoke: NOT_RUN (same phase-level gate).
