# #842 Backend Go CI sharding

## Objective
Reduce the required full Go backend CI critical path to <=6 minutes without removing tests or weakening PostgreSQL, RLS, migration, concurrency, security, or #823 test-database isolation.

## Authority and scope
- Issue: #842, open with `status:approved`; base: `origin/main` at `f02cbac91c1e159c248890a415ab56b2cc04c456`.
- Exclusions: no skips/mocks for real PostgreSQL coverage, no shared mutable shard DB/cluster, no intra-shard Go parallelism, no production behavior changes, no CI-impact optimization.
- Delivery strategy: `ask-on-risk`; forecast exceeds 400 authored changed lines, so PR slicing must be resolved before a >400-line commit.
- TDD: strict, repository instruction. Exact runner is to be confirmed from the #823 runner before implementation; RED/GREEN/REFACTOR evidence is required per behavior.

## Tasks
- [x] T1 — Map the existing Go CI runner, #823 isolation contract, current suites and TOTP helpers; record a current comparable baseline. Route: inline due to unavailable delegation surface; trigger exception: runtime policy prohibits spawning.
- [ ] T2 — Add deterministic AST-based top-level test discovery, deterministic allocation and coverage/negative proofs. Route: delegated writer required by normal policy; blocked by runtime policy unless scope becomes small enough.
- [ ] T3 — Add isolated shard runner and CI jobs/summary instrumentation, retaining fast feedback and full aggregate gate. Route: delegated writer normally required.
- [ ] T4 — Remove only semantically redundant TOTP test waits while preserving real verification/replay proofs. Route: delegated writer normally required.
- [ ] T5 — Run representative configurations and candidate verification; publish exact CI timing evidence. Route: delegated verifier normally required.

## Acceptance
All issue #842 acceptance and negative proofs are mandatory. GitHub Actions timing on the exact candidate is required for a complete delivery.

## Evidence
- Current baseline on the isolated `origin/main` worktree: `scripts/backend-test.sh -v ./...` consumed **11m27.68s** wall-clock. Storage was 398.420s; Pilot Readiness was 245.079s. It was not green: `internal/config` failed because the runner exported the same privileged `postgres` role in both `DATABASE_URL` and `MIGRATION_DATABASE_URL`, violating #823 role separation.
- Corrected the runner to export the real unprivileged `granete_app` runtime URL while preserving the explicit privileged migration URL; `scripts/backend-test.sh -v ./internal/config` passes.
- Preflight at original checkout: `PREFLIGHT_OK_NOT_VERIFIED`; original checkout was dirty only with untracked `.codex/` and `.github/hooks/`, so work is isolated here.
- Issue read live on 2026-09-24; #823 is present in `origin/main` via merge `aec03be9` (#835) and listed hardening commits.

## Authority inventory
Fixtures with direct `DATABASE_URL` reads before this correction: `internal/api/hardware_assets_test.go`; storage `ambient_test.go`, `catalog_f116_test.go`, `hardware_machining_test.go`, `hardware_part_finishes_test.go`, `hardware_preview_test.go`, `idempotency_postgres_test.go`, `machine_output_selections_test.go`, `material_tile_persist_test.go`, `multi_org_migration_test.go`, `structures_108_test.go`, and `tenant_rls_test.go`; and `tests/pilotreadiness/fixture_test.go`. DDL/migration helpers additionally include `connectStore`, `mustPool`, `multiOrgAdminDSN`, `multiOrgFreshDB`, `newRLSFixture`, `hwAssetE2EStore`, and Pilot `buildFixture`.

## Current blocker
The focused API suite is green. Pilot Readiness is now green with a migration pool for setup/migrations and the HTTP server pool sourced from `DATABASE_URL` as `granete_app` (222.975s). The focused RLS direct-SQL proof also passes after `newRLSFixture` migrates/seeds with `MIGRATION_DATABASE_URL` and opens assertions as `granete_app`. with the corrected role split, but storage shows that many test fixtures use `DATABASE_URL` for migrations and CREATE/DROP DATABASE. Under `granete_app` they fail or skip (the first failure is `permission denied for schema public`). This is an existing test-fixture authority bug, not evidence that runtime must regain admin privileges. The next bounded correction is to migrate setup/teardown paths to `MIGRATION_DATABASE_URL`, then open the runtime test pool separately with `DATABASE_URL`; coverage must not remain skipped.

## Hardware-assets fixture evidence (2026-09-24)
- `TestHardwareAssets_HandlerLevelByteWalkthrough` originally created the upload session but read it outside `PostgresStore.WithinTenantTx`. The row existed under admin diagnostic with `organization_id=00000000-0000-0000-0000-000000000001`, `created_by=21000000-0000-0000-0000-0000000000e2`, and `status=prepared`; the read received 404 because `hardware_asset_upload_sessions_read` only permits `organization_id = app_current_organization_id()`.
- Production `AuthMiddleware` revalidates the user/membership/session and opens `WithinTenantTx` with the claims-derived tenant actor. The handler-level fixture now creates real active memberships for the actor and routes each runtime handler call through that same storage boundary under `granete_app`; no RLS policy or product code changed.
- Negative proofs in the walkthrough: valid org-A actor reads its session; the same user with an active org-B membership gets 404; a direct handler request without the tenant transaction gets 404.
- `TestMigrationDatabaseURL` now exposes a fail-closed, migration-authority-only way to retarget setup to a permitted disposable database. Its guard proof confirms it never derives admin authority from `DATABASE_URL`.
- Verification: walkthrough PASS; migration-URL guard PASS; storage Hardware Assets RLS tests passed except `TestHardwareAssets_MigrationFreshAndUpgrade`, which still tries to create its migration ledger with `granete_app` and fails `permission denied for schema public`. This is the next fixture-authority correction, not justification to elevate the runtime role.

