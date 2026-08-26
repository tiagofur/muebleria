# Native SketchUp Entity Model for Granete

> **Estado:** CANONICAL TARGET  
> **Fecha:** 2026-08-26  
> **Tracking:** #413, #414, #415, #416, #417, #418  
> **Programas relacionados:** #290 (Granete for SketchUp), #384 (Project Digital Thread), #401 (material-aware resolution)  
> **ADR:** `docs/adr/0004-sketchup-native-component-entity-model.md`  
> **Invariante central:** **Granete owns business/manufacturing truth and contract identities; SketchUp owns authoring interaction and native host representation.**

---

## 1. Purpose

This document defines how Granete-managed furniture, physical board parts, semantic subassemblies and visible hardware are represented inside a SketchUp model.

It answers a host-model question that the manufacturing/domain documents intentionally do not answer:

> When Granete resolves one furniture instance into concrete parts, what native SketchUp entities should exist in the `.skp` file, how do they map to Granete identities, and how may they be rebuilt safely?

This is not a BOM contract and not a machining model. It is the **host representation contract** used by Granete for SketchUp.

Read together with:

- `domain-model.md` — business/domain furniture semantics;
- `smart-furniture-engine.md` — engine ownership;
- `material-aware-furniture-resolution.md` — material-before-geometry resolution;
- `sketchup-interaction-model.md` — interaction/selection/editor behavior;
- `../sketchup-manufacturing-contract.md` — authoring round-trip and stable IDs;
- `project-design-digital-thread.md` — Project/FurnitureInstance/Design identity and revision lifecycle.

---

## 2. Current runtime vs target

### 2.1 Current runtime [CURRENT]

As of this decision, `FurnitureBuilder` creates:

```text
SketchUp Model
└── Group                     # furniture container
    ├── Group                 # board/component wrapper
    │   └── Faces + pushpull  # world/AABB-oriented box
    ├── Group
    │   └── Faces + pushpull
    └── Group / loaded asset  # hardware fallback/asset
```

The current renderer is intentionally simple and has been useful for validating the server-resolved layout path. It is a visual MVP, not the desired long-term native model.

### 2.2 Target runtime [TARGET]

```text
SketchUp Model
└── Furniture SU ComponentInstance
    │   metadata: furniture identity + authoring intent
    │   SU definition: isolated per FurnitureInstance in V1
    │
    ├── Board/Part SU ComponentInstance
    │   │ metadata: componentInstanceId, componentDefinitionId, role/slot/binding
    │   └── SU ComponentDefinition
    │       └── local solid geometry at origin
    │
    ├── Board/Part SU ComponentInstance
    ├── Hardware SU ComponentInstance
    └── optional semantic Aggregate/Subassembly SU ComponentInstance
        ├── Board/Part SU ComponentInstance
        └── Hardware SU ComponentInstance
```

A physical managed part becomes a native SketchUp object with:

- a ComponentDefinition containing local geometry;
- a ComponentInstance transformation;
- meaningful local axes;
- stable Granete contract metadata;
- predictable selection/Outliner behavior.

---

## 3. Why ComponentInstance is the canonical managed host entity

A SketchUp `ComponentInstance` represents one placement of a `ComponentDefinition` with its own transformation. That host concept aligns well with Granete's distinction between reusable authoring/geometry descriptions and concrete instances, but the identities are **not automatically the same IDs**.

The useful correspondence is:

```text
Granete / authoring contract             SketchUp host
------------------------------------     --------------------------------
FurnitureDefinition/catalog item         business/catalog template
FurnitureInstance                        top-level SU ComponentInstance
componentDefinitionId                    stable authoring-definition ID
componentInstanceId                      nested SU ComponentInstance identity
catalogComponentId (when present)        Granete catalog component reference
resolved local geometry                  SU ComponentDefinition entities
resolved placement                       SU ComponentInstance transform
```

The `componentDefinitionId` used by the authoring schema is a **Granete-controlled stable contract ID** for a reusable authoring definition. It may be stored on/associated with a SketchUp ComponentDefinition, but it is **not the host-generated SketchUp GUID** and it is **not automatically the Granete catalog component ID**. When a catalog relation exists, `catalogComponentId` (or the versioned catalog reference defined by the schema) carries that separate meaning.

### Benefits

