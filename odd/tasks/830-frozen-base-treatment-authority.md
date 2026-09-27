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
      `Delivery: complete` only if all acceptance holds). PAUSED at §17: the
      authored count crossed >~1200 WITH an OpenAPI change — reporting before
      publishing per the size policy.

## Verification

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
- Authored size vs merge-base: 29 files, +1394/−89 (~1483 changed lines);
  production ≈ 560, the rest is the PostgreSQL integration matrix the issue
  acceptance mandates plus the ODD artifact. Crossed the >~1200 band WITH an
  OpenAPI/clients change → publication paused for the human size decision
  (no size:exception self-applied).
- Note: `origin/main` advanced past the pinned base (other writers' merges);
  merge conflict check pending at publication time.
- Incident 2026-09-26 ~17:34: an external cleanup swept `muebles-worktrees/`
  (all 8 registered stale worktrees plus this one, minutes after creation;
  no code existed yet — only this artifact, restored verbatim). Worktree
  recreated at the same path from the same pinned base; committing early to
  keep all recovery state in git.
