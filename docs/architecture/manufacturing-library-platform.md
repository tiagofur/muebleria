# Manufacturing Library Platform

> Status: **Canonical target architecture**
>
> Scope: Granete-managed manufacturing libraries, organization-specific manufacturing overlays, immutable releases, distribution to SketchUp, local persistent library storage, update/rebase rules, and project pinning.
>
> This document does **not** create a second furniture/catalog domain. It composes and distributes the canonical definitions already owned by the catalog, hardware/material, resolver, and 3D asset domains.

## 1. Purpose

Granete must support four commercial/operational needs without creating permanently divergent copies:

1. a useful free library for acquisition;
2. a complete Granete-maintained standard library;
3. workshop/factory-specific customization that can continue receiving safe Granete corrections and improvements;
4. a fully independent library for organizations that intentionally leave the Granete upstream lifecycle.

The same architecture must also let the SketchUp plugin work quickly and offline from a persistent local library, download only changed content, preserve exact historical project behavior, and reject unsafe silent updates.

The central rule is:

> **PostgreSQL is the authoring/source-of-truth plane; immutable release manifests and content-addressed artifacts are the distribution plane; the local LibraryStore is the execution/read plane for SketchUp.**

These are complementary responsibilities, not competing storage models.

---

## 2. Relationship to existing canonical domains

This platform sits **above** existing canonical identities. It must not introduce a parallel copy of them.

- `FurnitureDefinition` identity, revision/lifecycle, reusable parts, parameter resolution and manufacturing output remain owned by [Parametric Furniture Library](./parametric-furniture-library.md).
- 3D files, previews and other binary assets remain owned by [3D Asset Library](./3d-asset-library.md), including content-addressable SHA-256 identity.
- organization/workshop/factory ownership remains owned by [Organization Foundation V2](./organization-foundation-v2.md).
- factory-to-store commercial publication remains owned by issue `#454` and the organization/network architecture.
- this platform owns **which exact canonical resource revisions compose a manufacturing library release, how an organization safely overrides an upstream manufacturing library, and how an effective release is distributed and cached locally**.

### 2.1 `LibraryOverlay` is not `StoreCatalogOverlay`

These two concepts must never be merged:

| Concept | Owner | Allowed to change manufacturing truth? | Purpose |
|---|---|---:|---|
| `ManufacturingLibraryOverlay` / `LibraryOverlay` | workshop/factory manufacturing library | Yes, within explicit override rules | customize construction methods, resource choices and organization-specific manufacturing definitions relative to Granete Standard |
| `StoreCatalogOverlay` | sales-network/store subscription | **No** | commercial display metadata, visibility, ordering, retail policy and other store-local sales concerns |

A store overlay can rename or hide a sellable item. It cannot use this mechanism to change BOM, machining, CNC, construction rules, manufacturing parameters, or factory product identity.

---

## 3. Non-negotiable invariants

1. **No second catalog.** A library release references canonical resource identities/revisions; it does not clone canonical `FurnitureDefinition`, material, hardware or 3D asset authority into a new competing model.
2. **UUID is identity.** Human-facing library numbers/codes are support/product labels only and never authorize access or drive behavior.
3. **Published releases are immutable.** A published release is replaced by a newer release, never edited in place.
4. **Projects pin exact effective releases.** A library update must never silently rewrite an already designed/quoted/engineered/produced project.
5. **Customer manufacturing overrides are never silently discarded.** Upstream changes can auto-apply only when they do not conflict with customer-owned changes.
6. **The backend resolves inheritance.** SketchUp consumes an `EffectiveLibraryRelease`; it does not perform Granete Standard + customer overlay merge logic.
7. **PostgreSQL remains authoritative for authoring and business state.** JSON/JSONB and manifests do not turn the server filesystem into a source of truth.
8. **Binary assets do not live as large blobs in PostgreSQL.** They use the existing asset-storage abstraction and immutable hashes.
9. **`LibraryStore` is persistent application data, not disposable cache.** The OS may discard cache, but losing cache must not invalidate the installed local library.
10. **Downloads are verified before activation.** A partially downloaded or hash-invalid release is never made current.
11. **Offline startup uses the last valid local release.** Network/update failure cannot prevent normal local browsing/design when required content is already installed.
12. **Exact historical content remains resolvable.** Retiring or superseding a release does not destroy references required by pinned historical projects.
13. **Hash equality is integrity/deduplication, not authorization.** Access to manifests and downloadable content remains organization/entitlement scoped.