## Migration-fixture follow-up (2026-09-24)
- `TestHardwareAssets_MigrationFreshAndUpgrade` was a schema-evolution test but opened its fresh and upgrade databases with `multiOrgFreshDB`, whose pool derives from `DATABASE_URL`; `identityApplyThrough` consequently failed creating `schema_migrations` as `granete_app`.
- Added explicit derivation helpers: `TestDatabaseURLForDB` is runtime-only and `TestMigrationDatabaseURL` is migration-only; both retarget only an allowed disposable database and validate the result. `multiOrgFreshDBWithAuthority` centralizes create/drop plus selected authority, with named runtime (`multiOrgFreshDB`) and migration (`multiOrgFreshMigrationDB`) entry points.
- Hardware Assets migration fresh/upgrade now uses `multiOrgFreshMigrationDB`. Focused guards, the Hardware Assets migration/RLS/tenant group, and handler-level walkthrough pass. No policy or runtime role changed.
- Storage migration/schema audit found the shared `multiOrgFreshDB` family used by both migration-evolution tests (including `identityApplyThrough`) and runtime fixtures (`hwAssetNewStore`, `multiOrg_isolation_test`, and direct `RunMigrations` helpers). The former must migrate to `multiOrgFreshMigrationDB`; the latter must retain a separate runtime pool after admin setup. This classification prevents a blanket admin conversion.

## Migration-suite classification follow-up (2026-09-24)
- Reclassified every direct `identityApplyThrough` caller as migration/schema authority and routed its fresh/upgrade database through `multiOrgFreshMigrationDB` (27 test files). These tests assert schema, ledger, grants, inventory, fresh/upgrade/down evolution; they do not constitute runtime/RLS behavior proof.
- Representative migration tests covering Auth Devices/MFA/Refresh/Sessions, Design Publish/Designs, and tenant-RLS down migration all pass under migration authority.
- An early diagnostic storage run was stopped after it surfaced remaining false-green fixtures: `skipIfNoDB`, `connectStore`, and several direct `RunMigrations` helpers still attempt bootstrap as `granete_app`, yielding `permission denied for schema public` and SKIP/FAIL. This run is not a baseline. Runtime behavior tests using those helpers must migrate with a separate migration pool and then assert with the runtime pool inside tenant transactions.

## Runtime-fixture discovery (2026-09-24)
- Added `TestMigrationDatabaseURLForRuntimeDatabase`, which retains the disposable database selected by `DATABASE_URL` but takes its credentials only from `MIGRATION_DATABASE_URL`; its guard test passes.
- A focused trial confirmed the next distinction: moving only migrations of `skipIfNoDB` to admin exposes a second fixture defect—its subsequent direct writes as `granete_app` use `WithOrgCtx` but omit `WithinTenantTx`, so RLS correctly rejects them. This is not a product/RLS bug and must be fixed by routing each runtime scenario through the production tenant transaction boundary, not by setting session-wide context or using admin.
- `connectStore` callers which explicitly re-run migrations similarly need a separate migration pool for those assertions. The incomplete trial was reverted, so no new skip/failure is committed.

## Runtime-fixture audit (2026-09-24)
- Audited 48 `WithOrgCtx` references across 22 storage test files. They split into: already-explicit positive/negative tenant-boundary proofs; migration/schema metadata; and legacy runtime helpers whose callers mistakenly treated context metadata as PostgreSQL RLS authority.
- `skipIfNoDB` has two Structure Revision callers and four transaction-consistency callers; all are runtime behavior tests, so migration setup and each runtime command need separate boundaries.
- `connectStore` has 20 direct callers across Ambient, Agregados, Agregado Revisions, Engineering Log, Project Item Custom Dims, and Machine Output tests. It is a mixed fixture today: it must no longer migrate through its runtime pool, and each caller must be classified before adding per-command tenant transactions.
- `mustPool` has two F116 callers and follows the same mixed-fixture pattern.
- Direct negative missing-context and cross-tenant RLS tests already use purpose-built `rlsFixture`/tenant-boundary helpers and must remain unwrapped.

## Next step
Refactor the audited runtime-helper groups one at a time: explicit migration setup, runtime pool, legitimate actor/membership, and one `WithinTenantTx` per production-equivalent command. Preserve intentional unscoped negative-RLS tests, then run the grouped focused checks before the full storage suite.

## Group A runtime fixture correction (2026-09-24)
- Migrated the six positive `skipIfNoDB` callers (two Structure Revision and four tenant-transaction consistency tests) to a split fixture: migrations plus identity/bootstrap seed use `TestMigrationDatabaseURLForRuntimeDatabase`, while assertions open a new `DATABASE_URL` runtime store as `granete_app`.
- The fixture uses a real active Initial Organization membership for an explicit actor. Structure catalog commands now run one `WithinTenantTx` per production-equivalent operation rather than keeping an entire test in a single transaction.
- `TestConsistentCatalogTx_SourceView` creates its support table and grant with migration authority; the runtime remains unprivileged and continues to prove its multi-connection consistency behavior.
- Focused verification: `scripts/backend-test.sh -v ./internal/storage -run '^(TestStructureRevisionBumpAndSnapshot|TestStructureRevisionPinRoundTrip|TestConsistentCatalogTx_SourceView|TestConsistentCatalogTx_BorrowedIsolation|TestConsistentCatalogTx_CleanupAndOwnership|TestConsistentCatalogTx_ClosedBorrowedTransaction)$'` — PASS (1.491s), no skips.
- Classification: the initial failures were fixture authority defects (multi-statement parameterized seed and schema creation through `granete_app`), not a runtime/RLS product defect. The runtime has not received migration/admin privileges.

## Group B `connectStore` classification (2026-09-25)
`rg 'connectStore(t)'` identifies 19 call sites in six files; the previously reported total of 20 includes the `connectStore` definition itself. The operational inventory is therefore 17 positive runtime callers plus two migration-additivity callers that must move entirely to migration authority rather than be treated as runtime behavior.

| Family | File | Calls | Organization / actor | Runtime boundary / special intent |
| --- | --- | ---: | --- | --- |
| Ambient catalog | `ambient_test.go` | 3 runtime + 1 migration | `InitialOrganizationID`; active explicit fixture membership | CRUD, nullable persistence, uniqueness; create/read/update/deactivate are separate commands. Migration replay is admin-only. |
| Agregados catalog | `agregados_test.go` | 2 runtime + 1 migration | `InitialOrganizationID`; active explicit fixture membership | CRUD and structure/module composition; separate commands. Migration replay is admin-only. |
| Agregado revisions | `agregado_revisions_test.go` | 8 runtime | `InitialOrganizationID`; active explicit fixture membership | append/history, immutability, legacy compatibility, snapshot persistence and idempotency. One allocation test is concurrent and requires one tenant transaction per racer; dedicated `newRLSFixture` tests in the file are not `connectStore` callers and remain untouched. |
| Project persistence | `engineering_log_test.go`, `project_item_custom_dims_test.go` | 2 runtime | `InitialOrganizationID`; active explicit fixture membership | project engineering log and custom dimensions, with each persisted command/read in its own tenant transaction. |
| Machine output | `machine_output_selections_test.go` | 2 runtime | org A uses an explicit active fixture actor; RLS isolation additionally uses org B / a deliberately unprivileged role | version conflict requests must remain separate; the cross-tenant direct-SQL negative assertion remains separately scoped and must not be wrapped as org A. |

