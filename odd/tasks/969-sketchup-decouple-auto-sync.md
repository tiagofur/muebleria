# #969 — Decouple Live Design Auto-Sync from Project Panel Lifecycle & Guard In-Flight Syncs

## Objective and authority

Address the lifecycle, decoupling and concurrency gaps identified after [#677](https://github.com/tiagofur/muebleria/issues/677) (PR #968) under the portable G-ODD contract. Tracked in [#969](https://github.com/tiagofur/muebleria/issues/969).

### Context & findings
1. **P1 — Auto-sync tied to Project tab**:
   `scheduleDebouncedSync` checked `if (lastPfState !== "connected") return;`. `lastPfState` starts as `null` and only populates if the user visits the Project tab. Editing furniture exclusively in Inspector never triggered auto-sync.
2. **P1 — In-flight sync race on invalidation**:
   `invalidate()` cleared the local debounce timer, but did not guard against `synchronize_design` already in flight. Late responses arriving after model switch or disconnect could mutate projection or UI on an invalid context.
3. **Parity fix**:
   Backend strictly requires 100% key parity between `material_choice_modes` and `material_choices`. Partial role sets cause HTTP 400 (`ValidateDesignMaterialChoiceModes`, `backend-go/internal/domain/design.go`).
4. **Test gaps**:
   Need end-to-end tests for `granete-mutation-state` CustomEvent, Inspector editing without Project tab opened, in-flight invalidation guard, and Presentation mode silence.

## Tasks

- [x] T1 — **RED Unit Tests (JS)**:
  - Add test: Auto-sync calls `synchronize_design` when binding is connected and Project tab was never rendered.
  - Add test: Dispatching `granete-mutation-state` CustomEvent (`phase: "committed"`) schedules debounced sync.
  - Add test: Invalidation during in-flight sync discards response and prevents projection refresh or furniture reload.
  - Add test: Presentation Mode silent auto-sync executes without toast.
- [x] T2 — **Decouple Auto-Sync & Guard In-Flight Syncs**:
  - In `granete-project-furniture.js`, replace `lastPfState !== "connected"` guard with authoritative binding connection check (`deps.isModelConnected` → `window.GraneteUI.modelBinding.isConnected`, wired in `dialog.html`; the Ruby `Synchronizer` resolves binding + working copy call-time, so no Project-tab render is required).
  - Guard in-flight responses. REVIEW CORRECTION: the first cut used a `syncGeneration` token in one shared slot — a newer sync starting after `invalidate()` overwrote the slot and let the stale response pass the guard. Replaced by a drain counter: `invalidate()` arms exactly one discard per outstanding response (repeated binding-status renders never double-arm), and `handleSynchronizeDesignResult` drains stale responses FIFO before any handling, recovering the card through the standard panel reload when no newer sync owns the panel.
- [x] T3 — **Contract Parity Hardening**:
  - Verify `WorkingItem#to_contract_h` full key parity for material choice modes: partial/obsolete role sets are normalized to `choices.each_key` with unknown/missing modes defaulting to `'override'` (the same documented convention as `build_material_choice_modes` for new items); absent/empty modes keep the legacy absent shape.
- [x] T4 — **Full Verification & Packaging**:
  - Run Node JS test suite: `node apps/sketchup-extension/test/js/granete_project_furniture_test.js`
  - Run Ruby verification suite: `bundle exec rake verify`
  - Verify and build deterministic `.rbz`.

## Evidence (2026-10-02, correction round after fresh review of `bca70921`)

- JS focused harness: `node apps/sketchup-extension/test/js/granete_project_furniture_test.js` → 57/57 pass (53 at `bca70921` + race/no-double-arm/double-stale/auto-failure-silence coverage; the auto-conflict toast expectation was corrected to presentation-mode silence).
- All 30 extension JS suites pass, including `dialog_project_furniture_test.js` (27) and `granete_model_binding_test.js` (46).
- Ruby: `bundle exec rake verify` → 1309 runs, 9569 assertions, 0 failures / 0 errors / 0 skips (plus 6-run structural suite, 3855 assertions).
- Ruby unit: `test/unit/working_copy_contract_test.rb` → 2 runs, 9 assertions green (the `refute … if …` line was replaced by direct key-absence refutations for nil and empty modes).
- Deterministic package: `rake verify` built and read back `dist/granete_for_sketchup.rbz`, sha256 `0469de5ed8ce405d9d56ce973d6251dde25dc50ce5343837863c903030a4b85a` (reproducibility proved inside the run).
- Remote: CI 17/17 pass at `bca70921` (including SketchUp Ruby × 3 OS and Publication metadata). The correction commits re-trigger CI on the new HEAD; results recorded in PR #970.

## NOT_RUN / out of scope

- Real-host (SketchUp live / TestUp) smoke: NOT_RUN — the issue's acceptance pins unit-level tests for the four behaviors; the dialog module is covered by its focused harness and the CI Ruby suite. A host-assisted pass remains owner-optional before merge.
- Live `granete-mutation-state` dispatch from a real model switch: covered at unit level (CustomEvent harness); not exercised in a live host session.
