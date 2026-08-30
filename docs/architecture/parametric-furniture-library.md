# Smart Parametric Furniture Library Architecture

## 1. Executive Summary & Architectural Invariant

This document establishes the canonical architecture for the **Smart Parametric Furniture Library** in Granete. 

### Core Architectural Invariant
> **Granete is not a fixed cabinet catalog. It is an open furniture composition and manufacturing platform.**
> **SketchUp / 3D Clients own authoring and visual interaction; Granete owns manufacturing truth, parametric resolution, and preflight gating.**

A furniture library must never be coupled to a specific category (such as "Cabinet") or hardcoded geometry fields (`doorCount`, `shelfCount`, `drawerCount`). Instead, every piece of furniture—whether a kitchen base unit, wall cabinet, wardrobe/closet tower, executive desk, bathroom vanity, or modular bookcase—is an instance of a generic, versioned parametric template composed of decoupled domain entities.

---

## 2. The 7 Core Domain Entities

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       FurnitureDefinition                                       │
│ (Reusable parametric template: parameters, component slots, relationship templates, versioning) │
└───────────────────────────────────────────────┬─────────────────────────────────────────────────┘
                                                │ instantiates into
                                                ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                        FurnitureInstance                                        │
│ (Concrete project instance: assemblyId, transform, evaluated parameters, component instances)   │
└───────┬───────────────────────────────────────┬─────────────────────────────────────────┬───────┘
        │                                       │                                         │
        ▼                                       ▼                                         ▼
┌───────────────────────┐           ┌────────────────────────┐                ┌───────────────────────┐
│  ComponentDefinition  │           │   MaterialAssignment   │                │  HardwareDefinition   │
│(Modular part block:   │           │ (Dynamic role binding: │                │(Commercial, technical,│
│ panel, door, leg, etc)│           │ thickness, veta, edges)│                │ visual, drilling)     │
└───────────┬───────────┘           └───────────┬────────────┘                └───────────┬───────────┘
            │                                   │                                         │
            │                                   ▼                                         │
            │                       ┌────────────────────────┐                            │
            │                       │   MaterialDefinition   │                            │
            │                       │ (Raw material catalog: │                            │
            │                       │ board, code, supplier) │                            │
            │                       └────────────────────────┘                            │
            │                                   │                                         │
            └───────────────────────────────────┼─────────────────────────────────────────┘
                                                │ references visual 3D/PBR data
                                                ▼
                                    ┌────────────────────────┐
                                    │         Asset          │
                                    │(Visual: 3D SKP/GLB/OBJ │
                                    │ textures, thumbnails)  │
                                    └────────────────────────┘
