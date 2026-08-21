# Product

> Impeccable product context for UI work. Current product source of truth is
> `docs/prd-v2.md`. Historical MVP detail remains in `docs/history/prd.md`.

## Register

product

## Users

Primary users span the real operating flow of a woodworking shop:

- owner/operator;
- sales and sales manager;
- engineer/project technician;
- production manager;
- warehouse/purchasing;
- operators in cutting, CNC, edge banding and assembly;
- shipping/installation;
- admin.

A small workshop may collapse several of these roles into one person. A medium business
may separate them. The app must support both without duplicating domain logic.

Context of use:

- desk/laptop: quoting, engineering, purchasing and management;
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

### Physical production invariant

**Cutting, CNC and edge banding operate on individual pieces. Assembly is the handoff
where finished pieces become complete furniture units. From Assembly onward the main
tracking unit is furniture/unit/package.**

See `docs/production-flow-v2.md`.

## Success looks like

1. A typical quote can be created quickly with trustworthy pricing.
2. The exact approved/released revision sent to production is identifiable.
3. BOM drives real material requirements instead of disconnected estimates.
4. Cutting/CNC/edge queues represent actual pieces; assembly+ represents actual units.
5. A supervisor sees blockers and risk, not invented KPI values.
6. Installation can close real pending work through field issues and punch.
7. A completed job can compare estimated vs actual cost/margin.
8. The product remains simpler to learn than heavyweight horizontal ERP/CAD systems.

## Brand Personality

Precise, calm, workshop-practical. Feels like a professional operating tool, not a
marketing surface and not a clone of Excel.

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
10. **Workshop before platform aesthetics.** Apple guides clarity, Material guides
    system completeness, but operational reality decides the interaction.

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

## Accessibility & Inclusion

Baseline objective: WCAG 2.1 AA for interactive UI, plus workshop/mobile ergonomic
requirements where the environment demands larger targets and reduced precision.

- Color is never the only carrier of meaning.
- Focus/keyboard/semantics precede ARIA patches.
- Motion respects `prefers-reduced-motion`.
- Codes, measurements and units retain shop vocabulary.
- Touch surfaces in floor/field flows should favor 48px-class targets when practical.

## Canonical docs

| Concern | File |
|---|---|
| Current product / domain PRD | `docs/prd-v2.md` |
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
