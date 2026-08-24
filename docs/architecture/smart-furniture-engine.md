# Smart Furniture Engine

## Purpose

Define the architecture for intelligent furniture objects across Muebleria, Granete for SketchUp and future 3D integrations.

The goal is not to create a 3D drawing system. The goal is to create manufacturing-aware furniture objects.

## Core principle

**SketchUp owns authoring and interaction. Muebleria owns manufacturing truth.**

SketchUp can:

- insert furniture
- move objects
- change allowed parameters
- visualize materials and hardware
- communicate design intent

Muebleria must own:

- catalog resolution
- BOM
- production pieces
- drilling rules
- machining operations
- hardware logic
- manufacturing validation

## Smart Furniture Object

A furniture object contains:

```text
FurnitureInstance
 ├── catalogItemId
 ├── catalogRevision
 ├── parameters
 ├── componentInstances
 ├── relationships
 ├── materials
 ├── hardware placements
 └── manufacturing rules
```

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
Resolve manufacturing impact
```

## Example

A base cabinet:

```text
Base Cabinet 800

Parameters:
- widthMm
- heightMm
- depthMm
- shelfCount
- drawerSystem
- doorCount
```

Changing shelfCount modifies:

- visual representation
- component instances
- relationships
- production requirements

## Future integrations

The same semantic model should support:

- SketchUp
- Blender
- Revit
- Web 3D viewer
- AR applications

Plugins are clients of the model, not owners of the model.
