# Native SketchUp Entity Model for Granete

> **Estado:** CANONICAL TARGET  
> **Fecha:** 2026-08-26  
> **Tracking:** #413, #414, #415, #416, #417, #418  
> **Programas relacionados:** #290 (Granete for SketchUp), #384 (Project Digital Thread), #401 (material-aware resolution)  
> **ADR:** `docs/adr/0004-sketchup-native-component-entity-model.md`  
> **Invariante central:** **Granete owns business/manufacturing identity and resolution; SketchUp owns authoring interaction and native host representation.**

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
    │   Granete metadata: furniture identity + authoring intent
    │   SU definition: unique per FurnitureInstance in V1
    │
    ├── Board Part SU ComponentInstance
    │   │ Granete metadata: componentInstanceId, role, slot, material binding
    │   └── SU ComponentDefinition
    │       └── local solid geometry at origin
    │
    ├── Board Part SU ComponentInstance
    ├── Hardware SU ComponentInstance
    └── optional semantic Aggregate/Subassembly SU ComponentInstance
        ├── Board Part SU ComponentInstance
        └── Hardware SU ComponentInstance
```

The key change is not cosmetic. A physical managed part becomes a native SketchUp object with:

- a reusable/isolated geometry definition;
- an instance transformation;
- local axes;
- instance metadata;
- predictable selection/Outliner behavior.

---

## 3. Why ComponentInstance is the canonical managed host entity

A SketchUp `ComponentInstance` represents one placement of a `ComponentDefinition` with its own transformation. This matches the distinction Granete already needs between reusable description and concrete physical/semantic occurrence.

The mapping is useful but **not identity equivalence**:

```text
Granete domain                    SketchUp host
------------------------------    --------------------------------
FurnitureDefinition               catalog/business template
FurnitureInstance                 top-level SU ComponentInstance
ComponentDefinition               Granete catalog/component recipe
ComponentInstance                 nested SU ComponentInstance
resolved board geometry           SU ComponentDefinition entities
resolved placement                SU ComponentInstance transform
```

SketchUp definitions and instances are an implementation mechanism. Granete IDs remain authoritative.

### Benefits

- physical parts are selectable native entities;
- local axes survive furniture world movement/rotation;
- Outliner has meaningful structure;
- component-based woodworking extensions can inspect physical boards;
- complex part geometry can evolve beyond rectangular boxes without changing identity semantics;
- instance vs definition sharing can be controlled explicitly;
- material/parameter rebuilds can replace definitions without scaling productive geometry.

### Why not Groups as the canonical model

Groups are valid SketchUp containers and remain useful for unmanaged/user geometry or internal complex geometry where appropriate. They are not chosen as the canonical Granete physical-part wrapper because the product needs explicit definition/instance semantics, local part axes, controlled reuse and interoperability with component-centric woodworking workflows.

This does **not** mean every nested geometric helper becomes a ComponentInstance. Only semantic managed entities do.

---

## 4. Canonical hierarchy and semantic levels

Granete does not impose an arbitrary fixed number of SketchUp nesting levels. Nesting follows semantic ownership.

### Level A — Furniture

One intended physical furniture unit:

```text
FurnitureInstance FI-001
↔ top-level Sketchup::ComponentInstance
```

The top-level instance is the normal selection/move/rotate unit in SketchUp.

### Level B — Physical managed part

A concrete board/panel/front or other Granete component instance:

```text
ComponentInstance CI-left-side-001
↔ nested Sketchup::ComponentInstance
```

The part instance can be inspected through drill-down and keeps local part axes.

### Optional Level B/C — Semantic subassembly/agregado

Create a native subassembly wrapper only when it has real semantic value, for example:

- drawer assembly;
- pull-out pantry assembly;
- door system assembly;
- agregado that is independently selectable/configurable/positioned;
- another nested domain object with stable authoring identity.

Do not create wrappers merely because a renderer function needs a container.

### Hardware

Visible hardware is a ComponentInstance when represented by a loaded SketchUp asset or by generated fallback geometry. Cost-only/non-visible hardware remains absent from the visual model according to the existing layout contract.

---

## 5. Identity model: four Granete identities vs SketchUp locators

The words “definition” and “instance” exist in both Granete and SketchUp. They must never be conflated.

| Concept | Example | Stored where in SketchUp | Authority |
|---|---|---|---|
| `furnitureInstanceId` | `FI-1042` | top-level instance metadata | Project business identity |
| `furnitureDefinitionId` | `base-cabinet-standard` | furniture metadata/catalog reference | Granete catalog |
| `componentInstanceId` | `CI-8891` | nested instance metadata | Granete semantic/physical instance |
| `componentDefinitionId` | `door-flat-v2` | nested instance metadata/catalog reference | Granete catalog |
| SU ComponentDefinition GUID | host-generated | technical/debug only | SketchUp implementation detail |
| SU Entity `persistent_id` | host-generated integer | optional technical locator | SketchUp implementation detail |
| display name | `Puerta izquierda` | instance/definition name | user-facing label only |

### Hard rule

```text
Granete componentDefinitionId != SketchUp ComponentDefinition GUID
Granete furnitureInstanceId   != SketchUp persistent_id
```

Names, GUIDs, `entityID`, array index, geometry hash and file path are never Granete business primary keys.

### Metadata terminology in Ruby

Prefer explicit host names in code when ambiguity exists:

```ruby
furniture_su_instance
part_su_instance
part_su_definition
```

Avoid a generic `component_definition_id` variable when it is unclear whether it means a Granete catalog ID or a SketchUp definition locator.

---

## 6. Furniture ComponentDefinition lifecycle

### 6.1 V1 decision: unique definition per FurnitureInstance

Two furniture units may reference the same Granete `FurnitureDefinition` while having different parameters, materials, transforms, hardware or later design history.

Therefore V1 uses:

```text
FI-A -> SU Furniture Definition A
FI-B -> SU Furniture Definition B
```

Even when both originate from the same catalog item.

### Why

If FI-A and FI-B shared a mutable SketchUp top-level definition, rebuilding the internals of FI-A could mutate FI-B automatically. That would violate Project-owned physical identity and make one furniture edit unexpectedly modify another.

### Allowed future optimization

A future implementation may share immutable generated top-level definitions only if copy-on-write / `make_unique` semantics and business identity isolation are proven by tests. It is not required for the initial implementation.

Correctness wins over memory optimization.

---

## 7. Part ComponentDefinition lifecycle

### Safe V1

Unique generated definition per rendered physical part instance is acceptable and is the recommended simplest implementation if performance is adequate.

### Optional immutable sharing

Part definitions may be reused when all definition-geometry inputs are identical and the definition is treated as immutable.

Conceptually:

```text
resolvedGeometrySignature = canonical(
  geometry model identity,
  local dimensions,
  shape/profile parameters,
  visual geometry features represented in SketchUp
)
```

Then:

```text
signature S1 -> immutable SU Part Definition S1
Part CI-A -> instance of S1
Part CI-B -> instance of S1
```

If CI-B later resolves to different geometry:

```text
CI-B S1 -> resolve S2 -> rebind/recreate instance with definition S2
```

Never:

```text
edit shared definition S1 in place
→ accidentally mutate CI-A and CI-B
```

### Material and definition sharing

A visual material change does not necessarily require a new geometry definition if SketchUp instance-level material application correctly represents the desired appearance. Nevertheless:

- material ID and effective thickness remain Granete resolved truth;
- if material thickness changes geometry, the geometry signature necessarily changes;
- complex texture orientation/grain requirements may later require additional visual signature inputs.

Do not encode manufacturing identity into a geometry signature merely to optimize SketchUp definitions.

---

## 8. Local geometry and axes

### 8.1 Current engine convention

The Go layout engine already models an intermediate board in local dimensions:

```text
local X = widthMm
local Y = thicknessMm
local Z = lengthMm
```

The current public layout also exposes a world/workshop AABB for the simple renderer.

### 8.2 Target rule

A part ComponentDefinition is built at local origin:

```text
(0,0,0) -> (widthMm, thicknessMm, lengthMm)
```

or equivalent complex local geometry using the same semantic frame.

The corresponding ComponentInstance transformation positions/orients that part inside its parent furniture/subassembly.

### 8.3 Why AABB-only is insufficient

A world AABB answers “what box encloses this rotated part?” It does not preserve the part's original local axes.

A native woodworking part needs both:

```text
local geometry/dimensions
+
local-to-parent transform
```

Therefore #414 extends the resolved layout contract with authoritative orientation/transform data. Ruby must not reconstruct rotations from `slotId`, role names or dimension sorting.

### 8.4 Rotation representation

The transport representation may use:

- quaternion;
- orthonormal basis;
- rigid matrix;
- another deterministic representation.

The API must avoid ambiguous client-side reinterpretation. AABB may remain as a convenience/backward-compatible field.

### 8.5 Scale

Managed productive parts must not use non-uniform SketchUp scaling as a substitute for parametric regeneration.

Correct:

```text
width parameter changes
→ Granete re-resolves
→ new local geometry/definition
→ instance transform applied
```

Incorrect:

```text
scale existing board to new width/thickness
```

---

## 9. Material-aware resolution interaction

The native entity model does not change the material ownership contract. It changes **where the resolved result is rendered**.

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

### Rebuild on material change

Example:

```text
BODY = White 16 mm
→ user changes BODY = White 18 mm
```

Granete re-resolves all BODY-bound parts. SketchUp then updates the managed native hierarchy atomically.

The Ruby adapter does not `pushpull` by the thickness difference and does not scale a part instance.

If an immutable shared part definition no longer matches, the part instance is rebound/recreated using the newly resolved geometry definition.

### Relationship to #404

#404 remains the owner of material-change re-resolve/rebuild behavior, but its final implementation target is the native ComponentInstance model from #415.

Implementing #404 as a final Group-only architecture before #415 would create avoidable rework.

---

## 10. Transform ownership

### Furniture world transform

The top-level Furniture ComponentInstance owns the user-controlled world placement in the SketchUp model:

- move;
- rotation;
- future snap/alignment results;
- room/wall placement context where represented.

A parameter/material rebuild preserves this outer transformation.

### Child local transform

Part/subassembly transforms are server-resolved relative to the furniture/subassembly frame.

Ruby applies them generically.

### Manufacturing consequences of manual part edits

The native hierarchy makes drill-down technically possible, but it does not automatically authorize arbitrary direct movement of productive parts as manufacturing truth.

When Granete later supports moving a shelf/hinge in SketchUp:

```text
user host interaction
→ explicit authoring intent / semantic relationship change
→ Granete resolve
→ feedback/rebuild
```

Not:

```text
user moved a SU entity
→ infer manufacturing truth from arbitrary geometry scan
```

The interaction model and manufacturing contract remain authoritative for allowed authoring mutations.

---

## 11. Selection and Outliner behavior

### Primary selection

Normal single-click/selection should resolve the managed top-level furniture as the primary unit for:

- move/rotate;
- dimensions;
- furniture material roles;
- furniture parameters;
- Project Furniture identity.

### Drill-down

Nested ComponentInstances enable contextual inspection of:

- one door/front;
- one shelf;
- one side panel;
- one hardware item;
- one semantic agregado/subassembly.

Selection metadata must walk the InstancePath/parent hierarchy as needed to recover the owning furniture business identity.

### Names

Use human-readable names for SketchUp usability:

```text
Bajo 600 · FI-1042
Lateral izquierdo
Entrepaño 1
Puerta izquierda
```

Names are labels only. Renaming them does not mutate stable IDs.

### Outliner

The target hierarchy should be understandable without exposing implementation wrappers. Do not add a nesting level only to store metadata if metadata can live on the semantic entity itself.

---

## 12. Metadata placement

### Furniture instance metadata

At minimum:

- schema/metadata version;
- `kind = furnitureInstance`;
- `furnitureInstanceId` when Project-owned identity exists;
- compatibility `instanceRef` only while migration requires it;
- `furnitureDefinitionId`;
- parameters;
- material choices;
- Project/Design binding references where owned by the current Digital Thread stage.

### Part instance metadata

At minimum where available:

- `kind = componentInstance` or the versioned semantic kind chosen by the authoring schema;
- `componentInstanceId`;
- Granete `componentDefinitionId` / catalog component reference;
- `slotRef`;
- semantic physical role;
- material binding role (`optionRole` contract);
- owning furniture reference if required for diagnostics/migration.

Derived manufacturing details may be cached/displayed only under read-only resolved feedback rules. They do not become editable authoring truth.

### SketchUp technical locators

`persistent_id` may be stored in revision manifests as a technical locator when useful, but it remains replaceable and non-authoritative.

---

## 13. Copy, duplicate and Make Unique

SketchUp component behavior creates an important distinction between **host duplication** and **Granete physical identity duplication**.

### User copies a managed furniture ComponentInstance

Immediately after a raw host copy, both instances may temporarily carry copied metadata. That state is not publishable business truth.

#391 owns resolution:

```text
copy FI-001 SU instance
→ detect duplicate furnitureInstanceId
→ original remains FI-001
→ create new Project FurnitureInstance FI-XYZ
→ rewrite copied instance metadata to FI-XYZ
→ preserve duplicate provenance
```

### ComponentDefinition isolation

The copied furniture must not remain dependent on a mutable top-level definition shared with the original if future edits can diverge.

The implementation may call `make_unique` or create/rebind a dedicated generated definition as part of duplicate normalization.

### Failure

If the server cannot allocate/validate the new business identity, the copy is explicitly unsynced/invalid for publish. Do not invent an authoritative local Project ID.

---

## 14. Rebuild and atomicity

A managed furniture rebuild can be triggered by:

- dimensions/parameters;
- material choices;
- component model choice;
- agregado configuration;
- hardware placement/configuration;
- future authoring relationship changes.

### Required transaction shape

```text
1. resolve/validate new layout
2. prepare definitions/assets/material references
3. start coherent SketchUp operation
4. replace/rebind managed child hierarchy
5. write metadata for the accepted state
6. commit
```

On failure:

```text
abort operation
→ previous valid furniture remains
```

### Identity preservation

A successful internal rebuild preserves:

- owning `furnitureInstanceId`;
- top-level world transform;
- Project/Design relationship;
- current accepted authoring intent.

Child SketchUp `persistent_id`s do not need to survive regeneration unless a specific host feature requires them. Granete component business/semantic IDs are the durable contract.

---

## 15. Subassemblies and agregados

Do not confuse three concepts:

```text
Granete Agregado/domain composition
SketchUp semantic subassembly wrapper
manufacturing physical part
```

An agregado may resolve directly into several parts without needing a visible wrapper if there is no independent interaction/identity need.

Create a subassembly ComponentInstance when at least one is true:

- it has stable authoring identity;
- it moves/configures as one semantic unit;
- inspector supports selecting it;
- relationships/anchors target the aggregate scope;
- it corresponds to a reusable host asset/assembly that should remain nested.

Avoid fixed “three-level hierarchy” language. Use **semantic hierarchy** instead.

---

## 16. Hardware and assets

### Loaded `.skp` assets

Hardware assets loaded through `AssetResolver` naturally instantiate as SketchUp ComponentInstances.

Their Granete hardware identity and placement identity remain metadata/catalog references separate from the imported definition GUID.

### Generated fallback

Fallback visible hardware should be wrapped as a semantic ComponentInstance with generated local geometry so selection/metadata conventions remain consistent.

### Cost-only hardware

Hardware that has no valid visual preview remains absent from the scene. The native entity model does not change that existing rule.

### Asset internals

A hardware component definition may contain groups/components internally as authored by the asset creator. Granete does not reinterpret each nested helper as a manufacturing part unless the domain contract explicitly models it.

---

## 17. Complex part geometry

A board/front does not have to remain a rectangular box forever.

For example:

```text
Door Part ComponentInstance
└── ComponentDefinition
    ├── faces/profile geometry
    ├── grooves/panel visual geometry
    └── internal helper groups if needed
