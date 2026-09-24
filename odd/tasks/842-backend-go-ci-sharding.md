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

## Next step
Correct the fixture authority boundary and obtain the required green baseline before starting AST discovery.
