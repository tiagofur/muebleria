# AGENTS.md — Granete for SketchUp

This file is the scoped entry point for any agent modifying `apps/sketchup-extension/`.

## Mandatory reading

Before implementation, read:

1. `../../docs/architecture/sketchup-plugin-excellence.md`;
2. `../../docs/architecture/sketchup-backend-web-integration-excellence.md`;
3. `../../docs/architecture/sketchup-authoring-interaction-contract.md`;
4. `../../docs/sketchup-excellence-execution-plan.md`;
5. `../../docs/architecture/sketchup-interaction-model.md`;
6. `../../docs/architecture/sketchup-native-entity-model.md` + ADR-0004;
7. `../../docs/sketchup-manufacturing-contract.md` + ADR-0001;
8. the exact GitHub issue and all hard prerequisites/comments.

Additional routing:

- generated furniture/API/schema work: #496 + #448/#477;
- shared HtmlDialog/host mutation/degraded-state work: #498 + #474;
- typed parameter/catalog administration integration: #497 + #483/#486;
- Project/Design identity, revisions, copy/adoption or publish: #384 + ADR-0003;
- secure Web-to-SketchUp handoff/model binding: #388 + #499;
- React Project/Design workspace: #396 and its children #500–#502;
- auth/session/media/client credentials: #460;
- audit/request/trace/support diagnostics: #461 + #504;
- materials/thickness: `material-aware-furniture-resolution.md` and #402–#405;
- relationships/hardware/machining: #356/#350 and `manufacturing-feature-model.md`;
- machine output/evidence: #348/#351–#355 and #503.

## Non-negotiable ownership boundary

> **SketchUp owns authoring/host interaction. Granete owns business identity and manufacturing truth. React owns administration/visibility/business workflow UX.**

Ruby/HtmlDialog must not become a second industrial engine. React must not become a second manufacturing/reconciliation engine.

Never calculate or own in the plugin:

- BOM;
- productive board thickness;
- joint resolution;
- derived drilling/machining;
- nesting/kerf;
- reconciliation/approval;
- ProductionRelease/readiness;
- MachineProfile/postprocessor output.

The plugin may present authoritative results and calculate transient host-interaction preview only.

## Generated contract rule

For furniture/catalog/authoring/preflight/Design APIs, consume #496's generated/validated authority.

Do not add:

- handwritten parallel HTTP DTOs;
- ad-hoc query parameters for authoring intent;
- message-substring behavior;
- Ruby/JavaScript acceptance of schema versions rejected by Go/TypeScript;
- host mutation before capability/schema compatibility is established.

The generic API error envelope and structured authoring/preflight issues keep their reviewed responsibilities; preserve stable codes, correlation and semantic remediation.

## Identity rules

Never infer business/authoring identity from:

- SketchUp name;
- GUID;
- `persistent_id`;
- entity ID;
- filename/path;
- dimensions;
- transform;
- geometry similarity;
- array/index order.

Keep separate:

```text
organizationId
projectId
designId
designRevisionId
quoteRevisionId
productionReleaseId

furnitureInstanceId
furnitureDefinitionId
componentInstanceId
componentDefinitionId
catalogComponentId
hardwarePlacementId
hardwareDefinitionId
relationshipId
jointPlacementId

SketchUp host locators
```

`componentInstanceId` is the concrete occurrence. Hardware hosts/relationship anchors target occurrences, not only reusable definitions.

`furnitureInstanceId` is Project-owned business identity in connected mode. A local compatibility `instanceRef` is never silently promoted to server identity.

## Shared host mutation rule

#498 owns the reusable host interaction/runtime mechanics for #466–#471.

Every productive managed edit follows one shared sequence:

```text
capture exact SelectionContext and accepted snapshot
→ allocate correlation/message identity
→ submit authoritative resolve through #477/#496
→ reject malformed/stale/superseded result
→ validate complete accepted contract
→ prepare assets/definitions
→ start one SketchUp operation
→ rebuild/rebind managed hierarchy
→ write accepted metadata
→ restore semantic selection/context
→ invalidate/refresh preflight/overlays
→ commit
```

On failure, abort or never start the operation and preserve the previous valid hierarchy/metadata.

Do not:

- clear current geometry before resolution succeeds;
- build shelf-specific and hardware-specific mutation coordinators;
- apply a late response to a newer selection/command;
- report network/auth/license/schema failure as ready/success.

## HtmlDialog architecture

New professional surfaces must consume modular bridge/state/view/controller boundaries from #498.

Do not continue growing one opaque global dialog script with duplicated callbacks and state. A framework rewrite is not required; modular vanilla JavaScript is acceptable.

Callbacks must register once, close/reopen safely and be testable through the Node harness where host-independent.

## Native representation

Managed furniture and productive physical parts use native `Sketchup::ComponentInstance`.

- local part geometry at definition origin;
- authoritative local→furniture transform from Granete;
- no world-AABB baking;
- no non-uniform scale for productive dimensions;
- top-level definition isolated per FurnitureInstance in V1;
- shared part definitions only if immutable/content-addressed;
- never mutate a shared definition in place.

