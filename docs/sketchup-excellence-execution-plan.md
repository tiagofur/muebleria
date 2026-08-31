# Granete for SketchUp — Excellence Execution Plan

Status: **Canonical live execution order**  
Program: #465  
Umbrella: #290  
Digital Thread: #384  
Foundation gates: #446/#462  
Cross-surface contract: `docs/architecture/sketchup-backend-web-integration-excellence.md`  
Reconciled: 2026-08-30 America/Mexico_City

## 1. Goal

This plan orders the work required to turn the validated Granete for SketchUp technical baseline into a professional, differentiated and commercially supportable product fully integrated with the Go backend and React application.

Execution rules:

> Build shared identity, generated transport and host mutation foundations once. Never let each feature invent its own selection model, payload, dialog store, rollback path, business identity or manufacturing shortcut.

> SketchUp owns authoring and host interaction. Granete owns business identity, catalog/manufacturing truth, revisions, release and machine output. React owns administration, visibility and explicit business workflows.

## 2. Existing baseline — do not rebuild

Completed and validated foundations:

| Area | Authority |
|---|---|
| Architecture/manufacturing boundary | #344 / ADR-0001 |
| Extension bootstrap | #345 |
| Semantic metadata/roundtrip | #346 |
| Part relationships/joint machining | #356 |
| Authoritative preflight | #347 |
| Parametric furniture/domain baseline | #349 / ADR-0002 |
| HardwarePlacement domain baseline | #350 |
| Material-aware resolution/parity | #402–#405; #401 closed |
| Native local transforms | #414 |
| Native ComponentInstance renderer | #415 / ADR-0004 |
| Real-host native/OpenCutList validation | #417 |
| Semantic SelectionContext/inspector | #476 |
| Versioned rich authoring resolve | #477 |
| Typed parameter definitions/bindings | #483/#486 |

Historical closure of #349/#350 proves domain/contract capability, not the complete professional SketchUp interactions promised by #467/#468.

## 3. Current repository execution policy

F199/#458 closed on 2026-08-31: tracker PR #493 merged as `35bbfc07` after exact-SHA review and green CI. No runtime feature is currently active.

Repository rule:

- do not mark #496–#504 or another runtime feature `in_progress` without following the single-active-feature policy and program coordination;
- documentation, review, contract design, fixtures and dependency preparation may proceed;
- no new persistent business family starts before Gate A #462.

Current immediate chain:

```text
correct/integrate #494
→ complete remaining #458 slices in #493
→ close #458
→ critical #460/#461 portions
→ execute Gate A #462
```

## 4. Completed historical Wave 0/1

The former documentation/foundation gate is complete:

- canonical excellence documentation exists;
- #476 SelectionContext is closed;
- #477 rich authoring resolve is closed;
- typed parameter delivery #483/#486 is merged.

No agent may continue treating #475 as a draft implementation blocker or recreate #476/#477 from memory.

## 5. New cross-surface foundations

When active-feature governance permits the next implementation slices, start with the two independent foundations below.

| Order | Issue | Delivery | Gate boundary |
|---:|---:|---|---|
| X0 | #496 | Generated furniture/catalog/layout/authoring/Design API authority | Current stateless endpoints may advance before Gate A; persistent Design operations after Gate A |
| X1 | #498 | Shared modular HtmlDialog/host interaction runtime, atomic mutation, correlation, rollback/undo and minimum degraded guards | May advance before Gate A |
| X2 | #497 | React typed parameter-definition and semantic-binding editor | Final transport consumes #496; existing catalog persistence only before Gate A |

### Parallelism

```text
#496 generated contract      #498 shared host runtime
          ↓                             ↓
       #497                     #466/#467/#468
```

#496 and #498 solve different boundaries and may run in parallel only when repository governance explicitly allows it.

### #496 proof target

```text
GET definitions
GET resolved layout
POST rich authoring resolve
→ one generated/drift-checked OpenAPI + referenced JSON Schema authority
→ Go/TypeScript/Ruby accept/reject the same fixtures
→ React uses generated client, no handwritten casts
```

No Project/Design records are created by current stateless resolve.

### #498 proof target

```text
select exact managed context
→ submit correlated authoring intent
→ reject stale/late/malformed response
→ atomic native rebuild
→ metadata + selection + preflight update
→ one undo action
→ domain rejection/host exception preserves previous valid state
```

