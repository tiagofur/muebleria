# Review — feature F206 (#387 DT-3)

**Veredicto:** APPROVED

## Resumen de la revisión
Implementación completa de la issue #387 (`[P0][DT-3] Add Design aggregate and immutable DesignRevision snapshots`).
- Agregado client-agnostic `designs` (0..N por proyecto, trazabilidad opcional `source_quote_revision_id`).
- Working copy draft persistente y desacoplado de revisiones publicadas (`design_working_copies`, `design_working_items`), permitiendo edición múltiple de borradores sin crear revisiones, avance automático del base en publicación y reseteo a revisiones anteriores.
- Snapshots inmutables `design_revisions` con numeración secuencial garantizada por diseño (R1, R2...) y bloqueo de fila para evitar race conditions.
- Snapshots `design_revision_items` vinculados a la identidad física `FurnitureInstance` existente (#385/#386) sin inventar IDs nuevos.
- Restricción misma-organización/mismo-proyecto (I10) y unicidad de instancia física en revisión (§11) resueltos con foreign keys compuestas y unique constraints.
- Inmutabilidad estricta vía grants de PostgreSQL (`REVOKE UPDATE, DELETE`) y triggers raising exception.
- Concurrencia optimista fail-closed: R1 requiere `baseRevisionId` vacío/nulo; R2+ requiere `baseRevisionId == latestRevID`; reintentos o bases stale/missing rechazan con HTTP 409 Conflict.
- Cadena lineal estricta de revisión padre: `parent_revision_id` derivado/validado contra `latest/base`; bifurcaciones dentro del mismo diseño rechazadas.
- Serialización de snapshot fail-closed: cualquier error en serialización de parámetros, materiales o transform falla con `ErrSerializationFailed` y aborta la transacción sin revisiones huérfanas o degradadas.
- Historia durable extendida en cotizaciones: disminución de cantidad en borrador es rechazada si la unidad está en una revisión de diseño.
- Auditoría durable transaccional (`design_created`, `design_revision_published`).
- OpenAPI generado sin drift y clientes Go/TS actualizados.

## Checkpoints
- C1: [x] Harness completo (`./init.sh` termina en verde con exit code 0)
- C2: [x] Estado coherente en `feature_list.json` y `progress/current.md`
- C3: [x] Arquitectura y boundaries respetados (Clean/Hexagonal, domain sin UI/fs, storage con RLS, errores tipados)
- C4: [x] Verificación real contra PostgreSQL vivo (storage tests, concurrent row locking, migration fresh/upgrade, RLS cross-org direct-SQL) y API unit tests
- C5: [x] Sesión limpia, commits convencionales atómicos, working tree limpio y rama pushed a origin

## Verificaciones ejecutadas
- `./init.sh`: OK (Exit code 0)
- `go test ./...` en `backend-go`: OK (Exit code 0)
- `pnpm openapi:check`: OK (0 drift)
- `pnpm typecheck`: OK (0 errores en los 7 paquetes)
- `pnpm test`: OK (33 suites, 411 tests)
- `git status` y `git log origin/feat/387-design-and-design-revisions..HEAD`: Limpio, 0 commits pendientes de push.
