# Granete for SketchUp — Authoring Interaction Contract

Status: **Canonical implementation contract**  
Program: #465  
Architecture north star: `sketchup-plugin-excellence.md`

## 1. Why this document exists

This contract prevents a common failure mode in agent-driven implementation: translating a UX sentence such as “move the shelf” into direct SketchUp geometry mutation or a new ad-hoc API that bypasses the domain.

Every interaction must answer four questions explicitly:

1. **What did the user intend?**
2. **Which stable semantic identity is the target?**
3. **Which layer is allowed to resolve consequences?**
4. **What evidence proves the host behavior is safe?**

## 2. Interaction state machine

For productive managed furniture, use this conceptual sequence:

```text
idle
→ selecting
→ editing_intent
→ resolving
→ previewing_accepted_result (optional)
→ applying_host_mutation
→ committed
```

Failure branches:

```text
resolving → rejected
applying_host_mutation → aborted
```

A rejection before host mutation preserves the previous valid hierarchy.

Do not silently convert `rejected` into local fallback success.

## 3. Semantic selection context

A selection payload should identify the highest-confidence managed context available.

Conceptual shape:

```text
SelectionContext
  kind = furniture | aggregate | part | hardware | unmanaged
  furnitureInstanceId?
  furnitureInstanceRef?        # compatibility only
  furnitureDefinitionId?
  componentInstanceId?
  componentDefinitionId?
  hardwarePlacementId?
  hardwareDefinitionId?
  hostComponentInstanceId?
  projectId?
  designId?
  baseRevisionId?
  hostLocator?                 # technical only
```

### Rules

- IDs come from namespaced Granete metadata/server binding.
- `hostLocator` may include SketchUp `persistent_id`/InstancePath evidence but is not authority.
- selection may recover owning furniture from a nested child.
- rename cannot change semantic identity.
- if a managed child is regenerated, new host locators may be associated with the same semantic occurrence identity when contract semantics preserve it.

## 4. Capability-driven inspector

The inspector must be driven by semantic context + definition/capability, not by a hardcoded furniture type switch.

Examples:

### Furniture

```text
canEditParameters
canEditMaterialRoles
canEditHighLevelHardware
canDuplicate
canDelete
canReviewPreflight
canInspectManufacturing
```

### Part

```text
canMoveWithinConstraint
canDuplicate
canRemove
canChangeJoinery
canInspectManufacturing
```

### Hardware placement

```text
isManual
isDerived
canMove
canRotate
canChangeHandedness
canReplaceDefinition
canInspectMachining
```

An unsupported action is absent/disabled with explanation; it is not guessed from role names.

## 5. Local interactive validation vs authoritative validation

### Local validation may check

- field parseability;
- numeric min/max/step supplied by the definition;
- required selection present;
- obvious unsupported action capability;
- temporary placement preview constraints.

### Local validation must not decide

- manufacturability;
- board thickness consequence;
- BOM validity;
- joint validity;
- drilling collisions;
- machine compatibility;
- release readiness;
- stale fingerprint/revision validity.

These belong to Granete authoritative resolve/preflight.

The authoritative submission boundary for every authoring intent — parameter
updates, move/add/remove occurrences, joinery intent, manual hardware edits
and hardware substitution — is the versioned resolve contract
`granete.sketchup-authoring-resolve.v1` (#477, see
`docs/sketchup-manufacturing-contract.md` §16b): one POST endpoint carrying
the complete authoring snapshot and returning the accepted/resolved result.
No feature may express these intents as query parameters or a parallel
payload shape.

## 6. Furniture parameter/material update

Current update contract remains valid conceptually:

```text
user changes parameter/material intent
→ collect complete accepted intent for the furniture
→ authoritative full layout resolve (#477 resolve contract)
→ validate NativeLayout contract
→ atomic native rebuild
→ write metadata
```

Important:

- omitted material roles must not silently revert when existing persisted intent exists;
- changing one role may affect many physical parts;
- selected material thickness is resolved before dependent geometry;
- all dependent hardware anchors move according to returned result.

