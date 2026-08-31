# Granete for SketchUp — Backend and React Integration Excellence

Status: **Canonical cross-surface implementation contract**  
Program: #465  
Related authorities: #384, #446/#462, #413, #496–#504  
Date: 2026-08-30 America/Mexico_City

## 1. Purpose

This document defines how **Granete for SketchUp**, the Go backend/domain and the React application form one product rather than three partially connected applications.

The target is not a cheaper Promob clone, a generic SketchUp cut-list extension or a second browser CAD implementation. Granete must become the ideal system for small and medium furniture factories and their commercial networks by combining:

- professional SketchUp authoring;
- server-authoritative manufacturing truth;
- stable physical furniture identity;
- exact design/commercial revisions;
- production release and machine evidence;
- multi-organization factory/store/installer workflows;
- a React operational workspace that makes the complete digital thread understandable.

The product invariant is:

> **SketchUp owns authoring and host interaction. Granete owns business identity, catalog resolution, manufacturing truth, revisions, release and machine output. React owns administration, visibility and explicit business workflows.**

No layer may become a shadow implementation of another layer's authority.

## 2. Product differentiation

Useful market patterns may be learned from professional furniture-design tools without copying proprietary UI or architecture:

- contextual selection and property editing;
- visual libraries and rapid insertion;
- controlled internal-component authoring;
- intelligent hardware placement;
- manufacturing inspection;
- batch editing;
- predictable upgrades;
- cloud catalog/version management.

Granete must differentiate through capabilities that a host-only plugin cannot safely provide:

```text
Quote / Project
→ Project-owned FurnitureInstance
→ Design working copy
→ SketchUp professional authoring
→ authoritative resolve and preflight
→ immutable DesignRevision + artifacts
→ reconciliation and explicit requote
→ approval + exact ProductionRelease
→ MachineProfile/PostprocessorAdapter
→ production / installation / closeout
```

The plugin experience should feel direct and fast. The underlying truth must remain explicit, versioned and auditable.

## 3. One product, three primary surfaces

### 3.1 SketchUp

SketchUp owns:

- viewport, camera and selection;
- inference, placement preview and snapping;
- precise authoring input;
- semantic direct manipulation of supported internals and hardware;
- read-only manufacturing overlays;
- host entity lifecycle;
- one coherent undo/redo unit;
- save/reopen technical locators and model binding.

SketchUp does **not** own:

- Project/FurnitureInstance business identity creation except through server commands;
- BOM, productive thickness, joints, derived drilling or nesting;
- reconciliation;
- approval or ProductionRelease;
- MachineProfile/postprocessor rules;
- support claims.

### 3.2 Go backend and shared domain

Granete backend/domain owns:

- tenant and organization scope;
- catalog definitions, versions, hashes and semantic bindings;
- typed parameter validity/defaults/consumers;
- physical `FurnitureInstance` identity;
- Design/DesignRevision/manifest/artifact validation;
- relationships, hardware compatibility and manufacturing features;
- authoritative layout/resolve/preflight;
- reconciliation/change classification;
- approval/release;
- machine capabilities/adapters/artifacts;
- permissions, idempotency, concurrency, audit and evidence.

### 3.3 React application

React owns the user experience for:

- catalog and typed-parameter administration;
- Projects, quotes and physical furniture visibility;
- Designs and exact revision history;
- artifacts and previews;
- reconciliation and explicit requote;
- approval and release commands;
- MachineProfile/evidence/output operations;
- organization/team/network/platform workflows;
- support/audit views where authorized.

React does not calculate or persist a parallel manufacturing/reconciliation model.

## 4. Current validated baseline

The following are delivered foundations, not future aspirations:

