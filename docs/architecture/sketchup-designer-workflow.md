# Granete for SketchUp — Designer Workflow and Interaction Surface

> **Status:** CANONICAL UX PRODUCT CONTRACT  
> **Date:** 2026-09-17  
> **Scope:** daily designer experience inside SketchUp  
> **Tracks:** #465, #469, #471, #506, #784, #390  
> **Related authority:**  
> - [sketchup-plugin-excellence.md](sketchup-plugin-excellence.md)  
> - [sketchup-interaction-model.md](sketchup-interaction-model.md)  
> - [sketchup-authoring-interaction-contract.md](sketchup-authoring-interaction-contract.md)  
> - [project-design-digital-thread.md](project-design-digital-thread.md)  
> - [material-aware-furniture-resolution.md](material-aware-furniture-resolution.md)

---

## 1. Purpose

Granete for SketchUp must feel like a **design tool first** and an industrial system second.

The backend/domain may contain complex identity, revision, manufacturing, pricing, machining and synchronization rules. The designer should not have to operate those rules manually during normal authoring.

The intended mental model is:

```text
find furniture
→ place it where it belongs
→ select what matters
→ change what is allowed
→ Granete resolves the consequences
→ continue designing
```

The UI should minimize mode changes, separate screens and explicit synchronization steps.

The core product principle is:

> **Expose designer intent; hide system bureaucracy.**

This document turns that principle into concrete interaction rules.

---

## 2. Three primary surfaces

The normal authoring shell should revolve around three product surfaces:

```text
Biblioteca | Proyecto | Inspector
```

Each has one clear responsibility.

### 2.1 Biblioteca — "qué quiero agregar"

The Library answers:

> Which reusable furniture definition do I want to add?

It owns:

- visual furniture discovery;
- search;
- category browsing;
- recent/favorite items;
- initial configurable parameters;
- entry into placement mode.

It does **not** own Project inventory, revision publication or manufacturing status.

### 2.2 Proyecto — "qué contiene mi trabajo"

The Project panel answers:

> Which physical furniture units belong to this Project/Design, and where are they?

It owns:

- pending Project furniture;
- placed Project furniture;
- identity-preserving placement of existing units;
- locate/select/focus actions;
- concise current Design context;
- Design-level actions that truly belong to the Design lifecycle.

It does **not** become a second furniture property editor.

### 2.3 Inspector — "qué quiero modificar ahora"

The Inspector is contextual and answers:

> What is my current editing scope?

It changes with SketchUp selection and Design context.

```text
valid Design + nothing selected
→ Design Inspector

one furniture selected
→ Furniture Inspector

one part/aggregate selected
→ Component Inspector

one hardware selected
→ Hardware Inspector

multiple managed furniture selected
→ Batch Inspector

unmanaged SketchUp geometry selected
→ Unmanaged context
```

This is a deliberate product decision: **do not create another permanent configuration screen only for finishes, hardware defaults or common design choices.**

---

## 3. Contextual Inspector state machine

The Inspector should be useful even when no furniture is selected.

### 3.1 No selection with a connected Design

Instead of a dead-end "Nada seleccionado", show Design-level configuration:

```text
INSPECTOR

Proyecto
Cocina López

Diseño
Principal

ACABADOS
Cuerpo        Roble Natural          >
Frentes       Blanco Mate            >
Fondo         Blanco 6 mm            >

HERRAJES
Bisagras      Sistema aprobado A      >
Correderas    Sistema aprobado B      >
Jaladeras     Modelo J-04             >
```

This configuration is **Design-scoped**, even if the UI shows the Project name prominently.

Reason: one Project may have multiple Design alternatives with different finishes and hardware choices.

### 3.2 One furniture selected

The same Inspector becomes furniture-specific:

```text
B03 · Bajo 2 puertas

800 × 720 × 560

PARÁMETROS
Ancho          800 mm
Alto           720 mm
Profundidad    560 mm

ACABADOS
Cuerpo         Roble Natural   [Diseño]
Frente         Negro Mate      [Personalizado]
Fondo          Blanco 6 mm     [Diseño]

HERRAJES
Bisagras       Sistema A       [Diseño]
Jaladera       J-04            [Diseño]

[Revisión técnica ✓]
```

