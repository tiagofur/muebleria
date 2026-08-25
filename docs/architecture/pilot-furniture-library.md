# Pilot Furniture Library — 10 Smart Furniture Presets

## Purpose

This document defines the first small integration catalog used to validate the complete Granete flow:

`Library -> FurnitureDefinition -> FurnitureInstance -> SketchUp -> Domain -> Preflight -> Production`.

The pilot deliberately exposes **10 user-visible furniture presets** while reusing only **4 parametric FurnitureDefinitions**. The objective is to prove that Granete is a composition platform, not a fixed catalog where every visual option becomes a new hardcoded furniture class.

## Coordinate convention

For all pilot furniture:

- `X` = furniture width
- `Y` = furniture depth
- `Z` = furniture height

Horizontal panels such as shelves, bottoms and tops use `boardLocal: horizontal`. The pilot definitions do not embed any default rotation. Existing legacy/default rotation behavior is intentionally out of scope for this catalog and can be corrected centrally later.

## User-visible presets

| # | Preset ID | Name | Default dimensions | Definition |
|---|---|---|---|---|
| 1 | `base-1-door-left` | Gabinete Base 1 Puerta Izquierda | 450 x 720 x 560 mm | `furniture-base-door` |
| 2 | `base-1-door-right` | Gabinete Base 1 Puerta Derecha | 450 x 720 x 560 mm | `furniture-base-door` |
| 3 | `base-2-doors` | Gabinete Base 2 Puertas | 800 x 720 x 560 mm | `furniture-base-door` |
| 4 | `base-drawers-2` | Cajonero Base 2 Cajones | 600 x 720 x 560 mm | `furniture-base-drawers` |
| 5 | `base-drawers-3` | Cajonero Base 3 Cajones | 600 x 720 x 560 mm | `furniture-base-drawers` |
| 6 | `base-drawers-4` | Cajonero Base 4 Cajones | 600 x 720 x 560 mm | `furniture-base-drawers` |
| 7 | `wall-1-door-left` | Alacena 1 Puerta Izquierda | 450 x 720 x 330 mm | `furniture-wall-door` |
| 8 | `wall-1-door-right` | Alacena 1 Puerta Derecha | 450 x 720 x 330 mm | `furniture-wall-door` |
| 9 | `wall-2-doors` | Alacena 2 Puertas | 800 x 720 x 330 mm | `furniture-wall-door` |
| 10 | `tall-pantry-2-doors` | Despensa / Torre 2 Puertas | 600 x 2100 x 560 mm | `furniture-tall-pantry` |

Dimensions are defaults, not frozen product sizes.

## Shared parametric definitions

### `furniture-base-door`

Reusable base cabinet structure with configurable width, height, depth, shelf count, door count, swing direction, door component and joinery system.

### `furniture-base-drawers`

Reusable drawer base with 2–4 drawers. Drawer fronts and drawer boxes are represented as independent reusable component slots. Drawer slide selection is a hardware parameter.

### `furniture-wall-door`

Reusable wall cabinet with configurable shelves, one or two doors, swing direction and door component.

### `furniture-tall-pantry`

Reusable tall pantry/tower definition with configurable dimensions, shelves and front component.

## Shared component library

The pilot includes reusable definitions for:

- side panel
- bottom panel
- top panel
- stretcher
- shelf
- back panel
- flat door
- Shaker door
- drawer front
- drawer box

Door style is a component choice, not a different kitchen or fixed product.

## Pilot materials and edge bands

Board materials:

- Melamina Blanca 18mm
- Melamina Roble Claro 18mm
- MDF Crudo 18mm
- HDF Blanco 6mm

Edge bands:

- ABS Blanca 1mm
- ABS Blanca 2mm
- ABS Roble Claro 1mm

Default assignments demonstrate that carcass, shelves, fronts and backs can use different materials without creating another FurnitureDefinition.

## Pilot hardware

- Bisagra Cazoleta Cierre Lento 110°
- Corredera Telescópica 500mm
- Jaladera Recta 128mm
- Soporte de Entrepaño 5mm
- Minifix 15mm
- Tarugo 8x30mm

The hinge, slide and handle reference logical multi-representation assets (`assetId`). The URI scheme is intentionally logical (`granete://...`) so plugins do not own physical asset paths.

## Integration boundary

The catalog data lives in `packages/domain/src/pilotFurnitureCatalog.ts`.

The SketchUp plugin should consume presets and resolved furniture state. It must not duplicate these 10 definitions in Ruby.

The React app may expose the same pilot definitions as library/admin data, but business records created by users must remain separate from this test catalog.

## Next validation slice

The next integration test should use a small project containing at least:

- one base one-door cabinet
- one two-door base cabinet
- one three-drawer base
- one two-door wall cabinet
- one pantry

Then validate changes such as:

- width `800 -> 900 mm`
- drawer count `3 -> 4`
- shelf count `2 -> 3`
- flat door -> Shaker door
- white carcass/front -> oak front override

The same project should subsequently prove:

- stable FurnitureInstance identity
- correct ComponentInstances and PartInstances
- material and edge-band assignments
- hardware references
- manufacturing preflight
- BOM/cut output
- edge-banding output
- CNC/machining handoff
- assembly-stage complete furniture output
