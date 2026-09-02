# Gate A durable audit/outbox current-state audit

Date: 2026-09-02
Audited branch/SHA: `main` at `355be4ea4d3fead73cacd5ff67525ee8de80eb25`
Remote readback: `origin/main` is the same SHA after `git fetch origin`. PR #535 (SEC-7) is merged at this SHA, despite the now-stale `progress/current.md` text that still says SEC-7 is pending review.

## Scope and authorities read

- GitHub: #446, #460, #461, #462, #385 and the relevant comments.
- Canonical: `docs/architecture/organization-foundation-v2.md`, ADR-0006, ADR-0005, `docs/architecture.md`, `docs/verification.md`.
- State: `progress/current.md`, `feature_list.json`, repository `AGENTS.md`.

## Direct answer

The repository already has a real transactional audit mechanism for most Foundation commands: `security_audit_events`, request-wide tenant transactions, command-owned transactions, durable idempotency receipts, and several PostgreSQL failure-injection proofs. Gate A does **not** need a new outbox/worker for the currently synchronous Foundation mutations; no asynchronous projection is consumed by Gate A.

What is still missing is narrower but real:

1. eliminate the remaining critical callers of best-effort `Server.audit()` (`login_success`, `organization_selected`, `organization_renamed`, `organization_license_updated`);
2. make the existing audit envelope versioned and centrally validated/redacted (today `event_type + details JSONB` has no schema version and `marshalDetails` silently substitutes `{"encode_error":true}`);
3. close the org-less audit RLS leak (`organization_id IS NULL` is readable by every app-role transaction, not just the actor/platform authority);
4. add real PostgreSQL failure-injection coverage for the critical paths that are atomic by architecture but not yet proven when audit insertion fails (membership roles/status, invitations, organization provisioning/lifecycle, device approval/exchange/revoke, and MFA success mutations);
5. either make Gate A bootstrap CLI mutations atomic/audited or explicitly stop treating legacy `admin create` / `create-platform-admin` setup as production Gate A behavior.

## Existing mechanism inventory

### Durable audit table and RLS

- `backend-go/db/migration/000080_multi_org_core.up.sql:66-83` creates `security_audit_events` with UUID id, event type, actor/target user, organization, IP, JSONB details, DB timestamp, and indexes.
- `backend-go/db/migration/000094_tenant_rls.up.sql:190` registers it as an append-only ledger.
- `backend-go/db/migration/000094_tenant_rls.up.sql:470-481,510` enables/FORCEs RLS, permits insert under actor/org scope, and revokes runtime UPDATE/DELETE.
- `backend-go/internal/storage/organizations.go:264-298` inserts through the ambient transaction or opens a tenant transaction when called standalone.
- There is **no outbox table, worker, retry queue, dead-letter store, lag metric, or projection consumer** in current `main` (no production `outbox` symbol or migration).

### Transaction boundaries

- `backend-go/internal/storage/tenant_transaction.go:106-139` is the canonical transaction owner and uses transaction-local tenant context.
- `backend-go/internal/api/middleware.go:137-175` wraps every authenticated request in that transaction; a handler 5xx returns `errTenantHandlerFailure`, rolling back all business writes and required audit writes before the buffered response is released.
- `backend-go/internal/storage/postgres.go:27-47` makes nested repository transactions borrow the request transaction, so legacy repository calls cannot commit ahead of the application boundary.
- `backend-go/internal/storage/idempotency.go:47-184` serializes commands across replicas, stores the replay receipt atomically with successful business/audit changes, rolls back command savepoints on 4xx/5xx, and preserves only sanitized failure evidence after rollback.
- `backend-go/internal/api/handlers.go:488-497` provides fail-closed `auditRequired` and request-ID enrichment.
- `backend-go/internal/api/handlers.go:468-485` still provides the explicitly best-effort `audit` helper and swallows insert failure with `slog.Warn`; this is the remaining unsafe primitive for critical events.

### Idempotency/retry/dead-letter/version/correlation

- Idempotency is real and persistent through `api_idempotency_receipts` (`backend-go/db/migration/000093_idempotency_receipts.up.sql`; RLS in migration 000094). PostgreSQL multi-replica/replay/crash tests are in `backend-go/internal/storage/idempotency_postgres_test.go:39-224`.
- Retry is request retry through durable receipts. There is no asynchronous event retry because there is no outbox.
- Dead-letter is absent and unnecessary unless this slice adds an asynchronous projection. Adding a worker solely to satisfy the word “outbox” would be overarchitecture.
- Event versioning is absent. `security_audit_events` has neither `schema_version` nor a versioned typed payload contract.
- Request correlation exists but is embedded inconsistently in `details.request_id`; `RequestIDMiddleware` is in `backend-go/internal/api/request_id.go:19-50`. There is no top-level request ID, trace ID, actor membership ID, support-session ID, target membership/org ID, or resource identity in the audit schema.
- Redaction is local/ad hoc. MFA and invitation tests reject specific secret leaks, but there is no central per-event allowlist. `marshalDetails` in `backend-go/internal/storage/organizations.go:290-298` explicitly refuses to fail on serialization and can commit an `encode_error` placeholder instead of valid evidence.

