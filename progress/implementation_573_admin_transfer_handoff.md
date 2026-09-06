# #573 prerequisite: last-admin dialog handoff

## Scope

User-authorized correction of the failed factory preflight, isolated from the
next factory infrastructure slice. This does not complete #573, reopen #458,
or change the feature ledger, API, permissions, machine integrations, or CSS.

## Cause and correction

The parent scheduled transfer opening before the source modal's closing effect
scheduled removal. Equal 350 ms deadlines allowed separate React commits to
expose two accessible dialogs. `Modal.onAfterClose` now reports committed portal
removal after cleanup. Both role and suspension paths consume that signal once.
Pending handoffs are scoped to the current API/session/query identity and source
attempt: leaving, switching context, canceling, or reopening cannot resurrect an
old transfer. Tokens are not serialized into keys, DOM attributes, or logs.

## Executed evidence

- Baseline `b1bfef6facba3b5c4a2ec0b980afd02b998fb979`: deterministic role and
  suspension regressions each fail with two dialogs when same-deadline callbacks
  execute separately. No added timing padding or weaker existing assertion.
- `pnpm --filter @granete/ui test src/users/UsersScreen.test.tsx src/common/Modal.test.tsx`:
  **67/67 passed**, including late responses after cancellation/context change,
  committed removal, reopen/unmount cancellation, focus restoration and scroll lock.
- `pnpm --filter @granete/ui typecheck`: **passed**. An initial test-only timer
  overload mismatch was corrected with an explicit DOM timer interface.
- Full `./init.sh`, independent behavioral validation, and remote CI are separate
  coordinator gates; this report does not assert their results in advance.

## UI boundary and rollback

The jsdom runtime exercises actual React portals, controls and API-client error
handling with controlled responses. It is not a real-browser/backend acceptance
run. No visual layout, tokens, copy or responsive rules changed; no new viewport
or screenshot claim is made. Roll back this bounded Modal callback, UsersScreen
handoff wiring and their tests/docs together; no data migration is required.
