## #577 — part/stage continuity (safety partial; 2026-09-07)

- Authorized child `577/part-stage-continuity`, fresh branch `codex/577-part-stage-continuity`, exact base `aca051e219dda4f0114f8ab909f4cc79008b4b90`; #573 comments 5575121350/5575143132; independent 1,100 authored-line ceiling. Started 20:12 UTC. Parent owns live admission, validation and publication.
- Fail closed for canonical execution commands under the existing project lock: the frozen snapshot has no routing/machining coverage proof. Never replace it with live catalog or fabricated no-CNC routes.
- Preserve existing release authority, immutable snapshot, physical identities, warehouse event and legacy-only compatibility; align engineering stage and remove fabricated mapper revisions.
- Extend one Q1 → Q2/R2 → P1 → materials → warehouse browser scenario to the explicit routing blocker. Full physical-production golden remains NOT PROVEN; no new engine, merge or #577 closure.
- Focused 151 TS/UI/mapper tests and Go `TestPartExec_*` pass; Web TypeScript and diff checks pass. Single Q2/R2 browser scenario is authored, not yet executed. Final R3 Go/PostgreSQL/init/browser/independent review/exact-head CI remain parent-owned. Disabled/unmanaged RDD.

## #577 — part/stage continuity — executor handoff Codex → GLM (2026-09-07)

- Formal handoff under #573 comment 5575143132: quarantined Codex reservation released with a stopped-work attestation, child re-admitted as attempt 2/2 on the same base/branch/worktree; preserved HEAD `15c72be3` kept as the sole implementation lineage (no parallel writer, no second implementation).
- Frozen-routing analysis: schema-v1 snapshot freezes exact BOM/material demand and physical identities only; no machining/drilling evidence exists in ANY P1-time structure (revision items carry no placements/relationships; the drilling resolver is TS/client-side over mutable project state). Preferred options A/B unavailable without inventing evidence or a second engine → fail-closed stays the terminal behavior of this slice.
- Independent review (read-only): APPROVE WITH NITS. Its MAJOR finding fixed here: the generic project PUT froze the legacy release blob but still persisted client `part_instances`/`module_units` for canonical projects, and `MutateProjectQuality` wrote both execution columns without the routing guard.
- Corrections: shared `guardCanonicalExecutionRouting` (exact P1/R2/fingerprint then fail closed) now backs part-executions AND quality mutations; the aggregate PUT freezes execution columns to the stored copy when a canonical release exists; unreachable canonical branch removed from the generate handler; readiness uses the domain authority constant; E2E legacy-CTA negative made case-insensitive; FabricScreen blocker test satisfies the required sectors prop (full-monorepo typecheck gap in the inherited commit).
- GLM readback evidence: domain 1283 / ui 1627 / storage TS 190 / web 433 tests pass; `TestOpsDt1`+`TestProductionRelease` storage suites pass on real PostgreSQL (frozen-routing identity matrix now includes the quality 409 and an accepted aggregate PUT with forged executions leaving columns untouched); browser gate PASS 4/4 (Chromium + Go + ephemeral PostgreSQL) executing the previously authored golden scenario; `pnpm typecheck`, `pnpm openapi:check`, `git diff --check` PASS. #577 remains open: physical-production leg NOT PROVEN until engineering freezes real routing/machining evidence at release time.

## #577 — warehouse/reservations continuity (partial; 2026-09-07)

- Authorized child `577/warehouse-reservations-continuity`, fresh branch `codex/577-warehouse-reservations-continuity`, exact base `97636e18ac0b827e3b77522a0015d0198987e6aa`; parent owns factory and publication. Started 18:39 UTC after baseline; owner #573 comment 5574451831 permits up to 1,000 authored lines excluding generated output.
- Bind reserve/release to the existing exact frozen planning; cap demand/stock, serialize warehouse balances, preserve rollback/audit and legacy-only compatibility.
- Canonical React actions bypass local recomputation, reject stale session/command results and present frozen planning/native board-sheet demand rather than mutable picking estimates.
- Focused real PostgreSQL, domain parity, UI, typecheck and OpenAPI passed; final full Go/init/browser/independent review/exact-head CI remain parent-owned and pending. See `progress/implementation_577_warehouse_reservations.md`.
- No part executions, machine integration, full stage continuity, ledger change, merge or #577 closure. Disabled/unmanaged RDD.

## #577 — atomic canonical manufacturing capture (partial; 2026-09-07)

- Authorized continuation and up-to-800-line exception; branch `feat/577-atomic-manufacturing-capture`, base `6691fcdffd819578fd71bd196ee53bbe977abd72`; factory ownership held by parent, started 16:06 UTC.
- Capture exact revision units, existing fingerprint and aggregate demand with P1 in one coherent tenant transaction; reuse private immutable table 000122, with owner-private exact reader.
- Canonical material derivation consumes frozen server requirements, not client lines or mutable catalog; Web sends only the exact release pin. Legacy-only derivation remains compatible.
- Real PostgreSQL HTTP proofs cover failed snapshot insert/rollback, same-key retry, private read/tenant denial, later revision and project/catalog mutation, forged demand and missing-snapshot rejection. Focused storage/API evidence is recorded in the parent task; final exact-head gates/review pending.
- No warehouse/reservation/part-execution continuity claim, new release/fingerprint, machine changes, ledger activation, issue closure or merge. Ordinary independent review; RDD disabled/unmanaged.

## #591 — machine output selection (entrega parcial, wiring completo)

