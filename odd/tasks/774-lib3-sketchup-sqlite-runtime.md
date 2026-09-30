# ODD — #774 [P1][LIB-3] SketchUp local-store SQLite runtime, atomic library activation and offline resolver

**Issue**: https://github.com/tiagofur/muebleria/issues/774  
**Title**: [P1][LIB-3][SU] Persistent LibraryStore and verified incremental manufacturing-library sync  
**Status**: COMPLETED  
**Lane**: ODD  
**Base**: `feat/773-lib2-deterministic-manifest-publisher` @ `e63ff11d`  
**Branch**: `feat/774-lib3-sketchup-sqlite-runtime`  
**Writer**: tiagofur

---

## Outcome

Install and maintain immutable manufacturing-library releases locally for Granete for SketchUp:
1. **Persistent Platform Paths (`GranetePaths`)**:
   - Persistent `LibraryStore` separated from disposable `Cache` across macOS and Windows.
   - Cache clearing by OS/user never deletes installed library content.
2. **Content-Addressed Local Store (`LibraryStore`)**:
   - Filesystem layout storing immutable objects by `sha256/ab/<full-hash>.json`, release manifests by `manifests/<release-id>/manifest.json`, and current organization pointers by `current/<org-id>.json`.
   - Free, Standard, and organization libraries deduplicate shared definition hashes.
3. **Atomic Verified Incremental Synchronizer (`LibrarySynchronizer`)**:
   - State machine that downloads only missing content hashes from #773 endpoints.
   - Strict size and SHA-256 digest validation of every downloaded object in a quarantine/temp folder before promotion.
   - Atomic pointer swap: failure, network abort, or corrupt hash leaves previous current release 100% untouched and functional.
4. **Offline Resolver & Safe Startup (`LocalLibraryResolver`)**:
   - Loads last valid installed release immediately on startup without network latency.
   - Historical pin resolution: opens exact pinned project releases without replacing organization current pointer.
   - Strict multi-tenant isolation: organization pointers are isolated, late responses from previous organization cannot activate.

---

## Acceptance Criteria (from issue #774)

- [x] Fresh install with authorization can install one effective Standard/Free release from manifest to persistent LibraryStore.
- [x] Restart with network unavailable can load the last valid installed release without a full refetch, subject to #474 safety state.
- [x] Updating a release with changed hashes downloads only missing changed content plus manifest/index metadata, not every unchanged object.
- [x] Interrupted/corrupt/failed update leaves the previous release current and usable.
- [x] Every downloaded content object is size/hash verified before activation.
- [x] Current pointer changes atomically only after candidate validation completes.
- [x] Free/Standard/shared immutable hashes are deduplicated rather than physically duplicated by release.
- [x] Exact older pinned project release can be opened/fetched without substituting current.
- [x] Cache deletion does not delete installed library; LibraryStore loss triggers explicit reinstall/recovery.
- [x] Org/session switch cannot leak another organization's current manifest/index.
- [x] Plugin-incompatible manifest is blocked before use/mutation.
- [x] Retention/GC preserves objects still referenced by current or protected pinned releases.
- [x] Windows and macOS path behavior is covered; real-host evidence is recorded where filesystem/SketchUp integration requires it.

---

## Negative Proof (Review must fail if)

- Installed productive content is stored only under a disposable OS cache path.
- A new release becomes current before all required hashes verify.
- Failed update deletes the previous good library.
- Plugin performs Standard + customer overlay merge locally (overlay resolution belongs to backend).
- Opening an old model silently maps its release ID to current.
- Local SQLite/JSON is treated as authoritative authoring state and writes business changes back to server.
- Knowing a local hash bypasses server package/organization authorization in the UI/API.
- Stale late response from Org A activates after switching to Org B.

---

## Explicit Exclusions

