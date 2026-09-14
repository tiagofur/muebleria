Closes #<issue-number>
Delivery: complete

<!--
First nonempty line: Closes/Fixes/Resolves for a COMPLETE delivery; Refs for a PARTIAL delivery.
Second nonempty line: exactly `Delivery: complete` or `Delivery: partial`.
The pair is mandatory and must agree:
- complete => Closes/Fixes/Resolves #N, targets main, and the issue DoD is fully satisfied;
- partial => Refs #N and the parent issue remains open.
A human merge of a complete PR to main is expected to let GitHub close the issue natively.
Do not use Refs for a complete bounded issue just to defer closure to memory/manual cleanup.
-->

## Type
Select exactly one and apply its matching live PR label.
- [ ] Bug fix — `type:bug`
- [ ] New feature — `type:feature`
- [ ] Documentation — `type:docs`
- [ ] Refactoring — `type:refactor`
- [ ] Maintenance/tooling — `type:chore`
- [ ] Breaking change — `type:breaking-change`

## Summary
- Describe the outcome and its boundaries.

## Changes
| File | Change |
| --- | --- |
| Path | Behavior changed |

## Test evidence
Record commands, results, exact tested revision, and runtime proof. Explain N/A; do not claim skipped tests passed.

## Contributor checklist
Check only verified statements; append an explicit reason when an item is N/A.
- [ ] Linked issue is open and human-approved; approval was not self-granted.
- [ ] Delivery mode matches the issue DoD and first-line keyword (`complete` => closing keyword; `partial` => `Refs`).
- [ ] Exactly one supported `type:*` label is applied.
- [ ] Modified shell scripts passed shellcheck (or N/A with reason).
- [ ] Changed skills were tested in an agent (or N/A with reason).
- [ ] Documentation reflects changed behavior.
- [ ] Commits follow Conventional Commits, without AI attribution trailers.

## Delivered scope
Describe what this PR completes, with acceptance evidence.

## Remaining scope
List unmet parent-issue criteria and blockers; use None with evidence only for complete delivery.

## Merge boundary
Partial delivery must use `Refs #N` + `Delivery: partial` and leave the approved parent open. Complete delivery must use `Closes/Fixes/Resolves #N` + `Delivery: complete`; when merged by the human to `main`, GitHub should close that issue natively. Passing metadata checks does not authorize merge; explicit authorization and final exact-head CI/review readback remain required.
