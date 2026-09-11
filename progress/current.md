# Issue #642 — Slice 2a: exact QuoteRevision authority in quote detail

- Base `origin/main@ad8865e132c0d319324f34aa50505dd8149c7c48`; branch
  `feat/642-quote-revision-consumers`; partial PR #653; issue remains open.
- Bounded partition: authenticated Cotizaciones detail only. Identity, status,
  totals and lifecycle navigation use the accepted (otherwise newest exact)
  QuoteRevision snapshot; missing/legacy authority fails closed.
- Remaining list/dashboard/operations consumers stay inventoried for Slice 2b;
  PDF/XLSX/export handlers remain Slice 3. See implementation report.

# Issue #642 — [P1][QUOTE-AUTH] Slice 1: immutable commercial snapshot authority

- Inicio: 2026-09-10 (autoinstrucción humana "Start ONLY with SLICE 1"). Issue OPEN
  pero SIN label `status:approved` al iniciar (#640/#641 lo tienen): flag pendiente
  para el preflight de publicación del PR.
- Base exacta `origin/main@b3efd4191526010e440aafe20e80378f21615161`; rama
  `feat/642-quote-commercial-snapshot`. Single writer GLM. Sin merge ni cierre.
- Alcance Slice 1 ONLY: snapshot comercial inmutable por QuoteRevision
  (`granete.quote-commercial-snapshot.v1`), timestamps de lifecycle reales
  (published_at/accepted_at), fail-closed legacy, RLS/trigger hardening, API
  generada. NO reescribe Cotizaciones/dashboard/PDF/XLSX (Slices 2–3).
- Plan: (1) authority map + consumer inventory; (2) sección de arquitectura en
  digital-thread doc; (3) migración 000130 aditiva; (4) dominio/storage/API;
 (5) proofs PostgreSQL real; (6) PR parcial `Refs #642` + STOP.
- Preflight init.sh: PASS (2026-09-10).
- Resultado: `IMPLEMENTED_PENDING_REVIEW`. Snapshot congelado en la MISMA tx de
  creación (Q1 live editable state; Q2+ sintetizado por unidad activa del draft),
  published_at/accepted_at por transición exacta, fail-closed legacy en
  publish/lectura (comando + trigger DB), redacción de costos para actores sin
  permiso, migración fresh+upgrade+down, OpenAPI regenerado sin drift.
- Evidencia: `go test ./... -count=1` 10/10 ok (storage 316s sobre PostgreSQL
  real, cero skips); focused snapshot 10/10 (14 proofs); API quote surfaces
  PASS; `pnpm openapi:check`/`typecheck` PASS; `pnpm test` verde (UI 1690, Web
  442, Mobile 73, Desktop 17); browser gate golden path ver reporte.
- Detalle: `progress/implementation_642_quote_commercial_snapshot.md`.
- Publicación (2026-09-10): owner autorizó label `status:approved` + excepción
  de tamaño documentada en la issue; PR parcial `Refs #642` publicado con label
  único `type:feature`. Sin merge ni cierre; revisión independiente pendiente.

# Issue #642 — PR #649 correction round

- Corrección autorizada sobre `feat/642-quote-commercial-snapshot`, head inicial
  `466174572c43742d089ecb79a56606e40f6f008d`, base
  `b3efd4191526010e440aafe20e80378f21615161`; worktree limpio verificado.
- Inicio: 2026-09-10. El owner autorizó resolver todos los bloqueos y la
  excepción real de tamaño >1000; no autoriza nuevo PR, merge, cierre,
  autoaprobación ni cambios de metadata GitHub.
- Plan: (1) completar autoridad comercial por QuoteLine y cantidad; (2) hacer
  real el upgrade fixture pre-000130 y endurecer INSERT; (3) fallar cerrado en
  descriptores sin label y ordenar opciones; (4) probar replay HTTP exacto del
  payload extendido; (5) regenerar OpenAPI, documentar §16A y verificar gates.
- Resultado: `IMPLEMENTED_PENDING_REVIEW`. Snapshot v1 ahora conserva
  `quoteLineId`, quantity, FurnitureInstanceIds y montos autoritativos por línea;
  create/lifecycle/requote/list/detail devuelven la misma autoridad generada.
  Descriptores ausentes fallan tipado, opciones/bytes son deterministas y la
  redacción cubre costos por línea. Migración upgrade siembra legado antes de
  000130, preserva status/identidad/NULL honestos, prueba down/replay/FORCE RLS
  y bloquea INSERT app-role inválido. Replay HTTP exacto probado.
- Evidencia de corrección: domain + 13 tests storage `TestQuoteCommercialSnapshot*`
  + API quote enfocada PASS; OpenAPI check/typecheck PASS; browser gate real
  Chromium+Go+PostgreSQL 4/4 PASS (29.5 s). Full Go exacto PASS (storage 336.081 s; pilotreadiness 235.452 s).

# Issue #642 — PR #649 second focused correction

- Inicio: 2026-09-10 sobre head exacto
  `85beb97683b405481e98328cd4e5b9b92ea49c4f`; misma rama/PR, sin merge,
  cierre, autoaprobación ni cambios de labels.
- Alcance: bloquear TODO INSERT NULL posterior a 000130 sin alterar las filas
  legacy pre-migración; validar semántica monetaria y sumas en PostgreSQL;
  impedir publish de bytes corruptos; cerrar inferencia de labor fijo en la
  proyección cost-blind; sincronizar contrato/evidencia.
- Resultado: nuevos INSERT requieren snapshot canónico draft; legado existente
  conserva NULL y continúa fail-closed. Breakdown y amounts vacíos o
  irreconciliables son inválidos en DB. La proyección sin permiso mantiene el
  total comercial y oculta todos los montos de línea, incluido line salePrice.
- Evidencia enfocada: migración fresh/upgrade/down/replay, app-role NULL/corrupt
  y API non-inference PASS. Ver reporte de implementación para gates finales.

# Issue #641 — Design inspector async and accessibility correction

- Corrección autorizada sobre PR #648, rama `fix/641-design-inspector-async-a11y`,
  desde head exacto `5b9592aef900dbef273fb7b90627da4475e832fa` y base
  `a20bc412bff0e4f6579d690385f7d40bec5658ea`. Excepción de tamaño ya autorizada.
- Inicio: 2026-09-10 09:20 CST. Sin nuevo PR, merge, cierre, autoaprobación ni
  cambios de metadata GitHub.
- Plan ejecutado: (1) distinguir carga inicial, cache stale y ausencia honesta;
  (2) preservar error/reintento antes del empty de revisiones; (3) aplicar tokens
  e iconografía normativa; (4) ejecutar tests UI, typecheck y browser gate real;
  (5) diagnosticar el timeout Go sin ampliar alcance.
- Resultado: `IMPLEMENTED_PENDING_REVIEW`. Detalle en
  `progress/implementation_641_design_inspector_async_a11y.md`.

# Issue #640 — [P1][WEB-DT] Authoritative availability and integrity for DesignRevision artifacts

- Aprobada para ejecución (execution prompt GLM MAX; issue OPEN). Base exacta `origin/main@fde538a839a7b882657fafbfe41bbdd1cf91fbee` (post-merge #636/#638/#646); rama `feat/640-design-artifact-health`. Single writer: GLM. Sin merge ni cierre.
- Estado: `IMPLEMENTED_PENDING_REVIEW` (corrección R1 de revisión aplicada).
- Entrega: salud autoritativa `available|missing|integrity_mismatch` observada del storage (clasificador puro en domain + verificador streaming SHA-256 en la capa API dueña de `MediaDir`), expuesta como `health {status, checked_at}` en el read model de artefactos y el revision detail; autorización de grants fail-closed con errores tipados `ARTIFACT_MISSING` / `ARTIFACT_INTEGRITY_MISMATCH` (409) verificados DESPUÉS de la resolución tenant (cross-org sigue 404 neutral); OpenAPI Go/TS regenerado sin drift; UI con estados honestos por artefacto (incl. loading/request-failed con retry), acceso deshabilitado para no-available, preview missing/mismatch sin round-trip fallido, recovery que nombra publicar nueva revisión vía `Abrir en SketchUp`, digest canónico `sha256-<64hex>` con un solo prefijo y digest completo copiable con label accesible. #636 intacto (misma URL/grant mechanism, sin segundo store, sin URLs públicas). `processing/failed` NO agregados (sin lifecycle persistido que los avale).
- Evidencia: `go test ./... -count=1` verde (incl. storage PostgreSQL real); focus domain 8/8 matriz, API 5 suites sobre filesystem real; `pnpm openapi:check` PASS; UI 39/39 + 18/18; browser gate real Chromium+Go+PostgreSQL `project-designs.spec.ts` 2/2 PASS (escenarios healthy / bytes borrados→missing+409 tipado+UI honesta / bytes alterados→integrity_mismatch+409 tipado+digest original intacto). Detalle: `progress/implementation_640_design_artifact_health.md`. Revisión independiente read-only: CHANGES_REQUIRED → corrección R1 aplicada (approve endpoints ahora emiten health válido con regresión, short-circuit por size implementado, riesgos residuales TOCTOU/partición documentados, NITs revertidos/limpiados); suites completas re-verificadas verde.

# Issue #644 — [P0][DEMO] Golden path regression: Quote → SketchUp → DesignRevision → ProductionRelease

- Verification lane (`status:approved`). Rama `test/644-demo-golden-path-regression`, integrada con base exacta `origin/main@fde538a839a7b882657fafbfe41bbdd1cf91fbee` mediante merge `b2dde534cd7e3fd264283e2d55adbbf2d54ebb4d`. Test-only: **cero archivos de producto**.
- Entrega: `tests/organization/demo-golden-path.spec.ts` — un fixture canónico de cocina determinística (línea qty=2 con choices citadas reales + línea qty=1) que recorre las 10 etapas del DEMO sobre el stack real: Q1 accepted → materialización (ids físicos distintos) → Design base null → pairing extension-credential confirmed → working copy (#625 integer-or-omitted) → R1 multipart #633 source=sketchup → artifact grants #636 (`/api/design-artifacts/`, sin `/api/api`) → R2 con R1 inmutable → approval con gate #502 (rechaza Q1 desactualizada, requote Q2, acepta, aprueba R2 vs Q2) → ProductionRelease con frozen routing v2 y unidades `${release}:${instance}:u1`.
- Evidencia de corrección post-#639: gate enfocado real Chromium+Go+PostgreSQL 10/10 PASS; gate completo 36 PASS, 2 timeouts ajenos, 3 no ejecutados tras fallo serial; `git diff --check` limpio.
- Observaciones registradas (no se corrigen aquí): FOUND_DOUBLE_TRUTH — `QuoteRevision.status=accepted` convive con `Project.status=draft` hasta un save legacy separado para etapas operativas; Q1 snapshot SÍ congela `materialChoices` en main actual; provenance de materiales SIN pérdida en flujo quote-first fresco (12/12 superficies exactas) — #637 queda como lane de reparación para unidades pre-#621.
- SketchUp-host con licencia sigue RUBY CONTRACT / NOT PROVEN en CI (programa real-host: #354).
- Detalle: `progress/implementation_644_demo_golden_path_regression.md`.
# Issue #639 — immutable DesignRevision presentation read model

- Approved (`status:approved`); user-authorized one-PR size exception. Base `origin/main@55399890173e76b3ae30d858ec9a9472bcd78ab1`; branch `fix/639-design-revision-read-model`.
- Started: 2026-09-09 15:00 CST. Scope: immutable human-readable revision descriptors, server-owned material provenance, honest legacy unavailable state, generated API, React presentation and focused proofs. No artifact health, Proyectar convergence, quote exports or `.skp` parsing.
- Plan:
  1. Add additive snapshot/provenance persistence and strict domain contract without backfilling historical revisions.
  2. Build descriptors and actor labels atomically during publication/approval; preserve exact revision selection and RLS/immutability.
  3. Regenerate OpenAPI clients and map frozen/legacy states without handwritten DTOs.
  4. Extract the React revision panel, keep UUIDs inside technical audit, and cover behavior/a11y/responsive presentation.
  5. Run focused backend/storage/UI/browser gates, commit logical units, push and record exact evidence.

# Issue #637 — [P0][BUG][DT-MAT] Repair quoted materials missing from existing working snapshots

- Aprobada (`status:approved`). Base `origin/main@c40618688dd874e80aea8817e4c47e6615a0c3c0`; rama `fix/637-dt-material-provenance-reconcile`.
- Phase 1 (pre-edición): causa raíz verificada — pre-#621 la colocación no sembraba choices y `buildInitialQuoteItems` ponía `{}`; el merge/publish conservan verbatim, así que unidades ya conectadas congelaron `material_choices={}` en working copy y R1–R3 mientras la línea current de cotización sigue llevando la verdad (`project_item_choices`, misma autoridad que #621).
- Entrega: clasificador puro 4 estados (`authored|quoted_missing_from_working|inherited_default|missing_unresolved`) + detección read-only `GET /designs/{id}/working-copy/material-provenance` + comando explícito idempotente `POST /designs/{id}/working-copy/material-choices:reconcile` (fill-only, expected_updated_at, audit durable misma tx, fail-closed). R1–R3 inmutables; R4 es la primera revisión con las choices. OpenAPI/codegen regenerado; Ruby: el plugin relee el working copy reconciliado y el merger lo conserva verbatim (2 pruebas nuevas).
- Evidencia: `go test ./...` verde; PostgreSQL real (matriz completa incl. inmutabilidad R1–R3 + R4); `rake unit boundary` + rubocop verdes; `pnpm openapi:check`/`typecheck`/`test` verdes. Real-host SketchUp smoke: NOT PROVEN.
- Detalle: `progress/implementation_637_dt_material_reconciliation.md`.
- Correction 2026-09-09 18:30 CST: resolver únicamente el bloqueo de contrato de PR #638 declarando `IdempotencyKey` en el POST de reconciliación, regenerando Go/TS y agregando una regresión cliente→header; sin UI ni cambios de dominio/storage.
- Correction evidence: preflight `./init.sh` PASS; después del cambio, storage 191/191, `pnpm openapi:check`, `pnpm typecheck` y `git diff --check` PASS. El cliente generado crea y envía `Idempotency-Key` por defecto.

# Issue #635 — Design artifact URL resolution and browser access

- Approval: GitHub issue #635 is open with `status:approved`; leader handoff authorized implementation only, without PR creation, merge, or issue closure.
- Started: 2026-09-09 16:18:24 CST. Branch `fix/635-design-artifact-url`, exact base `origin/main@c40618688dd874e80aea8817e4c47e6615a0c3c0`.
- Scope: one canonical fail-closed resolver for authorized DesignRevision artifact URLs; preview load error/retry; reliable explicit access after asynchronous authorization; realistic unit/component tests and existing real Go+PostgreSQL browser smoke when feasible. No backend contract/storage/publication, WebGL/SKP viewer, naming/material, or machine-output changes.
- Plan:
  1. Reproduce the `/api/api` URL and silent preview/popup failure paths in focused tests.
  2. Add one canonical resolver and route preview plus explicit artifact access through it.
  3. Surface distinct authorization, byte-load, retry, and blocked-navigation states using existing UI patterns/tokens.
  4. Run focused UI tests, typecheck, relevant Go/PostgreSQL browser smoke, then commit and push one conventional commit.
- Result: `IMPLEMENTED_PENDING_REVIEW`. Canonical same-origin `/api/design-artifacts/` resolution, recoverable preview byte-load failure, and synchronous popup reservation are implemented. Focused 36/36, full UI 1,658/1,658, monorepo typecheck, real Chromium+Go+PostgreSQL artifact smoke 1/1, and diff check pass. See `progress/implementation_635_design_artifact_url.md`.
- Review correction R1: PR #636 review at `81a878d2` requires honest distinct states for authorization, invalid grant, blocked/closed popup, failed navigation, and preview byte-load; specific close-behavior tests; 390/768/1280 captured responsive smoke; and 1.5 icon strokes. Scope remains #635 only; this is the single authorized correction round.
- Review correction: PR #636 `CHANGES_REQUIRED` resolved in the single allowed round. Authorization, invalid grant, popup blocked/closed, navigation, and byte-load states/copy/tests are separate; error icons use 1.5 stroke; six Playwright screenshots cover invalid-grant and byte-load retry states at 390/768/1280. Focused 40/40, full UI 1,662/1,662, typecheck, browser gate 1/1, and diff check pass.

# Issue #630 — SketchUp catalog pin and repeated agregado occurrence identity

- Reported: furniture review before `Publicar diseño` failed on the real three-drawer cabinet. Investigation and local correction were authorized; no PR, merge, issue closure, or protected approval label was authorized.
- Verified causes: project-level `FurnitureInstance.id` values already matched exactly between SketchUp and the backend. Four independent contract defects blocked the same review flow: split catalog revision assembly; duplicate occurrence identity for repeated agregado placements; the Go planner rejecting even the exact unchanged echo of a component template represented by multiple definition entries (the two alacenas); and the Ruby normalized-snapshot parser rejecting the server's optional `placementKind` field (the three-drawer cabinet).
- Local correction: definitions delivery now reuses the exact full-catalog snapshot loader used by authoring resolve; catalog list queries use deterministic total ordering; repeated agregado placements derive authoring and occurrence identity from persisted `ModuleAgregadoInstance.ID`; exact unchanged multi-entry component snapshots are preflighted through the authoritative default expansion while any identity/count/transform change remains fail-closed; Ruby accepts only `manual|derived` for the optional `placementKind` and still rejects unknown fields/values.
- Real-host evidence: after restarting backend and SketchUp 2026 with the installed corrected parser, the real model `Cocina Prueba - copia.skp` ran the authoritative `PreflightReviewSession` for all four managed furniture IDs. `Alacena 1 Puerta Izquierda`, `Alacena 2 Puertas`, `Gabinete Bajo 3 Cajones` and `Gabinete Bajo 2 Puertas` each returned `ready`, zero issues. The real `PublicationPreflightGate` projection was `allowed=true`, `total=4`, `verified=4`, `pending=0`. No publish command was executed.
- Automated evidence: Go API and domain packages pass; storage package compiles; focused Ruby refresh/retry suites pass (36 runs / 131 assertions); the complete authoring-resolve Ruby contract suite passes (43 runs / 462 assertions); complete Ruby/RBZ gate previously passed (638 runs / 4,426 assertions plus 6 boundary runs / 2,531 assertions); monorepo typecheck and TypeScript tests previously passed. The full `./init.sh` run was interrupted while `internal/storage` was still executing after 61 seconds in this checkout, which already contains unrelated untracked migration-reconciliation work; no full-storage green claim is made.
- Runtime: backend restarted from this checkout on port 8080; the corrected Ruby parser is installed in SketchUp 2026 and was loaded by a clean host restart. Changes remain local in the existing dirty checkout; issue #630 is open and unapproved.

# Issue #624 — SketchUp working-copy definition version guard

- Approval: user said `corregimos el 624`; GitHub issue #624 has `status:approved`.
- Started: 2026-09-08 22:40 CST. Branch `codex/fix-624-sketchup-definition-version`, exact base `origin/main@3b2d08539b5d0e3aaf81fc4d6627636398a00fb7`.
- Scope: prevent catalog semver and incompatible historical metadata from reaching the optional integer `definition_version` in confirm-placement and duplicate working-copy payloads; preserve identity, parameters, material choices, transform, locator, full merge, and rollback.
- Plan:
  1. Add RED Ruby regressions for realistic `version: "1.0.0"` placement intent and duplicate metadata.
  2. Add an executable Ruby-to-generated-Go/OpenAPI boundary that rejects arbitrary payloads and proves the corrected payload decodes.
  3. Implement one narrow integer-only normalization at the working-item contract boundary without changing OpenAPI/backend/material behavior.
  4. Run focused Ruby and Go contract tests, `bundle exec rake verify`, `pnpm openapi:check`, then commit, push, and record exact evidence.
- Result: `IMPLEMENTED_PENDING_REVIEW`. One integer-only normalization now protects placement, duplicate metadata fallback, parsed working copies, and final serialization. A shared fixture is produced by Ruby and accepted/rejected through the generated Go request type at the real handler boundary.
- Evidence: RED reproduced in all three Ruby regressions; GREEN focused Ruby (57 runs / 357 assertions), Go API package, `bundle exec rake verify` (632 unit / 4,410 assertions; 6 boundary / 2,531 assertions), `pnpm openapi:check`, and final `./init.sh` all passed. RBZ SHA-256: `0a8913bd37eda3e5df5664714e206c5be701a9128f0b6256258da33b9c5f44e3`.
- Remaining evidence: real SketchUp 2026 installation and save/reopen smoke are pending after review; no real-host claim is inferred from Ruby stubs or RBZ construction.
- Rollback: revert the #624 working-copy version guard, shared fixture, Ruby/Go regressions, and this report together. No migration, OpenAPI change, material logic, UI, or backend production code changed.

# PR #613 / #499 — R3 Actions correction

- Approval: user authorized the minimum correction required to finish #499 correctly; branch `codex/499-plugin-receive-bind`, exact base/head `0897b17a199a4ed013c11c0de59354f5a73b142a`.
- Started: 2026-09-08 America/Bahia_Banderas. Scope: repair the confirmed-terminal close race exposed by Actions in `SketchUpPairingModal`; no Slice 3 redesign, no issue closure or merge.
- Plan: (1) reproduce the focused UI failure, (2) make close decide from the latest authoritative terminal status, (3) run focused UI tests and affected gates, then push/read back.
- Result: the status poll now records the server terminal status before React schedules its render, so Escape/overlay close cannot cancel a grant already confirmed by the plugin. Focused modal test repeated 5/5; full `@granete/ui` suite 158 files / 1,642 tests and workspace typecheck passed. `git diff --check` passed.

## #577 — final golden-path closure (DELIVERED as evidence PR; 2026-09-08)

- Admitted per #573 authorization "#577 final golden-path closure child (executor GLM)" after observing PR #606 MERGED. Child `577/final-golden-path-closure`, branch `codex/577-final-golden-path-closure`, exact base `a64b2d133f3f305fee04b316c8675df5d11dc04d`. Single-writer: GLM (attempt 1/2). No late tokens accepted from prior children.
- **DELIVERED (delta R2, zero product changes)**: mandatory legacy audit complete (report `progress/implementation_577_final_golden_path.md`); post-#606 code already supports the full chain. A single quote-first fixture WITH board choices was tried and honestly discarded: `CreateInitialQuoteRevision` captures definition/parameters but NOT optionChoices (#571 semantics — quote units stay choice-less, classify `modified` against a choices-carrying design and the release commercial gate blocks); the authoritatively supported fixtures were extended instead of changing product architecture. Delta = closure assertions in `tests/organization/project-reconciliation.spec.ts`: production stage without `sentToProductionAt` + physical unit identity (quote-first, 4 instances; `${P1}:${fi}:u1`) and per-unit piece identity (OPS-DT-1 boards; 4 pieces, 2 per unit) + `/engineering` sent-section readback.
- Evidence: browser gate real Chromium+Go+PostgreSQL efímero — focused extended tests 2/2 PASS, full reconciliation spec **4/4 PASS (25.1s)**; `git diff --check` clean. No Go/TS package code touched → full suites not invalidated (last green = #606 on same product code).
- All parent acceptance criteria walked: **PASS** → recommended **#577 READY TO CLOSE AFTER MERGE** (owner review; no auto-close). Documented non-blocking limitation: quote-first flows with board choices remain classified `modified` until requote (Q1 snapshot has no choices; board planning proven design-first).
- Operational note: the shared worktree HEAD was switched twice by another lane mid-child (`codex/sketchup-ux-polish-dialog-states`, `codex/444-proyectar-visual-regression-gate`); this child's commits stayed intact on its own branch and unrelated untracked files were excluded from its commits.

## #577 — frozen manufacturing routing/machining evidence (COMPLETED/MERGED via PR #606; 2026-09-08)

- PR #606 merged 2026-09-08T03:25:27Z, merge commit `a64b2d133f3f305fee04b316c8675df5d11dc04d`. Branch `codex/577-frozen-manufacturing-routing-evidence` lineage: exact base `a27f6aa4aedfad4075711eadb8bd97999cd2761f`, head `5e51bc6861a864c740b6ca97d85d735744190648`. Single-writer: GLM (attempt 1/2). No late tokens accepted from this child anymore. All evidence below remains valid history.
- Admitted per #573 comment 5576289273 after observing PR #604 MERGED.
- **Path B chosen** (extend the existing exact snapshot): schema v2 freezes a machine-NEUTRAL routing program produced by the EXISTING #477 Go engine invoked server-side at P1 time over the definition-default state (no authored occurrences/relationships; catalog component-override hardware placements materialized). No second engine; projectDrilling.ts NOT ported (legacy TS path only); fingerprint v1 semantics unchanged.
- Snapshot v2 payload: `granete.release-manufacturing-program.v1` — per unit `furnitureInstanceId`+`machiningFingerprint`(#477)+`industrialRulesRevision`; per frozen part: cut intent, edge-banding sides, `cncRequired` EXPLICIT resolved verdict, drill operations with holes (face/x/y/Ø/depth/type) + provenance (relationship|manualHardwarePlacement). Table 000122 reused (CHECK schema_version>=1); no new migration; immutability trigger untouched.
- Guard evolution (#604 fail-closed preserved): exact P1/R2/fingerprint → v1 keeps `ErrReleaseRoutingUnavailable`; v2 with routing that re-validates against its own frozen units authorizes the command; v2 corrupt/incomplete → `ErrReleaseSnapshotUnavailable` (409, zero execution).
- Canonical generation is 100% server-side: `PUT /part-executions` with EMPTY body derives PartInstances/ModuleUnits exclusively from the frozen snapshot+routing (`engine.DeriveCanonicalPartExecutions`); client payloads are refused 409; identities `<releaseID>:<furnitureInstanceID>:<partId>:pN` stamped with the exact release; drill→`cnc` station op, cut first, edge op iff frozen sides. Readiness/projection expose `frozen_routing` (batch query, no N+1); the UI blocker surfaces only for v1 releases.
- Evidence: engine `release_routing_test.go` (hardware-driven drilling via real profile table, explicit no-CNC, identity/determinism, fail-closed validation matrix, foreign-host join rejection); storage on real PG `TestOpsDt1_CanonicalExecutionFromFrozenRouting` (freeze v2, byte-identical routing after R4+project/catalog mutation, server-derived generation, idempotent retry, readiness/projection readback, cross-org denial, v1 re-blocked) + updated #604 matrices (v2 allows quality/station, simulated v1 keeps the blanket blocker); API handler tests; FabricScreen v1/v2 card tests; browser gate 4/4 incl. golden R2→P1→frozen routing→exact PartExecutions (Chromium+Go+PostgreSQL efímero). `go test ./...`, `pnpm test`, `pnpm typecheck`, `pnpm openapi:check`, `git diff --check` PASS.
- Authored ~500 production lines + ~570 test/E2E lines (within normal ceiling). No merge, no #577 closure: remaining legs = machine adapters (post-slice, #351 lane), relationship-bound modules still fail-closed at release units, full production-stage golden (materials→warehouse→executions→production) as the final #577 closure proof.

## #577 — part/stage continuity (COMPLETED/MERGED via PR #604; 2026-09-07)

- PR #604 merged 2026-09-07T22:38:39Z, merge commit `a27f6aa4aedfad4075711eadb8bd97999cd2761f`, branch `codex/577-part-stage-continuity` deleted after merge. Lineage preserved: attempt 1/2 Codex (stopped-work attestation, quarantined reservation released), attempt 2/2 GLM (handoff per #573 comment 5575143132, preserved HEAD `15c72be3`); 1,100 authored-line ceiling; all evidence below remains valid history. No late tokens accepted from this child anymore.

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

# Issue #631 — SketchUp multipart publish transport

- Publish retry diagnosis: the first real attempt created a prepared publish session at 2026-09-09 19:43:07 UTC but recorded zero artifacts. The failure was client-side: `HttpAdapter#upload` assigned the IO-like `MultipartBody` to `Net::HTTP#body`, whose send path calls `bytesize`; the resulting programming error was collapsed into the misleading `unreachable` message before any artifact byte reached the backend. The adapter now uses `body_stream`; the dialog also resets the stuck `Publicando…` label to `Reintentar publicación` on failure.
- Publish retry evidence: focused Ruby publisher suite passes (20 runs / 90 assertions), the real dialog JavaScript suite passes (15/15), RuboCop on the changed Ruby files is clean, and the installed adapter passed an in-host SketchUp 2026 loopback upload (`status=201`, expected multipart payload received). The final design publication was not executed.

## PR #646 — correction round 1 for issue #639

- Authorized single correction round against reviewed head `d359ca305b5de0627a765c192795e322c4ed85b4`; same branch/worktree, no GitHub mutations.
- Scope: repair Foundation Gate A semantic selector, cover all four server-owned presentation provenance states, strengthen real-browser descriptor/actor/overflow proof, restore RLS inventory metadata on migration down, complete disclosure interaction tokens/a11y, and correct the documentation typo.
- Verification plan: focused Go migration/provenance tests, focused UI, real project-design browser gate, complete `pnpm gate:foundation:a`, diff check, commit and push exact readback.
- Correction result: `IMPLEMENTED_PENDING_REVIEW`. Focused provenance/migration and UI tests pass; real project-design browser gate passes; full Foundation Gate A passes 34/34 with 31 Chromium cases. See `progress/implement_639_design_revision_read_model.md`.

## PR #645 — issue #644 golden-path correction

- Existing test-only PR updated after #639 landed on `main@fde538a839a7b882657fafbfe41bbdd1cf91fbee`; merge commit `b2dde534cd7e3fd264283e2d55adbbf2d54ebb4d` preserves the complete #639 record above.
- Scope: turn Q1 choices/dimensions and display/working-copy/R1/R2 provenance into failing assertions; assert #639 immutable presentation descriptors; prove a post-R1 catalog rename cannot retarget R1; retain double-truth as an observation.
- The canonical #502 commercial gate rejects R2+Q1, so the executable journey intentionally uses Q2 derived from R2 and documents that correction to issue #644's stale literal.
- Focused real Chromium + Go + PostgreSQL gate: 10/10 PASS. Full organization browser run reached 36 PASS, 2 unrelated route/login visibility timeouts, and 3 skipped after the serial reconciliation failure; see `progress/implementation_644_demo_golden_path_regression.md`.

## PR #647 — issue #640 correction R2

- User-authorized correction on `feat/640-design-artifact-health`, including the cohesive `size:exception` already applied to the PR.
- Scope: enforce owner-partition and immutable integrity pins through signed GET; remove bearer-only artifact reads; add API/app-role RLS and post-mint mutation proofs; fail preview closed on unknown health; repair UI tokens/icons and evidence.
- No merge or issue closure. Delivery remains `IMPLEMENTED_PENDING_REVIEW` after verification and exact remote SHA readback.

## PR #653 — issue #642 Slice 2a review correction

- Cotizaciones now fails closed across loading/error/empty/legacy identity and
  totals states; ready UI uses only exact QuoteRevision snapshot identity,
  currency, quantity and permitted frozen totals.
- WhatsApp resolves the phone by the snapshot customer ID, never the mutable
  Project customer, and lifecycle commands invalidate the shared scoped
  authority key so a return after Q1→Q2 acceptance cannot show cached Q1.
- Evidence: focused UI 82/82; full workspace JS PASS (UI 1695/1695, web
  444/444); typecheck/OpenAPI/diff PASS; real Chromium + Go + PostgreSQL 4/4.
- No merge, issue closure or size-governance mutation. Status remains
  `IMPLEMENTED_PENDING_REVIEW`; see
  `progress/implementation_642_quote_revision_consumers.md`.
- UI DoD rereview added real 390/768/1280 no-overflow/bounded-panel assertions
  and six reviewed screenshots under
  `test-results/issue-642-slice2a-responsive-rereview/`; browser gate 4/4 PASS.
- The original Go job hit the global 600.211 s timeout without an assertion.
  Exact rerun attempt 2 passed (job `103123806142`, 9m51s;
  `internal/storage` 275.163 s), confirming suite-load flakiness with no backend
  change.
