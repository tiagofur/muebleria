# Smart Furniture Domain Model

## Purpose

Define the canonical domain model for Granete and its 3D integrations.

This document establishes the semantic objects that connect:

- React business application
- Backend manufacturing engine
- Parametric furniture library
- SketchUp plugin
- Future Blender, Revit and other 3D integrations

The goal is not to build a closed catalog of furniture products. The goal is to create an open furniture composition and manufacturing platform.

---

# Core Principle

Granete is not a fixed furniture catalog.

A factory should be able to create any combination of:

- furniture modules
- components
- materials
- hardware
- accessories
- manufacturing rules

The system must support professional workflows similar to cabinet design and manufacturing platforms while maintaining a clear separation of responsibilities.

For project lifecycle identity and quote/design/release versioning, the additional canonical invariant is:

> **Project owns `FurnitureInstance` identity. QuoteRevision owns commercial truth. DesignRevision owns spatial/design truth. Granete owns manufacturing truth.**

See `project-design-digital-thread.md` and ADR-0003. This document defines the furniture semantics; the digital-thread document defines how the same physical instance survives commercial/design/manufacturing revisions.

---

# Domain Hierarchy

```text
Project
 |
 +-- FurnitureInstance
       |
       +-- FurnitureDefinition (template)
       |
       +-- ComponentInstances (referencing ComponentDefinition)
       |
       +-- MaterialAssignments (binding roles to MaterialDefinition)
       |
       +-- HardwarePlacements (referencing HardwareDefinition)
       |
       +-- ManufacturingFeatures (resolved operations)
```

`FurnitureInstance` is the stable business identity of one intended physical furniture unit. `QuoteLine`, `DesignRevisionItem`, SketchUp entities and production rows reference this identity; none replaces it.

---

# FurnitureDefinition

A reusable parametric furniture definition.

Examples:

- Base Cabinet 600
- Base Cabinet 800
- Wall Cabinet 900
- Oven Tower
- Drawer Unit
- Closet Module

A FurnitureDefinition describes what a furniture object is capable of becoming.

Example:

```text
FurnitureDefinition

name:
Base Cabinet 800

parameters:
- widthMm
- heightMm
- depthMm
- shelfCount
- doorCount
- drawerCount

rules:
- compatible doors
- compatible hardware
- manufacturing constraints
```

It does not represent a finished customer product.

---

# FurnitureInstance

A real furniture object inside a customer project.

Example:

```text
Project:
Kitchen Project A

FurnitureInstance:
Base Cabinet 800

position:
X:2400
Y:0
Z:0

configuration:
Door Style: Shaker
Material: Walnut
Hardware: Blum LEGRABOX
```

A FurnitureInstance can be modified independently without changing the original definition.

## Stable identity rules

- One physical unit that may be positioned/configured independently receives one `furnitureInstanceId`.
- A commercial line with `quantity > 1` may map to multiple FurnitureInstances.
- Changing dimensions/material/options normally preserves the FurnitureInstance identity; the changed values are captured by a new commercial/design snapshot.
- Copying/duplicating a managed instance creates a new FurnitureInstance identity with provenance; two active physical units must not share the same ID.
- A FurnitureInstance may exist before 3D design, before quote inclusion (design-first), or without a production release.
- Do not introduce an equivalent second identity such as `ProjectFurniture`, `QuotedFurniture` or `SketchUpFurniture`.

## Identity vs snapshots

`FurnitureInstance` is identity, not historical snapshot storage. Revision-owned values belong to the revision that asserted them:

```text
FurnitureInstance FI-100
├── QuoteRevision Q4 snapshot: width 600
├── DesignRevision R7 snapshot: width 600
├── DesignRevision R8 snapshot: width 650
└── QuoteRevision Q5 snapshot: width 650
```

A quote/design change therefore does not require deleting/recreating FI-100.

---

# Project commercial/design representations

The same `FurnitureInstance` may be represented by different bounded contexts:

```text
Project
├── FurnitureInstance
├── Quote
│   └── QuoteRevision
│       └── QuoteLine
│           └── references FurnitureInstance(s)
├── Design
│   └── DesignRevision
│       └── DesignRevisionItem
│           └── references FurnitureInstance
└── ProductionRelease
    └── pins an exact approved DesignRevision/manufacturing fingerprint
```

`QuoteLine.quantity` is commercial grouping, not physical identity. `Design` is authoring-client agnostic; do not create `SketchUpProject` as a business aggregate.

Published DesignRevisions and accepted QuoteRevisions are immutable. Reconciliation compares them by FurnitureInstance and never silently mutates either side.

The full contract, lifecycle, manifest, concurrency rules and implementation phases are normative in `project-design-digital-thread.md`.

---

# Components

Components are reusable building blocks.

