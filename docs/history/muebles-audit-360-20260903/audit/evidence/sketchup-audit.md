# SketchUp and manufacturing audit evidence

Snapshot `316df57c7c3c9d5470b5a3f22b39fffeacfd7676`. Read-only source inspection; no product writes, no GitHub writes, no host/machine execution.

## Architecture
Bootstrap runtime → Application composition root → dedicated device auth + HTTP adapter + RemoteCatalogProvider → HtmlDialog controllers/semantic selection → native furniture renderer and metadata; connected path adds ModelBinding, ProjectFurniture, DuplicateResolver and staged DesignPublish. Ruby owns host geometry and interaction, not authoritative machining.

## Findings

### SU-01 — P1 — Production drilling silently falls back to name-based heuristics and loses provenance in exports
A board named door/puerta can acquire two 35mm hinge holes without authoritative hardware. fallbackUsed/issues exist internally but are stripped from data.patterns consumed by DXF and production pack. Export failure also silently removes drilling and still reports successful DXF download.

Evidence: `packages/domain/src/partDrillingResolver.ts:515-533`; `packages/domain/src/partDrilling.ts:66-95`; `packages/domain/src/projectDrilling.ts:191-211`; `apps/web/src/exports/useExportHandlers.ts:438-453`; `apps/web/src/exportProductionPack.ts:159-168`

Demo: label geometry-only exports and prohibit physical production from heuristic output. MVP: gate machining exports on explicit resolved operations and retain provenance/issues; separate preview inference from productive output.
Effort M; dependencies: authoritative machining unification, export/readiness gate.
Code path inspected; no live host or machine execution.

### SU-02 — P1 — DXF drilling omits rotated parts and per-hole depths
Rotated nested parts export contour without holes. Diameter/face layers cannot convey different depths for the same tool, and edge circles are projections not machine instructions.

Evidence: `packages/excel/src/dxfCutPlanExport.ts:76-84`; `packages/excel/src/dxfCutPlanExport.ts:238-260`

Demo: use only verified unrotated sample as geometry preview. MVP: capability-gated adapter with explicit transform/depth semantics and exact import/readback dossier.
Effort L; dependencies: machine dossier, postprocessor adapter, operation provenance.
Code path inspected; no live host or machine execution.

### SU-03 — P1 — Generic fallback can replace native resolved geometry on nil layout parameter edit
RemoteCatalogProvider is primary; Application injects StaticCatalogProvider as its fallback. On a fallback/error path returning nil layout (not normal successful remote resolution), update_furniture blocks nil layout only for material changes; a parameter-only update can clear native children and build generic boards. This is a statically reachable conditional risk, not a live-host reproduction.

Evidence: `apps/sketchup-extension/src/granete_for_sketchup/application.rb:32-36`; `apps/sketchup-extension/src/granete_for_sketchup/library/catalog_provider.rb:255-256`; `apps/sketchup-extension/src/granete_for_sketchup/model/furniture_builder.rb:456-476`; `apps/sketchup-extension/src/granete_for_sketchup/model/furniture_builder.rb:517-524`

Demo: require online resolve and fixed prepared fixture. MVP: preserve accepted geometry for all unavailable/incompatible responses; restrict generic rendering to explicitly separate preview state and route edits through shared coordinator.
Effort M; dependencies: shared host runtime, offline state model.
Code path inspected; no live host or machine execution.

### SU-04 — P1 — Rich authoring and machining user interaction remains disconnected
Resolver presence does not mean operator can move a shelf/hardware and see authoritative drilling update. Every hardware edit and manufacturing/preflight action is disabled in CapabilityPolicy.

Evidence: `apps/sketchup-extension/src/granete_for_sketchup/library/catalog_provider.rb:274-282`; `apps/sketchup-extension/src/granete_for_sketchup/ui/dialog_controller.rb:434-443`; `apps/sketchup-extension/src/granete_for_sketchup/selection/capability_policy.rb:46-97`