- physical parts are selectable native entities;
- local axes survive furniture world movement/rotation;
- Outliner has meaningful structure;
- component-oriented woodworking extensions can inspect physical boards;
- complex part geometry can evolve beyond rectangular boxes;
- definition/instance reuse can be controlled explicitly;
- material/parameter rebuilds can regenerate/rebind geometry without scaling productive parts.

### Why not Groups as the canonical model

Groups remain valid for unmanaged/user geometry or internal helper geometry. They are not the canonical Granete physical-part wrapper because Granete needs explicit definition/instance semantics, stable local part axes, controlled reuse and component-oriented interoperability.

This does **not** mean every nested geometric helper becomes a ComponentInstance. Only semantic managed entities do.

---

## 4. Semantic hierarchy, not fixed levels

Granete does not impose a fixed three-level hierarchy. Nesting follows semantic ownership.

### Furniture

One intended physical furniture unit:

```text
FurnitureInstance FI-001
↔ top-level Sketchup::ComponentInstance
```

This is the normal selection/move/rotate unit.

### Physical managed part/component instance

A concrete resolved board/front/panel or other managed component occurrence:

```text
componentInstanceId CI-left-side-001
↔ nested Sketchup::ComponentInstance
```

The instance can be inspected through drill-down and retains local part axes.

### Optional semantic subassembly/agregado

Create an intermediate ComponentInstance only when the object has real semantic value, for example:

- drawer assembly;
- pull-out pantry assembly;
- door system assembly;
- agregado with independent selection/configuration/movement;
- nested object with stable authoring identity.

Do not add wrappers merely because a renderer function needs a container.

### Hardware

Visible hardware is represented as a ComponentInstance when loaded from an asset or generated as fallback geometry. Cost-only/non-visible hardware remains absent according to the existing layout contract.

---

## 5. Identity model

Several identity namespaces coexist. They must remain explicit.

| Concept | Meaning | SketchUp storage/association | Authority |
|---|---|---|---|
| `furnitureInstanceId` | one physical Project furniture unit | top-level instance metadata | Project/business identity |
| `furnitureDefinitionId` | reusable furniture catalog/template | furniture metadata | Granete catalog |
| `componentInstanceId` | concrete authoring/component occurrence | nested instance metadata | authoring/domain identity |
| `componentDefinitionId` | stable reusable authoring-definition identity | associated with nested SU definition/instance metadata | Granete authoring contract |
| `catalogComponentId` | optional catalog component reference | metadata | Granete catalog |
| SU ComponentDefinition GUID | host-generated definition locator | SketchUp | technical only |
| SU `persistent_id` | entity locator inside model | SketchUp | technical only |
| display name | user-facing label | SketchUp | non-authoritative |

### Hard rules

```text
componentDefinitionId != SketchUp ComponentDefinition GUID
componentDefinitionId != catalogComponentId unless a schema explicitly says so
furnitureInstanceId   != SketchUp persistent_id
```

Names, GUIDs, `entityID`, array index, geometry hash and file path are never Granete business primary keys.

### Why keep authoring definition identity separate

The manufacturing contract already needs two shelves to be able to share a reusable authoring definition while preserving distinct `componentInstanceId`s, relationships and machining consequences.

Example:

```text
componentDefinitionId = AD-SHELF-568x550
componentInstanceId   = CI-SHELF-01
componentInstanceId   = CI-SHELF-02
catalogComponentId    = shelf-standard   # optional catalog provenance
```

The SketchUp host may implement that authoring definition with one SU ComponentDefinition, but the contract identity remains a Granete-managed opaque ID rather than the host GUID.

---

## 6. Furniture ComponentDefinition lifecycle

### V1 decision: isolate top-level definitions per FurnitureInstance

Two furniture units may reference the same Granete `FurnitureDefinition` while having different parameters, materials, hardware or later design history.

Therefore V1 uses:

```text
FI-A -> SU Furniture Definition A
FI-B -> SU Furniture Definition B
```

Even when both originate from the same catalog definition.

The top-level SU definition is a host implementation container; it does not become `furnitureDefinitionId`.

### Why

If FI-A and FI-B shared a mutable top-level SketchUp definition, rebuilding FI-A could mutate FI-B automatically. That violates Project-owned physical identity.

### Future optimization

Sharing immutable generated top-level definitions could be considered only with proven copy-on-write/isolation semantics. It is not required in V1.