## A/B/C/D classification

Legend:

- **A** — durable/atomic now; conserve and reuse proofs.
- **B** — atomic architecture exists, but envelope/policy/proof is incomplete for Gate A.
- **C** — current critical mutation is best-effort, unaudited, or can commit without its evidence.
- **D** — not required to unblock Gate A; defer.

| Foundation operation | Class | Current evidence | Exact remaining gap |
|---|---|---|---|
| Admin transfer | A | `backend-go/internal/storage/team_commands.go:165-238`; `TestTransferOrganizationAdmin_IsAtomicVersionedAndAudited`, `...ConcurrentReplayHasSingleWinner`, `...AuditFailureRollsBackBothMemberships` in `team_commands_test.go:48-146` | Reuse; do not redesign. |
| Membership offboarding + reassignment + credential cut | A | `team_commands.go:521-582`; `TestOffboardMember_ReassignsAllResponsibilitiesAndRevokesCredentials` and `...AuditFailureRollsBackReassignmentsAndStatus` at `team_commands_test.go:253-391` | Reuse. |
| Membership sector/critical role compatibility | A | `team_commands.go:253-352`; `TestChangeMembershipSectors_AuditFailureRollsBack` at `team_commands_test.go:201-227` | Reuse. |
| Membership role change | B | Handler mutation then `auditRequired` in `api/orgteam.go:266-302`; both share AuthMiddleware transaction. Idempotent route and organization-admin step-up are registered at `api/routes.go:167-174`. | Add one real HTTP/PostgreSQL injected audit failure proof showing roles/version remain unchanged. Prefer a command-owned store primitive only if a non-HTTP caller must use this operation. |
| Membership suspend/reactivate | B | `api/orgteam.go:328-373` uses `auditRequired` in ambient transaction; DB constraints/session epoch enforce lifecycle. | Add injected audit failure proof for both status/version and session access rollback. |
| Membership-wide/session-specific revocation | A | Stored command function plus ambient audit; SQL/HTTP failure injection in `session_directory_test.go:180-224,332-374` and `tests/pilotreadiness/session_directory_http_test.go:208-269`. | Reuse. |
| Invitation acceptance / membership creation-reactivation | A | One storage transaction and two required audit records at `storage/organizations.go:876-1006`; real replay/concurrency tests in `tests/pilotreadiness/invitation_acceptance_http_test.go:31-159`; sanitized failure evidence in `invitation_lifecycle_test.go:65-122`. | Reuse; a direct audit-trigger rollback assertion would strengthen but is not the first blocker. |
| Invitation create/resend/revoke | B | `api/orgteam.go:760-889`; business write + `auditRequired` share authenticated/idempotency transaction. | Add audit-trigger failure injection for created token row, rotation, and revocation. Ensure response never returns the new raw token after rollback. |
| Organization provisioning | B | Fully transacted service in `application/organizations.go:171-258`; both start/completion audits required. Material-step rollback tests in `application/organizations_test.go:203-265`; real runtime-role success/rollback/replay in `organization_lifecycle_migration_test.go:418-513`; durable failure receipt in `idempotency_postgres_test.go:177-224`. | Add a real PostgreSQL trigger failure on `organization_provisioning_started/completed` and assert no organization/bootstrap membership/settings/entitlements/receipt partial state. Current audit-failure coverage is fake-store only. |
| Organization suspend/reactivate/offboard/terminate | B | Service mutation, credential epoch/support cuts, and `auditLifecycle` share one transaction at `application/organizations.go:412-578`; runtime-role lifecycle test at `organization_lifecycle_migration_test.go:607+`. | Add real PostgreSQL audit-trigger rollback per lifecycle family; fake-store tests do not prove DB rollback. |
| Organization entitlements | A/B | Required audit in same service transaction at `application/organizations.go:305-328`. | Atomic by code; add one real audit failure rollback proof. |
| Platform account disable/reactivate | A | Mutation and required audit in `storage/users.go:63-90`; invoked through idempotent + platform step-up route. `TestPilotReadiness_OnlyPlatformCanChangeGlobalAccountStatus` verifies real boundary and audit. | Reuse; optionally add audit-trigger rollback if consolidating the matrix. |
| Support-session start/end | A | Service-owned transactions at `application/organizations.go:335-409`; `TestSupportSessionAuditFailuresRollbackStartAndEnd` at `organizations_test.go:317-345`; real scoped/audited HTTP at `tests/pilotreadiness/platform_test.go:82-121`. Start’s registry row and token-error rollback join the authenticated request transaction. | Reuse. A real DB audit-trigger proof is desirable but lower priority than the C paths. |
| Refresh rotation/logout/reuse revocation | A | Required audits in `storage/auth_refresh.go`; real audit-trigger rollback `TestAuthRefresh_AuditFailureRollsBackConsumption` and logout HTTP failure injection `TestWebLogoutInternalFailurePreservesCookieAndRetryCloses`. | Reuse. |
| Login success + session creation | C | Public login commits session/refresh in `createRefreshableAuthSession`, later updates last login, then calls best-effort `s.audit("login_success")` at `api/handlers.go:565-603,639-687`. These are separate transactions on the public route. | Couple successful login session/family/last-login/audit in one transaction or define the exact critical boundary and ensure session creation cannot succeed without durable login evidence. Add audit-trigger rollback/retry proof. `login_failed` may remain best-effort telemetry because there is no business success to roll back. |
| Organization/session scope switch | C | `UpdateAuthSessionScope` is followed by explicitly “best-effort audit” (`api/handlers.go:757-765,812-824`). AuthMiddleware transaction prevents partial switch for later 5xx, but swallowed audit failure produces 200 and commits the switch. | Replace with required audit and inject audit failure over real HTTP: old scope remains valid, new scope is not committed, and no success response is exposed. |
| Platform organization rename/license PATCH | C | `UpdateOrganizationVersion` commits in request transaction, but both `organization_renamed` and `organization_license_updated` call `s.audit` and swallow failure (`api/platform.go:171-194`). License is explicitly a #461 critical family. | Replace with one versioned required event in the same transaction; inject audit failure and assert name/plan/expiry/version all roll back. Route should also receive the same platform step-up/idempotency treatment as other platform-critical commands or be removed from the critical surface. |
| Device enroll/approve/exchange/revoke | B | Each mutation and audit share storage transaction (`storage/devices.go:127-164,185-228,230-335,509-553`); approval is step-up + idempotent. Fresh/upgrade and real app-role lifecycle tests are in `auth_devices_test.go:74-260`; browser step-up is `tests/organization/mfa.spec.ts`. | Add audit-trigger rollback tests, at least for approval and exchange (no approved/exchanged state or minted device/session/secret response after failure). |
| MFA enroll/enable/remove/recovery regeneration and successful step-up | B | Required audit is in each transaction (`storage/mfa.go`); failure audits intentionally persist outside the failed verification savepoint. Fresh/upgrade, replay/single-use, scope/expiry/RLS and no-secret tests exist in `auth_mfa_test.go:59-596`; HTTP/browser coverage exists in `mfa_stepup_test.go` and `tests/organization/mfa.spec.ts`. | Add success-path audit-trigger rollback tests for factor enable/remove, recovery rotation, recovery-code consumption, and step-up grant creation. Existing no-secret tests do not prove audit-insert rollback. |
| Platform-admin grant and CLI membership grant | C | `cmd/admin/main.go:188-266` performs `SetPlatformAdmin` / `EnsureMembership` and then a separate audit transaction. Audit failure returns an error after authority already changed. | If Gate A uses these as production/bootstrap commands, wrap mutation+audit in `WithinTenantTx` and add failure injection. Otherwise restrict them to explicit fixture/bootstrap setup and do not count them as Gate A scenario proof. |
| Legacy `admin create`, initial-org trial fallback, `set-license`, `reset-password` | D for Demo Gate A, but recorded debt | `cmd/admin/main.go:105-186,269-337`; `ensureInitialOrgLicense` even logs a warning and returns after failed license mutation; reset password has no audit. | Do not expand this slice unless Gate A continues to claim these CLI paths as production Foundation behavior. Prefer replacing browser-gate fixture bootstrap with a purpose-built fixture path. Track separately for #460/#461 completion. |
| Audit UI timeline, pagination/export, full OTel, metrics/SLOs, readiness/outbox lag, SIEM/security supply chain | D | Full #461 scope, not required to establish atomic evidence for Gate A. | Defer intentionally; do not block #385 once Gate A’s durable evidence and isolation are real. |
| Relationship/catalog/price/order/install network events | D | Gate B families are not implemented/allowed before Gate A. | Defer to Gate B and their owning issues. |

