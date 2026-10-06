# ADR-0009 — Opening / Front System separated from Body Construction

- Status: **Proposed**
- Date: 2026-10-05
- Decision owners: Granete architecture
- Canonical detail: [`docs/architecture/opening-front-system.md`](../architecture/opening-front-system.md)

## Context

Granete models the furniture body (`Structure`), sub-assemblies (`Agregado`) and factory joinery policy (`joint.*`) independently. Opening and front behaviour are not yet modelled as independent concerns.

Today, grip options such as `jaladera-gola-*` primarily behave as hardware/BOM options. They do not fully express the geometry they imply: body modifications, front reductions, grip clearances, profile machining or non-uniform front layouts.

As a result, supporting gola, integrated profiles, bottom-reveal/overhang fronts and other opening systems through the current model would require creating separate structures for each combination of body construction and opening configuration. This leads to combinatorial growth and incorrect or manually maintained manufacturing dimensions.

## Decision

1. **Body construction and opening/front behaviour are independent architectural layers.**

   Body construction remains responsible for how the carcass is built. Opening/front behaviour is modelled independently.

2. **Opening/front behaviour is modelled through four independent concerns:**

   - `Opening Layout` — zones, ratios and access types.
   - `Grip System` — how and where the user grips the fronts.
   - `Opening Profile` — the physical profile or grip component and its manufacturing data.
   - `Front Positioning` — overlay, inset, overhang and related positioning rules.

3. **Any option that affects geometry, materials, hardware or manufacturing is a resolvable domain rule, not plain metadata or an unvalidated furniture flag.**

4. **The server-side resolver is the authority for the resulting manufacturing model.** It resolves the semantic selections into derived dimensions, body modifications, machining and BOM. TypeScript may provide parity calculations/previews, but must not become an independent source of truth.

5. **Opening Profiles are versioned library entities.** Their geometry and manufacturing behaviour must be backed by authoritative supplier/product data. Unknown required manufacturing values block authoring rather than being silently guessed.

6. **Opening Layout owns zone geometry; `Agregado` remains the authority for zone contents.** Agregados resolve against the bounding boxes produced by the opening layout rather than assuming a uniform `quantity`/`gapMm` stack.

7. **Factory capabilities for opening systems use the existing Library → Factory → Component overlay pattern under an `opening.*` namespace**, with a shared TS/Go contract.

8. **Availability and validity are separate concerns.** Factory capability settings govern new authoring. Existing designs remain valid against their pinned library release. Disabling a capability must never rewrite existing designs.

9. **Derived dimensions are resolver output and are read-only in clients.** Users edit semantic inputs such as construction, layout, grip and profile; they do not manually override dimensions governed by those rules.

## Consequences

### Positive

- A single parametric furniture definition can support multiple body × opening × layout combinations without duplicating structures.
- Opening systems become reusable across furniture types instead of being encoded into furniture-specific structures.
- Manufacturing consequences of gola and other opening systems become explicit and testable.
- React and SketchUp send semantic selections rather than independently calculating manufacturing dimensions.
- Factory configuration can control which opening capabilities are offered without changing the underlying Standard library.

### Negative

- A new server-side resolver and TS/Go parity contract are required.
- Existing `jaladera-gola-*` options require an explicit migration.
- Opening Profile authoring requires authoritative supplier data.
- Existing front-layout assumptions must be replaced by zone-based resolution.

## Rejected alternatives

### Furniture-level flags

Examples:

```text
gola = true
frontReduction = 40
golaType = aluminum
```

Rejected because these create an unvalidated collection of interacting flags and do not provide a coherent manufacturing model.

### One structure per combination

Examples:

```text
base-gola-alu-top
base-gola-alu-top-center-drawer
base-handle-overlay
...
```

Rejected because combinations grow combinatorially and duplicate the same body construction.

### Extending `factoryConstructionPolicy` to own opening behaviour

Rejected because `factoryConstructionPolicy` represents joinery/construction policy. Reusing its overlay mechanism as a pattern is appropriate, but making it the authority for opening systems would mix unrelated responsibilities.

## Scope boundary

This ADR establishes the architecture and authority boundaries for opening/front behaviour.

The concrete data contracts, compatibility matrix, profile schema, resolver rules, migration details and implementation sequence are defined in:

[`docs/architecture/opening-front-system.md`](../architecture/opening-front-system.md)