Examples:

## Doors

```text
Door Style

- Roma
- Shaker
- Flat
- Modern
```

## Handles

```text
Handle

- Black aluminum
- Gold metal
- Integrated profile
```

## Accessories

```text
- Legs
- Plinths
- Organizers
- Lighting
```

Components are not furniture. They are parts that configure furniture.

---

# MaterialDefinition vs MaterialAssignment

## MaterialDefinition

Represents raw physical materials in the catalog / inventory.

Example:

```text
MaterialDefinition:
Egger W1100 ST9

Business:
- supplier
- product code
- cost
- selling price

Visual:
- texture
- normal map
- roughness

Manufacturing:
- thickness
- compatible edges
- sheet dimensions
```

## MaterialAssignment

Binds a functional role (e.g. `carcass`, `front`, `shelf`, `worktop`) to a `MaterialDefinition` for a given `FurnitureDefinition` or `FurnitureInstance`.

Example:

```text
MaterialAssignment:
- role: carcass -> Egger W1100 ST9 (18mm)
- role: front -> Egger H3303 ST10 (18mm)
- role: back_panel -> Egger H3303 ST10 (5.5mm)
```

A material configuration must work for:

- quoting
- rendering
- production

---

# Hardware

Hardware represents real products.

Example:

```text
Blum LEGRABOX M

Commercial:
- brand
- supplier
- product code
- cost

Technical:
- dimensions
- load capacity
- installation rules

Visual:
- SketchUp component
- GLB model
- textures

Manufacturing:
- drilling profile
- placement rules
```

A hardware item is both a visual asset and a manufacturing rule source.

---

# Asset

Digital representation of any object.

```text
Asset
 |
 +-- metadata
 +-- geometry
 +-- textures
 +-- thumbnails
 +-- manufacturing references
```

Supported formats should include:

- SketchUp components
- GLB/glTF
- Blender assets
- Revit compatible formats when required

Plugins consume assets. Plugins do not own assets.

---

# Relationships

Relationships describe how objects connect.

Examples:

```text
Shelf
 |
 +-- belongs to cabinet
 +-- requires shelf supports
 +-- creates drilling features
```

```text
Drawer System
 |
 +-- belongs to cabinet
 +-- requires runner placement
 +-- generates machining
```

Relationships are the foundation for parametric regeneration.

---

# ManufacturingFeature

A manufacturing feature represents production intent.

Examples:

- drilling
- routing
- cutting
- edging
- assembly operation

A feature is semantic, not just geometry.

Example:

```text
DrillingFeature

part:
Left Side Panel

face:
Inside

reference:
Front Edge

purpose:
Shelf Support

origin:
Shelf Relationship
```

---

# Catalog vs Library

## Catalog

Answers:

"What can the company sell or offer?"

Examples:

- furniture definitions
- templates
- styles
- presets

## Library

Answers:

"What builds the furniture?"

Examples:

- boards
- edges
- doors
- hardware
- accessories
- assets

A style collection is only a preset configuration, never a locked product.

---

# Plugin Responsibility

## SketchUp Plugin

Owns:

- user interaction
- 3D visualization
- placement
- design intent

Does not own:

- business furniture identity creation rules outside the Project API contract
- BOM rules
- CNC logic
- drilling rules
- manufacturing truth

It stores/replays the authoritative `furnitureInstanceId` assigned to the Project. SketchUp `persistent_id` is only a technical locator inside a model and is never the business identity.

## Backend

Owns:

- project identity mutations and cross-client concurrency
- validation
- manufacturing resolution
- production data
- business rules

---

# Future Expansion

This domain model enables:

- SketchUp plugin
- Blender integration
- Revit integration
- Web 3D viewer
- Augmented reality applications

All integrations consume the same semantic furniture model and Project-level FurnitureInstance identity.

---

# Final Rule

The system should think:

"A furniture object knows what it is, what it contains, how it looks, and how it is manufactured — and the Project preserves which physical furniture unit it is across quote, design and production revisions."

Not:

"A 3D model has some extra information attached."

---

# Canonical references

- Project identity, Quote ↔ Design reconciliation, versioned 3D artifacts and release binding: `project-design-digital-thread.md` + `docs/adr/0003-project-owned-furniture-identity-and-versioned-design.md`
- Umbrella engine view: `smart-furniture-engine.md`
- Detailed library spec (7 entities, versioning, instantiation + preflight pipeline): `parametric-furniture-library.md` + `docs/adr/0002-parametric-furniture-library-architecture.md`
- Digital assets: `3d-asset-library.md`
- Semantic machining features: `manufacturing-feature-model.md`
- SketchUp interaction contract: `sketchup-interaction-model.md` + `docs/adr/0001-sketchup-authoring-muebles-manufacturing-truth.md`
