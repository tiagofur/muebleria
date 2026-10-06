# ADR-0009 — Opening / Front System separated from body construction

- Status: **Proposed**
- Date: 2026-10-05
- Decision owners: Granete architecture
- Epic: [#1128](https://github.com/tiagofur/muebleria/issues/1128)
- Canonical detail: [`docs/architecture/opening-front-system.md`](../architecture/opening-front-system.md)

## Context

Granete models the body (`Structure`), sub-assemblies (`Agregado`) and a factory
joinery policy (`joint.*` overlay, #875) with Library → Factory → Component
precedence. Opening and grip are not modelled: gola is a handle option
(`jaladera-gola-*`) that changes a BOM line but not the top, the sides or the
front height; fronts stack uniformly (`quantity` + one `gapMm`). Supporting gola,
integrated profiles and bottom-overhang doors with the current model requires a
new structure per combination, which explodes combinatorially and produces wrong
cut lists.

## Decision

1. Body construction and opening are independent layers. Opening is split into
   Opening Layout, Grip System, Opening Profile and Front Positioning.
2. Any option that changes geometry, materials, hardware or manufacturing is a
   server-resolved rule, never plain metadata or a boolean flag on the furniture.
3. Gola is an Opening Profile: a versioned catalog entity with datasheet-backed
   geometry, body modifiers (by constructive role) and BOM members.
4. The Opening Layout computes zone boxes and front dimensions; `Agregado`
   remains the authority for zone contents.
5. Factory capabilities (enabled / default / per `FurnitureType`) use the
   ADR-0008 overlay mechanism under an `opening.*` namespace with a TS/Go parity
   contract, mirroring `joint.*`.
6. Availability governs new authoring; validity follows the pinned library
   release. Disabling a capability never rewrites existing designs.
7. Derived dimensions are resolve output, read-only in every client.

## Consequences

- One parametric furniture definition supports many body × opening × layout
  combinations without duplicated structures.
- New resolver work in Go with TS parity fixtures; React and SketchUp only send
  semantic selections.
- Existing `jaladera-gola-*` options need an explicit migration.
- Exact supplier datasheets become a prerequisite for profile authoring.

## Rejected alternatives

- Flags on the furniture (`gola=true`, `frontReduction=40`): accumulate into an
  unvalidated bag of flags and keep geometry wrong.
- One structure per combination (`base-gola-alu-top-center-drawer`):
  combinatorial explosion and unmaintainable library.
- Extending `factoryConstructionPolicy` to own opening: it is a joinery station
  policy; overloading it mixes unrelated authorities.
