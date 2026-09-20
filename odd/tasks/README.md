# ODD execution artifacts

`odd/tasks/` holds the one recoverable execution artifact for substantial G-ODD
work. It is not a backlog, scheduler, approval system, or review authority.

## Choose the lane first

| Lane | When | Artifact rule |
| --- | --- | --- |
| Direct | Small, understood work with no recovery value | No durable execution artifact |
| ODD | Two or more meaningful steps, or progress worth recovering | Exactly one file: `<issue>-<slug>.md` |
| Explicit SDD | The human explicitly chooses SDD | Use the canonical SDD tasks artifact; do not duplicate it here |

Changing tools does not change lanes. Gentle-AI may manage ODD natively; ZCode or
another Gentle-absent tool follows this repository contract manually.

## Ownership and authority

- The approved GitHub issue authorizes scope. This file records execution; it
  cannot approve, expand, schedule, assign, close, or merge work.
- One issue has one active writer. A fresh independent reviewer must not edit the
  candidate it reviews.
- Use a stable filename and stable task IDs. Resume the same file; never create a
  new file for a review round, correction, tool change, or session restart.
- Do not add front matter. The filename records the issue and this directory records
  the lane without duplicated metadata.
- Select the exact file from the approved issue; never scan this directory as a
  global work-status input.
- Engram may mirror this file for retrieval. The repository copy is authoritative.
- Keep evidence concise: observed command result, commit identity, limitation, and
  next action. Logs and review transcripts belong outside this artifact.

## Lifecycle

1. Explore proportionately before writing.
2. Create this artifact before the first source/process write.
3. Record scope, non-goals, constraints, acceptance, checks, route, forecast, and
   delivery strategy.
4. Implement task by task. Check an item only after observing its outcome and
   applicable checks; record the work-unit commit as evidence.
5. Keep failed, skipped, unavailable, and pending checks explicit.
6. Hand the exact HEAD/base to a fresh reviewer. Consolidate blockers into one
   correction round when feasible. If a blocker remains, ask the human whether to
   stop, narrow, extend, or open follow-up scope; never declare success by policy.
7. Completed artifacts remain in `odd/tasks/` as immutable history. No post-merge cleanup,
   move, archive directory, or follow-up commit is required. GitHub and the PR remain
   authoritative for delivery status.

## Template

Copy the headings below into the single issue artifact. Remove guidance comments,
not required evidence.

```markdown
# #<issue> — <outcome>

## Objective
<Observable outcome.>

## Problem
<Current condition and consequence.>

## Why
<Reason this work is authorized now.>

## Scope
- <Included behavior or process surface.>

## Non-goals
- <Explicit exclusion.>

## Constraints
- Approved issue, branch/base, one-writer rule, and relevant boundaries.

## Authorized scope
<Files/domains the issue permits.>

## Acceptance criteria
- <Observable completion condition.>

## Execution tasks
- [ ] **T1 — <work unit>**
  - Route: inline | delegated.
  - Trigger evidence: <why this is the smallest useful topology>.
  - Outcome: <reviewable result>.

## Verification plan
- `<exact command>` — <expected evidence>.
- TDD mode/source/runner when configured; otherwise ordinary checks.

## Delivery forecast
- Forecast: <authored additions + deletions; generated output excluded>.
- Delivery strategy: `ask-on-risk` | `auto-chain` | `single-pr` | `exception-ok`.
- Chain strategy and PR slice boundaries when applicable.

## Progress and evidence
- <date>: <task result, check, commit SHA, or honest limitation>.

## Next step
<One concrete continuation.>
```

The ~400 authored-line budget is a review-planning heuristic, not a quality cap.
Do not code-golf, omit tests, or delete useful documentation to fit it.
