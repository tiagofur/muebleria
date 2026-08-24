# Smart Furniture Domain Model

## Purpose

Define the canonical domain model for Muebleria and Granete integrations.

This document establishes the semantic objects that connect:

- React business application
- Backend manufacturing engine
- Granete Library
- SketchUp plugin
- Future Blender, Revit and other 3D integrations

The goal is not to build a closed catalog of furniture products. The goal is to create an open furniture composition and manufacturing platform.

---

# Core Principle

Muebleria is not a fixed furniture catalog.

A factory should be able to create any combination of:

- furniture modules
- components
- materials
- hardware
- accessories
- manufacturing rules

The system must support professional workflows similar to cabinet design and manufacturing platforms while maintaining a clear separation of responsibilities.

---

# Domain Hierarchy

```text
Project
 |
 +-- FurnitureInstance
       |
       +-- FurnitureDefinition
       |
       +-- ComponentInstances
       |
       +-- Materials
       |
       +-- HardwarePlacements
       |
       +-- ManufacturingFeatures
```

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

# Materials

Materials combine commercial, visual and manufacturing information.

Example:

```text
Material:
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
```

A material must work for:

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

- BOM rules
- CNC logic
- drilling rules
- manufacturing truth

## Backend

Owns:

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

All integrations consume the same semantic furniture model.

---

# Final Rule

The system should think:

"A furniture object knows what it is, what it contains, how it looks, and how it is manufactured."

Not:

"A 3D model has some extra information attached."
