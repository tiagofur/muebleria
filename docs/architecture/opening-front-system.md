# Opening / Front System

- Status: **Implemented (pilot)** — contract, profile entity, layout/body/BOM
  resolvers, capability overlay, validation, migration tool, design carrier
  and the SketchUp Inspector card are merged (#1129–#1137). OQ-2 (datasheet
  values) and OQ-3 (overhang evidence) still gate the verified-pilot path;
  multi-zone layouts and release-pinned profile blobs remain explicit
  follow-up scope.
- Decision record: [ADR-0009](../adr/0009-opening-front-system.md)
- Epic: [#1128](https://github.com/tiagofur/muebleria/issues/1128)
- Related: [`manufacturing-library-platform.md`](manufacturing-library-platform.md) (ADR-0008),
  [`factory-construction-and-joinery.md`](factory-construction-and-joinery.md) (#875/#1052),
  [`catalog-option-selector.md`](catalog-option-selector.md),
  [`hardware-3d-assets-and-assemblies.md`](hardware-3d-assets-and-assemblies.md),
  [`construction-variants.md`](construction-variants.md) (ADR-0010 — la otra
  mitad de la separación: el cuerpo opcionable, fronteras documentadas)

## 1. Problem

How a cabinet is **built** (body) and how it is **opened** (fronts and grip) are
independent dimensions. Today they are not modelled as such:

| Current fact | Evidence | Consequence |
| --- | --- | --- |
| Gola is a handle option, not a geometry rule | `ModuleAgregadoInstance.optionOverrides` example `{ JALADERA: 'jaladera-gola-256' }` (`packages/domain/src/types.ts`); `catalog-option-selector.md` lists *Perfil Gola* as a handle model | Selecting gola changes the BOM line but not the top, the sides or the front height |
| Fronts stack uniformly | `ModuleAgregadoInstance` has `quantity`, `layoutDirection`, a single `gapMm` | No unequal ratios (1x/1x/2x) and no grip gap at a specific boundary |
| Front dimensions are per-instance formulas | `ModuleAgregadoInstance.dimensions.*Formula`, component `lengthFormula/widthFormula` | A gola variant today means hand-editing formulas, i.e. a new structure per combination |
| Factory policy covers joinery only | `factory_construction_policy.go` / `factoryConstructionPolicy.ts` read the `joint.*` overlay namespace | The Library → Factory → Component precedence exists and is reusable as a **pattern**; it does not enable/disable construction or opening options |

Without a dedicated model, every combination of body × opening × layout becomes
a new structure (combinatorial explosion), and gola stays a visual accessory with
wrong cut lists.

## 2. Golden rule

> An option that changes geometry, materials, hardware or manufacturing is never
> plain metadata. It is a resolvable rule owned by the server resolve.

`softClose = true` may be metadata. `grip = gola L aluminum` is not: it changes
body components, front dimensions, machining and BOM.

## 3. Layers

```text
Furniture definition (Module + Structure)
├── Body              → Construction Variant      (how the carcass is built)
└── Opening
    ├── Opening Layout     (zones, ratios, access type per zone)
    ├── Grip System        (handle | integrated_profile | gola | bottom_reveal | none)
    │   └── Opening Profile (exact catalog profile: geometry + BOM members)
    └── Front Positioning  (overlay | inset | partial_overlay | bottom_overhang)
                 │
                 ▼
        Server resolve: body modifiers + front dimensions + machining + BOM
```

| Concept | Owns | Does NOT own |
| --- | --- | --- |
| Construction Variant | Which body components exist and how they meet (full top, mullion top, grooved back…) | Grip, fronts |
| Opening Layout | Zones, their order, height/width ratios, access type (`hinged`, `drawer`, `lift_up`…) | Concrete hardware, profile geometry |
| Grip System | Grip strategy and where grip boundaries are (`top`, `between(i,i+1)`, `bottom`) | Front dimensions directly |
| Opening Profile | Exact physical profile: cross-section parameters, body cut-outs, front reductions, BOM members | Which furniture uses it |
| Front Positioning | Overlay/inset/overhang rules and clearances | Grip |
| Resolve (server) | Combining all of the above into parts, machining and BOM | — |

Existing entities keep their authority:

- `Structure` stays the body. Construction Variants are **not** encoded as more
  flags on `Structure`; they are a separate, versioned library concept (separate
  track, see §11).
- `Agregado` stays the sub-assembly authority for what lives inside a zone
  (door + hinges, drawer box + runners, MERIVOBOX kit). The Opening Layout
  computes each zone's **bounding box and front dimensions**; agregados resolve
  against that box instead of a uniform `quantity`/`gapMm` stack.
- Body modifiers target components by **constructive role** (#1052
  `ConstructiveRole`), never by name. `factory-construction-and-joinery.md`
  already forbids deducing contacts from the name «techo»; the same applies here.

## 4. Opening Profile (gola is a manufacturing entity)

An Opening Profile is a catalog entity in the library release, referenced by exact
id/revision. Conceptual shape:

```yaml
openingProfile:
  id: profile.gola-l.alu            # exact identity, pinned by release
  gripType: gola
  crossSectionShape: 'L'            # extrusion geometry: 'L' | 'C' | 'J' | 'flat'
  compatiblePlacements: [top]       # boundaries where it can mount: top | between | bottom
  geometry:                         # REQUIRED from the exact supplier datasheet
    profileHeightMm: <datasheet>
    profileDepthMm: <datasheet>
    frontReductionMm: <datasheet>   # how much the front is shortened at this boundary
    gripClearanceMm: <datasheet>    # finger space behind the front
  bodyModifiers:
    - role: top                     # constructive role, not name
      depthReductionMm: <derived>   # top sits behind the profile
    - role: side
      notch: { heightMm: <derived>, depthMm: <derived>, at: top_front }
  bom:
    profile: { hardwareId: <exact SKU>, lengthRule: interior_width, unit: meter }
    supports: { hardwareId: <exact SKU>, rule: per_length, spacingMm: <datasheet> }
    endCaps:  { hardwareId: <exact SKU>, rule: per_exposed_end }   # open/closed variant
```

Rules:

- Geometry values come from the exact supplier datasheet. Granete never invents
  them; an unknown value is a blocked authoring state, not a default.
- Supplier references for the first pilot (Cymisa, black finish): GOLA L bar
  4100 mm (SKU 328.160), internal 90° corner (328.161), external 90° corner
  (328.162), open end caps (328.163), closed end caps (328.164), screw supports
  for L and C (328.109). GOLA C (intermediate), REACH (wall cabinets) and
  vertical gola exist as separate profiles. Cross-section dimensions are not on
  the product page and must be taken from the datasheet.
- Corner pieces and runs across several cabinets are a design-level concern
  (multi-module runs); first slices resolve one module, and the run aggregation
  is explicit later scope, never silently approximated.

## 5. Opening Layout and grip boundaries

```yaml
openingLayout:
  id: layout.drawers-1-1-2
  direction: vertical
  zones:                                # top → bottom
    - { id: z1, access: drawer, ratio: 1 }
    - { id: z2, access: drawer, ratio: 1 }
    - { id: z3, access: drawer, ratio: 2 }
```

The Grip System declares which **boundaries** carry a grip:
`top` (above z1), `between(z_i, z_i+1)`, `bottom`. Each grip boundary resolves to an
Opening Profile and consumes height:

```text
availableFrontHeight = cabinetFrontHeight
                     − Σ frontReduction(grip boundaries)
                     − Σ clearances(boundaries)
frontHeight(z_i)     = availableFrontHeight × ratio_i / Σ ratios
```

Rounding is resolved deterministically by the server (remainder to a documented
zone) and pinned by parity fixtures; React and Ruby never recompute it.

## 6. Pilot behaviour matrix

The matrix is the source of the rules and of the TS/Go parity fixtures.
`FurnitureType` (`inferior | superior | alto`) is the existing family key; no new
family enum is introduced.

| Case | Type | Layout | Grip | Body effect | Front effect | BOM |
| --- | --- | --- | --- | --- | --- | --- |
| **A** | inferior | 2 hinged doors | gola L, `top` | Top shortened in depth (sits behind the profile); side notches at top front for the profile | Door height reduced by the profile's front reduction so fingers reach behind the door | Profile by length, supports, end caps |
| **B** | inferior | drawers 1x / 1x / 2x | gola L `top` + gola C `between(z2,z3)` | Top as A; side notches at the C boundary | Drawer 1 gripped from above (gola L); drawer 2 gripped from below (gola C upward recess); drawer 3 gripped from above (gola C downward recess). Heights from §5 with two grip boundaries | L + C profiles, supports, end caps |
| **C** | superior | 1–2 hinged doors | `bottom_overhang` (no hardware) | None | Door extends below the cabinet bottom by an overhang; user grips from underneath | No grip hardware |
| Baseline | inferior | 2 hinged doors | handle | None | Standard overlay | Handle per door |

Open questions that block fixtures (see §12): OQ-2 (datasheet values), OQ-3 (case C overhang value and body interaction). OQ-1 is resolved by the dual-cavity mechanism of Gola C.

## 7. Library, factory capabilities and selection

```text
Granete Standard (defines what exists)
   ↓ factory overlay  (what this factory offers, defaults, per FurnitureType)
User selection        (what this furniture chose)
   ↓ server resolve   (what it physically means)
Resolved parts + machining + BOM
```

The factory capability overlay reuses the ADR-0008 overlay mechanism with a new
namespace, mirroring how `joint.*` feeds the joinery resolver:

```json
{
  "opening.grips": {
    "handle":           { "enabled": true,  "default": true  },
    "gola":             { "enabled": true,  "default": false, "profiles": ["profile.gola-l.alu", "profile.gola-c.alu"] },
    "bottom_overhang":  { "enabled": true,  "default": false }
  },
  "opening.byFurnitureType": {
    "superior": { "gola": { "placements": ["top"] }, "bottom_overhang": { "default": true } }
  }
}
```

Exact key layout is decided in the contract issue together with the TS/Go parity
contract; Go and TS must never maintain incompatible parsers.

## 8. Available vs valid

- **Available** (factory overlay of the release used for authoring) governs what
  new selections may be made.
- **Valid** (pinned `effectiveLibraryReleaseId`) governs resolution of existing
  designs.
- Disabling a capability never rewrites or breaks an existing design. It is
  surfaced as «ya no se ofrece» on the item; resolve still works against the
  pinned release. Changing it is an explicit design change.
- The backend rejects new invalid selections with `INVALID_OPENING_CONFIGURATION`
  (incompatible family, access, placement, disabled capability). Hiding the
  option in the UI is UX, not authorization.

## 9. Derived dimensions are results

Front sizes, profile lengths and body cut-outs are resolve output. The Inspector
shows them read-only (e.g. «Frente 680 × 596 mm»); users change inputs (layout,
ratios, grip, profile), never derived values. A manual formula override on a
grip-governed dimension is an authoring error, not a silent precedence rule.

## 10. Surfaces

- **Server (Go)**: resolve authority, validation, overlay reading.
- **TS domain**: parity reading for editor previews; never a second resolver.
- **Web (React)**: factory capability settings; library authoring of profiles
  and layouts.
- **SketchUp Inspector**: two sections, progressively disclosed:
  - *Cuerpo* → «Construcción» (one select).
  - *Apertura* → «Sistema de apertura» select; only if gola: «Perfil» and
    «Posición» (Superior / Entre frentes); only if overhang: «Rebase (mm)».
  The plugin sends semantic selections; it never computes front sizes.

## 11. Delivery order

1. [#1129](https://github.com/tiagofur/muebleria/issues/1129) Contract + parity fixtures for the matrix (cases A, B, C, baseline).
2. [#1130](https://github.com/tiagofur/muebleria/issues/1130) Opening Profile catalog entity with datasheet-backed gola L / gola C.
3. [#1131](https://github.com/tiagofur/muebleria/issues/1131) Opening Layout resolver (zones, ratios, grip boundaries) feeding agregado boxes.
4. [#1132](https://github.com/tiagofur/muebleria/issues/1132) Body modifiers by constructive role (top depth, side notches as machining).
5. [#1133](https://github.com/tiagofur/muebleria/issues/1133) BOM integration (profile length, supports, end caps).
6. [#1134](https://github.com/tiagofur/muebleria/issues/1134) Factory capability overlay `opening.*` + Web settings.
7. [#1135](https://github.com/tiagofur/muebleria/issues/1135) Validation (`INVALID_OPENING_CONFIGURATION`) and available-vs-valid behaviour.
8. [#1136](https://github.com/tiagofur/muebleria/issues/1136) Migration of `jaladera-gola-*` handle options to the grip model.
9. [#1137](https://github.com/tiagofur/muebleria/issues/1137) SketchUp Inspector *Apertura* section.
10. [#1138](https://github.com/tiagofur/muebleria/issues/1138) Bottom overhang (case C).
11. [#1139](https://github.com/tiagofur/muebleria/issues/1139) Construction Variants for the body (separate track; same overlay pattern).

## 12. Open questions

- **OQ-1 (Resolved)** Case B: with gola at `top` (L) and `between(z2,z3)` (C), drawer 2
  is gripped from below using the upward recess cavity of the C profile, while drawer 3
  is gripped from above using the downward cavity of the same C profile. Drawer 1 is
  gripped from above using the top L profile. Thus only two profile runs are needed.
- **OQ-2** Exact datasheet values for the pilot GOLA L and GOLA C (cross-section,
  front reduction, side notch, support spacing, length rule interior vs exterior).
- **OQ-3** Case C: overhang value, whether the bottom panel moves, and how
  overhang interacts with lights/under-cabinet profiles (REACH).