- architecture/manufacturing boundary #344;
- extension bootstrap #345;
- semantic metadata and roundtrip #346;
- relationship/joint-driven machining #356;
- authoritative preflight #347;
- parametric furniture domain baseline #349;
- HardwarePlacement domain baseline #350;
- effective material thickness and role propagation #402–#405;
- authoritative local part transform #414;
- native managed ComponentInstance hierarchy #415;
- real-host/OpenCutList evidence #417;
- semantic SelectionContext and capability inspector #476;
- rich versioned authoring resolve TS↔Go↔Ruby #477;
- typed parameter definitions/bindings #483/#486.

The remaining work is product interaction, generated API unification, Project/Design persistence, Web operations, security, evidence and commercial support.

## 5. Cross-surface identity model

Never collapse these namespaces:

```text
organizationId
projectId
designId
designRevisionId
quoteRevisionId
productionReleaseId

furnitureInstanceId
furnitureDefinitionId
componentInstanceId
componentDefinitionId
catalogComponentId
hardwarePlacementId
hardwareDefinitionId
relationshipId
jointPlacementId

SketchUp persistent_id
SketchUp entityID
SketchUp definition GUID
clientEntityLocator
```

Hard rules:

- `furnitureInstanceId` is Project-owned physical identity.
- `QuoteLine.quantity` is commercial grouping, not physical identity.
- `componentInstanceId` is one concrete occurrence.
- `componentDefinitionId` is reusable authoring-definition identity.
- `hardwarePlacementId` is its own placement namespace.
- SketchUp host IDs are locators only.
- name, dimensions, transform, geometry similarity and array order are never primary identity.
- copy of a managed physical unit requires new server business identity.
- changing parameters/materials/position normally preserves the physical identity across revisions.

## 6. Canonical API and schema stack

#496 owns the generated cross-surface API boundary.

### 6.1 Source hierarchy

A valid repository organization may be modular, but there is one assembled/drift-checked public contract:

```text
OpenAPI shared authority
├── organization/session contracts
├── furniture/catalog/layout contracts
├── authoring/preflight contracts
├── Project/Design contracts after Gate A
└── machine/artifact contracts

Referenced JSON Schemas
├── granete.sketchup-authoring-resolve.v1
├── layout/transform contracts
├── manifest contracts
└── future diagnostic/artifact manifests
```

### 6.2 Generated and validated clients

- TypeScript clients/types are generated and runtime-validated at untrusted boundaries.
- Go public DTO/handler types are generated or mechanically checked against the same authority.
- Ruby consumes strict schema identity/version/closed-shape adapters and shared fixtures.
- React never adds handwritten `fetch` + `as SomeDto` for these surfaces.
- Unknown schema/capability/version fails before host/browser state mutation.

### 6.3 Error and issue relationship

The generic API error envelope and structured authoring/preflight issues must be intentionally related, not flattened by message parsing.

Required stable concepts include:

```text
code
message                    # presentation, not behavior authority
requestId
traceId when exposed safely
messageId/correlationId
retryable
details                    # bounded/allowlisted
entityId / semantic target
path
remediation
severity
```

Behavior branches on codes and state, never localized copy.

### 6.4 Concurrency and idempotency

- Creates/commands use `Idempotency-Key` when retries can duplicate effects.
- Mutable resources use version/ETag + `If-Match` where applicable.
- Design publication pins `baseRevisionId`.
- Stateless authoring resolve remains deterministic and side-effect free.
- No endpoint uses implicit `latest` for approval/release-sensitive operations.

## 7. Catalog and typed parameter lifecycle

#497 completes the operational path delivered by #483/#486.

Canonical flow:

```text
React authors FurnitureDefinition
→ typed parameter definitions and semantic bindings
→ backend validates and versions/hash-pins definition
→ React previews through authoritative resolve
→ SketchUp refreshes the same definition/revision
→ inspector renders controls from the definition
→ user submits authoring intent
→ Go normalizes/resolves it
```

React may validate input usability but cannot own parameter behavior.

Rules:

