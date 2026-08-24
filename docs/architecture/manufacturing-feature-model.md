# Manufacturing Feature Model

## Purpose

Define the evolution from manual geometry operations to semantic manufacturing operations inside an intelligent furniture platform.

The objective is to support professional workflows similar to CAD/CAM furniture systems while keeping manufacturing intelligence centralized.

## Problem

A drilling operation cannot be represented only as coordinates.

Bad model:

```text
Hole
x=50
y=100
```

This loses meaning because it does not know:

- which part owns the operation;
- which face is affected;
- why the hole exists;
- which hardware or relationship generated it.

## Semantic model

A manufacturing feature contains:

```text
ManufacturingFeature
 ├── targetPart
 ├── face
 ├── local reference system
 ├── position
 ├── operation type
 ├── tool requirements
 ├── compatibility rules
 └── provenance
```

## Example drilling feature

```text
DrillingFeature

Part:
left cabinet side

Face:
inside

Reference:
front edge

Diameter:
5mm

Depth:
12mm

Purpose:
shelf support

Origin:
Shelf relationship rule
```

## Coordinate systems

Every manufactured part must have its own local coordinate system.

The system must not depend on the furniture position in SketchUp.

A cabinet moved, rotated or duplicated in SketchUp still maintains correct manufacturing intent.

## Hardware relationship

Hardware generates manufacturing requirements.

Example:

Blum hinge placement can generate:

- door cup drilling
- mounting plate drilling
- compatibility validation

Blum drawer systems can generate:

- runner drilling
- positioning rules
- required clearances

The plugin stores design intent. Muebleria resolves manufacturing results.

## Relationship-driven machining

Manufacturing operations should originate from semantic relationships.

Examples:

```text
Shelf relationship
        |
        v
Shelf support drilling

Drawer system
        |
        v
Runner drilling

Hinge placement
        |
        v
Cup drilling
```

## CNC and machine output

Machine formats are adapters over resolved manufacturing data.

The system must avoid:

- CNC rules inside SketchUp
- duplicated drilling logic
- hardcoded machine assumptions

The correct order is:

```text
Furniture model
        |
Manufacturing features
        |
Validation
        |
Machine adapter
        |
CNC output
```

## Validation

Before production:

- validate references
- validate dimensions
- validate hardware compatibility
- validate material compatibility
- validate machine capabilities
- generate deterministic output
