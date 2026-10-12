# Documentation map — read by task, not by directory

This file is the index for `docs/`. It is a routing table, not a second architecture
specification. **Do not read all documentation at startup.** Start from the approved
GitHub issue, identify the affected domain, then read only the canonical sources and
prerequisites listed below.

## Source-of-truth rules

1. **Current behavior:** inspect the current implementation, tests, generated contracts,
   and runtime evidence. A design document describes intent; it does not prove that
   every part is implemented.
2. **Architecture and decisions:** `docs/architecture.md`, the relevant focused
   document under `docs/architecture/`, and the applicable ADR under [`docs/adr/`](adr/README.md).
   ADR status matters: Proposed is not an accepted implementation contract.
3. **Task authorization and delivery:** the exact approved GitHub issue, its acceptance
   criteria/exclusions, current branch/base, and existing PR. Documentation cannot
   authorize extra scope.
4. **Verification:** `docs/verification.md` plus the smallest domain-specific test or
   command. Use the issue's risk and the repository's proportional verification rules.
5. **Historical material:** files under [`docs/history/`](history/README.md), dated audit/rehearsal/plan
   documents, and `progress/` explain provenance or past findings. They are not live
   status or current product truth unless a current canonical source explicitly adopts
   a finding. Do not load them by default.
6. **Generated audit evidence:** files under
   [`docs/history/muebles-audit-360-20260903/audit/`](history/muebles-audit-360-20260903/audit/README.md) are a retained evidence package.
   Its JSON, bundles, screenshots, scripts, and reports are not startup context. Open
   the audit README/index and only the specific evidence needed to investigate a
   concrete claim.

## Fast routing

| Task / question | Read first | Add only when relevant |
| --- | --- | --- |
| Product scope, terminology, user value | [Product](PRODUCT.md), [PRD v2](prd-v2.md) | [Commercial roadmap](roadmap-comercial-v2.md), current approved issue |
| Cross-cutting architecture or ownership | [Architecture contract](architecture.md), [Conventions](conventions.md) | Focused architecture document and applicable ADR in [ADR catalogue](adr/README.md) |
| Architectural decisions (ADRs) and lifecycle | [ADR catalogue](adr/README.md) | Focused architecture document under `docs/architecture/` |
| Historical records, audits, past baselines, judgment days | [Historical index](history/README.md) | Retained evidence package under [Audit 360](history/muebles-audit-360-20260903/audit/README.md) or pre-ODD log |
| API, Go backend, DTOs, persistence, auth, tenancy, RLS | [Backend agent guide](../backend-go/AGENTS.md), [Architecture contract](architecture.md) | [Organization foundation](architecture/organization-foundation-v2.md), ADR-0005/0006/0007, OpenAPI contract and focused tests |
| React/web UI and visual behavior | [Design contract](design.md) | [Operational UX](operational-ux.md), affected app/package instructions and UI tests |
| SketchUp extension, host bridge, interaction, sync | [SketchUp agent guide](../apps/sketchup-extension/AGENTS.md) | [Native entity model](architecture/sketchup-native-entity-model.md), [authoring interaction contract](architecture/sketchup-authoring-interaction-contract.md), [host reconciliation](architecture/sketchup-host-reconciliation.md), relevant ADR |
| Parametric furniture, construction, openings, fronts, golas | [Architecture contract](architecture.md) | [Parametric furniture library](architecture/parametric-furniture-library.md), [construction variants](architecture/construction-variants.md), [opening/front system](architecture/opening-front-system.md), ADR-0002/0009/0010 |
| Materials, hardware, assets, BOM | [Architecture contract](architecture.md) | [Material-aware resolution](architecture/material-aware-furniture-resolution.md), [hardware profiles](architecture/hardware-profiles.md), [3D asset library](architecture/3d-asset-library.md), focused tests |
| Projects, designs, revisions, quotes, production release | [Architecture contract](architecture.md) | [Project/design digital thread](architecture/project-design-digital-thread.md), [project lifecycle](project-lifecycle.md), ADR-0003 |
| Manufacturing, production, inventory, procurement, installation | [Production flow](production-flow-v2.md) | [Operational core](operational-core-v1.md), [project lifecycle](project-lifecycle.md), affected bounded-context docs |
| CNC, machine formats, receiver profiles, DXF/PTX | [Verification contract](verification.md) | Exact receiver's README/profile and relevant document under `machines/`; use source artifacts and golden examples rather than reading every dossier |
| Deploy, environment, database operations | [Deployment](deployment.md) | [PostgreSQL RLS operations](postgresql-rls-operations.md), [desktop release](desktop-release.md) |
| Tests, CI, release evidence | [Verification](verification.md) | [Test database isolation](architecture/test-database-isolation.md), [pilot readiness](pilot-readiness.md), exact workflow |
| Agent workflow / G-ODD / execution artifact | [Root AGENTS](../AGENTS.md), [human-start contract](demo/software-factory-human-start.md) | Role skill under `.agents/skills/`, then exactly the approved issue's `odd/tasks/<issue>-<slug>.md` if the chosen topology requires one |
| How to reorganize code/docs for agents | [Agent-first methodology](agent-first-methodology.md) | Applicable local `AGENTS.md` and exact change scope |

## Canonical vs. dated / historical documents

The following are useful but must not be mistaken for live operational state:

- [`docs/history/**`](history/README.md): historical baselines, audit findings, design explorations, and
  prior implementation/review evidence. Consult [`docs/history/README.md`](history/README.md).
- `docs/demo/*`: distinguish the portable G-ODD contract
  (`software-factory-human-start.md`) from status reports and dated rehearsals.
  Status reports are snapshots; verify current state against GitHub and the repository.
- `docs/*YYYY-MM-DD*`, `docs/*YYYYMMDD*`, and dated execution/reconciliation plans:
  treat as snapshots unless the issue explicitly asks to continue that plan.
- `docs/architecture/audit-670-final.md` and other audit reports: evidence/findings,
  not a substitute for the focused architecture contract or current source.
- [`docs/adr/`](adr/README.md): decision records. Read the status in [`docs/adr/README.md`](adr/README.md)
  and the canonical detail link; do not assume a Proposed ADR has been accepted.
- `odd/tasks/`: recoverable execution artifacts, not backlog or global progress.
  Read only the artifact named by the authorized issue.
- `progress/`: historical evidence, not the work queue or current state.

Do not delete or merge historical files merely because they are old or large. Before
moving/removing one, search references in code, docs, issues, workflows, scripts, and
external artifact links; preserve unique evidence and update all inbound links.

## Documentation maintenance rules

- Update the canonical domain document in the same change as a lasting contract change.
- Link to a single source of truth rather than copying whole sections into another file.
- Mark proposals, implementation status, known gaps, and evidence dates explicitly.
- Keep root `AGENTS.md` a compact routing map; keep task-specific detail in the nearest
  scoped guide and domain docs.
- Prefer a focused file with a clear owner and trigger over a giant general-purpose
  manual. Split only when a stable domain boundary makes retrieval easier.
- Archive superseded plans rather than leaving them beside current instructions with
  no warning; retain historical value but make its non-authoritative status obvious.
- Never claim a document, plan, or test is current without checking its date and the
  corresponding implementation/remote state.