The Group B fixture will keep `connectStore` runtime-only. A separate migration setup helper will run migrations and seed the explicit active test actor before opening the `DATABASE_URL` pool. No caller may use runtime authority for schema, DDL, grants, or administrative seed data.

### Group B family result — Ambient catalog
- Replaced the mixed `connectStore` setup with explicit migration-only setup (`migrationConnectStore`) and runtime-only `connectStore`; `migratedConnectStore` composes them only for runtime families, seeds a real active membership under migration authority, then opens the unprivileged runtime pool.
- Migrated the three runtime tests to one `WithinTenantTx` per create/read/list/update/deactivate request. Cleanup is migration-authority fixture teardown. The duplicate-key assertion returns the expected database error from its own transaction instead of attempting to commit an aborted transaction.
- `TestAmbientMaterials_MigrationIsAdditiveAndReRunSafe` now runs entirely on migration authority; it is not runtime/RLS coverage.
- Verification: `scripts/backend-test.sh -v ./internal/storage -run '^TestAmbientMaterials_'` — PASS (1.357s), FAIL=0, SKIP=0.

### Group B family result — Agregados catalog
- Migrated the two runtime callers to explicit Initial Organization actor transactions for each create/read/list/update/deactivate command; structure and module composition each commit before subsequent reads/updates.
- Moved the additive migration test to `migrationConnectStore`; its setup/replay assertion no longer opens runtime authority.
- Verification: `scripts/backend-test.sh -v ./internal/storage -run '^(TestAgregados_|TestStructureAndModule_AgregadosRoundTrip)$'` — PASS (1.379s), FAIL=0, SKIP=0.

## Revision-family authority classification (2026-09-25)
The remaining revision tests are not a homogeneous runtime group. The table below is the authority contract before further edits; `A+B` means the test has normal runtime commands plus a direct invariant proof, not that either is replaced by the other.

| Test | Category | Setup authority | Assertion authority | Transaction model | Expected rejection layer |
| --- | --- | --- | --- | --- | --- |
| `TestAgregadoRevisions_ImmutabilityGuards` | B | migration fixture, then runtime parent/revision | `granete_app`, scoped direct SQL | one tenant-scoped direct-SQL transaction per invalid UPDATE and DELETE; rollback each | immutable revision trigger, not RLS |
| `TestAgregadoRevisions_LegacyAgregadoCompatibility` | A | migration fixture; legacy parent row is an intentional compatibility fixture | runtime `granete_app` | separate scoped direct insert, reads, append, deactivate, and expected restricted-delete transactions | FK/ON DELETE RESTRICT for the final delete |
| `TestPublishedAssemblySnapshots_FreezeRoundtripAndZeroScaling` | A+B | migration fixture | runtime commands and scoped direct SQL | each parent/revision/current-pointer/snapshot command commits independently; immutable UPDATE/DELETE each rolls back independently | published-snapshot immutable trigger, not RLS |
| `TestPublishedAssemblySnapshots_FailClosedOnCorruptData` | C then A | migration authority for the existing deliberate impossible-state corruption; runtime for normal setup and readback | runtime `granete_app` readback | each normal command has its own tenant transaction; corruption setup is isolated from runtime readback | runtime readback validation, after explicit fixture-only corruption |
| `TestPublishedAssemblySnapshots_R3_DeduplicationPerRecipeRevision` | A | migration fixture | runtime `granete_app` | distinct transactions for parent, R2, R3, each publish/retry, and reads | none; deduplication is scoped to a revision |
| `TestMerivoboxPilotHistoricalPersistence_R5` | A | migration fixture | runtime `granete_app` | distinct transactions for parent, revision, snapshot persistence, and subsequent reads | none |
| `TestAgregadoRevisions_Migration_UpDownReplay` | C | migration authority | migration authority | migration/schema replay only; no runtime assertion | migration DDL/replay errors |

Deliberate cleanup omission: aggregate revisions and published assembly snapshots remain in the throwaway database because their immutable triggers prohibit DELETE. No trigger, constraint, RLS, or replication bypass is added for cleanup.

### Revision Category B result — immutability layers
- Runtime direct `UPDATE` and `DELETE` run in separate legitimate `granete_app` tenant transactions and each return `permission denied for table agregado_revisions` (`SQLSTATE 42501`). This is the production SQL privilege boundary; it is not an RLS/missing-context result.
- Separate migration-authority transactions issue the same mutations and each return `is immutable once written`, proving the active immutable trigger is the structural invariant once SQL permission is available.
- No migration, RLS policy, trigger, or runtime grant changed. Focused verification: `scripts/backend-test.sh -v ./internal/storage -run '^TestAgregadoRevisions_ImmutabilityGuards$'` — PASS (1.485s), SKIP=0.

### Revision Category A progress — legacy compatibility
- The legacy parent fixture omits `current_revision_id`, a historical shape normal commands no longer create; it is seeded with migration authority only.
- Runtime `granete_app` then reads the legacy row, appends a revision, deactivates it, reads its history, and attempts the expected restricted physical delete in separate tenant transactions.
- Verification: `scripts/backend-test.sh -v ./internal/storage -run '^TestAgregadoRevisions_LegacyAgregadoCompatibility$'` — PASS (1.370s), SKIP=0.

### Revision Category A progress — R3 deduplication
- R3 uses no historical/admin fixture: parent creation, R2/R3 revision appends, each snapshot publish, retry publish, and independent readbacks all run as separate `granete_app` tenant transactions.
- The retry is idempotent (returns the existing R3 snapshot) while R2 and R3 retain distinct snapshot identities by recipe revision.
- Verification: `scripts/backend-test.sh -v ./internal/storage -run '^TestPublishedAssemblySnapshots_R3_DeduplicationPerRecipeRevision$'` — PASS (1.405s), SKIP=0.

