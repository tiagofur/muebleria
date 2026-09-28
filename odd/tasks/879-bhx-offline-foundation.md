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
  slices: B1 evidence/contract, B2a neutral six-face frame geometry, B2b-a
  bore/face geometry, then B2b-b synthetic operation coverage. Each slice targets `main` in order and
  has its own review/CI before any merge. B2b waits for B2a review and
  delivery; neither B2 slice changes the authorized product scope.
  The parent/leader owns push, PR, and merge; none is implied by this file.
- Forecast after independent review: B2a about 220–300 authored lines;
  B2b-a about 180–280 and B2b-b about 500–700. A frame-only PR and a coverage PR will not both fit
  under 400 lines, but they are distinct deliverable behaviors. A standalone
  validation-only planner facade would be unsafe; B2b-a is pure geometry and
  exposes no planner/assignment. Under owner Round 2, 451–750 authored lines
  may receive a conditional size exception after reviewer cohesion confirmation;
  >750 must split coherently. Do not code-golf
  or omit tests/docs to fit a budget.
- TDD: strict **enabled** by the session's `gentle-ai:strict-tdd-mode` directive.
  B1 is passive documentation, so RED/GREEN/REFACTOR and executable runners
  are not applicable. B2a and B2b each require observed RED → GREEN →
  REFACTOR using `pnpm --filter @granete/domain test` (Vitest), with focused
  `pnpm --filter @granete/domain exec vitest run <test-file>` runs as needed.
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
- [x] **B2a — Neutral rigid-frame and setup-envelope geometry.** In a pure
  domain module, define right-handed six-face piece→setup rotations, explicit
  setup→symbolic-candidate transforms, point/direction mapping, inverse, and
  oriented setup-space envelope for asymmetric rectangular pieces. Reject
  non-finite/degenerate dimensions and reflected, scaled, or sheared frames;
  never reuse DXF mirroring, nesting `rotated`, machine-native axes, or
  installed BHX capabilities. Acceptance: independent expected coordinates
  and oriented extents for all six faces, inverse round-trip, determinant +1,
  reflection rejection, non-default second-frame transform. Checks: observed
  strict TDD RED/GREEN/REFACTOR, focused/full domain Vitest, domain typecheck,
  `git diff --check`, affected-check plan, clean preflight; receiver/physical
  V2 `NOT_RUN`. Route: delegated direct sole writer on
  `codex/879-bhx-b2a`, based on B1 merge commit.
- [ ] **B2b — Synthetic operation coverage candidate.** Consume B2a frames
  from explicit per-occurrence synthetic operations. Check entry face/point,
  axis, bore fit, and blind/through travel against ray/box exit distance;
  conservatively block angled drilling until swept-bore semantics exist.
  Assign each required operation exactly once to an explicitly supported
  synthetic setup or return a specific blocker, including oriented bounds,
  clearance, tool/requirement, malformed/missing/duplicate identities and
  incomplete resolution. Always return a non-fabricable manifest candidate
  with `NATIVE_FORMAT_RECEIVER_NOT_CONFIRMED`, no native bytes/filename or
  physical claim. Checks: separate strict TDD, focused/full domain Vitest,
  typecheck, affected plan, clean preflight; receiver V2 `NOT_RUN`. Route:
  delegated direct sole writer only after B2a review/delivery decision.
  - [x] **B2b-a — Pure bore/face geometry.** From explicit synthetic numeric
    inputs, return a non-fabricable validity result for six-face entry,
    normal inward unit axis, face bore fit, and blind/through ray-box exit.
    No planner, assignment, receiver capability, or native output. Check
    independent numeric positive/negative Vitest, typecheck, affected plan,
    diff check, and clean preflight. Branch `codex/879-bhx-b2b-geometry` from
    B2a merge commit `98d6d9491a388555549f2a6ba1f981a734f0284d`.
  - [ ] **B2b-b — Supported-setup coverage.** Consume B2b-a geometry and
    B2a frames in the explicit per-occurrence planner. Preserve integrity
    blockers, immutable manifest snapshots, fail-closed null inputs, setup
    support, and receiver-unknown non-fabricable output. Strict TDD,
    focused/full domain Vitest, typecheck, affected plan, diff check, clean
    preflight; V2 `NOT_RUN`. Branch from B2b-a HEAD, then rebase onto its
    eventual main merge before publication.

## Progress and evidence

- B1: documentary BHX01 outcome observed in the existing Client A dossier.
  Accepted rationale: the owner-reported machine identity stays separate from
  missing receiver grammar, setup, and capability evidence; official HOMAG
  product references remain public context, not installation proof.
  Work-unit commit `73a2415d1e41d9453daae3304acbf9ed13a150c6` on base
  `90cc2bdcc5220efb9c97df48fbefc9479cdf8228` changed 147 additions and
  23 deletions (170 authored lines). The original B1 PR slice included this
  work unit and an evidence-only tracking commit; the rebased identities are
  recorded below.
  V0: `git diff --check`, `git diff --cached --check`, and
  `git show --check --oneline HEAD` passed. All mandated B1 categories are
  represented in the dossier's 16-row matrix. Across the dossier and this
  task file, all 7 local Markdown link occurrences resolve; 5 external
  occurrences comprise two distinct official HOMAG URLs repeated in the
  dossier plus the issue URL. Both official HOMAG URLs were opened directly.
  `python3 scripts/verify_affected.py --base origin/main
  --plan` succeeded but conservatively selected all gates because the new
  ODD path is unknown to the selector; that plan is not a test result.
  `python3 scripts/factory_preflight.py --require-clean` reported a clean
  worktree and `PREFLIGHT_OK_NOT_VERIFIED` after the work-unit commit.
  V1: N/A for passive documentation. V2 receiver/physical proof: `NOT_RUN`
  under #352, with no compatibility claim. Independent review and exact-HEAD
  CI for the current candidate: pending. RDD assessment: leader-owned.
