# Granete for SketchUp — Excellence Execution Plan

Status: **Canonical execution order**  
Program: #465  
Umbrella: #290

## 1. Goal

This plan orders the work required to turn the validated SketchUp technical baseline into a professional, secure and commercially supportable product without bypassing Organization Foundation, Digital Thread or machine-validation gates.

## 2. Existing baseline we do not rebuild

Completed/validated foundations:

| Area | Authority |
|---|---|
| Architecture/manufacturing boundary | #344 / ADR-0001 |
| Semantic metadata/roundtrip | #346 |
| Part relationships/joint machining | #356 |
| Authoritative preflight | #347 |
| Parametric furniture domain baseline | #349 / ADR-0002 |
| HardwarePlacement domain baseline | #350 |
| Material-aware resolution | #401–#405 |
| Native local transforms | #414 |
| Native ComponentInstance renderer | #415 / ADR-0004 |
| Real-host native/OCL validation | #417 |

Do not duplicate these concepts in new child issues.

## 3. Program relationships

#465 is a product/host excellence program that coordinates with, but does not replace:

- #446 / #462 — Organization Foundation and Gate A/B;
- #384 — Project Digital Thread;
- #413 — native SketchUp entity model;
- #401 — material-aware resolution;
- #348–#354 — machine evidence/output validation;
- #355 — packaging/licensing/updates;
- #416 — legacy host representation migration;
- #460 — session/media/auth hardening.

## 4. New child issues

| Order | Issue | Scope | Gate/dependency |
|---:|---:|---|---|
| A1 | #466 | Authoritative preflight review + viewport navigation | #347/#346 baseline |
| A2 | #467 | Direct internal component authoring | #356/#347/#415 baseline |
| A3 | #468 | Interactive HardwarePlacement edit/substitution | #350/#356/#347 baseline; reuse #467 infra |
| B1 | #469 | Constraint-aware placement/snapping | #414/#415 baseline |
| B2 | #470 | ManufacturingFeature inspection/provenance overlay | #347/#356/#350/#415 |
| B3 | #471 | Multi-select/batch editing | #404/#403/#415; durable project scope waits #384 |
| C1 | #472 | Large-project performance budgets | #413/#415 baseline |
| C2 | #473 | Windows/macOS/SketchUp host matrix | #417 baseline; feeds #355 |
| C3 | #474 | Offline/cache/fallback safety | #460/#384 coordination |

Existing required issues:

| Issue | Role in excellence |
|---:|---|
| #416 | migrate legacy Granete Groups safely |
| #460 | dedicated SketchUp/session/media security boundary |
| #384 children | Project Furniture, revisions, reconciliation, adoption, release |
| #348–#354 | actual machine/output evidence |
| #355 | signed packaging, compatibility, update/rollback, licensing |

## 5. Execution waves

### Wave 0 — Documentation and backlog authority

Must happen before agents start the new host work:

- merge `sketchup-plugin-excellence.md`;
- merge `sketchup-authoring-interaction-contract.md`;
- merge this execution plan;
- add scoped `apps/sketchup-extension/AGENTS.md`;
- update #290, #349, #350, #416 and #355 with the new authority/boundaries;
- update #465 with child issue table.

Definition of Done:

- no ambiguity about authority/identity;
- no issue claims host UX that another issue assumes is already implemented;
- every new child references the canonical docs.

### Wave 1 — Professional editing loop, parallel with Foundation

Can proceed before Gate A because it does not need new Project/Design persistence if scoped correctly.

Recommended order:

```text
#466 preflight review shell/navigation
#467 direct internal authoring
#468 hardware authoring
```

Why #466 early:

Every later authoring tool benefits from one common mechanism for authoritative errors, navigation and remediation.

Why #467 before deep #468 integration:

Both need selection/context/semantic mutation/rebuild infrastructure. Build it once around the interaction contract.

Wave 1 acceptance demo:

```text
select shelf
→ move/add/remove supported shelf
→ Granete re-resolves relationships/machining
→ conflict appears in preflight
→ navigate blocker
→ select/move hinge
→ conflict clears
→ ready returned by Granete
```

Required evidence:

- domain/API tests as needed;
- Ruby tests;
- HtmlDialog interaction tests where feasible;
- real SketchUp TestUp for select/edit/rebuild/undo/navigation.

### Wave 2 — Daily-use productivity

After the Wave 1 interaction infrastructure is stable:

```text
#469 placement/snapping
#470 manufacturing overlay
#471 batch editing
```

Parallelism:

- #469 can largely advance independently;
- #470 should reuse #466 navigation/state;
- #471 should reuse material/hardware editors and must keep durable project scopes disabled until #384 persistence exists.

Wave 2 acceptance demo:

```text
place several cabinets by preview/snap
→ batch-change BODY material
→ select one part
→ inspect resolved manufacturing features
→ no manufacturing rule executed in Ruby
```

### Wave 3 — Host robustness and migration

Run in parallel where resources allow:

```text
#416 legacy Group migration
#472 performance
#473 compatibility matrix
#474 degraded/offline safety
```

Recommended sequencing detail:

- #416 should land before broad customer migration from current pilot files;
- #474 should land before declaring offline/fallback behavior commercially safe;
- #472 creates measured budgets before optimization;
- #473 establishes actual support rows before #355 release policy is finalized.

Wave 3 gates:

- no destructive legacy migration;
- no false productive fallback;
- measured 100+ furniture performance baseline;
- at least one Windows real-host row before Windows `supported`.

## 6. Foundation Gate A dependency

### May continue before Gate A #462

