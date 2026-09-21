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

## Review round (CHANGES REQUESTED) — applied

- Blocker fixed: the organization browser e2e seeds (30 `updateDesignWorkingCopy`
  call sites across 16 specs) now write through `putWorkingCopyCurrent`
  (tests/organization/support/api.ts): GET working copy → carry the canonical
  token, mirroring the product writers. Full browser gate re-run:
  **86/86 PASS** (`[organization-gate] PASS`).
- Hardenings applied: unreadable local furniture metadata fails the sync
  closed (`invalid_local_metadata`, no write) instead of reading as a remove
  intent; the no-change path also clears stale authoring-dirty flags; the
  Conflicto/Error card states keep the action enabled (Reintentar).
- New proofs: `test_unreadable_local_metadata_blocks_the_sync_without_writes`
  (unit 894/0) and the strengthened JS error-branch assertion (26/26).

## Review round 2 (R2) — explicit empty authoring values

- Bug: `WorkingCopyMerger.apply_authoring_intent!` guarded on `!empty?`,
  collapsing "key absent" (no authoring statement) with "key present, {}"
  (explicit clear) — an empty materialChoices/parameters could never clear
  the server values, and the metadata writer (`furniture_intent`) had the
  same collapse (empty choices were not persisted at all, making the clear
  unreachable end-to-end).
- New rule (merger + intent writer): key absent → preserve verbatim; key
  present with {} → explicit clear; key present with values → replace.
- Tests RED→GREEN (`design_sync_test.rb`, now 13): clears material choices
  (material-a gone), absent key preserves server choices during a
  parameter-driven update, present-empty parameters replace at the merger
  level (documented: the canonical persisted intent always carries the
  complete normalized set, so {} parameters is reachable only via a future
  canonical reset-overrides form), absent parameters key preserves server
  values verbatim.
- Punto-audit of other nil/absent/{}/[]/"" collapses in #810 code:
  new_working_item (creation-only seed, no server value to preserve);
  definition_id "" guard ("" is not a representable uuid intent);
  authoritative_definition_version nil (the #624 catalog-semver rule);
  IntentBuilder absent-intent → {} (keys absent → preserve, consistent);
  WorkingItem parse/to_contract_h ({} is the wire-canonical decode — the
  absent/present distinction lives in the intent metadata, where it was
  fixed); authoringDirty strict `== true`; equivalence operates on decoded
  items. No other collapse of distinct intentions found.
- Verification: `rake verify` green (unit 897, boundary 6/3251, RBZ
  18161f1a…) and real-host TestUp re-run at this code state: 4/4, 31
  assertions (the writer change touches persisted metadata semantics).

## Review round 3 (R3) — reachable explicit material clear

- Canonical semantics found (step 1): `material_choices` in
  `FurnitureBuilder#update_furniture` is PATCH for Hash maps — the #405
  shared parity contract (`MaterialRebuildTest`) proves partial maps must
  keep every omitted persisted role — and the dialog selector layer is
  patch-by-design ("a selector changes one role"). No canonical clear
  representation existed anywhere (the selector cannot unset a role; no
  reset/clear/remove command; grep found none).
- Loss point: `FurnitureIntent#merge_material_choices` patched the incoming
  map onto the persisted intent, so `{}` (patch identity) could never clear
  — consuming the R2 statement before MetadataWriter.
- Minimal fix: `FurnitureBuilder::CLEAR_MATERIAL_CHOICES` sentinel — the
  explicit total-clear statement at the builder boundary. Semantics now:
  Hash (partial or complete) = patch (#405 intact); sentinel = explicit
  total clear (persists `materialChoices: {}` + authoringDirty, reaches the
  working copy via the R2 rule); nil = no statement (key omitted, server
  value preserved).
- Documented limits: the current UX has NO clear action (every role always
  materializes a material); single-role removal is not representable under
  patch semantics and has no UI — a future replacement-mode UX would need
  its own explicit form (out of scope).
- E2E proof (RED→GREEN, no manual metadata):
  `test_real_authoring_path_clears_material_choices_end_to_end` — real
  `update_furniture(material_choices: CLEAR_MATERIAL_CHOICES)` → persisted
  `materialChoices == {}` + `authoringDirty` → Synchronize Design →
  WorkingCopy `material_choices == {}` (material-a gone) → dirty cleared.
- Verification: unit 899/0 (patch contract tests green), `rake verify`
  green (RBZ 3eccc221…), real-host TestUp re-run at this state: 4/4, 31
  assertions.

## REAL HOST result

PASS — SketchUp 2026 (arm64), TestUp CI via
`-RubyStartupArg "TestUp:CI:Config:…/testup-ci-810.yml"` against the installed
deterministic RBZ at the FINAL code state (sha256 6d1d9ad0…):
`progress/host_smoke_810_testup_ci.json`
— 4/4 tests, 31 assertions, 0 failures, 0 errors (re-run after the review
round so the evidence matches the final code)
(`TC_DesignSyncSmoke`: golden sequence place→sync→edit width→move→delete→sync
[update FI-001 + conscious remove FI-002 through the accepted V2 token],
delete→re-place reuses FI-002 without a third identity, diverged conflict
surfaces without overwriting [1 PUT only, dirty flag preserved], and
save/close/reopen keeps identity + pending authoringDirty). Operational note:
SketchUp restores the previously installed RBZ at quit — each host run
re-copied the fresh `dist/` build into Plugins before launching.


