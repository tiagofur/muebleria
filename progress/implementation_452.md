# Implementation report — Issue #452 / F197

## Scope delivered

- Canonical six-state Organization lifecycle with `organizations.active` removed by migrations `000100` and `000101`.
- One synchronous PostgreSQL `OrganizationService` for Platform, Factory/Sales Network and CLI provisioning.
- Atomic settings, entitlement snapshot, bootstrap admin, catalog strategy, required audit, readiness and activation inside the idempotency transaction.
- Organization credential epochs in JWT v4, live status/epoch checks, support-session termination and write denial for non-active organizations.
- Versioned suspend, reactivate, offboarding, terminate and entitlement commands through generated OpenAPI operations.
- Offboarding preview based on current project, production claim, part operation, module unit, installation visit, field issue, punch item, purchase order, warranty and child-organization facts.
- Minimal Platform/Factory React migration to the shared provisioning command and truthful lifecycle statuses; final Organization workspace remains owned by #458.

## Atomicity and concurrency evidence

- Unit failure injection covers entitlements, workshop settings, bootstrap membership, catalog clone, start audit, readiness, activation and completion audit; every failure rolls the command back.
- PostgreSQL 5xx proof retries the same key twice and leaves zero organizations and receipts while preserving two sanitized failure audits.
- Client errors roll back business changes and replay the exact durable receipt.
- HTTP and CLI tests cover same-key replay, payload mismatch and concurrent same-slug typed conflict.
- The CLI requires an operator-provided `--idempotency-key`; scope, fingerprint and request lineage are stable across retries.
- `organization_provisioning_failed` records only target hash, typed error code and request ID; request payload, name, slug and bootstrap identity are not persisted.

## Security and lifecycle evidence

- JWT organization epoch changes on suspension, reactivation, offboarding and termination, so credentials issued before a transition never revive.
- Suspension and offboarding end open support sessions transactionally; another Organization membership on the same User keeps its independent credential epoch.
- Runtime-role SQL allows recovery reads for suspended/offboarding organizations while denying direct `INSERT`, `UPDATE`, `DELETE` and `UPSERT` writes.
- Runtime `INSERT`, `UPDATE` and `DELETE` privileges on `organizations` are revoked. Narrow `SECURITY DEFINER` commands validate Platform or active Factory-admin authority, actor, parent/type, transition and expected version before creating or mutating a row.
- RLS, Team last-admin/seat invariants and membership credential epochs remain the existing authorities; #452 does not duplicate them.
- Offboarding locks the responsible project rows, recomputes a deterministic impact fingerprint inside the lifecycle transaction and never deletes business history.

## Migration evidence

- Fresh migration and upgrade from the pre-#452 schema backfill canonical status, lifecycle metadata, credential epoch and entitlement defaults.
- A historical partial fixture without the final #451 columns is normalized before lifecycle functions are replaced.
- Rollback/reapply is green before lifecycle facts exist; the down migration fails closed once new lifecycle-only facts would be lossy.
- Migration head is `000101_remove_organization_active`; no runtime Go/OpenAPI/React authority remains on the boolean.

## Verification evidence

- `pnpm openapi:check` — generated operation and schema drift checks green.
- `pnpm typecheck` — all workspaces green.
- `pnpm test` — domain 1156, storage 176, excel 93, desktop 17, mobile 49, UI 1458 and web 326 tests green.
- `go test -p=1 -parallel=1 ./... -count=1` on a fresh PostgreSQL database — all backend, storage and pilot readiness packages green.
- `PATH="$HOME/.rbenv/shims:$PATH" GOFLAGS='-p=1 -parallel=1' ./init.sh` on a fresh PostgreSQL database — complete harness green, including Ruby 3.2.11 and deterministic RBZ verification.
- `GOFLAGS='-p=1 -parallel=1' scripts/pilot-gate.sh --fresh-container` — direct runtime-role RLS plus the complete no-skip Pilot Readiness gate green on ephemeral PostgreSQL 16.
- Impeccable detector on the modified Platform/Settings UI — zero findings.
- `git diff --check` — green.

## Delivery state

Implementation is ready to be committed and pushed in the approved draft Feature Branch Chain. F197 remains `in_progress` until an independent reviewer approves the pushed implementation and remote CI/readback are green.

## Independent review correction round 1

- Closed Factory runtime provisioning access by granting the transaction only the exact source + newly inserted child after a database-authorized create command.
- Closed direct lifecycle bypass by revoking runtime `INSERT`, `UPDATE` and `DELETE` on `organizations`; metadata and lifecycle writes now cross narrow command functions.
- Added HTTP/PostgreSQL Factory rollback/retry/replay proof and direct own/foreign Organization mutation denials with an authoritative-command positive control.
- Made the canonical `provisioning_failed -> terminated` cleanup path executable through the service and database while preserving terminal lifecycle timestamps.
