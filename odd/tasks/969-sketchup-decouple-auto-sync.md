# #969 — Decouple Live Design Auto-Sync from Project Panel Lifecycle & Guard In-Flight Syncs

## Objective and authority

Address the lifecycle, decoupling and concurrency gaps identified after [#677](https://github.com/tiagofur/muebleria/issues/677) (PR #968) under the portable G-ODD contract. Tracked in [#969](https://github.com/tiagofur/muebleria/issues/969).

### Context & findings
1. **P1 — Auto-sync tied to Project tab**:
   `scheduleDebouncedSync` checked `if (lastPfState !== "connected") return;`. `lastPfState` starts as `null` and only populates if the user visits the Project tab. Editing furniture exclusively in Inspector never triggered auto-sync.
2. **P1 — In-flight sync race on invalidation**:
   `invalidate()` cleared the local debounce timer, but did not guard against `synchronize_design` already in flight. Late responses arriving after model switch or disconnect could mutate projection or UI on an invalid context.
3. **Parity fix**:
   Backend strictly requires 100% key parity between `material_choice_modes` and `material_choices`. Partial role sets cause HTTP 400.
4. **Test gaps**:
   Need end-to-end tests for `granete-mutation-state` CustomEvent, Inspector editing without Project tab opened, in-flight invalidation token, and Presentation mode silence.

## Tasks

- [ ] T1 — **RED Unit Tests (JS)**:
  - Add test: Auto-sync calls `synchronize_design` when binding is connected and Project tab was never rendered.
  - Add test: Dispatching `granete-mutation-state` CustomEvent (`phase: "committed"`) schedules debounced sync.
  - Add test: Invalidation during in-flight sync discards response and prevents projection refresh or furniture reload.
  - Add test: Presentation Mode silent auto-sync executes without toast.
- [ ] T2 — **Decouple Auto-Sync & Guard In-Flight Syncs**:
  - In `granete-project-furniture.js`, replace `lastPfState !== "connected"` guard with authoritative binding connection check.
  - Implement `syncGeneration` token incremented on `invalidate()`; validate generation upon receiving sync response.
- [ ] T3 — **Contract Parity Hardening**:
  - Verify `WorkingItem#to_contract_h` full key parity for material choice modes.
- [ ] T4 — **Full Verification & Packaging**:
  - Run Node JS test suite: `node apps/sketchup-extension/test/js/granete_project_furniture_test.js`
  - Run Ruby verification suite: `bundle exec rake verify`
  - Verify and build deterministic `.rbz`.