Demo: show preconfigured placement, not arbitrary hardware authoring. MVP: one end-to-end accepted snapshot edit with correlation, supersession, rollback, undo, preflight and real host proof.
Effort L; dependencies: generated contract #496, shared host runtime #498, authoring UX #466/#467/#468.
Code path inspected; no live host or machine execution.

### SU-05 — P1 — Machining truth is fragmented between compiled authoring profiles and catalog-driven project exports
Authoring accepts only two explicit hinge-code patterns while catalog engine supports hardware.machining. Unknown authoring hardware profile emits no drilling. Same commercial hardware may therefore yield different results by route; arbitrary real brand support is unproven.

Evidence: `backend-go/internal/domain/engine/authoring_machining.go:42-49`; `backend-go/internal/domain/engine/authoring_machining.go:94-99`; `backend-go/internal/domain/engine/authoring_machining.go:458-462`; `packages/domain/src/partDrillingResolver.ts:443-449`; `packages/domain/src/projectDrilling.ts:140-180`

Demo: exact curated codes and explicit patterns. MVP: a single versioned SKU/pattern authority consumed across resolve/preflight/export; unknown productive pattern blocks rather than guessing.
Effort L; dependencies: catalog machining authority, TS-Go parity fixture, physical SKU technical evidence.
Code path inspected; no live host or machine execution.

### SU-06 — P2 — Catalog cache is not automatically revalidated and failure retains prior cache
Normal reads return cached contract without TTL/session-key comparison. A failed forced refresh marks status but leaves prior cache available to next normal read. Definition list version is not an immutable manufacturing revision guarantee.

Evidence: `apps/sketchup-extension/src/granete_for_sketchup/library/catalog_provider.rb:300-305`; `apps/sketchup-extension/src/granete_for_sketchup/library/catalog_provider.rb:323-372`; `apps/sketchup-extension/src/granete_for_sketchup/library/catalog_provider.rb:385-401`

Demo: explicit refresh before session and stop on auth/catalog errors. MVP: tenant/session keyed cache, stale status and accepted catalog revision, blocked mutation until authoritative revalidation.
Effort M; dependencies: offline/cache #474, host coordinator #498.
Code path inspected; no live host or machine execution.

## Feature inventory

- **Real workshop catalog to native SketchUp furniture — implemented_partial**: Same persisted modules as React, typed parameter validation, remote layout and native component rendering exist. This is catalog projection, not proof of immutable published catalog release/version. Historical host fixtures are not current live-host proof.
  Evidence: `backend-go/internal/api/furniture.go:54-110`; `backend-go/internal/api/furniture_catalog.go:202-248`; `apps/sketchup-extension/src/granete_for_sketchup/library/catalog_provider.rb:300-366`; `apps/sketchup-extension/src/granete_for_sketchup/ui/dialog_controller.rb:393-405`; `apps/sketchup-extension/src/granete_for_sketchup/model/furniture_builder.rb:534-591`

- **Project binding, physical unit placement, duplication and publication — implemented_partial**: Connected model binding and server FurnitureInstance identity are implemented, with staged artifact publication. Legacy unconnected insertion retains local instanceRef. Current host undo/save-reopen/duplicate/publish proof remains unexecuted in this audit.
  Evidence: `apps/sketchup-extension/src/granete_for_sketchup/connection/model_binding.rb:36-121`; `apps/sketchup-extension/src/granete_for_sketchup/connection/project_furniture.rb:270-280`; `apps/sketchup-extension/src/granete_for_sketchup/connection/design_publish.rb:158-191`; `apps/sketchup-extension/src/granete_for_sketchup/model/furniture_builder.rb:746-765`

- **Dedicated device authentication — implemented**: Device secret uses macOS Keychain or Windows credential vault; unsupported secure storage fails closed. Token held in memory and exchanged via device endpoint. OS host secure-store integration not exercised here.
  Evidence: `apps/sketchup-extension/src/granete_for_sketchup/auth/device_provider.rb:20-56`; `apps/sketchup-extension/src/granete_for_sketchup/auth/device_provider.rb:289-349`

