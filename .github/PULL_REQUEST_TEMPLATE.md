Closes #<issue-number>

<!-- Keep the closing reference as the first nonempty line. Link an approved issue. -->

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

## Remaining scope and merge boundary
List unmet issue criteria and blockers. Partial delivery remains draft: do not merge a closing-reference PR while the linked issue is incomplete. No merge is authorized by this template or by passing checks.