## Security/schema findings that Gate A should not ignore

1. **Org-less audit RLS is overbroad.** `security_audit_read` uses `organization_id IS NULL OR app_has_organization_access(...)` (`000094_tenant_rls.up.sql:472-480`). Therefore any `granete_app` transaction can select every org-less login/MFA/device event, regardless of `actor_user_id`. API routing does not repair direct-SQL RLS. Gate A should require actor-self or explicit platform authority for org-less events and add A↔B direct-SQL negative proof.
2. **No schema/version authority.** New #385 events would otherwise perpetuate arbitrary JSON. Add a minimal `schema_version` (default/backfill `1`, positive constraint) and a typed/validated event builder before #385 starts. A full event registry/UI is not required.
3. **Serializer fail-open.** `marshalDetails` can replace an invalid payload with `{"encode_error":true}` and still let the business mutation commit. For critical events, validation/serialization must happen before mutation commit and must return an error. Noncritical telemetry can keep best-effort behavior.
4. **Request ID is not structural.** It is a JSON detail added by helpers, absent in several storage-generated events and in CLI records. Minimal Gate A should persist a top-level nullable `request_id` (or enforce it in the versioned payload) for HTTP commands; do not require full OpenTelemetry/trace plumbing now.
5. **No central secret/PII allowlist.** Existing tests cover invitation tokens/passwords and MFA materials, but arbitrary details remain accepted. A small per-event-family allowlist/redaction validator is sufficient for Gate A; do not build the human timeline/export UI.

