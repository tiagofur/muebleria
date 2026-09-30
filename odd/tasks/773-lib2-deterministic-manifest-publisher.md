# ODD — #773 [P1][LIB-2] Deterministic manufacturing-library publisher, manifest and content-addressed distribution

**Issue**: https://github.com/tiagofur/muebleria/issues/773  
**Status**: COMPLETED (Ready for Independent Review)  
**Lane**: ODD  
**Base**: `main` @ `50413708`  
**Branch**: `feat/773-lib2-deterministic-manifest-publisher`  
**Writer**: tiagofur

---

## Outcome

Build the **publish, materialize, and content-addressed distribution** pipeline for manufacturing libraries (Phase 2 of ADR-0008 / `docs/architecture/manufacturing-library-platform.md §21`):
1. A backend compiler that validates draft releases, resolves canonical resource revisions and existing 3D asset hashes, serializes canonical deterministic JSON resource blobs, computes SHA-256 hashes, and generates a deterministic versioned manifest.
2. Atomic publication semantics ensuring failure leaves the current release untouched.
3. Content-addressed storage and distribution allowing Free and Standard to reuse identical definition hashes without duplicating data.
4. Authenticated, entitlement-safe API endpoints for clients to fetch the release manifest and download individual content-addressed blobs.
5. Immutability triggers and negative proofs ensuring published releases, manifests, and blobs cannot be modified in place, and hash knowledge does not bypass authorization.

---

## Acceptance Criteria (from issue #773)

- [x] Same authoritative input produces byte/fingerprint-equivalent manifest and resource JSON on repeated compilation.
- [x] Published release and manifest are strictly immutable.
- [x] Free and Standard reuse identical content hashes where the same resource revision participates in both.
- [x] Changing one resource does not require every unchanged resource to receive a new content identity.
- [x] Manifest references exact canonical resource revisions and canonical 3D asset hashes.
- [x] No manifest contains bearer/session credentials or unauthorized industrial data.
- [x] Publish is atomic: compiler or storage failure leaves previous current release untouched.
- [x] A withdrawn bad release stops new activation without destroying historical pins.
- [x] Exact older pinned releases remain resolvable under authorization.
- [x] API/contract clients are generated and tenant/package authorization is server-enforced.
- [x] Negative tests cover guessed hash/release access, missing assets, corrupted generated content, unsupported schema, and concurrent publication.

---

## Negative Proof (Review must fail if)

- Plugin needs to call a chain of mutable catalog endpoints to reconstruct a supposedly immutable release.
- A published JSON file or manifest is edited in place.
- `latest` replaces an exact release ID for historical retrieval.
- An asset is copied into a new parallel asset identity instead of referencing existing SHA/revision.
- A known hash is enough to download Standard/customer content without authorization (hash != authorization).
- Partial publication advances the current release pointer.
- Output order or non-deterministic maps cause identical source state to produce different manifest fingerprints.
- One changed component forces an all-library full redownload by design.

---

## Explicit Exclusions

