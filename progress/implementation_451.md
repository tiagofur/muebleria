# Implementation report — Issue #451 / F196

## Scope delivered

- Server-authoritative Team capabilities with Go/TypeScript parity and target-role authorization.
- Membership directory/detail read models with account status, membership status, sectors, blockers, seats and capabilities.
- Versioned/idempotent commands for role changes, suspend/reactivate, session revocation, admin transfer, sector replacement, offboarding preview and offboarding execution.
- PostgreSQL last-admin and seat invariants, one-way initial-admin bootstrap, membership credential epochs, membership sectors with RLS, and durable blocked/mutation audit events.
- Exact-row offboarding impact tokens, explicit per-responsibility reassignment, active-work blockers, credential revocation and atomic rollback.
- Team UI capability gating, independent invitation loading, honest error states and sentence-case actions.
- Safe Go ServeMux action dispatch preserving the generated OpenAPI command paths.

## Verification evidence

- `go test -p 1 ./... -count=1` — green, including storage race/migration tests and pilot readiness.
- `pnpm openapi:check` — generated contract/client drift green.
- `pnpm --filter @granete/storage typecheck` — green.
- `pnpm --filter @granete/ui typecheck` — green.
- `pnpm --filter @granete/ui test` — 147 files, 1457 tests green.
- `git diff --check` — green.

## Security proofs

- Concurrent two-admin suspension: exactly one commit succeeds; the other is rejected by `organization_requires_active_admin`.
- New organization bootstrap is explicit and one-way; after the first active admin, removing the last admin remains impossible.
- Public invitation seat failures map to typed `SEAT_LIMIT_REACHED` and persist denial lineage after rollback.
- Cross-tenant Team access remains fail-closed through API and runtime-role RLS pilot tests.
- Residual sectors block incompatible role changes; sector replacement validates organization type, live roles, membership version and tenant scope.
- Offboarding revalidates exact responsibility IDs, blocks active production claims, rejects invalid/cross-org targets and rolls back when audit fails.

## Delivery state

Implementation is committed on `codex/451-safe-team-administration`. F196 remains `in_progress` until independent review and remote CI readback complete.