### R5 Merivobox classification
- **Fixture authority:** none beyond the existing migration bootstrap; the parent, R1/R2 recipes, current-pointer changes, resolution, freeze, and persistence are all currently producible runtime operations.
- **Runtime authority:** `DATABASE_URL` as `granete_app`, explicit Initial Organization actor, one tenant transaction per parent creation, revision append, current-pointer update, snapshot persistence, and readback.
- **Properties:** R1/R2 sequence and identity; current revision points to R2; frozen R1 snapshot retains its revision ID/number, payload hash, selected 500mm variant, Merivobox visual revision pins, fabricated bottom/back dimensions, and kit BOM through R2/current-pointer evolution.
- **Cleanup:** deliberately omitted: revisions and snapshots are immutable and database teardown is authoritative.

### Revision Category A result — R5 Merivobox
- R5 has no historical fixture: parent, R1/R2 revisions, current-pointer updates, freeze/publish, and reads are runtime-producible and use distinct `granete_app` tenant transactions.
- It preserves R1/R2 identity and sequence, R2 current pointer, R1 snapshot identity/hash, selected 500mm variant, Merivobox visual pins, fabricated board dimensions, and kit BOM after later revision evolution.
- Focused R5: `scripts/backend-test.sh -v ./internal/storage -run '^TestMerivoboxPilotHistoricalPersistence_R5$'` — PASS (1.456s), SKIP=0.
- Category A regression (Legacy, R3, R5): PASS, FAIL=0, SKIP=0 (1.370s).

### Revision A+B result — snapshot freeze/roundtrip
- Runtime `granete_app` tenant commands independently create the parent and R1, set current, persist/freeze S1, retry its idempotent save, append R2, set current to R2, and read S1 after those commits.
- Frozen readback checks snapshot identity and revision number, selected 500mm variant, rigid-member visual pins, and preserved R1 payload after R2/current-pointer evolution.
- Direct runtime snapshot UPDATE/DELETE each fail at the SQL privilege boundary (`permission denied for table published_assembly_snapshots`); separate migration-authority transactions reach the active immutable trigger (`is immutable once written`). The later runtime readback remains unchanged.
- Focused verification: `scripts/backend-test.sh -v ./internal/storage -run '^TestPublishedAssemblySnapshots_FreezeRoundtripAndZeroScaling$'` — PASS (1.671s), SKIP=0.

### Revision Category C result
- **C1 corruption:** `published_assembly_snapshots.snapshot.resolvedDimensionsMm[0]` changes from a valid 600 to `-999`. Runtime cannot create it because frozen snapshot DML is privilege- and trigger-protected. Migration authority temporarily disables only `protect_published_assembly_snapshots_immutable` to create this impossible historical fixture, immediately restores it, and never serves the runtime assertion from its pool. Runtime `granete_app` readback in a new tenant transaction returns the existing typed `readback validation failed` result. Focused PASS (1.462s), SKIP=0.
- **C2 replay:** `TestAgregadoRevisions_Migration_UpDownReplay` now uses `multiOrgFreshMigrationDB` for apply/down/replay and schema assertions. Focused PASS (1.567s), SKIP=0.
- Complete revisions regression (`TestAgregadoRevisions_*`, `TestPublishedAssemblySnapshots_*`, `TestMerivoboxPilotHistoricalPersistence_R5`, and design-revision snapshot pinning): PASS, FAIL=0, SKIP=0 (2.312s). The concurrent allocation test retains eight independently scoped racers.

## Project persistence `connectStore` inventory (2026-09-25)
| Test | `connectStore` role | Intent | Current authority | Required authority/boundaries | Special case |
| --- | --- | --- | --- | --- | --- |
| `TestProject_EngineeringLogRoundTrip` | runtime positive | customer → project create/read → engineering-log update/read → clear/read | runtime pool but `WithOrgCtx` only | migration bootstrap plus explicit active fixture actor; separate tenant transactions for customer/create/read/update/read/clear/read | no migration/schema, cross-tenant, or concurrency branch |
| `TestProjectItem_CustomDimsRoundTrip` | runtime positive | customer/module/project-item custom dimensions create/read/update/read/clear/read | runtime pool but `WithOrgCtx` only | migration bootstrap plus explicit active fixture actor; separate tenant transactions for customer/module/project create/read/update/read/clear/read | no migration/schema, cross-tenant, or concurrency branch |

Both project callers are runtime-positive (2/2); neither is a migration/schema test nor an intentional negative/cross-tenant test. The remaining direct runtime callers after Projects are the two Machine Output tests. `rg 'connectStore(t)'` currently also finds the internal `migratedConnectStore → connectStore` runtime-pool construction, which is not an independent test caller.

### Project persistence result
- Both callers now use migration-only bootstrap through `migratedConnectStore`, then `DATABASE_URL` as `granete_app` with the explicit active Initial Organization actor. Every runtime command and observation runs in its own `WithinTenantTx`; neither test uses migration/admin authority for a runtime assertion.
- `TestProject_EngineeringLogRoundTrip`: PASS, SKIP=0 (test 1.12s; focused runner wall 1.701s).
- `TestProjectItem_CustomDimsRoundTrip`: PASS, SKIP=0 (test 1.00s; focused runner wall 1.512s).
- Combined Project regression: `scripts/backend-test.sh -v ./internal/storage -run '^(TestProject_EngineeringLogRoundTrip|TestProjectItem_CustomDimsRoundTrip)$'` — PASS, FAIL=0, SKIP=0 (runner wall 1.608s; tests 1.11s and 0.05s).
- Inventory after Projects: 2/2 Project runtime callers migrated. Two Machine Output runtime callers remain; the helper-internal `migratedConnectStore → connectStore` construction is excluded from the test-caller count.

