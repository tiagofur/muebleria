# Operations, security and performance source audit

Baseline: `316df57c7c3c9d5470b5a3f22b39fffeacfd7676`

Read-only source snapshot inspection. No install, DB connection, production connection, runtime incident simulation, dependency vulnerability scan or product modification.

## Evidence and findings

### OPS-01 — Production frontend build toolchain drifts from CI (P1; STATIC_CONFIRMED)

Dockerfile.web uses Node20 and prepares pnpm10.29; packageManager selects pnpm11.1.2; CI explicitly uses Node22 and records pnpm11 requires Node>=22.13. No Docker build gate exists in the inspected CI file.

Impact: A green host build/CI does not prove documented production container can rebuild.

Evidence: `Dockerfile.web:2-17`; `package.json:6-9`; `.github/workflows/ci.yml:62-81`

NEEDS VERIFICATION: clean Docker build with exact lockfile; no build/install performed here. Do not assert observed Docker failure.

### OPS-02 — Restore swallows pg_restore failure and health timeout (P1; STATIC_CONFIRMED)

restore.sh converts any failing restore pipeline into a warning, then prints restored; subsequent healthcheck timeout breaks rather than exits. Table count is printed without expected integrity threshold.

Impact: Operator can receive positive recovery messages after incomplete restore. Health/table existence cannot prove data completeness.

Evidence: `scripts/restore.sh:133-141`; `scripts/restore.sh:180-203`

NEEDS VERIFICATION: isolated failing-restore fixture and actual recovery drill; script NOT executed (destructive).

### OPS-03 — Full backup may omit missing media and still announce completion (P1; STATIC_CONFIRMED)

Missing media volume sets DO_MEDIA=false with a warning; summary still prints Backup complete and expected media filename. Local backup offsite transfer is only an echoed suggestion.

Impact: A DB-only artifact could be mistaken for full recoverability; local host loss threatens same-host backups.

Evidence: `scripts/backup.sh:112-131`; `scripts/backup.sh:142-156`

UNKNOWN: production scheduled job, media volume presence, offsite copy, retention, encryption and restore history. No production access.

### OPS-04 — Health endpoint measures liveness, not database readiness (P2; STATIC_CONFIRMED)

GET /api/health always returns 200 status ok without touching dependencies; Docker backend healthcheck and restore verification use this endpoint. Startup pool Ping/runtime-role verification exists but is not ongoing readiness.

Impact: A database outage after boot need not turn HTTP health unhealthy.

Evidence: `backend-go/internal/api/routes.go:104-109`; `docker-compose.prod.yml:55-60`; `backend-go/internal/storage/postgres.go:73-80`; `backend-go/cmd/server/main.go:52-59`

NEEDS VERIFICATION: isolated post-start DB outage; no outage induced.

### OPS-05 — Deployment operations snippet omits newly mandatory credentials (P2; STATIC_CONFIRMED)

Canonical deployment env snippet omits APP_DATABASE_PASSWORD and MFA_ENCRYPTION_KEYS required by compose. The copied .env.production.example does include both, so following the full template can avoid this documentation trap.

Impact: Using only the shown snippet cannot start production compose; operator documentation drifts.

Evidence: `docs/deployment.md:119-132`; `docker-compose.prod.yml:13-40`; `.env.production.example:26-26`; `.env.production.example:53-53`

NEEDS VERIFICATION: operator deployment dry run; not proof a current production deployment is broken.

### OPS-06 — CI coverage does not include production build, dependency scanning or host SketchUp proof (P2; STATIC_CONFIRMED)

Inspected ci.yml runs ledger/OpenAPI, TS tests/typecheck, Foundation Gate A, Ruby/RBZ on three OSes and Go tests with PostgreSQL. It has no Docker/web production build or advisory scan step; licensed SketchUp smoke is explicitly manual. Actions use version tags rather than immutable commit SHAs.