#467 and #468 may not create separate mutation coordinators.

## 6. Professional correction and authoring loop

After the applicable #496/#498 foundations:

| Order | Issue | Delivery | Required reuse |
|---:|---:|---|---|
| A1 | #466 | Authoritative preflight review + viewport navigation | #476 + #496 + #498 |
| A2 | #467 | Direct internal component authoring | #476 + #477 + #498 |
| A3 | #468 | HardwarePlacement editing/substitution | #476 + #477 + #498; reuse #467 infrastructure |

#466 may deliver review/navigation before all correction editors exist, then add context actions as #467/#468 land.

### Mandatory Wave 2 demo

```text
select one concrete shelf
→ move precisely
→ add/duplicate/remove supported shelf
→ Granete re-resolves relationships and machining
→ create real hinge/shelf conflict
→ preflight shows blocker and navigates exact semantic context
→ move or replace hinge
→ unrelated machining remains unchanged
→ ready only when Granete returns ready
→ undo/redo
→ save/reopen
```

Required evidence:

- generated contract/shared schema tests;
- TS/Go domain/API integration as applicable;
- Ruby adapter and Node/HtmlDialog tests;
- rollback and forbidden-shortcut proof;
- real SketchUp TestUp for selection, interaction, operation, undo and save/reopen.

## 7. Daily-use productivity

After the professional mutation/review loop is stable:

| Issue | Delivery | Coordination |
|---:|---|---|
| #469 | Constraint-aware placement, snapping and repeat | native hierarchy; connected business identity later via #390 |
| #470 | ManufacturingFeature overlay/provenance | reuse #466 navigation and #498 accepted-state invalidation |
| #471 | Multi-select/batch editing | reuse #498 atomicity; durable scopes wait #384 |

### Wave 3 demo

```text
place cabinets through preview/snap
→ multi-select and show common/mixed/unsupported values honestly
→ batch-change one compatible material/parameter
→ inspect drilling/groove/edge provenance read-only
→ no Ruby/React manufacturing rule
```

## 8. Host robustness and commercial support foundations

These issues may run when their prerequisites/resources allow, without inventing persistent Project identity:

| Issue | Delivery |
|---:|---|
| #416 | Legacy Granete Group → native ComponentInstance migration |
| #472 | Measured large-project performance/definition lifecycle |
| #473 | Real macOS/Windows/SketchUp compatibility matrix |
| #474 | Complete offline/cache/reconnect/pending-intent safety |
| #504 | Privacy-safe correlated diagnostic/support bundle |

Coordination:

- #498 owns minimum shared fail-closed state/mutation guards; #474 owns the complete degraded/offline product;
- #413 remains open only until #416 completes its migration DoD;
- #472 measures 10/50/100/300 furniture before optimizing;
- #473 support claims require exact host evidence;
- #504 consumes #460/#461/#496 correlation/security and never uploads automatically.

## 9. Foundation Gate A boundary

### May advance before Gate A

Provided no new persistent business family is created:

- #496 current stateless furniture API contract;
- #497 current catalog parameter administration;
- #498 shared host runtime;
- #466–#471 host/working-authoring UX;
- #416 representation migration;
- #472/#473 host evidence;
- #474 degraded mechanics;
- #504 local diagnostic schema/UX.

### Must wait for Gate A #462

- #385+ Project FurnitureInstance/Design persistent families;
- runtime Project/Design model binding/pairing in #388/#499;
- #500–#502 Project/Design React read models and commands;
- durable Project/room defaults;
- publication/reconciliation/approval/release persistence.

Forbidden bypasses:

- temporary SketchUp-only Project/Design tables;
- local productive IDs later accepted as server truth;
- a `SketchUpProject` aggregate;
- React/localStorage shadow Project defaults presented as durable business state.

## 10. Digital Thread after Gate A

Follow #384 without shortcuts:

```text
#385 stable Project FurnitureInstance
→ #386 QuoteLine ↔ physical units
   + #387 Design + immutable DesignRevision
→ #388 SketchUp Project/Design binding
→ #499 secure Web↔SketchUp pairing
   + #389 Project Furniture panel/place existing
→ #390 connected catalog insertion creates Project FI
→ #391 duplicate managed identity handling
→ #392 publish immutable revision + artifacts
→ #393 reconciliation
→ #394 impact classification + explicit requote
→ #395 approval + exact ProductionRelease
→ #397 existing SKP adoption
→ #398 global E2E
```

