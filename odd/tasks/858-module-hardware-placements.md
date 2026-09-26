# #858 — module_components descarta overrides.hardwarePlacements

## Objective and authorization

Restore the full `ComponentInstanceOverrides` round-trip on the module catalog
path so hardware placements survive HTTP → storage → DB → storage → HTTP and
P1 releases freeze the CNC routing the authoring intent carries. Issue:
https://github.com/tiagofur/muebleria/issues/858 (open, `status:approved`,
owner-applied label 2026-09-26). Owner authorization for the issue + vertical
came in the trajectory handoff of the same date; base
`6f252d6f969687c04dbcb17dd75765c25a6a88d6` (origin/main after #857).

## Problem and root cause

A component-instance override bag whose only content is `hardwarePlacements`
(a hinge with a versioned machining profile) was silently dropped on the
module path: `componentInstanceOverridesJSON` (write) and the
`loadModuleComponents` scan (read) each kept their own manual "is this bag
empty" field list that never counted `HardwarePlacements`. The structures
twin was already correct — `de7698fd` (PR #276 / VH-02 wave) had fixed
`isEmptyComponentInstanceOverrides` there — but the module path never
received the propagation: an incomplete fix between twin serializers.

## Work unit

- [x] RED storage (real PostgreSQL): create/update hardwarePlacements-only,
      combined bag, empty-NULL semantics, behavioral every-family negative,
      structures non-regression. Failed on main exactly on the
      hardwarePlacements-only paths.
- [x] Fix: ONE emptiness contract — writer delegates to
      `isEmptyComponentInstanceOverrides`; reader rebuilds the bag under the
      same predicate. No third manual field list.
- [x] Wire contract test (api): PUT→decode→GET echo carries placements.
- [x] Downstream proof (trajectory E2E, #398 worktree): the same fixture
      that produced `cut→edge_banding` now produces
      `cut→cnc→edge_banding` from the conserved placement.
- [x] Full trajectory P1 → assembled ran 12/12 against the fixed backend
      (evidence lives in the #398 worktree, not published here).

## Scope and exclusions

Only the `module_components` overrides round-trip + its regressions. No
drilling-rule changes, no structures semantics change, no CNC resolver,
PTX/postprocessor, stock gates, or fixture swaps. Pre-existing local test
failures (RLS/tenant family, `TestHardwareAssets_HandlerLevelByteWalkthrough`,
MFA concurrency flake) were baselined on main and are NOT touched.

## Verification

1. `go test ./internal/storage/ -run 'TestModuleComponents|TestStructureComponents_HardwarePlacements' -v`
   — RED on main (4 fail), GREEN after fix (9/9 + structures).
2. `go test ./internal/api/ -run TestHandleModuleByIDWireCarriesHardwarePlacements` — PASS.
3. Affected suites storage+api on disposable PostgreSQL 16: no new failures
   vs the main baseline (12 storage + 1 api deterministic failures are
   identical on main; MFA limiter flake passes isolated ×3).
4. `gofmt`/`go vet`/`git diff --check` clean on touched files.
5. Browser trajectory stage 1 + full 12-stage journey PASS against the fixed
   backend (Chromium + Go + disposable PostgreSQL).

## Delivery

Single PR, `Closes #858`, `Delivery: complete`, `type:bug`. No auto-merge.