Impact: Passing this workflow is strong tested-scope evidence, not deployment reproducibility, vulnerability-free dependencies or native-host UI proof.

Evidence: `.github/workflows/ci.yml:18-187`; `.github/workflows/ci.yml:118-144`

UNKNOWN: repository protection settings, external CI scanners, actual current remote runs and manual host evidence (not queried in this subtask). No CVE claim.

### OPS-07 — Catalog paths have query-count growth (P2; STATIC_CONFIRMED)

ListOptionGroups reads all groups then queries members once per group (1+N); GetFullCatalog module loop calls detail loader per module, which loads component/board/hardware relations. Furniture definitions handler sequentially loads several complete catalog families. Member relation PK starts with option_group_id, so this is NOT a missing-index claim.

Impact: Higher catalog size adds database round trips and repeated hydration; backend pool fixed at max10 can amplify contention but no saturation measured.

Evidence: `backend-go/internal/storage/materials.go:355-399`; `backend-go/internal/storage/projects.go:268-306`; `backend-go/internal/storage/projects.go:329-329`; `backend-go/internal/api/furniture.go:54-99`; `backend-go/db/migration/000001_init_schema.up.sql:83-86`

NEEDS VERIFICATION: representative catalog trace, query count, EXPLAIN ANALYZE and p50/p95 under concurrent requests. No DB queried.

### OPS-08 — Projects list includes heavy payloads without pagination (P2; STATIC_CONFIRMED)

ListProjects selects cut_plan, design_revisions, approvals, change_orders and other JSON data for all visible projects; OR across owning/sales/manufacturing org and ORDER BY updated_at, no LIMIT. Single-column org indexes exist; this does not prove planner regression or missing useful index.

Impact: Payload and query cost grow with tenant project history; potential list-screen latency/memory risk.

Evidence: `backend-go/internal/storage/projects.go:359-366`; `backend-go/db/migration/000082_multi_org_scope_business_tables.up.sql:20-20`; `backend-go/db/migration/000087_project_org_ownership.up.sql:25-27`; `backend-go/internal/storage/postgres.go:63-66`

NEEDS VERIFICATION: realistic row counts/JSON sizes, endpoint bytes and execution plans; do not infer latency from code alone.

### OPS-09 — Observability baseline exists but operational SLO evidence is missing (P2; PARTIAL)

JSON slog startup/error logs, Caddy JSON access logs, request IDs and process-local RLS denial counter exist. Inspected production compose and dependency manifests do not configure metrics/tracing/alert backends or centralized retention. This is a scoped absence, not a claim that no external monitoring exists.

Impact: Request identity helps investigation but does not establish alert routing, latency/error SLOs, durable metric retention or recoverability.

Evidence: `backend-go/cmd/server/main.go:20-23`; `Caddyfile:8-12`; `backend-go/internal/api/request_id.go:41-50`; `backend-go/internal/storage/rls_metrics.go:10-24`; `docker-compose.prod.yml:3-115`

UNKNOWN: deployed dashboards, p95/error alerts, backup failure alerts, retention, incident response and on-call ownership.

### OPS-10 — SketchUp root scans and complete furniture rerender need scale measurement (P2; STATIC_RISK)

Selection fallback scans model.entities after active-path recovery fails. Duplicate rescan performs separate top-level passes for duplicates/unresolved/unsynced. Furniture edit clears/rebuilds its definition and scans orphan generated definitions, inside an undo operation; make_unique and abort handling protect scope. Migration scanner explicitly handles active top-level entities, not arbitrary nested legacy content.

Impact: Work scales with root entity/definition counts; risk in large models. No measured freeze/FPS or explicit redraw-loop defect established.