Correctness wins over memory optimization.

---

## 7. Part ComponentDefinition lifecycle

### Safe V1

A unique generated SU ComponentDefinition per rendered part instance is acceptable if performance is adequate.

Each generated SU definition can still carry/associate a stable authoring `componentDefinitionId`; uniqueness of the host definition does not force catalog/business identity changes.

### Optional immutable sharing

Part definitions may be reused when all geometry inputs are equivalent and the host definition is treated as immutable.

Conceptually:

```text
resolvedGeometrySignature = canonical(
  authoring/component definition identity,
  local dimensions,
  geometry variant/model parameters,
  visual geometry features represented in SketchUp
)
```

Then:

```text
signature S1 -> immutable SU Part Definition S1
CI-A -> instance of S1
CI-B -> instance of S1
```

If CI-B later resolves to different geometry:

```text
CI-B S1 -> resolve S2 -> rebind/recreate with S2
```

Never mutate S1 in-place if unrelated live instances use it.

### Material and sharing

Material alone does not necessarily split a geometry definition when instance-level material is sufficient. However:

- manufacturing material ID remains resolved Granete truth;
- if material thickness changes geometry, the geometry signature changes;
- grain/texture orientation may later require visual-signature inputs.

Do not use the geometry signature as business identity.

---

## 8. Local geometry and axes

### Current engine convention

The Go layout engine already models an intermediate board with:

```text
local X = widthMm
local Y = thicknessMm
local Z = lengthMm
```

The current public layout also exposes a workshop/world AABB for the simple renderer.

### Target rule

A part SU ComponentDefinition is built at local origin using the resolved local frame.

The ComponentInstance transform then places/orients it inside its parent furniture/subassembly.

### Why AABB-only is insufficient

A world AABB answers what box encloses a rotated part; it does not preserve original local axes.

A native part needs:

```text
local geometry/dimensions
+
local-to-parent transform
```

Therefore #414 extends the resolved layout with authoritative orientation/transform. Ruby must not reconstruct rotations from `slotId`, role names or dimension sorting.

### Rotation representation

The transport may use quaternion, rigid matrix, orthonormal basis or an equally deterministic form. AABB may remain as convenience/backward compatibility.

### Scale

Managed productive parts must not use non-uniform SketchUp scaling as a substitute for parametric regeneration.

Correct:

```text
parameter/material change
→ Granete re-resolves
→ new local geometry/definition
→ instance transform
```

Incorrect:

```text
scale existing productive part to new dimensions
```

---

## 9. Material-aware resolution interaction

The native entity model does not change material ownership. It changes where the resolved result is rendered.

Canonical flow:

```text
Furniture authoring intent
  + materialChoices
        ↓
resolve selected MaterialBoard
        ↓
effective thickness T
        ↓
formulas / local dimensions / poses
        ↓
authoritative local part transform
        ↓
resolved layout
        ↓
SketchUp ComponentInstance hierarchy
```

See `material-aware-furniture-resolution.md`.

### Material change

```text
BODY = White 16
→ BODY = White 18
```

Granete re-resolves all BODY-bound components. SketchUp updates the native hierarchy atomically.

Ruby does not `pushpull` by the delta and does not non-uniformly scale the part.

If an immutable shared SU part definition no longer matches, the affected instance is rebound/recreated using the newly resolved definition.

### Relationship to #404

#404 owns material-change re-resolve/rebuild behavior, but its final target is #415's native hierarchy. Implementing #404 as final Group-only architecture would create immediate rework.

---

## 10. Transform ownership

### Furniture world transform

The top-level Furniture ComponentInstance owns user-controlled world placement in SketchUp:

- move;
- rotation;
- future snap/alignment;
- room/wall placement context where represented.

A material/parameter rebuild preserves this outer transformation.

### Child local transform

Part/subassembly transforms are resolved relative to the furniture/subassembly frame. Ruby applies them generically.

### Manual part movement

Native drill-down does not automatically authorize arbitrary direct part movement as manufacturing truth.

When a future interaction allows moving a shelf/hinge:

```text
host interaction
→ explicit semantic authoring intent
→ Granete resolution
→ feedback/rebuild
```

Not:

```text
scan changed geometry
→ infer industrial truth
```

---

## 11. Selection and Outliner

### Primary selection

Normal selection resolves the managed top-level furniture for:

- move/rotate;
- dimensions;
- material roles;
- parameters;
- Project Furniture identity.

### Drill-down

Nested ComponentInstances enable contextual inspection of one door/front/shelf/side/hardware/subassembly.

Selection handling may walk `InstancePath`/parent ownership to recover the owning furniture and selected semantic entity.

### Names

Human-readable names are encouraged:

```text
Bajo 600 · FI-1042
Lateral izquierdo
Entrepaño 1
Puerta izquierda
```

Names are labels only. Rename never mutates contract IDs.

### Outliner

The hierarchy should be understandable without implementation-only wrappers. Do not add a nesting level solely to hold metadata when metadata belongs on a semantic entity.

---

## 12. Metadata placement

### Furniture instance

At minimum:

- schema/metadata version;
- `kind = furnitureInstance`;
- `furnitureInstanceId` once Project-owned identity is available;
- compatibility `instanceRef` only while migration requires it;
- `furnitureDefinitionId`;
- parameters;
- material choices;
- Project/Design references where owned by the current Digital Thread stage.

### Part/component instance

At minimum where available:

- semantic kind;
- `componentInstanceId`;
- `componentDefinitionId` (stable authoring-definition ID);
- `catalogComponentId`/catalog reference when applicable;
- `slotRef`;
- physical/semantic role;
- material binding role;
- owning furniture reference when useful for migration/diagnostics.

### Host definition metadata

When a generated/imported SU ComponentDefinition participates in managed authoring, it may store the corresponding Granete authoring `componentDefinitionId` plus generation/schema metadata.

Its native GUID remains technical-only.

### Derived manufacturing feedback

May be cached/displayed only under the read-only resolved-feedback rules. It does not become editable authoring truth.

---

## 13. Copy, duplicate and make-unique behavior

SketchUp host duplication and Granete physical identity duplication are different operations.

### User copies managed furniture

Immediately after a raw host copy, both instances may temporarily contain copied metadata. That state is not publishable business truth.

#391 owns normalization:

```text
copy FI-001 host instance
→ detect duplicate furnitureInstanceId
→ original keeps FI-001
→ create new Project FurnitureInstance FI-XYZ
→ rewrite copied instance metadata
→ isolate copied top-level SU definition
→ preserve duplicate provenance
```

The implementation may use `make_unique` or explicit generated-definition rebinding as a host mechanism. That operation does not define the new business ID.

If the server cannot allocate/validate identity, the copy is explicitly unsynced/invalid for publish.

---

## 14. Rebuild and atomicity

A managed furniture rebuild can be triggered by:

- dimensions/parameters;
- material choices;
- component model choice;
- agregado configuration;
- hardware configuration;
- future semantic relationship changes.

Required transaction shape:

```text
1. resolve/validate new layout
2. prepare definitions/assets/material references
3. start coherent SketchUp operation
4. replace/rebind managed child hierarchy
5. write metadata for accepted state
6. commit
```

On failure:

```text
abort
→ previous valid furniture remains
```

A successful rebuild preserves:

- `furnitureInstanceId`;
- top-level world transform;
- Project/Design relationship;
- current accepted authoring intent.

Child `persistent_id`s and native definition GUIDs may change during regeneration. Granete contract IDs are the durable semantic link.

---

## 15. Subassemblies and agregados

Do not confuse:

```text
Granete Agregado/domain composition
SketchUp semantic subassembly wrapper
manufacturing physical part
```

An agregado can resolve directly into several managed part instances without a visible wrapper if no independent interaction/identity is needed.

Create a subassembly ComponentInstance when at least one is true:

- stable authoring identity;
- moves/configures as one semantic unit;
- inspector supports selecting it;
- relationships/anchors target the aggregate scope;
- reusable host asset/assembly should remain nested.

Avoid fixed “three-level hierarchy” language.

---

## 16. Hardware and assets

### Loaded assets

Hardware assets loaded through `AssetResolver` naturally instantiate as SU ComponentInstances.

Granete hardware/placement IDs remain metadata/catalog references separate from native definition GUIDs.

### Generated fallback

Fallback visible hardware uses a semantic ComponentInstance wrapper with generated local geometry.

### Cost-only hardware

No valid visual preview means no scene entity, matching current layout behavior.

### Asset internals

Nested groups/components authored inside an asset are not automatically Granete manufacturing parts.

