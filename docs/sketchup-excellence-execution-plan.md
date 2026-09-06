# Granete for SketchUp — Excellence Execution Plan

Status: **Canonical live execution order**  
Program: #465  
Umbrella: #290  
Digital Thread: #384  
Foundation gates: #446/#462  
Cross-surface contract: `docs/architecture/sketchup-backend-web-integration-excellence.md`  
Reconciled: 2026-09-05 America/Mexico_City

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

Current priority is **a rehearsed, visible DEMO, then a useful sellable MVP for the two
prospects**, not another foundation restart. See the
[dated evidence and delivery map](demo-mvp-plan-2026-09-05.md).

| Status at publication readback | Reuse / next action |
|---|---|
| Gate A #537 merged; #462 remains open for Gate B | Preserve executable controls; do not block delivered Digital Thread as pre-Gate-A work. |
| #385–#389, #392–#395, #398 closed with merged PRs | Reuse persistent identity, Design, publication, reconciliation and exact release. |
| #498/#466/#467/#468 closed | Reuse shared host mutation, preflight/navigation and authoring. |
| #390/#391/#470 open with merged PRs #546/#547/#558 | Reconcile remaining criteria/closure, not automatic reimplementation. |
| #500 closed / PR #565 merged | Reuse the physical-unit matrix; continue with #501, then #502. |
| #496/#497/#499/#501/#502 open | Complete applicable generated boundaries, typed administration, pairing and Web workflows. |

Immediate product path:

```text
documentation reconciliation → subsequent issue reconciliation
→ reuse integrated #500/#565 → #501 → #502
→ known catalog + real Web/SketchUp rehearsal with explicit exclusions
→ pilot integrity + required industrial recipes
→ qualified machine evidence for each prospect → supported MVP
```

One active feature at a time unless explicitly coordinated. This documentation pass
does not activate a feature or authorize GitHub mutations. Verify branch/PR state when
implementation is authorized; do not infer the active feature from an old F199 paragraph.

Sections below retain dependency and acceptance contracts. Their historical order does
not mean all listed work remains pending. Physical evidence is never inferred from
backend or mock-based host test success.

## 4. Completed historical Wave 0/1

The former documentation/foundation gate is complete:

- canonical excellence documentation exists;
- #476 SelectionContext is closed;
- #477 rich authoring resolve is closed;
- typed parameter delivery #483/#486 is merged.

No agent may continue treating #475 as a draft implementation blocker or recreate #476/#477 from memory.

## 5. New cross-surface foundations

Maintain the following boundaries. #498 is delivered; #496 remains open for complete generated API coverage and #497 for typed administration. Do not rebuild delivered foundations.

| Order | Issue | Delivery | Gate boundary |
|---:|---:|---|---|
| X0 | #496 | Generated furniture/catalog/layout/authoring/Design API authority | Current stateless endpoints may advance before Gate A; persistent Design operations after Gate A |
| X1 (delivered) | #498 | Shared modular HtmlDialog/host interaction runtime, atomic mutation, correlation, rollback/undo and minimum degraded guards | May advance before Gate A |
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

The #466/#467/#468 loop is delivered at the dated cut. Retain and extend these acceptance contracts rather than scheduling it again from zero:

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

## 9. Foundation Gate A boundary — delivered, controls retained

Gate A #537 is merged. #462 remains open for Gate B. Preserve RLS/runtime-role,
transactional audit, generated contracts and browser/session isolation for any extension.
No shadow Project/Design store or temporary productive identity is permitted.

The former pre-Gate-A/post-Gate-A split explains delivery history, not the next schedule.
Gate B remains a prerequisite for its cross-organization commercial workflows.

## 10. Digital Thread — integrated core, remaining product surfaces

#385–#389 and #392–#395 are closed; #390/#391 have merged implementations but open
issues. #398/#554 supplies the delivered core regression evidence. Preserve ownership:

```text
Project FurnitureInstance → quote physical units → Design/immutable revisions
→ host binding/placement → publication/artifacts
→ reconciliation → explicit requote → approval/exact release
```

The remaining React work uses this foundation:

- #500/PR #565: integrated physical-unit matrix;
- #501: Design/revision/artifact history;
- #502: reconciliation/requote/approval and existing release UX;
- #499: secure exact Project/Design handoff, not device enrollment.

#397 adoption remains a separate acceptance scope, not a reason to invent IDs locally.
#499 must not be retroactively treated as proof already supplied by #388 or as a reason
to deny the value of the integrated core. Manual handoff can be explicit in the DEMO;
a claimed secure browser handoff requires #499 evidence.

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

### #398 delivered core gate versus complete product acceptance

#398/#554 is closed with Go/PostgreSQL, contract and real-host evidence (including
controlled server doubles for host scenarios). Preserve that scope; do not relabel it
as a failed unfinished gate because broader product work remains.

The expanded DEMO adds real browser behavior for #500/#501/#502 and a rehearsed
cross-surface flow. Secure pairing #499, if claimed, needs its own proof. Machine
readback #354 and each client evidence pack remain separate requirements before
manufacturing/support claims. These are additional acceptance layers, not a dependency
cycle or automatic reopening of #398.

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