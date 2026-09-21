# 810 Authoritative and lossless SketchUp Design WorkingCopy synchronization

Issue: #810 — [P0][SU-SYNC] Authoritative and lossless SketchUp Design WorkingCopy synchronization
Base: origin/main @ 7430182975be989e14b422422c265c49f7922578
Branch: feat/810-su-sync-working-copy (worktree .worktrees/feat-810-su-sync-working-copy)
Status: in progress

## Scope

- Conflict-safe WorkingCopy write boundary: `expected_working_version` (canonical workingVersion
  token = working-copy `updated_at` RFC3339Nano, same token already consumed by
  CommercialProjection/Q1) required on `PUT /designs/{id}/working-copy` and
  `working-copy:reset`; validated under the authoritative write lock; mismatch → typed 409
  VERSION_CONFLICT, zero overwrite. No new integer version column, no ETag migration.
- All existing WorkingCopy writers honor the precondition (placer/confirm, PositionSyncCoordinator
  ×3, publish pre-sync, duplicate resolver, reset). No legacy bypass.
- Explicit single "Synchronize design" operation in the extension: validate binding → GET WC +
  token → scan ONLY managed top-level furniture → local semantic state → diff vs server →
  add/update/delete Design intent → conflict-safe PUT → authoritative readback → synchronized →
  CommercialProjection refresh. New state built from `server WC + dirty local intent`, preserving
  verbatim unmodified fields.
- Delete = conscious Design intent: WC loses the item, Project keeps the FurnitureInstance, panel
  derives pending/unplaced, re-place reuses identity (no FI-003).
- Real parameter/material update on sync (no publish required); move/rotate stays on the existing
  transform sync, now under the same frontier.
- Retry/lost-response: 409 → GET + semantic readback; equivalent → synchronized; diverged →
  conflict surfaced, never overwrite.
- Minimal sync UI states (dirty count + Sincronizar/Sincronizando/Sincronizado/Conflicto/Error);
  success only after readback. Price: main total = confirmed WorkingCopy projection; stale badge
  while dirty; no price calc in Ruby/HtmlDialog.
- React stays reader; manual refresh reads the same state.
- Tests: Go real-PG concurrency (W1/W2, no-new-revision case, removal keeps furniture_instances,
  missing precondition), Ruby golden E2E per issue DoD, retry/lost-response, JS dialog tests,
  OpenAPI drift + fixture parity, React refetch test, real-host TestUp if available (else
  REAL HOST: NOT_TESTED).

## Exclusions

#679 keeps owning downstream: event stream/SSE, cross-client invalidation, automatic/debounced
sync, reconnect/event freshness. Also out: #390 full design-first insertion, #391 copy identity,
#718 SketchUp-first bootstrap, Proyectar, Presentation mode, new QuoteRevision as primary value,
ProductionRelease, PTX/CNC, big UI redesign, batch editing, Design defaults, new ERP flow.
No merge, no self-approval, no auto-close.

## Tasks

- [x] Issue #810 created (status:approved, critical, assignee) — ownership registered.
- [x] Worktree feat/810-su-sync-working-copy from origin/main @ 7430182975be, clean tree.
- [x] Read affected sources (extension AGENTS, Go handler/storage, OpenAPI contract, Ruby writers).
- [x] RED backend conflict tests (real PostgreSQL) → GREEN.
- [x] Implement expected_working_version (PUT + reset) + regenerate contracts + fixture parity.
- [x] Thread token to all Ruby writers + 409 convergence (DesignSync::SafeWrite).
- [x] Retry/lost-response tests (converges / diverges / 428 / duplicates / clean noop / unbound).
- [x] Synchronize design operation (diff add/update/delete, verbatim preserve, authoringDirty).
- [x] Delete → pending restoration + re-place identity reuse (golden sequence test).
- [x] Parameter/material update (rule C; merge owns dirty fields only).
- [x] Move/rotate under same frontier (coordinator SafeWrite + readback).
- [x] Minimal sync UI (card + states + button + JS harness tests).
- [x] CommercialProjection refresh post-sync (notify :full + GraneteCommercialProjection.refresh).
- [x] Golden E2E (Ruby design_sync 8 tests) + React refetch test.
- [x] TestUp real host smoke written + config testup-ci-810.yml (run: see Evidence).
- [x] Docs: sketchup-host-reconciliation.md §6bis + project-design-digital-thread.md frontera #810.
- [x] Freeze candidate + independent review.
- [x] PR published for review (no merge).

## Evidence

- Go (real PostgreSQL, container muebles-postgres :5445):
  `go test ./internal/...` full — ok. New `working_copy_write_boundary_test.go`
  (5 tests): stale writer cannot overwrite (W2 intact, zero new revisions —
  version-only detection), precondition required (nil→428 semantics, zero-token
  divergence), item removal keeps furniture_instances active (Project owns
  identity), 5 concurrent writers → exactly 1 success + 4 typed conflicts,
  reset requires the current token.
- API: `TestHandleDesignWorkingCopy_PreconditionAndTypedConflict` (428/400/409
  VERSION_CONFLICT) + fixture `missingPreconditionRequest` scenario
  (`TestWorkingCopyContractFixture_MissingPreconditionRejected`); PUT/Reset
  handler tests carry the token.
- OpenAPI: `pnpm openapi:generate` regenerated (TS + Go); `check_openapi_drift.py`
  → "OpenAPI generated files are current; operation drift negative proofs passed".
- Ruby: `bundle exec rake verify` GREEN — rubocop 0 offenses; unit 893 runs /
  0 failures (incl. new `DesignSyncTest` golden sequence + frontier cases);
  boundary 6 runs / 3251 assertions; deterministic RBZ sha256
  925cb36baa26ba5f3f9346d78ab65a71417c68971db45b7c7087e2176945b576.
- JS harness: `dialog_project_furniture_test.js` 26/26 (6 new #810 sync-card
  cases: dirty/clean/busy/success/conflict/error).
- React: `pnpm --filter @granete/ui test` 175 files / 1969 tests green (new
  #810 manual-refresh test asserting the query cache observes the confirmed
  WorkingCopy: updated_at + width 750 + item count). `pnpm typecheck` green.
- Real host TestUp: TC_DesignSyncSmoke (golden sequence, delete→re-place
  identity reuse, diverged conflict never overwrites, save/close/reopen dirty
  persistence) — see REAL HOST result below.

## REAL HOST result

PASS — SketchUp 2026 (arm64), TestUp CI via
`-RubyStartupArg "TestUp:CI:Config:…/testup-ci-810.yml"` against the installed
deterministic RBZ (sha256 925cb36b…): `progress/host_smoke_810_testup_ci.json`
— 4/4 tests, 31 assertions, 0 failures, 0 errors
(`TC_DesignSyncSmoke`: golden sequence place→sync→edit width→move→delete→sync
[update FI-001 + conscious remove FI-002 through the accepted V2 token],
delete→re-place reuses FI-002 without a third identity, diverged conflict
surfaces without overwriting [1 PUT only, dirty flag preserved], and
save/close/reopen keeps identity + pending authoringDirty). Operational note:
SketchUp restores the previously installed RBZ at quit — each host run
re-copied the fresh `dist/` build into Plugins before launching.


