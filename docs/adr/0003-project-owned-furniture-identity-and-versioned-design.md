# ADR-0003 — Project-Owned Furniture Identity and Versioned Design

- **Status:** Accepted
- **Date:** 2026-08-26
- **Decision owners:** Granete architecture
- **Related:** ADR-0001, ADR-0002, `docs/architecture/project-design-digital-thread.md`

## Context

Granete supports quoting before a 3D model exists, design-first workflows, Proyectar 3D, Granete for SketchUp and an authoritative manufacturing pipeline. The system therefore needs a stable identity that survives commercial revisions, design revisions, authoring-client changes and production releases.

A quote line cannot safely own that identity because one commercial line may represent multiple physical units. A SketchUp entity cannot own it because SketchUp is an authoring client and its technical IDs are model-local. A `.skp` file cannot own it because a Project can have multiple designs, revisions, alternatives or no 3D design at all.

The repository already defines `FurnitureInstance` as a concrete project-level furniture entity. We will make that concept the cross-context business identity instead of adding a parallel entity.

## Decision

### 1. Project owns physical furniture identity

Each physical furniture unit is represented by a stable `FurnitureInstance` scoped to a `Project`.

```text
Project
 └── FurnitureInstance
```

The same `FurnitureInstance.id` is referenced by commercial, design and manufacturing representations.

### 2. QuoteRevision owns commercial truth

`QuoteRevision` describes the commercial state of the Project. `QuoteLine.quantity` is a commercial grouping and may map to multiple `FurnitureInstance`s.

Accepted quote revisions are immutable. Later commercial changes create a new quote revision or, in a future workflow, a `ChangeOrder`.

### 3. Design and DesignRevision model spatial/design truth

`Design` is a client-agnostic project design aggregate. It is not named after SketchUp.

`DesignRevision` is an immutable published snapshot. Editing occurs in a working copy based on an explicit `baseRevisionId`; publishing creates a new revision.

### 4. Authoring clients do not own business identity

SketchUp and Proyectar 3D store/transport `furnitureInstanceId` but do not define it.

SketchUp `persistent_id` is a technical locator only. It may be stored in revision metadata but can change without changing the business identity.

### 5. Manufacturing remains authoritative in Granete

Authoring clients publish semantic intent/manifest data. Granete resolves and validates manufacturing output, BOM, hardware, machining, preflight and release.

### 6. ProductionRelease references exact revisions

Production never consumes “latest”. A `ProductionRelease` pins an exact `DesignRevision` and manufacturing fingerprint/revision. Newer design revisions do not alter an existing release.

### 7. Reconciliation is explicit and non-destructive

Quote/design differences are detected and classified by a reconciliation process. Reconciliation never silently mutates an accepted `QuoteRevision` or a published `DesignRevision`.

## Consequences

### Positive

- Quote-first and design-first workflows share one model.
- Quantity > 1 can be traced as distinct physical units.
- Copying a cabinet can create a new identity instead of conflicting IDs.
- SketchUp files can contain decoration/architecture without contaminating production.
- Production remains reproducible against an exact approved revision.
- Proyectar 3D and future authoring clients can reuse the same Project/Design model.
- Design history and commercial history can evolve independently while remaining reconciliable.

### Costs

- Requires explicit relation between QuoteLine and FurnitureInstance.
- Requires new Design/DesignRevision persistence and artifact storage.
- Requires reconciliation and concurrency handling.
- Requires duplicate-identity detection in SketchUp.
- Requires migration/alignment of existing `instanceRef` semantics where necessary.

## Alternatives rejected

### QuoteLine as furniture identity

Rejected because one line can have `quantity > 1`, while individual units may have distinct position/configuration/manufacturing history.

### SketchUp entity or persistent_id as furniture identity

Rejected because it couples business identity to one authoring client and one model file.

### `.skp` file as Project/Design identity

Rejected because a Project may have zero, one or many designs/revisions and may use other authoring clients.

### Separate `ProjectFurniture` entity

Rejected because it duplicates the existing semantic responsibility of `FurnitureInstance`.

### Bidirectional automatic quote/design synchronization

Rejected because it can silently rewrite accepted commercial history or approved design history. We use explicit reconciliation and user-authorized revision creation instead.

### Production from `latest design`

Rejected because it is non-reproducible and can change underneath an active production release.

## Non-decisions / implementation freedom

The following mechanisms can evolve without changing this ADR, provided the invariants above remain true:

- multipart upload vs signed object-storage upload;
- exact SQL table names;
- exact HTTP route spelling;
- preview generation mechanism;
- whether quantity materialization occurs at Project creation, design creation or another earlier safe boundary;
- concrete hash algorithm for semantic/commercial/spatial fingerprints.

These are implementation choices, not authority/identity choices.

## Required follow-up

See `docs/architecture/project-design-digital-thread.md` for the normative entity contracts, flows, anti-patterns, test matrix and implementation dependency graph.
