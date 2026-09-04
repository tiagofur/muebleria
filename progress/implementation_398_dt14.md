# Implementation Report: F211 / #398 (DT-14) — End-to-End Digital Thread Contract & Regression Gate

- **Date**: 2026-09-04
- **Feature**: F211 — `Add end-to-end Digital Thread contract and regression suite (#398 / DT-14)`
- **Branch**: `feat/398-digital-thread-e2e-regression-gate`
- **Goal**: Establish the definitive automated regression gate across all layers proving that the complete Digital Thread (#385 through #395) operates deterministically, immutably, and securely as ONE system.

---

## 1. Summary of Changes

### A. Contract Fixture
- **`contracts/digitalThreadE2E.json`**:
  - Declares canonical identities for Organization, Project, Definitions (`gabinete1p`, `cajonero3c`).
  - Formalizes Scenarios A–G and Invariants I1–I9 across:
    `Quote -> QuoteRevision -> FurnitureInstance -> Design -> SketchUp -> WorkingCopy -> DesignRevision -> Reconciliation -> Requote -> Approval -> ProductionRelease`.

### B. Go Storage & Backend Integration Suite
- **`backend-go/internal/storage/digital_thread_e2e_test.go`**:
  - Full automated coverage of Scenarios A–G with direct PostgreSQL execution, RLS `granete_app` app-role isolation, and immutable DB triggers:
    1. `TestDigitalThreadE2E_ScenarioA_QuoteFirst`: Quote lines expand into physical units, SketchUp working copy syncs and modifies parameters, R1 published, non-blocking reconciliation identifies modifications, requote produces accepted Q2, approved R1 releases to P1, subsequent R2 leaves P1 immutable.
    2. `TestDigitalThreadE2E_ScenarioB_QuantityGreaterThanOne`: Quote line `qty = 3` expands into 3 distinct physical `FurnitureInstance` IDs; placing 2 flags the 3rd as `quoted_not_modeled` (blocking release).
    3. `TestDigitalThreadE2E_ScenarioC_DesignFirst`: Unquoted catalog insertion creates `FurnitureInstance` with `origin: design`, reconciliation flags `modeled_not_quoted`, requote incorporates it into commercial revision.
    4. `TestDigitalThreadE2E_ScenarioD_DuplicateIdentity`: duplicate identity in the committed working copy fails closed (`UpdateDesignWorkingCopy` rejects); server duplicate command allocates a new UUID with `origin: duplicate` preserving the original. Host-side detection (`ManagedFurniture.locate` duplicates count) and resolver contract are proven by the Ruby unit suite (`test_scenario_d_*`).
    5. `TestDigitalThreadE2E_ScenarioE_SemanticScope_UnmanagedExclusion`: Raw CAD geometry (faces, loose edges, decoration groups) excluded from revision manifest and SHA-256 fingerprint.
    6. `TestDigitalThreadE2E_ScenarioF_Concurrency_StaleBaseRejected`: Publishing against stale base returns 409 conflict, leaves current revision intact.
    7. `TestDigitalThreadE2E_ScenarioG_ReleaseDurability`: ProductionRelease pinned to exact approved revisions stays byte-identical after `R4`/`R5` are published. SQL-level release immutability (trigger `protect_production_release_immutability`) is proven by the #395 suite (`TestProductionRelease_ReleaseRowsAreImmutableHistory`) and consumed here; this gate re-proves only pin durability.
    8. `TestDigitalThreadE2E_DeterministicFingerprintParity`: Identical model state produces identical SHA-256 fingerprint; spatial moves preserve manufacturing fingerprint; parameter changes alter fingerprint.
    9. `TestDigitalThreadE2E_NegativeProofs`: Cross-project reconciliation and release rejected; fake/unallocated UUID fails closed; multi-tenant RLS prevents foreign org access; accepted quote revisions cannot be mutated via SQL update.

**Scope boundaries — proofs consumed from the focused suites** of #385–#395, not re-proved by this gate:

- **Idempotency** (create/duplicate/publish/requote/approve/release with the same key): #385 materialize convergence, #392 idempotent finalize per session, #395 `TestProductionRelease_ApprovalLifecycleAndIdempotency`.
- **Historical reconciliation stability** (reconcile(Q1,R1) result unchanged once Q2/R2 exist): #393 `TestReconciliation_HistoricalQuote_OldQuoteRevisionStaysOld`.
- **Join strictly by `FurnitureInstance.id`** (never name/definition/geometry/array/transform): #385/#393 identity suites; this gate's joins all use explicit FI IDs.
- **`.skp`/manifest/preview artifact lifecycle and immutability**: #392 `FinalizeDesignPublish` suite. The Go E2E publishes via the direct snapshot path (`PublishDesignRevision`, #387); the staged artifact path is consumed, not duplicated (see gate doc §4).

### C. SketchUp Ruby Extension Contract & Host TestUp Suite
- **`apps/sketchup-extension/test/unit/digital_thread_contract_test.rb`**:
  - Unit tests proving client-side contract compliance:
    - Quote-first parameter fidelity and manifest generation.
    - Quantity > 1 placed subset filtering in manifest builder.
    - Duplicate detection and resolution using server authority (`origin: duplicate`).
    - Unmanaged geometry exclusion from manifest.
    - ComponentDefinition vs ComponentInstance hierarchy: nested sub-parts do not produce root furniture instances.
    - Deterministic manifest serialization.
    - Fail-closed verification on corrupted or unknown server session responses.
- **`apps/sketchup-extension/test/testup/TC_DigitalThreadE2ESmoke.rb`** — **EXECUTED in real host, PASS (see §4)**:
  - TestUp host smoke proving in a real SketchUp process:
    - Authoritative backend `furnitureInstanceId` stamped in native hierarchy; unmanaged walls/decoration excluded from the manifest.
    - Host-created duplicates detected loudly AND resolved by the REAL `Connection::DuplicateResolver` executing inside SketchUp (server boundary via controlled doubles — no live backend network in TestUp, per host convention): original keeps FI-001, copy receives server-allocated FI-NEW with `origin: duplicate` + `originFurnitureInstanceId: FI-001`, exactly one idempotency-keyed duplicate command, collision disappears (duplicates == 1 for both identities), and both identities survive save/close/reopen.
    - Model binding and placed furniture identities survive save, close, and reopen.
  - Evidence: `progress/host_smoke_F211_testup_ci.json` (+ `host_smoke_F211_testup_ci_stdout.txt`).

### D. Canonical Documentation
- **`docs/architecture/digital-thread-e2e-regression-gate.md`**:
  - Complete reference for the regression gate, scenario matrix, invariant enforcement layers, and execution commands.

---

## 2. Verification Results

- **Go Storage Suite**:
  - `go test -v -run "TestDigitalThreadE2E" ./internal/storage` -> **PASS** (9/9 passing, 7.7s).
  - `go test ./internal/storage` -> **PASS** (100% passing across all 119 migrations).
- **Ruby Extension Suite**:
  - `bundle exec rake verify` -> **PASS**:
    - Syntax: OK
    - RuboCop: 102 files inspected, 0 offenses detected.
    - Unit tests: 403 runs, 3223 assertions, 0 failures, 0 errors, 0 skips.
    - Boundary tests: 3 runs, 1599 assertions, 0 failures, 0 errors, 0 skips.
    - Deterministic RBZ package verification: Verified.
- **Real SketchUp host (TestUp)**: **PASS** — executed 2026-09-04 on SketchUp 2026 (26.2.242, macOS 26.6.2, arm64, Ruby 3.2.2) against the installed RBZ (sha256 `2e8765fa…`): **3/3 tests, 47 assertions, 0 failures, 0 errors**. Evidence: `progress/host_smoke_F211_testup_ci.json` (TestUp::CIJsonReporter + `_context` block; paths sanitized) and `progress/host_smoke_F211_testup_ci_stdout.txt`. CI cannot reproduce this layer — it remains `REAL_HOST_REQUIRED` for CI runs.

---

## 3. Final host closure (2026-09-04)

Round 3 (final #398 host-proof closure) extended the smoke and executed it in the real host:

1. **Duplicate scenario now exercises the REAL resolver**: `test_digital_thread_duplicate_detection_and_resolution_in_host` performs native host copy → collision detected (duplicates == 2) → `Connection::DuplicateResolver#rescan_and_resolve` executes inside SketchUp with controlled server doubles (`HostDuplicateServiceDouble` returns the server-allocated FI-NEW; `HostModelBindingServiceDouble` answers binding validation) → asserts original keeps FI-001, copy gets FI-NEW (`origin=duplicate`, `originFurnitureInstanceId=FI-001`), exactly one idempotency-keyed duplicate command (`dup:project:design:FI-001:<persistent_id>`), collision gone (duplicates == 1 for both), and both identities + provenance survive save/close/reopen.
2. **The real host exposed and we fixed two latent smoke defects** (the smoke had never executed before):
   - `catalog_definition` used `'id'`/integer `version` keys — `MetadataWriter` maps `furniture_definition_id` → `intent.furnitureDefinitionId` (bounded opaque string); adopted the host-proven shape from `TC_ProjectFurnitureSmoke`.
   - `reopened_binding.bound?` — the real `ModelBinding::Binding` exposes `valid?`, not `bound?`.
3. Result: **Success, 3/3 tests (47 assertions), green** — evidence recorded per the repo convention.

---

## 4. Review round 1 (2026-09-04) — corrections applied

Independent review (`progress/review_398.md`) returned CHANGES_REQUESTED; the following fixes were applied on the same branch:

1. **TestUp smoke made executable**: `Library::FurnitureBuilder.new` (nonexistent class) -> `Model::FurnitureBuilder.new(metadata_store: metadata_store)` — without `metadata_store:` the placement never stamps Granete identity metadata and every smoke assertion would fail. Host layer reported `REAL_HOST_REQUIRED` until TestUp evidence exists.
2. **Scenario F hardened**: stale-base publish must fail with the typed `domain.ErrDesignRevisionConflict` (the old `strings.Contains` branch was a no-op), and post-rejection state is asserted — head remains R2, exactly 2 revisions (no stale R3), zero finalized `design_revision_artifacts`.
3. **Scenario C negative proof**: re-quote asserts the project's FurnitureInstance set is identical before/after (no FI-E is ever allocated).
4. **Gate doc completed**: layer-status table (host = `REAL_HOST_REQUIRED`), consumed-from-focused-suites list, publish-path boundary (direct snapshot path vs #392 artifact finalize), Scenario G step 4 re-attributed to #395, `DATABASE_URL` local-skip note, fixtures/golden no-snapshot-blessing policy.
5. **Honest attribution**: ledger/notes no longer claim idempotency, historical reconciliation stability or join-by-identity as proofs of THIS gate (they are consumed from #385/#392/#393/#395); Scenario D/G descriptions now match what the delivered tests actually exercise.
6. **Invariant numbering disambiguated**: canonical I1–I14 (spec §3) vs gate matrix G1–G9 vs contract fixture C1–C9; Go failure messages and Ruby test names updated accordingly.
