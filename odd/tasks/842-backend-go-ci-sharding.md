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
