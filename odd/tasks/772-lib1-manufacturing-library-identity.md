# ODD — #772 [P1][LIB-1] Manufacturing library identity, immutable releases, Free/Standard packages and exact project pinning

**Issue**: https://github.com/tiagofur/muebleria/issues/772  
**Status**: IMPLEMENTED_PENDING_REVIEW  
**Lane**: ODD  
**Base**: `main` @ `786f46ef`  
**Branch**: `feat/772-lib1-manufacturing-library`  
**Writer**: tiagofur (Implementer)

---

## Outcome

Introduce the `ManufacturingLibrary` and `LibraryRelease` relational model in PostgreSQL (with full RLS, migrations, and runtime-role tests), seed Granete Standard and Free identities, generate the Go types and OpenAPI contract stubs, and establish the `effectiveLibraryReleaseId` pinning field on projects. No publisher, no SketchUp sync, no overlays.

This is **Phase 1** of `docs/architecture/manufacturing-library-platform.md §21`.

---

## Acceptance (from issue)

- [x] UUID-backed `ManufacturingLibrary` exists; human `code` is not identity/authorization.
- [x] Granete Standard has one canonical library identity and an immutable release lifecycle.
- [x] FREE and STANDARD can reference the same canonical resource revision without definition duplication.
- [x] Standard-only resources remain inaccessible to Free entitlement through server enforcement.
- [x] Release entries point to existing canonical identities/revisions/fingerprints rather than owning copied furniture/material/hardware semantics.
- [x] Published releases cannot be silently modified in place.
- [x] Digital Thread records the exact effective library release at the immutable design/project-history boundary.
- [x] A newer library release cannot retarget an existing published DesignRevision/ProductionRelease.
- [x] Existing definition/revision pins continue working.
- [x] Fresh+upgrade PostgreSQL/RLS/generated-contract tests cover the new model.
- [x] Legacy projects with unknowable provenance are marked honestly rather than assigned fabricated historical versions.

## Explicit exclusions

