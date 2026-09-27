# #830 — Align base-treatment choices with frozen pricing context

## Objective

One coherent base-treatment authority from accepted quote to frozen release
BOM: when a ProductionRelease pins an accepted QuoteRevision, the per-unit
`QuoteCommercialPricingContext` frozen in that exact revision (BaseMode +
BaseClearanceMm + PlinthSides, as one unit) governs manufacturing resolution —
never the mutable Project, `project_items`, current module defaults, dimension
heuristics or an implicit "latest accepted quote". Quote-less releases keep
the module `BaseMode` of the same consistent catalog snapshot. Preflight,
production approval and `CreateProductionRelease` consume the SAME authority.

## Problem and evidence (audit at `3eaf22c6`)

- Pricing freezes the EFFECTIVE base mode per unit:
  `buildInitialQuoteCommercialSnapshot` → `ResolveBaseContextForItem` →
  `ResolveBaseModeWithContext(module, baseContext)` → stored in
  `QuoteCommercialUnit.PricingContext.BaseMode` (`quote_commercial_snapshot.go:193`).
- Manufacturing resolution drops it: `ResolveBomForRelease` calls
  `resolveBomCommon(..., baseContext=nil)` (`engine/resolve.go:108`) → module
  default wins.
- #826's `IntersectConsumedOptionChoices` intentionally retains
  ZOCLO/ZOCLO_PERFIL/PATAS choices; the strict consumed-choice gate
  (`validateReleaseUnitChoices`) then rejects them whenever the module default
  consumes a different role set than the frozen quoted mode — pinned as a
  "known conservative limit" in `material_choice_consumption_test.go:91-98`.
- `enforceProductionGates` knows the exact QuoteRevision but
  `evaluateReleaseManufacturingReadiness` never receives it.
- `EvaluateDesignRevisionPreflight(designID, revisionID)` has no quote
  parameter; the HTTP endpoint has no web consumers today (generated client
  only), so extending it with an explicit optional quote is safe.

## Product policy (human-authorized in the mission brief)

- **A. Quoted release**: frozen `QuoteCommercialPricingContext` of the exact
  accepted QuoteRevision is the authority (mode + clearance + plinth sides as
  one coherent unit). Missing/invalid/incomplete frozen context or missing
  exact unit binding → BLOCK (fail closed); the remedy is a new modern quote,
  never re-filling history from the live catalog.
- **B. Quote-less release**: authority is `module.BaseMode` of the same
  consistent catalog snapshot used to resolve manufacturing (a manufacturing/
  catalog authority, not commercial). Incompatible choices BLOCK honestly; the
  mode is never changed to absorb choices.
- **C. Legacy quoted snapshots** may not silently degrade to quote-less: quoted
  + missing/invalid frozen base context → BLOCK.

## Design decisions

1. **No second plinth engine.** `ResolveBaseModeWithContext` /
   `ResolveBaseClearanceWithContext` / `applyBaseTreatment` already implement
   context-over-module. The fix is authority plumbing.
2. **Shared abstraction**: `engine.ReleaseResolutionContext` — per-exact-
   FurnitureInstanceID frozen `BaseResolutionContext` map. nil = quote-less.
   Constructor validates modes (fail-closed); lookup by exact identity, never
   index/name/position; unknown identity under a quoted authority fails closed.
