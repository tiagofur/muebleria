Closes #<issue-number>

<!-- First nonempty line: Closes/Fixes/Resolves for complete delivery; Refs for partial delivery. Link an approved open issue. -->

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
Partial delivery must use the non-closing Refs keyword and leave the approved parent open. Complete delivery may use a closing keyword only when all issue criteria are satisfied. Passing metadata checks does not authorize merge; explicit authorization and final exact-head CI/review readback remain required.
