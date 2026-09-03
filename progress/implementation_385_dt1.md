# Implementación #385 — DT-1: identidad estable de FurnitureInstance

- **Fecha:** 2026-09-02 (America/Mexico_City)
- **Feature:** F204 · ledger `feature_list.json`
- **Autoridad:** `docs/architecture/project-design-digital-thread.md` §§2–5, 26,
  28, 30–31 · ADR-0003 · `docs/architecture/domain-model.md`
- **Estado:** COMPLETE (pending review/merge)
- **Base:** Gate A GREEN 34/34 (PR #537). Este trabajo no modifica Gate A.

## Qué se implementó

`FurnitureInstance` pasa de concepto de dominio a **identidad de negocio
persistente** project-owned: una fila por unidad física pretendida, con
identidad/procedencia/lifecycle únicamente. Es la primera familia persistente
nueva post-Gate A y nace integrada con Foundation.

### Persistencia — `db/migration/000111_project_furniture_instances`

- `furniture_instances`: `id` (UUID asignado por la BD, `gen_random_uuid`),
  `organization_id` (= `projects.organization_id`), `project_id`,
  `furniture_definition_id?` (FK `modules` `ON DELETE SET NULL`: la definición
  es procedencia, no identidad, y la identidad sobrevive a la limpieza de
  catálogo), `origin` (`quote|design|manual|import|duplicate`),
  `origin_furniture_instance_id?` (procedencia de duplicado, I8),
  `lifecycle_status` (`active|removed|cancelled`; removed/cancelled son
  terminales — anti-pattern 12), `version`, `created_at`, `updated_at`.
- RLS desde la primera migración: clasificación `explicitly-shared` (igual que
  `project_items`), policy `project_explicit_organizations`
  (`app_can_access_project` read / + `app_shared_child_matches_project` write),
  `FORCE ROW LEVEL SECURITY`, trigger `protect_shared_child_ownership`
  (project/organization inmutables), índice organization-first, registro en
  `rls_policy_inventory`.
- Grants runtime `SELECT, INSERT, UPDATE` — **sin DELETE**: la identidad nunca
  se borra físicamente por el rol app; sólo la cascada del proyecto.

### Dominio — `internal/domain/furniture_instance.go`

Tipos `FurnitureInstanceOrigin` / `FurnitureInstanceLifecycle` con validación,
errores tipados (`ErrInvalidFurnitureInstanceCommand`,
`ErrFurnitureInstanceLifecycleConflict`,
`ErrFurnitureInstanceProjectNotWritable`) y el struct de identidad (sin campos
de configuración/posición/BOM — §5 del contrato digital-thread).

### Storage — `internal/storage/furniture_instances.go`

- `CreateFurnitureInstance`: valida visibilidad de proyecto bajo el scope del
  actor (fail-closed), exige que el actor sea la organización dueña del
  proyecto (la contraparte sales/manufacturing ve pero no crea), valida
  definición dentro del catálogo del tenant, exige que la procedencia de
  duplicado pertenezca al MISMO proyecto (cross-project rechazado server-side)
  e inserta junto con el evento durable `furniture_instance_created` en la
  misma transacción tenant.
- `ListFurnitureInstancesByProject` / `GetFurnitureInstanceByID`: scope
  explícito que espeja la policy RLS en SQL plano (defense-in-depth fuera del
  path app-role) + RLS como cinturón real.
- `RemoveFurnitureInstance`: transición terminal `active → removed` bajo
  `If-Match` (optimistic), rechaza re-remove y version stale con errores
  tipados, audit `furniture_instance_removed` en la misma transacción.

### API — `internal/api/furniture_instances.go` + OpenAPI generado

- `GET /api/projects/{projectId}/furniture-instances` (lista completa, orden
  estable de creación).
- `POST /api/projects/{projectId}/furniture-instances` — `RequireIdempotency`
  durable; origin server-authoritative `manual`; el DTO público no acepta
  provenance de quote/design/duplicate (eso llega con #386/#388 server-side).
- `POST /api/furniture-instances/{instanceId}:remove` — `If-Match` obligatorio,
  `RequireIdempotency`.
- Contratos en `contracts/openapi/granete-api.v1.yaml` (schemas
  `FurnitureInstance`, `FurnitureInstanceOrigin`,
  `FurnitureInstanceLifecycleStatus`, `CreateFurnitureInstanceRequest`) con
  clientes TS/Go generados por `pnpm openapi:generate` — sin DTO manual
  paralelo. Errores tipados existentes (NOT_FOUND/FORBIDDEN/BAD_REQUEST/
  VERSION_CONFLICT/CONFLICT).

## Pruebas (PostgreSQL real, rol app real)

| Prueba | Prueba de |
|---|---|
| `TestFurnitureInstances_MigrationFreshAndUpgrade` | fresh + upgrade fixture; inventory, FORCE RLS, policy, trigger, grants sin DELETE |
| `TestFurnitureInstances_IdentityLifecycleAndAudit` | I2 (dos comandos idénticos → IDs distintos), definición opcional/validada, projectId random → 404 storage, duplicado cross-project rechazado, manufacturing lee pero no crea/remueve, proyecto privado invisible a otra org, version stale/conflict, lifecycle terminal, audit durable con actor/org correctos |
| `TestTenantRLS_FurnitureInstancesDirectSQLCrossOrg` | SELECT sin filtro no cruza orgs; UPDATE cross-org 0 filas; DELETE sin privilegio; INSERT en proyecto ajeno / con org equivocada falla WITH CHECK; reasignación project/organization bloqueada por trigger |
| `TestFurnitureInstancesHTTP_Postgres` | HTTP real: retry con misma Idempotency-Key → misma identidad (count==1), dos unidades → IDs distintos, projectId random → 404, If-Match stale → VERSION_CONFLICT, remove → removed v2 con replay idempotente |
| `internal/api/furniture_instances_test.go` | role guard, DTO snake_case generado, mapping de errores tipados, 428 sin If-Match |

## Invariantes preservadas

- **I1** — la instancia existe sólo dentro de un Project exacto (FK + trigger +
  policy + validación server-side).
- **I2** — identidad asignada por la BD; el comando no tiene inputs de
  posición/nombre/dimensiones/persistent_id, y dos comandos idénticos producen
  dos IDs (probado).
- **I7** — no hay ningún campo SketchUp en la tabla; el locator técnico vivirá
  en DesignRevisionItem (#387+), no aquí.
- **I9** — no existe snapshot mutable de configuración que pueda "cambiar la
  identidad"; la fila no guarda configuración.

## No implementado (explícito)

- #386 QuoteLine↔FurnitureInstance (materialización qty, relación).
- #387 Design/DesignRevision/DesignRevisionItem.
- SketchUp: bindings, pairing, placement, persistent_id, plugin, Ruby.
- reconciliation, requote, ProductionRelease, machining, DXF.
- Gate B / #461 adicional / mejoras no relacionadas.

## Verificación

- `go test ./...` (DATABASE_URL real, `-p 1`): verde, incluida la suite nueva.
- `pnpm openapi:check`: sin drift.
- `pnpm typecheck`, `pnpm test`: verde.
- `git diff --check`: limpio.
- Gate A (`scripts/foundation-gate-a.sh`) sin cambios: sigue siendo la prueba
  34/34 existente; la nueva familia no altera ningún proof de Foundation.