## Machine Output `connectStore` inventory (2026-09-25, pre-migration)
| Test | Behavior protected | Current `connectStore` / authority | Classification | Current transaction model | Required model |
| --- | --- | --- | --- | --- | --- |
| `TestMachineOutputSelections_VersionConflictAndList` | Persist cutting selection; retain profile digest; move version 1→2; reject stale expected version; list exactly the current selection. | Direct runtime pool, `WithOrgCtx` only; destructive cleanup under that pool. No schema assertion. Static machine/profile/adapter tuple is a product selection fixture, not administrative catalog creation. | Positive runtime plus typed expected version-conflict error. No cross-tenant, migration/schema, or concurrency. | All writes, expected conflict, and list share one non-tenant transaction context. | Migration-only bootstrap + explicit active actor; independent `WithinTenantTx` for initial save, update, expected conflict/rollback, and list/read. |
| `TestMachineOutputSelections_RLSTenantIsolation` | Org A selection is invisible to org B; cross-org INSERT is rejected by RLS `WITH CHECK`. | Direct runtime pool, `WithOrgCtx` only for org A; admin connection creates organization B and a deliberately unprivileged `granete_app`-member role; separate direct role connection sets only org-B configuration. | Runtime positive seed plus cross-tenant direct-SQL negative assertion; no migration/schema or concurrency. The temporary role/organization are structural test fixtures, not runtime assertions. | Org-A save is outside `WithinTenantTx`; org-B direct SQL uses one manually scoped transaction containing SELECT plus failed INSERT. | Migration-only bootstrap seeds both explicit active actors/memberships and any temporary role; org-A save uses its own `WithinTenantTx`; org-B visibility and failed cross-org INSERT each use distinct runtime tenant transactions under its own actor/connection; postconditions run in new transactions. |

Machine Output had two direct `connectStore` test callers before this migration. The profile and adapter values are persisted selection tuple fields (including profile digest) rather than catalogue provisioning in these tests; they must remain in runtime save/read assertions. The temporary RLS role was replaced during implementation with explicit migration-seeded runtime actors.

### Machine Output result
- `TestMachineOutputSelections_VersionConflictAndList` uses migration bootstrap then the explicit active Initial Organization actor under `granete_app`. Initial save, v1→v2 update, stale-version rollback, and list/readback use separate tenant transactions. The persisted profile digest remains asserted. Focused: PASS, SKIP=0 (test 0.72s; runner wall 1.179s).
- `TestMachineOutputSelections_RLSTenantIsolation` seeds isolated organizations A and B plus their active users/memberships only with migration authority. Org A’s product save and org B’s independent runtime list use separate `WithinTenantTx` calls. The cross-org INSERT uses a separate legitimate `granete_app` direct-SQL tenant transaction and rolls back on the RLS `WITH CHECK` rejection (`SQLSTATE 42501`); a later org-B runtime read remains empty. No admin role or admin runtime assertion remains. Focused: PASS, SKIP=0 (test 0.77s; runner wall 1.182s).
- Machine Output combined: PASS, FAIL=0, SKIP=0 (runner wall 1.315s; tests 0.73s and 0.03s).
- The first combined run exposed shared disposable-database state between the two tests, which could have made a duplicate-key error mask the intended RLS rejection. The RLS fixture now owns isolated migration-seeded organizations A/B, so its direct cross-tenant INSERT has no competing primary key. No false green remains.

## Group B final `connectStore` inventory (2026-09-25)
- Direct textual `connectStore(t)` occurrences: exactly one, the internal `migratedConnectStore → connectStore` runtime-pool construction in `ambient_test.go`; no independent test directly calls `connectStore`.
- Runtime callers migrated: Ambient 3; Aggregates 2; Revisions 8; Projects 2; Machine Output 2; other Group B families 0 — **17 total**. Each has migration-only bootstrap and `granete_app` tenant runtime behavior.
- Migration-only callers: Ambient additive replay 1; Aggregates additive replay 1; Revisions Up/Down replay 1 — **3 total**. They perform schema/replay assertions only.
- Therefore all real Group B test callers are classified as migration-only or runtime, and remaining unmigrated runtime callers = **0**.
- Complete Group B regression (Ambient, Aggregates, Revisions, Projects, Machine Output): 25 tests, PASS, FAIL=0, SKIP=0; Go runner 6.954s, observed command wall-clock 11.0s.

## Group B count reconciliation (2026-09-25)
The final count of **17 runtime + 3 migration-only** is correct. The earlier expected `17 + 2` omitted the already-scoped revision replay test.

- Runtime callers (17): Ambient — `TestAmbientMaterials_CRUDRoundTrip`, `TestAmbientMaterials_NullablePBR_NullVsZero`, `TestAmbientMaterials_UniqueCodeConstraint` (`ambient_test.go`); Aggregates — `TestAgregados_CRUDRoundTrip`, `TestStructureAndModule_AgregadosRoundTrip` (`agregados_test.go`); Revisions — `TestAgregadoRevisions_AppendOnlySequenceAndHistoricalRetrieval`, `TestAgregadoRevisions_ImmutabilityGuards`, `TestAgregadoRevisions_ConcurrentAllocationAndUniqueness`, `TestAgregadoRevisions_TenantIsolationRLS`, `TestAgregadoRevisions_LegacyAgregadoCompatibility`, `TestPublishedAssemblySnapshots_FreezeRoundtripAndZeroScaling`, `TestPublishedAssemblySnapshots_R3_DeduplicationPerRecipeRevision`, `TestMerivoboxPilotHistoricalPersistence_R5` (`agregado_revisions_test.go`); Projects — `TestProject_EngineeringLogRoundTrip`, `TestProjectItem_CustomDimsRoundTrip`; Machine Output — `TestMachineOutputSelections_VersionConflictAndList`, `TestMachineOutputSelections_RLSTenantIsolation`.
- Migration-only callers (3): `TestAmbientMaterials_MigrationIsAdditiveAndReRunSafe` (`ambient_test.go`), `TestAgregados_MigrationIsAdditiveAndReRunSafe` (`agregados_test.go`), and the omitted third: `TestAgregadoRevisions_Migration_UpDownReplay` (`agregado_revisions_test.go`). The third applies/down-replays migrations and asserts schema behavior; it has no product/runtime assertion, so it correctly remains migration-only.
- `connectStore` and `migratedConnectStore` are helper definitions. The sole textual `connectStore(t)` is the internal return in `migratedConnectStore`, not an independent test caller.

