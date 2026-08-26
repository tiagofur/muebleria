# ADR-0004 — Native SketchUp Component Entity Model

- **Status:** Accepted target
- **Date:** 2026-08-26
- **Decision owners:** Granete architecture / Granete for SketchUp
- **Tracking:** #413, #418
- **Related:** ADR-0001, ADR-0003, #290, #384, #401

## Context

Granete for SketchUp currently renders a resolved furniture layout using a top-level SketchUp `Group` and nested `Group`s containing generated box geometry. This proved the remote-layout architecture quickly, but it is no longer the right long-term host representation for the product.

Granete now needs:

- stable furniture and component instance identity;
- part-level selection and inspection;
- local board axes independent from furniture world rotation;
- safe parametric/material rebuilds;
- copy/duplicate semantics integrated with Project-owned `FurnitureInstance` identity;
- native Outliner structure;
- reasonable interoperability with component-oriented woodworking extensions;
- future complex component geometry beyond world-axis-aligned boxes.

SketchUp's native model distinguishes `ComponentDefinition` from `ComponentInstance`. That distinction is useful for representation and reuse, but it must not be confused with Granete's own `FurnitureDefinition`, `FurnitureInstance`, `ComponentDefinition` and `ComponentInstance` concepts.

The current resolved layout exposes local board dimensions but only a world/workshop AABB translation to external clients. A native component model also needs authoritative part orientation/local transform so Ruby does not duplicate placement logic.

