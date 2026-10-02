# ODD execution artifacts

`odd/tasks/` holds the one recoverable execution artifact for substantial G-ODD
work. It is not a backlog, scheduler, approval system, or review authority.

## Choose the lane first

| G-ODD topology | When | Artifact rule |
| --- | --- | --- |
| Inline Direct | Small, understood work with no recovery value | No durable execution artifact |
| Delegated Direct | Substantial work, context-heavy exploration, multi-file implementation, or recovery value | Exactly one file: `<issue>-<slug>.md` |

Direct is always inside G-ODD. Changing tools does not change the contract:
Gentle-AI may execute the topology natively; ZCode or another Gentle-absent tool
follows the same repository contract manually.

### Evidence and delegation

- Start with one bounded parallel evidence batch; keep searches and reads narrow.
- When evidence would require more than roughly five sequential lookups, a long
  mapping session, or a parent context that is no longer useful, delegate one
  read-only Explorer.
- Explorer returns concise path:line evidence and does not write, broaden scope,
  or authorize implementation.
- A Writer receives an explicit, narrow allowed edit surface and is the only writer.
- A Verifier is independent/read-only and is used when risk is high or unclear.
- These budgets are routing heuristics, not file-count limits or quality caps.

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
2. Create this artifact before the first source/process write when the Delegated
   Direct topology needs durable recovery.
3. For Inline Direct work, do not create a task artifact merely to satisfy this
   directory's existence; the issue and PR remain the durable record.
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