---

## 4. Product/library modes

### 4.1 Granete Free — public code `#0000`

Granete Free is a curated **distribution package/view of Granete-managed canonical resources**, not a manually duplicated catalog.

A canonical resource can be eligible for one or more packages, for example:

```text
base.single-door    -> FREE, STANDARD
base.double-door    -> FREE, STANDARD
tall.pantry-pro     -> STANDARD
corner.magic        -> STANDARD
```

When the same resource is present in Free and Standard, a bug fix is authored once and both packages can receive the corrected revision according to release policy.

Free may contain fewer modules/options and may expose simpler product variants, but those variants must have their own canonical identities rather than ad-hoc copied JSON files.

### 4.2 Granete Standard — public code `#0001`

The complete Granete-managed upstream manufacturing library. Granete owns its published lifecycle, validation, compatibility metadata and update stream.

Normal paid customers can use Standard without obtaining permission to modify Granete's upstream definitions.

### 4.3 Organization/Company Overlay — example code `#1001`

A workshop/factory-specific manufacturing library that declares Granete Standard as upstream and stores only intentional organization-specific differences and organization-only resources.

Typical differences include:

- construction dimensions/defaults;
- allowed material systems;
- preferred or required hardware;
- organization-specific modules;
- organization-specific machining/construction behavior where the canonical domain permits it;
- organization-owned 3D/manufacturing assets.

An overlay continues receiving compatible upstream fixes/new resources. The organization does **not** lose all Granete updates simply because it has local customization.

### 4.4 Private Library / Fork

A fully independent manufacturing library with optional provenance to the release from which it was created, but no automatic upstream relationship.

This mode is reserved for organizations that intentionally own their entire manufacturing-library lifecycle. It is not required for the first implementation.

---

## 5. Human library code versus system identity

A support-friendly code is useful:

```text
#0000  Granete Free
#0001  Granete Standard
#1001  Muebles Pérez
#1002  Cocinas Vallarta
```

It is not a primary key and must never be used as authorization logic.

Conceptually:

```text
ManufacturingLibrary
- id: UUID
- code: string       // human/support identifier
- name
- kind
- ownerOrganizationId?
- upstreamLibraryId?
- updatePolicy
- status
```

Permissions are evaluated through organization membership/capabilities/entitlements against the UUID-backed resource.

---

## 6. Canonical model

Names below describe domain responsibilities. Exact SQL/table names are implementation decisions and must follow repository conventions.

### 6.1 `ManufacturingLibrary`

Mutable authoring identity for a managed library lineage.

Relevant attributes:

- UUID identity;
- human `code`;
- `kind = standard | organization_overlay | private` (Free is primarily a distribution package/view, not a copied resource graph);
- owner organization when organization-owned;
- optional upstream library identity;
- update policy;
- lifecycle/status.

### 6.2 `LibraryRelease`

Immutable published snapshot of one library lineage.

Relevant attributes:

- release UUID;
- library UUID;
- semantic/library version;
- status (`draft`, `published`, `withdrawn`/`retired` as policy requires);
- `schemaVersion`;
- `minPluginVersion`;
- source/base release references;
- deterministic manifest hash;
- changelog/publication metadata;
- actor/timestamps/audit.

A release version describes **content evolution**. `schemaVersion` describes the **shape/interpretation contract**. They are distinct.

### 6.3 Release entries reference existing canonical resources

A release contains references such as:

```text
resource kind
stable canonical resource id
exact canonical revision/version/fingerprint
published definition/content hash
required asset hashes/descriptors
package/availability metadata when needed
```