3. **One gate path**: `evaluateReleaseManufacturingReadiness` gains the quote
   revision id; it loads the frozen base authority from the exact revision's
   immutable commercial snapshot and threads it into
   `ResolveReleaseCollection`. Release, production approval and preflight all
   call this single chain (preflight↔release parity, #727 style).
4. **Preflight API — Option 1 (explicit quote)**: the preflight endpoint
   accepts an optional `quoteRevisionId` in the request body, mirroring
   `CreateProductionRelease`. No implicit latest-accepted resolution. Quote-less
   call (no body / no id) keeps the module-default policy. OpenAPI + generated
   Go/TS clients updated with full parity.
5. **Typed errors**: `domain.FrozenBaseContextError` with cause
   `frozen_base_context_missing | frozen_base_context_invalid |
   frozen_base_context_unit_mismatch`, business-safe Spanish reason, exact
   physical identities. New preflight issue code `frozen_base_context`
   (OpenAPI enum +1). 409 blocker payloads, never 500, never SQL internals.
6. **Traceability §10 without duplication**: the release row pins the exact
   QuoteRevision; the frozen manufacturing snapshot embeds the resolved BOM
   (whose synthesized zócalo/patas content demonstrates the governing mode) and
   per-unit choices. No second copy of QuoteCommercialSnapshot.
7. **Consistency boundary**: the frozen authority is loaded inside the same
   `WithinTenantTx`/`WithConsistentCatalogTx` transaction as catalog capture
   and release resolution — no cross-moment authority mixing.

## Exclusions / non-goals

#826 converge-at-write behavior, general pricing, taxes/discounts, PTX, CNC,
SketchUp, #848, warehouse, project status, Change Orders, dashboards, machine
outputs, no mega-refactor of the release engine, no new DesignRevisionItem
base-mode freeze (that would create a third authority).

## Tasks

- [x] T1 — RED engine: pricing BOM under frozen context Y ≠ release BOM under
      module default X (plinth_board→ZOCLO, plinth_strip→ZOCLO_PERFIL,
      legs→PATAS), strict gate rejects retained choices. Observed 3/3 RED at
      `c6cfb8d6^` ("release unit choice … is not consumed").
- [x] T2 — RED storage (real PostgreSQL): Q3 frozen plinth_board + retained
      ZOCLO choice → `CreateProductionRelease` failed with
      "choice ZOCLO is not consumed" (canonical runner, granete_app role).
- [x] T3 — Engine authority: `ReleaseResolutionContext` (+constructor
      fail-closed, exact-identity lookup) threaded through
      `ResolveReleaseCollection` → `resolveReleaseUnitOpt` →
      `ResolveBomForRelease`. `ConsumedOptionRoles` now counts
      base-treatment-synthesized hardware lines so legs/plinth_strip consume
      their choices under the governing mode.
- [x] T4 — Storage loader + gates: `loadReleaseBaseAuthority` (snapshot
      parse fail-closed → typed causes), readiness chain carries the exact
      quote id; `validateQuoteRevisionBaseline` shared by release/approval/
      preflight.
- [x] T5 — Preflight explicit quote: optional `quoteRevisionId` body
      (EvaluateDesignRevisionPreflightRequest), `frozen_base_context` issue
      code, OpenAPI + Go/TS clients regenerated, drift check green. The one
      real caller (ProjectReconciliationScreen) now pins the selected
      accepted quote and keeps quote-less for historical comparisons.
- [x] T6 — Negative proofs: legacy missing-context (typed frozen_base_context
      missing on BOTH verdicts), malformed/incomplete (reconciliation parse
      gate + loader invalid), unit mismatch (frozen_base_context with exact
      identity), quote-less (no contamination, honest BLOCK under mutated
      module default), module-default mutation after Q (frozen truth immune,
      same BOM on re-release), cross-project quote and cross-tenant baseline.
- [x] T7 — Regressions: engine+domain+api packages green; FULL serialized
      storage suite green (572s, granete_app, disposable postgres 16);
      #826/#727 suites included there; TS typecheck (web/ui/mobile) + unit
      tests green; check_openapi_drift green; CI/factory script suites green;
      organization browser gate run for the UI change.
- [ ] T8 — Independent review + publication (`Fixes #830` /
      `Delivery: complete` only if all acceptance holds). Parent-owned after
      the local candidate is complete; no push, PR, merge or issue closure is
      authorized for the implementer.
- [x] T9 — Canonical Q1 real-PostgreSQL proof: author base-treatment choices,
      create Q1 via `CreateInitialDesignQuoteRevision`, confirm the persisted
      commercial `PricingContext`, publish/accept, approve a compatible design,
      then preflight, production approval and release. Verify frozen BOM for
      each applicable role while module default X differs from quoted Y.
      GREEN for all three roles on the real `CreateInitialDesignQuoteRevision`
      path, then publish/accept, design publish, quoted preflight, production
      approval and release, with frozen BOM readback. Initial fixture runs
      blocked for unsupported historical definition versions and missing
      explicit release dimensions; after correcting those fixture inputs,
      the canonical product path passed without a source fix. This was NOT
      an observed product RED.
- [x] T10 — RED→GREEN per-command catalog consistency: deterministic
      two-connection PostgreSQL mutation test (no sleeps/mocks) for preflight,
      production approval and release; make the first two use an equivalent
      consistent snapshot while re-evaluating at each HTTP command boundary.
      RED: after a READ COMMITTED catalog read, an independent connection
      removed structure components; preflight returned a blocked verdict and
      approval returned a resolution blocker instead of rejecting the mixed
      boundary, whereas release already rejected it. GREEN: all three reject
      borrowed READ COMMITTED transactions; the same REPEATABLE READ snapshot
      yields READY, approval and frozen release, and a later command sees the
      mutation and blocks. No transaction spans HTTP requests.
- [x] T11 — RED→GREEN malformed frozen-context API contract: missing and
      invalid quoted context return structured, actionable HTTP 409 in
      preflight, approval and release, never 500 or SQL internals. RED: approval
      mapped typed missing/invalid context to 500; quoted preflight returned
      200 for its frozen-context BLOCKED verdict; malformed pricing context
      surfaced as an untyped revision-snapshot error before release authority
      loading. GREEN: scoped typed normalization, 409 API mapping, and a 409
      quoted-preflight verdict, with unrelated snapshot errors preserved.
- [ ] T12 — Exact-HEAD local verification and handoff: V0/V1/V2, relevant
      #826/#727 regressions, OpenAPI drift/generated parity, disposable
      PostgreSQL under runtime RLS, gofmt/vet, `git diff --check`, factory
      preflight and affected-check plan/selected run. Independent review/CI
      remain parent-owned and not proven by local tests.
- [x] T13 — Browser consequence of exact quoted preflight: Q1/R1 with a
      design-first unit outside the frozen commercial snapshot must NOT show
      READY; surface the server's actionable frozen-base 409 instead of a
      generic retry-only error, disable production commands, and prove the
      later requote/approval/release path with the disposable browser gate.
      Observed UI RED: generic retry-only copy concealed the server's 409;
      GREEN: focused Vitest and real Chromium Q1→Q2/R2→P1, then all 92
      organization-browser gate cases green in disposable PostgreSQL.

## Verification

- T9 focused V2: `scripts/backend-test.sh -run
  '^TestProductionRelease_CanonicalDesignQ1CarriesBaseChoiceToFrozenBOM$'
  -count=1 ./internal/storage` — green, 3 mode subtests, disposable
  PostgreSQL 16 with unprivileged runtime role. Rollback boundary:
  `production_release_canonical_q1_test.go` only (contract proof, no product
  behavior change). Work-unit commit `cb76760187499aad31ee5ad203815423a4a86295`.
- T10 focused V2: `scripts/backend-test.sh -run '^TestFrozenBaseCommands_'
  -count=1 ./internal/storage` — green with real two-connection PostgreSQL
  mutation and runtime RLS role; observed RED preceded the transaction fix.
- T11 focused V1/V2: `go test ./internal/api/... -count=1` and
  `scripts/backend-test.sh -run
  '^TestProductionRelease_FrozenBaseAuthority_LegacyContextFailsClosed$'
  -count=1 ./internal/storage` — green after observed HTTP 500/200 and typed
  storage RED. The frozen-context normalization is scoped to quoted failures.
- Current pure suites: `go test ./internal/domain/engine/...
  ./internal/domain/... ./internal/api/... -count=1` — green.
- Current focused storage regressions: `scripts/backend-test.sh -run
  '^(TestProductionRelease_|TestEvaluateDesignRevisionPreflight_|
  TestApproveDesignRevision_|TestFrozenBaseCommands_)' -count=1
  ./internal/storage` — green (42.196s); full suite result recorded below.
- The first refreshed full storage suite found one legacy #826 test using a
  READ COMMITTED helper for quoted preflight (`TestReleaseGate_HardwareOnlyModuleSurplusChoicesConverge`):
  RED `ErrInconsistentCatalogTransaction`. Switched that test to the existing
  `releaseTx` REPEATABLE READ helper; its disposable-PostgreSQL focused rerun
  is GREEN. The full rerun below confirms no other storage regressions; no
  product fallback was introduced.
- Refreshed full storage suite rerun: `scripts/backend-test.sh -count=1
  ./internal/storage` — GREEN, 450.783s against disposable PostgreSQL 16;
  runtime `granete_app` stayed unprivileged/RLS-scoped.
- Final UI checks: `pnpm typecheck` and `pnpm test` — GREEN (UI 176 files/2004
  tests; Web 42 files/547; database-isolation 16). Focused UI 409 test was
  observed RED with generic retry text, then GREEN with the server remedy.
  `node .agents/skills/impeccable/scripts/detect.mjs --json` on the affected
  UI files returned `[]`.
- Browser: `scripts/organization-browser-gate.sh
  tests/organization/project-reconciliation.spec.ts -g 'quote-first path'`
  — GREEN (1/1, 14s); full `scripts/organization-browser-gate.sh` — GREEN
  (92/92, 5.2m), synthetic organizations and disposable database.
- Affected-check plan selected shared TypeScript, Go, SketchUp, visual and
  foundation gates. `python3 scripts/verify_affected.py --base origin/main
  --budget-seconds 600` was attempted at clean `527062e7` and BLOCKED before
  launching jobs: `isolated DATABASE_URL required`. No ambient or persistent
  DB credential was substituted. Relevant jobs were run independently with
  the canonical disposable runners; unrelated selected jobs remain NOT_RUN.
- Script checks: 55 CI tests GREEN (one skipped by suite), 19 factory
  efficiency GREEN, 13 workflow-contract GREEN.
- Current `go vet ./internal/domain/... ./internal/api/...
  ./internal/storage/...` — green. `git diff --check` — green.
- Browser gate at the corrected backend/frontend HEAD found 88 passing and
  one relevant RED: Q1/R1 has a design-first unit absent from Q1, so exact
  quoted preflight correctly returns 409 rather than the historical READY
  assertion. A new UI test then observed the business message hidden behind
  a generic retry-only alert (RED); focused UI GREEN after projecting only
  the typed `frozen_base_context` 409 and disabling approval/release. Focused
  and full disposable browser reruns are green as recorded below.
- Engine: `go test ./internal/domain/engine/...` green (focused + package).
- Storage: full serialized suite via `scripts/backend-test.sh ./internal/storage`
  — 572s green against ephemeral postgres:16 (runtime role granete_app,
  NOSUPERUSER/NOBYPASSRLS role separation, DB never `muebles`).
- Contracts: `python3 scripts/check_openapi_drift.py` green ("generated files
  are current; operation drift negative proofs passed").
- TS: `pnpm typecheck` + `pnpm test` green.
- Browser: organization-browser gate run (UI change); SketchUp host: NOT_RUN
  (untouched by this issue).

## Progress

- Audit complete at base `3eaf22c6` (merge-base confirmed); branch
  `fix/830-frozen-base-treatment-authority`, commits `553c76c6` → `c116afe6`.
- The latest verified #830 three-dot diff against `origin/main` at
  `3375d658da50d9beea0f6cbbd8a7f5cd40a5b636` is 29 files,
  +1422/−89 = 1511 total: production 490, tests 823, authored OpenAPI 28,
  ODD 154, generated 16. Authored additions+deletions are 1495. This
  supersedes the older merge-base estimate above.
- The human accepted an **atomic size exception** for exactly this #830
  vertical; delivery strategy `exception-ok`, single atomic candidate. This
  does not authorize protected `size:exception` label, a push, PR or scope
  expansion. A split before transactional/API parity would be unsafe.
- `origin/main` advanced with #848 SketchUp-only commits (zero path overlap).
  Preserved the recovered branch and integrated `origin/main` cleanly via
  normal merge `d1654852023539fde764124b60baa56f6af76355`; no #848 reversal
  appears in the three-dot #830 diff. Scope/strategy doc commit `c7379fee`.
- Effective TDD: **strict enabled**, source `AGENTS.md` gentle-ai directive.
  Exact focused runners: `go test` in `backend-go` for pure engine/API tests;
  `scripts/backend-test.sh` from `backend-go` for disposable PostgreSQL
  storage/API integration. RED is required for observed B/C defects;
  T9 may be GREEN-only if the canonical path already works.
- Route: **delegated direct**, one sole writer in this recovered worktree.
  Triggers: understanding spans 4+ files and implementation touches 2+
  non-trivial files. Work-unit commits retain tests and behavior together.
- Forecast: starting authored 1495 lines; T9–T11 will increase the atomic
  candidate. Running authored count and exact category split must be refreshed
  at final handoff; no code-golf or artificial split to meet a line cap.
- Inherited candidate disposition: **KEEP** exact frozen-quote authority,
  quote-less module policy, release resolution and generated API/client parity;
  **FIX** incomplete approval/preflight transaction boundaries and malformed
  context HTTP mapping; **INCOMPLETE** canonical Q1 and concurrent-catalog
  proof until T9/T10 tests; **REMOVE** none (no duplicated engine or fallback
  found). This classifies rather than restarts GLM's implementation.
- Engram recovery mirror: full-document readback confirmed at observation
  `#1760` for topic `odd/830-frozen-base-treatment-authority/tasks`;
  subsequent task updates must refresh and read back both copies.
- Incident 2026-09-26 ~17:34: an external cleanup swept `muebles-worktrees/`
  (all 8 registered stale worktrees plus this one, minutes after creation;
  no code existed yet — only this artifact, restored verbatim). Worktree
  recreated at the same path from the same pinned base; committing early to
  keep all recovery state in git.