- Manufacturing overlay/rebase/conflicts (LIB-4 / #775).
- Customer self-service library editing.
- Generic offline queue for Project/Design mutations beyond #474/#679.
- RBZ/plugin auto-update (#355).
- Redesigning #506 library browser UX.
- New 3D asset authoring/conversion pipeline.
- Marketplace.

---

## Architecture & Data Flow

```text
Backend Distribution API (#773)
  │  GET /api/manufacturing-libraries/standard/releases/{releaseId}/manifest
  │  GET /api/manufacturing-libraries/standard/releases/{releaseId}/resources/{resourceId}/blobs/{hash}
  ▼
Granete::SketchUpExtension::Library::LibrarySynchronizer
  ├── 1. Fetch & parse manifest (validate schemaVersion, minPluginVersion)
  ├── 2. Inspect LibraryStore: identify missing hashes
  ├── 3. Download missing objects into Cache/temp/
  ├── 4. Verify exact size and SHA-256 digest
  ├── 5. Atomic move: Cache/temp/ → LibraryStore/objects/sha256/xx/<hash>.json
  ├── 6. Atomically persist LibraryStore/manifests/<release-id>/manifest.json
  └── 7. Atomically update LibraryStore/current/<org-id>.json
  │
  ▼
Granete::SketchUpExtension::Library::LocalLibraryResolver
  ├── Reads current effective release for active org
  ├── Resolves furniture definitions & hardware locally
  └── Supports historical project release resolution without overriding current
```

---

## Tasks

### T1 — Platform Paths Abstraction (`GranetePaths`)
**File**: `apps/sketchup-extension/src/granete_for_sketchup/paths.rb`
- Provide `GranetePaths.library_store`, `GranetePaths.cache`, `GranetePaths.temp`.
- Implement platform separation:
  - Windows: `%LOCALAPPDATA%\Granete\LibraryStore` and `%LOCALAPPDATA%\Granete\Cache`
  - macOS: `~/Library/Application Support/Granete/LibraryStore` and `~/Library/Caches/Granete`
- Support injectable root for test isolation.
- Unit tests: `test/unit/paths_test.rb`.

### T2 — Content-Addressed Local Store (`LibraryStore`)
**File**: `apps/sketchup-extension/src/granete_for_sketchup/library/library_store.rb`
- Storage layout manager:
  - `manifests/<release-id>/manifest.json`
  - `objects/sha256/<prefix>/<hash>.json`
  - `current/<org-id>.json`
- Methods: `object_exist?`, `read_object`, `write_object` (with integrity verification), `write_manifest`, `read_manifest`, `set_current_release`, `current_release_id`.
- Unit tests: `test/unit/library_store_test.rb`.

### T3 — Atomic Verified Incremental Synchronizer (`LibrarySynchronizer`)
**File**: `apps/sketchup-extension/src/granete_for_sketchup/library/library_synchronizer.rb`
- Orchestrates incremental synchronization:
  - Checks if candidate release already installed.
  - Diffing: downloads only missing object hashes.
  - Quarantine: downloads to temp path first, verifies size and SHA-256 before promotion.
  - Abort handling: corrupted hash or network failure leaves previous release current.
  - Organization and session token checking: cancels activation if organization changed during sync.
- Unit tests: `test/unit/library_synchronizer_test.rb`.

### T4 — Local Offline Resolver & Catalog Provider Integration
**File**: `apps/sketchup-extension/src/granete_for_sketchup/library/local_library_resolver.rb`
- Provides synchronous local read API for library catalog consumers.
- Reads definitions directly from local content-addressed files.
- Supports pinned historical releases (`resolve_release(release_id)`).
- Unit tests: `test/unit/local_library_resolver_test.rb`.

### T5 — Negative Proofs and Edge Case Suite
**Files**: `test/unit/library_store_negative_test.rb`, `test/unit/library_synchronizer_negative_test.rb`
- Hash mismatch detection and temp file purge.
- Interrupted download leaves previous current release functional.
- Context race: Org A sync finishes after switching to Org B -> rejected, Org B pointer not corrupted.
- Cache directory deletion does not affect installed library store.

---

## Verification Plan

| Level | What | Pass Condition | Result |
|---|---|---|---|
| V0 | `python3 scripts/factory_preflight.py` | Tools OK, branch clean | PASS |
| V0 | `rubocop` on new Ruby files | 0 offenses | PASS (4 files inspected, 0 offenses) |
| V1 | `paths_test.rb` | Correct paths on macOS / Windows / custom root | PASS (2 runs, 9 assertions) |
| V1 | `library_store_test.rb` | Store operations, deduplication, atomic manifest/current write | PASS (6 runs, 26 assertions) |
| V1 | `library_synchronizer_test.rb` | Incremental sync, hash verification, skip existing hashes | PASS (6 runs, 27 assertions) |
| V1 | `local_library_resolver_test.rb` | Local offline resolution, historical pin lookup | PASS (5 runs, 11 assertions) |
| V1 | Negative proof tests | Hash mismatch aborted, cross-org race rejected, cache purge safe | PASS (6 runs, 15 assertions) |

**Total Suite**: 25 runs, 88 assertions, 0 failures, 0 errors, 0 skips.

