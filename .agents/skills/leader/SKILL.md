---
name: leader
description: "Trigger: coordinate approved Direct, ODD, or explicit SDD work through fresh review without implementing it."
---

# Leader

Read [the portable G-ODD contract](../../../docs/demo/software-factory-human-start.md)
and `AGENTS.md`. Coordinate the approved issue; do not implement product work, add
a second workflow, or treat an artifact as authorization.

## Dispatch

1. Verify the open approved issue, acceptance/exclusions, lane, existing PR, exact
   base, ownership/reservation/quarantine, live writer, and applicable truth sources.
2. For Direct, create no execution artifact. For substantial ODD, require the one
   `odd/tasks/<issue>-<slug>.md`. For explicit SDD, use its canonical tasks artifact
   and do not create an ODD duplicate.
3. Run `python3 scripts/factory_preflight.py`. It must report
   `PREFLIGHT_OK_NOT_VERIFIED`; it is not a test, reservation, or write authority.
4. Assign exactly one writer. Give it the outcome, exclusions, paths, invariants,
   V0/V1/V2 checks, exact base, and the smallest relevant source references.
5. After a coherent candidate is frozen, assign a different fresh reviewer with the
   exact issue, HEAD/base, diff, execution artifact, and verification evidence.
6. Consolidate real blockers into at most one correction round when feasible. If a
   blocker remains, return the decision to the human; the target is not a dogma.
7. Publish only after exact readback of current metadata, CI, review, and pins.

One-shot means one prepared candidate, not skipped exploration or checks. A bounded
read-only explorer may answer one named uncertainty but cannot become another writer.
Do not copy full backlogs, logs, or historical ledgers into handoffs.

## Publication and delivery

- Complete: first line `Closes #N`, `Fixes #N`, or `Resolves #N`; second line
  `Delivery: complete`; base `main`; all acceptance demonstrated.
- Partial: first line `Refs #N`; second line `Delivery: partial`; remaining scope
  explicit and issue open.
- Require exactly one supported `type:*` label and current `status:approved`.
- `scripts/check_pr_metadata.py` proves metadata shape, not the Definition of Done.
- CI validates the candidate; it is not the debugging loop. Required checks must be
  successful for the exact HEAD/base and cannot be an empty or stale set.
- Do not close by API, auto-approve, force-push, bypass, or merge. Human merge and
  native truthful issue closure remain separate authority.

Use `factory_handoff.py` only as the advisory pinned handoff described in
`docs/verification.md`. Its manifest does not approve, reserve, dispatch, review,
or merge. Receipt-driven review remains off unless a human explicitly enables it.

Return `PR_READY_FOR_HUMAN_MERGE` only after fresh independent approval and complete
remote readback. Otherwise return the concrete blocked state and smallest next step.
