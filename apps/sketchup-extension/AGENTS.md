# AGENTS.md — Granete for SketchUp

This file is the scoped entry point for any agent modifying `apps/sketchup-extension/`.

## Mandatory reading

Before implementation, read:

1. `../../docs/architecture/sketchup-plugin-excellence.md`;
2. `../../docs/architecture/sketchup-authoring-interaction-contract.md`;
3. `../../docs/sketchup-excellence-execution-plan.md`;
4. `../../docs/architecture/sketchup-interaction-model.md`;
5. `../../docs/architecture/sketchup-native-entity-model.md` + ADR-0004;
6. `../../docs/sketchup-manufacturing-contract.md` + ADR-0001;
7. the exact GitHub issue and all hard prerequisites.

If the change touches Project/Design identity, revisions, copy/adoption or publish, also read #384 + ADR-0003.

If it touches auth/session/media, also read #460.

If it touches materials/thickness, read `material-aware-furniture-resolution.md`.

If it touches relationships/hardware/machining, read #356/#350 and `manufacturing-feature-model.md`.

## Non-negotiable boundary

> **SketchUp owns authoring/interaction; Granete owns manufacturing truth.**

Ruby/HtmlDialog must not become a second industrial engine.

Never calculate or own in the plugin:

- BOM;
- productive board thickness;
- joint resolution;
- derived drilling/machining;
- nesting/kerf;
- machine postprocessing;
- ProductionRelease/readiness.

The plugin may present authoritative results and calculate transient interaction preview only.

## Identity rules

Never infer business/authoring identity from:

- SketchUp name;
- GUID;
- `persistent_id`;
- entity id;
- dimensions;
- transform;
- geometry similarity.

Keep separate:

```text
furnitureInstanceId
furnitureDefinitionId
componentInstanceId
componentDefinitionId
catalogComponentId
hardwarePlacementId
SketchUp host locators
```

`componentInstanceId` is the concrete occurrence. Hardware hosts/relationship anchors target occurrences, not only reusable definitions.

## Host mutation rule

For any productive managed edit:

```text
capture intent
→ authoritative resolve/accept
→ validate contract
→ start one SketchUp operation
→ rebuild/rebind managed hierarchy
→ write accepted metadata
→ commit
```

On failure, abort and preserve the previous valid hierarchy/metadata.

Do not clear current geometry before remote/domain resolution succeeds.

## Native representation

Managed furniture and productive physical parts use native `Sketchup::ComponentInstance`.

- local part geometry at definition origin;
- authoritative local→furniture transform from Granete;
- no world-AABB baking;
- no non-uniform scale for productive dimensions;
- top-level definition isolated per FurnitureInstance in V1;
- shared part definitions only if immutable/content-addressed;
- never mutate a shared definition in-place.

## Authoring UX completion rule

A host UX issue is not done because a TS helper or Ruby method exists.

If the issue promises a user interaction, DoD normally requires:

- UI/HtmlDialog interaction;
- Ruby host adapter/tool behavior;
- authoritative domain/API integration as needed;
- rollback/undo;
- negative proof;
- real-host TestUp when SketchUp behavior matters.

This is especially important for #467 and #468, which complete host UX beyond historical #349/#350 domain baselines.

## Interactive validation vs preflight

Local UI may validate form constraints supplied by definitions.

Local UI must never infer manufacturing readiness.

Only Granete authoritative preflight may produce manufacturing `ready/warning/blocked/stale` semantics. #466 owns the review/navigation UX.

## Manufacturing visualization

Resolved ManufacturingFeatures may be visualized read-only (#470).

Never scan overlay geometry back into manufacturing data. Derived operations are not directly editable holes.

## Offline/fallback

Follow #474.

A generic/static/local fallback may be test/dev or explicit preview, but cannot masquerade as resolved productive furniture.

Network/auth/license/unavailable/stale states are distinct. Never report failure as ready/success.

## Project/Digital Thread

Do not invent a SketchUp-only Project/Design business store.

#384 owns server Project FurnitureInstance identity, DesignRevision, reconciliation, publication and release.

Before Foundation Gate A #462, do not create a new persistent business family to “unblock” the plugin.

## Copy/delete/migration

- `make_unique` isolates SketchUp definitions; it does not allocate business identity.
- top-level copy business identity is #391.
- legacy Group → native representation is #416.
- adopting arbitrary/existing SKP into Project/Design is #397.
- connected delete semantics follow #384 business lifecycle; host `erase_entities` alone is not the final business command.

## Security

No new credential shortcuts.

- SketchUp gets its own least-privilege session/client model via #460;
- no generic bearer session token in media URLs/query strings;
- never log secrets/passwords/tokens/private model data;
- support diagnostics privacy-by-default.

## Performance/support claims

- measure before optimizing (#472);
- never share mutable definitions across independent furniture for speed;
- no OS/SketchUp support claim without real-host evidence (#473);
- record RBZ SHA/version with host evidence.

## Required plan before coding

In the issue/PR plan answer:

1. exact semantic entity being edited;
2. stable ID used;
3. authoring intent vs resolved manufacturing vs view-only state;
4. authority that validates/resolves consequences;
5. existing domain/API code reused;
6. failure/rollback behavior;
7. SketchUp undo unit;
8. positive tests;
9. negative proof;
10. real-host evidence required or not;
11. Gate A/#384 dependency or not.

If one is unknown, update the canonical docs/issue before guessing.

## Verification

Minimum applicable gates:

```bash
bundle exec rake verify
pnpm test
pnpm typecheck
# go test ./... when backend/domain integration changes
# TestUp real-host smoke when host semantics are part of DoD
```

Never replace unavailable real-host evidence with a simulated pass.