# Granete for SketchUp — Excellence Execution Plan

Status: **Canonical execution order**  
Program: #465  
Umbrella: #290

## 1. Goal

This plan orders the work required to turn the validated SketchUp technical baseline into a professional, secure and commercially supportable product without bypassing Organization Foundation, Digital Thread or machine-validation gates.

The execution rule is simple:

> Build shared identity/transport foundations once, then build host UX on them. Never let each feature invent its own selection model, authoring payload or manufacturing shortcut.

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
- #355 — commercial packaging/licensing/updates;
- #416 — legacy host representation migration;
- #460 — session/media/auth hardening.

## 4. Shared P0 foundations added by the excellence audit

Two shared foundations must land before downstream host features diverge.

### #476 — Semantic SelectionContext + capability-driven inspector

One selection/context model must answer for #466/#467/#468/#470/#471:

```text
what is selected?
→ which stable Granete IDs identify it?
→ which FurnitureInstance owns it?
→ which actions are legal here?
```

No downstream feature may define a competing selection payload or infer identity from name/GUID/persistent_id/geometry.

### #477 — Versioned rich authoring resolve contract

The current layout endpoint is optimized for dimensions/material choices. Rich authoring must not grow ad-hoc query parameters.

#477 creates/reuses one versioned TS↔Go↔Ruby semantic authoring resolve boundary for:

- move/add/duplicate/remove internal occurrences;
- joinery intent where supported;
- manual HardwarePlacement changes;
- hardware substitution;
- complete authoritative resolved result + structured errors/preflight context.

Before #384/Gate A this may remain stateless resolution; it must not create a parallel persistent Project/Design business family.

## 5. New child issue order

| Order | Issue | Scope | Hard prerequisite / coordination |
|---:|---:|---|---|
| F0 | #476 | Semantic SelectionContext + contextual inspector | #346/#415 baseline |
| F1 | #477 | Versioned rich authoring resolve contract | #346/#356/#347/#415; coordinate #460 |
| A1 | #466 | Authoritative preflight review + viewport navigation | #476 + #347/#346 |
| A2 | #467 | Direct internal component authoring | #476 + #477 + #356/#347/#415 |
| A3 | #468 | Interactive HardwarePlacement edit/substitution | #476 + #477 + #350/#356/#347; reuse #467 mutation infra |
| B1 | #469 | Constraint-aware placement/snapping | #414/#415 |
| B2 | #470 | ManufacturingFeature inspection/provenance overlay | #476 + #347/#356/#350/#415; reuse #466 navigation |
| B3 | #471 | Multi-select/batch editing | #476 + #404/#403/#415; durable project scope waits #384 |
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

## 6. Wave 0 — documentation and backlog authority

Must happen before production implementation of the new host slices:

- merge `docs/architecture/sketchup-plugin-excellence.md`;
- merge `docs/architecture/sketchup-authoring-interaction-contract.md`;
- merge this execution plan;
- add scoped `apps/sketchup-extension/AGENTS.md`;
- reconcile #290/#349/#350/#416/#355;
- create/reconcile #465 children;
- perform branch/readback review of the documentation PR.

PR #475 owns this Wave 0 documentation package.

Until #475 is merged, child issues may receive discovery/review but should not reconstruct the canonical contract from memory.

## 7. Wave 1 — shared interaction/transport foundations

Recommended order:

```text
#476 semantic selection/context
     ↘
      #466 preflight navigation can start after #476

#477 rich authoring resolve contract
     ↓
#467 internal component authoring
     ↓
#468 hardware authoring/substitution
```

#476 and #477 can advance in parallel once Wave 0 is merged because they solve different boundaries.

### #476 proof target

Real SketchUp:

```text
select furniture
select nested shelf
select hardware
rename/rebuild
→ one stable semantic SelectionContext model survives
```

### #477 proof target

Shared contract:

```text
current dims/material resolve
+ move shelf
+ add/remove shelf
+ move/replace hinge
→ deterministic authoritative result
→ same stable IDs/parity TS↔Go↔Ruby
```

No Project persistence is introduced.

## 8. Wave 2 — professional editing loop

After the shared foundation each authoring slice becomes a product feature instead of a new architecture experiment.

```text
#466 preflight review/navigation
#467 direct internal authoring
#468 HardwarePlacement authoring/substitution
```

#466 may land before #467/#468, then gain richer context actions as those editors become available.

Wave 2 acceptance demo:

```text
select shelf
→ move/add/remove supported shelf
→ Granete re-resolves relationships/machining
→ create a real conflict
→ preflight shows blocker and navigates to it
→ select/move or replace hinge
→ unrelated shelf machining remains correct
→ conflict clears
→ ready only when Granete returns ready
→ undo/redo
```

Required evidence:

- shared contract/domain/API tests as needed;
- Ruby tests;
- HtmlDialog/tool interaction coverage where feasible;
- rollback/negative proof;
- real SketchUp TestUp for select/edit/rebuild/undo/navigation.

## 9. Wave 3 — daily-use productivity

After Wave 1/2 infrastructure is stable:

```text
#469 placement/snapping
#470 manufacturing overlay
#471 batch editing
```

Parallelism:

- #469 can largely advance independently;
- #470 reuses #476 semantic selection and #466 navigation;
- #471 reuses #476 plus material/hardware editors and must keep durable project/room scopes disabled until #384 persistence exists.

Wave 3 acceptance demo:

```text
place several cabinets by preview/snap
→ multi-select and batch-change a common BODY material
→ select a board
→ inspect resolved drilling/groove/edge provenance
→ no manufacturing rule executes in Ruby
```

## 10. Wave 4 — host robustness and migration

Run in parallel where resources allow:

```text
#416 legacy Group migration
#472 performance
#473 compatibility matrix
#474 degraded/offline safety
```

Rules:

- #416 must land before broad customer upgrades from existing Granete Group models;
- #474 must land before degraded/offline behavior is considered commercially safe;
- #472 measures before optimizing and never trades identity correctness for definition sharing;
- #473 requires real Windows evidence before Windows becomes `supported`.

Wave 4 gates:

- no destructive legacy migration;
- no false productive generic fallback;
- measured 10/50/100/300 furniture performance baseline;
- support claims tied to exact host evidence.

## 11. Foundation Gate A boundary

### May continue before Gate A #462

After Wave 0 documentation is merged, and as long as no new persistent business family is created:

- #476 semantic host selection/context;
- #477 stateless authoring resolve contract;
- #466 preflight presentation/navigation;
- #467/#468 working authoring intent + authoritative resolver flow;
- #469 placement UX;
- #470 read-only manufacturing overlay;
- #471 current-selection batch scope;
- #416 representation migration;
- #472/#473 host validation;
- #474 degraded-state mechanics that do not invent business identity.

### Must wait for Gate A

Implementation of new persistent business families required by #384, including #385 `FurnitureInstance` storage/API.

Do not solve this by adding:

- a temporary SketchUp-only Project table/store;
- locally generated IDs later accepted as server Project identity;
- a parallel `SketchUpProject` aggregate;
- client-side durable project defaults presented as business truth.

## 12. Digital Thread wave after Gate A

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

## 13. How excellence UX integrates with #384

When #384 contracts become available, existing host work is adapted rather than replaced.

### Selection/inspector

#476 gains Project/Design/revision context while preserving component/hardware identity.

### Authoring resolve

#477 semantic intent becomes the working-copy command contract or is adapted behind it. Do not create another authoring model.

### Placement

#469 reusable library insertion:

```text
unconnected/local compatibility mode → non-server compatibility identity only where allowed
connected Project mode → #390 obtains server FurnitureInstance before productive managed placement
```

### Batch editing

Current-selection batch remains valid. Durable room/project scopes consume Design working-copy persistence; no local shadow project state.

### Delete

Connected-mode delete becomes a Digital Thread working-design/business lifecycle operation, not only host `erase_entities`.

### Copy

#391 owns new server business identity. SketchUp `make_unique` only solves host definition isolation.

### Preflight/publish

#466 consumes exact revision/fingerprint context when available; it never chooses implicit `latest`.

## 14. Machine evidence wave

After the full #347 gate and required field evidence:

```text
#348 PTX import/readback
→ #351 MachineProfile/PostprocessorAdapter
→ #352 Client A evidence pack
→ #353 Client B evidence pack
→ #354 deterministic SketchUp → manufacturing output E2E
```

No client, docs or release notes may generalize a validated machine/software version to a whole brand without evidence.

## 15. Commercial release wave

#355 becomes the release-readiness package and must consume:

- #460 secure SketchUp/session/media behavior;
- #473 support matrix;
- #472 performance budgets/known limits;
- #416 migration compatibility;
- #474 degraded/offline policy;
- #354 manufacturing goldens/evidence;
- API/schema compatibility policy including #477.

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

## 16. PR layering rule

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

## 17. Required negative-proof pattern

Every child issue adds at least one test that fails against the forbidden shortcut it was created to prevent.

Examples:

- #476: two shelf occurrences sharing a definition collapse into one selection context;
- #477: rich authoring grows ad-hoc `?shelf...`/`?hinge...` query parameters or parallel payload shapes;
- #467: direct face mutation/duplicate occurrence ID;
- #468: Ruby drilling table/derived placement edited manually;
- #466: local dimensions imply manufacturing ready;
- #470: overlay becomes productive input;
- #471: first selected value overwrites mixed state;
- #474: local generic 18 mm fallback appears ready;
- #473: macOS evidence marks Windows supported;
- #472: shared mutable definition crosses FI boundaries.

## 18. Real-host evidence policy

Real-host TestUp is mandatory when correctness depends on actual SketchUp behavior, including:

- ComponentInstance/definition lifecycle;
- nested selection/InstancePath;
- tools/preview interactions;
- undo/redo;
- save/reopen;
- CEF/HtmlDialog bridge behavior when host-dependent;
- OS/SketchUp compatibility.

Ruby stubs remain useful but cannot substitute host evidence for support claims.

## 19. Pilot scenarios

### Pilot A — authoring excellence

```text
insert cabinet
→ place via snap
→ change BODY material
→ select/move shelf
→ add second shelf
→ select/move hinge
→ trigger/fix conflict through preflight navigation
→ inspect machining overlay
→ batch-edit selected furniture
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

## 20. Definition of Done for #465

#465 may close only when:

- #476/#477 and #466–#474 are closed according to their actual DoD;
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