- Local filesystem paths, cache, SQLite, and atomic client activation (LIB-3 / #774).
- Organization override, rebase, and conflict engine (LIB-4 / #775).
- Customer self-service library editor.
- Private-fork UX.
- Store subscription / monetization workflow (#454).
- 3D asset conversion / geometry engine changes (#667–#670).

---

## Pipeline Architecture

```text
PostgreSQL Authoritative Authoring State
  │
  ▼
1. Validation Gate
   ├── Verify referenced canonical resources exist and are publishable
   ├── Verify package_kind ('free' vs 'standard') coherence
   ├── Verify required 3D asset descriptors and hashes exist in asset registry
   └── Check schema_version and min_plugin_version compatibility
  │
  ▼
2. Canonical Materialization & Content Addressing
   ├── Serialize individual resources into canonical deterministic JSON
   ├── Deterministic key ordering, stable formatting, no volatile timestamps in content
   └── Compute SHA-256 for each resource blob (identical across Free & Standard)
  │
  ▼
3. Deterministic Manifest Generation
   ├── Sort resource entries deterministically (by resource_kind, then resource_id)
   ├── Build LibraryManifest structure (schemaVersion, libraryId, version, resources, assets)
   └── Compute SHA-256 manifestHash from canonical manifest bytes
  │
  ▼
4. Atomic Publication Transaction
   ├── Write manifestHash and published_at to library_releases
   ├── Update definition_hash on library_release_resource_refs
   ├── Store manifest & blob payloads in content store (deduplicating identical blobs)
   └── Advance current published release pointer atomically
```

---

## Tasks Completed

### T1 — Manifest & Resource Blob Domain Types
**Files**: `backend-go/internal/domain/manufacturing_library_manifest.go`, `..._test.go`
- Defined `LibraryManifest`, `ManifestResourceRef`, `ManifestAssetRef`, `ManifestUpstreamRef`, `ResourceBlob`.
- Deterministic key ordering and canonical JSON serialization helper `CanonicalizeJSON`.
- Cryptographic hash helper `ComputeSHA256Digest` and manifest fingerprinting `ComputeManifestHash`.
- Unit tests verifying determinism and mutation sensitivity.

### T2 — Canonical JSON Serializer & Deterministic Compiler
**Files**: `backend-go/internal/application/library_compiler.go`, `..._test.go`
- Pure compiler functions taking database records and producing deterministic byte blobs.
- Validation checks (schema compatibility, no dangling references, asset presence).
- Verification with 50-shuffle inputs producing bit-for-bit identical hashes.
- Free vs Standard hash parity and single-resource change isolation proofs.

### T3 — Content-Addressed Storage & Database Migrations
**Files**:
- `backend-go/db/migration/000140_manufacturing_library_distribution.up.sql`
- `backend-go/db/migration/000140_manufacturing_library_distribution.down.sql`
- `backend-go/internal/storage/manufacturing_library_publish.go`
- `backend-go/internal/storage/manufacturing_library_publish_test.go`
- Tables `library_release_manifests` and `library_resource_blobs` with immutability triggers and RLS policies.
- Atomic publication transaction `PublishReleaseWithManifest`.
- Immutability trigger tests verifying UPDATE on manifests and blobs are blocked.
- Content blob deduplication (`ON CONFLICT (sha256) DO NOTHING`).
- Entitlement-safe retrieval `GetResourceBlobWithEntitlementCheck`.

### T4 — OpenAPI Contract & Generated Clients
**Files**: `contracts/openapi/granete-api.v1.yaml`, generated Go & TS clients
- Added endpoints:
  - `GET /api/manufacturing-libraries/standard/releases/{releaseId}/manifest`
  - `GET /api/manufacturing-libraries/standard/releases/{releaseId}/resources/{resourceId}/blobs/{hash}`
- Schemas: `LibraryManifest`, `ManifestResourceRef`, `ManifestAssetRef`, `ManifestUpstreamRef`, `LibraryResourceBlob`.
- Codegen: `scripts/generate_openapi.py` with 0 drift verified via `scripts/check_openapi_drift.py`.
- TS clients typechecked clean (`pnpm --filter @granete/storage typecheck`).

### T5 — HTTP Handlers & Routes
**Files**:
- `backend-go/internal/api/manufacturing_library_distribution.go`
- `backend-go/internal/api/manufacturing_library_distribution_test.go`
- `backend-go/internal/api/routes.go`
- Handlers for manifest retrieval and content-addressed blob download with ETag and immutable Cache-Control.
- Server-side entitlement check: Free callers blocked from standard-only blobs (HTTP 403 Forbidden).
- Authentication enforced on both endpoints via `authMW` (HTTP 401 Unauthorized for unauthenticated requests).

### T6 — Comprehensive Automated Verification
**Results**:
- `go test ./internal/domain ./internal/application ./internal/api`: PASS (all tests pass)
- `scripts/pilot-gate.sh --fresh-container`: PASS (multi-org isolation and immutability verified against real ephemeral Postgres 16 container)
- `pnpm run typecheck`: PASS (all workspace packages clean)
- `python3 scripts/check_openapi_drift.py`: PASS (0 drift)

---

## Verification Matrix

| Level | What | Result |
|---|---|---|
| V0 | `python3 scripts/factory_preflight.py` | PASS |
| V0 | `python3 scripts/check_openapi_drift.py` | PASS (0 drift) |
| V0 | `pnpm run typecheck` | PASS (0 errors across 7 packages) |
| V1 | Compiler determinism & hash tests | PASS (50-shuffle identical SHA-256) |
| V1 | Storage & atomic publish tests | PASS (immutability, deduplication, entitlement) |
| V1 | API distribution & entitlement tests | PASS (Free blocked from Standard blobs with 403) |
| V2 | Pilot Readiness Gate (`pilot-gate.sh`) | PASS (`granete_app` and ephemeral Postgres 16) |

---

## Status Log

| Date | Event |
|---|---|
| 2026-09-29 | ODD task file initialized following #772 approval and architecture specifications from #773 |
| 2026-09-29 | Manifest domain types & deterministic JSON canonicalizer implemented and tested |
| 2026-09-29 | Deterministic compiler implemented with 50-shuffle determinism, Free/Standard parity, and change isolation |
| 2026-09-29 | Migration 000140 added (`library_release_manifests`, `library_resource_blobs`, immutability triggers, RLS) |
| 2026-09-29 | OpenAPI contract extended and TS/Go clients generated with 0 drift |
| 2026-09-29 | HTTP distribution endpoints implemented with ETag, Cache-Control, and license entitlement checks |
| 2026-09-29 | Storage integration tests and Pilot Readiness Gate verified on ephemeral PostgreSQL container |