The user sees semantic choices, not internal IDs, transforms or schema terminology.

### 3.3 Child selection

Part, aggregate and hardware selection should preserve the owning furniture breadcrumb:

```text
B03 > Puerta izquierda > Bisagra superior
```

Only legal authoring actions are shown, using #476 SelectionContext/capabilities.

### 3.4 Multi-selection

When multiple furniture units are selected, use the same Inspector to show:

- common values;
- mixed values;
- unsupported shared controls;
- affected count;
- explicit batch Apply.

Never use the first selected furniture as hidden authority.

---

## 4. Library insertion is a placement mode, not an origin spawn

The current origin-first mental model is not acceptable as the primary professional workflow.

Target:

```text
Library item
→ optional quick configuration
→ Colocar
→ transient preview follows cursor
→ SketchUp inference / semantic snap
→ click
→ commit
```

Before the commit click, no productive managed furniture exists.

### 4.1 Preview behavior

The preview must:

- follow the cursor;
- show the furniture at real resolved dimensions;
- expose its orientation clearly;
- show the active placement anchor;
- react to SketchUp inference points/faces;
- offer semantic snap suggestions where supported;
- allow cancel with Esc;
- leave zero productive residue on cancel.

A preview may use local transient geometry or other host-safe representation, but is never manufacturing truth.

### 4.2 Click commits placement

Only the placement click commits the top-level furniture transform.

One successful placement should correspond to one coherent SketchUp undo action.

### 4.3 Cancel means nothing was created

```text
choose furniture
→ preview
→ Esc
→ no furniture instance in the model
→ no hidden managed component
→ no stale metadata
```

Connected identity handling is defined in §9.

---

## 5. Semantic placement anchors

The user should feel as if they "grab" the furniture from a useful point.

Do not rely on an arbitrary geometric center.

Conceptual anchors include:

```text
BACK_LEFT_BOTTOM
BACK_RIGHT_BOTTOM
FRONT_LEFT_BOTTOM
FRONT_RIGHT_BOTTOM
```

Additional anchors may be definition-driven where a furniture type needs them.

### 5.1 Default anchor

For a standard base cabinet, a rear-bottom corner is normally the most useful because it maps naturally to wall/floor placement.

The active anchor should be visibly indicated during placement.

### 5.2 Anchor is semantic metadata, not manufacturing geometry

An anchor is an authoring convenience.

It does not change:

- furniture dimensions;
- part dimensions;
- BOM;
- machining;
- material choice.

It only affects how the preview transform is calculated from the cursor/inference point.

### 5.3 Anchor switching

The final placement tool may allow switching the active anchor before commit without reopening the library.

The exact keyboard/mouse shortcut can be chosen during #469 implementation/usability testing.

---

## 6. Semantic snapping

Granete should extend SketchUp inference rather than fight it.

Supported suggestions may include:

### 6.1 Wall / face alignment

When the preview approaches a suitable face:

- propose rear-face alignment;
- orient furniture consistently;
- show the proposed orientation before commit;
- never resize the cabinet to fit the wall.

### 6.2 Floor / base plane

A base cabinet can suggest resting on the intended floor/reference plane.

This is a placement transform only.

### 6.3 Furniture side-to-side

When a new cabinet approaches an existing Granete furniture side:

```text
existing furniture right side
→ suggested new furniture left side
→ gap = 0 mm by default or configured offset
```

The user sees what is being snapped to.

### 6.4 Exact offset

After choosing a snap/reference, allow exact mm input:

```text
gap: 5 mm
```

No quaternion/world-matrix input appears in the normal UX.

### 6.5 Rotate / flip before commit

Orientation changes should happen while the object is still a preview.

The designer should understand which side is front before placement.

---

## 7. Biblioteca and Proyecto converge on the same placement engine

There must not be two independent placement implementations.

### 7.1 From Library

```text
FurnitureDefinition
→ resolved preview
→ Placement Tool
→ commit
```

