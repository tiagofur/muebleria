# Candidate checkpoints

> Evaluate the destination and its evidence, not how many workflow steps an agent
> performed. Apply only checkpoints relevant to the approved issue and claimed
> delivery; an inapplicable product gate is `N/A`, not a fabricated PASS.

## C1 — Authority and identity

- [ ] The exact GitHub issue is open, approved, and matches the candidate scope.
- [ ] The lane is explicit: Direct has no execution artifact; ODD has exactly one
      `odd/tasks/<issue>-<slug>.md`; explicit SDD has only its canonical tasks artifact.
- [ ] Definition of Ready holds: numbered testable acceptance (`S1..Sn`, happy and
      negative paths), explicit exclusions/non-goals, and proposed labels
      (exactly one supported `type:*`, a `size:xs..l` estimate, `ux:shape` when a
      user-facing screen or flow changes). A `ux:shape` issue has its UX brief
      (`.agents/skills/ux-brief/`) published as an issue comment before any
      writer starts.
- [ ] One writer owns the branch/worktree; reservation/quarantine state is coherent.
- [ ] PR, HEAD, base, branch, and changed paths were read back from current state.
- [ ] No product code or unrelated issue scope is mixed into the candidate.

## C2 — Architecture and contract

- [ ] The change follows the applicable PRD, ADR, generated contract, migration,
      architecture, conventions, and domain ownership rules.
- [ ] Server authority remains server-side for security, tenant scope, lifecycle,
      pricing, stock, concurrency, workflow, and persistent business state.
- [ ] Generated outputs were regenerated from their source and drift checks pass.
- [ ] Product claims distinguish implemented behavior from target/future behavior.
- [ ] No secret, PII, silent legacy fallback, implicit `latest`, or unsafe recovery
      entered the candidate or its evidence.

## C3 — Proportional verification

- [ ] **V0 Structural:** diff/readback and applicable syntax, format, schema, and
      generated-drift checks pass.
- [ ] **V1 Functional:** focused positive/negative unit, contract, integration, or
      persistence checks prove the affected behavior.
- [ ] **V2 Operational:** required browser, PostgreSQL/RLS, SketchUp/TestUp,
      receiver/machine, or other real-boundary evidence passes.
- [ ] Required unavailable infrastructure is reported `NOT_RUN` or `BLOCKED`, never
      converted into PASS or silently dropped from the delivery claim.
- [ ] CI selection is conservative and every applicable result is current for the
      exact HEAD/base. Empty, stale, missing, failed, cancelled, or required skipped
      evidence does not pass.

## C4 — Independent review and correction

- [ ] A fresh reviewer different from the writer inspected the actual pinned diff.
- [ ] Clean context held: the reviewer received zero implementer chat transcript,
      reasoning logs, or scratch notes — only the pinned candidate (optionally the
      deterministic bundle from `scripts/factory_review_bundle.py`), the issue, and
      the diff, per `docs/demo/software-factory-clean-context-review.md`.
- [ ] The reviewer checked acceptance, boundaries, error paths, evidence applicability,
      publication semantics, and remaining scope rather than trusting a narrated PASS.
- [ ] Findings used the severity rubric: P0/P1 block (`security/RLS/tenant scope,
      data loss, broken build, contract drift, invariant violation` / `unmet
      acceptance, unhandled negative path, fabricated or missing evidence`),
      P2/P3 are suggestions; every blocker cites `path:line` and a correction.
- [ ] Concrete blockers were consolidated; optional suggestions did not expand DoD.
- [ ] If the targeted single correction round did not resolve blockers, a human made
      the stop/narrow/extend/follow-up decision. No loop-until-green or policy PASS.
- [ ] High-risk candidates (auth/RLS, migrations, shared contracts/parity fixtures,
      factory guardrails, >~400 authored lines, or a second failed review) escalated
      to blind dual review (`judgment-day`): two independent judges, identical frozen
      bundle, confirmed findings block, contradictions go to the human.

## C5 — Publication and human delivery

- [ ] Metadata passes `scripts/check_pr_metadata.py`: one approved issue, exactly one
      supported `type:*` label, and valid complete/partial first lines.
- [ ] `Closes/Fixes/Resolves + Delivery: complete` is used only for complete bounded
      scope on `main`; `Refs + Delivery: partial` names remaining scope.
- [ ] The PR body carries the `## Risk` line (`Risk: none` or `Risk: item N (<reason>)`),
      autonomous technical defaults under `## Decisions made without asking`, and the
      clean-context review handoff (pinned base/head + scope digest + verdict); a
      `ux:shape` PR carries `## Visual Evidence` honoring the published UX brief.
- [ ] The pushed tree is clean, the PR is open/non-draft, and mergeability is known.
- [ ] No auto-approval, API close, force-push, bypass, or automatic merge occurred.
- [ ] The final state is ready for a human to recheck and merge, or is honestly
      blocked with the smallest next action.

The product capability catalog, retained issue artifacts, and optional Engram
mirrors can provide context, but none is checkpoint authority for current scope,
ownership, code, review, CI, or delivery.