```

The outer semantic ComponentInstance remains one Granete part when manufacturing semantics say it is one part.

Conversely, a framed door that is manufactured as multiple distinct rails/stiles/panels should be represented by multiple Granete physical component/part instances if manufacturing truth requires that decomposition.

Host geometry hierarchy never overrides domain part semantics.

---

## 18. OpenCutList and third-party interoperability

Granete benefits from being a good SketchUp citizen, but it must not become dependent on third-party cut-list semantics.

### Target compatibility properties

- physical boards are solid native ComponentInstances;
- useful local axes;
- sensible component names;
- board material is visible on the part/instance;
- semantic nesting can be traversed without exploding furniture;
- Granete metadata is namespaced and does not overwrite third-party dictionaries.

### Authority boundary

```text
OpenCutList result = interoperability/user convenience
Granete BOM        = authoritative manufacturing result
```

If OpenCutList interprets a nested assembly differently, that difference is documented; Granete does not change BOM/domain rules merely to force identical third-party output.

### Verification

#417 owns a real host smoke with an explicit OpenCutList version and records:

- which boards are recognized;
- reported dimensions/orientation;
- material interpretation;
- nesting behavior;
- required safe naming/tag conventions if any;
- unsupported differences.

No compatibility claim is made before that evidence.

---

## 19. Legacy Group representation migration

Existing `.skp` models generated by Granete may contain the current Group-based hierarchy.

They are not arbitrary unmanaged files; they may contain useful Granete metadata and authoring intent.

#416 defines representation migration:

```text
legacy Granete Group
→ validate namespaced metadata
→ preserve known business/semantic identity
→ re-resolve authoritative layout
→ build native ComponentInstance hierarchy
→ replace atomically
→ mark representation schema migrated
```

### What migration must not do

- infer identity from geometry/name/location;
- create a new FurnitureInstance just because entity type changed;
- silently convert arbitrary user groups;
- destroy original geometry before replacement validates;
- pretend a local legacy `instanceRef` is already Project-owned identity.

### Relationship to Digital Thread adoption

#416 answers “how do we convert a known Granete Group representation?”

#397 answers “how do we connect/link/create business FurnitureInstances for an existing SketchUp model?”

They are related but distinct.

---

## 20. Project Digital Thread consequences

The native entity decision strengthens, rather than replaces, the Digital Thread contracts.

### #388 — model binding

Model-level Project/Design metadata does not depend on top-level entity class. Native components simply become the standard managed representation.

### #389 — Place existing FurnitureInstance

Placement must use #415's native hierarchy. Do not implement a new Group-only placement path.

### #390 — Catalog insertion

Connected design-first insertion creates the Project FurnitureInstance first, then renders its native component hierarchy.

### #391 — Duplicate identity

Detection applies to top-level managed ComponentInstances. SketchUp definition sharing is normalized separately from business identity.

### #392 — Publish revision

Published semantic manifest is generated from managed metadata/authoring state, not by treating every SketchUp component as productive. Unmanaged architecture/decor remains outside manufacturing input.

### #397 — Adopt existing `.skp`

Must recognize:

- current native Granete components;
- legacy Granete Groups;
- unmanaged components/groups;
- corrupt/foreign identity.

### #398 — Digital Thread E2E

Should assert that its SketchUp fixture uses the canonical native managed hierarchy, but leave low-level host/OCL verification to #417.

---

## 21. Material program consequences

### #402

Effective thickness resolution remains entirely server/domain-owned.

### #403

Material binding role remains semantic metadata/authoring intent and is independent from SketchUp component names.

### #404

Add hard prerequisite #415. Rebuild must update native part ComponentInstances and their immutable/unique definitions safely.

### #405

Its Ruby assertions should include:

- native part ComponentInstances consume resolved local dimensions/transform;
- no local thickness rewriting;
- affected role parts are rebound/rebuilt;
- unaffected furniture/roles do not change through shared-definition side effects.

---

## 22. Performance and definition cleanup

Native definitions introduce lifecycle concerns not present in the Group MVP.

Implementation must consider:

- unused generated definitions after repeated rebuilds;
- definition naming namespace;
- safe cleanup only when no live instances reference a definition;
- asset definitions managed separately from generated board definitions;
- avoiding uncontrolled definition growth during inspector edits.

A simple safe V1 may rebuild unique definitions and run scoped cleanup after commit. Do not call broad purge operations that could remove user or third-party definitions.

Performance optimizations must preserve undo correctness and identity isolation.

---

## 23. Naming and namespaces

Suggested generated definition names are diagnostic, not identity:

```text
Granete · Furniture · <display name> · <short FI id>
Granete · Part · <role> · <short CI id>
```

If immutable shared part definitions are later introduced:

```text
Granete · PartGeom · <signature-prefix>
```

Attribute dictionaries remain under the Granete namespace. Do not use OpenCutList or another extension's dictionary as Granete storage.

---

## 24. Non-goals

This architecture does not:

- make SketchUp ComponentDefinition the Granete component catalog;
- make arbitrary SketchUp components productive parts automatically;
- scan model geometry to derive authoritative BOM;
- move machining/drilling rules to Ruby;
- guarantee OpenCutList equivalence;
- require every visual helper to be a component;
- require definition deduplication in V1;
- preserve derived child SketchUp entity IDs across every rebuild;
- authorize freeform part edits without semantic authoring contracts.

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
| adoption of mixed unmanaged/managed model | Ruby+backend workflow | #397 |
| OpenCutList visibility/dimensions | real host compatibility smoke | #417 |
| manufacturing output unchanged by host representation | golden/E2E | #354 |

---

## 26. Implementation order

Recommended order after the documentation PR:

```text
material contract #409 merged
        │
        ├── #402 effective thickness
        └── #403 material binding roles