#396 is the React tracker, delivered progressively instead of one late oversized issue:

```text
#385/#386
→ #500 Project Furniture physical-unit matrix

#387/#392
→ #501 Designs/revision/artifact history

#393/#394/#395
→ #502 reconciliation/approval/release
```

### Pairing and binding

#499 creates/exchanges a short-lived one-time exact-scope grant through the dedicated SketchUp client boundary. #388 validates and writes the model binding.

Never place a reusable web/SketchUp credential in a custom URI/query. Deep-link invocation alone is not confirmed success.

## 11. Cross-surface behavior after Digital Thread

Existing host work adapts rather than being replaced.

### Selection/inspector

#476 gains Project/Design/revision context while preserving component/hardware identity.

### Authoring resolve

#477 semantic intent becomes or backs the Design working-copy command contract. Do not add a competing authoring model.

### Placement

```text
local/unconnected compatibility mode
→ explicit non-server compatibility identity/state

connected Project mode
→ #390 obtains server FurnitureInstance before productive placement
```

### Copy

#391 allocates new business identity. SketchUp `make_unique` only isolates host definitions.

### Delete

Connected delete follows Design/Project business lifecycle, not only `erase_entities`.

### Publish/preflight

#466/#392/#502 use exact revision/fingerprint context and never implicit latest.

## 12. React integration order

### Catalog administration

#497 closes the operational gap created by typed parameter delivery:

```text
React authors/validates parameter definitions/bindings
→ backend versions/hashes them
→ authoritative preview
→ SketchUp consumes the same catalog definition
```

### Project Furniture #500

Proves:

- quantity > 1 yields distinct physical units;
- exact QuoteRevision context;
- no global mega-status;
- generated tenant-safe read model.

### Designs/revisions #501

Proves:

- multiple Designs;
- immutable R1/R2 lineage;
- old revision view never silently uses latest;
- artifact integrity/resource-scoped access;
- exact #499 handoff.

### Reconciliation/release #502

Proves:

- matching by `furnitureInstanceId`;
- server-provided classification;
- explicit new QuoteRevision;
- authoritative preflight;
- exact immutable ProductionRelease;
- R2 never retargets R1 release.

React never parses `.skp` or compares arbitrary JSON to decide manufacturing/commercial impact.

## 13. Machine evidence and Web operations

Execution path:

```text
#348 PTX import/readback on exact machine/software
→ #351 MachineProfile/PostprocessorAdapter
→ #352/#353 independent evidence packs
→ #503 React machine/evidence/manufacturing-artifact workspace
→ #354 real-host + manufacturing-output regression gate
→ #355 commercial packaging/licensing/update/rollback
```

#503 provides factory UX; #351/#354 remain industrial authority.

No machine compatibility from brand/model name. Every claim pins:

- machine/controller/software version;
- profile revision;
- adapter ID/version/digest;
- DesignRevision/ProductionRelease/fingerprint;
- evidence pack/checksum/limitations.

## 14. Security, audit and diagnostics

### #460 sessions/media

Required:

- separate web/mobile/SketchUp/support clients;
- revocable least-privilege SketchUp session/device;
- explicit authoring capabilities;
- bounded absolute session;
- no generic bearer token in media/artifact/pairing URLs;
- non-secret session identity/generation for React cache isolation.

### #461 audit/observability

Correlate browser, backend and SketchUp operations through bounded IDs/codes without logging full authoring payloads, geometry, BOM, machining or secrets.

### #504 support bundle

Local, explicit-consent, previewable and allowlisted. Excludes credentials, cookies, pairing grants, signed URLs, PII/customer data, private paths, geometry, BOM and machining. No automatic upload.

## 15. Strengthened E2E gates

### #354 focused host/manufacturing gate

Requires real #466/#467/#468 interactions, #498 rollback/undo, exact revisions/releases and real machine readback. #349/#350 helpers alone are insufficient.

### #398 global Digital Thread gate

Consumes:

- #354 host/output evidence;
- #499 secure pairing;
- #500 physical-unit Web behavior;
- #501 revision/artifact Web behavior;
- #502 reconciliation/release Web behavior.

