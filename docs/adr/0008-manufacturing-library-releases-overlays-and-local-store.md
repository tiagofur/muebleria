# ADR-0008 — Manufacturing library releases, overlays and persistent local store

- Status: **Accepted**
- Date: 2026-09-17
- Decision owners: Granete architecture
- Canonical detail: [`docs/architecture/manufacturing-library-platform.md`](../architecture/manufacturing-library-platform.md)

## Context

Granete needs to serve a useful free library, a maintained standard library and factory/workshop-specific manufacturing libraries without repeating the failure mode of full per-customer catalog copies that stop receiving upstream fixes.

Customers must be able to keep intentional construction/hardware/machining differences while Granete continues delivering compatible corrections and improvements. At the same time, SketchUp must not depend on live network requests for every cabinet/component and must be able to reopen historical projects against the exact library state with which they were created.

The repository already has canonical ownership for:

- furniture definitions, versions and resolver semantics;
- materials/hardware and related catalog domains;
- immutable SHA-256 3D assets;
- organizations/factories/workshops;
- factory-to-store catalog publication/subscription and non-manufacturing `StoreCatalogOverlay`.

Creating another independent item/catalog database for libraries would duplicate authority and increase synchronization/rework cost.

## Decision

### 1. A manufacturing library is a versioned composition/distribution boundary

`ManufacturingLibrary` does not become a second owner of furniture, material, hardware or asset semantics. Published releases reference exact canonical identities/revisions/fingerprints owned by their existing domains.

### 2. Granete Standard is the upstream library; Free is a package/view

Granete Standard is the managed upstream manufacturing library.

Granete Free (`#0000`) is a curated distribution package/view of Granete-managed canonical content rather than a hand-maintained copy. Shared Free/Standard resources therefore receive one authored correction and can be republished into both offerings.

Human library numbers/codes are support/product labels only. UUID-backed identities and server authorization are authoritative.

### 3. Customer customization uses manufacturing-library overlays

A workshop/factory-specific `LibraryOverlay` records intentional changes relative to a known upstream base and may add organization-owned resources.

When Granete Standard changes, the backend performs conflict-aware rebase/merge reasoning. Non-conflicting upstream corrections can flow forward. If upstream and customer changed the same semantic area, activation/publication is blocked until explicit resolution. Customer intent is never silently erased.

This `LibraryOverlay` is distinct from `StoreCatalogOverlay`; the latter remains commercial-only and cannot modify manufacturing truth.

### 4. Private fork is supported as a separate later mode

An organization may intentionally leave automatic upstream inheritance and own an independent manufacturing library. Provenance can be retained, but there is no implicit Granete update stream.

Private-fork tooling is not required for the first implementation.

### 5. PostgreSQL remains the source of truth

Library identity, release lifecycle, ownership, access, overlays, conflicts, project pins and canonical typed resources remain server-authoritative in PostgreSQL.

`JSONB` may hold flexible override/definition metadata where appropriate, but must not hide relational invariants or replace established typed domains.

### 6. Published distribution uses immutable JSON/manifests and hashes

Publishing/materializing a release serializes deterministic JSON definitions/manifests from authoritative state and calculates cryptographic hashes. Published releases are immutable.

Large binary assets remain in the existing 3D/object storage architecture and are referenced by immutable asset/hash descriptors; they are not duplicated into PostgreSQL or a second asset store.

### 7. The backend resolves the effective library

SketchUp consumes one immutable `EffectiveLibraryRelease`. It does not merge Granete Standard and customer overlays locally.

This keeps manufacturing update/conflict policy centralized, testable and auditable.

### 8. Projects pin exact effective releases

A project/revision must be able to identify the exact effective library release it used. New library releases do not silently modify existing designed/quoted/engineered/production work.

The SketchUp model stores enough Granete metadata to recover its exact project/library release context, subject to normal server authorization.

### 9. SketchUp gets a persistent local `LibraryStore`

