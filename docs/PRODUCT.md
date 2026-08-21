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
on:

- product quality;
- ease of use;
- speed;
- trustworthy domain behavior;
- integrated design→BOM→production flow;
- operational continuity through installation and costing.

See `docs/proyectar-3d-competitive-position.md`.

## Users

Primary users span the real operating flow of a woodworking shop:

- owner/operator;
- sales and sales manager;
- designer/project engineer;
- production manager;
- warehouse/purchasing;
- operators in cutting, CNC, edge banding and assembly;
- shipping/installation;
- admin.

A small workshop may collapse several of these roles into one person. A medium business
may separate them. The app must support both without duplicating domain logic.

Context of use:

- desk/laptop: quoting, Proyectar, engineering, purchasing and management;
- workshop floor: queues, scans, physical progress and exceptions;
- field/mobile: survey, installation, photos, issues and punch;
- mistakes in mm, material, revision, stock or status cost real money.

## Product Purpose

Muebles is a **vertical operating platform for small and medium woodworking/furniture
businesses**. It connects:

```text
Sales → Survey/Design → Engineering/Release → Materials → Production
→ Shipping → Installation → Closeout/Warranty → Job Profitability
```

Its historical core — catalogs, reusable modules, resolved BOM, quote pricing and
Optimizer output — remains fundamental, but it is no longer the full product boundary.

## Three product pillars

### A — Sell

```text
Customer → Quote → Proyectar → Presentation → Approval
```

Proyectar is a core sales/design workspace, not a decorative preview.

### B — Build

```text
Engineering → BOM → Materials → Cut → CNC → Edge → Assembly → QC
```

### C — Operate

```text
Project → Purchasing → Shipping → Installation → Warranty → Costing
```

The competitive advantage is the continuity between these pillars.

### Physical production invariant

**Cutting, CNC and edge banding operate on individual pieces. Assembly is the handoff
where finished pieces become complete furniture units. From Assembly onward the main
tracking unit is furniture/unit/package.**

See `docs/production-flow-v2.md`.

## Proyectar 3D North Star

Before changing Proyectar UI, R3F/Three.js interaction, module insertion, materials,
selection, inspector, aggregates, camera or environment authoring, read:

1. `docs/proyectar-3d-north-star.md`;
2. `docs/proyectar-3d-roadmap-vnext.md`;
3. `docs/design.md`;
4. `docs/architecture.md` when the change affects state/domain boundaries.

### Target quality matrix

| Capability | Target |
|---|---:|
| Find furniture | ★★★★★ |
| Insert / drag | ★★★★★ |
| Wall/floor/corner snap | ★★★★★ |
| Dimensions | ★★★★★ |
| Materials | ★★★★★ |
| Aggregates | ★★★★★ |
| Hardware | ★★★★★ |
| Selection/context | ★★★★★ |
| Undo/redo | ★★★★★ |
| Move/copy/duplicate | ★★★★★ |
| Multi-select/align | ★★★★★ |
| Multi-space | ★★★★★ |
| Client presentation | ★★★★☆ |
| Photorealism | ★★★☆☆ |
| Arbitrary/free CAD | ★★☆☆☆ |
| Ultra-complex parametrization | ★★★☆☆ |
| Design → production continuity | ★★★★★+ |

This matrix is a target, not an assertion of current implementation quality.

### Proyectar interaction model

The user should continuously understand:

> **What can I insert? → Where am I working? → What can I change?**

The canonical information architecture is:

```text
Persistent furniture/material library → 3D workspace → contextual inspector
```

A persistent module/material library is allowed and encouraged when it improves the
workflow. It must not copy Promob's visual skin or expose internal domain complexity.

## Success looks like

1. A typical quote can be created quickly with trustworthy pricing.
2. A new Proyectar user can place the first common module in roughly <60s target during
   usability benchmarking, without needing internal domain knowledge.
3. Common material and aggregate operations are measured in seconds, not modal chains.
4. The exact approved/released revision sent to production is identifiable.
5. BOM drives real material requirements instead of disconnected estimates.
6. Cutting/CNC/edge queues represent actual pieces; assembly+ represents actual units.
7. A supervisor sees blockers and risk, not invented KPI values.
8. Installation can close real pending work through field issues and punch.
9. A completed job can compare estimated vs actual cost/margin.
10. The product remains easier to learn for its target niche than heavyweight horizontal
    ERP/CAD stacks.

