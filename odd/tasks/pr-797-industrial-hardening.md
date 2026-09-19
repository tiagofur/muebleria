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

- [ ] **T3 — Document, verify, publish same PR head** (docs in progress; verifier/publish still pending)
  - Documentation update in progress for the required PTX docs, verification record, progress entry, and this task document to accurately classify SPEC / PRODUCT POLICY / RECEIVER EVIDENCE / UNKNOWN.
  - Observed evidence available for this PR head: `pnpm --filter @granete/excel test` = 45 files / 534 passed / 3 skipped; `git diff --check` clean.
  - Pending: typecheck, verification selector, exact-head CI, PR #797 body/readback, push/publish steps, and any delegated verification explicitly authorized later.
  - Do not merge, close #789, or open another PR.

## Acceptance / required checks

1. CNC true emits DRAWING/BARCODE1; false or missing authority emits neither.
2. Same code/same explicit frozen scope is stable; a different scope changes DRAWING; collision gates remain.
3. Edge flag without code blocks; no flags/no code remains valid.
4. A real optimizer rotation preserves physical-piece label semantics and clean independent readback.
5. CORE_MAT policy is demonstrated from materialCode; PALLET naming is nominally correct with byte order unchanged.
6. Invalid quantity `0`, negative, or decimal blocks.
7. r2/r3/r4 recompile byte-exact and FUNCTION 92 remains unchanged.
8. `pnpm --filter @granete/excel test`, `pnpm typecheck`, current selector, `git diff --check`, and exact-head CI are reported honestly.

## Progress

- 2026-09-19: Isolated a clean detached worktree at approved PR HEAD after diagnosing the original worktree as an unrelated in-progress rebase with a conflict in `progress/current.md`. No recovery was applied to that original worktree.
- 2026-09-19: Read-only mapping identified `partLabels.ts`, compiler, typed PTX records/parser/serializer/validator/spec preflight/verifier, real optimizer golden, focused tests, and required docs as the bounded scope.
- 2026-09-19: T1/T2 completed by one scoped writer. The implementation is confined to 11 PTX files and has 301 additions / 61 deletions before docs. Focused package suite passed (45 files / 534 passed / 3 skipped); diff check clean. Work-unit commit `5104cca822cc148979b802ccba6c0659c0b5e43d` records T1/T2.
- 2026-09-19: T3 documentation/progress update started at detached HEAD `5104cca822cc148979b802ccba6c0659c0b5e43d`; no tests were rerun in this documentation-only step per owner instruction.

## Next step

Finish T3 by committing/pushing the documentation update only after authorized, then run/report the pending typecheck, selector, exact-head CI, PR body/readback, and publication verification on the same PR head.