## 7. Move internal component

Owned by #467.

### User intent

“Move this shelf to another allowed position.”

### Client responsibilities

- resolve exact `componentInstanceId`;
- read allowed authoring capability/constraint;
- provide precise mm entry and/or constrained viewport preview;
- submit semantic move intent;
- display resolving/rejected state;
- apply accepted resolved result atomically.

### Granete responsibilities

- validate target occurrence and definition/version;
- validate allowed move/anchor semantics;
- update relationship intent;
- resolve dependent component pose;
- resolve dependent machining/provenance;
- return accepted resolved layout/preflight consequence.

### Forbidden

- moving raw faces and treating them as final productive truth;
- updating drilling points directly;
- editing another shelf because both share `componentDefinitionId`.

## 8. Add internal component

Owned by #467.

### User intent

“Add another shelf/divider supported by this FurnitureDefinition.”

### Required semantic result

A new concrete component occurrence with distinct occurrence identity and new dependent relationships.

The implementation must preserve:

```text
same reusable componentDefinitionId allowed
new componentInstanceId required
new relationship/joint occurrence identity required where applicable
```

Do not derive identity from array position if reorder can change it.

## 9. Duplicate internal component

Duplicate is not “copy metadata bytes”.

It means:

```text
source occurrence
→ create new authoring occurrence intent
→ preserve definition/config defaults as appropriate
→ allocate distinct occurrence IDs
→ create distinct relationships
→ authoritative resolve
```

No duplicate may share occurrence identity with its source.

## 10. Remove internal component

Removal must remove/invalidate only dependent relationships and derived machining owned by that occurrence.

The accepted resolved result is authoritative.

Do not delete unrelated machining because coordinates overlap or look similar.

## 11. HardwarePlacement edit

Owned by #468.

### Manual placement

Can expose supported fields such as:

```text
host face
offsetU / offsetV
rotation
handedness
hardwareDefinitionId
```

Exact field model follows the domain contract.

### Derived placement

Must show provenance and source context but is not freely editable as a manual placement.

Correction must go through its source relationship/joint/authoring rule.

## 12. Hardware replacement

“Replace hinge” is a semantic substitution, not an asset swap.

Sequence:

```text
select manual/replaceable hardware placement
→ query compatible HardwareDefinitions
→ user selects option
→ submit replacement intent
→ Granete validates compatibility
→ resolve visual asset + BOM + machining
→ preflight
→ atomic rebuild
```

The client must not decide compatibility from asset dimensions or brand names.

## 13. Furniture placement tool

Owned by #469.

### Preview

Preview may use temporary entities/drawing overlays/tool state but must not commit managed metadata/business identity before final acceptance.

### Snap candidates

Can use:

- SketchUp inference point/face;
- wall/floor reference;
- neighboring managed furniture extents/semantic placement anchors;
- user-entered gap/offset.

### Commit

Commit only top-level spatial authoring transform. Child productive geometry remains local and unchanged unless the domain explicitly resolves a manufacturing-dependent spatial rule.

## 14. Preflight review/navigation

Owned by #466.

Canonical issue state:

```text
PreflightIssue
  code
  severity
  message
  remediation
  entityId / semantic target
  path?
  revision/fingerprint context?
```

### Navigation target precedence

1. exact managed child/hardware occurrence by semantic ID;
2. current owning furniture + semantic subcontext;
3. owning furniture;
4. unresolved issue displayed without false navigation.

Never match by localized display name.

### Highlighting

Highlight/select/frame is view state only. It cannot mutate product geometry or metadata.

## 15. ManufacturingFeature overlay

Owned by #470.

Read-only overlay data comes from authoritative resolved features.

Overlay selection can show:

```text
type
target face
diameter/depth/path
sourceKind
source IDs
host component occurrence
machine capability warning
```

Overlay must be excluded from managed productive semantic scanning.

Recommended host strategies include SketchUp drawing API/tool overlays or explicitly namespaced ephemeral helpers that are never interpreted as furniture parts.