Installed library manifests/content required for offline operation live in persistent application-data directories, separate from disposable cache.

Target locations:

```text
Windows persistent: %LOCALAPPDATA%\Granete\LibraryStore
Windows cache:      %LOCALAPPDATA%\Granete\Cache
macOS persistent:   ~/Library/Application Support/Granete/LibraryStore
macOS cache:        ~/Library/Caches/Granete
```

OS-specific paths are resolved through one abstraction.

### 10. Synchronization is incremental and atomic

A new manifest is compared against locally available content hashes. Only missing authorized objects/assets are downloaded. Every download is verified before installation. The current release pointer changes atomically only after the entire candidate release is valid.

Interrupted/failed updates leave the prior valid release usable. Content required by current or pinned projects is protected from garbage collection.

## Consequences

### Positive

- customer libraries can receive Granete improvements without losing local manufacturing rules;
- Free and Standard do not create duplicate maintenance work;
- releases are reproducible and historical projects are explainable;
- SketchUp can start/use installed content offline;
- unchanged content is deduplicated across releases/customers through hashes;
- update downloads can be proportional to changed content rather than full-library size;
- manufacturing merge/conflict logic stays out of the plugin;
- existing canonical catalog/asset domains remain single sources of truth;
- rollback/withdrawal can reactivate known immutable content rather than reconstructing mutable history.

### Costs

- release/materialization infrastructure must be added;
- overlay rebase/conflict rules need precise semantic ownership and tests;
- local retention/garbage collection must understand pinned releases;
- schema/plugin compatibility becomes an explicit contract;
- admin tooling is required before customer self-service editing is safe.

## Alternatives rejected

### A. Replace PostgreSQL with JSON files

Rejected. It would force Granete to rebuild querying, permissions, transactions, concurrency, audit and relational integrity while gaining no meaningful advantage for authoring. JSON is a distribution/serialization format, not the primary business database.

### B. PostgreSQL-only live plugin reads

Rejected. Making SketchUp fetch many live entities/endpoints during normal browsing/design increases latency, coupling and offline fragility and makes exact historical execution harder.

### C. Full copy of Granete Standard per customer

Rejected. Copies diverge, duplicate storage/maintenance and reproduce the exact update problem this architecture is intended to solve.

### D. Merge upstream + customer changes inside SketchUp

Rejected. It duplicates business/manufacturing policy in a thin client and makes conflicts, validation and auditing inconsistent across clients.

### E. Reuse `StoreCatalogOverlay` for factory manufacturing customization

Rejected. `StoreCatalogOverlay` is deliberately non-manufacturing. Allowing it to modify BOM/machining/construction would break factory authority and cross-organization boundaries.

### F. Silent latest-version updates for open/historical projects

Rejected. A manufacturing release can change geometry, hardware or machining. Existing projects must remain pinned until an explicit migration/update workflow is performed.

### G. One monolithic `library.json` archive redownloaded on each change

Rejected as the target distribution model. It prevents fine-grained deduplication/incremental updates and becomes costly as libraries/assets grow. Manifests plus content hashes allow reuse of unchanged content.

## Follow-up implementation order

1. library/release identity, canonical-resource references, packages/entitlements and project pinning;
2. deterministic release compiler/manifest/distribution;
3. persistent local LibraryStore and verified incremental synchronization;
4. organization overlays, conflict-safe upstream updates and internal-admin workflow;
5. customer self-service editor/private-fork/marketplace only after the base is proven.

## Related architecture

- [`docs/architecture/manufacturing-library-platform.md`](../architecture/manufacturing-library-platform.md)
- [`docs/architecture/parametric-furniture-library.md`](../architecture/parametric-furniture-library.md)
- [`docs/architecture/3d-asset-library.md`](../architecture/3d-asset-library.md)
- [`docs/architecture/organization-foundation-v2.md`](../architecture/organization-foundation-v2.md)
- `#454` — versioned factory catalog publication and store subscription
