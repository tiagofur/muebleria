# ADR-0009 — Opening / Front System separated from Body Construction

- Status: **Accepted** (pilot implemented under #1129–#1393) — [Amendment 1 (Grip styles, 2026-11-06)](#amendment-1--grip-styles-2026-11-06) **Accepted** via PR #1538 (decided in [#1524](https://github.com/tiagofur/muebleria/issues/1524); implementation in progress under #1522)
- Date: 2026-10-05 (amended 2026-11-06)
- Decision owners: Granete architecture
- Canonical detail: [`docs/architecture/opening-front-system.md`](../architecture/opening-front-system.md)

## Context

Granete models the furniture body (`Structure`), sub-assemblies (`Agregado`) and factory joinery policy (`joint.*`) independently. Opening and front behaviour are not yet modelled as independent concerns.

Today, grip options such as `jaladera-gola-*` primarily behave as hardware/BOM options. They do not fully express the geometry they imply: body modifications, front reductions, grip clearances, profile machining or non-uniform front layouts.

As a result, supporting gola, integrated profiles, bottom-reveal/overhang fronts and other opening systems through the current model would require creating separate structures for each combination of body construction and opening configuration. This leads to combinatorial growth and incorrect or manually maintained manufacturing dimensions.

## Decision

1. **Body construction and opening/front behaviour are independent architectural layers.**

   Body construction remains responsible for how the carcass is built. Opening/front behaviour is modelled independently.

2. **Opening/front behaviour is modelled through four independent concerns:**

   - `Opening Layout` — zones, ratios and access types.
   - `Grip System` — how and where the user grips the fronts.
   - `Opening Profile` — the physical profile or grip component and its manufacturing data.
   - `Front Positioning` — overlay, inset, overhang and related positioning rules.

3. **Any option that affects geometry, materials, hardware or manufacturing is a resolvable domain rule, not plain metadata or an unvalidated furniture flag.**

4. **The server-side resolver is the authority for the resulting manufacturing model.** It resolves the semantic selections into derived dimensions, body modifications, machining and BOM. TypeScript may provide parity calculations/previews, but must not become an independent source of truth.

5. **Opening Profiles are versioned library entities.** Their geometry and manufacturing behaviour must be backed by authoritative supplier/product data. Unknown required manufacturing values block authoring rather than being silently guessed.

6. **Opening Layout owns zone geometry; `Agregado` remains the authority for zone contents.** Agregados resolve against the bounding boxes produced by the opening layout rather than assuming a uniform `quantity`/`gapMm` stack.

7. **Factory capabilities for opening systems use the existing Library → Factory → Component overlay pattern under an `opening.*` namespace**, with a shared TS/Go contract.

8. **Availability and validity are separate concerns.** Factory capability settings govern new authoring. Existing designs remain valid against their pinned library release. Disabling a capability must never rewrite existing designs.

9. **Derived dimensions are resolver output and are read-only in clients.** Users edit semantic inputs such as construction, layout, grip and profile; they do not manually override dimensions governed by those rules.

## Consequences

### Positive

- A single parametric furniture definition can support multiple body × opening × layout combinations without duplicating structures.
- Opening systems become reusable across furniture types instead of being encoded into furniture-specific structures.
- Manufacturing consequences of gola and other opening systems become explicit and testable.
- React and SketchUp send semantic selections rather than independently calculating manufacturing dimensions.
- Factory configuration can control which opening capabilities are offered without changing the underlying Standard library.

### Negative

- A new server-side resolver and TS/Go parity contract are required.
- Existing `jaladera-gola-*` options require an explicit migration.
- Opening Profile authoring requires authoritative supplier data.
- Existing front-layout assumptions must be replaced by zone-based resolution.

## Rejected alternatives

### Furniture-level flags

Examples:

```text
gola = true
frontReduction = 40
golaType = aluminum
```

Rejected because these create an unvalidated collection of interacting flags and do not provide a coherent manufacturing model.

### One structure per combination

Examples:

```text
base-gola-alu-top
base-gola-alu-top-center-drawer
base-handle-overlay
...
```

Rejected because combinations grow combinatorially and duplicate the same body construction.

### Extending `factoryConstructionPolicy` to own opening behaviour

Rejected because `factoryConstructionPolicy` represents joinery/construction policy. Reusing its overlay mechanism as a pattern is appropriate, but making it the authority for opening systems would mix unrelated responsibilities.

## Scope boundary

This ADR establishes the architecture and authority boundaries for opening/front behaviour.

The concrete data contracts, compatibility matrix, profile schema, resolver rules, migration details and implementation sequence are defined in:

[`docs/architecture/opening-front-system.md`](../architecture/opening-front-system.md)

## Amendment 1 — Grip styles (2026-11-06)

- Status: **Accepted** (merged in PR #1538; implementation in progress under #1522). The owner's answers are recorded in [#1524](https://github.com/tiagofur/muebleria/issues/1524), and the owner approves this amendment through the PR that adds it.
- Epic: [#1522](https://github.com/tiagofur/muebleria/issues/1522). Delivery: phases 1–5 (#1525–#1537).
- Scope: this amendment replaces decision 7 for grip and front behaviour, and restates parts of decisions 5 and 9. Every other decision above still applies.
- Canonical detail: [`opening-front-system.md` §14](../architecture/opening-front-system.md#14-amendment-1--grip-styles-target).

### Context

The pilot implementation of this ADR (#1129–#1393) passed issue by issue, but the result is hard to use as a whole. The review in #1522 found:

- **Factory capability controls nothing reads.** The per-furniture-type restrictions and both "default" controls are never consumed: the design opening write does not pass the furniture type to the validator, and no client reads `default`.
- **A bottom overhang that cannot be configured.** It can be enabled, but nothing writes `opening.bottom-overhang`, so every selection resolves to `OPENING_OVERHANG_EVIDENCE_PENDING`.
- **Grip data in five places:** the profile catalog, `opening.capabilities`, `opening.bottom-overhang`, the design selection with its partial pin, and the legacy `jaladera-gola-*` options.
- **A profile editor that takes raw UUIDs and free-text member keys,** while the engine only reads the exact keys `profile`, `supports` and `endCaps`.
- **Per-furniture selection only.** The common industry pattern (Cabinet Vision, Mozaik, ML Cabinets) decides the grip once per job and lets each cabinet inherit it.
- **Two different front heights.** The geometry subtracts the discount from a front that already carries its catalog reveal (built `H − reveal − discount`), while the resolution reports `H − discount`.

### Decisions

**A1. Vocabulary.** The user-facing concept for handle, gola and bottom overhang is **Grip** («Agarre»). «Apertura» is reserved for door swing and presentation (#529/#1377). New entities use `grip` names. Existing `opening_*` identifiers are renamed only where a migration already touches them.

**A2. Three concepts replace the capability overlay (decision 7):**

1. **Gola profile.** A workshop-owned catalog record, with organization-scoped rows as today.
   - Material: `aluminum | melamine`. The melamine variant is the Italian gola.
   - Positions: `top | between`, available to both materials.
   - Required before use: height, depth, and the **front discount** for each position the profile declares.
   - Manufacturer values are only suggestions at creation (SCILM 8006 L top: 40; 8007 C between: 36). The workshop may change them, because its number is a declared workshop fact, versioned and auditable. `geometryOrigin` becomes informational.
   - Italian gola defaults (owner, #1524), all editable by the workshop:
     - front discount 36 at the top and 36 between fronts;
     - door bevel at 45° with a size of `depthMm − 2`;
     - side notch of 70 × strip thickness, with 1 mm of clearance added to each dimension (a 16 mm strip gets 71 × 17);
     - the strip takes the material and colour of the fronts.
   - Body effects are declared data, consistent with §13.6:
     - top depth reduction (full top) or front-manguete retraction, chosen by the declared Construction Variant;
     - an optional side notch;
     - an optional door bevel (Italian gola: 45°).
   - Parts are chosen from the catalogs by fixed role: `profile`, `supports` (with spacing), `endCaps`, and for the Italian gola the `strip` panel component (70 mm by default, editable).
2. **Grip style.** A workshop setting: a named recipe for each `FurnitureType`, with one of these modes:
   - `handle`: the default handle hardware;
   - `gola`: a top profile, plus an optional between profile;
   - `bottom_overhang`: a value in millimetres, 20 by default and editable.

   Each style is offered or not, and exactly one style is the default.
3. **Project grip.** The project selects a style in the SketchUp Inspector with nothing selected, and every furniture inherits it. A furniture may carry an override, either another style or custom values, chosen in the Inspector with that furniture selected.

**A3. Front discount semantics.** This replaces the §5 formula and closes the §13.4 investigation. Discounts are measured from the cabinet height, as the datasheet does:

- **Top grip with discount `D_top`.** The top edge of the topmost front sits at `H − D_top + r_bottom`, where `r_bottom` is the catalog's normal bottom reveal of the stack. A single front therefore measures exactly `H − D_top`, and its bottom edge does not move.
- **Between grip with discount `D_between`.** The gap between the two adjacent fronts is `D_between`, replacing the normal gap.
- **Bottom overhang of `X` mm.** The bottom edge of the lowest front sits `X` below the bottom of the body.
- **Edges without a grip** keep the catalog's normal reveals.
- **Remaining height** is split by the zone ratios.

The discount is never added on top of the normal reveal. Clients show the built front dimensions, which are the values the geometry uses.

Parity fixtures for Go and TS, from the SCILM datasheet with a reveal of 1.5:

| Case | Front height |
| --- | --- |
| No grip, 1 front | `H − 3` |
| No grip, 2 fronts | `(H − 6)/2` |
| Top L | `H − 40` |
| Between C only | `(H − 39)/2` |
| Top L + between C | `(H − 76)/2` |
| Overhang 20 | `H − 1.5 + 20` |

The resolution precision must represent half millimetres. The rounding and remainder policy is fixed in the contract issue (#1529).

**A4. Bottom overhang no longer waits for field evidence.** Its millimetres are a style parameter: 20 mm by default (an owner decision), editable in the style and overridable per furniture.

**A5. Retired after migration (phase 2):**

- `opening.capabilities` (enabled, default, curated profiles, standard per section, per-type placements and defaults);
- `opening.bottom-overhang` and `OPENING_OVERHANG_EVIDENCE_PENDING`;
- grip types in the profile that are not profiles (`handle`, `bottom_reveal`, `none`);
- the legacy pair of front reduction and grip clearance;
- the code branches for pins authored before #1263, #1283 and #1287, once the pilot data is migrated;
- the placement select in clients. Position now derives from the style, the furniture type and the front stack.

**A6. Kept unchanged:**

- the server resolve is the authority, and React and Ruby never compute fronts;
- a missing required value is an explicit blocked state with an actionable Spanish message;
- available ≠ valid;
- notch and bevel have one definition, shared by geometry and CNC;
- components are addressed by constructive role, never by name.

**A7. Freezing.** The project's style and each override are frozen as one complete snapshot, holding the style values and the profile values they use, at the moment they are applied. Later workshop edits never change existing projects. The Inspector offers an explicit «Actualizar a los valores actuales del taller». Quotes and production releases consume the snapshot.

### Rejected alternatives (amendment)

- **Store a per-edge gap (for example 38.5) instead of the front discount.** The owner rejected it: workshops think in the datasheet's front discount (`H − 40`), and A3 derives the edge gap from it.
- **Keep the six capability controls and add consumers.** The decision users actually make is a style, not a capability matrix.
- **Gate workshop values on a verified datasheet.** Workshops deviate from manufacturer values and use other profiles (#1524, Q5). The workshop's declared number is the authoritative input, and a missing number still blocks.
- **Keep `opening.bottom-overhang` as a separate overlay blob.** It hid the only required value from every screen.