## 16. Multi-selection/batch interaction

Owned by #471.

Batch context is a set of semantic furniture identities, not `selection.first`.

For each field:

```text
all equal → show value
mixed → show mixed
not supported by all → show incompatibility/partial applicability explicitly
```

No implicit first-value fill.

Batch apply must have an explicit atomicity contract.

Before #384 durable project defaults exist, scopes such as “project default” may be UI-disabled or clearly session-only; they must not be represented as persisted project truth.

## 17. Delete furniture

Delete semantics differ by mode.

### Unconnected/local compatibility mode

Deletion may remove managed host entity/metadata as currently supported, preserving undo.

### Connected Project mode

Once #384 is active, deleting geometry from the current design is not automatically the same as deleting/cancelling the Project `FurnitureInstance` business object.

The command must follow the Digital Thread contract:

- remove from working design;
- retain/cancel physical identity according to project/commercial lifecycle;
- reconciliation exposes consequences.

No host delete callback may invent business lifecycle.

## 18. Copy/paste of top-level furniture

Owned by #391 in Digital Thread.

Native SketchUp copying can temporarily duplicate metadata/definition linkage. The client must detect duplicate business identity and resolve it according to #391.

Host `make_unique` can isolate definition mutation, but it does not allocate a business identity.

## 19. Legacy migration

Owned by #416.

Migration is representation transformation, not business-object creation.

```text
legacy Group with known identity
→ authoritative re-resolve
→ build native hierarchy
→ validate replacement
→ replace in one operation
→ preserve known identity
```

Missing Project identity remains unresolved for #397; migration must not invent it.

## 20. Degraded state contract

Owned by #474.

Every operation must distinguish at least:

```text
current authoritative
stale authoritative
unresolved/preview
offline cached
unauthenticated
license blocked
incompatible
network/server unavailable
```

Never collapse these into generic empty or success.

### Generic fallback

Generic locally-authored boxes may remain useful for test/dev or explicit preview. In production connected workflows they must be marked non-productive and cannot satisfy preflight/publish/release.

## 21. Undo and rollback

Every host mutation issue must document:

- operation name shown to SketchUp user;
- what entities/definitions/metadata are created/removed;
- rollback path on Ruby exception;
- rollback path on remote/domain rejection before operation;
- expected undo/redo behavior in real host.

A Minitest stub journal is useful, but real-host TestUp is required where SketchUp operation behavior is part of the acceptance criteria.

## 22. Error UX

Errors must be classified, not flattened into “algo salió mal”.

Useful user-facing categories:

- authentication/session;
- license/capability;
- network/server unavailable;
- stale/conflict;
- invalid authoring input;
- unresolved catalog reference;
- manufacturing blocker;
- host/model corruption/legacy migration needed;
- incompatible plugin/API version.

Each blocker should explain the next action when known.

## 23. No-hallucination implementation checklist

Before writing code, an agent must answer in its plan/PR:

1. Which canonical entity is being edited?
2. What exact stable ID targets it?
3. Is the edit authoring intent, resolved manufacturing data or view-only state?
4. Which layer validates/resolves consequences?
5. What existing issue/domain helper is consumed instead of recreated?
6. What happens on network/domain rejection?
7. What happens on SketchUp exception during apply?
8. What is the undo unit?
9. What positive test proves the intended behavior?
10. What negative proof catches the forbidden shortcut?
11. Is real-host evidence required?
12. Does this need Gate A / Digital Thread persistence?

If any answer is unclear, update the canonical contract/issue before implementation rather than guessing.

## 24. Definition of Done for a host UX issue

A host UX issue is not done because:

- a TypeScript interface exists;
- a pure function exists;
- HtmlDialog has a button;
- Ruby unit tests pass.

It is done only when all layers required by its own acceptance criteria are demonstrated, normally including:

```text
domain/API contract as needed
+ Ruby adapter/host mechanics
+ UI interaction
+ rollback/undo proof
+ negative proof
+ real-host evidence when host behavior matters
+ docs/readback
```