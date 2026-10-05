# ODD — #1084: #443 slice 1 — concurrencia optimista por entidad para herrajes del catálogo

- Issue: #1084 (child de #443, slice 1 de 3).
- Autorización: owner en sesión 2026-10-04 ("hagamos" tras aprobar el plan de slices).
- Lane: ODD (Delegated Direct). Estado: IMPLEMENTED_PENDING_REVIEW.
- Base: `origin/main` @ `7bc18e5ef632aa8dc37fabc0f417cc62c07dac22`.
- Branch: `feat/1084-hw-concurrency` (worktree `muebles-worktrees/1084-hw-concurrency`).
- Modo de entrega: `Closes #1084` + `Refs #443` + `Delivery: complete`.

## 1. Contexto

#443 exige persistencia por entidad con concurrencia optimista para el catálogo mutable. El prerequisito #448 está CLOSED (cliente generado con `ifMatch`, errores tipados, Idempotency-Key). El patrón completo ya existe en hardware-profiles (`internal/api/hardware_profiles.go` + `internal/storage/hardware_profiles.go`): columna `version` server-owned, `RequireIfMatch`, `FormatVersionETag`, 412 + `ApiErrorCodeVersionConflict`. Este slice lo replica end-to-end para la familia hardware del catálogo, con el matiz de que la web guarda hardware vía el fan-out de `saveCatalog` — resuelto con el patrón de módulos (#497): caché de versiones en el repositorio, no cambios al tipo `Catalog` de TS.

## 2. Tareas técnicas

- [x] T1 Backend storage: migración 000153 (`version BIGINT NOT NULL DEFAULT 1`); `CreateHardware` retorna versión; `UpdateHardware(ctx, id, expectedVersion, h)` y `DeactivateHardware(ctx, id, expectedVersion)` con guard `version = $expected` in-txn → `ErrVersionConflict`, desambiguación 404 vs 412 vía EXISTS (patrón exacto de profiles).
- [x] T2 Backend API: `domain.Hardware.Version` expuesto; GET por id y catálogo exponen versión + `ETag` fuerte; PUT/DELETE exigen `If-Match` (428 `PRECONDITION_REQUIRED` si falta) → 412 `VERSION_CONFLICT`; POST sin versión.
- [x] T3 Contrato: paths `/catalog/hardware` + `/catalog/hardware/{hardwareId}` con schemas `Hardware`/`HardwareWrite`/`HardwareDeactivation`, `If-Match` y ETag; cliente TS y tipos Go regenerados con `scripts/generate_openapi.py`; `check_openapi_drift.py` verde.
- [x] T4 Web: `getCatalog` lista hardware por el contrato generado y siembra `hardwareVersions` desde el payload wire (el tipo de dominio TS no cambia); `upsertHardware` (espejo de `upsertModule`) aprende versión al vuelo (404 → create), envía `If-Match` en cada PUT, refresca desde la respuesta y deja pasar el 412 tipado; `HardwareVersionUnknownError` falla cerrado.
- [x] T5 Batería: storage (`TestHardware_OptimisticConcurrencyGuardsWrites`: dos clientes, stale no revierte, retry reconciliado, deactivate guard, 404≠conflicto), handler (`TestHandleHardwareByID_IfMatchGuardsWrites`: 428 sin header, 412 stale, 200+ETag bump, GET ETag, DELETE guardado), web (5 tests: learn+If-Match, write-back sin re-learn, POST sin If-Match, 412 tipado, siembra desde load).
- [x] T6 Verificación proporcional (evidencia abajo).

## 3. Evidencia

- Backend (runner aislado #823, PG efímero): `./internal/api` ok 21s, `./internal/storage` ok 537.7s (suite completa 509 tests), `./internal/domain` ok, `./db` ok 0.25s (migraciones fresh). EXIT=0.
- TS: `pnpm typecheck` 8/8 paquetes ✓; `pnpm test` completo ✓ (storage 258 tests, incluidos los 5 nuevos); drift `check_openapi_drift.py` ✓ ("operation drift negative proofs passed"); ci-tests/factory-tests unittest ✓.
- HEAD entregado: commits `9ad0cdca` (backend), `5797c793` (contrato), `1460bf92` (web storage) sobre `7bc18e5e`.

## 4. Decisiones y límites

- El schema `HardwareWrite` declara `machining` como sobre `object|null` con `additionalProperties: true`: la forma canónica del JSONB F127 vive en su contrato de paridad; duplicarla aquí sería una segunda fuente de verdad.
- `ReactivateHardware` (storage) queda sin guard y sin llamadores — código muerto pre-existente, fuera del alcance; se retire o guarde en slice 2/3.
- Los tests handler `TestHardwarePut_VisualBindingResolvedServerSide` / `TestHardwarePut_ExistingBindingToRetiredAssetPreserved` y `TestHandleHardwareByIDUpdateCleansReplacedImage` se actualizaron AL nuevo contrato (header If-Match), nombres intactos.
- Browser proof completo queda para el cierre de #443 (slice 3), según la issue #1084.
- V2 operativo: CI completa corre al push (gates browser/postgres/aggregate en CI, no en local).