## Group C `mustPool` inventory (2026-09-25, pre-migration)
| Test | File | Property | Current authority | Correct authority | Classification / boundaries |
| --- | --- | --- | --- | --- | --- |
| `TestEdgeBand_FractionalThicknessRoundTrip` | `backend-go/internal/storage/catalog_f116_test.go` | Tenant-owned EdgeBand fractional thickness values (0, 0.5, 0.8, 2) persist and read back exactly. | `mustPool` opens `DATABASE_URL`, then runs migrations on that runtime pool; commands use `WithOrgCtx` only. | Migration authority for migrations and active fixture actor; `granete_app` + explicit actor + `WithinTenantTx` for each create/read. | Positive runtime; RLS yes; no cross-tenant, concurrency, schema assertion, or expected DB error. |
| `TestAgregado_HardDeleteWithUseGuard` | `backend-go/internal/storage/catalog_f116_test.go` | Tenant-owned agregado cannot be deleted while referenced by a module JSONB payload; after removing the reference it hard-deletes and is absent. | `mustPool` opens `DATABASE_URL`, runs migrations there, uses `WithOrgCtx` only, and issues direct module SQL plus cleanup on runtime pool. | Migration authority for migrations and fixture identity only; `granete_app` + explicit actor + independent tenant transactions for create, direct module fixture SQL, expected in-use delete/rollback, reference removal, successful delete, and absent readback. | Positive plus expected domain error; RLS yes; no cross-tenant, concurrency, or migration/schema assertion. Direct SQL is runtime fixture setup, not a trigger/schema proof. |

`mustPool` is a helper, not a caller. Both callers are runtime/product tests, so neither may use migration authority for their assertions. The first test's table is RLS-scoped (`organization_id`); the second includes direct runtime SQL and an expected error that must return from its own transaction.

### Group C result
- Removed the `mustPool` helper: migration execution no longer occurs through `DATABASE_URL` / `granete_app`.
- `TestEdgeBand_FractionalThicknessRoundTrip` now uses migration bootstrap plus the explicit active runtime actor, with a separate `WithinTenantTx` for each create and read. Focused: PASS, SKIP=0 (test 0.83s; runner wall 1.294s).
- `TestAgregado_HardDeleteWithUseGuard` now uses migration bootstrap plus runtime tenant transactions for aggregate creation, module fixture creation, in-use delete error, module removal, hard delete, and absence readback. Focused: PASS, SKIP=0 (test 0.81s; runner wall 1.244s).
- Group C combined: 2 tests, PASS, FAIL=0, SKIP=0 (tests 0.82s and 0.04s; runner wall 1.286s).
- The old tests returned `PASS` with both tests skipped after runtime migration failed with `SQLSTATE 42501`; this was an accidental fixture/database skip, now eliminated.

### Full `internal/storage` diagnostic after Group C (2026-09-25)
- Exact code candidate: `72f0cabf7742148084255be87dc6042b198fbd4e` (`fix(testdb): scope catalog integration fixtures`). The full command was `scripts/backend-test.sh -v ./internal/storage`; it is **not** a valid benchmark baseline because it finished red.
- Result: Go package duration `402.761s` (observed wall-clock about `6m43s`); `424 PASS`, `84 FAIL`, `1 SKIP` — `509` top-level test outcomes. The sole skip is `TestMaterialBoard_PersistsTextureTileMm`, which explicitly reports `no materials`; it is a fixture-data skip, not a Group C pass.
- **76 failures — authority-fixture defect:** tests attempt migration/schema setup with runtime `granete_app` and fail first with `permission denied for schema public` (`SQLSTATE 42501`). No product assertion is reached. These require their own authority-fixture migration scope and are outside the two authorized `mustPool` callers.
- **4 failures — missing test-role credentials/role:** `TestAgregadoFamily_TenantBoundary_F1E_PooledConnectionReuse`, `TestCreateInitialDesignQuoteRevision_RejectsTerminalStatusCommittedWhileWaitingForLock`, `TestCreateInitialDesignQuoteRevision_RemoveWinsWhileQuoteWaitsForInstanceLock`, and `TestSupportSessionStartAndOrganizationSuspendSerializeOnOrganizationLock` fail connecting as `granete_app_test` with password authentication (`SQLSTATE 28P01`).
- **2 failures — newly exposed false-green authority family; stop point:** `TestHardware_PersistsPartFinishes` and `TestHardware_PersistsPreviewGeometry` create fixtures under `WithOrgCtx` only and fail RLS `WITH CHECK` on `hardwares` (`SQLSTATE 42501`). They need the same explicit actor/`WithinTenantTx` runtime fixture treatment, but were not migrated because the approved Group C scope was exhausted.
- **2 failures — role expectation/setup mismatch:** `TestIdentityLifecycleRLS_RuntimeRoleHasNoBypassOwnershipOrExcessGrants` observes that `current_user=granete_app` is a member of the expected `granete_app_test` role; `TestTenantRLS_PoolReuseRollbackRoleAndInventoryReadiness` reports `role granete_app_test does not exist` (`SQLSTATE 42704`). These are test-role environment/setup defects, not product assertions.
- Reconciliation: Group B remains closed at 17 runtime / 3 migration-only, Group C has 2/2 authorized callers migrated, and `mustPool` no longer appears in storage tests. Per approved boundary, no additional authority-family test was changed after this red diagnostic.

## D1 progress — migration-only multi-org root (2026-09-25)
- Root: nine migration/schema tests incorrectly selected `multiOrgFreshDB`, which intentionally opens `DATABASE_URL` as `granete_app`; their direct DDL/migration assertions are migration-only, not runtime product behavior.
- Corrected callers: four multi-org replay tests in `multi_org_migration_test.go`, four reconciliation replay tests in `drift_reconciliation_migration_test.go`, and `TestMigrations_NoBusinessData` now use `multiOrgFreshMigrationDB`. That helper preserves the identical disposable database name while taking credentials only from `MIGRATION_DATABASE_URL`.
- Focused verification: `scripts/backend-test.sh -v ./internal/storage -run '^(TestMultiOrg_(BackfillFromLegacySchema|PerOrgCodesAndSettings|DownMigrationsRollBack|FreshDatabaseGetsInitialOrg)|Test(SecurityAuditInsertPolicyReconciliation|DigitalThreadDriftReconciliation|DesignPairingGrantDriftReconciliation|IdentityRegistryDriftReconciliation)|TestMigrations_NoBusinessData)$'` — PASS, FAIL=0, SKIP=0 (Go 8.580s).
- Migration-authority failures remaining from the initial diagnostic: `76 → 67` pending the next causal families. No runtime assertion was moved to migration authority.

