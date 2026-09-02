# Foundation Gate A #462 — final coverage matrix

Date: 2026-09-02
Base: `main@02ad7cd05c0690b0632c211a883b7b38e48dcf84`
Authoritative command: `pnpm gate:foundation:a`

Status semantics: **REUSED** means the existing proof was composed unchanged;
**ADDED** means this slice closed the exact gap from
`progress/explore_gate_a_34_scenarios.md`. Every row below passed in the single
Gate A command against required real boundaries.

| # | Scenario | Executable proof | Source | Result |
|---:|---|---|---|---|
| 1 | Platform/bootstrap creates Factory A | provisioning PostgreSQL storage proof + browser gate bootstrap | REUSED | PASS |
| 2 | New-user invitation acceptance enters A | `TestPilotReadiness_InvitationAcceptanceHTTP_NewIdentityReplayIsStable` | REUSED | PASS |
| 3 | Existing user accepts B with isolated memberships | `TestPilotReadiness_InvitationAcceptanceHTTP_ExistingIdentityCreatesOnlyInvitingMembership` | REUSED | PASS |
| 4 | Expired/revoked/rotated/replayed invite fails safely | existing lifecycle tests + `TestPilotReadiness_RevokedInvitationCannotMutateIdentityOrMembership` | ADDED | PASS |
| 5 | Public registration creates no implicit membership | `TestPilotReadiness_RegisterRouteIsUnavailableAndMutationFree` + OpenAPI drift guard | ADDED | PASS |
| 6 | Multi-role capabilities match organization type | `TestPilotReadiness_MembershipRoleUnion` + `TestPilotReadiness_ManagerCapabilitiesUseRealOrganizationPolicy` | ADDED | PASS |
| 7 | Suspended membership remains visible and loses access | `TestPilotReadiness_MembershipDeactivationCutsAccess` + Team/browser proof | REUSED | PASS |
| 8 | Reactivation restores only its organization | `TestPilotReadiness_InvitationAcceptanceHTTP_ReactivatesMembershipInPlace` | REUSED | PASS |
| 9 | Sales/production managers cannot escalate | `TestPilotReadiness_ManagerCapabilitiesUseRealOrganizationPolicy` allowed/denied commands | ADDED | PASS |
| 10 | Seat limit blocks accept/reactivate atomically | `TestPilotReadiness_SeatLimitRollsBackAcceptanceAndReactivation` | ADDED | PASS |
| 11 | Offboarding reassigns or reports blockers | existing offboarding PostgreSQL rollback/race suite + pilot Team HTTP flow | REUSED | PASS |
| 12 | Revocation affects only target membership | existing session-directory HTTP/PostgreSQL isolation and failure suite | REUSED | PASS |
| 13 | Concurrent admin degradation preserves one admin | existing Team migration concurrency proof | REUSED | PASS |
| 14 | Admin transfer is atomic | existing transfer PostgreSQL concurrency/audit rollback + pilot HTTP flow | REUSED | PASS |
| 15 | Stale `If-Match` cannot overwrite state | existing pilot Team HTTP stale-write proof | REUSED | PASS |
| 16 | A↔B API list/get/write/delete/upsert isolation | `TestPilotReadiness_CrossOrgIsolation` | REUSED | PASS |
| 17 | Direct SQL app role cannot cross tenants | existing `TestTenantRLS_*` CRUD/upsert policy suite | REUSED | PASS |
| 18 | Pool reuse cannot leak tenant context | existing `TestTenantRLS_PoolReuseRollbackRoleAndInventoryReadiness` | REUSED | PASS |
| 19 | Org-less platform authority has no business access | `TestPilotReadiness_PlatformAdminNoBusinessAccess` | REUSED | PASS |
| 20 | Support session stays in target org with real actor | existing support HTTP/PostgreSQL/expiry/MFA proofs | REUSED | PASS |
| 21 | Shared-resource RLS follows exact Gate-A matrix | existing `TestTenantRLS_SharedProjectSupportPlatformAndOwnershipMatrix` | REUSED | PASS |
| 22 | Fresh provisioning yields active/ready organization | existing provisioning success + browser real typed DTO | REUSED | PASS |
| 23 | Every material provisioning failure rolls back | `TestGateAProvisioningRealPostgresRollsBackEveryMaterialFailure` (7 DB failure points + retry) | ADDED | PASS |
| 24 | Same idempotency key returns same organization | existing provisioning HTTP/PostgreSQL byte-stable replay | REUSED | PASS |
| 25 | Same key/different payload conflicts | `TestGateAProvisioningSameKeyDifferentPayloadConflictsInPostgres` | ADDED | PASS |
| 26 | Concurrent same-slug collision is deterministic | `TestGateAProvisioningConcurrentSlugCollisionIsDeterministic` | ADDED | PASS |
| 27 | Composed lifecycle preserves sessions/history/audit | `TestPlatformLifecycleHTTPPostgresInheritedRuntimeRole` with four durable audit assertions | ADDED | PASS |
| 28 | A→B switch never displays or mutates A | existing browser `switch.spec.ts` | REUSED | PASS |
| 29 | Two tabs follow policy without scope mixing | existing browser `lifecycle.spec.ts` + `webauth.spec.ts` | REUSED | PASS |
| 30 | Team failure never invokes legacy fallback | existing browser lifecycle recovery proof | REUSED | PASS |
| 31 | Suspended member appears only in correct Team tab | browser `gate-a.spec.ts` real suspend/Team A/B proof | ADDED | PASS |
| 32 | Platform renders real provisioning/readiness DTO | browser `gate-a.spec.ts` real Go/PostgreSQL provisioning | ADDED | PASS |
| 33 | UI cannot report success before server commit | browser `gate-a.spec.ts` delays the real POST and observes commit response | ADDED | PASS |
| 34 | Session ≤18h; revocation and MFA/step-up work | existing pilot session/MFA suite + browser `mfa.spec.ts`/`webauth.spec.ts` | REUSED | PASS |

## Final count

```text
Reused existing proofs: 22/34
Closed exact gaps:      12/34
PASS:                   34/34
PARTIAL:                 0/34
MISSING:                 0/34
```

The gate uses PostgreSQL 16, migrations through the current schema, the upgrade
fixtures, an app role with `NOSUPERUSER`/`NOBYPASSRLS`, real Go HTTP/auth/MFA,
and Chromium. Critical gate output is rejected if it reports a skipped proof.
Gate B is not included.