- Wave 0 docs/backlog;
- #466 read/present existing authoritative preflight;
- #467/#468 local/working authoring intent + resolver contracts without new persistent family;
- #469 placement UX;
- #470 read-only overlay;
- #472/#473 host validation;
- #416 representation migration;
- #474 degraded-state mechanics that do not invent server business identity.

### Must wait for Gate A

Implementation of new persistent business families required by #384, including #385 `FurnitureInstance` storage/API.

Do not solve this by adding a temporary SketchUp-only business store.

## 7. Digital Thread wave after Gate A

Follow #384 dependency graph without shortcuts:

```text
#385 stable Project FurnitureInstance
→ #386 QuoteLine ↔ physical units
→ #387 Design + immutable DesignRevision
→ #388 SketchUp Project/Design binding
→ #389 Project Furniture panel/place existing
→ #390 connected catalog insertion creates Project FI
→ #391 duplicate identity handling
→ #392 publish revision/artifacts
→ #393 reconciliation
→ #394 impact classification/requote
→ #395 approval/exact ProductionRelease
→ #397 existing SKP adoption
→ #398 E2E suite
```

#396 web workspace proceeds per its prerequisites.

## 8. How #465 UX integrates with #384

When #384 contracts become available, existing host work must be adapted rather than replaced:

### Placement

#469 reusable library insertion:

```text
unconnected/local mode → compatibility instanceRef if allowed
connected Project mode → #390 obtains server FurnitureInstance first
```

### Selection/inspector

Add Project/Design/revision context without changing child identity model.

### Batch editing

Current-selection batch remains valid. Durable room/project scopes consume Design working-copy persistence; no local shadow project state.

### Delete

Connected-mode delete becomes a Digital Thread working-design/business lifecycle operation, not only host `erase_entities`.

### Copy

#391 owns new server business identity. `make_unique` only solves host definition isolation.

### Preflight/publish

#466 review state consumes exact revision/fingerprint context when available. It does not choose implicit latest.

## 9. Machine evidence wave

After the full #347 gate and required field evidence:

```text
#348 PTX import/readback
→ #351 MachineProfile/PostprocessorAdapter
→ #352 Client A evidence pack
→ #353 Client B evidence pack
→ #354 deterministic SketchUp → manufacturing output E2E
```

No client or README may generalize a validated machine/software version to a whole brand without evidence.

## 10. Commercial release wave

#355 becomes the readiness package and must consume:

- #460 secure SketchUp/session/media behavior;
- #473 support matrix;
- #472 performance budgets/known limits;
- #416 migration compatibility;
- #474 degraded/offline policy;
- #354 manufacturing goldens/evidence;
- API/schema compatibility policy.

Required release features:

- signed/verifiable RBZ;
- exact version + checksum;
- stable/beta channels;
- staged rollout;
- rollback/kill switch;
- supported SketchUp/OS/API matrix;
- safe schema migration;
- privacy-safe diagnostics;
- license/session failure cannot corrupt model state.

## 11. PR layering rule

Every implementation PR must declare which layers it changes:

```text
[ ] domain
[ ] Go backend/API/storage
[ ] Ruby adapter/host
[ ] HtmlDialog/UI
[ ] shared contract/golden
[ ] real-host TestUp
[ ] docs
```

The issue Definition of Done determines which boxes are mandatory.

A PR cannot close #467/#468 by checking only `domain`.

## 12. Required negative-proof pattern

Every child issue must add at least one test that fails against the forbidden shortcut it was created to prevent.

Examples:

- #467: direct face mutation/duplicate occurrence ID;
- #468: Ruby drilling table/derived placement edited manually;
- #466: local dimensions imply manufacturing ready;
- #470: overlay becomes productive input;
- #471: first selected value overwrites mixed state;
- #474: local generic 18 mm fallback appears ready;
- #473: macOS evidence marks Windows supported;
- #472: shared mutable definition crosses FI boundaries.

## 13. Real-host evidence policy

Real-host TestUp is mandatory when correctness depends on actual SketchUp behavior, including:

- ComponentInstance/definition lifecycle;
- selection/InstancePath;
- tool/preview interactions;
- undo/redo;
- save/reopen;
- UI bridge behavior that differs in CEF/host;
- OS/SketchUp compatibility.

Ruby stubs remain useful but cannot substitute host evidence for support claims.

## 14. Pilot scenarios

### Pilot A — authoring excellence

```text
insert cabinet
→ place via snap
→ change BODY material
→ move shelf
→ add second shelf
→ move hinge
→ trigger/fix conflict through preflight navigation
→ inspect machining overlay
→ undo/redo
→ save/reopen
```

### Pilot B — Project Digital Thread

After Gate A/#384:

```text
quote qty > 1
→ distinct Project FurnitureInstances
→ place pending units
→ create design-first unit
→ copy furniture → new business identity
→ publish R1
→ reconcile
→ approve/release R1
→ publish R2 without retargeting release
```

### Pilot C — migration/robustness

```text
open legacy Granete Group SKP
→ review migration
→ migrate safely
→ preserve identity/transform/intent
→ run host/preflight checks
```

## 15. Definition of Done for the excellence program

#465 may close only when:

- #466–#474 are closed according to their actual DoD;
- #416 is closed;
- critical SketchUp portions of #460 are closed;
- #384 core path needed for connected authoring/revision/release is closed and #398 is green;
- machine field validation/goldens needed for claimed capabilities are closed;
- #355 defines and proves commercial distribution/update/rollback;
- supported host matrix has real evidence;
- performance budgets have actual measurements;
- no generic fallback can masquerade as productive state;
- no closed issue claims an unimplemented host UX capability;
- documentation, issue dependency graph and implementation ledger agree.