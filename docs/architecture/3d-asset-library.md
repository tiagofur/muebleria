# 3D Asset Library Architecture

## Purpose

Define how materials, hardware, components and furniture become reusable digital assets for design, rendering and manufacturing.

The asset library is the foundation that allows Granete to provide a professional design experience while keeping manufacturing intelligence centralized.

## Catalog vs Library

These concepts must never be mixed.

## Catalog

Answers:

> What can the company offer or sell?

Examples:

```text
Base Cabinet 800
Tower Oven Module
Drawer Unit
```

A catalog item is a reusable furniture definition or commercial offering.

## Library

Answers:

> What elements build the furniture?

Examples:

```text
Doors
Handles
Boards
Edges
Hardware
Accessories
Textures
3D Models
Manufacturing Rules
```

A kitchen, closet or room is not a fixed product. It is a composition created from library elements.

## Asset concept

Every reusable element can reference a digital asset.

```text
Asset
 ├── business data
 ├── production data
 ├── geometry data
 ├── rendering data
 ├── supplier data
 └── compatibility rules
```

## Materials

A material is not only a color and price.

Example:

```text
Material:
Egger W1100 ST9

Business:
- supplier
- product code
- cost
- sale price

Visual:
- texture
- normal map
- roughness
- realistic rendering properties

Production:
- thickness
- compatible edges
- machining restrictions
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
- compatibility
```

## Components

Examples:

```text
Door Style:
Roma

Handle:
Modern Black

Drawer System:
Blum LEGRABOX

Accessory:
Waste bin system
```

Components can be combined with different furniture definitions.

## Asset formats

The asset layer should support:

- SketchUp components for interactive design
- glTF/GLB for web and future platforms
- Blender compatible assets
- Revit compatible assets when required

## Storage principle

The application manages the asset information.

Plugins consume assets.

No plugin should become the source of truth for:

- materials
- hardware
- prices
- production rules
- manufacturing logic

## Canonical references

- Umbrella engine view: `smart-furniture-engine.md`
- Entity model for `Asset`, `MaterialDefinition`, `MaterialAssignment`, `HardwareDefinition`: `parametric-furniture-library.md` + `docs/adr/0002-parametric-furniture-library-architecture.md`
- How materials are chosen per role in the web app and the SketchUp plugin: `catalog-option-selector.md`
- Asset caching/download behavior in the SketchUp client: `sketchup-interaction-model.md`
