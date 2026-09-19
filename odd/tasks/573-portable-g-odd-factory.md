# #573 — Portable G-ODD software factory

## Objective

Modernize Granete's repository-owned software factory into one portable G-ODD
contract that behaves consistently with or without Gentle-AI, without changing
product code or weakening existing delivery gates.

## Problem

The current factory has valuable approval, ownership, verification, publication,
and human-merge controls, but its documents still mix a legacy feature ledger,
session log, universal startup suite, and issue execution. That creates competing
sources of truth and unnecessary ceremony across Pi/OpenCode/Gentle-AI and tools
such as ZCode that cannot load Gentle-AI.

## Why

A runtime-independent contract lets each capable tool use its native adapter while
preserving the same issue authority, one-writer boundary, verification levels,
review independence, and publication semantics. Agents can spend context on the
change rather than rebuilding or reconciling competing factory workflows.

## Scope

- Align the factory map, human-start contract, role skills, checkpoints, setup,
  verification, Git workflow, status/reference docs, and factory contract tests.
- Define Direct, ODD, and explicit SDD lanes with one execution artifact per issue.
- Make `feature_list.json` catalog/legacy metadata and keep `progress/current.md`
  outside the normal execution loop.
- Preserve `factory_preflight.py`, `verify_affected.py`, publication metadata,
  approval, ownership/quarantine, exact-pins review, CI, and human merge controls.

## Non-goals

- Product code, product behavior, migrations, contracts, or product tests.
- A new scheduler, dispatcher, daemon, runtime, queue, enforcement service, or
  repository copy of Engram state.
- Enabling receipt-driven review, weakening publication metadata, changing remote
  protections, merging, or closing issue #573. This delegated writer does not push
  or open the PR; overall issue authorization still permits the parent to publish
  the reviewed branch and open the approved process PR.

## Constraints

- Approved process issue: #573. Isolated branch: `docs/573-g-odd-factory`.
- One writer owns all edits and commits; fresh reviewer must be a different actor.
- Remote publication is a later parent-owned action after independent review and
  the delivery-size decision, not a non-goal of the authorized migration.
- Technical artifacts are written in English and optimized for quick review.
- Existing product/domain invariants remain authoritative and are not restated here.
- The ~400 authored-line review budget is a planning heuristic, never a reason to
  omit tests, compress documentation, or remove useful safeguards.

## Authorized scope

Process and documentation files only: `AGENTS.md`, `docs/demo/software-factory-*`,
role skills, `CHECKPOINTS.md`, `feature_list.json`, `progress/current.md`,
`odd/tasks/` conventions, `README.md`, `init.sh`, `docs/git-workflow.md`,
`docs/verification.md`, factory workflow tests, and directly related process docs.

## Acceptance criteria

- One portable G-ODD contract defines Gentle-present and Gentle-absent operation.
- Direct/ODD/explicit-SDD lane selection and artifact ownership are unambiguous.
- One-writer, fresh independent review, one-shot delivery, V0/V1/V2, truth-source
  hierarchy, CI-as-validation, optional Engram, and bounded correction are explicit.
- `feature_list.json` cannot be mistaken for queue/scheduler/ownership authority;
  `progress/current.md` is not a startup input or routine write target.
- Valuable gates remain fail-closed and contradictory legacy ceremony is removed.
- Factory tests and required process checks pass on the final clean commit.

## Execution tasks

- [x] **GODD-1 — Establish the portable contract and execution artifact convention**
  - Route: delegated direct (single writer).
  - Trigger evidence: coordinated changes across more than two non-trivial docs;
    reading prepares a multi-file write.
  - Outcome: central contract, navigation map, and `odd/tasks/` convention/template.
- [x] **GODD-2 — Align roles and legacy state surfaces**
  - Route: delegated direct (same single writer).
  - Trigger evidence: leader/implementer/reviewer plus checkpoints, README, init,
    feature catalog metadata, progress ledger, and related reference docs must agree.
  - Outcome: roles consume G-ODD; legacy catalog/session-loop contradictions removed.
- [x] **GODD-3 — Pin the contract with tests and verification guidance**
  - Route: delegated direct (same single writer).
  - Trigger evidence: multi-file verification rules and drift guards; execution
    commands are delegated verification work under the authorized writer handoff.
  - Outcome: updated factory tests, final checks, and commit evidence.
- [x] **GODD-C1 — Apply the single bounded review correction**
  - Route: delegated direct (same single writer).
  - Trigger evidence: independent review returned four documentation/process
    blockers on the exact candidate; no product or delivery scope was added.
  - Outcome: routine startup, task state, catalog governance, and semantic drift
    guards agree across every live factory entrypoint.

