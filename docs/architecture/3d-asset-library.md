# 3D Asset Library Architecture

## Purpose

Define how materials, hardware, components and furniture become reusable digital assets.

Today a material or hardware item is mostly business data. The future model adds visual and manufacturing intelligence.

## Asset concept

Every catalog item can reference a digital asset.

```text
Asset
 ├── business data
 ├── production data
 ├── geometry data
 ├── rendering data
 └── supplier data
```

## Materials

Example:

```text
Material:
Egger W1100 ST9

Business:
- supplier
- code
- cost

Visual:
- texture
- normal map
- roughness

Production:
- thickness
- edge compatibility
```

## Hardware

Hardware is not only a name and price.

Example:

```text
Blum LEGRABOX M

Commercial:
- brand
- product code
- supplier

Technical:
- dimensions
- load capacity
- installation rules

Visual:
- SketchUp model
- GLB model
- textures

Manufacturing:
- drilling profile
- placement rules
```

## Supported formats

The asset layer should allow:

- SketchUp components
- glTF/GLB for web and future platforms
- Blender compatible assets
- Revit compatible assets when required

## Storage principle

The React application manages assets.
The plugins consume assets.

No plugin should become the source of truth for materials or hardware.

## Catalog vs Library

Catalog answers:

"What do we sell?"

Library answers:

"What components build it?"

Example:

```text
Catalog:
Modern Kitchen Roma

Library:
- cabinet definitions
- boards
- edges
- hinges
- drawers
- accessories
```
