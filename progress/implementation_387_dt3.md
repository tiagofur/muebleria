# Implementación #387 — DT-3: Design + DesignRevision + DesignRevisionItem

- **Fecha:** 2026-09-02 (America/Mexico_City)
- **Feature:** F206 · ledger `feature_list.json`
- **Autoridad:** `docs/architecture/project-design-digital-thread.md` §§7–10, 17–18, 25.2, 26, 28, 30–31 · ADR-0003 · `docs/architecture/domain-model.md`
- **Estado:** COMPLETE (pending review/merge)
- **Base:** `main` (#385 DT-1 y #386 DT-2 completados y verificados).

---

## 1. Qué se implementó

Se implementó el agregado completo de **Design**, sus revisiones inmutables **DesignRevision**, y los snapshots de items **DesignRevisionItem**, consumiendo la identidad existente `FurnitureInstance.id` de #385/#386 sin inventar IDs nuevos (Invariante I1, I2, I9).

### Persistencia y Modelo Relacional (`db/migration/000113_design_and_design_revisions`)

1. **`designs`**:
   - `(id, organization_id, project_id, name, source_quote_revision_id, status, created_by, created_at, updated_at)`.
   - Propiedad 1:N por `Project` (un proyecto puede tener 0..N diseños; client-agnostic).
   - `source_quote_revision_id`: opcional, solo para procedencia/trazabilidad. La cotización NO posee al diseño.
   - Restricción única: `uq_designs_id_project (id, project_id)` como ancla de integridad referencial compuesta.

2. **`design_revisions`**:
   - `(id, organization_id, project_id, design_id, revision_number, parent_revision_id, source_type, status, created_by, created_at)`.
   - Numeración secuencial garantizada por diseño (`R1`, `R2`...) con `CONSTRAINT uq_design_revisions_design_number UNIQUE (design_id, revision_number)`.
   - FK compuesta autorreferencial: `(parent_revision_id, design_id) REFERENCES design_revisions(id, design_id)`: garantiza a nivel estructural que el parent pertenece al mismo diseño.
   - Anclas compuestas: `uq_design_revisions_id_design (id, design_id)` y `uq_design_revisions_id_project (id, project_id)`.

3. **`design_revision_items`**:
   - `(id, organization_id, project_id, design_revision_id, furniture_instance_id, furniture_definition_id, definition_version, parameters, material_choices, transform, room_id, technical_client_locator, created_at)`.
   - **Same-project invariant (I10)** estructuralmente enforced en PostgreSQL:
     - `(design_revision_id, project_id) REFERENCES design_revisions(id, project_id)`
     - `(furniture_instance_id, project_id) REFERENCES furniture_instances(id, project_id)`
     Imposible vincular un FurnitureInstance de otro proyecto, incluso mediante SQL directo.
   - **At most once per revision (§11)**:
     - `CONSTRAINT uq_design_revision_items_revision_instance UNIQUE (design_revision_id, furniture_instance_id)`.
     Una unidad física no puede aparecer duplicada en la misma revisión.

4. **Inmutabilidad Absoluta (§12)**:
   - Triggers `protect_design_revisions_immutable` y `protect_design_revision_items_immutable` ejecutan `RAISE EXCEPTION` ante cualquier intento de `UPDATE` o `DELETE`.
   - Grants en tiempo de ejecución: `REVOKE UPDATE, DELETE ON design_revisions, design_revision_items FROM granete_app;` (sólo `SELECT` e `INSERT`).

5. **Multi-Tenancy y RLS**:
   - `ENABLE` y `FORCE ROW LEVEL SECURITY` en las 3 tablas.
   - Policies basadas en `app_can_access_project(project_id)` y organizaciones del proyecto.
   - Trigger de consistencia de ownership `protect_shared_child_ownership`.
   - Registradas en `rls_policy_inventory` con clasificación `explicitly-shared`.

---

## 2. Dominio y Servicios de Aplicación (`internal/domain`, `internal/storage`)

1. **Modelos y Tipos de Dominio (`internal/domain/design.go`)**:
   - Entidades: `Design`, `DesignRevision`, `DesignRevisionItem`.
   - Value Objects: `Transform3D`, `TechnicalClientLocator`.
   - Errores tipados: `ErrDesignNotFound`, `ErrDesignRevisionNotFound`, `ErrDesignNotActive`, `ErrDesignRevisionConflict` (409), `ErrInvalidParentRevision`, `ErrDuplicateFurnitureInstanceInRevision`, `ErrCrossProjectFurnitureInstance`, etc.
   - Resolución de colisión con estructura histórica: Renombrado de legacy JSONB blob en `projectEvents.go` a `LegacyDesignRevision` y actualizado `domain.Project.DesignRevisions` a `[]LegacyDesignRevision`.

2. **Publicación y Concurrencia Optimista (`internal/storage/designs.go`)**:
   - `PublishDesignRevision`:
     - Bloqueo exclusivo de fila `designs WHERE id = $1 FOR UPDATE` para serializar publicaciones en el mismo diseño sin colisión en `revision_number`.
     - Verificación optimista de `BaseRevisionID` contra la última revisión publicada; si es stale, rechaza con `ErrDesignRevisionConflict` (HTTP 409).
     - Verificación de que la revisión padre pertenece al diseño.
     - Detección y rechazo de duplicados de `furniture_instance_id` en los items recibidos.
     - Verificación de que cada FurnitureInstance existe, pertenece al mismo proyecto y no está en estado terminal (`removed`/`cancelled`).
     - Inserción atómica de la revisión y todos sus items.
     - Eventos de auditoría durables en la misma transacción: `design_created` y `design_revision_published`.

3. **Extensión del Hook de Historia Durable (`internal/storage/quote_line_furniture_instances.go`)**:
   - `quoteLineInstanceDurableHistory`: verifica si la instancia física está referenciada en `design_revision_items`.
   - Si una unidad cotizada fue incluida en una revisión de diseño, una disminución de cantidad en cotización borrador queda **bloqueada** con `ErrFurnitureInstanceDurableHistory` (la historia de diseño protege a la unidad física).

---

## 3. Contratos de API y OpenAPI (`contracts/openapi/granete-api.v1.yaml`)

- `GET /projects/{projectId}/designs` -> `listProjectDesigns`
- `POST /projects/{projectId}/designs` -> `createProjectDesign` (con `Idempotency-Key`)
- `GET /designs/{designId}` -> `getDesign`
- `GET /designs/{designId}/revisions` -> `listDesignRevisions`
- `POST /designs/{designId}/revisions` -> `publishDesignRevision` (con `Idempotency-Key`)
- `GET /designs/{designId}/revisions/{revisionId}` -> `getDesignRevision`
- Clientes TypeScript y tipos Go generados automáticamente con `scripts/generate_openapi.py`.
- `pnpm openapi:check` pasa sin drift ni operaciones faltantes.

---

## 4. Endpoints HTTP y Manejadores (`internal/api/designs.go`, `routes.go`)

- Handlers: `HandleProjectDesigns`, `HandleDesign`, `HandleDesignRevisions`, `HandleDesignRevision`.
- Control de acceso por roles: `RoleCanAccessProjects` para lectura, `RoleCanMutateProjects` para creación y publicación.
- Mapeo de errores de dominio a respuestas OpenAPI estructuradas (`400 Bad Request`, `403 Forbidden`, `404 Not Found`, `409 Conflict`).
- Mapeo bidireccional fiel a DTOs generados.

---

## 5. Matriz de Pruebas y Verificación

1. **Pruebas de Storage y PostgreSQL Real (`internal/storage/designs_test.go`)**:
   - `TestDesigns_MigrationFreshAndUpgrade`: Migración limpia en fresh y upgrade sobre 000112; inventario RLS y privilegios de immutabilidad verificados para tablas inmutables y working copy.
   - `TestDesigns_ProjectAggregateAndRevisions`: Creación de diseños, procedencia de cotización, publicación secuencial R1 y R2 con parentRevisionId, preservación de FurnitureInstance ID entre revisiones (I9).
   - `TestDesigns_Immutability`: UPDATE y DELETE directo por SQL sobre `design_revisions` y `design_revision_items` fallan con error de trigger.
   - `TestDesigns_WorkingCopy_LifecycleAndDraftPersistence`: Edición repetida del borrador en working copy sin crear revisiones; publicación atómica desde working copy sin items explícitos; avance de `base_revision_id` a la nueva revisión; reseteo del working copy al baseline de una revisión previa.
   - `TestDesigns_FailClosedOptimisticConcurrency`: Fail-closed en publicación (R1 con base no vacía -> 409; R2 sin base -> 409; R2 con base stale -> 409; R2 con base correcta -> 201).
   - `TestDesigns_LinearParentChainCoherence`: Verificación de cadena lineal sin branching; intentos de bifurcar la revisión padre son rechazados con `ErrInvalidParentRevision`.
   - `TestDesigns_SnapshotSerializationFailClosed`: Error de serialización en snapshots aborta la transacción y revierte sin crear revisiones huérfanas o degradadas.
   - `TestDesigns_ConcurrentPublishNumbering`: Concurrencia sobre publicación R1 serializa por row-lock: exactamente 1 gana y las demás reciben 409 Conflict por base desactualizada.
   - `TestDesigns_CrossOrgRLS`: Org B no ve diseños ni revisiones de Org A bajo consulta deliberadamente no filtrada con rol de app.
   - `TestDesigns_DurableHistoryBlocksQuoteDecrease`: Materialización de cotización vincula FI; se publica revisión con FI; reducción de cantidad en cotización es rechazada por historia durable.
   - `TestDesigns_DurableAuditRecorded`: Se auditan `design_created` y `design_revision_published` en `security_audit_events`.

2. **Pruebas Unitarias de API (`internal/api/designs_test.go`)**:
   - `TestHandleProjectDesigns_CreateReturns201`
   - `TestHandleProjectDesigns_CreateRoleGuard`
   - `TestHandleProjectDesigns_ListReturns200`
   - `TestHandleDesign_GetReturns200`
   - `TestHandleDesignRevisions_PublishReturns201`
   - `TestHandleDesignRevisions_TypedErrors` (404, 403, 400, 409)
   - `TestHandleDesignRevision_GetReturns200WithItems`
   - `TestHandleDesignWorkingCopy_GetReturns200`
   - `TestHandleDesignWorkingCopy_PutReturns200`
   - `TestHandleDesignWorkingCopyReset_PostReturns200`

3. **Verificaciones Globales**:
   - `pnpm openapi:check`: PASS (0 drift).
   - `pnpm typecheck`: PASS (0 errores en los 7 paquetes del monorepo).
   - `pnpm test`: PASS (33 suites, 411 tests).
   - `go test ./...` en `backend-go`: PASS (0 errores).
   - `./init.sh`: PASS (Entorno listo, todas las verificaciones pasaron exitosamente).
