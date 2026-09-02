# Gate A scope exploration — Demo Commercial Rescue Mode

Date: 2026-09-02
Mode: read-only exploration; no implementation, issue mutation, branch, commit, or PR.

## Current-state audit

### Remote baseline verified

- Local `main`, `origin/main`, and `origin/HEAD` all resolve to
  `355be4ea4d3fead73cacd5ff67525ee8de80eb25` after `git fetch origin`.
- That commit is the merge of PR #535 (`feat(auth): add MFA and step-up security
  (#460 SEC-7)`). PR #535 is remotely `MERGED`; head
  `7d4fa85e5527309dfda7ab61963cf86246db8656`, base
  `f5d59a46571315c2d9a7f3ce4505ed38a1365a14`, merged at
  `2026-09-02T18:13:14Z`.
- Every recorded PR #535 check is successful: harness/feature list, TypeScript,
  Organization Browser Gate, Go Backend Tests, and the three SketchUp Ruby jobs.
- Issue #460 remains open because SEC-8/SEC-9 are deliberately not complete.
  This does not negate that the session-critical portion currently consumed by
  Gate A (server-side sessions, bounded 18h web lifetime, rotation/revocation,
  tenant-safe web cache, device credentials, MFA/step-up) is present on `main`.

### Canonical boundary

- #446 and ADR-0006 require Gate A before #385 introduces the first new
  persistent business family.
- #462 requires only the **critical mechanism** from #461 for Gate A; it does
  not require the complete audit timeline, observability platform, metrics,
  SIEM, exports, alerting, or Gate B work.
- Organization Foundation v2 invariant 32 and ADR-0006 section 10 require a
  critical business/security mutation and its audit/outbox record to commit in
  the same transaction.
- An outbox is needed only for an asynchronous external effect/projection.
  Foundation audit evidence itself is already a durable append-only database
  record and does not need a worker merely to satisfy Gate A.

### Existing durable mechanism — preserve, do not duplicate

`security_audit_events` already exists since migration 000080. Migration 000094
enables and forces RLS, supplies tenant-scoped read/insert policies, registers
it as an append-only audit class, and revokes UPDATE/DELETE from `granete_app`.
`PostgresStore.InsertSecurityAuditEvent` joins an ambient transaction when one
exists and otherwise opens a tenant transaction.

The generated/idempotent command boundary already supplies an ambient database
transaction for the principal Foundation HTTP commands. Therefore the sequence
`mutation -> auditRequired/InsertSecurityAuditEvent -> idempotency receipt ->
COMMIT` is already atomic for most of Gate A. Existing real PostgreSQL failure
tests prove this pattern for representative high-risk commands.

#### A — already durable/atomic: preserve and reuse

- Organization provisioning start/completion, entitlements, suspend,
  reactivate, begin-offboarding, terminate, and support-session start/end:
  `internal/application/organizations.go` explicitly wraps mutation plus audit
  in `WithinTenantTx`.
- Admin transfer, sector changes, and member offboarding:
  `internal/storage/team_commands.go` owns a transaction and writes the audit
  before commit. Real PostgreSQL tests include audit-trigger failure rollback.
- Membership-wide and exact session revocation: the SEC-2B database command
  commits session/family/credential epoch/audit together; storage and real HTTP
  failure-injection tests already exist.
- Refresh rotation/logout/reuse revocation: transaction-coupled audit exists;
  real PostgreSQL audit-failure rollback is covered.
- Account disable/reactivate: mutation and audit both run under the durable
  idempotency transaction used by the platform command route.
- Invitation create/resend/revoke/accept: success audit is required and joins
  the durable idempotency transaction. Acceptance writes invitation and
  membership lifecycle events in the same transaction; failed-command audit is
  intentionally recorded after rollback and contains no raw token.
- MFA factor enrollment/enable/remove, recovery-code regeneration/use and
  successful step-up: mutation and audit are transaction-coupled in
  `internal/storage/mfa.go`; negative authentication events are intentionally
  separate evidence because there is no successful business mutation to roll
  back. Secret-redaction tests already exist.
- Device enroll/approve/exchange/revoke: each storage operation uses
  `WithinTenantTx` and writes audit before commit.

Representative existing proofs to reuse include:

- `internal/storage/team_commands_test.go`: admin transfer, sector and
  offboarding audit rollback.
- `internal/application/organizations_test.go`: provisioning step rollback and
  support-session audit rollback.
- `internal/storage/organization_lifecycle_migration_test.go`: fresh/upgrade,
  real runtime role, provisioning HTTP, lifecycle and serialization.
- `internal/storage/session_directory_test.go` and
  `tests/pilotreadiness/session_directory_http_test.go`: exact/membership-wide
  session revocation and audit failure rollback.
- `internal/storage/auth_refresh_test.go` and
  `tests/pilotreadiness/web_refresh_cookie_http_test.go`: refresh/logout audit
  failure rollback.
- `internal/storage/identity_lifecycle_migration_test.go` and
  `tests/pilotreadiness/invitation_*`: invitation lifecycle, RLS, fresh/upgrade,
  replay and sanitized failure evidence.
- `internal/storage/auth_devices_test.go`, `internal/storage/auth_mfa_test.go`,
  and `tests/pilotreadiness/mfa_stepup_test.go`: device/MFA lifecycle, RLS,
  replay/concurrency, step-up binding and redaction.

#### B — partially durable: complete for Gate A

1. **Platform organization PATCH is a confirmed critical atomicity hole.**
   `PATCH /api/platform/organizations/{id}` calls
   `UpdateOrganizationVersion`, then emits `organization_renamed` and/or
   `organization_license_updated` through `Server.audit`, whose documented
   behavior is best-effort and ends in `slog.Warn` on insert failure. The route
   also lacks the normal durable idempotency wrapper. A license/name mutation
   can therefore succeed while its required security evidence fails. This is
   directly prohibited by ADR-0006 and #462's legacy guard.

2. **Session creation and organization selection use best-effort success audit.**
   Login creates the server-side `auth_sessions` row and later calls
   `Server.audit("login_success", ...)`; select-org updates the authoritative
   session scope and later calls `Server.audit("organization_selected", ...)`.
   Because these calls are outside the registry mutation transaction, an audit
   failure can leave the session/scope mutation committed. Gate A consumes
   login/switch and calls out session-critical audit, so these successful
   session lifecycle transitions should be migrated to a transaction-coupled
   command. Login failure audit can remain separate because no business state
   succeeds.

3. **Uniform executable proof is incomplete even where atomicity is structurally
   correct.** Basic membership role/status, invitation success commands, device
   approval/revocation, MFA management and account-status changes rely on the
   ambient idempotency transaction, but they do not all have a real PostgreSQL
   trigger-failure test proving business rollback. Gate A needs a compact table-
   driven/representative failure-injection suite against the real router and
   runtime role, not duplicate feature suites.

4. **The audit envelope is durable but underspecified.** The table stores
   `event_type`, actor/target/org, IP and arbitrary `details`; request correlation
   is usually embedded in `details`. There is no explicit schema-version column
   or central Gate-A event metadata policy. Add the smallest backward-compatible
   envelope needed by future #385: explicit `schema_version` and `request_id`
   (DB-authoritative timestamp and append-only RLS already exist), plus a
   fail-closed sanitizer/allowlist for the Gate-A event vocabulary. Do not build
   the complete #461 read model.

#### C — best-effort: migrate in the Gate A durable slice

- `organization_renamed` and `organization_license_updated` after platform
  organization PATCH.
- `login_success` when it accompanies creation of an authoritative server
  session.
- `organization_selected` when it accompanies an authoritative session-scope
  transition.

`login_failed` and other denial/diagnostic events are not successful critical
business mutations. They may remain separate/best-effort in this rescue slice
if making them durable would require an independent failure ledger; document
that choice instead of conflating it with mutation atomicity.

#### D — outside Gate A: defer

- Audit timeline redesign, cursor pagination, rich filters and CSV/JSON export.
- OpenTelemetry, full request-to-browser trace propagation, metrics/SLOs,
  enterprise alerting/SIEM and generalized readiness redesign.
- A generic outbox worker, retry/backoff/dead-letter framework when no Gate-A
  external projection exists.
- Gate B event families: relationships, publications, price policies,
  ManufacturingOrder handoff and installation assignment.
- SEC-8/SEC-9, #453–#459, and #385 implementation itself.

## Missing for Gate A

The minimum production-quality #461 gap is **not a new messaging platform**.
It is:

1. remove the three successful critical transitions above from
   `Server.audit` best-effort paths;
2. give platform organization PATCH the same idempotent transaction boundary
   used by other critical commands;
3. make the audit envelope explicitly versioned/request-correlated and reject
   secret-bearing metadata for the Gate-A vocabulary;
4. add real PostgreSQL failure-injection proving audit failure rolls back the
   corresponding mutation classes;
5. add an executable guard that fails if a critical route calls the
   best-effort helper again.

No asynchronous effect required by Gate A was found; therefore no outbox table,
worker, retries or dead-letter queue should be invented in PR A. The word
“outbox” in #461/#462 is conditional on an async projection/effect.

## Proposed implementation

### PR A — #461 Gate-A durable audit foundation

- Add a backward-compatible migration for the minimal explicit audit envelope
  (`schema_version`, `request_id`, constraints/index as justified) while
  retaining the existing append-only RLS table as the single authority.
- Add one typed Gate-A event writer/validator that joins the caller transaction,
  applies metadata allowlists/redaction, and never swallows insert failures.
- Refactor platform organization PATCH into an idempotent transaction-coupled
  command; protect license mutation with the existing platform step-up boundary.
- Couple login session creation and select-org scope mutation to their success
  audit. Keep unsuccessful authentication evidence semantically separate.
- Add real PostgreSQL/runtime-role trigger-failure proofs for the missing
  mutation classes and representative existing ambient-transaction commands.
- Add a narrow legacy guard for best-effort critical event use. Do not delete
  `Server.audit`; it remains valid for noncritical telemetry/denials.

### PR B — #462 executable Gate A only

- Create the canonical 34-scenario coverage matrix mapping each scenario to an
  existing real test/gate and record only the exact gaps.
- Extend `scripts/organization-browser-gate.sh`, `tests/pilotreadiness/*`, and
  existing migration suites rather than creating a second harness.
- Add one identifiable Gate A entrypoint/job that composes: fresh PostgreSQL 16,
  separate migration/runtime roles, `NOBYPASSRLS`, complete migrations,
  representative upgrade fixture, real Go router/auth/MFA, required browser
  scenarios, durable audit failure injection, legacy guards, and no-skip
  enforcement.
- Keep `scripts/pilot-gate.sh` compatibility but do not accept its current
  optional `pg_dump` warning as proof of the required Gate-A upgrade fixture.
- Update canonical docs/ledger only after the composed gate passes. Then record
  `Foundation Gate A = GREEN` and `#385 DT-1 may start` without closing #461,
  #460, #462 as a whole, or beginning Gate B.

This two-PR split matches a real review boundary: PR A changes the durability
contract; PR B composes and closes executable coverage. More slices would add
coordination cost without isolating another architectural unit.

## Current-state contradictions to correct during delivery

1. `progress/current.md` says SEC-7 is on a feature branch, pending review and
   “sin merge”. This is false on current `main`: PR #535 is merged at
   `355be4ea`, with all remote checks successful.
2. `feature_list.json` F202 `review_notes` repeats SEC-7 as pending review. It
   should record the merge SHA/check result while leaving F202 `in_progress`
   because #460 and SEC-8/SEC-9 remain open/deferred.
3. ADR-0007 status likewise says “SEC-7 implemented pending review”; it should
   say SEC-7 integrated. Organization Foundation v2 already describes SEC-7 as
   implemented, so the documents currently disagree.
4. ADR-0006 remains `Proposed` even though its canonical program and migrations
   have been governing merged work. Do not change its decision status casually;
   flag it for owner confirmation or the existing ADR acceptance convention.
5. `scripts/organization-browser-gate.sh` is a strong fresh-DB real-browser
   harness, but it is not yet the named 34-scenario Gate A authority and does
   not exercise an upgrade fixture. `scripts/pilot-gate.sh` may skip backup/
   restore when clients are absent, which is acceptable for the older pilot
   harness but not for Gate A's no-skip upgrade requirement.

## Scope/governance note

F202 is the only ledger feature currently `in_progress`. The user explicitly
authorized coordinated Gate-A rescue work and explicitly deferred SEC-8/SEC-9,
so Gate A can advance without falsely marking F202 complete. The ledger update
must state this coordination rather than inventing completion of #460 or
allocating several artificial micro-features.

## Deferred intentionally

- Complete #461 observability/timeline/export/worker scope.
- Complete #460 SEC-8/SEC-9 and ver4 EOL.
- Any Gate B or Sales Network implementation.
- Any #385 schema/API implementation before the final Gate A pass.
- Cosmetic refactors and unrelated security/platform improvements.

## Recommended acceptance of the rescue slice

PR A is accepted only when every successful critical Foundation mutation either
has a transaction-coupled required audit or is explicitly proven outside Gate A,
and trigger-injected audit failure returns failure with unchanged business state.
PR B is accepted only when the named Gate A entrypoint runs all 34 mapped
scenarios with real infrastructure, fresh plus upgrade coverage, no false skips,
sanitized artifacts, and the standard OpenAPI/typecheck/Go/diff gates. Only
then may the ledger say `#385 DT-1 may start`.
