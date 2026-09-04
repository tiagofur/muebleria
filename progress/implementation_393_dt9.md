# Implementación #393 DT-9: QuoteRevision ↔ DesignRevision Reconciliation by FurnitureInstance

- Fecha: 2026-09-03 America/Mexico_City
- Issue: #393 `[P0][DT-9] Implement QuoteRevision ↔ DesignRevision reconciliation by FurnitureInstance`
- Rama: `feat/393-quote-design-reconciliation`
- Estado: COMPLETE

## Resumen de lo implementado

1. **Domain Model (`backend-go/internal/domain/reconciliation.go`)**:
   - Reconciliador puro `Reconcile(quote QuoteRevisionSnapshot, design DesignRevisionSnapshot) ReconciliationResult`.
   - Comparación estricta y exclusiva por `FurnitureInstance.id` físico.
   - Statuses canónicos implementados: `synced`, `quoted_not_modeled`, `modeled_not_quoted`, `modified`, `removed`, `conflict`.
   - Diferencias estructuradas determinísticas con normalización numérica (`600 == 600.0`) y orden canónico por path y por furnitureInstanceId.
   - Regla de transform/spatial (§42): ausencia comercial de transform no marca `modified`.
   - Regla de locator técnico (§37): SketchUp persistent_id y otros technical locators se excluyen de la semántica de negocio.
   - Regla de ciclo de vida removed (§43): FIs en estado terminal (`removed`/`cancelled`) son clasificados como `removed`.
   - Fail-closed para identidades duplicadas o malformadas (`conflict`).
   - Rechazo de reconciliación cross-project (`domain.ErrCrossProjectReconciliation`).

2. **Contrato OpenAPI y Generación**:
   - Endpoint añadido: `POST /projects/{projectId}/reconciliation`.
   - Schemas: `ReconcileProjectDesignRequest`, `ReconciliationStatus`, `StructuredDifference`, `ReconciliationItem`, `ReconciliationSummary`, `ProjectDesignReconciliationResult`.
   - Generación de tipos Go y cliente TypeScript (`packages/storage/src/openapi/generated/client.ts`).
   - `pnpm openapi:check` 100% verde (0 drift).

3. **Storage Layer (`backend-go/internal/storage/reconciliation.go`)**:
   - Método `PostgresStore.ReconcileProject(ctx, projectID, quoteRevisionID, designRevisionID)`.
   - Carga el snapshot comercial histórico de `quote_line_furniture_instances` (`state = 'current'`) + `project_items` (`custom_dims`) + `project_item_choices`.
   - Carga el snapshot de diseño inmutable de `design_revisions` y `design_revision_items`.
   - Operación puramente de lectura (read-only): 0 mutaciones en la base de datos (negative proof de inmutabilidad verificado).
   - Aislamiento multi-org y RLS verificado.

4. **API Layer (`backend-go/internal/api/reconciliation.go`)**:
   - Handler `HandleProjectReconciliation` registrado en `POST /api/projects/{projectId}/reconciliation`.
   - Soporte para camelCase y snake_case payloads.
   - Autenticación, RBAC y validación UUID.
   - Respuestas tipadas con HTTP 200, 400 (UUID inválido), 401, 403, 404 (not found), 409 (cross-project).

5. **Pruebas y Verificación**:
   - Pruebas unitarias de dominio puras (`reconciliation_test.go`): 10 tests, todos verdes.
   - Pruebas unitarias de handler HTTP (`api/reconciliation_test.go`): auth, validación, 404, 409, 200, todos verdes.
   - Pruebas de integración PostgreSQL bajo rol de app (`storage/reconciliation_test.go`):
     - `TestReconciliation_SyncedAndModified`
     - `TestReconciliation_NegativeProofE_SameLookingDifferentIdentity` (mandatory Negative Proof E)
     - `TestReconciliation_QuantityGreaterThanOne_PartialPlacement` (unit-level tracking)
     - `TestReconciliation_CrossProjectRejected`
     - `TestReconciliation_ImmutabilityNegativeProof` (proof que Q y R no cambian un byte)
     - `TestReconciliation_MultiOrgRLS`
   - Suite completa de Go (`domain`, `api`, `storage`) verde.
   - `pnpm openapi:check` verde.
   - `pnpm typecheck` verde.
   - `pnpm test` (33 files, 411 tests) verde.
   - `git diff --check` limpio.
