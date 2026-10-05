# ODD — #1091: #443 slice 2 — concurrencia optimista para las familias simples del catálogo

- Issue: #1091 (child de #443, slice 2 de 3).
- Autorización: owner en sesión 2026-10-05 ("slice 2" tras el merge del slice 1).
- Lane: ODD (Delegated Direct). Estado: IMPLEMENTED_PENDING_REVIEW.
- Base: `origin/main` @ `6da2728f` (merge de #1089).
- Branch: `feat/1091-slice2-concurrency` (worktree `muebles-worktrees/1090-slice2-concurrency`).
- Modo de entrega previsto: `Closes #1091` + `Delivery: complete`.

## 1. Alcance

Extiende el contrato If-Match (#443/#448) a las 8 familias simples que escribe el fan-out de `saveCatalog`: materials, edges, option-groups, categories, customers, material-categories, ambient-materials, ambient-categories. Una migración única (000154) agrega `version BIGINT NOT NULL DEFAULT 1` a sus tablas; storage con guard in-txn (`version = version + 1 WHERE … AND version = $expected`, 404 desambiguado de 412 vía `disambiguateRowNotFound` — helper nuevo compartido, también adoptado por hardware del slice 1); handlers exigen `If-Match` (428 si falta) → 412 `VERSION_CONFLICT`, GET expone `ETag` fuerte.

**Decisión de approach (aprobada en la issue)**: estas familias NO entran al contrato OpenAPI generado; la semántica #448 (If-Match + envelope `ApiError` tipado) se aplica en la capa de repositorio web (`upsertGuarded`) sobre los endpoints REST existentes. Excluido: components/structures/agregados (slice 3, mutaciones dirigidas).

## 2. Web

- Caché de versiones genérica `entityVersions` (clave `familia:id`), sembrada por `getCatalog` desde los payloads crudos; la de hardware del slice 1 se conserva.
- `upsertGuarded(path, collection, body, family, id)`: aprende la versión al vuelo (GET por id; 404 → POST-create directo, sin probe PUT), envía `If-Match`, refresca la versión desde la respuesta y mapea 412/409 al `GraneteApiError` tipado. `CatalogEntityVersionUnknownError` falla cerrado sin versión conocida.

## 3. Decisiones y semántica

- **DELETE/deactivate ambientales cross-org = no-op silencioso** (semántica original, sin leak): sólo el mismo-org stale produce `ErrVersionConflict`. Las demás familias conservan su semántica previa de "not found".
- `ambient_materials` no tiene columna `updated_at`: el UPDATE agrega `version = version + 1` sin tocar `updated_at`.
- Los tests handler legacy (13 requests en ambient/catalog/materialCategories) se actualizaron al contrato con `If-Match: "v1"`, nombres intactos.
- Pin de schema del test de definiciones tipadas: 151 → **154** (la lectura de catálogo ahora escanea version en las familias simples).
- 15 stubs del Store actualizados a la firma con `expectedVersion`; 3 campos de inyección de conflicto nuevos (`updateMaterialBoardErr`, `updateCategoryErr`, `updateCustomerErr`/`deactivateCustomerErr`).

## 4. Evidencia

- Storage: batería table-driven `TestCatalogSimpleFamilies_OptimisticConcurrency` — 8 familias × (create v1, write A gana, stale B → conflicto sin mutar, remove stale → conflicto, remove vigente ok).
- Handlers: `TestCatalogSimpleFamilies_IfMatchGuardsWrites` — 428 sin header ×7 familias antes de tocar el store, 412 tipado ×3, DELETE 428 ×2, ETag GET.
- Web: 4 tests nuevos (siembra sin re-learn, learn+If-Match+write-back consecutivo, 412 tipado, 404→POST sin If-Match); suite completa 50/50.
- Full backend (runner aislado #823) + `pnpm typecheck` 8/8 + `pnpm test` completo + checks de fábrica: al cierre, ver PR.

## 5. Riesgos/limites

- Los catálogos localStorage legacy (sin version) fallan cerrado con `CatalogEntityVersionUnknownError` en el primer guardado — recuperación: recargar el catálogo.
- `ReactivateMaterialBoard`/`ReactivateEdgeBand`/`ReactivateCustomer` siguen sin guard (código muerto pre-existente, igual que hardware).
