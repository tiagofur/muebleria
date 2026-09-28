# #879 BHX 050 offline foundation

Issue: [#879](https://github.com/tiagofur/muebleria/issues/879) (open, `status:approved`).
Repository artifact: `odd/tasks/879-bhx-offline-foundation.md`.
Start: `origin/main` at `90cc2bdcc5220efb9c97df48fbefc9479cdf8228`, branch `codex/879-bhx-b1`.

## Objective and authority

Deliver a bounded, evidence-grounded foundation for Client A's BHX 050: first
make the installed-receiver unknowns and their consequences explicit in the
existing dossier, then build neutral offline setup and operation-coverage
planning from explicit synthetic fixtures. This matters because the machine
model is known, but neither its native input contract nor its equipped
capabilities are confirmed. A plausible machine file would be unsafe.

The owner authorized **B1 and B2 only** in this session. B3 integration and
field compatibility claims, a native MPR/MPRX/MPRXE serializer without exact
receiver evidence, machine control, productive file transfer, React, DXF
conversion, and unrelated #874/#875/PTX changes are outside this feature.
No public HOMAG literature or 2D/name-heuristic drilling projection can be
promoted to installed-machine evidence. #352 owns field validation.

## Delivery and verification policy

- Delivery strategy: `auto-chain`; chain strategy: `stacked-to-main`. Planned
  slices: B1 evidence/contract, then B2 neutral executable foundation. Each
  slice targets `main` in order and has its own review/CI before any merge.
  The parent/leader owns push, PR, and merge; none is implied by this file.
- Forecast: B1 about 100–180 authored changed lines; B2 about 350–550,
  approximately 450–730 total. The ~400-line work-unit heuristic guides
  cohesive slicing, not code-golf or test omission. Reassess actual counts
  before the next commit; the owner's overnight exception limit is 750 lines
  per PR and about 400 production lines only when a clean split is impossible.
- TDD: strict **enabled** by the session's `gentle-ai:strict-tdd-mode` directive.
  B1 is passive documentation, so RED/GREEN/REFACTOR and executable runners
  are not applicable. B2 requires observed RED → GREEN → REFACTOR using the
  repository runners `pnpm --filter @granete/domain test` and/or
  `pnpm --filter @granete/excel test` (their `package.json` scripts run Vitest).
- RDD state/review: not assumed. The leader determines the current native
  switch and obtains a fresh independent review of each exact candidate.

## Actionable tasks

- [x] **B1 — Existing dossier and evidence matrix.** Reconcile the confirmed
  BHX 050 identity with still-unknown controller/software version, native
  format/grammar, encoding, units, axes/origin, faces, tools, clamps, limits,
  setup/reorientation, and transfer workflow. For each, record source,
  `CONFIRMED_CLIENT` / `PUBLIC_REFERENCE_ONLY` /
  `UNKNOWN_FIELD_REQUIRED`, consumer, and concrete blocker. Verify direct
  official HOMAG links without treating model literature as receiver proof.
  State that B2 may proceed on synthetic neutral fixtures but native output
  and physical compatibility remain blocked. Acceptance: BHX01 only; no
  duplicate dossier or capability promotion. Checks: dossier/source readback,
  `git diff --check`, `python3 scripts/verify_affected.py --base origin/main
  --plan`, proportional documentation checks, and clean final preflight.
  Route: delegated direct; evidence spans the dossier, issue, BHX contract,
  architecture, and current profile/adapter/domain seams (>4 files).
- [ ] **B2 — Neutral offline setup and coverage candidate.** Evolve the
  existing neutral seam only as needed for explicit synthetic per-piece
  operations; model six-face piece→setup→candidate-frame transforms and
  inverse without DXF mirroring or nesting `rotated`. Account for every
  required operation as assigned to a supported setup or blocked with a
  specific reason; produce a non-fabricable manifest candidate and
  `NATIVE_FORMAT_RECEIVER_NOT_CONFIRMED` when the exact receiver is unknown.
  Acceptance: focused geometry, inverse, coverage, unsupported-face/tool,
  deterministic identity, and missing-evidence tests; no native program or
  field claim. Checks: observed strict TDD, focused Vitest, relevant
  typecheck/contract checks, affected-check plan, V0 readback, and V2
  `NOT_RUN` for the physical receiver. Route: delegated direct, one writer;
  implementation plan must be refined against the current B1 boundary.

## Progress and evidence

- B1: documentary BHX01 outcome observed in the existing Client A dossier.
  Accepted rationale: the owner-reported machine identity stays separate from
  missing receiver grammar, setup, and capability evidence; official HOMAG
  product references remain public context, not installation proof.
  Work-unit commit `73a2415d1e41d9453daae3304acbf9ed13a150c6` on base
  `90cc2bdcc5220efb9c97df48fbefc9479cdf8228` changed 147 additions and
  23 deletions (170 authored lines). B1 PR slice is this work unit plus this
  evidence-only tracking commit; exact final HEAD is recorded at handoff.
  V0: `git diff --check`, `git diff --cached --check`, and
  `git show --check --oneline HEAD` passed; 12 required matrix fields and 12
  Markdown links had zero missing local targets. Both official HOMAG links
  were read directly. `python3 scripts/verify_affected.py --base origin/main
  --plan` succeeded but conservatively selected all gates because the new
  ODD path is unknown to the selector; that plan is not a test result.
  `python3 scripts/factory_preflight.py --require-clean` reported a clean
  worktree and `PREFLIGHT_OK_NOT_VERIFIED` after the work-unit commit.
  V1: N/A for passive documentation. V2 receiver/physical proof: `NOT_RUN`
  under #352, with no compatibility claim. Independent review and exact-HEAD
  CI: pending. RDD assessment: leader-owned, pending.
- B2: not started. No neutral planner, native serializer, or machine proof
  claimed by this task file.
- Next: refresh the full Engram mirror at
  `odd/879-bhx-offline-foundation/tasks` and hand the exact B1 HEAD to the
  leader for independent review and CI/PR decisions. B2 starts only after
  reconciling its input seam and this document; field-evidence blockers remain
  explicit.