In connected mode the commit then coordinates with #390 to create the Project-owned physical identity.

### 7.2 From Project

```text
existing FurnitureInstance
→ resolved preview
→ Placement Tool
→ commit preserving the existing furnitureInstanceId
```

### 7.3 Shared interaction

Both paths use the same:

- preview;
- anchors;
- SketchUp inference;
- semantic snap;
- orientation controls;
- exact offset;
- commit/cancel semantics.

Only identity provenance differs.

---

## 8. Project panel behavior

The Project panel remains a navigator/inventory, not a second Inspector.

Example:

```text
PROYECTO
Cocina López · Diseño principal

Pendientes de colocar

B03 · Bajo 2 puertas
800 × 720 × 560
[Colocar]

T01 · Torre horno
600 × 2200 × 600
[Colocar]

Colocados

B01 · Bajo 1 puerta
600 × 720 × 560
✓ Colocado
[Mostrar]

B02 · Cajonero
600 × 720 × 560
✓ Colocado
[Mostrar]
```

### 8.1 Colocar

Starts the shared placement tool with an existing FurnitureInstance.

### 8.2 Mostrar

Selects/focuses the exact managed root in SketchUp.

If identity is missing/duplicated/stale, do not guess by name/position.

### 8.3 Project panel should remain concise

Do not duplicate full:

- material editors;
- parameter forms;
- hardware forms;
- manufacturing detail.

Selecting/focusing the furniture moves the user naturally to the Inspector.

---

## 9. Connected catalog insertion and identity timing

#390 owns creation of a new Project FurnitureInstance from a reusable Library definition.

The UX contract is:

```text
choose FurnitureDefinition
→ preview is transient/nonproductive
→ user clicks to commit placement
→ request/create exactly one Project FurnitureInstance
→ server returns furnitureInstanceId
→ resolve/finalize managed furniture
→ persist working-copy intent + semantic metadata
```

### 9.1 Do not allocate business identity on mere browsing

Opening a card, selecting it, changing preview orientation or moving the cursor must not create Project furniture.

### 9.2 Commit-time identity creation

The physical identity is required before the object becomes a valid productive managed furniture.

Implementation may use a commit-time reservation/create step, but must preserve:

- idempotency;
- retry safety;
- cleanup/orphan policy;
- no fake local ID accepted as authoritative;
- no visible productive object if identity creation fails.

### 9.3 Existing Project furniture

Project-panel placement already has the server identity and must preserve it.

---

## 10. Design defaults and furniture overrides

Designers need to set finishes/hardware once without forcing every cabinet to be edited individually.

This is owned by #784.

### 10.1 Design defaults

Examples:

```text
BODY material
FRONT material
BACK material
hinge system
drawer runner system
handle family/model
other definition-approved defaultable options
```

A definition only inherits defaults for roles/capabilities it explicitly supports.

### 10.2 Explicit inheritance state

For every inheritable property:

```text
source = design | override
effective value = resolved value
```

Never infer inheritance by comparing two values that happen to be equal.

### 10.3 Furniture override

A furniture-level change creates an explicit override:

```text
Frente
Negro Mate
[Personalizado]
```

### 10.4 Restore to Design

The Inspector offers:

```text
[Restaurar valor del diseño]
```

This removes the override and re-resolves the furniture from the current Design default.

### 10.5 New furniture

New compatible furniture starts from Design defaults.

This makes the normal design loop fast:

```text
set Design finishes once
→ place 20 furniture units
→ only edit exceptions
```

---

## 11. Changing defaults versus changing existing furniture

These are intentionally different actions.

Changing a Design default means:

> This is the preferred inherited choice for this Design.

It must **not** silently mutate every existing cabinet.

To roll a new default through the current Design, offer an explicit action:

```text
[Aplicar a muebles existentes…]
```

with review:

```text
Aplicar Roble Natural a FRONT

24 muebles compatibles
21 heredarán/cambiarán
2 tienen personalización
1 no admite este rol

● Conservar personalizados
○ Reemplazar también personalizados

[Cancelar] [Aplicar a 21]
```

#471 owns authoritative batch mutation semantics.

