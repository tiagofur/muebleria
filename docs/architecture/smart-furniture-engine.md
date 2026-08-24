# Smart Furniture Engine

## Purpose

Define the architecture for intelligent furniture objects across Muebleria, Granete for SketchUp and future 3D integrations.

The goal is not to create a closed furniture catalog or a simple 3D drawing system. The goal is to create an open parametric furniture design and manufacturing platform inspired by professional systems such as Promob, Cabinet Vision, Gabster and similar CAD/CAM solutions.

The platform must allow factories to create any furniture composition using independent reusable elements.

## Core principle

**SketchUp owns authoring and interaction. Muebleria owns manufacturing truth.**

SketchUp can:

- insert furniture definitions
- move and rotate objects
- change allowed parameters
- visualize realistic materials and hardware
- capture design intent
- provide an interactive design environment

Muebleria must own:

- catalog resolution
- component compatibility
- BOM
- production pieces
- drilling rules
- machining operations
- hardware logic
- manufacturing validation

Plugins are clients of the smart furniture model, never owners of manufacturing logic.

## Product philosophy

Muebleria is not a fixed kitchen/closet catalog.

It does not work like:

```text
Kitchen Roma
= 5 predefined cabinets
= fixed color
= fixed configuration
```

Instead:

```text
Furniture Definition
+
Components
+
Materials
+
Hardware
+
Rules
+
Manufacturing intelligence
```

The user creates the final design by composing independent elements.

## Domain hierarchy

```text
Style / Collection (optional)
        |
        v
Furniture Definition
        |
        +-- Components
        +-- Materials
        +-- Hardware
        +-- Manufacturing Rules

Furniture Instance
        |
        +-- Real object inside a customer project
```

## Furniture Definition

A furniture definition is a reusable parametric manufacturing object.

Examples:

```text
Base Cabinet 800
Wall Cabinet 600
Tower Oven Module
Drawer Unit
Wardrobe Module
```

It defines:

- dimensions
- possible configurations
- compatible components
- production rules
- relationships

It does not define a final commercial product.

## Components

Furniture is composed from independent reusable components.

Examples:

```text
Door Style:
- Roma
- Shaker
- Flat

Handle:
- Black Modern
- Gold

Drawer System:
- Blum LEGRABOX
- Hettich ArciTech

Material:
- Egger W1100
- MDF lacquered
```

A door style is not a kitchen. A handle is not a cabinet. A material is not a product.

They are reusable building blocks.

## Parametric behavior

Furniture is never resized using generic 3D scaling.

Incorrect:

```text
Scale cabinet from 800mm to 900mm
```

Correct:

```text
Update width parameter
Regenerate dependent parts
Resolve component relationships
Recalculate manufacturing impact
```

## Example

```text
Furniture Definition:
Base Cabinet

Parameters:
- widthMm
- heightMm
- depthMm
- shelfCount
- drawerCount
- doorConfiguration
- hardwareSelection
```

Changing shelfCount modifies:

- visual representation
- component instances
- relationships
- drilling operations
- production requirements

## Future integrations

The same semantic model should support:

- SketchUp
- Blender
- Revit
- Web 3D viewer
- AR applications

The platform must maintain one manufacturing model with multiple visualization clients.