Avoid dependency cycle: #354 may close before #398; #398 consumes its evidence.

## 16. PR layering rule

Every implementation PR declares applicable layers:

```text
[ ] domain
[ ] Go backend/API/storage/RLS
[ ] generated OpenAPI/JSON Schema
[ ] React UI/server state
[ ] Ruby host/adapter
[ ] HtmlDialog/interaction
[ ] shared fixture/parity
[ ] real-host TestUp
[ ] browser + real PostgreSQL E2E
[ ] real machine/software readback
[ ] docs/ledger/readback
```

A cross-surface issue cannot close because only one layer exists.

Each plan/PR answers:

1. exact semantic/business entity;
2. stable ID;
3. authoring intent vs resolved manufacturing vs view-only;
4. authority and generated contract reused;
5. Gate A/persistence/session/capability dependency;
6. concurrency/idempotency/correlation;
7. failure/rollback/undo;
8. positive proof;
9. forbidden-shortcut negative proof;
10. required host/browser/database/machine evidence;
11. privacy/audit impact;
12. React/backend/SketchUp integration required by the issue.

## 17. Required negative-proof pattern

Every child adds at least one test that fails against the shortcut it exists to prevent.

Examples:

- #496: OpenAPI and authoring JSON Schema diverge;
- #497: React infers a parameter consumer from its name;
- #498: late response applies to newer selection or host exception leaves mixed state;
- #466: local form validity becomes manufacturing ready;
- #467: two shelves share occurrence identity/direct face edit;
- #468: Ruby drilling table/derived placement edited as manual truth;
- #499: web JWT in custom URI or grant replay;
- #500: QuoteLine ID represents quantity > 1 units;
- #501: selecting R1 displays R4 data or browser parses `.skp`;
- #502: React classifies impact or R2 retargets R1 release;
- #503: compatibility inferred from brand or PTX serialized in React;
- #504: token/private path/model data appears in bundle;
- #474: generic local fallback appears ready;
- #473: macOS pass marks Windows supported;
- #472: shared mutable definition crosses furniture boundaries.

## 18. Canonical complete product demo

```text
React admin authors typed FurnitureDefinition parameters/bindings
→ backend validates and versions catalog
→ seller creates Project/Quote; qty=2 becomes FI-001/FI-002
→ #500 shows both physical units
→ #499 securely pairs exact Project/Design with SketchUp
→ #389 places existing FI identities
→ select/move/add/remove shelf through #467/#498
→ move hinge into conflict through #468
→ #466 navigates blocker and user fixes it
→ authoritative preflight returns ready
→ #392 publishes immutable R1 + manifest/SKP/preview/checksums
→ #501 displays exact R1 history/artifacts
→ #502 reconciles with exact QuoteRevision and creates explicit requote
→ approve/release exact R1 + fingerprint
→ #503 generates artifact using validated profile/adapter/evidence
→ publish R2 later; R1 release remains pinned
→ copy creates a new server FurnitureInstance
→ unmanaged decoration never enters manifest/BOM
→ save/reopen/migrate/adopt preserve identity
→ #504 produces privacy-safe correlated diagnostics
```

## 19. Commercial release wave

#355 may close only after consuming:

- #460 secure SketchUp/session/media behavior;
- #496 API/schema compatibility policy;
- #473 supported host matrix;
- #472 measured budgets/known limits;
- #416 legacy migration;
- #474 degraded/offline policy;
- #504 diagnostics/support workflow;
- #503 machine/artifact Web operations for claimed capabilities;
- #354 host/manufacturing proof.

Required release features include signed/verifiable RBZ, exact version/checksum, stable/beta, staged rollout, pause/kill switch, rollback, schema migration, release notes/deprecations and privacy-safe support.

## 20. Definition of Done for #465

#465 closes only when:

- #496–#504 complete according to their applicable dependencies/DoD;
- #466–#474 and #416 complete;
- critical #460/#461 work complete;
- Gate A and required Digital Thread #385–#398 paths are green;
- React catalog/Project/Design/release/machine work is integrated, not mocked;
- machine claims are backed by #348/#351–#354 evidence;
- #355 proves commercial release/update/rollback;
- supported hosts and performance limits are measured;
- no generic fallback appears productive;
- no closed issue claims a missing host/Web interaction;
- documentation, issues, generated contracts, ledger, code and proof artifacts agree.