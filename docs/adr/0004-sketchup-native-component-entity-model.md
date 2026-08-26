# ADR-0004 — Native SketchUp Component Entity Model

- **Status:** Accepted target
- **Date:** 2026-08-26
- **Decision owners:** Granete architecture / Granete for SketchUp
- **Tracking:** #413, #418
- **Related:** ADR-0001, ADR-0003, #290, #346, #384, #401

## Context

Granete for SketchUp currently renders a resolved furniture layout using a top-level SketchUp `Group` and nested `Group`s containing generated box geometry. This proved the remote-layout architecture quickly, but it is no longer the right long-term host representation.

Granete now needs:

- stable furniture/component instance identity;
- part-level selection and inspection;
- local board axes independent from furniture world rotation;
- safe parametric/material rebuilds;
- copy/duplicate semantics integrated with Project-owned `FurnitureInstance` identity;
- native Outliner structure;
- reasonable interoperability with component-oriented woodworking extensions;
- future complex component geometry beyond AABB boxes.

SketchUp distinguishes `ComponentDefinition` from `ComponentInstance`. That distinction is useful for representation/reuse, but it must not be confused with Granete's business/catalog/authoring identities.

The existing SketchUp authoring contract (#346) already distinguishes:

- `componentDefinitionId`: stable reusable **authoring-definition identity** managed by the Granete contract;
- `componentInstanceId`: concrete authoring/component occurrence;
- optional `catalogComponentId`: catalog provenance/reference.

A native SketchUp ComponentDefinition may carry/be associated with a `componentDefinitionId`, but its host-generated GUID is not that contract ID. Likewise `componentDefinitionId` is not automatically `catalogComponentId`.

The current resolved layout exposes local board dimensions but only an AABB-oriented public translation. Native parts also need authoritative local orientation/transform so Ruby does not duplicate placement logic.

The material-aware program (#401) introduces atomic re-resolution/rebuild. Hardening that final rebuild against Groups first would create immediate rework once native components arrive.

## Decision

Granete adopts native SketchUp `ComponentInstance` as the canonical host entity for managed furniture and managed physical parts.

### 1. Furniture

Each managed physical `FurnitureInstance` is represented by a top-level `Sketchup::ComponentInstance`.

For V1, each FurnitureInstance receives an isolated generated SketchUp top-level `ComponentDefinition`, even when several furniture units reference the same Granete `FurnitureDefinition`.

The SU definition is a host implementation container and does not replace `furnitureDefinitionId` or `furnitureInstanceId`.

### 2. Physical component/part

Each resolved managed physical board/front/panel is represented by a nested `Sketchup::ComponentInstance` whose definition contains local geometry at origin and whose instance transform positions/orients it relative to the parent.

### 3. Authoring definition identity

`componentDefinitionId` remains the stable reusable definition ID of the Granete authoring contract established by #346.

Rules:

```text
componentDefinitionId != SketchUp ComponentDefinition GUID
componentDefinitionId != catalogComponentId (unless a future schema explicitly maps them)
```

A generated/imported SU ComponentDefinition may store the Granete `componentDefinitionId` in namespaced metadata. The native GUID remains a technical locator.

### 4. Concrete component identity

`componentInstanceId` identifies the concrete authoring/component occurrence and lives on the nested managed instance metadata. Relationships and hardware hosts continue to target concrete instance IDs according to the manufacturing contract.

### 5. Subassemblies

Additional ComponentInstance nesting exists only for a semantic aggregate/subassembly with real authoring identity, interaction, selection or movement/configuration value. No fixed three-level wrapper hierarchy is mandated.

### 6. Hardware

Visible hardware uses ComponentInstances whether loaded from `.skp` assets or generated as fallback geometry. Cost-only hardware remains non-visual.

### 7. Host identity ownership

Granete contract/business IDs remain authoritative. SketchUp definition GUID, `entityID`, `persistent_id`, name and geometry hash are locators/labels only.

### 8. Definition sharing

Top-level furniture SU definitions are isolated per FurnitureInstance in V1.

Part SU definitions may also be unique initially. Sharing is permitted only for generated **immutable** definitions keyed by a deterministic resolved geometry signature. When geometry changes, an instance rebinds/recreates against another definition; shared definitions are not mutated in-place.

The geometry signature is an optimization key, not a business/authoring ID.

### 9. Local frame

The resolved-layout contract must provide local board geometry plus authoritative local-to-parent orientation/transform. Ruby applies it generically and must not infer rotation from `slotId`, role names or AABB dimensions.

Retain the current board-local convention unless deliberately versioned:

```text
X = widthMm
Y = thicknessMm
Z = lengthMm
```

### 10. Regeneration vs scaling

Managed productive geometry is regenerated/rebound when parameters/material thickness change. Non-uniform SketchUp scaling is not used to encode manufacturing dimensions.

### 11. Material rebuild sequencing

#404 targets this native hierarchy and therefore depends on #415. Material/manufacturing truth remains server/domain-owned.

### 12. Legacy models

Current Granete Group-based entities are legacy managed representation. They receive explicit migration (#416) that preserves known identity/intent and rebuilds from authoritative layout.

Business adoption of an existing `.skp` remains a separate Digital Thread workflow (#397).

### 13. Third-party interoperability

Granete intentionally becomes a better native SketchUp citizen. OpenCutList and similar tools may inspect native solid component parts, but their output is compatibility/user convenience only. Granete BOM/manufacturing remains authoritative.

## Consequences

### Positive

- native part selection/Outliner;
- stable local part axes;
- better fit with SketchUp host concepts;
- safer complex geometry evolution;
- controlled definition reuse;
- clearer copy/duplicate behavior;
- improved interoperability potential;
- removes world-AABB baking as canonical part model;
- preserves #346 distinction between authoring definition, concrete instance and catalog reference.

### Costs

- renderer becomes more complex than `Group + faces + pushpull`;
- generated definition lifecycle/cleanup must be managed;
- layout DTO needs authoritative orientation/transform;
- tests/stubs must model ComponentDefinition/ComponentInstance behavior;
- current Group-based `.skp` files need representation migration.

### Risks and mitigations

#### Shared-definition side effects

Mitigation: isolated top-level definitions in V1 and immutable-only sharing for generated part definitions.

#### Definition accumulation

Mitigation: scoped generated-definition lifecycle/cleanup. Broad purge operations that may delete user/third-party definitions are forbidden.

#### Identity confusion

Mitigation: explicit namespaces and terminology. Contract IDs are Granete-managed; native GUIDs/persistent IDs remain technical.

#### Renderer reintroduces domain logic

Mitigation: #414 exposes a sufficient server-resolved local pose contract. Ruby only builds local geometry/applies transforms.

#### OpenCutList drives manufacturing semantics

Mitigation: OCL support is a validation target (#417), not manufacturing authority.

## Alternatives considered

### A. Keep Groups for furniture and parts

Rejected as long-term canonical model. Simple, but weak for explicit definition/instance semantics, local axes and component-oriented interoperability.

### B. Furniture Group + Part ComponentInstances

Technically viable and common in woodworking models. Rejected for Granete because the furniture itself has stable physical identity, placement, duplicate lifecycle and Project/Design semantics; a top-level ComponentInstance is the more consistent host abstraction.

### C. Share one mutable top-level SU ComponentDefinition per Granete FurnitureDefinition

Rejected for V1. Two physical units may diverge independently; editing one shared definition could silently change all instances.

### D. Unique SU ComponentDefinition for every object forever

Safe but potentially wasteful. Accepted as a valid V1 strategy for parts, but immutable geometry-signature sharing may be added after correctness/performance evidence.

### E. Wrap current world AABB boxes in ComponentInstances

Rejected. That would change entity class without preserving meaningful local axes. #414 must expose the authoritative local pose first.

### F. Use native SketchUp GUID as `componentDefinitionId`

Rejected. Host GUID is an implementation locator; the authoring contract needs stable, versioned semantics independent from host internals/migrations.

### G. Reuse catalog component ID as `componentDefinitionId`

Rejected as a blanket rule. Catalog provenance and an authoring reusable definition are distinct concerns; the existing schema already supports `catalogComponentId` separately.

## Implementation impact

- #414 — resolved local transform/orientation contract;
- #415 — native renderer + definition lifecycle;
- #416 — legacy Group representation migration;
- #417 — real host/interoperability validation.

Existing work is aligned rather than duplicated:

- #404 material rebuild depends on #415;
- #405 validates material behavior on native parts;
- #389 placement uses #415 hierarchy;
- #391 copy/duplicate handles both new business identity and host-definition isolation;
- #397 adoption consumes #416;
- #398 includes native-host invariants in Digital Thread E2E.

## Verification

This ADR is considered implemented only when:

1. resolved layout exposes authoritative local part orientation;
2. newly inserted furniture/physical boards are ComponentInstances;
3. two FurnitureInstances diverge without host-definition side effects;
4. authoring `componentDefinitionId` survives independently from native SU GUID;
5. catalog reference remains distinct when present;
6. material/parameter rebuild preserves furniture identity/world transform;
7. legacy Groups migrate safely;
8. real SketchUp host validation and documented OpenCutList smoke exist.