```

---

### Entity 1: `FurnitureDefinition` (Parametric Furniture Template)
A versioned, reusable manufacturing definition describing the generative capabilities and topological rules of a furniture archetype.

- **Definition Identity:** `furnitureDefinitionId`, `code`, `name`, `category`, `version` (semver, e.g. `1.2.0`), `schemaRevision`.
- **Parameter Contract (`FurnitureParameter`):** Dynamic, typed parameters (`number`, `string`, `boolean`, `enum`) with explicit units (`mm`, `deg`, `count`), constraints (`min`, `max`, `step`, `options`, and string `maxLength` from 1 through 512), default values, stable `sortOrder`, and semantic groupings (`dimension`, `configuration`, `style`, `hardware`, `metadata`). Every non-metadata value declares a versioned authoritative binding; metadata explicitly has no physical consumer. `componentQuantity` owns count and relationship expansion, while boolean-only `componentCondition` owns deterministic inclusion of one direct component and its dependents. Until persisted module-component entry identity reaches the domain contract, repeated direct or relationship targets are rejected as ambiguous. All nested parameter-definition shapes are closed and every rule participates in the definition hash/catalog revision. Legacy `widthMm`/`heightMm`/`depthMm` are reserved projections from module columns rather than a second persisted source.
- **Component Slots (`FurnitureComponentSlot`):** Declarative slots that instantiate `ComponentDefinition`s based on mathematical sizing formulas, quantity multipliers (e.g. `shelfCount`), and inclusion conditions (e.g. `hasBackPanel == true`).
- **Relationship Templates (`FurnitureRelationshipTemplate`):** Declarative constructive joints (e.g. `shelf-support`, `panel-joint`, `drawer-runner`, `hanging-cleat`) connecting component slots.
- **Default Material & Hardware Bindings:** Default associations between functional roles and material/hardware definitions.

---

### Entity 2: `FurnitureInstance` (Project-Level Instantiation)
A concrete furniture entity placed within a customer project room (`Project` / `Room` / `DesignAssembly`).

- **Identity & Traceability:** `furnitureInstanceId`, `furnitureDefinitionId`, `definitionVersion`, `name`, `assemblyId`.
- **Spatial Positioning:** 3D World transform (`translationMm: [x, y, z]`, `rotationDeg: [rx, ry, rz]`).
- **Active Parameter Set:** Concrete dictionary of evaluated parameter key-values (e.g. `{ widthMm: 800, heightMm: 720, depthMm: 590, shelfCount: 2 }`).
- **Bound Component Instances:** List of concrete `DesignComponent`s with persistent, unique `componentInstanceId`s, dimensions, and local transforms.
- **Active Relationships & Placements:** Concrete `PartRelationshipIntent`s and `HardwarePlacementIntent`s.
- **BOM Fingerprint:** Deterministic FNV-1a hash reflecting the exact manufacturing state.

---

### Entity 3: `ComponentDefinition` (Reusable Building Block)
A modular structural or decorative component archetype (e.g. lateral side panel, horizontal bottom/top panel, adjustable shelf, divider, 5-piece Shaker door, slab drawer front, steel hairpin leg, integrated aluminum profile handle).

- **Identity:** `componentDefinitionId`, `code`, `name`, `category` (`panel_lateral`, `panel_horizontal`, `panel_back`, `door`, `drawer_front`, `drawer_box`, `shelf`, `divider`, `worktop`, `leg`, `accessory`).
- **Local Coordinate System (`BoardLocalKind`):** Standard orientation (`lateral`, `horizontal`, `door`, `back`, `custom`) defining the front/back/left/right/top/bottom faces.
- **Dimensioning Rules:** Axis mapping (`lengthAxis`, `widthAxis`, `thicknessAxis`) and minimum/maximum manufacturing limits.
- **Hardware Attachment Capabilities:** Allowed hardware categories (`hinge`, `slide`, `handle`, `connector`, `shelf_pin`, `leg`).
- **Visual Representation:** Reference to a generic or parametric `Asset`.

---

### Entity 4: `MaterialDefinition` (Raw Material Catalog Entity)
Represents raw sheet goods, solid woods, glass, metals, or edge bands in the procurement and inventory catalog.

- **Identity & Business Data:** `materialId`, `materialCode`, `name`, `supplier`, `costPerUnit`, `pricePerUnit`, `currency`.
- **Physical & Manufacturing Truth:** `materialCategory` (`melamine`, `mdf`, `plywood`, `solid_wood`, `glass`, `metal`, `edgeband`), raw sheet dimensions (`sheetLengthMm`, `sheetWidthMm`), calibrated nominal thickness (`thicknessMm`, e.g. 18.0, 15.0, 5.5).
- **Grain Behavior:** `grainDirection` (`length`, `width`, `none`), optimal cutting direction, kerf requirement.
- **Edge Banding Compatibility:** Allowed edge band codes and glue types.
- **Visual Binding:** Reference to visual `Asset` (PBR textures, normal maps, roughness, diffuse albedo).

---

### Entity 5: `MaterialAssignment` (Role-Based Material Binding)
The dynamic binding layer that connects functional furniture roles to specific `MaterialDefinition`s without altering the `FurnitureDefinition` template.

- **Role Targeting:** `role` (e.g. `carcass`, `front`, `shelf`, `back_panel`, `worktop`, `drawer_box`).
- **Resolved Material:** `materialId` (references `MaterialDefinition`), `thicknessMm`.
- **Edge Banding Configuration:** `edgeBandId`, `edgeBandThicknessMm`, edge application flags (`top`, `bottom`, `left`, `right`).
- **Finish & Surface Overrides:** Grain orientation override, visual asset override.

---

### Entity 6: `HardwareDefinition` (Technical & Commercial Hardware Item)
Modela real physical hardware products across four integrated dimensions:

1. **Commercial:** `hardwareId`, `code`, `name`, `brand` (e.g. Blum, Hettich, Hafele, Titus), `supplier`, `cost`, `price`.
2. **Technical:** Physical dimensions (`widthMm`, `heightMm`, `depthMm`), load capacity (`kg`), opening angle (`deg`), adjustment ranges.
3. **Visual (`Asset`):** Reference to 3D representation (`.skp`, `.glb`) for realistic viewport rendering and clearance simulation.
4. **Manufacturing (`MachiningProfile`):** Authoritative drilling rules (pilot diameter, depth, hole pattern, system line distance, margin offsets, face alignment).

---

### Entity 7: `Asset` (Independent Visual & 3D Resource)
The digital 3D/2D representation of any physical object, completely isolated from business and manufacturing rules.

- **Identity & Format:** `assetId`, `name`, `format` (`sketchup_component`, `gltf`, `glb`, `obj`, `texture_pbr`).
- **Resource URIs:** `uri` (storage path / URL), `thumbnailUri`, `previewLODs` (LOD0, LOD1, LOD2).
- **PBR Shader Properties:** `textureUri`, `normalMapUri`, `roughness`, `metalness`, `aoMapUri`, `colorHex`.
- **Bounding Box & Insertion Point:** Geometry boundaries (`[x, y, z]`) and origin anchor `[ox, oy, oz]`.

---

## 3. Universal Typology Matrix

The decoupled architecture natively supports all modular woodworking categories without changing schemas or domain logic:

| Typology | Example Definition | Component Definitions | Key Parameters | Relaciones Semánticas | Hardware Definitions |
|---|---|---|---|---|---|
| **Kitchen Base** | `kitchen-base-standard` | `side-panel`, `bottom-panel`, `top-stretcher`, `shelf`, `shaker-door`, `plinth` | `widthMm`, `heightMm`, `depthMm`, `shelfCount`, `doorCount`, `plinthHeightMm` | `shelf-support`, `stretcher-joint`, `plinth-leg-joint` | Minifix, dowels, soft-close hinges, adjustable legs |
| **Kitchen Wall** | `kitchen-wall-standard` | `side-panel`, `bottom-panel`, `top-panel`, `shelf`, `slab-door`, `hanging-cleat` | `widthMm`, `heightMm`, `depthMm`, `shelfCount`, `doorCount` | `shelf-support`, `hanging-cleat-joint` | Minifix, dowels, concealed hanging brackets |
| **Closet Tower** | `closet-tower-open` | `closet-side`, `closet-top`, `closet-bottom`, `adjustable-shelf`, `divider`, `drawer-front` | `widthMm`, `heightMm`, `depthMm`, `shelfCount`, `drawerTiers`, `dividerOffsetMm` | `shelf-support`, `divider-joint`, `drawer-slide-joint` | System 32 shelf pins, undermount slides, connecting bolts |
| **Desk / Table** | `workstation-desk-01` | `desk-top`, `leg-panel`, `modesty-panel`, `cable-grommet-insert` | `lengthMm`, `depthMm`, `heightMm`, `hasModestyPanel`, `grommetCount` | `leg-top-joint`, `modesty-panel-joint` | Eccentric cam connectors, angle brackets, cable grommets |
| **Bathroom Vanity**| `vanity-wall-hung` | `side-panel`, `bottom-panel`, `plumbing-cutout-drawer`, `front-panel` | `widthMm`, `heightMm`, `depthMm`, `drainPositionMm`, `drawerCount` | `plumbing-notch-joint`, `wall-hang-joint` | Heavy-duty wall cleats, plumbing drawer slides |
| **Modular Bookcase**| `bookcase-grid-open` | `outer-side`, `top-panel`, `bottom-panel`, `fixed-shelf`, `vertical-divider`, `back-panel` | `widthMm`, `heightMm`, `depthMm`, `columns`, `rows`, `hasBackPanel` | `grid-intersection-joint`, `dowel-joint`, `groove-back-joint` | Wood dowels, back panel screws, leveler feet |

---

## 4. Definition Versioning & Migration Strategy

To protect project durability and manufacturing reproducibility:

1. **Immutable Definition Versions:**
   - Every `FurnitureDefinition` carries a semantic version `version: "major.minor.patch"` and a cryptographic content hash `definitionHash`.
   - Modifying a definition publishes a new version (e.g. `1.1.0`). Existing customer projects retain their bound version (`1.0.0`) indefinitely.

2. **Project Upgrade Negotiation:**
   - When opening an older project, the system detects if updated definitions are available (`updateAvailable: true`).
   - Upgrading is explicit and audited: the user triggers a re-evaluation, which re-runs `runManufacturingPreflight` to guarantee the updated definition does not introduce drilling collisions or dimensional violations.

---

## 5. Instantiation Pipeline & Preflight Integration

```text
1. User Selects Definition (e.g. `closet-tower-open` v1.0.0)
2. User Adjusts Parameters in SketchUp UI ({ widthMm: 900, shelfCount: 3, drawerTiers: 2 })
3. Extension creates AuthoringEnvelopeV1 (DesignAssembly + DesignComponents + PartRelationships + HardwarePlacements)
4. Domain Resolver runs `instantiateFurniture` & `deriveRelationshipMachining`
5. Domain Gate executes `runManufacturingPreflight(envelope, catalog, joineryCatalog)`
6. Gating Outcome:
   ├── if blocked (errors / collisions): status 'blocked', ZERO fabricable output released
   └── if ready (clean / warnings): status 'ready', deterministic bomFingerprint generated & read-only feedback attached
