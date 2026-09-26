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

- [ ] T1 — RED engine: pricing BOM under frozen context Y ≠ release BOM under
      module default X (plinth_board→ZOCLO, plinth_strip→ZOCLO_PERFIL,
      legs→PATAS), strict gate rejects retained choices.
- [ ] T2 — RED storage (real PostgreSQL): Q3 frozen Y + R3 retained choice →
      `CreateProductionRelease` must succeed; today it fails with
      "choice … is not consumed".
- [ ] T3 — Engine authority: `ReleaseResolutionContext` + threading through
      `ResolveReleaseCollection` → `resolveReleaseUnitOpt` →
      `ResolveBomForRelease`.
- [ ] T4 — Storage loader + gates: `loadReleaseBaseAuthority`, readiness
      chain, fail-closed typed errors.
- [ ] T5 — Preflight explicit quote: store signature, API handler, OpenAPI
      (request body + issue code enum), regenerated clients, drift check.
- [ ] T6 — Negative proofs: quoted missing context, malformed mode, unit
      mismatch, quote-less incompatibility (no contamination), module-default
      mutation after Q must not reinterpret quoted truth, cross-project/tenant.
- [ ] T7 — Regressions: #826 engine suite, #727 presets/material-choices,
      reconciliation, adjacent storage suites.
- [ ] T8 — Independent review + publication (`Fixes #830` /
      `Delivery: complete` only if all acceptance holds).

## Verification

- Engine: `go test ./internal/domain/engine/...` (focused, then package).
- Storage: real PostgreSQL in a disposable container DB (never `muebles`),
  `NOSUPERUSER`/`NOBYPASSRLS` runtime role, `GOFLAGS=-p=1 -parallel=1`.
- Contracts: `python3 scripts/check_openapi_drift.py` + generated client regen.
- Browser/SketchUp host proof: NOT_RUN unless exercised (report honestly).

## Progress

- Audit complete at base `3eaf22c6`; branch
  `fix/830-frozen-base-treatment-authority`.
- Incident 2026-09-26 ~17:34: an external cleanup swept `muebles-worktrees/`
  (all 8 registered stale worktrees plus this one, minutes after creation;
  no code existed yet — only this artifact, restored verbatim). Worktree
  recreated at the same path from the same pinned base; committing early to
  keep all recovery state in git.
