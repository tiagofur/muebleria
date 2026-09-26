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
- **Status**: pre-commit boundary review requested; NOT committed, NOT
  pushed, no PR, C4.6 NOT started.


- Real-host smoke (CEF loading external css/js on macOS AND Windows) is
  required before closing: NOT_RUN until executed.
- No behavior change is in scope; anything discovered broken becomes its own
  issue.
- Remaining Phase B modules after C4.5: material-roles, inspector,
  model-binding, project-furniture.
