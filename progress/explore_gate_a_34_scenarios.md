# Gate A #462 — current coverage inventory (34 scenarios)

- Audited revision: `main@355be4ea4d3fead73cacd5ff67525ee8de80eb25`
  (merge of PR #535 / SEC-7).
- Scope: read-only inventory of reusable evidence. This is not a Gate A PASS
  report and no test was executed as part of this exploration.
- Status semantics:
  - **PASS**: an existing executable proof exercises the scenario's critical
    boundaries with real PostgreSQL/API/browser as applicable.
  - **PARTIAL**: useful proof exists, but one required boundary or variant is
    still isolated, mocked, static, or absent from the real gate.
  - **MISSING**: no executable proof of the scenario was found.

## Gate infrastructure already available

| Harness | What it really proves | Limitation for Gate A |
|---|---|---|
| `scripts/organization-browser-gate.sh` | Fresh PostgreSQL 16 container; distinct migration/runtime credentials; runtime role explicitly checked `NOSUPERUSER`/`NOBYPASSRLS`; real Go server, Vite and Chromium; no Playwright skips. Runs `tests/organization/*.spec.ts`. | It provisions fixtures before Playwright, but does not execute the 34-scenario backend/storage matrix, an upgrade fixture, or durable-audit failure injection. |
| `scripts/pilot-gate.sh` + `backend-go/tests/pilotreadiness/*` | Real PostgreSQL, real router/HTTP and deterministic two-organization fixtures. `PILOT_READINESS_GATE=1` converts unavailable PostgreSQL from a skip to failure for the pilot package. | It runs only `^TestTenantRLS_` from storage plus the pilot package. It does not select the newer migration/team/organization/session suites needed by Gate A. Its `--fresh-container` uses the superuser DSN rather than the split migration/runtime-role topology of the browser gate. |
| `.github/workflows/ci.yml` `backend-go` | PostgreSQL 16 service and `go test -p 1 -v ./...`; `DATABASE_URL` prevents the normal integration tests from skipping for lack of DB. | It is broad CI, not an identifiable Gate A job; several helpers still use `t.Skip*`, so Gate A needs an explicit no-skip wrapper/readback rather than inferring readiness from the broad job. |
| `scripts/smoke-deploy.sh` | Compose/env/docs/backup/health structural consistency. | No live Foundation behavior, RLS, browser, upgrade, audit or outbox proof. It is reusable as a companion check only. |

## Coverage matrix

| # | Scenario #462 | Existing proof to reuse | Status | Exact remaining gap / boundary quality |
|---:|---|---|---|---|
| 1 | Platform/bootstrap creates Factory A | `TestFactoryProvisioningHTTPPostgresRuntimeRoleSuccessRollbackAndReplay`; `organization-browser-gate.sh` runs the real `admin create-org` bootstrap for Factory A/B. | **PASS** | Core creation/readiness is real PostgreSQL + real router and the browser harness bootstraps a fresh DB. Final Gate A must wire it into one job and add the durable-audit assertion supplied by the #461 slice. |
| 2 | Admin invites a new user; invite accepted; enters Factory A | `TestPilotReadiness_InvitationAcceptanceHTTP_NewIdentityReplayIsStable`; pilot fixture bootstrap uses the same invitation-first route. | **PASS** | Real HTTP/PostgreSQL; asserts direct invited-org session, one identity/membership, audit and idempotent replay. Reuse unchanged. |
| 3 | Existing user accepts Factory B invite; memberships isolated | `TestPilotReadiness_InvitationAcceptanceHTTP_ExistingIdentityCreatesOnlyInvitingMembership`; `TestPilotReadiness_MembershipExplicitContext`. | **PASS** | Real HTTP/PostgreSQL; proves same global identity, exactly two memberships, direct B scope and A/B authorization separation. |
| 4 | Expired/revoked/rotated/replayed invitation token fails correctly | `TestPilotReadiness_ExpiredAcceptancePersistsLifecycleAndAuditAfterCommandRollback`; `TestPilotReadiness_ResendRotatesTokenAndOnlyNewTokenCanBeAccepted`; concurrent/idem replay tests; `TestInvitationAcceptanceTypedLifecycleErrors`. | **PARTIAL** | Expired and replay are real HTTP/PostgreSQL; rotated-old-token is direct storage on real PostgreSQL. Revoked acceptance is only typed handler/store-stub coverage. Add one real HTTP/PostgreSQL revoked-token attempt and assert no membership/session plus sanitized audit. |
| 5 | Public register creates no implicit pending membership | `apps/web/src/designSystemShell.test.ts` proves register UI/client removal; `scripts/check_openapi_drift.py` forbids `/auth/register`; no production route/caller was found. | **PARTIAL** | Current proof is static/unit. Add a real router request showing `/api/auth/register` is unavailable and a DB before/after assertion showing no user/membership/invitation mutation. |
| 6 | Multiple roles and capabilities are correct by organization type | `TestPilotReadiness_MembershipRoleUnion`; `TestOrgMemberRolesCapabilities`; `TestInvitationCapabilitiesAllowOnlyManagerRoleSubset`; `UsersScreen.test.tsx` factory/store role tests; membership-sector compatibility migration/race suites. | **PARTIAL** | Role union is real HTTP/PostgreSQL, but exact factory/store manager capability matrices are handler/UI unit tests. Add real HTTP/PostgreSQL factory/store actors for the generated `TeamSummary.capabilities` and allowed/denied commands. |
| 7 | Suspended membership stays visible and loses access immediately | `TestPilotReadiness_MembershipDeactivationCutsAccess`; `TestUpdateMembershipStatus_RevokesCredentialsWhenLeavingActiveState`; `UsersScreen.test.tsx` renders/reactivates suspended membership. | **PASS** | Immediate cut is real HTTP/PostgreSQL and the generated Team model/UI retains suspended memberships. Final Gate A should compose these proofs and consume durable membership-status audit. |
| 8 | Reactivation restores only that organization | `TestPilotReadiness_InvitationAcceptanceHTTP_ReactivatesMembershipInPlace` for both `suspended` and `left`; multi-org membership tests. | **PASS** | Real HTTP/PostgreSQL proves same membership ID, lifecycle metadata cleared, roles replaced and direct session scoped only to the inviting org. |
| 9 | Sales/production managers cannot escalate outside policy | `TestOrgMemberRolesCapabilities`; `UsersScreen.test.tsx` manager control limits; browser `switch.spec.ts` proves a real B seller loses A privileged route. | **PARTIAL** | No real HTTP/PostgreSQL matrix executes both `gerente_ventas` and `gerente_produccion` against allowed and forbidden Team commands/resources. Existing manager proofs use stubbed handlers/UI fetch. |
| 10 | Seat limit blocks activation/acceptance | `TestTeamFoundationMigration_EnforcesCountersSeatsAndRLS`; typed error translation in `TestIdempotencyTranslatesDeferredSeatLimitForPublicCommands` and `TestOrgTeamConstraintErrors`. | **PARTIAL** | Constraint is real PostgreSQL, but no real invitation-accept or reactivation HTTP request reaches the limit and proves `SEAT_LIMIT_REACHED`, zero partial mutation and durable failure evidence. |
| 11 | Offboarding reassigns customers/projects or returns blockers | `TestOffboardMember_ReassignsAllResponsibilitiesAndRevokesCredentials`; `TestOffboardMember_RejectsBlockersAndChangedImpact`; `TestOffboardMember_AuditFailureRollsBackReassignmentsAndStatus`; pilot real-HTTP team flow. | **PASS** | Real PostgreSQL covers reassignments, blockers/stale impact, credential cut, durable audit and injected audit rollback; pilot covers the real router contract. |
| 12 | Session revocation affects only target membership | `TestSessionDirectoryHTTPOrganizationAndMembershipIsolation`; `TestSessionDirectoryHTTPFailureRollback`; `TestMembershipWideSessionRevokeAuditFailureRollsBackEverything`; pilot Team HTTP revoke/replay. | **PASS** | Real HTTP/PostgreSQL covers A/B membership isolation, current access/refresh cut, retry and audit/family rollback. |
| 13 | Concurrent admin degradation/suspension leaves one admin | `TestTeamFoundationMigration_ConcurrentAdminsCannotBothSuspend`; last-admin constraint in `TestTeamFoundationMigration_EnforcesCountersSeatsAndRLS`. | **PASS** | Real concurrent PostgreSQL transactions prove one loser and preservation of an active admin. Gate wrapper must preserve serialized package execution to avoid cluster-role DDL races. |
| 14 | Admin transfer is atomic | `TestTransferOrganizationAdmin_IsAtomicVersionedAndAudited`; `TestTransferOrganizationAdmin_ConcurrentReplayHasSingleWinner`; `TestTransferOrganizationAdmin_AuditFailureRollsBackBothMemberships`; pilot Team HTTP flow. | **PASS** | Real PostgreSQL covers atomic two-membership mutation, concurrency, audit and audit-failure rollback; real router path is exercised. |
| 15 | Stale `If-Match` cannot overwrite roles/status | `TestPilotReadiness_TeamCommandsExecuteThroughRealHTTPAndPostgres`; `TestStaleMembershipWriteReturnsTyped412WithoutOverwrite`; storage version-conflict checks. | **PASS** | Real HTTP/PostgreSQL proves stale sector/team mutation returns `MEMBERSHIP_VERSION_CONFLICT` and failed offboarding remains unchanged. |
| 16 | A→B/B→A list/get/write/delete/upsert through APIs | `TestPilotReadiness_CrossOrgIsolation` in both directions. | **PASS** | Real router/PostgreSQL checks lists, GET, PUT, DELETE, subresource POSTs, settings write and indistinguishable 404s. Upsert defense is additionally covered at SQL/RLS level in scenario 17. |
| 17 | Direct SQL under app role cannot cross tenants without Go filter | `TestTenantRLS_DirectSQLBlocksCrossOrganizationCRUDAndUpsert`; identity/membership and sector direct-SQL RLS tests. | **PASS** | Real `granete_app`, `FORCE RLS`, CRUD/upsert and policy inventory. The browser gate independently asserts the app role is not privileged. |
| 18 | Pool reuse does not leak tenant context | `TestTenantRLS_PoolReuseRollbackRoleAndInventoryReadiness`. | **PASS** | Real PostgreSQL pool reuse/rollback and `SET LOCAL` context proof. Reuse unchanged. |
| 19 | Org-less platform admin cannot access business data | `TestPilotReadiness_PlatformAdminNoBusinessAccess`; tenant RLS shared matrix. | **PASS** | Real HTTP/PostgreSQL and direct RLS paths fail closed for org-less platform authority. |
| 20 | Support session accesses only its organization and preserves real actor | `TestPilotReadiness_SupportSessionScopedAndAudited`; `TestPilotReadiness_SupportSessionExpiry`; support-session epoch/RLS tests; organization suspend/support serialization test. | **PASS** | Real HTTP/PostgreSQL asserts target-org scope, actor/audit, expiry and no unrelated-org access. SEC-7 separately proves step-up for support entry. |
| 21 | Shared-resource policies follow exact matrix | `TestTenantRLS_SharedProjectSupportPlatformAndOwnershipMatrix`; `TestTenantRLS_ArchitectureGuards`. | **PASS** | Real PostgreSQL covers current Gate-A shared Project/support/platform ownership matrix and policy inventory. Gate B relationship resources remain intentionally out of scope. |
| 22 | Fresh provision success yields active/fully ready org | `TestFactoryProvisioningHTTPPostgresRuntimeRoleSuccessRollbackAndReplay`; `TestProvisionOrganizationActivatesOnlyAfterReadiness`; browser fresh bootstrap. | **PASS** | Real HTTP/PostgreSQL asserts active status plus membership/settings/entitlements/catalog materialization. Final wiring must assert the durable start/completed audit from #461. |
| 23 | Failure injected at every provisioning step never leaves active partial org | `TestProvisionOrganizationRollsBackEveryMaterialStepFailure`; real PostgreSQL settings-trigger failure in `TestFactoryProvisioningHTTPPostgresRuntimeRoleSuccessRollbackAndReplay`; provisioning failure audit contract tests. | **PARTIAL** | Every-step matrix uses an application fake; real PostgreSQL injects only `workshop_settings`. Add real DB failure points for entitlements, bootstrap membership, catalog, readiness/activation and required audit, each asserting no active/partial rows and safe retry. |
| 24 | Same idempotency key reuses the same organization | `TestFactoryProvisioningHTTPPostgresRuntimeRoleSuccessRollbackAndReplay`; PostgreSQL idempotency restart tests. | **PASS** | Real HTTP/PostgreSQL returns the byte-identical 201 receipt with `Idempotency-Replayed: true` and one organization. |
| 25 | Same key/different payload conflicts | `TestIdempotencyReplayMismatchRestartAndRetention`; PostgreSQL generic idempotency storage tests. | **PARTIAL** | Durable semantics exist, but the mismatch proof uses the in-memory durable backend rather than real `/api/organizations` + PostgreSQL. Add exact provisioning endpoint proof and assert no second org/receipt mutation. |
| 26 | Concurrent slug collision is deterministic | `TestProvisionOrganizationSameSlugRaceReturnsTypedConflict` only translates a synthetic `23505` to `ORGANIZATION_SLUG_CONFLICT`. | **MISSING** | No concurrent real HTTP/PostgreSQL provisioning test with two different idempotency keys and the same slug. Add one winner, one deterministic typed conflict, one active org, no partial bootstrap rows for the loser. |
| 27 | Suspend/reactivate/offboard/terminate respect sessions/blockers/history | Organization application lifecycle tests; organization lifecycle migration/storage/HTTP tests; support/suspend serialization; `PlatformScreen.test.tsx`. | **PARTIAL** | Individual transitions are well covered, including real PostgreSQL for lifecycle/RLS and a real platform HTTP flow, but there is no single real-HTTP lifecycle sequence asserting all session cuts, blockers, retained history and durable audit for all four commands. UI lifecycle coverage is mocked. |
| 28 | Login/switch A→B never shows or mutates A data | Browser `switch.spec.ts` (late media, privileged route, dirty editor) and `lifecycle.spec.ts`; workspace/query-foundation unit guards. | **PASS** | Real Go/PostgreSQL/Vite/Chromium proves delayed A results, bearer, media and unsaved state cannot cross into B. |
| 29 | Two tabs follow policy without scope mixing | Browser `lifecycle.spec.ts` opaque synchronization and `webauth.spec.ts` concurrent refresh/switch/logout cases. | **PASS** | Real two-page Chromium + server/PostgreSQL; opaque broadcast payload and no credential/business data propagation. |
| 30 | `/org/team` failure never triggers legacy fallback | Browser `lifecycle.spec.ts` test `shows a client-only Team 500 with no legacy fallback and recovers`; `UsersScreen.test.tsx` guard. | **PASS** | Real browser/server page intercept proves Team error UI, recovery and zero `/admin/users` request. |
| 31 | Suspended membership appears in the correct tab | `UsersScreen.test.tsx` renders account vs membership status and opens the suspended-membership section; browser lifecycle test covers a suspended B choice only in the organization selector/recovery flow. | **PARTIAL** | The exact Team-tab assertion is UI-only with mocked fetch. Add real browser + PostgreSQL suspension followed by `/org/team`, verify the member appears only under suspended for the correct org and is absent from the other org. |
| 32 | Platform shows real provisioning state/typed DTO | `PlatformScreen.test.tsx` authoritative readiness/provision/failure cases; `TestPlatformLifecycleHTTPPostgresInheritedRuntimeRole` and generated contract tests. | **PARTIAL** | Typed frontend and real backend are proven separately. No real browser platform-provisioning flow consumes the real Go/PostgreSQL DTO and renders readiness/failure. |
| 33 | Success is not shown before server commit | `UsersScreen.test.tsx` transfer/offboarding tests explicitly await response; `PlatformScreen.test.tsx` provisioning/lifecycle tests; server rollback tests. | **PARTIAL** | UI timing tests use deferred/mocked responses and server rollback is separate. Add a real browser failure/delayed-commit case for at least one critical Team or Organization command, asserting no optimistic success and unchanged DB on audit failure. |
| 34 | Absolute session ≤18h; revocation/MFA paths | `TestWebAccessTokenShortTTLAndAbsoluteCap`; `TestWebRefreshCookieRotationPreservesAbsoluteBound`; refresh/replay/logout/session-directory pilot tests; `mfa_stepup_test.go`; browser `webauth.spec.ts` and `mfa.spec.ts`. | **PASS** | Real HTTP/PostgreSQL proves absolute cap/replay/revocation and real browser proves MFA enrollment + step-up + same-command retry. SEC-8/9 are not required to restate this Gate-A scenario, except any policy explicitly chosen for the final gate. |

## Counts

```text
Existing/PASS: 22/34
Partial:       11/34
Missing:        1/34
```

The 22 PASS rows are reusable evidence, not permission to label Gate A green.
Gate A is currently **not executable as one authoritative job**: the precise
gaps above remain, the #461 durable-audit coverage must be closed, and fresh +
upgrade + browser proofs must be composed under explicit no-skip semantics.

## Minimum gap set derived from the matrix

1. Extend the real PostgreSQL/HTTP Foundation suite for scenarios 4, 5, 6, 9,
   10, 23, 25 and 26; scenario 26 is the only wholly absent behavior.
2. Extend the real browser gate only for scenarios 31–33 (Team suspended tab,
   Platform provisioning typed DTO, and no success before commit). Scenario 27
   may share the same platform lifecycle browser path rather than create a
   second harness.
3. Compose the reusable tests into an identifiable Gate A command/job with:
   split migration/runtime roles, fresh DB, representative upgrade fixtures,
   explicit no-skip enforcement, sanitized diagnostics, `openapi:check` and
   typecheck.
4. Add the #461 durable audit/failure-injection assertions to critical
   provisioning, membership/role/admin/offboarding, lifecycle, session and
   MFA/support/device commands; do not require an async outbox worker for
   audit-only events unless a real external projection is introduced.

## Intentionally deferred

- Gate B and OrganizationRelationship/CatalogPublication/price/order variants.
- Complete #461 timeline, export, SIEM, OpenTelemetry, metrics and enterprise
  alerting.
- SEC-8/SEC-9 behavior not directly consumed by scenario 34.
- Digital Thread #385 and all new persisted business families until Gate A is
  actually green.