## D3 result — Hardware persistence false greens (2026-09-25)
- `TestHardware_PersistsPartFinishes` and `TestHardware_PersistsPreviewGeometry` no longer rely on `WithOrgCtx` alone. Each uses migration-only bootstrap, the explicit active runtime actor, and separate `WithinTenantTx` calls for every create, read, and update.
- Cleanup is migration-authority fixture teardown; runtime readback remains `granete_app`. Existing nullable-preview, zero-metalness, part-finish, ownership, and persistence assertions remain intact.
- Focused verification: `scripts/backend-test.sh -v ./internal/storage -run '^(TestHardware_PersistsPartFinishes|TestHardware_PersistsPreviewGeometry)$'` — PASS, FAIL=0, SKIP=0 (Go 1.393s).

## D2/D4 result — legacy runtime role and role assertions (2026-09-25)
- Full reference audit found `granete_app_test` only as the legacy RLS test-role constant, explicit per-test DSN overrides/password, and explanatory comments. It was not a production authority.
- The canonical runtime DSN already authenticates as `granete_app`; the test-only override to `granete_app_test` plus `rls-test-password` was obsolete. RLS fixture and named-pool assertions now use that canonical runtime DSN without credential mutation.
- The expected-role checks now prove `current_user=granete_app`, including the no-bypass/no-ownership assertion. No production role, credential, grant, RLS policy, trigger, or constraint changed.
- Focused verification: `scripts/backend-test.sh -v ./internal/storage -run '^(TestAgregadoFamily_TenantBoundary_F1E_PooledConnectionReuse|TestCreateInitialDesignQuoteRevision_(RejectsTerminalStatusCommittedWhileWaitingForLock|RemoveWinsWhileQuoteWaitsForInstanceLock)|TestSupportSessionStartAndOrganizationSuspendSerializeOnOrganizationLock|TestIdentityLifecycleRLS_RuntimeRoleHasNoBypassOwnershipOrExcessGrants|TestTenantRLS_PoolReuseRollbackRoleAndInventoryReadiness)$'` — PASS, FAIL=0, SKIP=0 (Go 6.778s).

## D5 result — MaterialBoard fixture skip (2026-09-25)
- `TestMaterialBoard_PersistsTextureTileMm` was an accidental fixture skip: it read whichever runtime database happened to exist and skipped when no catalog board was present. It was not environment-dependent behavior.
- The test now creates its own minimal board through `granete_app` in a tenant transaction after migration-only bootstrap, then updates and reads it in independent tenant transactions. Fixture deletion is migration-authority teardown.
- Focused verification: `scripts/backend-test.sh -v ./internal/storage -run '^TestMaterialBoard_PersistsTextureTileMm$'` — PASS, FAIL=0, SKIP=0 (Go 1.382s).

## D1/D3 progress — Hardware machining fixture (2026-09-25)
- `TestHardware_PersistsMachiningProfile` was another direct runtime-migration caller. It now follows the same migration-only bootstrap plus explicit `granete_app` actor/`WithinTenantTx` model as the other hardware persistence tests.
- Focused verification: `scripts/backend-test.sh -v ./internal/storage -run '^TestHardware_PersistsMachiningProfile$'` — PASS, FAIL=0, SKIP=0 (Go 1.386s).
- Migration-authority failures remaining from the initial diagnostic: `67 → 66`.

## D1 progress — Idempotency authority fixtures (2026-09-25)
- Root: the four PostgreSQL idempotency integration tests opened `DATABASE_URL` and ran migrations with the unprivileged `granete_app` runtime role. Two organization-provisioning fixtures also reached RLS without a legitimate platform actor; this was a fixture-authority defect, not a product authorization defect.
- Corrected model: migrations and the disposable platform-admin fixture user use `MIGRATION_DATABASE_URL`. Every idempotency command, concurrent replica request, direct runtime read, and observable assertion uses `DATABASE_URL` as `granete_app` inside an independent tenant transaction for the explicit platform actor. Fixture teardown uses migration authority only.
- Preserved behavior: restart/replay, fingerprint conflict, multi-replica serialization, crash rollback, client-error rollback/replay, server-error atomicity, audit redaction, and sealed receipt body remain asserted. The server-error postcondition reads through a newly scoped runtime transaction rather than an unscoped pool connection.
- Focused verification: `scripts/backend-test.sh -v ./internal/storage -run '^TestPostgres(IdempotencyRestartMultiReplicaCrashAndRetention|IdempotencyClientErrorRollsBackMutationAndReplaysAfterSQLError|IdempotencyServerErrorRollsBackFactoryOrganizationProvisioning|SensitiveIdempotencyReceiptStoresOnlySealedBody)$'` — PASS, FAIL=0, SKIP=0 (Go 1.549s; wall 8.5s).
- Migration-authority failures remaining from the initial diagnostic: `66 → 62`.

## D1 progress — multi-org isolation runtime slice (2026-09-25)
- Root: the first seven direct callers in `multi_org_isolation_test.go` used the runtime-only `multiOrgFreshDB` pool for migrations and then treated `WithOrgCtx` as a PostgreSQL authority boundary. The new `runtimeIsolationSetup` is intentionally separate from the legacy `isolationSetup` callers so no remaining family is silently converted to migration authority.
- Migration authority creates the disposable schema and fixture-only organizations, memberships, catalog rows, and the platform actor. Every product observation runs through a fresh `granete_app` `WithinTenantTx` with an active actor; the one direct SQL postcondition runs through a separately scoped runtime transaction.
- `TestUpdateOrganization_ScanMatchesColumns` now follows the canonical runtime route: current-version read, `UpdateOrganizationVersion` with that expected version, then independent readback. `000100_organization_lifecycle_foundations` requires platform actor, no organization GUC, and a non-null expected version for runtime metadata updates; `internal/api/platform.go` uses this same method. The legacy `UpdateOrganization` has no product runtime caller: its only non-test callers are `cmd/admin`, which explicitly opens `MIGRATION_DATABASE_URL`.
- Focused verification: `scripts/backend-test.sh -v ./internal/storage -run '^(TestIsolation_(Customers|Projects|CatalogBoards|WorkshopSettings|UserDirectoryByOrganization)|TestConnectedOrganizations_ParentAndListing|TestUpdateOrganization_ScanMatchesColumns)$'` — 7 PASS, FAIL=0, SKIP=0 (Go 6.880s).
- Migration-authority failures remaining from the initial diagnostic: `62 → 55` for this seven-test slice. No production code, policy, RLS rule, trigger, constraint, or grant changed.

