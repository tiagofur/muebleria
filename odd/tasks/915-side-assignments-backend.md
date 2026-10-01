# ODD — #915 side assignments (backend slice)

- Issue: #915 (approved; backend slice per the Phase-1 plan — UI React
  stays in Phase 2, so the PR ships Refs/partial).
- Base: `origin/main` @ `fb9a98e6` (post #947 pinning). Worktree
  `../muebles-worktrees/915-side-assignments`.

## Facts

- `components` is tenant-owned (000083 org scope, 000094 RLS inventory row).
- Contract #912 froze the six canonical board faces; the issue's L1/W1 mock
  is discarded by its own no-aliases rule.
- Assignment lives on the DEFINITION (owner-ratified), UNIQUE(component, side).
- Profile reference must be active + same org; cross-org reference is
  indistinguishable from missing (isolation contract).

## Tasks

- [x] Migration 000144 (+down): table, six-face CHECK, UNIQUE(component,side),
      full RLS checklist, org + component indexes.
- [x] Domain: server-owned id/timestamps on ComponentSideAssignment.
- [x] Storage: List (by component), Set (upsert with reference validation),
      Remove; ErrAssignmentReferenceInvalid.
- [ ] API handlers + routes + OpenAPI + generated client.
- [ ] Tests: storage CRUD + reference fail-closed + cross-org isolation
      family + migration fresh/upgrade; handler tests.
- [ ] PR Refs #915 partial (remaining: React UI).

## Evidence log

- 2026-10-01 startup: preflight OK @ fb9a98e6.
