# Opening / Front System

- Status: **Implemented (pilot)** — contract, profile entity, layout/body/BOM
  resolvers, capability overlay, validation, migration tool, design carrier
  and the SketchUp Inspector card are merged (#1129–#1137). OQ-2 (datasheet
  values) and OQ-3 (overhang evidence) still gate the verified-pilot path;
  multi-zone layouts and release-pinned profile blobs remain explicit
  follow-up scope.
- **Target: Amendment 1 — Grip styles** (2026-11-06, proposed in
  [#1524](https://github.com/tiagofur/muebleria/issues/1524), epic
  [#1522](https://github.com/tiagofur/muebleria/issues/1522)). See
  [§14](#14-amendment-1--grip-styles-target). Sections marked *Superseded
  by §14* describe what is implemented today. They stay until the phase 2
  migration retires it.
- Decision record: [ADR-0009](../adr/0009-opening-front-system.md)
- Epic: [#1128](https://github.com/tiagofur/muebleria/issues/1128) (pilot), [#1522](https://github.com/tiagofur/muebleria/issues/1522) (grip styles)
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
    # Potential effects declared by profile; the server resolve selects the
    # compatible target using the declared Construction Variant/topology.
    - role: top                     # full-top variant only; constructive role, not name
      depthReductionMm: <derived>   # full top sits behind the profile
    - role: <canonical-manguete-role> # manguetes variant only; role vocabulary must be defined by #1139
      retractTowardBackMm: <derived>
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

> *Superseded by §14.4 for the height formula.* Zones, ratios and grip
> boundaries stay. The discount is measured from the cabinet height and
> replaces the edge's normal reveal instead of being added to it.

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
| **A** | inferior | 2 hinged doors | gola L, `top` | Body effect depends on declared Construction Variant: full-top → reduce top depth; manguetes → retract manguetes toward back. Apply only the compatible effect. Side notch only if required by verified profile/install data. | Door height reduced by the profile's front reduction so fingers reach behind the door | Profile by length, supports, end caps |
| **B** | inferior | drawers 1x / 1x / 2x | gola L `top` + gola C `between(z2,z3)` | Gola L body effect follows the declared Construction Variant (full-top reduction OR manguetes retraction); side/C notches only if required by verified profile/install data | Drawer 1 gripped from above (gola L); drawer 2 gripped from below (gola C upward recess); drawer 3 gripped from above (gola C downward recess). Heights from §5 with two grip boundaries | L + C profiles, supports, end caps |
| **C** | superior | 1–2 hinged doors | `bottom_overhang` (no hardware) | None | Door extends below the cabinet bottom by an overhang; user grips from underneath | No grip hardware |
| Baseline | inferior | 2 hinged doors | handle | None | Standard overlay | Handle per door |

Open questions that block fixtures (see §12): OQ-2 (datasheet values), OQ-3 (case C overhang value and body interaction). OQ-1 is resolved by the dual-cavity mechanism of Gola C.

## 7. Library, factory capabilities and selection

> *Superseded by §14.2–§14.3.* The `opening.capabilities` overlay
> (enabled, default, curated profiles, standard per section, per-type
> placements and defaults) is replaced by Grip Styles and the Project grip.
> Its per-type restrictions and defaults never had a consumer (#1522).

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

> *Superseded by §14.7.* The Inspector no longer offers a placement select.
> «Apertura» is reserved for door swing and presentation, and the grip card
> is named «Agarre».

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

> *Resolved by Amendment 1 (#1524).* OQ-2: the values are workshop
> parameters, with the datasheet values as suggestions (§14.2). OQ-3: the
> overhang is a style parameter, 20 mm by default (§14.5).

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

> *Resolved by §14.4.* The SCILM datasheet (p. 8) defines `H − 40` for
> 8006, which is 38.5 above the door plus 1.5 below. The value is a
> workshop parameter measured from the cabinet height, so a workshop that
> uses 30 declares 30. The implemented engine adds the discount on top of
> the catalog front's reveal, which probably explains part of the reported
> difference.

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

## 14. Amendment 1 — Grip styles (target)

Decision: [ADR-0009, Amendment 1](../adr/0009-opening-front-system.md#amendment-1--grip-styles-2026-11-06).
The owner's answers are in [#1524](https://github.com/tiagofur/muebleria/issues/1524), and the epic is [#1522](https://github.com/tiagofur/muebleria/issues/1522).
This section is the **target**. Sections 1–13 describe the implemented pilot until phase 2 migrates it.

### 14.1. Why

The pilot works issue by issue, but users cannot operate it as a whole:

- six factory controls cover one decision, and several of them have no consumer;
- the bottom overhang cannot be configured;
- profile parts are entered as raw UUIDs with exact free-text keys;
- the grip is chosen per furniture with three selects;
- the engine adds the discount to the catalog reveal.

Mature cabinet software expresses the same domain as a *reveal* at an edge of the front, chosen once per job and inherited by each cabinet. Every grip system reduces to one rule: **each edge of the front stack has a gap, and the grip says what fills the body behind it.**

### 14.2. Gola profile (workshop catalog record)

```yaml
golaProfile:                         # org-scoped row (opening_profiles today)
  code: GOLA-L-8006
  name: Gola L Cymisa 8006
  manufacturer: SCILM                # informational
  material: aluminum                 # aluminum | melamine (Italian gola)
  positions: [top]                   # top | between (both materials)
  heightMm: 56.5                     # required
  depthMm: 27.2                      # required
  frontDiscountTopMm: 40             # required if positions ∋ top
  frontDiscountBetweenMm: null       # required if positions ∋ between
  geometryOrigin: "SCILM 2022-04-01 p. 42"   # optional, informational
  body:
    topSetback: true                 # full top shortens OR front manguete retracts (§13.6)
    sideNotch: false
    doorBevelMm: null                # Italian gola: 45° bevel size
  parts:                             # fixed roles; references picked from catalogs
    profile:  { hardwareId: <sku>, rule: interior_width }
    supports: { hardwareId: <sku>, rule: per_length, spacingMm: 600, dimensionsMm: [..] }
    endCaps:  { hardwareId: <sku>, rule: per_exposed_end }
    strip:    { componentId: <panel>, heightMm: 70 }   # Italian gola only
```

- Default values are suggestions when the profile is created, and the workshop may change them. No range limit applies.
  - 8006 L top: 40 (SCILM datasheet).
  - 8007 C between: 36 (SCILM datasheet).
  - Italian gola: 36 top and 36 between (owner, #1524).
- A missing required value blocks the profile **for that position only**, with a Spanish message that names the field.
- There is no "verified datasheet" gate. The workshop's declared number is the authoritative input, and every change is versioned and audited.
- Grip types that are not profiles (`handle`, `bottom_reveal`, `none`) do not exist in this catalog.

### 14.3. Grip style and project grip

```yaml
gripStyle:                           # new org-scoped table (#1531)
  name: Gola negra Cymisa
  offered: true
  isDefault: true                    # exactly one per organization (DB-enforced)
  byFurnitureType:
    inferior: { mode: gola, top: GOLA-L-8006, between: GOLA-C-8007 }
    superior: { mode: bottom_overhang, overhangMm: 20 }
    alto:     { mode: handle, handleHardwareId: <sku> }

project:
  gripStyleId: <style>               # chosen in the SketchUp Inspector with no selection
  gripSnapshot: { ...style + profile values, frozen when applied }
furniture:
  gripOverride: null | { styleId } | { custom }   # Inspector with the furniture selected
  gripSnapshot: { ... }              # only when overridden
```

The server resolves the inheritance. A furniture without an override uses the project's snapshot. Placement is never chosen by the user:

- the top edge receives the style's top profile, or the overhang for `bottom_overhang`;
- every between edge of a stacked front column receives the between profile when the style defines one;
- otherwise, between edges keep the normal gap.

### 14.4. Front discount rule

The discount is measured from the cabinet height `H`, as the datasheet does, and replaces the edge's normal reveal:

| Edge | Position of the edge |
| --- | --- |
| Top, with gola `D_top` | top edge of the topmost front = `H − D_top + r_bottom` |
| Top, without grip | catalog normal (`H − r_top`) |
| Between, with gola `D_between` | gap between the two fronts = `D_between` |
| Between, without grip | catalog normal gap |
| Bottom, with overhang `X` | bottom edge = `−X` (below the body bottom) |
| Bottom, otherwise | catalog normal (`r_bottom`) |

Front heights = (top edge − bottom edge − Σ between gaps) × ratioᵢ / Σ ratios. Width is unchanged (`W − 3` in the datasheet).

Datasheet fixtures (SCILM pp. 8–9, `r = 1.5`, `H = 720`):

| Case | Formula | 720 |
| --- | --- | --- |
| No grip, 1 front | `H − 3` | 717 |
| No grip, 2 fronts | `(H − 6)/2` | 357 |
| Top L (40) | `H − 40` | 680 |
| Between C (36) only | `(H − 39)/2` | 340.5 |
| Top L + between C | `(H − 76)/2` | 322 |
| Wall cabinet, overhang 20 | `H − 1.5 + 20` | 738.5 |

- The resolution reports the **built** front dimensions, the same numbers the boards use.
- Precision represents half millimetres. The remainder policy is fixed by #1529.
- Pins of contract v1 keep their v1 arithmetic until #1532 migrates them, so no historical design changes silently.

#### 14.4.1. Implemented: A3 engine (#1529)

- **Contract v2** `granete.opening-front.v2`: `ResolveOpeningEdgeStack` (Go) and `resolveOpeningEdgeStack` (TS), shared fixture `contracts/openingFrontEdgeStack.contract.json`. It has the 7 datasheet cases, the Italian cases and the 3-drawer column.
- **Precision and remainder:**
  - every input is a multiple of 0.5 mm, and the math runs in integer half millimetres;
  - each row gets `floor(remaining × weight / Σ weights)`;
  - the leftover half millimetres go to the lowest row first, moving up.
- **Stack:** read from the resolved poses of the door and drawer-front boards, never from names or order.
  - Fronts whose vertical extents overlap share a row (doors side by side).
  - The row weight is its catalog height.
  - The reveals and gaps come from the same geometry, so a front without a grip keeps its catalog size.
  - The body floor is the base panel (or z = 0).
  - A front next to a stacked column is not one stack and stays blocked (`OPENING_STACKED_FRONTS_UNSUPPORTED`).
- **One measure:** the layout writes the A3 pose on each front board. The cut list resolves the same furniture's boards and copies each measure by part id. `BoardPart.LengthMm` is decimal since #1529; authored template parts stay whole millimetres.
- **Inputs:**
  - `OpeningResolvedFront.EdgeGrips` (v2: top, between and overhang) always resolves with A3. #1532 produces it.
  - A v1 pin keeps the v1 arithmetic on fronts side by side.
  - A v1 pin over stacked fronts, blocked by #1528, now resolves with A3, using its discount at the top and its overhang at the bottom. No resolved design changes.
  - A v1 bottom gola over a stack stays blocked.
- **Notch and bevel at the stack's edges:**
  - top → the top row;
  - bottom → the lowest row;
  - between → the bevel cuts the top edge of every front below a between edge, and the side notch hangs from the bottom edge of the front above it, one notch per between edge.
- **Not in #1529:**
  - the design-level report (`ResolveDesignOpening` still reports the v1 single zone);
  - the hardware BOM of between edges;
  - the producer of `EdgeGrips`, the project grip.

  These arrive with #1532.

### 14.5. Bottom overhang

- The overhang is a `bottom_overhang` style mode with `overhangMm`: 20 by default, editable in the style and overridable per furniture.
- No profile and no hardware are involved, and the body is unchanged.
- The value is the workshop's declaration, so the blocked state "waiting for field evidence" disappears.

### 14.6. Italian gola

- The Italian gola is a gola profile with `material: melamine`, available at the **top and between** positions.
- Its `strip` part is a panel component, 70 mm high by default and running the full width. It takes the **material and colour of the fronts** (the `FRENTES` choice, #1327) and goes to the cut list as a board.
- The door edge at that boundary gets a 45° bevel toward the back, so the face stays full. The bevel size is **`depthMm − 2`** by default. Bevel geometry and CNC share one definition (#1327).
- The side panels get a **notch of 70 × strip thickness**, with **1 mm of clearance**. The strip thickness is the resolved thickness of the fronts' material, so the notch follows the material and is never a typed constant. The notch is visible geometry and a CNC operation from one definition (§13.3).
- At the top, its body effect is the same as gola L: the full top shortens, or the front manguete retracts, according to the Construction Variant (§13.6).
- Default front discounts (owner, #1524): **36 at the top and 36 between fronts**. The workshop may change them.

Italian gola fixtures (`H = 720`, `r = 1.5`):

| Case | Formula | 720 |
| --- | --- | --- |
| 1 door, Italian top 36 | `H − 36` | 684 |
| 2 fronts, Italian top 36 + between 36 | `(H − 72)/2` | 324 |

The 1 mm clearance is added to both notch dimensions, as the owner confirmed in #1524. A 16 mm strip gets a 71 × 17 mm notch.

### 14.7. Surfaces

- **Web › Ajustes › Agarres** (#1533): the list of styles, an editor with one row per furniture type, and a server-computed preview such as «Mueble de 720 → puerta de 680».
- **Web › Catálogo › Perfiles de gola** (#1534): material, positions, discounts with a live server preview, a schematic section drawing, and parts by role (#1526).
- **SketchUp Inspector** (#1535):
  - with no selection, it shows «Agarre del proyecto», the offered styles as options with a drawing;
  - with a furniture selected, it shows the «Agarre» card: inherited, «Cambiar sólo este mueble» and «Volver al del proyecto»;
  - with several furniture selected, the change applies to all of them;
  - «Apertura» is reserved for door swing and presentation.
- **SketchUp host** (#1536): the L and C profiles, the Italian strip at the top and between drawers, the bevel and the overhang, all drawn from server output.

### 14.8. Freezing and validity

- Applying a style to the project, or an override to a furniture, freezes one complete snapshot.
- Later edits to profiles or styles never change existing projects until the user chooses «Actualizar a los valores actuales del taller».
- Quotes and production releases consume the snapshot.
- Disabling «Ofrecer» hides the style for new choices only (available ≠ valid).

### 14.9. Migration and retirement (phase 2)

| Retired | Replaced by | Issue |
| --- | --- | --- |
| `opening.capabilities` blob | `grip_styles` | #1531 |
| `opening.bottom-overhang` blob, `OPENING_OVERHANG_EVIDENCE_PENDING` | `bottom_overhang` mode in the style | #1531 |
| `handle` / `bottom_reveal` / `none` profile grip types | style modes | #1530 |
| front + clearance pair, `door_reduction_mm` | `frontDiscountTopMm` / `frontDiscountBetweenMm` | #1530 |
| `DesignOpeningSelection` + partial pin + pre-#1263/#1283/#1287 branches | project grip + override snapshots | #1532 |
| placement select, «Apertura del diseño» cards | «Agarre» card | #1535 |

Every migration runs on fresh and upgraded databases and writes a per-row report attached to its issue.

#### 14.9.0. Implemented: grip styles (#1531)

- **Table `grip_styles`** (migration 000181), tenant-owned:
  - RLS read/insert/update/delete on `app_current_organization_id()`;
  - inventory row and grants;
  - **at most one default per organization**, enforced by the partial unique index `grip_styles_one_default_per_org`;
  - a default is always offered;
  - every style declares `inferior`, `superior` and `alto`.
- **Recipe per type:**
  - `handle`, with an optional hardware;
  - `gola`, with a top profile and an optional between profile, each active and usable at that position (#1530 use rule);
  - `bottom_overhang`, in whole millimetres > 0, with 20 when omitted (A4).
- **API** `/api/catalog/grip-styles`:
  - CRUD with If-Match; writes need the catalog role;
  - 422 in Spanish for invalid writes and 412 for version conflicts;
  - making a style the default replaces the previous one in the same transaction, after locking the organization's rows;
  - the default cannot be deleted, nor unset by itself.
- **Audit:** `grip_style_created`, `grip_style_updated` and `grip_style_deleted` in `security_audit_events`, in the same transaction. The repository has no outbox.
- **Seed:** «Jaladera» (all types handle) for every organization, by backfill and by an `AFTER INSERT ON organizations` trigger.
- **Blob conversion:**
  - the per-type default system of `opening.capabilities` becomes the style «Agarre del taller (migrado)», using the standard L or the first usable curated profile for gola, and the blob's millimetres (or 20) for the overhang;
  - an overhang that was not the default anywhere becomes «Rebase (migrado)»;
  - the report sits in `migration_report`;
  - then both keys are removed from the overlays, and the down migration puts them back.
- **Retired:**
  - the `opening.` overlay namespace, `ParseOpeningCapabilities` and `ParseOpeningOverhangRule` (Go and TS) and their fixtures;
  - `POST /catalog/opening-configuration/validate`, which had no consumer;
  - `OPENING_OVERHANG_EVIDENCE_PENDING`: a resolve without millimetres is `OPENING_LAYOUT_INVALID`;
  - the old web section, now a notice pointing to the styles (the editor is #1533).
- **Projection kept for current consumers:**
  - `GET /catalog/opening-capabilities` (the SketchUp extension) and the design-opening write gate read `OpeningCapabilitiesFromGripStyles`;
  - v1 `bottom_overhang` selections take their millimetres from `OpeningOverhangRuleFromGripStyles`: the default style (wall cabinets first), then the first offered style, then 20.

#### 14.9.1. Implemented: gola profile v2 (#1530)

- **Migration 000180** adds `material`, `positions`, `front_discount_top_mm`, `front_discount_between_mm` and `v2_migration` to `opening_profiles`. The RLS classification is unchanged.
- **Data migration**, with the report in each row's `v2_migration`:
  - `handle`, `bottom_reveal` and `none` rows are deactivated (`reason: grip_type_not_profile`);
  - gola rows get `positions = compatible_placements ∩ {top, between}`, and a row left without a position is deactivated (`reason: no_v2_position`);
  - `front_discount_top_mm` takes `door_reduction_mm`, or the pair `front_reduction_mm + grip_clearance_mm`. The number is copied as is: A3 measures it from `H`, and the engine change is #1529;
  - `front_discount_between_mm` stays empty (`missing`), because no legacy field declares it;
  - the only component member moves to the `strip` role, with `height_mm: 70` when absent. Unknown roles are reported, never dropped.
- **Use rule:** `domain.OpeningProfile.UsageAt(position)` and the read-only `usage` map in every API read. A profile is usable at a position when it is active, declares the position, and has height, depth and that position's front discount. `datasheet_status` and `geometry_origin` are data only.
- **Writes:** fixed roles (`profile`, `supports` and `endCaps` take a catalog hardware; `strip` takes a catalog component and only in melamine), discounts `> 0` with no upper bound, and references checked against the caller's catalog under RLS. Any rejection answers 422 with a Spanish message.
- **Suggestions:** `GET /api/catalog/opening-profiles/suggestions` serves 8006 L (top 40), 8007 C (between 36) and the Italian gola (36/36, strip 70, notch 70 × strip thickness + 1, bevel 45° of `depth − 2`).
- **Bridge until the legacy readers retire:**
  - a write with `material` is v2-shaped: `grip_type = gola`, `compatible_placements = positions` and `door_reduction_mm = front_discount_top_mm`;
  - a write without `material` (the #1526 editor) is legacy-shaped: the server derives the v2 fields and keeps the ones the client cannot express.

| Still readable | Read by | Retired in |
| --- | --- | --- |
| `door_reduction_mm`, `front_reduction_mm`, `grip_clearance_mm` | engine, design pin | #1529, #1532 |
| `grip_type`, `compatible_placements` | design selection and pin, #1526 editor | #1532, #1534 |
| `datasheet_status` gate in the legacy selection, pin and engine | `DesignOpeningSelection` | #1532 (with the selection itself) |
| legacy-shaped write bridge | #1526 editor | #1534 |

### 14.10. Delivery

| Phase | Issues |
| --- | --- |
| 1. Immediate fixes, no model change | #1525, #1526, #1527, #1528 |
| 2. Backend | #1529 (engine), #1530 (profile v2), #1531 (styles), #1532 (project grip) |
| 3. Web | #1533 (styles), #1534 (profile editor) |
| 4. SketchUp | #1535 (Inspector), #1536 (host render) |
| 5. Verification | #1537 |

