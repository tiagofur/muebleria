# Granete product roadmap — P0 to P3

> **Status:** ACTIVE
> **Updated:** 2026-09-15
> **Canonical for:** product priority, sequencing, dependencies and exclusions
> **North Star:** make Granete easy to sell and operate without weakening its commercial, design or manufacturing authorities.

Granete does not need a second architecture. It needs the existing rigorous architecture to become invisible to the user.

This roadmap replaces the phase ordering in the previous version of this file. Historical readiness reports remain evidence snapshots, not live priority:

- docs/demo-mvp-plan-2026-09-05.md
- docs/demo-golden-path-readiness-20260905.md
- docs/demo/demo-golden-path-rehearsal-20260906.md

GitHub issues own implementation. Architecture documents own invariants. This roadmap only orders those authorities and records what each phase must not absorb.

## Immediate owner priority — 2026-09-15

**Simplify the Q/R experience and recover the path to Engineering and test PTX.**
The owner cannot currently reach Engineering from a modern released project.
The bounded plan is [Engineering flow recovery](demo/engineering-flow-recovery-2026-09-15.md);
[Project lifecycle](project-lifecycle.md) separates implemented facts from the target.
Base inspected: `556804c1cf57c79e064f3f32267634591b33dfbf`.

New corrective owners, not delivered by this roadmap:

- #738: Engineering entry/queue and exact contextual navigation.
- #739: frozen-release cut input, optimization and non-production PTX/PDF candidates.
- #740: release-bound Engineering completion and material/physical-operation gates.
- #741: P1/P2 work continuity, suspension/cancellation without silent retargeting.

The immediate usable milestone is **#738 → #739 → #644 verification**. #736/PR #737
is the separate in-flight release/BOM correction at this baseline; review and integrate
it first for samples affected by repeated-part IDs, without starting a competing writer.
Existing P access is not technically dependent on that BOM correction.

Test-file preparation does not wait for the whole ERP, Change Orders, stock dispatch,
Engineering completion or client machine evidence. It must preserve exact content,
permissions and serializer capability. Physical work must not be shown/used as authorized
until #740; P2 on started work additionally requires #741, and real dispatch requires #680.
No fake Project accepted/produced, material-ready or completed-operation stamps.

#642 remains the commercial/UX owner: one action per intention, automatic internal
validation and authoritative context selection, technical Q/R/P detail secondary.
#677 keeps the SketchUp HUD/Presentation scope. Neither issue is restarted: PR #663
already delivered exact commercial detail, #673 removed the auxiliary legacy acceptance
from the golden path, #697 simplified reconciliation, and #731/PR #735 automated design
validation/publication. Missing end-to-end Engineering is not proof those foundations
are absent. Q/R/P remain separate exact authorities, not extra user chores.

## Quick path

1. Recover Engineering and exact test outputs through the immediate milestone above.
2. Finish or explicitly exclude every other P0 route shown in the demo.
3. Prove the P1 paid workflow before expanding breadth.
4. Add P2/P3 depth only from observed use and the owning prerequisites.

## Phase meaning

| Phase | Outcome | Exit rule |
|---|---|---|
| **P0 — Perfect Demo** | One coherent quote/design/Engineering-to-validation-output story, with no silent industrial or commercial error. | Every shown route is verified at an exact context or visibly excluded; physical operation requires its separate gates. |
| **P1 — MVP for first customers** | A customer can repeat the paid workflow safely with support and recovery. | Real customer tasks, host/machine boundaries and concurrent operations are proven. |
| **P2 — Daily operations** | Warehouse, labels, design clients and after-sales remain exact during normal work. | Multi-user, retry, historical lineage and shop-floor evidence are durable. |
| **P3 — Differentiators and future** | High-leverage experiences expand sales or margin without destabilizing the core. | Pilot evidence justifies the investment and the required authorities already exist. |

The repository Issue Form still uses its older priority vocabulary. The P0-P3 tag in an issue title maps to this roadmap; the Proposed priority field remains the exact option required by that form.

## Non-negotiable authorities