- Rebase checkpoint: `git fetch origin main` confirmed the new base
  `8b33610ec1d6c5f152474108e8d9a7b904145095`; the branch was clean and
  its remote tracking ref still matched the old HEAD before rebase. Rebase
  from historical base `90cc2bdcc5220efb9c97df48fbefc9479cdf8228`
  completed without conflicts. `git range-diff` mapped the B1 work unit
  `73a2415d` → `715e55e5` and evidence commit `db173461` → `94a53711`
  with `=` for both; dossier and ODD file blob IDs were unchanged at the
  rebased two-commit HEAD `94a53711d524f4d2a61eb48cd28a97c775be25ea`.
  This checkpoint changes only this task artifact. Any review or CI for the
  old `db173461`/`90cc2bdc` pins does not prove the rebased candidate;
  fresh exact-HEAD review and CI are required before delivery. The leader
  owns remote update and publication; no writer push occurred. Rebased V0:
  `git diff --check origin/main...HEAD` passed; all 7 local Markdown link
  targets resolve. The other 5 link occurrences are external URLs, not
  local-path checks; the two distinct official HOMAG URLs were opened during
  B1. `factory_preflight.py --require-clean` reported a clean tree.
  `verify_affected.py --base origin/main --plan` succeeded on
  the new base but again selected all gates because the ODD path is unknown;
  it did not execute those gates. No executable or receiver checks were
  rerun for this passive-document correction.
- B1 delivery readback: PR #888 merged as
  `b38284e370b4d8e06e94a78c47afe537745eddab` on 2026-09-28; its final
  source HEAD `48bbb1612cd0b1133b28adc68991de64ae95ecf9` is an ancestor
  of current `origin/main`. B2a starts from this merge commit.
- B2 split rationale: the local one-slice B2 candidate at `e06cc917`
  (retained on `codex/879-bhx-b2`, never pushed) was rejected by independent
  review on exact base `b38284e3`. Its setup limit compared unrotated piece
  dimensions to rotated setup capacity, and its drill geometry accepted blind
  travel beyond stock or through travel short of exit. It is not delivery
  evidence. Two coherent work units replace that candidate; tests and docs
  stay with the behavior they verify.
- B2a implementation checkpoint before commit: a separate pure domain module
  now provides six right-handed rotations, inverse, point/direction mapping,
  and setup-frame envelopes; no machining operation, profile, adapter, or
  native output is present. Strict TDD RED: focused Vitest failed to load the
  missing `neutralMachiningGeometry` module. GREEN: focused Vitest passed
  9/9; REFACTOR: shared rotated-box calculation without behavior change,
  then focused 9/9 and domain typecheck passed. The full domain suite passed
  115 files/1,636 tests. `git diff --check` passed. The affected-check plan
  selected all gates conservatively because the ODD path is unknown; it ran
  none of those gates. Receiver/import/physical V2: `NOT_RUN`. Work-unit
  commit `a2fcbe07e97ad0d59838fbedbaf30319a1b3ca9d` on base
  `b38284e370b4d8e06e94a78c47afe537745eddab` contains geometry, tests,
  public export, and this ODD checkpoint: 322 additions + 31 deletions =
  353 authored lines, including 147 production lines. On that exact commit,
  focused 9/9, full domain 115 files/1,636 tests, domain typecheck, and
  `git show --check` passed. Clean preflight returned
  `PREFLIGHT_OK_NOT_VERIFIED`; remote `main` still matched the base.
  Runtime harness: N/A because B2a is pure symbolic geometry with no
  receiver or host boundary. Rollback removes only its module, tests, public
  export, and B2a checkpoint; B1 remains intact. Fresh independent review
  and exact-HEAD CI/publication remain parent-owned and pending.
- B2b reslice decision: the preserved local `codex/879-bhx-b2b` candidate
  reached `2e0e2901652f92d62d81d6b304af70b78628d3bc` plus uncommitted
  RED/GREEN corrections. Independent review found mutable manifest aliases
  and null-input throws; the corrected accumulated branch exceeded the
  owner's Round 2 hard 750-authored-line limit. Do not publish that branch.
  B2b-a supplies only pure geometric validity with no planner or assignment
  facade; B2b-b consumes it for complete coverage. This is a technical split
  within approved B2, not native output or physical proof.
- B2a delivery readback: PR #889 merged at main commit
  `98d6d9491a388555549f2a6ba1f981a734f0284d`; B2b-a starts from that
  exact base and does not alter B2a geometry.
- B2b-a implementation checkpoint: pure `neutralBoreGeometry.ts` exports a
  non-fabricable numeric validity result and ray/box exit distance, never a
  setup assignment or machine program. Independent tests cover all six faces,
  exact normal exits, face/edge bore fit, blind/through boundaries, angled
  rejection, malformed values, and frozen result metadata. Strict TDD RED:
  focused Vitest could not load the absent module; a subsequent RED observed
  six unfrozen-result failures. GREEN/REFACTOR: focused 10/10, full domain
  116 files/1,646 tests, domain typecheck, and `git diff --check` passed.
  The affected-check plan selected all gates conservatively because this ODD
  path is unknown; it executed none. Runtime receiver/host harness: N/A for
  pure geometry; V2 receiver/physical `NOT_RUN`. Rollback removes only this
  geometry module/test, its public export, and this B2b-a checkpoint, leaving
  B1/B2a intact. Work-unit commit and clean preflight follow this checkpoint.
- Next: independent exact-HEAD B2b-a review and parent-owned delivery, then
  B2b-b coverage from the accepted geometry base. Native output and receiver
  validation remain pending.
