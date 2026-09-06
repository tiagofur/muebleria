# Implementation #502 / WEB-DT-3 — Reconciliation, approval and exact ProductionRelease workspace

- Fecha: 2026-09-05
- Rama: `feat/502-web-dt3-reconciliation-release` (base `main@5001ca96`)
- Tracker: #396 (#384). Coordinado con #393 (reconciliación), #394 (clasificación/requote), #395 (aprobación/release), #466 (preflight), #500/#501 (superficies previas).
- Scope boundaries: `#499 Web↔SketchUp handoff: DEFERRED`; `#503 machine evidence/artifacts: DEFERRED`. Sin trabajo Ruby/SketchUp, sin claims de máquina, sin DXF.

## 1. Base y arquitectura

Tercera superficie React del Digital Thread en `/quotes/:projectId/reconciliacion?qrev=&design=&rev=`:

1. **Contexto exacto**: la comparación y todos los comandos viajan pineados a `quoteRevisionId` + `designId` + `designRevisionId` en la URL (reload-safe, shareable). Defaults de conveniencia (Q/R más nuevas) sólo cuando el usuario NO especificó contexto; un ID explícito inexistente o cross-design falla cerrado con aviso accionable — jamás retarget silencioso a `latest`.
2. **Reconciliación 100% server-owned**: `reconcileProjectDesign` (generado, #393) alimenta summary, rows por `furnitureInstanceId`, diferencias estructuradas e impactos `commercial|manufacturing|spatial` (#394) verbatim. React no compara parámetros ni infiere impacto; `reconciliationWorkspace.ts` sólo traduce copy (paths → etiquetas) manteniendo el path canónico visible.
3. **Requote explícito**: `requoteProjectQuote` (generado) con modal de review que declara «La cotización Q1 no será modificada», pre-selección de unidades incorporables según la regla del contrato generado (`modified`+comercial o `modeled_not_quoted` — espejo de presentación; el servidor recomputa y rechaza fail-closed), confirmación con IDs exactos y retarget explícito «Comparar Q2 con R1». Stale base → 409 `VERSION_CONFLICT` tipado con copy accionable (sin retry ciego, sin success falso).
4. **Preflight autoritativo**: nuevo read model mínimo generado `evaluateDesignRevisionPreflight` (`POST /designs/{designId}/revisions/{revisionId}/preflight`) que evalúa la MISMA función de dominio del gate de release (scope `production-release-v1`, estados `ready|blocked`, códigos `empty_revision|duplicate_instance|missing_definition|invalid_parameters|invalid_material_choice`). Sin segundo motor; sin transporte SketchUp.
5. **Aprobación exacta**: `approveDesignRevision` (generado) sobre la revisión pineada; habilitada sólo con status `published` + hint de rol (`roleCanApproveDesignRevisions` de `@granete/domain`, paridad Go); success sólo tras respuesta autoritativa.
6. **ProductionRelease exacto**: `createProductionRelease` (generado) con modal de propuesta (obra, Qn, Rn, preflight, aprobación, nota de fingerprint verificado por el servidor), pin opcional de cotización aceptada, y respuesta renderizada con pins exactos. Historial durable: cada fila muestra `Release #N → Qn + Rn` + staleness server-owned; la "última del proyecto" es nota informativa y la liberación contextual sólo aparece con match exacto de pins (`findContextualRelease`, filtro de presentación).
7. **Errores tipados** (`describeCommandError`): 403/FORBIDDEN, STEP_UP_REQUIRED (copy compatible aunque estos endpoints hoy no lo devuelven), VERSION_CONFLICT (stale), 409 con `details.blocker=manufacturing_preflight_blocked` (lista de issues), conflicto comercial, validación, red y servidor — sin catch-all genérico.

## 2. Backend añadido (mínimo contrato #496)

- OpenAPI: `ManufacturingPreflightResult/Item/Issue/Status/ItemStatus/IssueCode` + operación `evaluateDesignRevisionPreflight` (read-only POST, espejo del precedente `reconcileProjectDesign`). `pnpm openapi:generate` regeneró TS/Go sin drift; #496 sigue abierto.
- Go: `PostgresStore.EvaluateDesignRevisionPreflight` (storage, reusa `ListDesignRevisionItems` + `loadReferencedFurnitureDefinitionParameters` + `domain.RunManufacturingPreflight`), handler `HandleDesignRevisionPreflight` (`RoleCanAccessProjects`) y ruta `POST /api/designs/{designId}/revisions/{revisionId}/preflight`.
- Tests Go: paridad ready (el release acepta la misma revisión), paridad blocked (el release rechaza con el MISMO verdict — proof de consistencia aprobación/preflight/release), fail-closed exact-revision (404 uniforme para revisión inexistente/cross-design/UUID inválido), read-scope por RLS (org sin acceso al proyecto → 404 uniforme), y HTTP (401/403/400/404, eco verbatim, IDs exactos).

### Fix de bugs latentes en el readback de releases (descubiertos por el E2E #502)

El E2E real expuso dos defectos del read model de `production_releases` que ninguna superficie anterior ejercía (todas las listas estaban vacías):

1. `ListProjectProductionReleases` ejecutaba las queries de staleness DENTRO del bucle del cursor de filas → `conn busy` (500) en cuanto existía un release. Fix: buffer de filas antes de derivar staleness.
2. Las columnas compartidas de readback jamás seleccionaban `design_revision_number` (sólo el create lo llenaba) → list/get/contextual/latest devolvían `0`, violando el mínimo del schema generado y fallando la validación runtime del cliente. Fix: derivarlo por JOIN con la revisión pineada (ahora compartido por todos los readers: list, get, contextual, latest y autoridad de producción).

## 3. Componentes

- `packages/ui/src/digitalThread/reconciliationWorkspace.ts` (+ tests): modelo puro de presentación — labels de status/quotes/preflight, `formatDifferencePath/Value` (copy-only), `impactChips`, `isIncorporableChange` (espejo documentado del contrato generado), `findContextualRelease` (filtro por pins exactos, sin fallback a latest), `isHistoricalComparison`.
- `ProjectReconciliationScreen.tsx` (+ tests, 27): contexto exacto fail-closed, queries por par exacto Q/R (keys `['project-reconciliation', ...sessionScope, projectId, ...]` — Q1/R1, Q2/R1 y Q1/R2 nunca comparten cache), summary/units verbatim, comandos sin success optimista, invalidaciones acotadas (requote → quoteRevisions + reconciliaciones del proyecto; approval → designRevisions(design); release → productionReleases).
- `ReconciliationCommandPanels.tsx`: PreflightPanel, ApprovalPanel, ReleasePanel, ReleaseHistoryList, RequoteReviewModal, ReleaseReviewModal, mapeo de errores tipados. Actions disabled explican el porqué (rol, aprobación pendiente, preflight bloqueado).
- Ruteo: `projectReconciliationPath/FromPath` + tests; render gate en `ShellView.tsx` con remount key por org scope y capabilities (`canRequote/canApprove/canRelease` desde `@granete/domain`); entrada «Reconciliación y liberación» en el menú «Hilo digital» (`ProjectDetailView`) y cross-links bidireccionales con Diseños/Muebles.
- CSS: bloque `pr-*` en `digitalThread.css` con tokens del sistema (sin hex; el linter de tokens verde).

## 4. E2E browser + PostgreSQL real

`tests/organization/project-reconciliation.spec.ts` (gate `organization-browser-gate.sh`, Playwright + Go + PostgreSQL reales, sin mocks):

- **Golden path quote-first**: proyecto QuoteLine qty=3 → FI-A/B/C; FI-D design-first vía API pública; Q1 accepted sembrada por SQL con rol migration (convención del suite Go — ver limitación §6); R1 publicada con FI-B 650 (modificado comercial+fabricación) y FI-C sin modelar. Asserts: header exacto Q1/R1, clasificación backend verbatim (1/1/1/1/0), identidad por `furnitureInstanceId` (qty>1 sin colapso), diff `600 → 650`, preflight ready.
- **Requote explícito**: modal con copy de inmutabilidad, selección pre-checkeada de FI-B+FI-D, Q2 creada como borrador, Q1 intacta, retarget explícito a Q2/R1 → synced 3 / quoted_not_modeled 1.
- **Conflicto stale**: requote desde Q1 con Q2 existente → alerta tipada «desactualizada», sin success, sin Q3.
- **Aceptación Q2 + supersede Q1** (fixture) → nota de comparación histórica sobre Q1.
- **Completar modelado**: R2 publicada con FI-C también → Q2/R2 reconcilia 4 synced (el gate comercial del release exige baseline al día: `quoted_not_modeled` bloquea — verificado por diseño).
- **Aprobación R2** → «R2 aprobada» sólo tras respuesta.
- **Release P1** vía modal → «Liberación #1 creada» fijada a Q2+R2; fila de historial `Q2 + R2` + fingerprint; badge contextual con pins exactos.
- **Durabilidad**: R3 publicada con fingerprint distinto → P1 sigue `Q2 + R2` con staleness server-owned «Stale (diseño actual R3)»; seleccionar R3 no muestra liberación contextual.
- **Failure rollback**: `createProductionRelease` sobre R2 no aprobada → 409 tipado, sigue habiendo exactamente 1 release (P1→R1), sin banner de success en UI.
- **Tenant isolation**: Org B nunca ve datos de reconciliación de Org A (RLS + cache por sesión).

## 5. Verificación

- `pnpm openapi:generate` + `pnpm openapi:check`: sin drift.
- `pnpm typecheck`: verde (7 proyectos).
- `pnpm test` monorepo: UI 1588 tests (157 archivos), Web 424 tests (33 archivos) — incluye 27 nuevos del screen + 6 de rutas + 5 del modelo puro.
- `go test ./...`: verde (incluye 4 storage tests con PostgreSQL real + 6 HTTP tests nuevos del preflight).
- Browser gate E2E `project-reconciliation.spec.ts`: PASS.
- Regresiones #500/#501: suites UI/Web completas verdes; specs Playwright `project-furniture.spec.ts` y `project-designs.spec.ts` intactos (sin cambios de contrato).

## 6. Limitaciones de demo conocidas

- **No existe API HTTP para crear la primera QuoteRevision ni para aceptar/publicar una revisión comercial**: sólo `requoteProjectQuote` crea revisiones posteriores y `UpdateQuoteRevisionStatus` no tiene handler. El E2E/fixture de demo siembra Q1 accepted y transiciona Q2 (draft→published→accepted) con SQL directo por el rol migration — misma convención que el suite Go autoritativo. No se construyó commercial workflow nuevo en #502 (scope guard de la issue).
- **Aprobación no exige preflight server-side** (la autoridad de preflight vive en el gate de release): el panel de aprobación PRESENTA preflight y reconciliación como contexto server-owned sin inventar eligibility; el botón sólo respeta precondiciones que el backend efectivamente impone (status published + rol).
- Preflight Web muestra el vocabulario real del servidor (`ready|blocked`) — no existe tri-estado GREEN/WARNING/BLOCKED en el contrato.
- #499 (Abrir en SketchUp) y #503 (machine evidence/artifacts de release) diferidos explícitamente; cero pairing/URI/deep-links/claims de máquina.
- DTOs de reconciliación/cotización/release no contienen costos/BOM/CNC: no hay nada que redeñar para Store/partner en esta superficie (verificado estructuralmente + aislamiento tenant en E2E).
