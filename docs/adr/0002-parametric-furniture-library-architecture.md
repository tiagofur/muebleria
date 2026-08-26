# ADR-0002 — Universal Decoupled Architecture for Parametric Furniture Library

- **Status:** Accepted
- **Date:** 2026-08-24
- **Decision owners:** Product + Engineering
- **Program:** [SketchUp + Granete](../sketchup-granete-strategy.md)
- **Tracking:** [#290](https://github.com/tiagofur/muebleria/issues/290),
  [#347](https://github.com/tiagofur/muebleria/issues/347),
  [#349](https://github.com/tiagofur/muebleria/issues/349),
  [#350](https://github.com/tiagofur/muebleria/issues/350)

## Decision

> **A furniture library must never be coupled to a specific typology or class (such as "Cabinet").**
> **Every parametric furniture piece is an instance of `FurnitureDefinition`, composed dynamically of 7 decoupled domain primitives: `FurnitureDefinition`, `FurnitureInstance`, `ComponentDefinition`, `MaterialDefinition`, `MaterialAssignment`, `HardwareDefinition`, and `Asset`.**

### Core Tenets

1. **Category Agnosticism:** `FurnitureDefinition` contains zero hardcoded fields specific to a single furniture type (e.g. no fixed `doorCount`, `shelfCount`, or `drawerCount` at the schema root). All configurable aspects are expressed as typed, constrained `parameters`, dynamic `componentSlots`, and `relationshipTemplates`.
2. **Template vs Instance Separation:** `FurnitureDefinition` is an immutable, versioned factory template. `FurnitureInstance` is the concrete, independently mutable manifestation placed in a customer project room.
3. **Material Separation:** `MaterialDefinition` models physical catalog stock (dimensions, thickness, grain, pricing); `MaterialAssignment` binds a functional component role (e.g. `carcass`, `front`, `worktop`) to a material without altering the definition template.
4. **Hardware Separation:** `HardwareDefinition` encapsulates commercial data, 3D visual assets, and authoritative drilling rules; `HardwarePlacement` captures authoring position and links to derived machining.
5. **Asset Independence:** `Asset` represents 3D/PBR digital resources consumed by 3D viewports (SketchUp, GLTF, Blender) without embedding business or manufacturing rules.

---

## Context

Prior iterations and traditional millwork software frequently create dedicated, rigid classes like `KitchenCabinet`, `Closet`, or `DrawerUnit` with bespoke, non-reusable properties. This creates severe architecture problems:

- **Rigidity:** Creating a desk, reception counter, bookcase, or bathroom vanity requires inventing new schemas, UI panels, and backend engines.
- **Leaky Abstractions:** Hardcoding cabinet assumptions forces non-cabinet items to artificially pretend they are cabinets (e.g., modeling a desk as a cabinet without doors).
- **Duplication:** CNC machining and BOM derivation rules are duplicated across disparate category handlers.
- **Client Couplings:** 3D clients (like the SketchUp extension) become tightly coupled to specific UI forms rather than rendering generic parameter forms driven by the catalog.

---

## Boundaries & Entity Matrix

| Concern | Primary Entity | Lifecycle / Scope | Owned By |
|---|---|---|---|
| Generative Template | `FurnitureDefinition` | Global Catalog / Versioned | Granete Domain |
| Room Placement | `FurnitureInstance` | Customer Project / DesignAssembly | Project Context |
| Modular Building Block | `ComponentDefinition` | Global Library | Granete Domain |
| Raw Sheet / Board Goods | `MaterialDefinition` | Global Inventory / Catalog | Procurement / Domain |
| Role Material Binding | `MaterialAssignment` | Definition or Instance Override | Authoring Context |
| Technical / Machining Hardware | `HardwareDefinition` | Global Hardware Catalog | Granete Domain |
| 3D Geometry & PBR Maps | `Asset` | Digital Asset Registry | Digital Asset Store |
| Semantic Machining Output | `ManufacturingFeature` | Read-only Resolved Result | Granete Preflight / Release |

---

## Consequences

### Positive
- **Universal Typology Support:** The same authoring exchange, parametric regeneration, and preflight pipeline natively supports kitchens, closets, vanities, desks, tables, and architectural woodwork.
- **Deterministic Versioning:** Definitions are versioned (`1.0.0`, `1.1.0`), preventing existing customer orders from silently mutating when a catalog template is updated.
- **Zero Ruby Logic Duplication:** The SketchUp extension dynamically renders the parameters defined by `FurnitureDefinition`, requiring no bespoke Ruby classes for new furniture typologies.
- **Full Preflight Continuity:** Every generated assembly is validated by `runManufacturingPreflight` (#347) regardless of furniture category.

### Trade-offs & Mitigations
- **Generative Formula Complexity:** Dynamic component slots require declarative sizing formulas (e.g. `shelfWidth = widthMm - 2 * panelThickness`).
  - *Mitigation:* The domain engine provides standard slot generators for common topological patterns (box carcass, grid divider, stretcher frame, panel leg).