- explicit `false` and empty string are preserved;
- parameter names do not imply consumers;
- bindings target stable semantic IDs;
- ambiguity fails closed instead of selecting the first component;
- destructive/incompatible definition evolution shows impact and uses concurrency control;
- published/pinned historical definitions are not silently rewritten.

## 8. Shared SketchUp host interaction runtime

#498 is the mandatory shared runtime for #466–#471.

### 8.1 Modular dialog boundary

The current HtmlDialog must evolve from a monolithic resource into explicit modules for:

- bridge/callback validation;
- session/catalog/selection state;
- mutation state;
- preflight state;
- inspector/internal/hardware/preflight views;
- error/degraded-state presentation.

A framework rewrite is not required. Modular vanilla JavaScript is acceptable.

### 8.2 Authoring mutation sequence

All managed authoring commands use one coordinator:

```text
capture exact SelectionContext and accepted snapshot
→ assign correlation/message identity
→ enter resolving
→ submit #477 through #496
→ reject malformed/stale/superseded result
→ prepare assets/definitions
→ start one SketchUp operation
→ apply complete accepted native hierarchy
→ write accepted metadata
→ restore semantic selection/context
→ invalidate/refresh preflight and overlays
→ commit
```

On any failure:

```text
abort / do not start operation
→ preserve previous valid hierarchy and metadata
→ show exact failure category/remediation
```

Feature-specific shelf/hardware commands plug into this coordinator. They do not clone it.

### 8.3 State model

At minimum distinguish:

```text
idle
selecting
editing_intent
resolving
applying_host_mutation
committed
rejected
cancelled
unavailable
stale
```

Late responses cannot apply to a newer selection/command.

## 9. Professional SketchUp loop

### 9.1 Preflight #466

SketchUp presents authoritative:

```text
ready | warning | blocked | stale | unavailable
```

with grouped issues, semantic targets, remediation and viewport navigation. It never derives readiness from local dimensions or form validity.

### 9.2 Internal authoring #467

Supported operations include:

- precise/constrained move;
- add occurrence;
- duplicate occurrence;
- remove occurrence;
- reviewed joinery intent where supported.

Each occurrence keeps exact identity and dependent relationships/machining.

### 9.3 Hardware authoring #468

Supported manual placement fields and substitutions come from capability/domain contracts. Derived placements remain read-only regarding resolved coordinates.

Compatibility, visual asset, BOM and drilling consequences come from Granete.

### 9.4 Placement, overlays and batch #469–#471

- Placement uses host inference/preview and commits only reviewed spatial intent.
- Manufacturing overlays are ephemeral/read-only and preserve provenance.
- Batch selection distinguishes common/mixed/unsupported values and uses explicit atomicity.
- Durable Project/room scopes wait for Digital Thread persistence.

## 10. Degraded/offline behavior

#498 provides minimum fail-closed mutation guards. #474 owns the complete cache/reconnect product.

Canonical states include:

```text
resolved_current
resolved_stale
unresolved_preview
offline_cached
sync_required
blocked_incompatible
```

Rules:

- connectivity loss reduces convenience, never truth guarantees;
- previous valid resolved furniture remains inspectable and marked honestly;
- no generic box/local 18 mm fallback becomes productive managed state;
- no local Project business IDs are later presented as server authority;
- no green ready/publish/release state without current authoritative context;
- reconnect never deletes the previous valid hierarchy before new acceptance.

## 11. Foundation Gate A and persistent Digital Thread

Gate A #462 must close before new persistent business families such as #385.

Before Gate A, allowed work includes:

- stateless generated furniture API #496;
- host runtime #498;
- catalog editor #497 against existing catalog persistence;
- professional host UX #466–#471;
- migration/performance/compatibility/degraded/support work that invents no business identity.

After Gate A, follow #384:

```text
#385 Project FurnitureInstance
→ #386 QuoteLine ↔ physical units
   + #387 Design/DesignRevision
→ #388 SketchUp model binding
→ #499 secure Web↔SketchUp pairing
→ #389 Project Furniture panel/place existing
→ #390 connected catalog insertion
→ #391 duplicate identity handling
→ #392 publication + artifacts
→ #393 reconciliation
→ #394 explicit requote/change classification
→ #395 exact approval/ProductionRelease
→ #397 existing SKP adoption
→ #398 Digital Thread E2E
```

No `SketchUpProject`, local shadow Project store or alternate identity is permitted.

## 12. Secure Web-to-SketchUp pairing

#499 owns cross-product handoff.

Recommended flow:

```text
React exact Project/Design/base revision
→ create short-lived one-time pairing grant
→ browser deep-link attempt + copy-code fallback
→ SketchUp exchanges using its own client/session boundary
→ backend returns exact authorized context/capabilities
→ #388 validates and writes model binding
```

Security requirements:

- opaque, one-time, short TTL, exact scope;
- cross-org denial;
- replay/expiry/revocation;
- no web JWT or device credential in custom URI/query;
- no success merely because the browser invoked a deep link;
- failed pairing/rebind preserves existing valid binding;
- rebind inventories managed identities and routes adoption/reconciliation explicitly.

## 13. Progressive React Digital Thread workspace

#396 is the tracker.

### 13.1 Project Furniture #500

As soon as #385/#386 exist, React exposes physical-unit traceability:

- quantity > 1 as distinct units;
- exact QuoteRevision context;
- pending/placed/modified projections;
- origin/provenance;
- authorized actions;
- tenant-safe generated read model.

### 13.2 Designs/revisions/artifacts #501

After #387/#392:

- multiple Designs/alternatives;
- immutable R1/R2/... lineage;
- exact old-revision selection;
- preview and artifact metadata/integrity;
- secure resource access;
- publish progress/conflicts;
- exact #499 SketchUp handoff.

Browser does not parse `.skp` as semantic truth.

### 13.3 Reconciliation/approval/release #502

After #393–#395:

- unit-level reconciliation by `furnitureInstanceId`;
- domain-provided change classification;
- explicit new QuoteRevision from chosen differences;
- authoritative preflight;
- approval with exact contexts;
- immutable ProductionRelease pins;
- later R2 never retargets an R1 release.

React does not compare arbitrary JSON to determine commercial/manufacturing impact.

## 14. Machine profiles, evidence and output

Manufacturing output remains outside SketchUp and React calculation.

```text
#348 real import/readback
→ #351 MachineProfile/PostprocessorAdapter
→ #352/#353 independent evidence packs
→ #503 React machine/evidence/artifact workspace
→ #354 deterministic real-host/manufacturing gate
→ #355 commercial release readiness
```

#503 provides factory UX for exact:

- machine/controller/software version;
- profile revision;
- adapter version/digest;
- evidence classification;
- ProductionRelease/fingerprint;
- output status/artifact/checksum.

One evidence pack never validates another client/software version. Opening a file is not readback validation.

## 15. Session, authorization and media

#460 owns the final session model.

Requirements:

- separate client/session types for web, mobile, SketchUp and support;
- SketchUp least privilege and revocation;
- no credential interchange between clients;
- bounded absolute session policy;
- membership/org suspension cuts access;
- explicit authoring capabilities;
- no generic session JWT in media/artifact/deep-link query strings;
- resource-scoped media/artifact access;
- compatibility/license/session failure never mutates valid model state.

React server-state keys derive from a validated session projection and distinguish each actual login/session generation without including secrets.

## 16. Audit, observability and support diagnostics

#461 owns durable audit/request/trace correlation. #504 owns the plugin support bundle.

A support bundle is:

- explicit-consent;
- previewable;
- versioned and size bounded;
- allowlist-based;
- locally generated by default;
- correlated through sanitized request/trace/message IDs.

It excludes credentials, cookies, pairing grants, signed URLs, private paths, personal/customer data, geometry, BOM and machining payloads.

