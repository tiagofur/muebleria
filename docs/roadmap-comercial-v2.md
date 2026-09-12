# Granete product roadmap — P0 to P3

> **Status:** ACTIVE
> **Updated:** 2026-09-12
> **Canonical for:** product priority, sequencing, dependencies and exclusions
> **North Star:** make Granete easy to sell and operate without weakening its commercial, design or manufacturing authorities.

Granete does not need a second architecture. It needs the existing rigorous architecture to become invisible to the user.

This roadmap replaces the phase ordering in the previous version of this file. Historical readiness reports remain evidence snapshots, not live priority:

- docs/demo-mvp-plan-2026-09-05.md
- docs/demo-golden-path-readiness-20260905.md
- docs/demo/demo-golden-path-rehearsal-20260906.md

GitHub issues own implementation. Architecture documents own invariants. This roadmap only orders those authorities and records what each phase must not absorb.

## Quick path

1. Finish or explicitly exclude every P0 route used in the Perfect Demo.
2. Prove the P1 loop with the first customers before expanding breadth.
3. Add P2 operational depth from observed daily work.
4. Pull P3 forward only with customer evidence or a completed prerequisite.

## Phase meaning

| Phase | Outcome | Exit rule |
|---|---|---|
| **P0 — Perfect Demo** | One coherent sales-to-release story with no silent industrial or commercial error. | Every shown route is verified at an exact revision or visibly excluded. |
| **P1 — MVP for first customers** | A customer can repeat the paid workflow safely with support and recovery. | Real customer tasks, host/machine boundaries and concurrent operations are proven. |
| **P2 — Daily operations** | Warehouse, labels, design clients and after-sales remain exact during normal work. | Multi-user, retry, historical lineage and shop-floor evidence are durable. |
| **P3 — Differentiators and future** | High-leverage experiences expand sales or margin without destabilizing the core. | Pilot evidence justifies the investment and the required authorities already exist. |

The repository Issue Form still uses its older priority vocabulary. The P0-P3 tag in an issue title maps to this roadmap; the Proposed priority field remains the exact option required by that form.

## Non-negotiable authorities

| Authority | Owner | Boundary |
|---|---|---|
| Commercial history and pricing projection | #642 | Exact QuoteRevision snapshots, exact PDF/XLSX and backend CommercialProjection. |
| Design and production lineage | #384 | Project, FurnitureInstance, Design, DesignRevision and ProductionRelease identities. |
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
| 1 | Complete exact commercial authority, backend CommercialProjection and exact customer PDF/XLSX | #642 | Projection must use the existing pricing authority, identify exact Design version/fingerprint and quote baseline, redact costs and never mutate QuoteRevision. |
| 2 | Preserve drilling for rotated DXF pieces | #676 | Transform every supported operation correctly or block the export. #650 does not own this defect. |
| 3 | Show live total, quote delta and Presentation mode inside SketchUp | #677 | Requires #642 CommercialProjection plus #465/#499/#474. Ruby displays server truth and never calculates prices. |
| 4 | Prove Quote to SketchUp to DesignRevision to ProductionRelease | #644 | Expand assertions only after owning behavior lands. No helper may manufacture hidden acceptance. |
| 5 | Finish the canonical PTX/CADmatic candidate | #650 | Technical completion is separate from customer/machine evidence. |
| 6 | Validate the exact PTX route in the workshop | #348 | Required before any CADmatic/machine compatibility claim. |
| 7 | Run the broader real-host-to-output gate | #354 | Consume #676 and the exact host/output versions. Simulated proof remains labeled simulated. |

## Demo presentation rule

The preferred customer-facing loop is:

1. open the exact Project/Design in SketchUp;
2. modify a supported cabinet configuration;
3. show Calculating changes, then the backend estimated total and delta;
4. compare against the last sent or accepted QuoteRevision;
5. enter Presentation mode with internal cost/IDs hidden;
6. if the accepted baseline changed, show Change order required without creating or approving anything automatically;
7. publish/reconcile/approve/release through the existing explicit commands.

If DXF, PTX, stock or a machine route is not part of the rehearsal, the script states that exclusion. Avoiding a route does not close its issue.

## P0 exclusions

- no second pricing engine in Ruby, React or exports;
- no automatic quote acceptance, DesignRevision approval or ProductionRelease;
- no machine claim from file generation alone;
- no universal CAM, CAD or hidden customer fixture;
- no weakening stale, preflight, tenant or exact-identity gates for the demo.

# P1 — MVP for first customers

## Commercial design loop

| Order | Work | Owner | Depends on |
|---:|---|---|---|
| 1 | Canonical post-acceptance Change Orders | #678 | #642 CommercialProjection and #384 exact identities. |
| 2 | Event-driven cross-client refresh and safe synchronization | #679 | #465, #496, #499 and #474. |
| 3 | Atomic, idempotent stock dispatch and picking | #680 | Existing stock ledger, #302 material planning and tenant transactions. |
| 4 | Commercial packaging, compatibility, diagnostics and usability | #355, #504, #506 | Supported host matrix #473, degraded behavior #474 and measured tasks. |

Change Order acceptance authorizes only the commercial delta. It does not rewrite the accepted quote or approve/release design.

Events are hints to refetch exact server state. They are not commands, truth or a second dispatcher.

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
- no broad-release claim before representative users complete the paid workflow.

# P2 — Daily operations

| Order | Work | Owner | Dependency and boundary |
|---:|---|---|---|
| 1 | Bring Proyectar under the canonical Design lifecycle | #643 | Reuse #308 North Star and #444 WebGL gate; no second Design truth. |
| 2 | Reconcile unresolved working-copy materials from Web | #658 | Reuse server provenance and generated client. |
| 3 | Persist and reuse exact offcuts | #681 | Requires #650 offcut identity and #680 atomic stock authority. |
| 4 | Bind labels and QR reprints to exact ProductionRelease | #682 | Reuse closed #96/#141/#283 render/scanner foundations and #577 release lineage. |
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

## Commercial chain

#642 → #677 → #644
#642 + #384 → #678 → #686
#465 + #496 + #499 + #474 → #679

## Industrial chain

#650 → #348 → #351 → #352/#353 → #503 → #354
#676 → #354
#680 → #681

## Exact operational lineage

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