Default behavior should preserve explicit overrides.

---

## 12. Pending changes and atomic Apply

The current UI should evolve away from a permanently dominant "Actualizar Mueble" button.

Preferred behavior:

1. user edits one or more fields;
2. Inspector tracks a local draft;
3. a compact footer appears only when there are pending changes;
4. one Apply sends one coherent semantic mutation;
5. Granete resolves;
6. SketchUp applies one atomic rebuild.

Example:

```text
2 cambios pendientes

[Descartar]      [Aplicar]
```

This reduces unnecessary resolves/rebuilds and makes Undo understandable.

Client-side draft validation may catch obvious range/input errors, but accepted manufacturing intent still comes from Granete.

---

## 13. Library daily-use productivity

The Library must optimize for repeated professional work, not only first-time discovery.

### 13.1 Visual first

Furniture cards should prioritize:

- recognizable preview;
- concise name;
- useful dimensions/preset;
- category.

Technical IDs stay secondary.

### 13.2 Recent items

Expose recently placed/used furniture near the top.

This reduces repeated category navigation during kitchen runs.

### 13.3 Favorites / pinned items

Allow frequent definitions/presets to be pinned when #506 validates the value.

Favorites are user/workshop convenience, not manufacturing authority.

### 13.4 Category chips

For common top-level categories, prefer fast visual/chip navigation:

```text
[Bajos] [Altos] [Torres] [Esquineros] [Accesorios]
```

Deeper hierarchy can remain available without forcing three cascading selectors for every normal insertion.

### 13.5 Repeat placement

After placing an item, a user may continue placing the same definition/preset without reopening the full Library.

Each committed connected placement still gets its own physical FurnitureInstance identity.

---

## 14. Shell simplification target

Current top-level tabs include:

```text
Biblioteca | Proyecto | Inspector | Estado
```

Long-term target should evaluate whether normal daily authoring can become:

```text
Biblioteca | Proyecto | Inspector
```

with connection/session/diagnostics moved behind a compact status affordance.

Example:

```text
Granete                         ● Conectado
```

Clicking status can expose:

- session;
- server;
- license;
- diagnostics;
- connection/rebind tools.

### 14.1 Do not rush this before demo-critical flows

This is a product simplification target, not permission to hide required recovery/status information prematurely.

#506 usability evidence decides whether the reduced shell improves real tasks.

### 14.2 Design lifecycle actions belong with Design context

Actions such as:

- validate Design;
- publish Design;

should be evaluated for placement in Project/Design context instead of a generic "Estado" area once their lifecycle UX is stable.

---

## 15. Fast-path interaction examples

### 15.1 Add a base cabinet

```text
Biblioteca
→ Bajos
→ Bajo 800
→ Colocar
→ preview follows cursor from rear-bottom anchor
→ snap rear to wall + left to previous furniture
→ click
```

### 15.2 Change all future fronts

```text
click empty space
→ Inspector = Design
→ Frentes
→ Roble Natural
→ Apply
```

New compatible furniture inherits Roble Natural.

### 15.3 Make one cabinet black

```text
select cabinet
→ Inspector
→ Frente = Negro Mate
→ Apply
```

It becomes an explicit override.

### 15.4 Change the Design default later

```text
nothing selected
→ Design Inspector
→ Frente = Gris Nube
```

The black cabinet remains black.

To update existing inherited furniture:

```text
Aplicar a muebles existentes…
→ preserve overrides
→ review impact
→ Apply
```

### 15.5 Locate a Project unit

```text
Proyecto
→ B07
→ Mostrar
```

Granete focuses/selects exact FurnitureInstance B07.

---

## 16. Performance expectations

Interactive placement must feel immediate even if final commit requires server work.

### Preview loop

The cursor loop must never perform expensive server round trips on every mouse movement.

Allowed local preview computations:

- cursor hit;
- InputPoint/inference;
- preview transform;
- snap candidate;
- anchor transform;
- temporary orientation.

### Commit

Server/domain work happens on semantic commit as required.

If final identity/resolve takes noticeable time:

- keep the last preview visible in a clear pending state;
- block accidental duplicate commit;
- never pretend success before confirmation.

---

## 17. Undo, failure and recovery

### Placement

```text
preview
→ click
→ create/resolve
→ one host commit
```

Undo removes the placed host object coherently. Business-identity cleanup semantics must follow #390/#384 and cannot be improvised by the HtmlDialog.

### Furniture edits

One explicit Apply = one coherent mutation/undo where possible.

### Batch edits

One batch command must have explicit all-or-nothing or reviewed partial-success semantics. UI cannot claim full success when only a subset succeeded.

### Failure

Previous valid managed geometry remains intact when an update is rejected.

---

## 18. Product anti-patterns

The following are explicitly undesirable:

### 18.1 Origin-first insertion as normal UX

```text
insert at 0,0,0
→ activate generic Move
→ manually navigate across model
```

May exist as fallback/debug behavior, not primary product flow.

### 18.2 Extra permanent screens for every concern

Do not add:

- one screen for materials;
- one for hardware;
- one for parameters;
- one for Project defaults;

when contextual Inspector scope can express the same interaction more naturally.

### 18.3 Silent global mutation

Changing a default must not rewrite existing furniture without explicit scope confirmation.

### 18.4 Client-owned manufacturing compatibility

Snap, preview, material selection and hardware selection capture intent. They do not recreate BOM/machining compatibility rules in Ruby/HTML.

### 18.5 System terminology as designer workflow

Normal UX should not force users to reason about:

- DesignRevision IDs;
- ProjectFurniture internal DTOs;
- persistent IDs;
- fingerprints;
- sync generations;
- host locators.

Show them only in diagnostics/advanced detail when needed.

---

## 19. Accessibility and keyboard behavior

Primary workflows should remain usable without precision mouse-only interactions where technically possible.

Required design considerations:

- visible keyboard focus;
- Enter to confirm appropriate focused actions;
- Esc cancels preview/draft/modal;
- numeric mm input accessible from keyboard;
- rotate/anchor shortcuts documented and discoverable;
- no status conveyed only by color;
- Spanish labels resilient to narrow HtmlDialog width.

Exact placement shortcuts are validated under #469/#506.

---

## 20. Ownership map

| Capability | Primary issue |
|---|---:|
| Shared semantic SelectionContext | #476 ✅ |
| Atomic host mutation runtime | #498 ✅ |
| Furniture placement preview/anchors/snaps/repeat | #469 |
| Connected Library insertion identity | #390 |
| Existing Project Furniture placement | #389 ✅ + #469 UX |
| Design defaults + inheritance/overrides | #784 |
| Batch apply / multi-selection | #471 |
| Hardware semantic authoring | #468 ✅ |
| Manufacturing inspection overlay | #470 |
| Library discovery/recents/favorites/usability evidence | #506 |
| Program coordination | #465 |

---

## 21. Required representative demo

Before considering the designer workflow commercially ready, demonstrate on real SketchUp:

```text
open connected Design
→ no selection shows Design Inspector
→ choose BODY/FRONT defaults
→ find a base cabinet in Library
→ Colocar
→ preview follows cursor from visible semantic anchor
→ snap to wall/floor and furniture side
→ rotate before commit
→ click to place
→ new furniture inherits Design defaults
→ select furniture
→ create one FRONT override
→ reset override to Design
→ place an existing pending Project furniture through the same placement tool
→ repeat-place another Library cabinet
→ select three cabinets
→ batch change one supported role with mixed-state review
→ change Design default
→ explicitly apply to existing while preserving overrides
→ locate a placed unit from Project panel
→ Undo/Redo
→ save/reopen
→ identity, defaults and overrides remain coherent
```

Record time/friction/errors under #506 after the workflow is implemented.

---

## 22. Final product rule

A designer should experience Granete as:

```text
choose
→ place
→ select
→ change
→ continue
```

not:

```text
create
→ sync
→ navigate status
→ move from origin
→ open configuration screen
→ reconcile local form
→ manually rebuild
→ continue
```

The implementation may remain industrially rigorous underneath. The visible authoring loop must remain direct, predictable and fast.
