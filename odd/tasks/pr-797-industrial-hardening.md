# PR #797 industrial hardening

- **Issue / PR:** #789 / #797 only
- **Baseline:** `15560cad12478ad01bf2b0ed6ebc1e73c146e82c`
- **Route:** delegated direct; mapping trigger met (PTX labels/compiler/parser/serializer/validator/verifier/tests/docs). One bounded writer; no parallel writers.
- **TDD:** unknown; no configured mode evidenced during read-only exploration. Targeted regression tests will be written before behavior changes where practical.
- **Delivery strategy:** single existing PR; no new PR, no merge, no scope expansion.
- **Forecast:** ~300 authored changed lines excluding generated output; preserve a focused review slice.

## Objective

Correct the six approved industrial blockers/corrections on PR #797 without changing r2/r3/r4 historical behavior, FUNCTION 92, receiver tuning, or generating/sending CNC artifacts.

## Constraints

- Modify only PR #797 / issue #789 scope.
- Do not modify r2/r3/r4, FUNCTION 92, MPR/MPRX/BHX generation, receiver MATERIALS policy, client PTX delivery, profiles, or adapters.
- Preserve L2→EDGE1, L1→EDGE2, W1→EDGE3, W2→EDGE4; one label per physical piece; PARTS_UDI structural/INFO2 unknown; FACE/BACK/COLOUR and EDG_PG* absent without authority.
- DRAWING requires explicit machining authority and a frozen deterministic release/CNC scope; never derive either from clock/randomness or silently fall back to the manufacturing code.
- The user supplied `PALLET` as the official name; rename the nominal model without changing byte order.

## Tasks

- [x] **T1 — Harden label authority and field contract** (delegated writer; trigger: multi-file write)
  - Implemented explicit conservative machining authority and required deterministic frozen CNC/release scope for DRAWING; invalid engineering quantities and edge flags without an authoritative edge band code fail closed.
  - Projected `ProductionCutRow.materialCode` as `CORE_MAT`; renamed PALLETP nominal model to PALLET across typed contract surfaces.
  - Added focused unit/compiler tests for CNC true/false/missing, scope determinism, edge blocking, CORE_MAT, PALLET, and invalid quantities.
  - Evidence: writer observed `pnpm --filter @granete/excel test` = 45 files / 534 passed / 3 skipped; `git diff --check` clean. Work-unit commit: `5104cca822cc148979b802ccba6c0659c0b5e43d`.

- [x] **T2 — Exercise real rotated optimizer label semantics** (delegated writer; same writer, next work unit)
  - Added a grain-free rotation-enabled fixture that demonstrably yields `piece.rotated === true` with asymmetric L/W edge flags.
  - It asserts code/PART_INDEX/finished dimensions/orientation-independent edges/REQ-INF relation and clean serialize→parse→independent readback.
  - The r2/r3/r4 and FUNCTION 92 paths were not modified; package regression suite above exercised their existing tests. Work-unit commit: `5104cca822cc148979b802ccba6c0659c0b5e43d`.

- [x] **T3 — Document, verify, publish same PR head** (completed as `f0543e7766730cf07e6917c2217cb5e496194f5d`)
  - Documentation/progress work-unit: `a2b2e303015d3f2021566f28dc1018baeff65e51` (`docs(ptx): record r5 label hardening`) accurately classifies SPEC / PRODUCT POLICY / RECEIVER EVIDENCE / UNKNOWN.
  - Initial typecheck exposed `materialCode` optional typing at `partLabels.ts:353`; a fail-closed correction without fallback is committed in `32518fc47273f74af71520985953f68d9ca32bf3` (`fix(ptx): validate core material authority`). Exact-candidate re-verification: Excel = 45 files / 534 passed / 3 skipped; `pnpm typecheck` PASS; prior `git diff --check` clean.
  - Authorized selector attempt: `python3 scripts/verify_affected.py --base origin/main --budget-seconds 3600` ran once at candidate `32518fc47273f74af71520985953f68d9ca32bf3` against base `b7446866ed247677d8b8f83238cddbd96579db97` and blocked before gates because an isolated `DATABASE_URL` is required.
  - Selector selected `typescript`, `backend-go`, `sketchup-extension`, `proyectar-visual`, `foundation-postgres`, and `organization-browser`; none of those gates ran, and none are PASS evidence.
  - Local selector remained BLOCKED for isolated `DATABASE_URL`; exact-head PR CI later completed SUCCESS on all checks for `f0543e7766730cf07e6917c2217cb5e496194f5d`. The PR stays `Delivery: partial` because local selector infrastructure remains absent.
  - No merge, closure of #789, or new PR occurred.

- [x] **T4 — Add explicit r5 part-local PARTS_REQ dimension policy** (delegated writer; trigger: multi-file write)
  - Added explicit `partsReqDimensionPolicy: 'placement' | 'part-local-pre-rotation-cut'`; default/absent preserves historical placement dimensions while r5 labels opts in explicitly rather than through `partLabels` implicitly.
  - Compiler and independently derived readback now apply the policy. The existing real rotated fixture proves placed 39×549 versus PARTS_REQ 549×39, GRAIN=0, FIN 550×40, edge mapping, clean bytes/readback, an old-dimension mutation `parts.dims`, and non-rotated equality.
  - r2/r3/r4, adapter/profile, and FUNCTION 92 paths were not modified. Writer evidence: Excel 45 files / 534 passed / 3 skipped; diff check clean. Work-unit commit: `f4dac0af791fd58052b49b7acf91a31c70ebd118`.