## Authoring UX completion rule

A host UX issue is not done because a TypeScript helper, Go resolver or Ruby method exists.

If the issue promises a user interaction, DoD normally requires:

- HtmlDialog/viewport interaction;
- Ruby host adapter/tool behavior;
- generated contract/domain/API integration;
- rollback/undo;
- negative proof;
- real-host TestUp where SketchUp behavior matters.

This is especially important for #466/#467/#468. Historical #349/#350 domain closure is not proof of their professional host UX.

## Interactive validation vs preflight

Local UI may validate parseability and constraints supplied by definitions.

Local UI must never infer manufacturing readiness.

Only Granete authoritative preflight may produce manufacturing `ready|warning|blocked|stale|unavailable`. #466 owns review/navigation.

## Manufacturing visualization

Resolved ManufacturingFeatures may be visualized read-only (#470).

Never scan overlay geometry back into manufacturing data. Derived operations are not directly editable holes. Accepted-state changes must refresh or mark overlays stale through #498.

## Offline/fallback

#498 owns the minimum shared fail-closed state/mutation guards. #474 owns complete cache/reconnect/pending-intent policy.

A generic/static/local fallback may be test/dev or explicit preview, but cannot masquerade as resolved productive furniture.

Keep distinct:

```text
resolved_current
resolved_stale
unresolved_preview
offline_cached
sync_required
blocked_incompatible
```

No local offline Project IDs or false manufacturing ready state.

## Project/Digital Thread

Do not invent a SketchUp-only Project/Design business store.

#384 owns server Project FurnitureInstance identity, DesignRevision, reconciliation, publication and release.

Before Foundation Gate A #462, do not create a new persistent business family to “unblock” the plugin.

Correct ownership:

- #388 model binding;
- #499 secure Web↔SketchUp pairing;
- #389 place existing Project Furniture;
- #390 connected catalog insertion;
- #391 copy/duplicate business identity;
- #392 publication/artifacts;
- #393 reconciliation;
- #397 existing SKP adoption.

## Copy/delete/migration

- `make_unique` isolates SketchUp definitions; it does not allocate business identity.
- top-level copy business identity is #391.
- legacy Group → native representation is #416.
- arbitrary/existing SKP business adoption is #397.
- connected delete follows #384 business lifecycle; host `erase_entities` alone is not the final command.

## Security and pairing

No new credential shortcuts.

- SketchUp gets its own least-privilege revocable client/session via #460;
- Web and SketchUp share contracts, never credentials;
- no generic bearer session token in media/artifact/deep-link query strings;
- #499 pairing uses one-time, short-lived, exact-scope grants;
- invoking a deep link alone is not confirmed success;
- failed pairing/rebind preserves existing binding;
- never log secrets/passwords/tokens/pairing codes/private model data.

## Diagnostics and privacy

#504 owns the commercial support bundle.

Diagnostics are allowlist-based, previewable and explicit-consent. They exclude credentials, cookies, pairing grants, signed URLs, personal/customer data, private paths, geometry, BOM and machining payloads.

Automatic support upload is prohibited.

## Performance/support claims

- measure before optimizing (#472);
- never share mutable definitions across independent furniture for speed;
- no OS/SketchUp support claim without real-host evidence (#473);
- record RBZ SHA/version with host evidence;
- a support bundle is not compatibility evidence;
- machine compatibility requires exact software/version/import/readback evidence (#348/#351–#354).

## Required plan before coding

In the issue/PR plan answer:

1. exact semantic/business entity being edited;
2. stable ID used;
3. authoring intent vs resolved manufacturing vs view-only state;
4. authority that validates/resolves consequences;
5. generated contract/domain/API code reused;
6. session/capability/Gate A dependency;
7. concurrency/idempotency/correlation behavior;
8. network/domain/host failure and rollback;
9. SketchUp undo unit;
10. positive tests;
11. forbidden-shortcut negative proof;
12. real-host/browser/PostgreSQL/machine evidence required;
13. privacy/observability impact;
14. React/backend integration required by the issue.

If one is unknown, update canonical docs/issue before guessing.

## Cross-surface PR checklist

Declare applicable layers:

```text
[ ] domain
[ ] Go backend/API/storage/RLS
[ ] generated OpenAPI/JSON Schema
[ ] React UI/server state
[ ] Ruby host/adapter
[ ] HtmlDialog/interaction
[ ] shared fixture/parity
[ ] real-host TestUp
[ ] browser + real PostgreSQL E2E
[ ] real machine/software readback
[ ] docs/ledger/readback
```

A cross-surface issue cannot close because only one box is implemented.

## Verification

Minimum applicable gates:

```bash
bundle exec rake verify
pnpm openapi:check
pnpm test
pnpm typecheck
go test ./...                 # when backend/domain integration changes
scripts/pilot-gate.sh         # when owning gate/feature requires it
# TestUp real-host smoke when host semantics are part of DoD
# browser E2E with real Go/PostgreSQL for Project/Web gates
```

Never replace unavailable real-host/browser/database/machine evidence with a simulated green pass.