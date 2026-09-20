# Candidate checkpoints

> Evaluate the destination and its evidence, not how many workflow steps an agent
> performed. Apply only checkpoints relevant to the approved issue and claimed
> delivery; an inapplicable product gate is `N/A`, not a fabricated PASS.

## C1 — Authority and identity

- [ ] The exact GitHub issue is open, approved, and matches the candidate scope.
- [ ] The lane is explicit: Direct has no execution artifact; ODD has exactly one
      `odd/tasks/<issue>-<slug>.md`; explicit SDD has only its canonical tasks artifact.
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
- [ ] The reviewer checked acceptance, boundaries, error paths, evidence applicability,
      publication semantics, and remaining scope rather than trusting a narrated PASS.
- [ ] Concrete blockers were consolidated; optional suggestions did not expand DoD.
- [ ] If the targeted single correction round did not resolve blockers, a human made
      the stop/narrow/extend/follow-up decision. No loop-until-green or policy PASS.

## C5 — Publication and human delivery

- [ ] Metadata passes `scripts/check_pr_metadata.py`: one approved issue, exactly one
      supported `type:*` label, and valid complete/partial first lines.
- [ ] `Closes/Fixes/Resolves + Delivery: complete` is used only for complete bounded
      scope on `main`; `Refs + Delivery: partial` names remaining scope.
- [ ] The pushed tree is clean, the PR is open/non-draft, and mergeability is known.
- [ ] No auto-approval, API close, force-push, bypass, or automatic merge occurred.
- [ ] The final state is ready for a human to recheck and merge, or is honestly
      blocked with the smallest next action.

The product capability catalog, retained issue artifacts, and optional Engram
mirrors can provide context, but none is checkpoint authority for current scope,
ownership, code, review, CI, or delivery.
