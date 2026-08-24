# Manufacturing Feature Model

## Purpose

Define the evolution from manual geometry operations to semantic manufacturing operations.

## Problem

A drilling operation cannot be represented only as coordinates.

Bad model:

```text
Hole
x=50
 y=100
```

This loses meaning.

## Semantic model

A manufacturing feature contains:

```text
ManufacturingFeature
 ├── targetPart
 ├── face
 ├── reference system
 ├── position
 ├── operation type
 ├── tool requirements
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
```

## Coordinate systems

Every manufactured part must have its own coordinate system.

The system must not depend on the furniture position in SketchUp.

A cabinet moved in SketchUp still has identical manufacturing rules.

## Hardware relationship

Hardware creates manufacturing requirements.

Example:

A Blum hinge placement can generate:

- door cup drilling
- mounting plate drilling
- placement validation

The plugin stores intent. Muebleria resolves the manufacturing result.

## CNC and machine output

Machine formats are adapters over resolved manufacturing data.

The system must avoid:

- CNC rules inside SketchUp
- duplicated drilling logic
- hardcoded machine assumptions

## Validation

Before production:

- validate references
- validate dimensions
- validate hardware compatibility
- validate machine capabilities
- generate deterministic output
