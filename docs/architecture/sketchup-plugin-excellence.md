# Granete for SketchUp — Plugin Excellence Architecture

Status: **Canonical target**  
Program: #465, umbrella #290  
Related authorities: #384, #413, #401, #446

## 1. Purpose

This document defines what “excellent” means for **Granete for SketchUp** and separates product experience from manufacturing authority so future agents can improve interaction without recreating industrial logic in Ruby.

The target is not “a cheaper Promob” and not “another SketchUp cut-list extension”. Granete for SketchUp must be a professional authoring client inside SketchUp that participates in a wider digital thread:

```text
Quote / Project
→ FurnitureInstance
→ Design working copy
→ SketchUp authoring
→ authoritative resolve/preflight
→ DesignRevision
→ reconciliation/approval
→ exact ProductionRelease
→ production / installation
```

The non-negotiable invariant remains:

> **SketchUp owns authoring/interaction; Granete owns manufacturing truth.**

## 2. Current validated baseline

As of 2026-08-29 the following are baseline, not future aspiration:

- architecture/manufacturing boundary and semantic contract (#344/#346);
- parametric relationships and joint-driven machining model (#356);
- authoritative manufacturing preflight (#347);
- universal parametric furniture/domain baseline (#349);
- HardwarePlacement/machining domain baseline (#350);
- material-aware resolution and TS↔Go↔SketchUp parity (#401–#405);
- authoritative local part transform (#414);
- native Furniture/Part `Sketchup::ComponentInstance` renderer (#415);
- real-host native hierarchy + OpenCutList 7.1.0 interoperability evidence (#417);
- isolated top-level native definition per furniture instance in V1.

### Important closure boundary

Closing #349 and #350 established the **domain/contract capability**. It does **not** prove that all professional host interactions described there are already available to a designer in SketchUp.

The remaining host/product layer is owned by #465 children, especially #467 and #468.

Agents must not treat “pure domain helper exists” as proof that “the SketchUp UX is done”.

## 3. Product north star

A professional user should be able to perform this loop without needing to understand internal schemas:

```text
Open SketchUp
→ Granete identifies current workshop/session
→ connected mode identifies Project / Design / base revision
→ user sees Project Furniture + reusable Library
→ place or create a furniture unit
→ select furniture / subassembly / part / hardware contextually
→ edit only supported authoring intent
→ Granete re-resolves geometry + manufacturing consequences
→ SketchUp atomically rebuilds managed native entities
→ user reviews authoritative preflight in context
→ user can inspect manufacturing features/provenance read-only
→ publish exact DesignRevision when Digital Thread allows it
```

The experience should feel direct:

- click/select;
- drag where safe;
- enter exact mm where precision matters;
- add/remove supported internals;
- replace compatible hardware/materials;
- see immediate visual feedback;
- receive explicit blockers/remediation;
- undo coherently.

The engineering underneath may be complex. The interaction should not expose that complexity unnecessarily.

## 4. Competitive principles we adopt, not clone

Granete may learn from Gabster, DinaBox, CabinetSense, OpenCutList and other woodworking SketchUp tools, but must not copy proprietary UI or assume their internal architecture.

Useful market patterns:

- contextual properties follow selection;
- large visual furniture/material libraries;
- fast component insertion/replacement;
- internal component authoring;
- smart hardware configuration;
- batch editing;
- machining inspection;
- cloud/versioned catalogs;
- predictable migration between plugin versions.

Granete differentiators must remain:

- server-authoritative manufacturing truth;
- explicit stable business/authoring identities;
- Project-owned `FurnitureInstance` identity via #384;
- deterministic preflight and provenance;
- exact revisions/releases;
- continuity into production, installation and multi-organization workflows.

## 5. Ownership matrix

| Concern | SketchUp client | Granete domain/backend | Machine adapter |
|---|---|---|---|
| viewport/camera/selection | owns | no | no |
| cursor inference / placement preview | owns | no | no |
| top-level furniture transform authoring | owns intent | validates/persists per revision | no |
| parametric values/material choices | captures intent | validates/resolves | no |
| internal component add/move/remove intent | captures | validates/resolves relationships | no |
| manual HardwarePlacement intent | captures | validates/resolves | no |
| derived joint/hardware machining | read-only visualization | **owns** | serializes only |
| board thickness/material manufacturing consequence | renders result | **owns** | consumes |
| BOM/edges/drilling/nesting/kerf | never authoritative | **owns** | consumes/serializes |
| preflight readiness | presents | **owns** | capabilities contribute |
| Project/Furniture/Design identity | stores binding/locators | **owns** | no |
| release/machine profile/output | presents status | **owns release** | format-specific serialization |

## 6. Identity model

Never collapse these namespaces:

```text
furnitureInstanceId        Project-owned physical furniture identity (#384)
furnitureDefinitionId      reusable Granete template/catalog identity
componentInstanceId        concrete managed component occurrence
componentDefinitionId      reusable authoring-definition identity
catalogComponentId         optional catalog provenance/reference
hardwarePlacementId        concrete hardware authoring placement
SketchUp persistent_id     technical host locator only
SketchUp definition GUID   technical host locator only
```

Hard rules:

- `furnitureInstanceId != persistent_id`;
- `componentDefinitionId != SU definition GUID`;
- two identical physical furniture units retain different `furnitureInstanceId`s;
- two shelves may share `componentDefinitionId` and must retain distinct `componentInstanceId`s;
- anchors and hardware hosts target concrete occurrence identity;
- display name, dimensions, transform and geometry are never primary identity.

## 7. Managed host hierarchy

Target host representation remains semantic and native:

```text
Furniture ComponentInstance
  ├── Board/Part ComponentInstance
  ├── Hardware ComponentInstance
  └── optional semantic Aggregate/Subassembly ComponentInstance
       └── managed child instances
```

No fixed wrapper depth is required.

### Definition lifecycle

V1 correctness rule:

- each top-level managed furniture has an isolated generated SketchUp definition;
- part definitions may initially be unique per occurrence;
- sharing is allowed only for immutable/content-addressed definitions keyed by a deterministic resolved geometry signature;
- shared definition mutation must never let FI-A edit FI-B;
- geometry signature is an optimization key, never business identity.

## 8. Authoring command model

Direct manipulation must resolve to semantic authoring commands, not destructive geometry editing.

Representative concepts:

```text
UpdateFurnitureParameters
ChangeMaterialChoice
MoveComponentIntent
AddComponentIntent
DuplicateComponentIntent
RemoveComponentIntent
ChangeJoineryIntent
UpdateHardwarePlacementIntent
ReplaceHardwareIntent
UpdateFurnitureTransform
```

Exact names may follow the existing domain/API contract. The semantic responsibilities must remain.

### Local preview vs accepted state

SketchUp may calculate transient interaction aids:

- cursor hit point;
- snap candidate;
- ghost geometry;
- temporary translation along an allowed axis;
- visual highlight.

These are not manufacturing truth.

The accepted productive state comes only after Granete resolves/accepts the authoring intent.

## 9. Atomic mutation sequence

For any authoring mutation that affects managed geometry:

```text
capture user intent
→ validate client-level obvious input only
→ send/resolve authoritative intent
→ receive complete accepted resolved state
→ prepare needed assets/definitions
→ start one SketchUp operation
→ rebuild/rebind managed hierarchy
→ write accepted metadata
→ update selection/UI state
→ commit
```

On error before commit:

```text
abort
→ previous valid hierarchy and metadata remain authoritative locally
```

Never clear valid geometry before authoritative resolution succeeds.

## 10. Selection and inspector hierarchy

Selection should reveal the most useful semantic level.

### Furniture selected

Show:

- definition/name;
- dimensions and authorable parameters;
- material roles;
- compatible high-level hardware/configuration options;
- project/design/revision status when #384 is active;
- preflight state;
- actions: update, duplicate, delete, review manufacturing.

### Aggregate/subassembly selected

Show only actions supported by the domain definition, for example a drawer group or shelf system.

### Board/part selected

Show:

- semantic role/slot;
- concrete component occurrence;
- resolved material/thickness read-only consequence;
- supported authoring actions such as move/remove when explicitly allowed;
- manufacturing inspection action.

Do not expose arbitrary local axis/rotation internals as the normal UX.

### Hardware selected

Show:

- concrete placement;
- hardware definition;
- host component;
- authorable anchor/offset/rotation/handedness fields;
- manual vs derived status;
- replace/edit only when permitted.

Derived placements are not editable as manual coordinate truth.

## 11. Professional internal authoring

Owned primarily by #467.

First contract slice:

```text
select shelf
→ move precise/constrained
→ Granete re-resolves relationships/machining
```

and:

```text
add shelf
→ distinct component occurrence identity
→ relationships generated/resolved
→ atomic rebuild
```

Also duplicate/remove where supported.

This is controlled authoring, not universal free-form CAD.

## 12. Professional hardware authoring

Owned primarily by #468.

The user should interact with meaningful choices:

```text
select hinge
→ move offset / handedness where allowed
→ Replace hardware
→ choose compatible catalog option
```

Granete owns:

- compatibility;
- machining profile;
- dependent drilling;
- BOM consequences;
- conflict detection.

Ruby/HtmlDialog never hardcode a brand-specific drilling table.

## 13. Placement and snapping

Owned by #469.

Current origin-first insertion is an interim behavior. Target:

```text
library item
→ ghost preview
→ SketchUp inference + semantic snap suggestion
→ rotate/flip/offset
→ commit top-level transform
```

Allowed semantic aids include:

- wall/face alignment;
- floor/base plane;
- furniture side-to-side;
- configurable gap;
- exact mm offset;
- repeat placement.

Placement convenience cannot silently change manufacturing dimensions/materials.

## 14. Authoritative preflight UX

Owned by #466.

Interactive validation and manufacturing readiness are different levels:

```text
interactive validation
= obvious local form/range feedback

manufacturing preflight
= Granete-authoritative result
```

SketchUp should display:

- ready/warning/blocked/stale/unavailable;
- issue counts;
- structured issue code/severity/message/remediation;
- exact semantic target;
- viewport navigation;
- correction entry point.

Never infer manufacturing readiness from local dimension ranges.

## 15. Manufacturing inspection overlay

Owned by #470.

Granete-resolved ManufacturingFeatures may be visualized as read-only overlays:

- drilling;
- grooves/slots;
- pockets/cutouts when neutral model supports them;
- edge treatment;
- face/orientation indicators.

Every derived operation preserves provenance.

Overlay geometry:

- is ephemeral/non-productive;
- must never be scanned back into BOM/CNC;
- must refresh or become visibly stale after relevant authoring changes.

## 16. Batch editing

Owned by #471.

Multi-selection should distinguish common vs mixed values and never use the first selected furniture as hidden authority.

Initial batch scopes may include current SketchUp selection only.

Durable room/project defaults require the corresponding #384 persistence. A session-local default may not be presented as project truth.

## 17. Project Digital Thread boundary

#384 remains sole authority for:

- server-owned Project `FurnitureInstance` identity;
- `Design` / immutable `DesignRevision`;
- Project Furniture panel;
- design-first FurnitureInstance creation;
- duplicate business identity resolution;
- publish artifacts/manifest;
- reconciliation;
- approval/release;
- adoption of existing SKP.

#465 children must consume these concepts, never create:

- `SketchUpProject` aggregate;
- alternate `ProjectFurniture` identity;
- local business IDs accepted as server truth.

### Gate A

Implementation that creates new persistent `FurnitureInstance`/Design families waits for Foundation Gate A #462 as defined by #385.

Pure host interaction, read-only visualization, docs and performance/compatibility work may advance in parallel when they do not create persistence.

## 18. Legacy representation migration

#416 owns Group → native ComponentInstance representation migration.

It must be product-quality:

- detect by namespaced metadata, not names;
- show review/count/state;
- preserve transform/known intent/business identity;
- validate replacement before deleting legacy geometry;
- one undoable operation;
- record migration marker/provenance;
- never invent missing Project identity.

Business adoption of arbitrary/existing models remains #397.

## 19. Degraded/offline/fallback behavior

Owned by #474.

Canonical principle:

> Connectivity loss may reduce convenience; it must never reduce truth guarantees.

Distinguish states such as:

```text
resolved_current
resolved_stale
unresolved_preview
offline_cached
sync_required
blocked_incompatible
```

Without current authoritative resolution:

- no green manufacturing-ready state;
- no local authoritative BOM/drilling;
- no silent generic geometry accepted as productive;
- no publish/release unless #384 explicitly provides a safe contract.

## 20. Security boundary

#460 is mandatory commercial readiness work.

SketchUp client target:

- dedicated least-privilege client/session type;
- revocable server-side session/device scope;
- no web credential reuse;
- no generic bearer session token in media query strings;
- signed/resource-scoped media or authenticated fetch alternative;
- explicit absolute/session lifecycle rules.

No P0/P1 UX feature may introduce a new credential shortcut.

## 21. Performance

Owned by #472.

Measure before optimizing.

Required representative scales:

```text
10 / 50 / 100 / 300 / optional 500 furniture instances
```

Measure insert/rebuild/open/save/selection/UI/model-size/definition lifecycle on real host.

Optimizations may include immutable definition sharing, metadata indexes or lazy UI only after evidence.

Correctness and identity isolation have priority over speculative deduplication.

## 22. Compatibility

Owned by #473.

A support claim requires real-host evidence.

Allowed states:

```text
supported
tested
best_effort
unsupported
```

Record OS, SketchUp build, embedded Ruby, CEF where relevant, RBZ SHA, API compatibility and test evidence.

A macOS pass does not imply Windows support.

## 23. Machine and commercial readiness

SketchUp excellence is not equal to machine compatibility.

Field/machine evidence remains:

```text
#348 PTX import/readback
→ #351 machine profiles/adapters
→ #352/#353 machine packs
→ #354 end-to-end goldens
```

A plugin release may say “prepared for CNC workflow” before field validation, but it must not claim universal machine compatibility.

Packaging/licensing/update/rollback is #355 and must consume #460/#473 evidence.

## 24. Evidence layers

Do not confuse these proof types:

1. pure domain unit tests;
2. Go/API/storage integration tests;
3. Ruby unit/boundary tests;
4. shared contract/golden parity;
5. real SketchUp host TestUp;
6. OS/version matrix evidence;
7. real machine/software import/readback and operator sign-off.

A child issue must state which layers are required for its Definition of Done.

## 25. Anti-patterns prohibited

- closing host UX because a TS helper exists;
- editing resolved holes directly;
- local Ruby formulas for thickness/joints/drilling;
- using names/GUID/persistent_id as business identity;
- using `selection.first` as batch truth;
- clearing furniture before new resolution succeeds;
- mutable shared definitions across independent furniture;
- silently falling back from remote authoritative state to generic productive geometry;
- reporting network failure as ready/success;
- storing a fake project-wide default only in local session metadata;
- claiming Windows/SketchUp/machine support without evidence;
- inventing a parallel Project/Design model to avoid #384 prerequisites.

## 26. Global experience Definition of Done

Granete for SketchUp reaches this architecture target when a real user can:

```text
connect to the correct context
→ discover/place furniture professionally
→ select semantic nested entities
→ edit supported internals and hardware directly
→ receive atomic authoritative rebuilds
→ review and navigate manufacturing blockers
→ inspect resolved manufacturing provenance
→ use safe batch operations
→ preserve identity across save/reopen/copy/migration
→ participate in exact Project/Design revisions and releases
```

with measured performance, explicit supported hosts, secure sessions, safe degraded mode, machine evidence and reversible updates.