## Existing PostgreSQL/browser proofs to reuse

- Tenant transaction/app role/RLS/pool reuse: `backend-go/internal/storage/tenant_rls_test.go`, especially `TestTenantRLS_PoolReuseRollbackRoleAndInventoryReadiness`.
- Admin transfer/sectors/offboarding atomicity and audit failure: `backend-go/internal/storage/team_commands_test.go`.
- Session/family/membership revoke failure rollback: `backend-go/internal/storage/session_directory_test.go` and `backend-go/tests/pilotreadiness/session_directory_http_test.go`.
- Refresh/logout audit rollback: `backend-go/internal/storage/auth_refresh_test.go` and `backend-go/tests/pilotreadiness/web_refresh_cookie_http_test.go`.
- Organization provisioning runtime role/idempotency/failure rollback: `backend-go/internal/storage/organization_lifecycle_migration_test.go` and `idempotency_postgres_test.go`.
- Invitation real HTTP replay/concurrency/isolation: `backend-go/tests/pilotreadiness/invitation_acceptance_http_test.go` and `invitation_lifecycle_test.go`.
- MFA/device real storage/HTTP: `backend-go/internal/storage/auth_mfa_test.go`, `auth_devices_test.go`, `backend-go/tests/pilotreadiness/mfa_stepup_test.go`.
- Browser real: `scripts/organization-browser-gate.sh` launches PostgreSQL 16 with separate migration/runtime roles and Playwright; reuse `tests/organization/bootstrap.spec.ts`, `lifecycle.spec.ts`, `switch.spec.ts`, `webauth.spec.ts`, and `mfa.spec.ts`. It currently proves auth/cache/MFA behavior, not audit failure rollback.

## Minimal production-quality implementation recommendation

### PR A — #461 Gate-A durable audit foundation

1. Evolve `security_audit_events` additively with `schema_version` and structural request correlation; correct org-less RLS.
2. Introduce one strict critical-audit insert/event builder with explicit version and allowlisted metadata; serialization/redaction errors fail the transaction.
3. Keep `audit()` only for noncritical failure/telemetry events and prohibit it for critical event vocabulary with a focused guard test.
4. Migrate the three actual critical best-effort families: successful login/session creation, organization selection, and platform organization rename/license update.
5. Decide bootstrap CLI boundary explicitly; make platform-admin grant atomic if it remains part of Gate A.
6. Add table-driven real PostgreSQL audit-trigger rollback tests across representative mutation families. Reuse one harness rather than duplicating every endpoint test.
7. Do **not** add an outbox/worker: Gate A has no external projection to deliver. #385 can append durable audit records; an outbox should be introduced only with a real asynchronous consumer.

### PR B — #462 Gate-A integration

Reuse the existing tests/gates and add only scenario assertions that the Gate A matrix shows missing. Integrate the representative durable-audit failure harness into the executable Gate A job and add direct-SQL org-less audit isolation. Do not implement Gate B.

## Deferred intentionally

- Complete #461 UI/read model, cursor pagination, filters/export, full trace propagation, OpenTelemetry, metrics/SLOs, alerting/runbooks, SIEM, security supply-chain expansion.
- Any generic outbox platform, backoff/dead-letter worker, or projection framework until an actual asynchronous Gate A consumer exists.
- SEC-8/SEC-9, Gate B, Sales Network, #453-#459, #385 and Digital Thread implementation.
- Legacy CLI recovery/bootstrap cleanup except where the final Gate A harness directly depends on it.

## Bottom line

Most critical Foundation mutations are already transactionally coupled to durable audit. The minimum blocker is **not** “build #461”; it is to remove four remaining critical best-effort call sites/families, version and validate the existing audit envelope, fix org-less audit RLS, and prove rollback under real PostgreSQL for the unproven command families. No outbox is justified for Gate A’s current synchronous evidence path.