## Verification plan

- `git diff --check` before each commit and at final state.
- `python3 -m json.tool feature_list.json >/dev/null`.
- `bash -n init.sh`.
- `python3 -m unittest discover -s scripts -p 'test_factory_*.py' -v`.
- `python3 -m unittest discover -s scripts -p 'test_check_pr_metadata.py' -v`.
- `python3 scripts/factory_preflight.py`.
- `python3 scripts/verify_affected.py --base origin/main --plan`.
- After final clean commit: `python3 scripts/factory_preflight.py --require-clean`.

TDD mode: not configured for this documentation/process migration. Ordinary
contract tests and the repository-authoritative factory checks apply.

## Delivery forecast

- Original forecast: approximately 330–450 authored changed lines. Actual initial
  candidate: **1,405 authored changed lines** across 17 process/documentation files;
  generated files: none. The correction round must report its final count separately.
- Delivery strategy: `ask-on-risk`.
- Chain strategy: unresolved unless the honest running count exceeds ~400 lines;
  parent owns that delivery decision before push or PR creation.
- Planned work-unit commits: one commit per task (`GODD-1` through `GODD-3`).

## Progress and evidence

- 2026-09-19: Confirmed isolated worktree and branch based on `origin/main`.
- 2026-09-19: Loaded cognitive-doc-design, work-unit-commits, and branch-pr skills.
- 2026-09-19: CodeGraph directory existed but the upstream CLI reported no usable
  index; continued with targeted repository reads rather than broad exploration.
- 2026-09-19: Current factory contract and named legacy surfaces inspected before
  the first write. This file is the first write.
- 2026-09-19: GODD-1 established the portable contract in `AGENTS.md` and
  `docs/demo/software-factory-human-start.md`, plus the single-artifact convention
  and inline template in `odd/tasks/README.md`. `git diff --check` passed.
- 2026-09-19: The honest documentation rewrite already crosses the ~400 authored
  line planning heuristic. No quality content was compressed to fit it; per
  `ask-on-risk`, the parent retains the delivery/slicing decision. This writer will
  not push or open a PR.
- 2026-09-19: GODD-1 work-unit commit:
  `a61a61ff59f4151edd469949d0fe61094c890033`.
- 2026-09-19: GODD-2 aligned the three role skills and `CHECKPOINTS.md`; declared
  `feature_list.json` catalog-only; moved `progress/current.md` outside normal
  execution; and corrected README, init, Git workflow, reference, and status docs.
  `python3 -m json.tool feature_list.json`, `bash -n init.sh`, and
  `git diff --check` passed before commit.
- 2026-09-19: GODD-2 work-unit commit:
  `5a255c112f28d054eaf390c12cb46411d72b2b97`.
- 2026-09-19: GODD-3 added V0/V1/V2 candidate guidance to
  `docs/verification.md` and replaced legacy string checks with eight portable
  G-ODD drift tests in `scripts/test_factory_workflow_contract.py`.
- 2026-09-19: Final pre-commit verification passed: `git diff --check`, JSON
  parsing, `bash -n init.sh`, 33 factory tests, 16 publication metadata tests,
  and read-only preflight (`PREFLIGHT_OK_NOT_VERIFIED`, tests `NOT_RUN`).
  `verify_affected.py --base origin/main --plan` succeeded and conservatively
  selected every product gate because global/tooling process inputs changed; this
  plan is not product PASS and no product-code claim is made.
- 2026-09-19: GODD-3 is the final work-unit commit containing this evidence; its
  exact SHA is `c1c05fe63e5092669ff0ef94c7722dfc73b3a397`.
- 2026-09-19: Fresh independent review returned `CHANGES_REQUESTED` with four
  bounded process contradictions. One correction round was authorized: align
  routine startup, remove remaining global feature-ledger governance, correct this
  artifact's publication/count/commit state, and strengthen semantic drift guards.
- 2026-09-19: GODD-C1 addressed all four findings. Required pre-commit checks passed:
  `git diff --check`, JSON parsing, `bash -n init.sh`, 36 factory tests, and 16
  publication metadata tests. Final correction candidate: **1525 authored
  changed lines**; generated files: none.

## Next step

Complete the single correction commit and clean-tree checks, then return the exact
HEAD for fresh independent re-review. After approval, the parent resolves the
over-budget delivery strategy and may publish the branch/open the authorized PR.
This writer performs no remote mutation.