- Rama `feat/591-machine-output-selection`; migración 000123 + API generada + resolver + UI de Ingeniería + export normal ligado al tuple exacto; sin fallback ni bulk (ver `progress/implementation_591_machine_output_selection.md`). Ronda de revisión corregida (GET factory-gate, mismatch path/body, error visible en UI, refetch tras save, mapper plano) + storage PG real y E2E browser 4/4 PASS; pendiente sólo CI del head final.
## #577 — exact revision collection assembly (partial)

- Assemble physical units through the existing Go resolver and one resolved-BOM demand aggregation; preserve revision identity, unit order and independent typed dimensions without reading mutable project items.
- Share the existing conservative 10,000-work-unit budget across the collection before each BOM allocation; reject duplicate/missing identities, mixed revisions, empty manufacturing and partial results.
- Focused and race suites pass: 19 top-level tests plus 145 subtests each, no skips; four new collection tests cover 19 subtests. Full engine package also passes.
- This server-only helper is not wired to capture, API or operational consumers; PostgreSQL/React continuity, rollback/idempotency and tenant-isolation evidence remain pending. No new release/fingerprint, ledger mutation, review or merge; disabled/unmanaged.

## #351 — machine-output adapters foundation (entrega parcial, lane autorizado por owner)

- Trigger: fallo REAL de conversión PTX en Client A (REAL_FIELD_RED, registrado sanitizado en `docs/machines/client-a/ptx-conversion-failure.md`); owner autorizó avanzar el lane machine-integration sin cerrar #348/#351/#352.
- Rama: `feat/351-machine-output-adapters` (apilada sobre PR #587); no toca archivos de #577 (`backend-go/internal/domain/engine/**`, `packages/domain/src/engine/**`).
- Contrato neutral `packages/domain/src/machineOutput.ts`: `ResolvedCuttingJob`/`ResolvedMachiningJob` (wrappers provenance-exactos sobre CutPlan/ProjectDrillingData existentes), `OutputCompatibilityProfile` (concepto nuevo, decisión documentada en `docs/architecture/machine-profiles-and-adapters.md`), `PostprocessorAdapter` boundary fail-closed, `ArtifactManifest` (claim `notClaimed`, missingProvenance explícito, banner non-production).
- Implementación `packages/excel/src/machines/`: adapter PTX (un serializador, el existente, byte-identical al golden #348) + perfiles versionados `ptx-generic` r1 / `ptx-cadmatic-3/4/5` / `saw-homag` / `mpr-woodwop` — CADmatic/SAW/MPR sin dimensiones evidenciadas → fallan cerrado con `FIELD_FORMAT_EVIDENCE_REQUIRED`; machine profiles HPP 250/BHX 050 con cero capabilities inferidas; pack de validación Client A (`buildClientValidationPack`) que hoy genera sólo `test-generic.ptx` + manifests y lista la evidencia exacta que falta por archivo.
- 31 tests nuevos (determinismo, digests de perfil/adapter verificados, fail-closed, no-silent-drop de operaciones MPR, identidad de duplicados, manifest sin "latest" implícito); typecheck y suite excel completos verdes. Sin claim de compatibilidad: todo `NOT_TESTED`.
- Corrección de contrato tras review: `SERIALIZER_NOT_IMPLEMENTED` como razón neutral distinta de `FIELD_FORMAT_EVIDENCE_REQUIRED`; SAW/MPR nunca reportan `ready=true` sin serializer real (invariante `ready ⇒ serialize ejecutable` probada en `adapterContract.test.ts`); PTX sin cambios (byte-identical al golden).
## #577 — shared resolved-BOM demand aggregation (partial)

- Added one pure resolved-BOM + physical-quantity batch adapter; the project adapter resolves each item once and delegates without rerunning hardware resolution.
- Whole-collection sheet/package rounding reuses existing metrics/purchase helpers; deterministic output and fail-closed native-unit aggregate guards retain board-only, hardware-only and empty-project semantics.
- Typed two-unit isolation, missing/inactive inputs, overflow and no-partial-output tests pass; existing TS/Go requirement and binding fixtures remain unchanged.
- Go domain and focused race tests, TS domain/parity and domain typecheck pass; the existing unknown-definition-field Go subtest remains schema-layer-only/skipped. Full closing gate and exact-head CI remain required.
- No collection identity/capture, API, storage, operational consumer or machine integration is wired; #577 and F202/ledger remain unchanged. Review mode: disabled/unmanaged.
## #577 — pre-expansion release-unit budget (partial)

- Guard the prepared Go release unit before the existing BOM expansion: at most 10,000 conservative work units across physical boards, hardware rows and agregado repetition; reserve six rows for possible base synthesis.
- Check effective typed/default/static quantities and the referenced structure/component/agregado closure with overflow-safe arithmetic; unrelated catalog records do not block resolution. Existing bounded BOM and non-positive agregado default semantics are preserved.
- Focused release-unit and full Go domain tests pass; the existing unknown-definition-field domain subtest remains skipped because its API envelope owns that proof. No capture, collection, consumers, machine outputs or ledger changes; #577 remains incomplete.

## #577 — strict Go revision-unit resolution, chain unit 4B (partial)

- Resolve one unversioned revision item through the existing BOM engine, preserving physical/definition identity and evaluating typed defaults without mutating inputs.
- Reject unsupported version pins, missing explicit composed dimensions, fixed-module overrides/base synthesis, invalid or competing consumers, relationship bindings and unconsumed material/edge/hardware choices.
- Backend-only pure boundary: tenant/catalog coherence, collection identity checks and resource limits remain caller responsibilities; no capture, API, TS adapter, purchase aggregation or operational consumer is wired.
- Focused negative and same-definition unit tests pass; independent validation, closing full gate and exact-head CI remain required. #577 and the ledger remain open/unchanged.

## #577 — shared component binding preparation, chain unit 4A (partial)

- Extracted the existing Go quantity/condition binding helper without changing authoring behavior; added a TS counterpart keyed by binding kind and component ID, not parameter names.
- Shared fixtures pass evaluated parameters through both existing BOM engines, proving separate same-definition quantities, conditions, dimensions, materials, each engine’s existing physical-ID namespace and unchanged source inputs; invalid scalar/name/range values remain evaluator errors.
- This helper assumes validated definitions, unambiguous consumers and evaluated values. It is not a release gate: strict revision identity/version/dimension/material validation, relationship boundaries, collection aggregation, snapshot capture and operational wiring remain subsequent units.
- No F202/ledger change or #577 closure; independent validation, full gate and exact-head CI remain required.

## #348 — preparación de validación PTX import/readback (entrega parcial)

- Rama: `feat/348-ptx-readback-validation-prep` (desde `main`); no toca #577/#351.
- Auditoría completa del generador PTX (`packages/excel/src/ptxCutPlanExport.ts` + optimizer de dominio) documentada en `docs/machines/ptx-validation.md`: 16 hallazgos (A1–A16) incluyendo formato definido en repo sin verificación de receptor, identidad secuencial, `[CUTS]` derivado de geometría, ausencia de provenance (bomFingerprint/release) y fallbacks silenciosos.
- Fixture sintético congelado `fixture-board-001` r1 (`packages/excel/src/ptxValidationFixture.ts`): 2 materiales, duplicados con identidad distinta, qty 2 con rotación mixta, grano 0/1, kerf 4.4 y deducción de canto no enteras, remanentes. Golden byte-exacto `__fixtures__/ptx/fixture-board-001.ptx` con SHA-256 `544dcae574bc19e19f934f96b2ad1dc104a2d7b1f668262a83ae09df72510f09` fijado en test (drift = falla).
- Expected readback machine-neutral + comparador puro offline `packages/excel/src/ptxReadback.ts` (PASS/WARNING/BLOCKER/UNSUPPORTED_CAPABILITY/NOT_OBSERVABLE; sin estado "VALIDATED" — prueba negativa estructural). Runbook operator-safe, plantilla de evidencia sanitizada (`docs/templates/ptx-readback-evidence-template.md`) y lista de `FIELD_VERIFICATION_REQUIRED`.
- Sin claim de compatibilidad; todos los estados de máquina siguen `NOT_TESTED`. Pendiente para cerrar #348: import real del fixture, readback en software receptor, sign-off del operador.

## #577 — private immutable snapshot schema, chain unit 3 (preparatory)

- CI browser gate synchronization: await the other tab's broadcast-driven logout before an explicit reload, preserving login/no-tenant-data assertions before and after reload; no runtime change or retry. Five repeated real PostgreSQL/browser logout scenarios and all 23 organization browser scenarios pass; closing gates and exact-head CI remain required.
- Additive migration 122 separates owner-only manufacturing payloads from intentionally shared release metadata; composite release/project/owner binding and FORCE RLS protect direct SQL.
- Runtime grants permit only owner SELECT/INSERT; immutable triggers reject UPDATE/DELETE even for privileged writers. Existing releases remain unchanged and receive no backfill.
- Focused real PostgreSQL proofs cover fresh/upgrade/down, shared sales privacy, owner inserts, mismatches and immutability. Capture writes, public endpoints and operational consumers are not wired.
- This does not freeze the live BOM or close #577; full gates, independent validation and exact-head CI remain required. F202 and the ledger are unchanged.

## #577 — coherent tenant transaction foundation, chain unit 2 (preparatory)

- Additive internal opt-in selects repeatable read before tenant setup; ordinary requests retain read committed.
- Borrowed marked transactions must already be repeatable read or serializable; weaker isolation is refused before actor changes or callback execution.
- Real PostgreSQL proofs cover a two-connection committed-edit barrier, borrowing, commit/rollback and same-connection context cleanup. Routes and release capture are not wired yet.
- This does not freeze a production BOM or close #577. Full gate, independent validation and exact-head CI remain publication requirements; F202 and the ledger remain unchanged.

## #577 — immutable release requirements, chain unit 1 (partial)

- Base: `78116f20`; branch: `fix/577-immutable-release-bom`. Existing ledger unchanged.
- Added a pure Go planning-demand adapter reusing the BOM, metrics and hardware-purchase engines; shared TS/Go fixtures cover physical units, board-only demand, sheet waste, edge meters and package rounding.
- Invalid/missing catalog inputs and non-finite demand fail without partial requirement lines. This adapter is not connected to the live release path.
- Typed authoring preparation, coherent immutable capture, canonical consumers and the real browser golden path remain subsequent dependent units; #577 remains open.
- Focused parity/domain tests and typecheck are recorded in the unit implementation report; full gate and remote exact-head CI remain publication requirements.

## DEMO — selected material integrity (bounded correction)

- Base: `84c98698`; branch: `fix/577-demo-release-bom-integrity`.
- Preflight and release now require selected IDs to exist in the owning organization catalog (boards, hardware, edges); unknown legacy roles remain compatible.
- Real PostgreSQL RED: missing/foreign/unavailable board catalog incorrectly returned ready. GREEN: 15 catalog/scenario cases; rejection commits no release or release audit.
- Focused regressions pass; independent validation: 52 top-level tests and 15 PostgreSQL scenarios PASS, zero skips. Full worktree gate and exact-head remote CI must pass before merge.
- This does **not** freeze catalog-derived manufacturing output: immutable released BOM remains P0.
- #577 is closed with its existing approval label; publication requires explicit tracking reconciliation, not inferred issue reopening or approval.
- F202 and prior feature history below remain unchanged.

# Revisión y corrección activa: PR #578 / #577 (entrega parcial)

- Rama: `feat/577-canonical-release-ops-continuity`; correcciones sobre `6744442a`, sin activar otra feature del ledger.
- Corregidos: listado de release más reciente, lector por ID exacto y generación/validación de unidades físicas desde FurnitureInstance liberadas, no cotización mutable.
- Evidencia: suites completas TS y Go sobre PostgreSQL desechable, typecheck, OpenAPI y Chromium real 4/4 PASS. Detalle: `progress/implementation_577_canonical_release_ops.md`.
- Pendientes: catálogo industrial no congelado por release; cobertura de definitionVersion/parámetros; aprobación humana de #577 para publication metadata. Sin merge ni cierre; readback exacto en PR #578. Receipt-driven: `disabled/unmanaged`.

---

# Historial: Ninguna feature activa tras F219 completada

- Actualizado: 2026-09-06 America/Mexico_City
- Última feature: F219 — `[P0][WEB-DT-4] Commercial QuoteRevision lifecycle — create, publish and accept exact revisions` (#571)
- Rama: `feat/571-commercial-quote-revision-lifecycle`
- Estado: `completed` (verificación completa; ver `progress/implementation_571_commercial_quote_revision_lifecycle.md`)
- Logros:
  1. Constraint DB y storage: migración `000121_quote_revision_accepted_uniqueness` (índice único parcial `uq_quote_revisions_one_accepted_per_project`). Endpoints de storage `CreateInitialQuoteRevision`, `PublishQuoteRevision`, y `AcceptQuoteRevision` con serialización transaccional, bloqueo pesimista por proyecto, superseding atómico de revisiones aceptadas previas y eventos de auditoría durables.
  2. API Go generada: `POST /projects/{projectId}/quote-revisions` (creación de Q1 snapshotting estado comercial de quote lines y catálogo), `POST /projects/{projectId}/quote-revisions/{quoteRevisionId}:publish` (draft -> published) y `POST /projects/{projectId}/quote-revisions/{quoteRevisionId}:accept` (published -> accepted con superseding atómico). Gobernado por permiso RBAC `RoleCanAcceptQuoteRevisions`.
  3. UI React: `QuoteLifecyclePanel` y modal de confirmación `AcceptQuoteModal` en `packages/ui/src/digitalThread/ReconciliationCommandPanels.tsx`, integrado en `ProjectReconciliationScreen.tsx`. Botón CTA en estado vacío cuando no existen revisiones, publicación explícita, modal de advertencia para aceptación de Q1/Q2, e histórico de revisiones inmutables.
  4. Desambiguación de estado legacy: `ProjectDetailHeader.tsx` y `ProjectDetailView.tsx` diferencian "Enviar cotización (legacy)" de la autoridad de QuoteRevision del Digital Thread.
  5. E2E browser + PostgreSQL real (`tests/organization/project-reconciliation.spec.ts`): eliminadas todas las mutaciones directas de SQL en el golden path comercial. El test ejecuta Q1 creación -> Q1 publicación -> Q1 aceptación -> requote Q2 -> Q2 publicación -> Q2 aceptación atómica -> aprobación -> release P1 mediante UI/API real sin SQL ni fixtures de bypass.
  6. Rehearsal actualizado: `docs/demo/demo-golden-path-rehearsal-20260906.md` P0-1 cerrado con `PASS`. P0-2 permanece abierto.

---

# Historial previo — F218 (#502 / WEB-DT-3) — Reconciliation, approval and exact ProductionRelease workspace

- Actualizado: 2026-09-06 America/Mexico_City
- Feature: F218 — `[P0][WEB-DT-3] Reconciliation, approval and exact ProductionRelease workspace` (#502)
- Rama: `feat/502-web-dt3-reconciliation-release`
- Estado: `completed` (verificación completa; ver `progress/implementation_502_web_dt3.md`)
- Logros:
  1. Read model mínimo generado: `evaluateDesignRevisionPreflight` (`POST /designs/{designId}/revisions/{revisionId}/preflight`) — la MISMA función de dominio del gate de release (#466/#395, scope `production-release-v1`), sin segundo motor; proofs Go de paridad ready/blocked + fail-closed exact-revision + RLS.
  2. Workspace React `/quotes/:projectId/reconciliacion?qrev=&design=&rev=` con contexto exacto fail-closed, reconciliación #393/#394 verbatim (rows por `furnitureInstanceId`, sin clasificación cliente), requote explícito con modal de review (Q inmutable, conflicto VERSION_CONFLICT tipado), panel de preflight autoritativo, aprobación de revisión exacta, ProductionRelease con propuesta + pins exactos e historial durable (R2 nunca retargeta P1).
  3. E2E browser + PostgreSQL real (`tests/organization/project-reconciliation.spec.ts`): golden path quote-first con qty>1 + design-first, requote → Q2, conflicto stale, aprobación, release P1 (Q2+R1), durabilidad tras R2, failure rollback y tenant isolation.
  4. `#499 Web↔SketchUp handoff: DEFERRED`; `#503: DEFERRED`. Sin Ruby/SketchUp/machines/DXF.
  5. Limitación de demo documentada: no hay API para crear/aceptar la primera QuoteRevision — el fixture siembra Q1 accepted por SQL (rol migration), misma convención que el suite Go.

---

# Historial previo — Demo Golden Path Rehearsal post-#502 (2026-09-06)

- Ejecutado sobre `main` `79f45b28` (post-PR #569; #500/#501/#502 integrados). Reporte completo: `docs/demo/demo-golden-path-rehearsal-20260906.md`.
- Verdict: **DEMO READY: YES WITH MITIGATIONS**. 2 P0: (1) lifecycle comercial `quote_revisions` sin superficie HTTP/UI (cerrado en F219); (2) el ProductionRelease canónico no habilita el tramo operacional Web (blob legacy `project.productionRelease` gobierna `canDerive`/derivación → doble liberación legacy en guion).
- Evidencia fresca en este SHA: browser gate #500/#501/#502 **5/5 (40.3 s)** sobre Chromium+Go+PostgreSQL efímero; TestUp real host `TC_ComponentAuthoringSmoke` **5/5, 48 assertions, 0F/0E/0S** (`progress/host_smoke_467_testup_ci.json`, 2026-09-06T14:11:40Z); `GOFLAGS='-p=1' go test ./... -count=1` 11/11 packages `ok`; `pnpm openapi:check`/`typecheck`/`test` verde.

---

# Historial previo — F217 (#501 / WEB-DT-2) — Designs, immutable revisions and 3D artifact history
- Logros:
  1. Pure model & algorithms: `designHistory.ts` + `designHistory.test.ts` (14/14 tests) con linaje inmutable $R1 \to R2 \to R3$, resolución de release activo, selección exacta de revisión snapshot, mapeo de artefactos y formateadores.
  2. Workspace React `ProjectDesignsScreen.tsx` + `ProjectDesignsScreen.test.tsx` (9/9 tests) con alternativas en `WorkspaceTabs`, línea de tiempo inmutable con insignias de estado, visualización pineada de ítems y parámetros de revisión, visor 3D con grants firmados, tabla de artefactos con hashes SHA-256 y descarga por grants, drawer de auditoría técnica y estados vacíos honestos.
  3. Tokens de diseño limpios en `digitalThread.css` sin hex no autorizados ni tokens inexistentes.
  4. Ruteo y deep-linking en `routes.ts` + `routes.test.ts` (`/quotes/:id/disenos?design=&rev=`).
  5. Navegación cruzada en `ShellView.tsx`, `ProjectsScreen.tsx`, `ProjectDetailView.tsx` y `ProjectFurnitureScreen.tsx`.
  6. Negative proofs: R1 pineado nunca muta a R4; el browser jamás parsea `.skp`; los grants de descarga van firmados por backend sin JWT en query strings; handoff #499 diferido explícitamente (`#499 Web↔SketchUp handoff: DEFERRED`).
  7. Verificación completa: `pnpm typecheck` verde (7/7 proyectos), `pnpm test` verde (UI 1552 tests, Web 419 tests), `pnpm openapi:check` verde.

---

# Historial previo — F216 (#500 / WEB-DT-1) — Project Furniture matrix and physical-unit traceability

- Actualizado: 2026-09-05 America/Mexico_City
- Feature: F216 — `[P0][WEB-DT-1] Project Furniture matrix and physical-unit traceability`
- Rama: `feat/500-web-dt1-project-furniture-matrix` (PR #565 mergeado en `main@3a8f12aa`)
- Estado: `completed` (verificación completa; ver `progress/implementation_500_web_dt1.md`)

## Historial previo — Regression pass Demo Golden Path (2026-09-05)

- Ejecutado sobre `main` `587961fd` (clean, con merges #559/#562/#564). Reporte: `docs/demo-golden-path-readiness-20260905.md`.
- Resultado: **0 demo blockers**; Digital Thread E2E 9/9, Foundation browser gate 17/17, engine/golden authoring verde, `pnpm test`/typecheck/openapi verde. Los 3 defectos históricos de la auditoría 360 (DXF rotado, FM-03 order-dependence, template roundtrip) siguen reproduciéndose en el resolver TS legacy — POST-DEMO, no tocan la ruta autoritativa Go/SketchUp.
- Primary gap: superficies React #500/#501/#502 (backend completo, sin UI). **Recommended next issue: #500.**

---

# Historial previo — F215 (#467 / SU-AUTH-1) — Direct internal component authoring with semantic constraints

- Actualizado: 2026-09-05 10:30 America/Mexico_City
- Feature: F215 — `[P0][SU-AUTH-1] Direct internal component authoring with semantic constraints`
- Rama: `feat/466-authoritative-preflight-review` (PR #562)
- Estado: `completed` (con corrección final de autoridad aplicada)
- Logros (corrección final de autoridad incluida):
  1. **Autoridad de topología**: el plugin YA NO construye/filtra relationships — eco verbatim del último set aceptado en move/add/duplicate y OMISIÓN en remove; el motor materializa/limpia identidades de relación y machining dependiente (`materializeBoundRelationships`, probado en 6 tests Go de autoridad).
  2. **Identidad productiva (diseño A canónico)**: el contrato #477 exige `componentInstanceId` propuesto por cliente por ocurrencia (REQUEST_INVALID si falta, OCCURRENCE_DUPLICATE_ID en colisión, eco verbatim en golden 03) — el plugin propone `ci-*` y el host se guía por el eco ACEPTADO: render, metadata y SELECCIÓN usan el id aceptado (regla: draft si el eco lo conserva; si no, la ocurrencia aceptada de la misma definición con la transform pedida; si no, el id añadido al set base). Prueba draft≠accepted en unit (double que renombra) y real-host (golden re-identifica).
  3. **Capability explícita del engine**: `LayoutComponent.authoringCapability {movable, axis}` publicada por el motor (regla movible unificada `movableInternal()` en authoringTemplateIndex, índice always-on también en GET layout) para internos movibles sólo; el guard del plugin y el CapabilityPolicy consumen esa capability (fail-closed en ausencia), y el Tool de viewport arrastra SOLO el eje publicado.
  4. **Rango = autoridad del servidor**: el plugin valida sólo forma de transporte (3 mm finitos); el motor rechaza traslaciones fuera del envelope [0,W]×[0,D]×[0,H] con TRANSFORM_INVALID (nuevo `validateOccurrenceRanges`, escenario dorado `neg-shelf-out-of-range`, ceiling grueso 2400mm en TS para paridad de rechazo).
  5. **Contratos**: schema JSON (`$defs.resolvedLayoutComponent.authoringCapability`, cerrado), tipos/validador TS (`ResolvedLayoutWireV1`, keys, validateResolvedLayout), golden regenerado (33 escenarios; capability en layouts del entrepaño), Ruby LayoutContract parsea la capability con fail-closed.
  6. **Verificación completa**: Go `go test ./...` verde; TS 1245 tests + typecheck verde; extension 601 unit/4246 assertions, boundary 6, RuboCop 161/0, RBZ determinista `e709e30c…`; **TestUp real-host (RBZ instalado, SketchUp 2026): Success 5/5, 48 assertions, 0F/0E/0S** con guards semánticos del request (sin relationshipId client-minted, intent correcto, shelfCount consistente) y pruebas de identidad aceptada (add/duplicate seleccionan shelf-02 aceptado, no el draft) — evidencia sanitizada sin paths privados: `progress/host_smoke_467_testup_ci.json`.
  7. **Cleanup final transform/eje/rango**: ecos y poses persistidas usan la pose autoritativa #414 `localTransform.translationMm` (`board.translation`), jamás el AABB (prueba negativa con basis rotada donde AABB.min ≠ pose, en echo y metadata); el Tool commitea/etiqueta SOLO el eje publicado con mapeo explícito x→0/y→1/z→2 (tests por eje, eje inválido falla antes de iniciar, Esc no commitea); el techo arbitrario de 2400mm se eliminó de TS (transporte = sólo forma: 3 números finitos; un request z=5000 pasa TS y Go lo evalúa contra el envelope real de 720mm); el escenario neg de rango salió del golden compartido (validez posicional 100% server-side).
  8. **Preservación de dependencias en remove**: remove hace eco VERBATIM del último set de relaciones aceptado (incluida la anclada al entrepaño eliminado) y el servidor poda autoritativamente los anchors stale-by-removal conservando las relaciones independientes EXACTAS con su machining/provenance (`pruneRemovedAnchorRelationships` gated a snapshot; sin snapshot el anchor fantasma sigue rechazando RELATIONSHIP_ORPHANED; golden 07/neg-orphan ahora sin components; carve-out justificado en el harness de paridad TS; prueba requerida `TestAuthoringAuthorityRemovePreservesUnrelatedRelationships` + unit Ruby con set sembrado + smoke real-host con eco sin filtrar).

## Historial previo — F214 (#466 / SU-UX-1) — Authoritative preflight review with viewport problem navigation

- Feature: F214 — `[P0][SU-UX-1] Authoritative preflight review with viewport problem navigation`
- Rama: `feat/466-authoritative-preflight-review`
- Estado: `completed` (detalle en git history; publish gate design-wide de #392 incluido)

## Historial previo — F213 (#468 / SU-AUTH-2)

- #468 implementada y verificada:
  Interactive HardwarePlacement editing and smart hardware substitution.

## Historial previo — #498 (SU-HOST-1)

- #498 implementada y mergeada a main (PR #555, merge `dfa6f348`):
  Shared host interaction orchestration for atomic authoring and degraded states.


## Historial previo — F211 (#398 / DT-14)

- #398 implementada y mergeada a main (PR #554, merge `77b1ead8`):
  End-to-End Digital Thread Contract & Regression Gate.


## Historial previo — #393 DT-9

- #393 implementada y mergeada a main (PR #549, merge `316df57c`):
  reconciliación pura y determinística entre QuoteRevision y DesignRevision
  unidas estrictamente por `FurnitureInstance.id` con estados canónicos
  `synced`, `quoted_not_modeled`, `modeled_not_quoted`, `modified`, `removed`,
  `conflict`, diferencias estructuradas normalizadas y writer atómico con
  optimistic concurrency fail-closed. Detalle: `progress/implementation_393_dt9.md`.

## Historial previo — #392 DT-8

- #392 implementada y mergeada a main (PR #548): publicación escalonada de DesignRevision
  inmutable con manifiesto y artefactos 3D. Detalle: `progress/implementation_392_dt8.md`.

## Historial previo — F202/#460 Organization Foundation P0

- Actualizado: 2026-09-02 America/Mexico_City
- F199 (#458) cerrada (`done`); ninguna otra feature `in_progress` salvo F202.
- F202 y #460 continúan abiertos. SEC-1, SEC-2A/B (PR #528), SEC-3 (PR #530),
  SEC-4A (PR #531), SEC-4B, SEC-5 y SEC-6 (PR #534, merge `f5d59a46`) están
  integrados; **SEC-7** (MFA TOTP + step-up para acciones sensibles) está integrado
  en `main` por PR #535 (merge `355be4ea`).
- Roadmap restante: SEC-8 trusted-proxy/rate limits distribuidos/account
  hardening, SEC-9 gate final + ver4 EOL.

## SEC-7 — qué se implementó

### Modelo y storage (migration 000109)

- `auth_mfa_factors`: factor TOTP por usuario, `pending → enabled → revoked`;
  secreto AES-256-GCM (nonce‖ciphertext‖tag) kid-pinned; `pending_expires_at`
  terminal; `last_used_counter` high-water de replay; CHECKs de shape.
- `auth_mfa_recovery_codes`: 10 verificadores HMAC-SHA256 (nunca plaintext),
  `used_at`/`revoked_at` single-use por UPDATE condicional.
- `auth_step_up_grants`: autoridad server-side (sid, user, scope, method,
  expiración ≤10 min); freshness joinea la fila viva de `auth_sessions` (la
  revocación corta el grant sin cleanup); S2 nunca hereda (sid distinto).
- `auth_sessions.step_up_at` (reservada en 000105) se mantiene como hint de
  frescura; los grants son la autoridad por scope.
- RLS platform-global self-or-platform en las tres tablas + registro en
  `rls_policy_inventory`; sin DELETE (revocación/uso son UPDATE; grants
  expiran solos).

### Crypto

- Keyring dedicado `MFA_ENCRYPTION_KEYS` (`{"active_kid","keys":{kid:base64}}`)
  o `MFA_ENCRYPTION_KEY` single (kid `primary`); ≥32 bytes; boot fail-closed
  (LoadConfig) igual que REFRESH_TOKEN_PEPPER. Subkeys por propósito vía
  HKDF-SHA256 (AEAD TOTP vs HMAC recovery no cruzan). Rotación: active kid
  sella lo nuevo; quitar un kid fail-closed su material.
- TOTP RFC 6238 (SHA1/6/30, ventana ±1) con vectores del RFC; replay
  protection atómica (counter aceptado una sola vez, incluso concurrente).
- Disjunto de JWT/refresh/media/device secrets por construcción.

### API y boundaries

- Endpoints (`/api/auth/mfa/*`, OpenAPI generado sin drift): factors list,
  totp:begin (URI una sola vez), totp/{id}:verify (habilita + recovery),
  factors/{id}:remove y recovery-codes:regenerate (security_admin step-up),
  step-up (un scope por verificación).
- `RequireStepUp(scope)` corre DESPUÉS de auth/platform y ANTES del wrapper de
  idempotencia: el challenge no consume la `Idempotency-Key`; el reintento
  verificado reutiliza la misma key (proof HTTP + browser).
- 403 tipado (nunca 401): `MFA_REQUIRED` (sin factor; sin bypass — enrollment
  exige TOTP vivo), `STEP_UP_REQUIRED` (+`details.scope`), `STEP_UP_EXPIRED`.
- Comandos protegidos: devices approve (device_enrollment), support entry
  (support_access), MFA remove/regenerate (security_admin), team
  change-roles/transfer-admin/offboard/revoke-sessions (organization_admin),
  org lifecycle + entitlements + set-account-status (platform_admin).
  Documentado: password change no existe aún (deberá nacer con step-up);
  self-revoke/revocación de dispositivo propio/suspend memberships quedan en
  su boundary (bajo impacto o reversibles); MFA obligatoria para admins NO se
  fuerza aún (decision de rollout para SEC-8/9; MFA_REQUIRED es la mecánica).
- Rate limiting por usuario+propósito: 5 fallos, refill 1/min, éxitos gratis
  (in-memory; SEC-8 lo distribuye). Auditoría `mfa_*`/`step_up_*` sin material
  secreto (proof de redacción en storage+HTTP).

### Web / Mobile

- `SecurityScreen` (`/security`, nav base para todo rol): wizard enrollment
  (QR en memoria + clave manual), verificación, recovery codes one-time
  (copiar/guardar), regenerar y eliminar factor con step-up.
- `useStepUp` + `StepUpModal`: modal ligado a la acción exacta ("Confirma tu
  identidad"), reintento del MISMO comando con la misma Idempotency-Key, sin
  retry global automático; hint MFA_REQUIRED → Seguridad. Nada MFA toca
  localStorage/sessionStorage/IndexedDB.
- Wiring: DevicesScreen (approve), UsersScreen (roles/transfer/offboard/
  revoke-sessions), PlatformScreen (support + account status),
  OrganizationLifecyclePanel (suspend/reactivate/terminate/begin-offboarding).
- Mobile: 403 STEP_UP se superficie como DomainError con code y NUNCA entra al
  path de refresh (regression proof).

## Evidencia ejecutada

- `GOFLAGS='-p=1' go test ./... -count=1`: verde (crypto/TOTP unit, storage
  PostgreSQL: migration fresh+upgrade, lifecycle, replay CON concurrencia,
  recovery single-use CON concurrencia, TTL/binding/scopes/revocación, RLS,
  redacción de audit; api: boundaries tipados, ver4 no elevable, fail-closed
  sin keyring; pilotreadiness HTTP real: enrollment, challenge+retry misma
  key, enrollment expirado post-MFA, scope isolation, TTL, session
  replacement, recovery+management, rate limit, redacción).
- `pnpm openapi:check`: sin drift. `pnpm typecheck`: verde.
- `pnpm test` (monorepo): verde (UI 1503 incl. SecurityScreen/stepUp/
  DevicesScreen challenge; mobile 6/6 apiClient).
- `scripts/organization-browser-gate.sh`: PASS con `mfa.spec.ts` (enrollment
  QR+manual, recovery one-time, STEP_UP_REQUIRED → verificación → mismo
  comando prospera, sin secretos MFA en storage).
- `scripts/smoke-deploy.sh`: 31/31 (con `MFA_ENCRYPTION_KEYS` añadida a la
  validación de compose y a `.env.production.example`).
- `git diff --check`: limpio.

## Decisiones documentadas

- ADR-0007 §12 (SEC-7) + status; organization-foundation-v2 §13 actualizado;
  `.env.example`/`docker-compose.prod.yml`/gates con el nuevo secreto.

## Estado de entrega

SEC-6 y SEC-7 integrados en `main`. F202 sigue `in_progress` y #460 sigue
abierto porque SEC-8/SEC-9 están pendientes. Roadmap restante explícito:
SEC-8 trusted-proxy/rate limits/account hardening, SEC-9 gate final + ver4
EOL.


## Coordinación activa — #461 mínimo para Gate A

- Rama: `feat/461-gate-a-durable-audit`, base `main@355be4ea`.
- Alcance: acoplar login/session creation, select-org y platform org patch a
  `security_audit_events` durable en la misma transacción; versión/correlación y
  RLS org-less mínimos; pruebas PostgreSQL de rollback.
- Fuera de alcance: #461 completo, outbox sin consumidor, Gate B, SEC-8/9 y #385.

## Foundation Gate A #462 — GREEN

- `pnpm gate:foundation:a`: PASS sobre PostgreSQL 16 fresh + upgrade fixtures,
  roles migration/runtime separados (`NOBYPASSRLS`), Go HTTP/auth/MFA y
  Chromium real.
- Coverage final: 34/34 (`progress/gate_a_462_coverage.md`); 22 proofs
  existentes reutilizados y sólo los 12 gaps exactos implementados.
- Durable audit: conserva `security_audit_events` como autoridad; failure
  injection prueba rollback de mutación crítica. No se agregó outbox sin
  consumidor.
- #460/F202 continúa `in_progress` por SEC-8/SEC-9; #461 completo y Gate B
  siguen pendientes.
- **#385 DT-1 may start.**

## F204 — #385 DT-1: identidad estable de FurnitureInstance (COMPLETE)

- Primera familia persistente post-Gate A. `furniture_instances`
  (migration 000111): una identidad estable por unidad física, project-owned,
  con provenance server-authoritative (`quote|design|manual|import|duplicate`),
  lifecycle terminal (`active|removed|cancelled`) y versionado optimista.
- RLS `explicitly-shared` + inventory + trigger de ownership + grants sin
  DELETE desde la primera migración; fresh + upgrade fixture verdes.
- API generada: `GET/POST /api/projects/{projectId}/furniture-instances`,
  `POST /api/furniture-instances/{instanceId}:remove`; idempotency durable en
  create/remove; audit `furniture_instance_created/removed` en la misma
  transacción tenant.
- Pruebas PostgreSQL real: identidad independiente (dos comandos idénticos →
  dos IDs), cross-project rechazado, cross-org bloqueado con rol app incluso
  sin filtro de tenant, projectId random → 404, retry no duplica identidad.
- Detalle: `progress/implementation_385_dt1.md`. NO implementado: #386, #387,
  SketchUp, reconciliation, release, machining.

## F205 — #386 DT-2: QuoteLine ↔ FurnitureInstance (COMPLETE)

- Segunda familia persistente post-Gate A. `quote_line_furniture_instances`
  (migration 000112): relación explícita línea comercial ↔ unidades físicas.
  Representación equivalente permitida por §4 del contrato digital-thread:
  QuoteLine = `project_items`, aceptación = `projects.status`
  (accepted/produced); sin modelo comercial paralelo.
- `quantity=N` materializa N identidades únicas (`origin='quote'`, reutiliza
  `CreateFurnitureInstance` de #385); idempotente por convergencia con
  advisory lock por línea (concurrencia exacta); increase preserva IDs y agrega
  sólo delta; decrease en draft retira las más nuevas con lifecycle terminal
  `cancelled` y **nunca recicla IDs** (hook de historia durable documentado
  para #387+).
- Inmutabilidad de aceptada en tres capas: error tipado `ErrQuoteRevisionAccepted`
  (409) en storage/API; policies RLS INSERT/DELETE con
  `app_project_quote_mutable` + org dueña (bloquea SQL directo); guards tipados
  contra eliminar/dropear líneas materializadas vía PUT de proyecto (FK
  compuesta deferible como backstop estructural; cross-project imposible).
- API generada: `GET /api/projects/{projectId}/quote-lines/{quoteLineId}/furniture-instances`,
  `POST .../quote-lines/{quoteLineId}:materialize` (idempotency durable, sin
  body: identidad server-authoritative). Audit `quote_line_furniture_materialized`
  en la misma transacción.
- Fix contenido de deuda preexistente desbloqueado por este trabajo:
  `loadProjectItems` bufferea items antes de las queries anidadas de choices
  (fallaba `conn busy` dentro de la tx de tenant del middleware).
- Detalle: `progress/implementation_386_dt2.md`. NO implementado: #387,
  #388 re-quote, SketchUp, reconciliation (#392), release, machining.
  **#387 DT-3 may start.**