Do **not** create a universal `library_items` table that becomes the new owner of all furniture/hardware/material semantics. Established typed domains remain authoritative.

### 6.4 `LibraryDistributionPackage`

Defines which published resources/features are available to an offering such as `FREE` or `STANDARD` without duplicating their canonical definitions.

The exact entitlement model belongs with organization/license capabilities, but effective release construction must receive a server-authoritative package/access decision.

### 6.5 `LibraryOverlay`

Captures organization-owned differences relative to a known upstream revision/base release.

Where flexible override data is required, PostgreSQL `JSONB` is appropriate. The overlay must retain enough base identity to decide whether a future upstream change is safe to rebase.

Conceptually an override records:

```text
organization library
canonical resource identity
base upstream revision/fingerprint
changed semantic paths/fields
patch/override payload
organization-owned replacement/addition references
```

It must not store a blind full copy merely to change one property.

### 6.6 `EffectiveLibraryRelease`

Server-resolved, immutable distribution snapshot for a particular accessible library state.

For an organization overlay:

```text
Granete Standard release
        +
organization overlay release
        +
access/package policy
        ↓
EffectiveLibraryRelease
```

SketchUp consumes the effective result. It does not reproduce merge/rebase policy.

Implementations may materialize an explicit DB entity or use an immutable release/build record with equivalent semantics. What is mandatory is a stable effective-release identity and deterministic manifest.

---

## 7. PostgreSQL, JSONB and JSON distribution

Granete must not choose between PostgreSQL and JSON as if they were alternatives.

### 7.1 PostgreSQL owns

- library identities and ownership;
- release lifecycle/audit;
- organization access and entitlements;
- canonical typed resources already present in their domain tables;
- overlay/base relationships;
- conflict state/resolution;
- project-to-release pinning;
- publication metadata;
- queryable/indexed business state.

### 7.2 JSONB is appropriate for

- flexible canonical payloads where the owning domain already models them that way;
- explicit overlay patches/changed-path metadata;
- release/compiler metadata that benefits from structured querying.

JSONB must not be used to hide important relational invariants or bypass typed canonical domains.

### 7.3 Published JSON owns distribution shape

At publish/materialization time, Granete serializes canonical release definitions into deterministic JSON blobs/manifests suitable for the plugin. These artifacts are immutable outputs derived from authoritative server state.

Changing a JSON artifact means publishing a new content hash/release, not editing a file in place and treating it as primary storage.

### 7.4 Large binary assets

SKP models, images, textures, previews and similar binary resources use the existing object/asset storage architecture from `3d-asset-library.md`. PostgreSQL stores descriptors, hashes and authorization-relevant metadata, not large binary payloads.

---

## 8. Publish/materialization pipeline

Publishing is equivalent to compiling a safe immutable library release:

```text
Authoring state in PostgreSQL
        ↓
validate domain invariants
        ↓
resolve exact resource revisions
        ↓
rebase/resolve overlay when applicable
        ↓
validate manufacturing compatibility
        ↓
serialize deterministic canonical JSON
        ↓
collect immutable 3D/other asset descriptors
        ↓
calculate SHA-256 hashes + manifest
        ↓
persist immutable release metadata/artifacts
        ↓
mark release published atomically
```

Published releases must never depend on mutable `latest` lookups.

Validation failures block publication. A failed publication must not partially advance the current release pointer.

---

## 9. Overlay update and conflict rules

### 9.1 Three-way reasoning

When Granete publishes a newer upstream release, rebase an organization overlay using:

```text
OLD BASE      = upstream revision the organization customized
NEW BASE      = newer Granete upstream revision
CUSTOM        = organization override relative to OLD BASE
```

### 9.2 Safe automatic update

If Granete changes a semantic field/resource and the customer has not overridden that same semantic area, the new upstream change can flow into the next effective release.

Example:

```text
customer changes toeKickHeight
Granete fixes hinge drilling
→ safe automatic merge, followed by validation
```

### 9.3 Conflict

If upstream and customer both changed the same semantic area since the recorded base, do not silently choose a new value.