## Brand Personality

Precise, calm, workshop-practical. Feels like a professional operating/design tool, not
a marketing surface and not a clone of Excel or another CAD product.

Three-word personality: **precise, calm, operational**.

Tone of UI copy: Spanish, short, concrete, no hype. Agent-facing code stays English.

## Anti-references

- Generic AI SaaS chrome: purple gradients, neon accents, glassmorphism, particles.
- Marketing hero layouts inside operational screens.
- Excel-cell-for-cell UI clone with no hierarchy.
- Decorative motion that slows repeat work.
- Dashboard card grids with no action or decision value.
- UI that hides data quality by showing estimates as facts.
- A full Promob/SketchUp clone: free-form CAD is outside the moat.
- CAD toolbars added only because traditional CAD software has them.
- Internal concepts (`world transforms`, aggregate internals, option roles) exposed as
  the default user vocabulary.

## Design Principles

1. **Task first.** Chrome never competes with work.
2. **Prevent expensive errors.** Wrong revision/material/measurement must be blocked or
   explicitly overridden with audit.
3. **Correct unit of work.** Piece vs unit vs package vs visit must match the physical
   process.
4. **One pattern per job.** Repeated operational problems use consistent patterns.
5. **Tokens only.** Visual system comes from `docs/design.md`.
6. **Progressive disclosure.** Complexity appears when the job requires it.
7. **Domain stays out of UI.** React presents; domain/backend calculate/enforce.
8. **Exception first.** Supervisory views prioritize risk, shortage, stale revision,
   rework and schedule danger.
9. **Data truth.** Actual / estimated / forecast / proxy are visibly distinct.
10. **Workshop before platform aesthetics.** Operational reality decides interaction.
11. **Simple because domain is smart.** Proyectar hides complexity behind workshop
    language instead of removing necessary capability.
12. **Professional 3D for our niche.** We compete on UX quality for modular furniture,
    not on arbitrary CAD breadth.

## Operational UX

`docs/operational-ux.md` is mandatory for screens involving:

- queues;
- station execution;
- scans;
- gates;
- approvals/releases;
- material shortages;
- QC/rework;
- shipping;
- installation/punch;
- managerial operational dashboards.

`docs/proyectar-3d-north-star.md` is mandatory for Proyectar/editor work.

## Accessibility & Inclusion

Baseline objective: WCAG 2.1 AA for interactive UI, plus workshop/mobile ergonomic
requirements where the environment demands larger targets and reduced precision.

- Color is never the only carrier of meaning.
- Focus/keyboard/semantics precede ARIA patches.
- Motion respects `prefers-reduced-motion`.
- Codes, measurements and units retain shop vocabulary.
- Touch surfaces in floor/field flows should favor 48px-class targets when practical.
- Important 3D actions should expose numeric/click/keyboard alternatives when reasonable.

## Canonical docs

| Concern | File |
|---|---|
| Current product / domain PRD | `docs/prd-v2.md` |
| Competitive positioning | `docs/proyectar-3d-competitive-position.md` |
| Proyectar 3D North Star | `docs/proyectar-3d-north-star.md` |
| Proyectar implementation roadmap | `docs/proyectar-3d-roadmap-vnext.md` |
| Historical MVP PRD | `docs/history/prd.md` |
| Operational consolidation plan | `docs/operational-core-v1.md` |
| Physical piece→furniture flow | `docs/production-flow-v2.md` |
| Lifecycle/events | `docs/project-lifecycle.md` |
| Visual system & interaction patterns | `docs/design.md` |
| Operational UX | `docs/operational-ux.md` |
| Architecture boundaries | `docs/architecture.md` |
| Code conventions | `docs/conventions.md` |
| Agent navigation | `AGENTS.md` |
| Routes | `apps/web/src/routes.ts` → `NAV_PATHS` |
| RBAC executable truth | `packages/domain/src/rbac.ts` + backend enforcement |
| Documentation/code reconciliation | `docs/documentation-sync-2026-08-21.md` |
| Historical UI/UX evidence | `progress/explore_ui_*.md` |
