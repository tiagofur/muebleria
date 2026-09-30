# ODD — #913 HW-PROFILE persistence & server-authoritative API

- Issue: #913 (status:approved 2026-09-30 under the program authorization
  recorded in #912; explicit owner kickoff quote in the issue comment).
- Lane: ODD. Worktree `../muebles-worktrees/913-hardware-profiles`.
- Base: `origin/main` @ `ac546687` (post-merge #942 contract + #943 settings).
- Scope: table + storage CRUD + generated API for Hardware Profiles using
  the frozen #912 contract. NO React, NO side assignments, NO resolver, NO
  BOM, NO release compilation.

## Facts established (pattern audit @ ac546687)

- Migration template: `000141_manufacturing_library_overlays.up.sql` — org
  FK ON DELETE CASCADE, org-first index (RLS readiness requires it),
  ENABLE+FORCE RLS, named policies TO granete_app (USING + WITH CHECK),
  GRANT to granete_app, `rls_policy_inventory` insert (tenant-owned),
  reverse-order down. Next number: **000143**. No separate fresh path
  (000001 never edited); fresh DBs replay 1→N.
- Optimistic concurrency template: `modules.version` (000142) —
  `version BIGINT NOT NULL DEFAULT 1 CHECK (version >= 1)`;
  UPDATE ... `version = version + 1 WHERE ... AND version = $expected`
  RETURNING; ErrNoRows disambiguation exists→`storage.ErrVersionConflict`
  (412) / not-exists→404. API: `preconditions.go` strong ETag `"v<N>"`,
  `RequireIfMatch` (428 missing / 400 malformed).
- Handler templates: hardware CRUD (unversioned, materials.go storage,
  handlers.go) and modules (versioned, projects.go storage + handlers).
  Catalog mutations gate on `RoleCanMutateCatalog`; org scope from
  `OrgFromCtx`; no idempotency keys for catalog CRUD; no audit/outbox for
  catalog entities.
- #912 contract already merged: `domain.HardwareProfile` + `Validate()`
  ([]ContractIssue, codes PROFILE_INVALID/ASSIGNMENT_INVALID) + shared
  fixture `contracts/hardwareProfile.contract.json` (Go+TS parity).
- 422 issues envelope pattern: `respondWithParameterDefinitionIssues`
  (api_contract_errors.go:43) — the model for a profile-issues responder.
- Codegen: yaml edit → `pnpm openapi:generate` → commit generated Go/TS;
  drift CI-enforced.
- Wire naming: new schemas self-consistent camelCase matching the domain
  json tags (hardwareId, recipeRef); Write schema without id/version.

## Design decisions

1. Table `hardware_profiles`: id UUID PK gen_random_uuid(),
   organization_id FK CASCADE, code/name/description/revision TEXT,
   items JSONB NOT NULL, recipe_ref JSONB NULL, active BOOL DEFAULT TRUE,
   version BIGINT DEFAULT 1, created_at/updated_at. UNIQUE
   (organization_id, code). Items/recipe_ref stored verbatim from the
   domain contract (camelCase JSONB).
2. Storage (new file `hardware_profiles.go`): List/GetByID/Create/
   Update(expectedVersion)/Deactivate(expectedVersion) — org-scoped SQL
   everywhere, server sets updated_at on every UPDATE, version+1 on
   accepted writes, duplicate code via unique violation → handler 409.
3. Reference integrity: Create/Update verify every item hardwareId exists
   in the same organization (single `= ANY($ids)` query); missing →
   structured 422 issue (HARDWARE_REFERENCE_INVALID, per-item path), never
   a silent accept. Prices/units never stored.
4. API `/api/catalog/hardware-profiles[/{id}]`: GET list/GET one (ETag),
   POST 201 (ETag, server-side id/version/active), PUT with If-Match
   (200+ETag / 404 / 409 / 412 / 428 / 422), DELETE with If-Match
   (soft-deactivate 200 / 404 / 412 / 428). Mutations gated on
   RoleCanMutateCatalog. 422 envelope for domain + reference issues.
5. OpenAPI: paths + schemas HardwareProfile / HardwareProfileWrite /
   HardwareProfileItem / ProfileRecipeRef (camelCase, Write without
   id/version), If-Match + ETag refs reused; regenerate clients.

## Tasks

- [x] Migration 000143 (+down) with full RLS checklist.
- [x] Storage CRUD + concurrency + reference check + tests (CRUD,
      version conflict, fresh+upgrade migration test, isolation family,
      RLS direct-SQL coverage via the suite).
- [x] Store interface additions + handlers (new file) + handler tests.
- [x] OpenAPI paths/schemas + generated clients + drift check.
- [ ] Full suites; work-unit commits; PR (Refs #913).

## Evidence log

- 2026-09-30 startup: preflight PREFLIGHT_OK_NOT_VERIFIED @ ac546687 in
  the clean worktree; issue approved; no other writer on these files.
- 2026-09-30 storage (real PostgreSQL via scripts/backend-test.sh,
  ephemeral container + granete_app runtime role): focused profile tests
  5/5 (CRUD+version concurrency incl. stale/zero-version/unknown-id and
  version-guarded deactivate; duplicate code; org-scoped hardware id
  resolution; cross-org isolation family) and the FULL storage suite ok
  (473s). Migration fresh (defaults + FORCE RLS + tenant-owned inventory
  row) and upgrade (142→143) both pinned.
- 2026-09-30 api: handler tests green (list/create 201+ETag/server-owned
  identity/closed body incl. version rejection/reference 422 envelope/
  duplicate 409/permission 403; get 200+ETag/404; PUT 428/400/200 v4
  preserving active/412; DELETE with If-Match + deactivated body/412).
  `go build ./...` ok; api+domain suites ok.
- 2026-09-30 contract: OpenAPI paths/parameter/6 schemas added; client
  regenerated (list/create/update/deactivate with typed version arg);
  drift check ok; typecheck 0 errors; TS storage 244/244; domain
  1744/1744.
- Two test-driven corrections: POST assigns the server id BEFORE
  validation (the #912 contract validates non-blank id) and direct
  handler tests use SetPathValue (PathValue needs routing otherwise).
- NOT_RUN locally: Foundation Gate A browser/organization gates for this
  HEAD (CI); no React surface in this slice by exclusion.
