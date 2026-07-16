# Product

> Impeccable product context for UI work. Domain source of truth remains
> `docs/prd.md`. Do not invent a new brand or replace workshop workflows.

## Register

product

## Users

Primary: workshop owner / operator who quotes jobs, maintains catalogs
(materials, edge bands, hardware), defines reusable furniture modules, and
exports cut lists to the production optimizer.

Secondary (later): shop helper who only exports/prints cut lists — same app,
narrower flow.

Context of use: desk or laptop in the workshop; task-focused, often under
time pressure; expensive mistakes (wrong mm, wrong edge, wrong price) matter
more than visual delight.

## Product Purpose

Muebles turns Excel-based quoting and production prep into a shared web/desktop
app: catalogs once, reusable modules with option groups, project quotes with
resolved BOM and price, and export to `Plantilla_Optimizer.xlsx` without
rewriting the parts list.

Success looks like:
1. A typical quote (catalog modules + options) in under ~15 minutes with a
   trustworthy price breakdown.
2. Optimizer export ready for the existing cut workflow — board parts only,
   material names aligned with production.
3. UI that serves the task (catalogs → modules → projects → export), not a
   marketing surface.

## Brand Personality

Precise, calm, workshop-practical. Feels like a professional shop tool
(Linear / Stripe Dashboard class of product UI), not a SaaS landing page and
not a clone of Excel.

Three-word personality: **precise, calm, operational**.

Tone of UI copy (Spanish in the product): short labels, clear errors, no hype.
Agent-facing code stays English.

## Anti-references

- Generic AI SaaS chrome: purple gradients, neon accents, glassmorphism,
  glowing particles, cyan-on-black.
- Marketing hero layouts inside the app shell (big display type, metric tiles
  as decoration, identical icon+title+text card grids).
- Excel-cell-for-cell UI clone: dense grids without hierarchy, no detail mode,
  edit-everything-inline as the only pattern.
- Invented affordances for standard tasks (custom scrollbars, non-standard
  modals, display fonts on form labels).
- Decorative motion or page-load choreography; operators are in flow.
- Impeccable marketing brand (Neo Kinpaku gold/lacquer) — that is a different
  product; never restyle Muebles to match it.

## Design Principles

1. **Task first.** Design serves quoting and production; chrome never competes
   with the data.
2. **Prevent expensive errors.** Invalid states blocked before export; feedback
   is immediate and specific.
3. **One pattern per job.** Same modal / list→detail / toast vocabulary across
   catalogs, modules, and projects (`docs/design.md`).
4. **Tokens only.** Colors, type, spacing, and elevation come from the design
   system — no one-off hex in feature CSS.
5. **Progressive disclosure.** Scan list → open detail → edit in modal; never
   force full-page forms for small edits.
6. **Domain stays out of the UI layer.** React presents; `packages/domain`
   (and Go when applicable) calculates.

## Accessibility & Inclusion

Baseline: WCAG 2.1 AA for interactive product UI.

- Contrast verified for body and UI text (placeholders included), not eyeballed.
- Keyboard navigation and visible focus on all interactive controls.
- `prefers-reduced-motion` respected for every animation.
- Semantic HTML first; ARIA only as supplement.
- UI copy in Spanish, plain and short; technical codes (`MAT-001`, mm, ML)
  may stay as domain vocabulary.

## Canonical docs (do not fork)

| Concern | File |
|---------|------|
| Full product / domain PRD | `docs/prd.md` |
| Visual system & interaction patterns | `docs/design.md` |
| Architecture boundaries | `docs/architecture.md` |
| Code conventions | `docs/conventions.md` |
| Agent navigation | `AGENTS.md` |