Example:

```text
OLD BASE panelThickness = 18
NEW BASE panelThickness = 19
CUSTOM   panelThickness = 15
→ conflict requiring explicit resolution
```

Until resolved, the currently published customer effective release remains valid/current; the new candidate is blocked from publication/activation.

### 9.4 Customer intent wins over silent replacement

Granete may recommend adopting the upstream value, but no updater can erase an explicit customer manufacturing override without an authorized resolution action and audit trail.

### 9.5 Customer-only resources

Organization-owned modules/resources that do not shadow upstream content remain part of the overlay and carry forward when compatible.

---

## 10. Versioning and compatibility

Use separate concepts:

```text
libraryVersion = content/business evolution (for example 1.16.0)
schemaVersion  = serialized contract understood by clients
minPluginVersion = minimum SketchUp plugin that can interpret the release
```

A plugin that does not support the manifest/resource schema must refuse activation of that release and keep the previous valid compatible release available.

Semantic versioning is recommended for human-visible library versions, but compatibility decisions must be based on explicit schema/capability metadata, not only version-string heuristics.

---

## 11. Manifest contract

The exact schema will be versioned, but a release manifest must provide enough information to determine identity, compatibility and missing content without downloading the full library.

Illustrative shape:

```json
{
  "schemaVersion": 1,
  "libraryId": "6f34...",
  "libraryCode": "1001",
  "libraryVersion": "2.3.0",
  "effectiveReleaseId": "947b...",
  "minPluginVersion": "0.12.0",
  "upstream": {
    "libraryId": "granete-standard-uuid",
    "releaseId": "standard-1.16-release-uuid",
    "version": "1.16.0"
  },
  "resources": [
    {
      "kind": "furniture_definition",
      "id": "stable-resource-uuid",
      "revision": "exact-canonical-revision",
      "definitionHash": "sha256:abc123...",
      "assets": [
        {
          "kind": "preview",
          "sha256": "9128...",
          "size": 384245
        }
      ]
    }
  ]
}
```

The manifest must not contain long-lived storage credentials or secrets. Download authorization remains server-controlled.

---

## 12. Content-addressed distribution and deduplication

Library definitions/distribution blobs are addressed by cryptographic content hash. Existing 3D assets already follow the canonical SHA-256 asset model and must be referenced/reused rather than copied into a second storage system.

Consequences:

- unchanged definitions/assets are reused across releases;
- Free and Standard can reference the same exact objects;
- multiple organization overlays can share unchanged Granete content;
- a release update downloads only missing hashes;
- rollback can reactivate a previously valid release without reconstructing old mutable data.

If 1,000 referenced resources exist and only seven content hashes change, the client should need those seven new objects plus the new manifest/index metadata, not a full monolithic library archive.

---

## 13. Local storage: `LibraryStore` versus `Cache`

The plugin/client must distinguish persistent installed library data from disposable acceleration data.

### 13.1 Persistent `LibraryStore`

Target locations:

```text
Windows: %LOCALAPPDATA%\Granete\LibraryStore
macOS:   ~/Library/Application Support/Granete/LibraryStore
```

Future Linux clients should follow XDG data directories rather than hard-coded home paths.

This location contains installed manifests/content required for offline operation and must not be treated as safely disposable OS cache.

### 13.2 Disposable cache

Target locations:

```text
Windows: %LOCALAPPDATA%\Granete\Cache
macOS:   ~/Library/Caches/Granete
```

Appropriate content includes regenerable thumbnails/previews, temporary downloads and transient indexes that can be rebuilt from the persistent store/server.

### 13.3 Path abstraction

Plugin/application code must resolve platform paths through one abstraction (for example `GranetePaths.library_store`, `GranetePaths.cache`, `GranetePaths.temp`) instead of scattering OS-specific strings.

### 13.4 Suggested local layout

Physical layout is an implementation detail as long as the invariants hold. A useful target is:

```text
LibraryStore/
  manifests/
    <effective-release-id>/manifest.json
  objects/
    sha256/
      ab/<full-hash>
      cd/<full-hash>
  current/
    <organization-id>.json
  index.sqlite                 # optional local search/index projection

Cache/
  previews/
  thumbnails/
  temp/
```

`index.sqlite` is an optional local read/search index. It is never authoritative and must be rebuildable from installed manifests/resources.

For 3D assets, use the canonical asset descriptors/hash identity from `3d-asset-library.md`; do not create a second independent asset identity merely because bytes are materialized locally.

---

## 14. Incremental synchronization state machine

### 14.1 Startup

1. Resolve the current valid local effective release for the active organization.
2. Make that release available to the plugin immediately.
3. If network is available, ask the server for authorized current effective-release metadata.
4. Network failure leaves the current local release usable.

### 14.2 No update

If local and server `effectiveReleaseId` match, no content download is necessary.

### 14.3 Update available

1. fetch the new manifest/metadata;
2. verify schema/plugin compatibility;
3. compare referenced hashes to the local persistent store;
4. download only missing authorized objects/assets to temporary storage;
5. verify size/hash for every downloaded object;
6. materialize/rebuild local index as needed;
7. only when the entire candidate is valid, atomically switch the organization's `current` pointer;
8. keep required pinned content available according to retention policy.

### 14.4 Failure safety

A crash, cancelled download, invalid hash, expired signed URL or lost network connection must leave the previous valid current release untouched.

Retry continues from already verified content-addressed objects; it must not require redownloading valid identical blobs.

---

## 15. Project pinning and historical reproducibility

Every project that depends on library manufacturing behavior must be able to prove the exact effective release used.

Conceptually persist:

```text
projectId
manufacturingLibraryId
effectiveLibraryReleaseId
library/schema compatibility metadata as required
```

The SketchUp model should also carry sufficient Granete metadata to recover the exact project/library context when copied to another machine, for example:

```json
{
  "graneteProjectId": "...",
  "libraryId": "...",
  "libraryReleaseId": "...",
  "effectiveReleaseId": "...",
  "schemaVersion": 1
}
```

This metadata is a reference, not a replacement for server authorization/source of truth.

Opening a project pinned to an older release:

- uses it locally when installed;
- otherwise requests that exact authorized release/content;
- never substitutes current/latest silently.

A user may explicitly migrate/update a project through a future controlled workflow, which must show/validate relevant changes and create an auditable new project/revision state.

---

## 16. Rollback, withdrawal and retention

Publishing a broken manufacturing release must be recoverable without mutating history.

- mark/withdraw the problematic release for new/current selection according to policy;
- point current eligible consumers back to a previous valid release or publish a corrective release;
- keep already pinned historical references resolvable where business/legal/manufacturing history requires them;
- local garbage collection deletes only content not referenced by current, pinned or retention-protected releases.

A withdrawn release is not equivalent to deleting immutable content needed to explain historical work.

---

## 17. Permissions and editing model

Suggested manufacturing-library capabilities/roles include:

| Capability | Designer | Library Editor | Library Engineer/Admin |
|---|---:|---:|---:|
| Use published library | yes | yes | yes |
| Edit draft organization overrides | no | yes | yes |
| Resolve manufacturing conflicts | no | policy | yes |
| Validate/publish organization release | no | no/policy | yes |
| Change upstream/private-fork policy | no | no | yes |

Exact role mapping must use Granete's organization capability system rather than introducing a separate auth system.

For the first commercial phase, Granete internal/admin tooling may own customer-library configuration. A customer self-service library editor is intentionally later so we learn real factory requirements before exposing a large authoring surface.

---

## 18. Free/Standard entitlements

Free must not be implemented as a second hand-maintained catalog copy.

Server-authoritative package/entitlement resolution decides which entries are exposed in the effective release. Shared entries reference the same canonical revisions and immutable assets.

Do not put authorization solely in plugin-side flags. A modified client must not gain access to Standard-only manifests/resources by guessing IDs/hashes.

---

## 19. Interaction with factory → store catalog publication (`#454`)