## D1 progress — tenant-scoped parameter definitions (2026-09-25)
- `TestGetFullCatalogParameterDefinitionsStayTenantScoped` is runtime isolation coverage, not a migration/schema replay: each tenant creates its valid module/parameter definition through `granete_app` with its active actor in a separate `WithinTenantTx`, then obtains its catalog through a later independent tenant transaction.
- Reused the already-committed seven-test `runtimeIsolationSetup` without changing it: migrations and only structural identity/catalog fixtures remain under `MIGRATION_DATABASE_URL`; no admin authority is used for module creation or catalog assertions.
- Focused verification: `scripts/backend-test.sh -v ./internal/storage -run '^TestGetFullCatalogParameterDefinitionsStayTenantScoped$'` — PASS, FAIL=0, SKIP=0 (Go 1.426s).
- Migration-authority failures remaining from the initial diagnostic: `55 → 54`. No production code, policy, RLS rule, trigger, constraint, or grant changed.

## D1 progress — seed composition authority split (2026-09-25)
- Classification: the three SeedUpgrade tests are structural seed/upgrade proofs: migrations, deliberate partial/custom catalog shapes, SeedCatalog replay, and exact code/id/composition SQL assertions all use migration authority. `TestSeedDemoProjectResolvesRealBom` additionally protects observable runtime behavior, so its seed composition/schema check remains migration-authority while its seeded-project read and catalog read run as `granete_app` with an active actor in separate `WithinTenantTx` calls before the pure engine BOM assertion.
- Focused verification: `scripts/backend-test.sh -v ./internal/storage -run '^(TestSeedDemoProjectResolvesRealBom|TestSeedUpgradeConvertsFlatGab|TestSeedUpgradeResolvesExistingCodesWithDifferentIDs|TestSeedUpgradeDoesNotOverwriteCustomGabComposition)$'` — 4 PASS, FAIL=0, SKIP=0 (Go 4.399s).
- Migration-authority failures remaining from the initial diagnostic: `54 → 50`. No production code, policy, RLS rule, trigger, constraint, or grant changed.

## D1 progress — clean-demo administration fixture (2026-09-25)
- Classification: `TestCleanDemoData` proves the administrative clean-demo/seed reconciliation workflow. Its migrations, seed/re-seed, deliberate referenced-data fixture, direct SQL counts, and `CleanDemoData` deletes are all structural/admin behavior. Production invokes this only through `cmd/admin`'s explicit `MIGRATION_DATABASE_URL`, so it has no runtime `granete_app` command/assertion to preserve.
- Focused verification: `scripts/backend-test.sh -v ./internal/storage -run '^TestCleanDemoData$'` — PASS, FAIL=0, SKIP=0 (Go 1.828s).
- Migration-authority failures remaining from the initial diagnostic: `50 → 49`. No production code, policy, RLS rule, trigger, constraint, or grant changed.

## D1 progress — catalog clone runtime boundary (2026-09-25)
- Classification: the source/destination catalog shapes and raw FK/JSONB mapping checks are structural fixtures under migration authority. Both `CloneCatalog` operations (successful clone, non-empty-destination rejection, and unresolvable-binding rollback) now run under `DATABASE_URL` as `granete_app` in their own `WithinTenantTx` with an explicit platform actor authorized for both organizations. Source and destination `GetFullCatalog` readbacks are separate runtime tenant transactions with valid memberships.
- Focused verification: `scripts/backend-test.sh -v ./internal/storage -run '^(TestCloneCatalog_RemapsFKsAndJSONB|TestCloneCatalog_RollsBackWhenParameterBindingTargetCannotBeRemapped)$'` — 2 PASS, FAIL=0, SKIP=0 (Go 2.446s).
- Migration-authority failures remaining from the initial diagnostic: `49 → 47`. No production code, policy, RLS rule, trigger, constraint, or grant changed.

## D1 progress — hardware line quantity authority split (2026-09-25)
- Classification: migration replay, the `hardware_lines.quantity` information-schema type assertion, and `SeedCatalog` are structural migration-authority work. The fractional `CreateModule` command and independent catalog reads are runtime behavior.
- Corrected model: the disposable schema, seed catalog, and active fixture actor are prepared with `MIGRATION_DATABASE_URL`; the seeded catalog lookup, module creation, and post-commit catalog readback each use `DATABASE_URL` as `granete_app` in an independent `WithinTenantTx` for that actor.
- Focused verification: `scripts/backend-test.sh -v ./internal/storage -run '^TestHardwareLineQuantityDoublePrecision$'` — PASS, FAIL=0, SKIP=0 (Go 1.05s; runner wall 5.4s).
- Migration-authority failures remaining from the initial diagnostic: `47 → 46`. No production code, policy, RLS rule, trigger, constraint, or grant changed.

## D1 progress — TransferOrganizationAdmin authority split (2026-09-25)
- Classification: migrations, disposable organization/users/memberships, and the temporary audit-rejection trigger are structural fixtures under `MIGRATION_DATABASE_URL`. The transfer commands (including concurrent replay and expected audit failure) execute through `DATABASE_URL` as `granete_app`; each command opens its production `WithinTenantTx` with the legitimate admin actor. Post-commit state/audit readbacks use separate runtime tenant transactions.
- The new transfer-only fixture is deliberately separate from legacy `isolationSetup`, which still has unrelated callers. Atomic transfer, version conflicts, single concurrency winner, audit insertion, and audit-failure rollback assertions are unchanged.
- Focused verification: `scripts/backend-test.sh -v ./internal/storage -run '^TestTransferOrganizationAdmin_(IsAtomicVersionedAndAudited|ConcurrentReplayHasSingleWinner|AuditFailureRollsBackBothMemberships)$'` — 3 PASS, FAIL=0, SKIP=0 (Go 3.157s; runner wall 8.3s).
- Migration-authority failures remaining from the initial diagnostic: `46 → 43`. No production code, policy, RLS rule, trigger, constraint, or grant changed.