- JSON/manifest compiler and object distribution -> LIB-2 (#773)
- Persistent local SketchUp LibraryStore/sync -> LIB-3 (#774)
- Customer manufacturing overlays/rebase/conflicts -> LIB-4 (#775)
- Customer self-service editor
- Full #454 factory->store publication

---

## Affected areas

| Area | Files |
|---|---|
| Migrations | `backend-go/db/migration/000139_manufacturing_library_foundation.{up,down}.sql` (new) |
| Go domain types | `backend-go/internal/domain/manufacturing_library.go` (new) |
| Go storage | `backend-go/internal/storage/manufacturing_library.go` (new) |
| Go API handler stub | `backend-go/internal/api/manufacturing_library.go` (new) |
| OpenAPI contract | `contracts/openapi.yaml` (new read-only paths + schemas) |
| Generated client | `packages/storage/src/apiClient.ts` (re-generated) |
| Project pinning | migration 000139 + `design_publish.go` |
| Tests | `backend-go/internal/storage/manufacturing_library_test.go` (new, 10 cases) |

---

## Tasks

### T1 — DB: core library tables

**File**: `backend-go/db/migration/000139_manufacturing_library_foundation.up.sql`

Tables:

**`manufacturing_libraries`**
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `code TEXT NOT NULL UNIQUE` — human support label only, never used for auth
- `kind TEXT NOT NULL CHECK (kind IN ('standard','organization_overlay','private'))`
- `owner_organization_id UUID REFERENCES organizations(id)` — NULL for Granete-owned
- `upstream_library_id UUID REFERENCES manufacturing_libraries(id)` — NULL for Standard
- `update_policy TEXT NOT NULL DEFAULT 'follow_upstream'`
- `status TEXT NOT NULL DEFAULT 'active'`
- `created_at`, `updated_at`

**`library_releases`**
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `library_id UUID NOT NULL REFERENCES manufacturing_libraries(id)`
- `version TEXT NOT NULL`
- `status TEXT NOT NULL CHECK (status IN ('draft','published','withdrawn'))`
- `schema_version INT NOT NULL DEFAULT 1`
- `min_plugin_version TEXT`
- `base_release_id UUID REFERENCES library_releases(id)` — upstream base for overlay compilation
- `manifest_hash TEXT` — NULL until published; enforced non-NULL on publish transition
- `changelog TEXT`
- `published_at TIMESTAMPTZ`
- `published_by UUID`
- `created_at`, `updated_at`
- `UNIQUE(library_id, version)`

**`library_release_resource_refs`**
- `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- `release_id UUID NOT NULL REFERENCES library_releases(id)`
- `resource_kind TEXT NOT NULL` — e.g. furniture_definition, hardware, material
- `resource_id UUID NOT NULL` — soft cross-domain canonical ref (no FK)
- `resource_revision TEXT NOT NULL`
- `definition_hash TEXT`
- `package_kind TEXT NOT NULL CHECK (package_kind IN ('free','standard'))` — entitlement flag

RLS policies:
- `manufacturing_libraries`: `owner_organization_id IS NULL` -> readable by all authenticated; org-owned -> readable only by same org.
- `library_releases`: readable if library readable; `draft` readable only by owner org or Granete staff capability.
- `library_release_resource_refs`: inherits from `library_releases`.

Indexes:
- `(library_id, status)` on `library_releases`
- `(release_id, resource_kind, resource_id)` on `library_release_resource_refs`

### T2 — DB: project pinning column

Same migration file.

```sql
-- NULL = provenance_unknown for legacy rows; no fabricated historical version.
ALTER TABLE design_working_copies
  ADD COLUMN effective_library_release_id UUID REFERENCES library_releases(id);

ALTER TABLE production_releases
  ADD COLUMN effective_library_release_id UUID REFERENCES library_releases(id);
```

### T3 — DB: seed Granete Standard identity

In the same migration (idempotent seed block):

```sql
INSERT INTO manufacturing_libraries (id, code, kind, status)
VALUES ('00000000-0000-0000-0001-000000000001', '0001', 'standard', 'active')
ON CONFLICT (id) DO NOTHING;
```

DESIGN NOTE: Free does NOT get its own manufacturing_libraries row. Free is expressed as
`package_kind = 'free'` on library_release_resource_refs entries within Standard releases.
This enforces the "no second catalog" invariant.

Create a first Granete Standard draft release `0.1.0-draft` (status = draft). No resource
refs are added yet; that is the publisher's job in LIB-2.

### T4 — Go domain types

**File**: `backend-go/internal/domain/manufacturing_library.go`

Define: LibraryKind (standard/organization_overlay/private), ReleaseStatus (draft/published/withdrawn),
PackageKind (free/standard), GraneteStandardLibraryID constant, ManufacturingLibrary struct,
LibraryRelease struct, LibraryReleaseResourceRef struct.

CRITICAL: GraneteStandardLibraryID is a constant, not a config key. Using code "0001" for
authorization is always wrong; the UUID is the only authoritative identity.

### T5 — Go storage layer

**File**: `backend-go/internal/storage/manufacturing_library.go`

Required functions:
- GetStandardLibrary(ctx) — returns Granete Standard by fixed UUID constant
- GetCurrentPublishedRelease(ctx, libraryID) — latest published non-withdrawn release
- GetReleaseByID(ctx, releaseID) — enforces auth via RLS
- CreateDraftRelease(ctx, params) — status=draft, fails on duplicate version
- PublishRelease(ctx, releaseID, manifestHash, publishedBy) — draft->published; validates manifest_hash NOT NULL
- WithdrawRelease(ctx, releaseID) — published->withdrawn
- AddResourceRef(ctx, params) — only allowed on draft releases; returns error if published
- GetEffectiveReleaseForOrg(ctx, orgID) — Phase 1: delegates to GetCurrentPublishedRelease for Standard; overlay logic is LIB-4

### T6 — OpenAPI contract stubs (read-only)

**File**: `contracts/openapi.yaml`

Add:
- GET /api/manufacturing-libraries/standard/releases/current -> 200 LibraryReleaseSummary | 404 | 401
- GET /api/manufacturing-libraries/standard/releases/{releaseId} -> 200 LibraryReleaseDetail | 404 | 401

New schemas: LibraryReleaseSummary, LibraryReleaseDetail, LibraryResourceRef.

Publish/create/withdraw endpoints are internal admin only; NOT in public contract this phase.

Re-run `make generate` (or equivalent) after editing to keep generated TS client in sync.

### T7 — Tests (10 cases, all against isolated test DB)

**File**: `backend-go/internal/storage/manufacturing_library_test.go`

1. Seed structural: Standard seeded with fixed UUID and code '0001', kind 'standard'.
2. Free is NOT a separate library row: after fresh migration, only one manufacturing_libraries row exists for Granete.
3. Draft release creation: two drafts with different versions succeed; same version fails unique constraint.
4. Publish lifecycle: PublishRelease sets published_at, status=published; calling on a withdrawn release returns error.
5. Published release immutability: AddResourceRef to published release returns error; row count unchanged.
6. Withdraw: WithdrawRelease marks withdrawn; GetCurrentPublishedRelease returns nil.
7. Legacy project pinning NULL: existing design_working_copies rows after migration have effective_library_release_id = NULL.
8. RLS cross-org isolation: org A cannot read org B's organization_overlay library drafts under runtime role.
9. RLS Standard readable: all authenticated orgs can read Standard library and published release rows.
10. Negative - LibraryCode is not auth: no WHERE code = $1 authorization pattern present in storage layer (code review gate).

### T8 — Wire pinning into design lifecycle

**File**: `backend-go/internal/storage/design_publish.go`

When PublishDesignRevision executes:
1. Call GetEffectiveReleaseForOrg(ctx, orgID).
2. If a published release exists, set effective_library_release_id on the new design_revisions row.
3. If none, set NULL and emit structured log warning (not a hard error in Phase 1).

Add test to design_publish_test.go:
- Pin recorded correctly when library release exists.
- Second library publish does NOT change effective_library_release_id of historical design_revisions row (pin immutability).

---

## Dependencies / Prerequisites

- No external blocker. This is the foundation of the LIB track.
- #773, #774, #775 gate on this issue.
- Last migration is 000138; next is 000139.
- design_working_copies and production_releases tables exist (migrations 000133/000134).
- Code generation tooling verified present (preflight OK, main @ 786f46ef).

---

## Verification plan

| Level | What | Pass condition |
|---|---|---|
| V0 | `python3 scripts/factory_preflight.py --require-clean` | PREFLIGHT_OK_NOT_VERIFIED, no dirty tracked files |
| V0 | `go build ./...`, `pnpm run typecheck` | Zero errors |
| V0 | Generated client drift check after `make generate` | No uncommitted diff in packages/storage/src/apiClient.ts |
| V1 | manufacturing_library_test.go — all 10 cases | GREEN, isolated test DB |
| V1 | design_publish_test.go — pinning regression | Pinned release ID unchanged after later library publish |
| V2 | Manual cURL: GET .../standard/releases/current authenticated -> 200 or 404; unauthenticated -> 401 | As expected |

---

## Delivery notes

- `Refs #772` + `Delivery: partial` — delivers Phase 1 only (foundation + pinning).
- Publisher (LIB-2), SketchUp LibraryStore (LIB-3), overlays (LIB-4) are follow-on.
- Estimated size: ~270-360 additions across SQL + Go + contract + tests.
- Fresh independent reviewer required; no self-approval.

---

## Status log

| Date | Event |
|---|---|
| 2026-09-29 | Artifact created from owner planning session; awaiting human authorization and branch reservation |
| 2026-09-29 | Branch reservation `feat/772-lib1-manufacturing-library` confirmed by owner |
| 2026-09-29 | Migration 000139 up/down created, RLS policies established, Granete Standard seed and draft release added |
| 2026-09-29 | Domain types and storage layer implemented with strict immutability, RLS, and lifecycle controls |
| 2026-09-29 | OpenAPI spec and generated TypeScript storage client updated; drift verified with zero diff |
| 2026-09-29 | HTTP handlers and routes registered under authMW with comprehensive API unit tests passing |
| 2026-09-29 | 11 storage test cases and Pilot Readiness suite PASSED on fresh ephemeral PostgreSQL container |
| 2026-09-29 | Implementation complete; ready for independent review |