```

---

## 6. Material binding roles in authored components (#403 / MT-2)

Authoring semantics for `Component.optionRoles` — canonical authority:
`material-aware-furniture-resolution.md`.

- A rectangular board participating in material selection declares **exactly
  one** material binding role (`optionRoles[0]` after normalization). Pieces
  intended to share one finish declare the **same** role: sides/base/top/
  shelves → `BODY`, doors and drawer fronts → `FRONT`, back → `BACK`, with
  `PLINTH` and workshop-defined roles available when a real need exists.
- The physical identity of the piece lives in `placement`/slots and is
  orthogonal to the binding. Never bind by component name, color, texture,
  manufacturer or current appearance.
- Multi-role boards are rejected at authoring time (TS `validateComponent`,
  Go `ValidateComponent` → API 400) and at resolution time in both engines —
  a secondary role must never appear configurable while controlling nothing.
- Legacy fragmented roles (`LATERAL`, `INTERIOR`, `FONDO`, `FRENTE`) are NOT
  auto-migrated. Ambiguous catalogs require an explicit editor change; the
  only aliases are the explicit table in
  `contracts/materialRoleBinding.contract.json` (direct choice wins; `ZOCLO`,
  `PUERTA`, `PUERTA_*`, `FRENTE_CAJON` may inherit `FRENTE`), identical in
  TS and Go.

---

## Related documents

Umbrella views of the same architecture (overview-level, defer to this spec on
detail): `smart-furniture-engine.md`, `domain-model.md`, `3d-asset-library.md`,
`manufacturing-feature-model.md`.

Interaction contract with the SketchUp client: `sketchup-interaction-model.md`.