The material-aware program (#401) also introduces atomic re-resolution/rebuild. If that rebuild is hardened against the current Group renderer first, Granete would immediately need to rewrite it when native components arrive.

## Decision

Granete adopts native SketchUp `ComponentInstance` as the canonical host entity for managed furniture and managed physical parts.

### 1. Furniture

Each Granete-managed physical furniture unit is represented by a top-level `Sketchup::ComponentInstance`.

For V1, every Granete `FurnitureInstance` receives its own generated SketchUp top-level `ComponentDefinition`, even when multiple units reference the same Granete `FurnitureDefinition`.

Reason: independently editable physical units must not be coupled by mutable shared SketchUp definitions.

### 2. Physical board/part

Each resolved physical managed board/part is represented by a nested `Sketchup::ComponentInstance` whose definition contains local geometry at origin and whose instance transform positions/orients it relative to the furniture/subassembly.

### 3. Subassemblies

Additional ComponentInstance nesting exists only for a semantic aggregate/subassembly that has real authoring identity, interaction or movement/configuration value. No fixed three-level wrapper hierarchy is mandated.

### 4. Hardware

Visible hardware uses ComponentInstances whether loaded from `.skp` assets or generated as fallback geometry. Cost-only hardware remains non-visual.

### 5. Identity ownership

Granete IDs remain authoritative:

- `furnitureInstanceId`;
- `furnitureDefinitionId`;
- `componentInstanceId`;
- Granete `componentDefinitionId`.

SketchUp definition GUID, `entityID`, `persistent_id`, display name and geometry hash are technical locators/labels only.

A SketchUp `ComponentDefinition` GUID must never be exposed as Granete `componentDefinitionId`.

### 6. Definition sharing

Top-level furniture definitions are unique per FurnitureInstance in V1.

Part definitions may also be unique initially. Sharing is permitted only for generated **immutable** definitions keyed by a deterministic resolved geometry signature. A part that changes geometry rebinds/recreates against another definition; shared definitions are not mutated in-place.

### 7. Local frame

The resolved-layout contract must provide local board geometry plus authoritative local-to-parent transform/orientation. Ruby applies that transform generically and must not infer rotation from `slotId`, role names or AABB dimensions.

The current board-local axis convention is retained unless deliberately versioned:

```text
X = widthMm
Y = thicknessMm
Z = lengthMm
```

### 8. Regeneration vs scaling

Managed productive geometry is regenerated/rebound when parameters/material thickness change. Non-uniform SketchUp scaling is not used to encode manufacturing dimensions.

### 9. Material rebuild sequencing

#404 must target this native component hierarchy and therefore depends on the native renderer (#415). Material/manufacturing truth remains server/domain-owned.

### 10. Legacy models

Current Granete Group-based entities are legacy managed representation, not arbitrary unmanaged geometry. They receive an explicit migration path (#416) that preserves known identity/intent and rebuilds from authoritative resolved layout.

Business adoption of an existing `.skp` remains a separate Digital Thread workflow (#397).

### 11. Third-party interoperability

Granete intentionally becomes a better native SketchUp citizen. OpenCutList and similar tools may inspect native solid component parts, but their output is compatibility/user convenience only. Granete BOM/manufacturing outputs remain authoritative.

## Consequences

### Positive

- part-level native selection and Outliner structure;
- stable local part axes;
- better fit with SketchUp host concepts;
- safer evolution to complex door/part geometry;
- controlled definition reuse;
- clear interaction with copy/duplicate and Design identity;
- improved interoperability potential with woodworking extensions;
- eliminates world-AABB baking as the canonical part model.

### Costs

- renderer becomes more complex than `Group + faces + pushpull`;
- generated definition lifecycle/cleanup must be managed;
- shared definition safety requires explicit policy/tests;
- layout DTO needs authoritative rotation/transform fields;
- current Group-based `.skp` files need representation migration;
- tests/stubs must model ComponentDefinition/ComponentInstance behavior more accurately.

### Risks

#### Shared-definition side effects

Mitigated by unique top-level definitions in V1 and immutable-only part definition sharing.

#### Definition accumulation

Mitigated by scoped generated-definition lifecycle/cleanup; broad SketchUp purge operations are forbidden because user/third-party definitions may exist.

#### Identity confusion

Mitigated by explicit naming in contracts/code and the rule that SU GUID/persistent IDs are never business IDs.

#### Renderer reintroduces manufacturing logic

Mitigated by #414: server exposes the complete local pose contract. Ruby only builds local geometry and applies resolved transforms.

#### OpenCutList drives domain decisions

Mitigated by treating OCL support as a validation target (#417), never a manufacturing authority.

## Alternatives considered

### A. Keep Groups for furniture and parts

Rejected as the canonical long-term model. It remains simple but loses explicit definition/instance semantics, weakens component-centric interoperability, and does not naturally model reusable local part geometry.

### B. Furniture Group + Part ComponentInstances

Technically viable and common in woodworking SketchUp models. Rejected for Granete because the furniture itself has stable physical identity, placement, copy/duplicate behavior, Project/Design lifecycle and future semantic inspection. A top-level ComponentInstance provides the more consistent host abstraction.

### C. Share one top-level SketchUp ComponentDefinition per Granete FurnitureDefinition

Rejected for V1. Two physical furniture instances may diverge independently; mutating one shared definition would silently change all instances.

### D. Use one unique ComponentDefinition for every object forever

Safe but potentially wasteful. Accepted as a valid V1 implementation strategy for parts, but not mandated permanently. Immutable geometry-signature sharing may be added after correctness/performance evidence.

### E. Continue world AABB boxes inside Components

Rejected. Merely wrapping current AABB geometry in ComponentInstances would not preserve meaningful local axes and would force later rework. The layout contract must expose authoritative part orientation.

## Implementation impact

The decision is implemented through:

- #414 — resolved local transform/orientation contract;
- #415 — native renderer + definition lifecycle;
- #416 — legacy Group representation migration;
- #417 — host/interoperability validation.

Existing related work is updated rather than duplicated:

- #404 material rebuild depends on #415;
- #405 validates material behavior on native parts;
- #389 placement uses #415 hierarchy;
- #391 duplicate handling applies to top-level managed ComponentInstances;
- #397 adoption consumes #416;
- #398 includes native-host invariants in Digital Thread E2E.

## Verification

This ADR is considered implemented only when:

1. resolved layout exposes authoritative local part orientation;
2. newly inserted furniture and physical boards are ComponentInstances;
3. two furniture instances can diverge without definition side effects;
4. material/parameter rebuild preserves furniture identity/world transform;
5. legacy Groups can migrate safely;
6. real SketchUp host validation and documented OpenCutList smoke exist.