- **Rich authoring resolve versus host editor — partial_not_wired**: Versioned POST adapter exists but source-wide search finds no call site in plugin. User insert/edit executes GET layout. Hardware direct manipulation, machining inspect and preflight actions are explicitly disabled.
  Evidence: `apps/sketchup-extension/src/granete_for_sketchup/library/catalog_provider.rb:274-282`; `apps/sketchup-extension/src/granete_for_sketchup/ui/dialog_controller.rb:434-443`; `apps/sketchup-extension/src/granete_for_sketchup/selection/capability_policy.rb:46-97`

- **Hardware and relationship-derived machining — partial_multiple_paths**: Authoring path has explicit relationships and compiled profile subset. Project path uses catalog machining and structural-role joinery rules. Neither proves arbitrary geometric-contact inference or a verified Blum SKU catalogue.
  Evidence: `backend-go/internal/domain/engine/authoring_machining.go:61-99`; `backend-go/internal/domain/engine/authoring_machining.go:450-499`; `packages/domain/src/jointDrillingRules.ts:379-403`; `packages/domain/src/projectDrilling.ts:140-180`

- **DXF cutplan geometry and drilling circles — implemented_non_machine_validated**: 2D DXF layer-based output exists; rotated pieces lose drilling; depths and machine-specific programming are not encoded. No exact machine/software readback performed.
  Evidence: `packages/excel/src/dxfCutPlanExport.ts:76-84`; `packages/excel/src/dxfCutPlanExport.ts:238-260`

## Verification boundaries
- No live SketchUp host run, TestUp session, real Keychain/Vault interaction, interactive undo/redo or save/reopen was executed by this subtask.
- No exact machine model/control/software, import/readback, operator sign-off or checksum evidence was supplied.
- No verified physical Blum SKU data/model/pattern was inspected; BIS-CL110 is a repository code, not proof of manufacturer interoperability.
- No claim of generated-contract parity from source inspection alone; central parent test evidence must be attached separately.

Parent reports isolated init/Ruby/RBZ suites passed (396 tests/3185 assertions + 3 tests/1599 assertions); this subtask did not execute or independently verify those runs. They are not real-host TestUp evidence.

## Benchmarks (parent-verified primary sources)

- [https://www.blum.com/gb/en/services/planning-construction-product-selection/cabinet-configurator/](https://www.blum.com/gb/en/services/planning-construction-product-selection/cabinet-configurator/): Hardware selection linked to cabinet planning. CAD/BXF and hardware/drilling planning. Learn: Product SKU and technical pattern must travel together. Avoid: Do not claim its product breadth or BXF compatibility. Adapt: Curated verifiable SKU/pattern list for a narrow demo.

- [https://www.scmgroup.com/en_GB/scmwood/products/maestro-digital-systems/software.c102273/drilling-solutions.102276](https://www.scmgroup.com/en_GB/scmwood/products/maestro-digital-systems/software.c102273/drilling-solutions.102276): Controller-specific CNC preparation. Maestro lab/cnc and DXF import workflows. Learn: Import is only a step; exact software readback is required. Avoid: Do not build enterprise CAM or invent a postprocessor. Adapt: Machine dossier plus one exact controlled import/readback.

- [https://help.sketchup.com/en/sketchup/components](https://help.sketchup.com/en/sketchup/components): Reusable native geometry. Instances reference component definitions.. Learn: Shared definitions affect multiple instances. Avoid: Never derive business identity from host component identity. Adapt: Keep per-furniture isolation and server-owned IDs, verify make_unique/undo/save-reopen in host.

## Key Learnings:
1. Current host editing uses GET layout, not the existing rich POST authoring transport.
2. Project export drilling can become name-based heuristics while exported data drops fallback provenance.
3. Valid DXF syntax is not machine compatibility or safe physical machining.