Evidence: `apps/sketchup-extension/src/granete_for_sketchup/selection/resolver.rb:193-242`; `apps/sketchup-extension/src/granete_for_sketchup/connection/duplicate_resolver.rb:77-128`; `apps/sketchup-extension/src/granete_for_sketchup/connection/duplicate_resolver.rb:188-208`; `apps/sketchup-extension/src/granete_for_sketchup/model/furniture_builder.rb:466-485`; `apps/sketchup-extension/src/granete_for_sketchup/model/furniture_builder.rb:624-633`; `apps/sketchup-extension/src/granete_for_sketchup/migration/scanner.rb:88-100`

NEEDS VERIFICATION: licensed SketchUp profiling with 10/100/1000 units, selection/edit/copy/publish timings, UI-thread/redraw costs and save/reopen. Unit Ruby is insufficient.

### OPS-11 — Backup gate can skip restore leg (P2; STATIC_CONFIRMED)

Pilot wrapper warns and allows missing pg_dump/pg_restore. Go backup test skips when clients absent and also when pg_restore returns error. CI installs a PostgreSQL client, but that alone does not assert this specific leg ran without skip.

Impact: Generic green pilot/Go suite does not necessarily prove backup restore capability; need exact test outcome.

Evidence: `scripts/pilot-gate.sh:111-114`; `backend-go/tests/pilotreadiness/backup_test.go:31-60`; `.github/workflows/ci.yml:176-187`

NEEDS VERIFICATION: inspect exact executed test log and confirm restore scenario PASS with zero skips; parent may hold relevant preflight evidence.

### OPS-12 — Backend Docker builder differs from Go module minimum (P2; STATIC_CONFIRMED)

Builder image is golang1.22, module declares Go1.25, CI uses1.25.x. Go toolchain auto-download may bridge this, so it is build-network/reproducibility drift rather than a proven failure.

Impact: Container build depends on behavior not covered by CI container gates; mutable image tags and unpinned toolchain retrieval weaken reproducibility.

Evidence: `backend-go/Dockerfile:3-18`; `backend-go/go.mod:3-3`; `.github/workflows/ci.yml:170-174`

NEEDS VERIFICATION: clean container build and resulting go version/build metadata; no image pull/build performed.

## Existing controls

- **Production network and credential baseline**: Explicit required secrets, distinct runtime/migration URLs, production secure-cookie policy, internal network, nonroot backend and reverse-proxy security headers are present. Deployed effective state not verified. Evidence: `docker-compose.prod.yml:9-46`; `docker-compose.prod.yml:99-115`; `backend-go/Dockerfile:25-37`; `Caddyfile:17-30`
- **Server request bounds and startup safety**: Fail-fast config/migration/runtime-role checks, read/header/write/idle timeouts and max header size exist. Evidence: `backend-go/cmd/server/main.go:29-59`; `backend-go/cmd/server/main.go:95-105`
- **Index baseline is real**: Tenant indexes and option membership PK exist; report does not claim absent indexing globally. Evidence: `backend-go/db/migration/000094_tenant_rls.up.sql:131-131`; `backend-go/db/migration/000083_multi_org_scope_catalog_tables.up.sql:13-13`; `backend-go/db/migration/000083_multi_org_scope_catalog_tables.up.sql:64-64`

## Coverage and limits

- Deployment: SOURCE_INSPECTED. UNKNOWN: Clean Docker build and live VPS configuration.
- CI/supply chain: SOURCE_INSPECTED. UNKNOWN: Remote checks/protection/external scanners; no advisory database lookup.
- Backup/restore: SOURCE_INSPECTED. UNKNOWN: Real production artifacts and isolated drill; scripts not run.
- Observability: SOURCE_INSPECTED. UNKNOWN: Live dashboards, alert routing and retention.
- Backend query/index risk: SOURCE_INSPECTED. UNKNOWN: No SQL execution, plans or benchmark.
- SketchUp traversal/redraw: SOURCE_INSPECTED. UNKNOWN: No native host performance run.

No vulnerability version/advisory claim, production incident, measured latency, FPS or RTO/RPO is invented. Source hashes are in `../data/operations-audit.json`. Recommendations are investigation priorities, not authorization to change product.