The two versioned systems solve different boundaries:

```text
Granete Standard
      ↓ upstream/rebase
Factory Manufacturing Library
      ↓ immutable manufacturing release
Factory commercial publication (#454)
      ↓ subscription
Store catalog + StoreCatalogOverlay
```

`#454` can reference stable manufacturing/product revisions as its source, but a subscribed store does not become owner/editor of the producer's `ManufacturingLibrary`.

A store's sales overlay remains non-manufacturing. A factory's organization manufacturing overlay is upstream of what the factory chooses to publish commercially.

Do not merge these models merely because both use manifests/releases/overlays.

---

## 20. Observability and audit requirements

At minimum, Granete must be able to answer:

- who published a release and when;
- which upstream/base release it used;
- which organization overrides participated;
- whether conflicts were resolved and by whom;
- manifest/content fingerprint;
- which effective release a project/revision pinned;
- why a client did not activate an offered release (schema/plugin incompatibility, authorization, validation/download failure, etc.).

Logs/telemetry must not expose signed storage credentials or sensitive manufacturing payloads unnecessarily.

---

## 21. Implementation sequence

The architecture is intentionally phased to reduce rework/token cost.

### Phase 1 — domain/release foundation

- `ManufacturingLibrary` identity/code/kind/upstream;
- immutable `LibraryRelease` contract;
- exact references to existing canonical resource revisions;
- project/effective-release pinning contract;
- package/entitlement hooks;
- migration path for current global/default library behavior.

### Phase 2 — publisher/distribution

- release validator/materializer;
- deterministic manifest;
- canonical JSON definition artifacts;
- hash computation;
- reference existing 3D asset storage;
- compatibility metadata;
- publish/withdraw/rollback semantics.

### Phase 3 — SketchUp persistent local store

- OS path abstraction;
- persistent `LibraryStore` separate from disposable `Cache`;
- manifest comparison;
- hash-verified incremental downloads;
- atomic activation;
- offline startup;
- pinned-release retention/recovery;
- optional rebuildable SQLite index.

### Phase 4 — organization overlays and safe upstream updates

- overlay/base tracking;
- customer-only resources;
- three-way conflict detection;
- effective release materialization;
- internal Granete admin workflow for first customers;
- update/changelog/conflict visibility.

### Later — not a prerequisite for first sale/demo

- customer self-service library editor;
- private-fork lifecycle/import tooling;
- manufacturer/marketplace distribution;
- advanced release rollout rings;
- generalized multi-device prefetch policy.

---

## 22. Explicit non-goals

This architecture does **not**:

- replace PostgreSQL with JSON files;
- replace typed canonical resource domains with one universal JSON item database;
- move `Resolve Furniture` logic into SketchUp;
- create a second 3D asset storage engine;
- allow published releases to be edited in place;
- auto-update historical projects;
- let a `StoreCatalogOverlay` modify manufacturing;
- solve the full factory-to-store publication flow already owned by `#454`;
- require the customer self-service library editor in the MVP;
- require marketplace/manufacturer catalogs now.

---

## 23. Definition of Done for the platform foundation

The foundation is considered coherent when all of the following are true:

- Granete Standard and Free can share canonical resources without duplicated definitions;
- a workshop/factory can be assigned an organization-specific manufacturing library identity;
- an organization overlay can retain its explicit manufacturing differences while receiving non-conflicting upstream corrections;
- conflicting upstream/customer changes cannot silently overwrite either side;
- published releases are immutable and deterministic;
- every effective release has a versioned manifest and content fingerprints;
- SketchUp can use an already installed valid library offline;
- an update downloads only missing content and activates atomically after verification;
- old projects remain pinned to their exact effective release;
- binary assets reuse the existing content-addressed asset architecture;
- Free/Standard authorization is server-authoritative;
- cross-org store publication remains clearly separated from manufacturing-library inheritance.

Until these invariants are implemented, agents must not introduce shortcuts that create per-customer full catalog clones or mutable `latest` dependencies in manufacturing/project history.
