# Implementation Evidence: F164 & F165 (#349 Parametric Furniture Library & #350 Hardware Sync)

## State

- Features:
  - **F164 (#349)**: Smart Parametric Furniture Library MVP
  - **F165 (#350)**: Hardware Placement & Machining Sync
- Architecture Authority:
  - `docs/architecture/parametric-furniture-library.md`
  - `docs/adr/0002-parametric-furniture-library-architecture.md`
- Branch: `feat/349-parametric-furniture-library`
- Invariant: **SketchUp owns authoring/interaction; Granete owns manufacturing truth.**
  Universal composition platform with zero hardcoded Cabinet coupling.

---

## Deliverables & Implementation Summary

1. **Decoupled Domain Primitives (`smartFurnitureDomain.ts`):**
   - `FurnitureDefinition`: Parametric template with typed parameters, component slots, relationship templates, and semantic versioning.
   - `FurnitureInstance`: Placed furniture instance in project room.
   - `ComponentDefinition`: Reusable building block with `boardLocal` reference.
   - `MaterialDefinition`: Raw sheet/board good in catalog.
   - `MaterialAssignment`: Role-based material and edge band binding.
   - `HardwareDefinition`: Commercial, technical, visual, and machining profile binding.
   - `Asset`: Independent 3D/PBR digital asset resource.

2. **Composition & Instantiation Engine (`furnitureCompositionEngine.ts`):**
   - `instantiateFurniture`: Pure function that validates parameters against definition bounds and creates a fully valid `AuthoringEnvelopeV1` / `DesignAssembly` with persistent component IDs, calculated bounds, `PartRelationshipIntent`s, and `HardwarePlacementIntent`s.

3. **Hardware Placement & Machining Sync (`sketchupHardwareSync.ts`):**
   - `repositionHardwarePlacement`: Adjusts manual hardware placements, re-runs `runManufacturingPreflight`, demonstrates machining isolation (moving a hinge leaves shelf machining untouched), and allows resolving drilling collisions (`DRILLING_CONFLICT`) interactively.

4. **Universal Fixtures (`smartFurnitureFixtures.ts`):**
   - `kitchenBaseDefinition`, `closetTowerDefinition`, `workstationDeskDefinition`.

---

## Verification Evidence

| Suite | Command | Result |
|---|---|---|
| Domain Unit Tests | `pnpm --filter @muebles/domain test` | 85 test files, 1087 tests passing (100% green) |
| SketchUp Suite | `pnpm --filter @muebles/domain test sketchup` | 5 test files, 48 tests passing (0 failures) |
| Workspace Typecheck | `pnpm typecheck` | 7/7 workspace packages clean (0 errors) |
| Backend Go Tests | `cd backend-go && go test ./...` | All packages passing (0 failures) |

### Acceptance Criteria Checklist
- [x] `FurnitureDefinition` contains zero fixed fields tied to Cabinet or closed categories.
- [x] 7 canonical entities formally defined and exported in `smartFurnitureDomain.ts`.
- [x] `instantiateFurniture` evaluates parameters and computes exact panel dimensions.
- [x] Generated instances pass `runManufacturingPreflight` with `status: "ready"`.
- [x] Multi-shelf instances share `componentDefinitionId` with independent `componentInstanceId` and relationships.
- [x] `repositionHardwarePlacement` preserves machining isolation and resolves collisions.
- [x] Strict provenance (`sourceKind: "manualHardwarePlacement"`) enforced.