| Authority | Owner | Boundary |
|---|---|---|
| Commercial history and pricing projection | #642 | Exact QuoteRevision snapshots, exact PDF/XLSX and backend CommercialProjection. |
| Design and production lineage | #384 | Project, FurnitureInstance, Design, DesignRevision and ProductionRelease identities. |
| Engineering entry and frozen input | #738, #739 | Consume existing exact release; no second BOM or output engine. |
| Operational authorization and work continuity | #740, #741 | Engineering/material facts and physical work remain separate from the existence of P. |
| SketchUp product | #465 | Authoring and host interaction; never pricing or manufacturing truth. |
| Perfect Demo regression | #644 | Verification only; it does not implement product behavior. |
| Cut program and PTX/CADmatic candidate | #650 | Internal deterministic program/output; no physical-machine claim. |
| Field PTX evidence | #348 | Exact import/readback and workshop evidence. |
| Proyectar convergence | #643 | Canonical Design working-copy/revision lifecycle. |
| 3D hardware program | #666 with #667-#671 | Versioned assets, SketchUp/Web representation, rigid assemblies and validation. |
| Factory coordination | #573 | Single control plane; no second dispatcher or queue. |

Closed issues remain historical proof. They are not reopened to absorb new exact-lineage work.

# P0 — Perfect Demo

## Required order

| Order | Work | Owner | Dependency and exit |
|---:|---|---|---|
| 0 | Finish review of the in-flight repeated-part release correction when needed by the sample | #736 / PR #737 | Preserve the existing writer; a checked issue body is not a merged runtime fix. |
| 1 | Modern release opens Engineering and appears in the correct queue | #738 | No Project.status workaround, no automatic Engineering/material completion. |
| 2 | Engineering uses the frozen cut input and prepares test PTX/PDF | #739 | Reuse #577/#650/#591/#600; supported serializer and exact plan pins, no stock or field-validation prerequisite. |
| 3 | Prove Q/R → release → Engineering → test download through normal UI | #644 | Extend existing fixtures after behavior lands; no SQL/manual state shortcuts. |
| 4 | Complete remaining commercial Q/R UX, consumers and exact customer PDF/XLSX | #642, #677 | Reuse delivered snapshots/projections and SketchUp publication automation; no duplicate pricing or revision system. |
| 5 | Close technical gaps exposed by the representative cut plan | #650 | Program/preview/bytes fidelity; no new serializer in the Engineering consumer. |
| 6 | Enforce exact Engineering/material authorization before any physical demo operation | #740 | Mandatory before exposing physical actions as operable; does not block non-production test candidates. |
| 7 | Preserve rotated drilling if DXF is included; qualify field output separately | #676, #348, #354 | No DXF or machine compatibility claim outside exact evidence. |

This order is for the immediate Engineering/PTX rehearsal, not permission to bypass
safety issues in a physical demonstration. #740 is a hard boundary for physical work;
#741/#680 apply to in-progress release changes/real stock dispatch respectively.

## Demo presentation rule

The preferred customer-facing loop is:

1. open the exact Project/Design in SketchUp;
2. modify a supported cabinet configuration;
3. show Calculating changes, then the backend estimated total and delta;
4. compare against the last sent or accepted QuoteRevision;
5. use Presentation mode when its delivered scope supports the task;
6. resolve only real commercial decisions, without creating Q for every spatial move;
7. publish/reconcile/approve/release through explicit existing commands;
8. continue to Engineering for the exact released content and test outputs.

Preflight, exact context preselection and refresh may be automatic. Acceptance,
approval, release and operational completion are not hidden side effects. A future
composite confirmation must disclose every consequence and retain each permission,
exact reference and retry/failure boundary; it is not required for #738/#739.

If DXF, PTX, stock or a machine route is not part of the rehearsal, the script states that exclusion. Avoiding a route does not close its issue. Downloading a candidate does not mark Engineering complete or manufacturing started.

## Demo design entry rule (#729)