Automatic background upload is prohibited. Any future upload is resource-scoped, audited and retention-controlled.

## 17. Performance, compatibility, migration and release

### 17.1 Legacy migration #416

Group → native ComponentInstance migration preserves known identity, intent and transform, validates replacement before deletion, is undoable and never invents missing Project identity.

### 17.2 Performance #472

Measure 10/50/100/300 furniture fixtures before optimizing. Correct identity isolation beats speculative shared mutable definitions.

### 17.3 Compatibility #473

Support states are only:

```text
supported | tested | best_effort | unsupported
```

Every supported row has real host/OS/RBZ/API evidence. macOS evidence does not imply Windows support.

### 17.4 Commercial release #355

Requires signed/verifiable RBZ, exact checksum/version, stable/beta channels, staged rollout, rollback/kill switch, migration policy, supported matrix, secure sessions/media, safe degraded behavior and privacy-safe diagnostics.

## 18. Canonical end-to-end scenario

The complete product must prove:

```text
1. React admin authors typed FurnitureDefinition parameters/bindings.
2. Catalog revision is validated/versioned.
3. Seller creates Project + QuoteRevision; qty=2 becomes FI-001/FI-002.
4. React Project Furniture shows both physical units.
5. User securely pairs exact Project/Design with SketchUp.
6. SketchUp places existing FI identities.
7. User selects/moves/adds/removes a shelf.
8. Granete re-resolves relationships/machining; host rebuild is atomic.
9. User moves hinge into conflict.
10. Preflight blocks and navigates exact hardware/host context.
11. User corrects/replaces hardware; unrelated machining stays unchanged.
12. Preflight becomes ready only from Granete.
13. Publish immutable R1 + manifest/SKP/preview/checksums.
14. React reconciliation compares exact QuoteRevision and R1.
15. Explicit new draft QuoteRevision absorbs selected difference.
16. Approve/release exact R1 + manufacturing fingerprint.
17. Select validated MachineProfile/adapter; generate exact artifact.
18. Publish R2 later; R1 release remains pinned.
19. Copy creates a new Project FurnitureInstance.
20. Unmanaged decoration never enters manifest/BOM.
21. Save/reopen/migration preserve identity.
22. Support diagnostics remain private and correlated.
```

## 19. Verification layers

Every issue declares applicable proof:

```text
[ ] domain unit/fixture
[ ] Go API/storage/RLS
[ ] OpenAPI/JSON Schema generation/drift
[ ] React component/server-state
[ ] Ruby adapter
[ ] HtmlDialog/interaction
[ ] shared parity/golden
[ ] real-host TestUp
[ ] browser + real PostgreSQL E2E
[ ] real machine/software readback
[ ] docs/ledger/readback
```

A required layer cannot be skipped and still reported green.

## 20. Forbidden shortcuts

- handcrafted parallel DTOs after #496;
- React manufacturing/reconciliation engine;
- Ruby drilling/thickness/joint tables;
- direct raw face/hole productive editing;
- selection by name/geometry/persistent ID;
- `selection.first` as batch truth;
- deleting valid geometry before resolve succeeds;
- late response applying to a newer command;
- web JWT in SketchUp pairing/media URL;
- local Project IDs later accepted as server identity;
- browser `.skp` parsing as DesignRevision source;
- implicit latest approval/release;
- machine compatibility inferred from brand;
- support bundle with tokens/private paths/model data;
- closing host UX from a pure domain helper.

## 21. Global Definition of Done

Granete for SketchUp reaches cross-surface excellence when a real workshop can administer the catalog in React, author professionally in SketchUp, preserve Project-owned identity, publish and understand exact revisions, reconcile/approve/release in React, generate evidence-backed machine artifacts, operate safely across organizations, update/migrate/diagnose the plugin and prove the whole path with real browser/PostgreSQL/SketchUp/machine evidence—without any duplicated business or manufacturing authority.