native entity contract #418 merged
        ↓
#414 resolved local transform/orientation
        ↓
#415 native ComponentInstance renderer
        ├── #404 material rebuild on native hierarchy
        │      ↓
        │    #405 material parity regression
        │
        ├── #416 legacy Group migration
        │      ↓
        │    #397 business adoption integration
        │
        └── #417 native host/OCL validation

Digital Thread #389/#391 consume #415 as prerequisite/reference.
```

The important scheduling rule is:

> **Do not finish the material rebuild (#404), Project Furniture placement (#389), or managed copy behavior (#391) against the Group renderer if #415 has not established the native target first.**

---

## 27. Acceptance scenario

A 600 mm base cabinet is inserted from Granete with:

```text
BODY  = White 16
FRONT = Oak 18
BACK  = White 6
```

Expected SketchUp representation:

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

The user rotates the whole cabinet 90° in the project. Part local axes remain meaningful because the furniture world transform composes with child local transforms.

The user changes FRONT to a 16 mm material. Granete resolves new front geometry. The SketchUp update:

- preserves FI-001;
- preserves the furniture world transform;
- changes/rebinds CI-07 geometry to T=16;
- does not touch BODY/BACK parts;
- does not modify another identical cabinet FI-002;
- commits as one undoable operation.

A cut-list extension may inspect the resulting solid part components, but Granete's BOM remains the production authority.

---

## 28. Final rules

1. **Business identity lives in Granete metadata, not SketchUp definitions.**
2. **Furniture and physical managed parts are native ComponentInstances.**
3. **Local geometry + authoritative transform replaces world-AABB baking.**
4. **Top-level definitions are unique per FurnitureInstance in V1.**
5. **Shared part definitions, if used, are immutable.**
6. **Parametric/material changes regenerate; they do not non-uniformly scale productive parts.**
7. **Semantic nesting only—no wrapper inflation.**
8. **Legacy representation migration and business adoption are separate problems.**
9. **OpenCutList compatibility is useful evidence, never manufacturing authority.**
10. **The native entity model is the target for material rebuild, Digital Thread placement/copy, and future SketchUp interaction work.**