The current Demo Vertical Slice uses **SketchUp as the only visible design
entry**. Web keeps Cliente/Proyecto → Cotización → historial/revisiones →
aprobación → Ingeniería → Producción → outputs; design authoring is reached
through Diseños → "Abrir en SketchUp" (pairing #499). Proyectar stays
implemented, tested and preserved for future work under its existing owners
(#643, #308, #444, #529) — no lifecycle, authority or `source_type` change.
Its entry points are hidden behind the single `demoExperience.proyectarVisible`
switch in `@granete/ui`; re-enabling it is that one-flag change.

## P0 exclusions

- no second pricing engine in Ruby, React or exports;
- no automatic quote acceptance, DesignRevision approval or ProductionRelease;
- no machine claim from file generation alone;
- no universal CAM, CAD or hidden customer fixture;
- no weakening stale, preflight, tenant or exact-identity gates for the demo;
- no requirement to complete stock/physical manufacturing merely to download a validation candidate;
- no live Project/catalog reconstruction presented as frozen-release content.

# P1 — MVP for first customers

## Commercial design loop

| Order | Work | Owner | Depends on |
|---:|---|---|---|
| 1 | Safe P1/P2 operational continuity and suspension/cancellation | #741 | Exact facts/gates #740; inventory effects remain #680. |
| 2 | Canonical post-acceptance Change Orders | #678 | #642 CommercialProjection and #384 exact identities. |
| 3 | Event-driven cross-client refresh and safe synchronization | #679 | #465, #496, #499 and #474; conflict-safe WorkingCopy writes before broader automatic sync. |
| 4 | Atomic, idempotent stock dispatch and picking | #680 | Existing stock ledger, #302 material planning and tenant transactions; required before using real dispatch. |
| 5 | Commercial packaging, compatibility, diagnostics and usability | #355, #504, #506 | Supported host matrix #473, degraded behavior #474 and measured tasks. |

Change Order acceptance authorizes only the commercial delta. It does not rewrite the accepted quote or approve/release design.

Events are hints to refetch exact server state. They are not commands, truth or a second dispatcher. Row locks alone do not reject an obsolete WorkingCopy replacement; #679 owns the expected-version boundary.

## 3D hardware sequence

Preserve the existing order:

1. #667 — versioned resources and catalog binding;
2. #668 — real SKP download, mounting and diagnosis;
3. #669 — coherent GLB/Web representation;
4. #670 — rigid assemblies and MERIVOBOX pilot;
5. #529 — basic fixed/moving actor milestone;
6. #671 — integrated host/WebGL/performance validation.

Do not create another hardware catalog, parser or animation issue. #529 remains the sole owner of opening/presentation kinematics.

## First-customer machine sequence

#348 → #351 → #352/#353 → #503 → #354

Each customer has an independent dossier and evidence pack. A result for Client A never certifies Client B. Manual transfer can be a valid first integration when its operator work and readback are explicit.

This is the qualification/production-output sequence. Already delivered profile/adapter
foundations may be reused for #739/#650 offline validation candidates without claiming
field readiness or implementing the complete #503 workspace.

## Daily-use SketchUp value in P1

Reuse existing owners instead of new tickets:

- #469 placement/snapping;
- #470 manufacturing overlay and provenance;
- #471 batch editing;
- #472 measured large-project performance;
- #473 host compatibility;
- #474 offline/degraded safety;
- #506 onboarding/library discovery and measured usability.

## P1 exclusions

- no optimistic UI compensation as a substitute for one stock transaction;
- no binary simultaneous geometry merge;
- no event-triggered business transitions;
- no support or machine promise outside the exact tested matrix;
- no broad-release claim before representative users complete the paid workflow;
- no P2 inheriting P1 Engineering/material/progress evidence or silently replacing started work.

# P2 — Daily operations

| Order | Work | Owner | Dependency and boundary |
|---:|---|---|---|
| 1 | Bring Proyectar under the canonical Design lifecycle | #643 | Reuse #308 North Star and #444 WebGL gate; no second Design truth. |
| 2 | Reconcile unresolved working-copy materials from Web | #658 | Reuse server provenance and generated client. |
| 3 | Persist and reuse exact offcuts | #681 | Requires #650 offcut identity and #680 atomic stock authority. |
| 4 | Bind labels and QR reprints to exact ProductionRelease | #682 | Reuse closed #96/#141/#283 render/scanner foundations and #577 release lineage; consume #739 readers where applicable. |
| 5 | Trace warranty refabrication to exact released parts | #683 | Reuse closed #303 installation/punch, existing WarrantyTicket and #304 costing. |

## Delivered foundations, not new backlog

| Capability | Existing proof | Remaining roadmap treatment |
|---|---|---|
| Label PDF, QR and ZPL formats | closed #96, #141, #283 | #682 adds exact release binding; do not rebuild renderers. |
| Installation, field issues and punch | closed #303 | #683 adds warranty/refabrication lineage; no new CRM. |
| Expected versus actual margin | closed #304 | Validate through pilots; do not create another dashboard issue now. |
| Material planning, partial receiving and reservations | closed #302 | #680 fixes cross-write atomicity. |
| Effective material thickness | closed #402 | Lot calibration is a future evidence-driven extension, not a duplicate today. |
| Grain constraints and useful-remnant output | #650 and current optimizer | #681 adds physical offcut inventory, not another cut engine. |

## P2 exclusions

- no historical reconstruction from mutable Project/catalog data;
- no duplicate optimizer, warehouse, label or warranty subsystem;
- no reusable offcut without material, dimensions, grain and source lineage;
- no QR scan as production authorization;
- no warranty repair that rewrites the original release.

# P3 — Differentiators and future

| Work | Owner | Pull-forward gate |
|---|---|---|
| Exact 3D revision diff plus commercial/industrial impact | #684 | P0 commercial loop stable and #444 performance evidence. |
| Quick maquila from validated part lists | #685 | Real paid workflow/sample through #306 plus #650/#351 readiness. |
| Customer-safe quote/change/install/warranty portal | #686 | #678 Change Orders, #460 security and validated customer tasks. |
| Advanced opening/presentation kinematics | #529 | Basic fixed/moving actor milestone and #671 evidence. |
| Measured Proyectar usability benchmark | #314 | Representative users and the current #308 task script. |
| Dealer/factory network expansion | #446, #453-#459 | Required by an actual customer relationship; do not pull into the single-factory demo. |

## Ideas retained without a new duplicate issue

- automatic purchasing suggestions: validate the closed #302 flow first;
- calibrated thickness by material lot: extend #402 only after field evidence defines ownership and measurement;
- richer profitability intelligence: reuse #304 traceable costing;
- automatic machine transfer: consider only after #348 readback and recovery evidence;
- distributor portal: reuse #446/#453-#459;
- broader catalog/brand recipes: prioritize from #306 pilot demand.

## P3 exclusions

- no Promob clone, generic CAD or generic ERP;
- no customer portal exposing internal cost, IDs or machine diagnostics;
- no arbitrary spreadsheet import without a versioned mapping report;
- no dashboard proxy presented as actual profitability;
- no transfer automation replacing import/readback evidence.

# Dependency summary

## Immediate Engineering/test-output milestone

#738 → #739 → #644 verification
#577 + supported #650/#591/#600 → #739
#736/PR #737 → release of samples affected by repeated-part collisions

#740 gates physical operation; #741 gates safe P1/P2 started-work changes.
Neither is a stock/physical-completion prerequisite for #739 validation candidates.

## Commercial chain

#642 → #677 → #644
#642 + #384 → #678 → #686
#465 + #496 + #499 + #474 → #679

## Industrial qualification chain

#650 → #348 → #351 → #352/#353 → #503 → #354
#676 → #354
#680 → #681

## Exact operational lineage

#738 + exact release facts → #740 → #741
#577 + existing labels → #682
#303 + existing warranty + #304 → #683
#384 + #642 + #643 + #444 → #684

## 3D hardware chain

#667 → #668 → #669 → #670 → #529 basic milestone → #671

# Recommended execution discipline

- Re-read exact issue state, branch SHA and CI before starting a slice.
- Keep one root cause per issue and preserve #573 as the single coordination plane.
- A parent META is not implementation permission for every child.
- Do not close an issue because a similarly named PR merged; compare its complete acceptance criteria.
- Do not merge, close, add protected labels or advance a dependent phase automatically.
- Real browser, real SketchUp host and physical machine evidence are distinct layers.
- A roadmap entry is not a claim that the capability is implemented.

# Roadmap maintenance

Update this file when:

- a phase exit criterion changes;
- a new verified gap has no existing owner;
- an issue closes or is superseded after exact readback;
- pilot evidence through #306 changes commercial priority;
- an authority boundary changes through an ADR.

Do not create another parallel roadmap. Link detailed architecture and test evidence from the owning issue or document, and keep this file focused on product order and boundaries.
