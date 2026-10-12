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

## 13. Dimensional contract for profile supports, side notches and CNC

Tracking issue: [#1282](https://github.com/tiagofur/muebleria/issues/1282). This section records the intended contract; it does **not** claim that the physical values or CNC output have already been verified.

### 13.1. Dimensions, references and manufacturing rules are different data

An Opening Profile / hardware definition must expose its physical dimensions even when the consuming factory cannot edit them. At minimum, the Gola profile needs datasheet-backed height and depth, a stable product identity/revision, supported placements, and an explicit geometric reference frame.

Keep these concepts separate:

- **Physical profile dimensions**: dimensions of the exact commercial profile, sourced from an identified datasheet.
- **Support geometry and placement**: dimensions of the compatible support, its local origin/orientation, and the point or face used to position it.
- **Insertion into the side**: the support's insertion/contact point and tool-entry face, resolved against the actual side-panel thickness and local coordinate frame.
- **Front manufacturing adjustment**: the rule used to calculate the final door/front dimension. It is not automatically equal to the physical profile height or depth.
- **Body machining**: the notch/cut-out and the corresponding machining feature for the side panel.

Do not introduce global fields such as `gola_l_height` or `gola_c_height` as the source of truth when several exact profiles can belong to one family. Store dimensions with the exact profile/product definition; store factory-specific, allowed manufacturing adjustments in the existing policy/overlay model and pin the effective values through the existing release lifecycle. Reuse #1102/#772/#773; do not add a second versioning mechanism.

### 13.2. Support placement contract

For a support compatible with a given profile, the intended geometric constraints are:

- Vertical position: **profile height / 2**, measured from the explicitly declared height reference of that profile.
- Depth position: resolved from the profile's declared depth and an explicit reference (for example, a profile face, support bearing face, or insertion point). The contract must state which reference is used; the word “depth” alone is insufficient.
- Side insertion point: resolved using the actual side thickness, support geometry, installation face and local coordinate frame. Thickness is an input to the geometric relationship, not a coordinate by itself.
- Orientation and handedness: left/right side transforms must preserve the intended physical entry face and must not accidentally mirror the machining operation to the wrong face.

The exact support SKU, local origin, offsets and installation face must be documented from a verified drawing/datasheet or an explicit validated factory rule. Do not infer them from the visual asset, a product name, or a guessed center point. The formula height/2 is a placement rule, not permission to invent missing profile/support dimensions.

### 13.3. Side notch and CNC operation

A side notch is a construction/manufacturing effect of a compatible Opening Profile only when that profile's verified installation specification requires it. Do not assume all Gola L/C profiles require the same notch; some installations may not require a body notch.

When required, the notch definition must identify at least: target constructive role (`side`), local reference/anchor, side and face, height, depth, width/extent, position, tool-entry face, units, source profile/revision, and applicable tolerances/constraints. Values mentioned during investigation such as 19 × 10 mm are **unverified examples**, not defaults or universal specifications.

The visible side geometry and the CNC machining feature must derive from the same resolved definition. The notch must flow through the existing machining pipeline and retain provenance to the source profile/release and target component instance. Validate operation depth, access/face, panel thickness, coordinate transform and machine/output capability. A visual cut-out without a corresponding manufacturing operation is incomplete; a machining operation without matching resolved geometry is also incomplete.

Use constructive roles and stable component-instance identities, never part names or string matching. Do not create a second CNC/machining engine. If the required physical data or output capability is missing, block the affected authoring/manufacturing result with an explicit diagnostic rather than silently omitting the cut or inventing a fallback.

### 13.4. Door-height adjustment: 30 mm versus 40 mm

A factory has reported using a 30 mm door-height adjustment where a manual/reference is understood to indicate 40 mm. This is an open investigation, not a decision that either value is universally correct.

Before setting a default, document what each number measures and its reference geometry: physical profile height, installation envelope, door/front reduction, grip clearance, or a total adjustment that may include other clearances. Confirm the exact profile/SKU and source document. Do not change the physical profile dimensions to make a door formula match a factory adjustment.

The effective front adjustment must be explicit, scoped to the applicable profile/installation/factory policy, validated, and traceable. A missing required physical dimension blocks authoring; a permitted factory-specific adjustment must not be silently replaced by the catalogue dimension. Avoid double-applying reductions when multiple grip boundaries (for example, top Gola L plus intermediate Gola C) are present.

### 13.5. Required validation scenarios

- Gola L and Gola C profiles with verified dimensions and explicit support compatibility.
- Support height at profile height / 2, tested numerically against the declared reference.
- Depth positioning with the reference documented and the side insertion point resolved for the actual panel thickness.
- Left and right side panels, mirrored transforms, and correct machining face.
- Profile that requires a notch versus a verified profile/installation that does not.
- Same geometry definition drives both the visible notch and CNC feature.
- Missing dimensions, missing support drawing, unknown notch requirements, incompatible thickness or unsupported machining capability fail closed.
- Factory front adjustment of 30 mm versus 40 mm is tested only as two explicitly configured cases after the meaning and reference of each are documented; neither becomes a universal default by test convenience.
- Resolve/rebuild/sync is deterministic and idempotent; no duplicate cuts or repeated door reductions.
- Go/server resolve remains authoritative; TS is parity-only where applicable, and SketchUp consumes the resolved placement/machining output rather than maintaining its own geometric formula.

See [#1282](https://github.com/tiagofur/muebleria/issues/1282) for the issue-level acceptance criteria.

### 13.6. Conditional body effect: full top versus manguetes

The top Gola L profile's physical depth must be available to resolve the body geometry. Its effect is **conditional on the declared Construction Variant/body topology**, not inferred from component names, dimensions, visual inspection, or whichever component happens to be found first.

The intended alternatives are:

1. **Full top/techo completo:** shorten the depth of the component whose canonical constructive role represents the full top by the resolved Gola L depth (subject to the verified profile/install reference). The body resolver must state which edge/reference is held fixed and which edge moves; “reduce depth” alone is not a complete geometric contract.
2. **Manguetes construction:** do not apply the same depth reduction to a full-top component if that topology does not have one. Instead, retract the relevant manguete component(s) toward the back by the resolved Gola L depth, using their declared local frame and installation reference.

The terms *techo completo* and *manguetes* are semantic construction choices. The selected Construction Variant must explicitly declare the body topology and the canonical component role(s) that exist. The resolve composes that intent with the selected Opening Profile and emits the corresponding body modifier. It must not guess from names such as `techo`, `manguete`, `costado`, from part dimensions, or from mesh inspection.

This preserves the architectural boundary: Construction Variant declares **which body construction exists**; Opening Profile declares **which dimensional effect its installation requires**; server resolve combines them. Neither layer should absorb the other's intent. If the declared variant is absent, ambiguous, or does not provide the required role/reference, fail closed with an actionable diagnostic rather than applying the modifier to a similarly named part.

The exact mapping for “manguete” to the repository's canonical `ConstructiveRole` vocabulary must be confirmed during the Construction Variant contract. Do not introduce a role string ad hoc or silently map it to `divider`/ `custom` without documenting the semantic meaning and fixtures.

### 13.7. Required validation for top construction variants

- A fixture with **full top** proves that the top's resolved depth is reduced by the selected Gola L profile depth from the documented reference.
- A fixture with **manguetes** proves that the relevant manguete component(s) retract toward the back by that same resolved profile depth, and that the full-top modifier is not also applied.
- The two variants use the same opening profile and otherwise equivalent cabinet dimensions; only the declared Construction Variant changes the body effect.
- A variant never receives both alternatives unless its explicit contract requires both.
- Missing profile depth, missing reference frame, unknown body variant or missing target role blocks the affected resolve; no zero/default depth or name-based fallback.
- The body geometry, side notch/CNC feature (when the exact profile requires it), and BOM/placement output remain consistent after resolve, rebuild and synchronization.
- Go/server resolve is authoritative; TS parity fixtures mirror the contract, while SketchUp sends the selected construction/opening intent and consumes resolved output.