---

## 17. Complex part geometry

A part does not have to remain a rectangular box forever.

Example:

```text
Door Part ComponentInstance
└── ComponentDefinition
    ├── profile/panel geometry
    ├── grooves/visual details
    └── internal helper groups if needed
```

The outer semantic ComponentInstance remains one Granete component/part when manufacturing semantics say it is one physical part.

If a framed door is actually manufactured as distinct rails/stiles/panel parts, Granete's manufacturing/domain model must represent those parts explicitly. Host geometry nesting never overrides domain part semantics.

---

## 18. OpenCutList and third-party interoperability

Granete benefits from being a good SketchUp citizen but does not depend on third-party cut-list semantics.

Target properties:

- physical boards as solid native ComponentInstances;
- meaningful local axes;
- sensible names;
- visible board materials;
- traversable semantic nesting;
- namespaced Granete metadata.

Authority boundary:

```text
OpenCutList result = interoperability/user convenience
Granete BOM        = authoritative manufacturing result
```

#417 runs a real host smoke against an explicit OpenCutList version and records:

- recognized boards;
- dimensions/orientation;
- material interpretation;
- nesting behavior;
- safe conventions if needed;
- limitations.

No compatibility claim is made before evidence.

---

## 19. Legacy Group representation migration

Existing `.skp` files may contain the current Granete Group-based hierarchy with valid metadata.

#416 defines representation migration:

```text
legacy Granete Group
→ validate namespaced metadata
→ preserve known identity/intent
→ re-resolve layout
→ build native ComponentInstance hierarchy
→ replace atomically
→ mark representation schema migrated
```

Migration must not:

- infer identity from geometry/name/location;
- create a new FurnitureInstance merely because host entity type changed;
- convert arbitrary user groups silently;
- delete original geometry before replacement validates;
- pretend a local legacy `instanceRef` is already Project-owned identity.

#416 answers host representation migration. #397 answers business adoption into Project/Design. They are related but distinct.

---

## 20. Project Digital Thread consequences

The native entity decision strengthens rather than replaces Digital Thread contracts.

### #388 — model binding

Model-level Project/Design metadata remains independent from host definition IDs.

### #389 — Place existing FurnitureInstance

Placement uses #415 native hierarchy. Do not implement a final Group-only placement path.

### #390 — Catalog insertion

Connected design-first insertion creates/obtains the Project FurnitureInstance before rendering the native hierarchy.

### #391 — Duplicate identity

Detection applies to top-level managed ComponentInstances. Business identity allocation and host-definition isolation are separate steps.

### #392 — Publish revision

Publish semantic managed authoring state; do not treat every SketchUp ComponentInstance as productive automatically. Unmanaged architecture/decor remains outside manufacturing input.

### #397 — Adopt existing `.skp`

Recognize native Granete components, legacy Granete Groups, unmanaged geometry and corrupt/foreign identity.

### #398 — Digital Thread E2E

Assert the canonical managed host representation needed by the scenario; leave low-level axes/OCL checks to #417.

---

## 21. Material program consequences

### #402

Effective thickness remains server/domain-owned.

### #403

Material binding role is semantic intent and independent from SketchUp names.

### #404

Hard prerequisite #415. Rebuild updates native ComponentInstances/definitions safely.

### #405

Ruby assertions include:

- native parts consume resolved local dimensions/transform;
- no local thickness or rotation inference;
- affected role parts are rebound/rebuilt;
- unaffected roles/furniture do not change through shared-definition side effects.

---

## 22. Performance and generated-definition cleanup

Native definitions introduce lifecycle concerns absent from the Group MVP:

- unused generated definitions after repeated rebuilds;
- definition naming namespace;
- safe cleanup only when no live instances reference a generated definition;
- asset definitions managed separately from generated board definitions;
- avoiding uncontrolled definition growth during inspector edits.

A safe V1 may create isolated definitions and perform scoped cleanup after commit. Do not call broad purge operations that could remove user/third-party definitions.

Performance optimizations must preserve undo correctness, identity isolation and immutable-sharing rules.

---

## 23. Naming and namespaces

Suggested generated names are diagnostic only:

```text
Granete · Furniture · <display name> · <short FI id>
Granete · Part · <role> · <short CI id>
```

If immutable shared geometry definitions are introduced:

```text
Granete · PartGeom · <signature-prefix>
```

Attribute dictionaries remain Granete namespaced. Do not use OpenCutList or another extension's dictionary as Granete storage.

---

## 24. Non-goals

This architecture does not:

- make a native SketchUp ComponentDefinition GUID the Granete authoring/catalog ID;
- equate `componentDefinitionId` with `catalogComponentId`;
- make arbitrary SketchUp components productive parts automatically;
- scan geometry to derive authoritative BOM;
- move machining/drilling rules to Ruby;
- guarantee OpenCutList equivalence;
- require every visual helper to be a component;
- require definition deduplication in V1;
- preserve derived child native IDs across every rebuild;
- authorize freeform productive-part edits without semantic authoring contracts.

---

## 25. Verification matrix

| Concern | Required proof | Owner |
|---|---|---|
| local board frame + transform | Go/API contract tests | #414 |
| top-level furniture entity type | Ruby unit/host tests | #415 |
| physical board entity type | Ruby unit/host tests | #415 |
| definition isolation FI-A vs FI-B | Ruby regression | #415/#417 |
| material thickness geometry | TS/Go/Ruby parity | #402/#405 |
| material rebuild native hierarchy | Ruby host/round-trip | #404/#405 |
| copy creates new business identity | Ruby+backend | #391/#398 |
| legacy Group migration | Ruby migration fixtures | #416 |
| adoption mixed managed/unmanaged | Ruby+backend workflow | #397 |
| OpenCutList visibility/dimensions | real host compatibility smoke | #417 |
| manufacturing output unaffected by host representation | golden/E2E | #354 |

---

## 26. Implementation order

Recommended order:

```text
material contract #409 merged
        ├── #402 effective thickness
        └── #403 material binding roles

native entity contract #418 merged
        ↓
#414 resolved local transform/orientation
        ↓
#415 native ComponentInstance renderer
        ├── #404 material rebuild on native hierarchy
        │      ↓
        │    #405 material parity
        ├── #416 legacy Group migration
        │      ↓
        │    #397 adoption integration
        └── #417 native host/OCL validation

#389/#391 consume #415.
```

Scheduling rule:

> **Do not finish #404, #389 or #391 against the Group renderer if #415 has not established the native target first.**

---

## 27. Acceptance scenario

A 600 mm base cabinet is inserted with:

```text
BODY  = White 16
FRONT = Oak 18
BACK  = White 6
```

Expected representation:

```text
Base Cabinet FI-001 (ComponentInstance)
├── Left side CI-01 (ComponentInstance, local T=16)
├── Right side CI-02 (ComponentInstance, local T=16)
├── Bottom CI-03 (ComponentInstance, local T=16)
├── Top CI-04 (ComponentInstance, local T=16)
├── Shelf CI-05 (ComponentInstance, local T=16)
├── Back CI-06 (ComponentInstance, local T=6)
└── Door CI-07 (ComponentInstance, local T=18)
```

The user rotates the whole cabinet 90°. Local part axes remain meaningful because the furniture world transform composes with child transforms.

Then FRONT changes to 16 mm. Granete resolves new front geometry. SketchUp:

- preserves FI-001;
- preserves furniture world transform;
- changes/rebinds CI-07 geometry to T=16;
- leaves BODY/BACK unchanged;
- does not modify another cabinet FI-002;
- commits one undoable operation.

A cut-list extension may inspect the resulting solid part components; Granete BOM remains production authority.

---

## 28. Final rules

1. **Granete contract/business identity is authoritative; native SketchUp IDs are locators.**
2. **Furniture and physical managed parts are native ComponentInstances.**
3. **`componentDefinitionId` is a stable authoring-contract ID, not the native SU GUID and not automatically a catalog ID.**
4. **Local geometry + authoritative transform replaces world-AABB baking.**
5. **Top-level host definitions are isolated per FurnitureInstance in V1.**
6. **Shared part host definitions, if used, are immutable.**
7. **Parametric/material changes regenerate/rebind; they do not non-uniformly scale productive parts.**
8. **Semantic nesting only—no wrapper inflation.**
9. **Legacy representation migration and business adoption are separate.**
10. **OpenCutList compatibility is useful evidence, never manufacturing authority.**
11. **This native model is the target for material rebuild, Digital Thread placement/copy and future SketchUp interaction work.**
