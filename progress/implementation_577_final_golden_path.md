# #577 — final golden-path closure (child `577/final-golden-path-closure`)

- Base exacta: `a64b2d133f3f305fee04b316c8675df5d11dc04d` (main post-PR #606).
- Branch: `codex/577-final-golden-path-closure`. Executor: GLM (single-writer, attempt 1/2).
- Autorización: #573 "#577 final golden-path closure child (executor GLM)".
- Delta clasificado **R2** (evidencia/assertions E2E): **cero cambios de producto**.

## 1. Lifecycle

- PR #606 observado MERGED (`2026-09-08T03:25:27Z`, merge commit `a64b2d13`).
- Child anterior `577/frozen-manufacturing-routing-evidence` marcado
  COMPLETED/MERGED preservando lineage/intentos/evidencia; tokens tardíos
  rechazados. Sin cambios de main posteriores al pin (verificado antes de gates).

## 2. Auditoría obligatoria de seams legacy (post-#606)

| Token | Estado |
|---|---|
| `engineeringLog.sentToProductionAt` | Sólo compatibilidad legacy. `sentToProduction()` trata release canónico como envío a producción (`packages/domain/src/processStage.ts:43`); EngineeringScreen lo muestra sólo en obras legacy. En fixtures canónicos queda null (ahora asertado en browser). |
| `project.productionRelease` (blob OC-022) | Fallback de compatibilidad en `releaseAuthorityOf` cuando la proyección server-side está ausente (modo local); display legacy (ProjectOverviewPanel/ProductionReleaseModal oculto con canónico). Null en fixtures canónicos (asertado). |
| `rev-1` | El fallback de `partExecutionDerivation.ts` ya NO existe. Quedan sólo literales del catálogo piloto y del idempotency default del composition engine legacy TS — fuera de la ruta canónica Go. |
| `latest` implícito | Derive canónico exige `production_release_id` exacto (`validateCanonicalMaterialCommand`; 409 sin id / con id ajeno, probado en browser). Resolución "latest" sólo server-side y pierde ante id exacto. |
| `part_instances` / `module_units` (payload cliente) | Rechazados 409 con release canónico (`HandleGeneratePartExecutions`); generación canónica 100% server-side desde snapshot v2+routing. Path legacy conserva payloads (compatibilidad). |
| `materialsRelease` | Estampado por el comando release del Almacén con gate readiness/override auditado; habilita cola producción (`isProductionReady`). |
| `productionReleaseId` | Reserve/release/derive lo exigen y lo validan contra el release exacto. |
| `designRevisionId` | `requirements.source_design_revision_id` = R2 exacta (asertado). |
| `manufacturingFingerprint` | `requirements.bom_fingerprint` = `release.manufacturing_fingerprint`; routing congelado re-valida contra fingerprint. |

Revisión específica: stage calculation (`processStage.ts`, canonical-aware),
production entry (`isProductionReady` + FabricScreen), part execution advance
(`releasedRevisionFor` → `ResolveProjectReleaseAuthority`), quality
(`guardCanonicalExecutionRouting` compartido #604), React repo/mappers
(`generatePartExecutions` manda arrays vacíos en canónico y aplica readback
autoritativo). Sin seams legacy en la ruta canónica.

## 3. Inspección de alcanzabilidad del golden path

El código post-#606 **ya soporta** la cadena completa. Intento inicial de
fixture único quote-first con demanda de tableros: FALLÓ en reconciliación
(synced 0) porque `CreateInitialQuoteRevision` captura definición y parámetros
pero **no** optionChoices (semántica #571 documentada: "Q1 snapshots dimensions,
not material choices"); una unidad cotizada sin choices vs diseño con choices
clasifica `modified` y el gate comercial bloquea release. Cambiar ese snapshot
sería authority de producto nueva (invalida evidencia #571) — la autorización
exige adaptar el fixture, no la arquitectura.

**Casos autoritativamente soportados** (ya documentados por el slice #604 en el
propio spec): quote-first con demanda de herrajes (test 1) + design-first con
tableros (OPS-DT-1). El delta mínimo fue extender AMBOS fixtures canónicos con
las aserciones de cierre que faltaban, sin tocar producto.

## 4. Delta (assertions únicamente)

`tests/organization/project-reconciliation.spec.ts`:

1. **Test quote-first** (Q1 → Q2/R2 → P1 → warehouse → frozen routing →
   executions): nuevo bloque "Production stage closure": readback del proyecto
   con `engineering_log.sent_to_production_at` null (sin handshake legacy),
   `materials_release.released_at` presente, `production_release` null,
   autoridad canónica `frozen_routing`; identidad física (un
   `${P1}:${furnitureInstance}:u1` por cada una de las 4 instancias liberadas);
   UI `/engineering`: fuera de la cola de ingeniería y visible read-only en
   "Enviadas a producción" (el stage engine trata el release canónico como la
   liberación).
2. **Test OPS-DT-1** (tableros, design-first): cierre de identidad física por
   pieza — unidades `${P1}:${fi}:u1` ↔ instancias materializadas exactas,
   4 piezas totales, 2 por unidad, cada pieza prefijada `${P1}:${fi}:`.

## 5. Evidencia ejecutada

- Browser gate real (Chromium + Go + PostgreSQL efímero, ephemeral DB fresh):
  - Focused: tests extendidos quote-first + OPS-DT-1 **2/2 PASS (17.4s)**.
  - Spec completo `project-reconciliation.spec.ts` (incluye rollback y tenant
    isolation): **4/4 PASS (25.1s)** — `[organization-gate] PASS`.
- `git diff --check`: limpio.
- Sin cambios en Go/TS de paquetes → `go test ./...`, `pnpm test`,
  `pnpm typecheck`, `openapi:check` no invalidados por el delta (política de
  eficiencia #573); su última corrida verde es la del merge #606 sobre la misma
  base de código de producto.

## 6. Evidencia reutilizada (delta no la invalida)

- #601 atomic capture: rollback de derive/snapshot, forged demand, missing
  snapshot, tenant denial.
- #603/#604: guard de ejecuciones canónicas (routing fail-closed), calidad 409,
  PUT aggregate no pisa columnas de ejecución, matrices v1/v2.
- #606: snapshot v2 byte-idempotente tras mutaciones R4+catálogo, generación
  canónica idempotente, cross-org denial, v1 re-bloqueado, engine routing.
- Storage `production_releases_test.go`: canonical > blob legacy (precedencia)
  y control legacy-only.
- #604 quality/station matrices: station ops permitidas sobre v2 (advance de
  ejecuciones opera sobre la identidad exacta).

## 7. Recorrido de acceptance criteria de #577

| Criterio | Veredicto | Evidencia |
|---|---|---|
| Goal: Q2 accepted → R2 approved → P1 → manufacturing/BOM exacto → material planning → warehouse → production sin segunda liberación legacy ni pérdida de provenance | PASS | Test quote-first browser (UI completa) + bloque closure nuevo; blob null; CTA legacy ausente |
| Reusar `ResolveProjectReleaseAuthority` + engine existente (sin segundo engine/fingerprint) | PASS | Todos los consumidores resuelven por la autoridad; #606 Path B reutilizó el engine #477 |
| Read model server-owned canonical/legacy/none; UI diferencia | PASS | `resolved_production_release` (browser aserta source/frozen_routing); fallback legacy en storage tests |
| Material planning: exact `productionReleaseId`; provenance exacta; contenido del snapshot R2 (no `project.items`) | PASS | OPS-DT-1 browser: 409 implícito/ajeno, forged lines overridden, mutación `project.items` no altera demanda; quote-first asierta release/rev/fingerprint |
| Part executions ligadas al release exacto; fallback `rev-1` eliminado; revision guard server-side | PASS | grep limpio; ids `${P1}:...`; 409 a payloads cliente; routing guard en advance/quality |
| Warehouse traza requerimientos/reservas al plan → P1 | PASS | reserve/release con `production_release_id` = P1 (browser, request + readback) |
| UX `Liberación #N · Diseño R2`; CTA legacy oculto/convertido; legacy-only compatible | PASS | fabric-release "Diseño R2"; botón "enviar a producción" count 0; compatibilidad legacy intacta |
| E2E real sin liberación legacy (blob null) | PASS | asertado en ambos fixtures |
| Negativos: R3 no retarget P1 | PASS | Test quote-first paso 9 (release row Stale + R3; badge ausente en R3) |
| Rollback de derive | PASS | #601 storage proofs (reutilizada) |
| Idempotencia | PASS | Retry generación idempotente (browser); same-key retry (storage) |
| Autoridad canonical > blob | PASS | storage `production_releases_test.go` (canonical gana a blob legacy sembrado + control legacy-only) |
| Relationship-bound modules siguen fail-closed | PASS | Sin cambios; guard intacto (#604/#606 evidence) |

Todos los acceptance criteria del padre: **PASS** →
**#577 READY TO CLOSE AFTER MERGE** (sujeto a review del owner; sin
auto-cierre).

## 8. Limitaciones documentadas (no bloqueantes)

- Q1 initial snapshot no captura optionChoices (#571 vigente): flujos
  quote-first con choices de tablero clasifican `modified` hasta un requote que
  incorpore; la planificación de tableros queda demostrada design-first
  (OPS-DT-1). No es requisito del padre cambiar el snapshot comercial.
- Machine adapters (#351 lane) y #499/#503 siguen fuera de alcance.