- [ ] **T5 — Document, verify, and publish r5 dimension correction** (delegated docs/verification)
  - Documentation/progress updated for the r5 dimension policy: SPEC `PARTS_REQ` part-local cut dimensions with `GRAIN=0` rotation allowance; PRODUCT POLICY `partsReqDimensionPolicy: 'part-local-pre-rotation-cut'`; absent/`placement` preserves r2/r3/r4 byte-exact and is not coupled to `partLabels`; independent readback keeps FIN as original finished dimensions and checks `FIN = part-local cut + edge deductions`.
  - Existing fixture facts recorded: rotated true; placed 39×549; `PARTS_REQ 549×39`; grain 0; `FIN 550×40`; `EDGE2`/`EDGE4`; old placement mutation fails with `parts.dims`; nonrotated equality remains.
  - CNC scope note recorded only: #793 productive r5 must derive scope from `CutPlan.releaseBase.manufacturingFingerprint` or an authoritative frozen equivalent and block without `releaseBase`; `release:789:r5:*` strings remain laboratory fixtures. No wiring implemented.
  - Work-unit containing the policy: `f4dac0af791fd58052b49b7acf91a31c70ebd118`. Final local candidate: `ed1d5066b61db18da64e774879f8f14f59b16011`, a test-only correction that imports `PtxRecord` after the initial candidate failed `pnpm typecheck`. Evidence at `ed1d5066`: Excel 45 files / 534 passed / 3 skipped; `pnpm typecheck` PASS; `git diff --check` PASS.
  - Authorized selector ran once at `ed1d5066` against base `b7446866ed247677d8b8f83238cddbd96579db97` with 3600 s and blocked before selected gates because an isolated `DATABASE_URL` is required. Selected TypeScript/Go/Ruby/WebGL/Foundation gates did not run locally and are not PASS evidence. T5 remains pending same-PR push and exact-head CI; no delivery-complete claim.

## Acceptance / required checks

1. CNC true emits DRAWING/BARCODE1; false or missing authority emits neither.
2. Same code/same explicit frozen scope is stable; a different scope changes DRAWING; collision gates remain.
3. Edge flag without code blocks; no flags/no code remains valid.
4. A real optimizer rotation preserves physical-piece label semantics and clean independent readback.
5. CORE_MAT policy is demonstrated from materialCode; PALLET naming is nominally correct with byte order unchanged.
6. Invalid quantity `0`, negative, or decimal blocks.
7. r2/r3/r4 recompile byte-exact and FUNCTION 92 remains unchanged.
8. `pnpm --filter @granete/excel test`, `pnpm typecheck`, current selector, `git diff --check`, and exact-head CI are reported honestly.
9. With `part-local-pre-rotation-cut`, a real rotated piece has PARTS_REQ part-local cut dimensions; an old placement-dimension mutation fails independent readback, while non-rotated dimensions are unchanged.

## Progress

- 2026-09-19: Isolated a clean detached worktree at approved PR HEAD after diagnosing the original worktree as an unrelated in-progress rebase with a conflict in `progress/current.md`. No recovery was applied to that original worktree.
- 2026-09-19: Read-only mapping identified `partLabels.ts`, compiler, typed PTX records/parser/serializer/validator/spec preflight/verifier, real optimizer golden, focused tests, and required docs as the bounded scope.
- 2026-09-19: T1/T2 completed by one scoped writer. The implementation is confined to 11 PTX files and has 301 additions / 61 deletions before docs. Focused package suite passed (45 files / 534 passed / 3 skipped); diff check clean. Work-unit commit `5104cca822cc148979b802ccba6c0659c0b5e43d` records T1/T2.
- 2026-09-19: T3 documentation/progress commit `a2b2e303015d3f2021566f28dc1018baeff65e51`; no tests were rerun in that documentation-only step per owner instruction.
- 2026-09-19: Independent local verifier found an initial TypeScript error in the new CORE_MAT authority path. The minimal fail-closed correction is `32518fc47273f74af71520985953f68d9ca32bf3`; exact-candidate re-verification passed Excel 45 files / 534 passed / 3 skipped, typecheck, and a prior diff check.
- 2026-09-19: The authorized selector command `python3 scripts/verify_affected.py --base origin/main --budget-seconds 3600` ran once at candidate `32518fc47273f74af71520985953f68d9ca32bf3` against base `b7446866ed247677d8b8f83238cddbd96579db97` and blocked before executing gates because it requires an isolated `DATABASE_URL`. Selected jobs were typescript, backend-go, sketchup-extension, proyectar-visual, foundation-postgres, and organization-browser; none ran and none count as PASS.
- 2026-09-19: Published `f0543e7766730cf07e6917c2217cb5e496194f5d` to the existing PR #797. Its exact-head CI reached SUCCESS for all reported checks. New independent review identified the separate rotated-placement identity blocker, authorized as T4/T5 only.
- 2026-09-19: T4 completed by one scoped writer: the explicit r5 `part-local-pre-rotation-cut` policy was added to compiler and independent readback, with positive/negative rotated and non-rotated tests. Package Excel suite remained 45 files / 534 passed / 3 skipped; diff check clean. Work-unit commit `f4dac0af791fd58052b49b7acf91a31c70ebd118` records T4.

## Next step

Push `ed1d5066b61db18da64e774879f8f14f59b16011` to the same existing PR #797 branch, update the PR body if still needed, and wait for exact-head CI. Do not claim selected local gates passed: the selector blocked before them because `DATABASE_URL` was not isolated.
