# Product

> Impeccable product context for UI work. Current product source of truth is
> `docs/prd-v2.md`. Historical MVP detail remains in `docs/history/prd.md`.

## Register

product

## Positioning

Muebles is **not** positioned as a cheap Promob alternative.

> It is the ideal operating platform for a segment of small/medium woodworking and
> furniture businesses that needs excellent modular 3D design plus a complete operating
> flow, but does not need the full breadth of a heavyweight historical CAD/CAM suite.

Lower price may be commercially attractive, but it is not the primary moat. We compete
on product quality, ease of use, speed, trustworthy domain behavior, integrated
design→BOM→production flow and operational continuity through installation/costing.

See `docs/proyectar-3d-competitive-position.md` and
`docs/sketchup-muebles-strategy.md`.

## Product Purpose

Muebles is a **vertical operating platform for small and medium woodworking/furniture
businesses** connecting:

```text
Sales → Survey/Design → Engineering/Release → Materials → Production
→ Shipping → Installation → Closeout/Warranty → Job Profitability
```

### Authoring paths, one manufacturing truth

Muebles supports two complementary 3D authoring paths:

- **Proyectar 3D** — native quick-design for modular work and quoting.
- **Muebles for SketchUp** — professional authoring for designers already using SketchUp.

Both produce authoring intent for the same `Project/Job`:

> **SketchUp owns authoring/interaction; Muebles owns manufacturing truth.**

Muebles alone resolves and validates catalogs, parametric part relationships/joints,
BOM, parts, materials, hardware, drilling, revisions, preflight, release and machine
outputs. Derived drilling is an output of semantic relationships and placements, never an
independent authoring truth.

Canonical references:

1. `docs/sketchup-muebles-strategy.md`;
2. `docs/adr/0001-sketchup-authoring-muebles-manufacturing-truth.md`;
3. `docs/sketchup-manufacturing-contract.md`;
4. GitHub #356 — parametric part relationships and joint-driven machining.

### Physical production invariant

**Cutting, CNC and edge banding operate on individual pieces. Assembly is the handoff
where finished pieces become complete furniture units. From Assembly onward the main
tracking unit is furniture/unit/package.**

See `docs/production-flow-v2.md`.

## Success looks like

1. A typical quote can be created quickly with trustworthy pricing.
2. The exact approved/released revision sent to production is identifiable.
3. BOM drives real material requirements.
4. Cutting/CNC/edge queues represent actual pieces; assembly+ actual units.
5. Moving/adding/removing a related shelf recalculates only machining dependent on its
   relationships/joints.
6. Moving a hinge recalculates its dependent machining without altering unrelated shelf
   machining.
7. Changes that affect manufacturing truth invalidate the previous fingerprint/release.
8. Installation and job costing remain connected to the same project truth.

## Design Principles

1. **Task first.** Chrome never competes with work.
2. **Prevent expensive errors.** Wrong revision/material/measurement is blocked or explicitly overridden with audit.
3. **Correct unit of work.** Piece vs unit vs package vs visit matches the physical process.
4. **Domain stays out of UI.** React/SketchUp present and capture intent; domain/backend calculate/enforce.
5. **Data truth.** Actual / estimated / forecast / proxy remain visibly distinct.
6. **Professional 3D for our niche.** Excellent modular workflow, not arbitrary CAD breadth.
7. **Relationships before coordinates.** Constructive intent and stable provenance drive derived machining; CNC coordinates are resolved output.

## Canonical docs

| Concern | File |
|---|---|
| Current product / domain PRD | `docs/prd-v2.md` |
| Competitive positioning | `docs/proyectar-3d-competitive-position.md` |
| Proyectar 3D North Star | `docs/proyectar-3d-north-star.md` |
| Proyectar implementation roadmap | `docs/proyectar-3d-roadmap-vnext.md` |
| SketchUp + Muebles strategy | `docs/sketchup-muebles-strategy.md` |
| SketchUp manufacturing contract | `docs/sketchup-manufacturing-contract.md` |
| Parametric relationships/joints | GitHub #356 |
| Physical piece→furniture flow | `docs/production-flow-v2.md` |
| Lifecycle/events | `docs/project-lifecycle.md` |
| Architecture boundaries | `docs/architecture.md` |
| Code conventions | `docs/conventions.md` |
| Agent navigation | `AGENTS.md` |
