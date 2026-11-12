# odd/tasks/1606-delete-option-group-persist

Issue: #1606 — eliminar un grupo de opciones / selector de accesorio del juego persiste en el backend y no desaparece sólo en pantalla ante fallo.
Lane: Delegated Direct. Writer: sesión 11-12. Base: origin/main `b26cf569`. Rama: `feat/1606-delete-option-group` (worktree `1606-delete-option-group`).

## Outcome observable

Al eliminar un grupo de opciones (o un selector de accesorios del juego desde la ficha de herrajes), la baja se ejecuta realmente en el servidor bajo `If-Match: "v<version>"` (#1091). Si la llamada al backend falla o es rechazada, el grupo **permanece visible en el catálogo local y en pantalla** (con mensaje de error visible y botón de reintento re-habilitado), en lugar de desaparecer "sólo en pantalla" dejando el grupo huérfano en PostgreSQL.

## Causa raíz

1. En el backend Go, todos los endpoints de eliminación del catálogo (`DELETE /api/catalog/option-groups/{id}`) exigen estrictamente `If-Match: "v<version>"` (`RequireIfMatch`, #1091).
2. En el frontend, `hardDeleteOnAuth` en `stores/catalog/shared.ts` enviaba `DELETE` directo sin la cabecera `If-Match`, por lo que el servidor siempre respondía `428 Precondition Required`.
3. En el store `optionGroups.ts`, `deleteOptionGroup` llamaba a `patchSaved` (mutación optimista local) **antes** de `hardDeleteOnAuth`, sin rollback ante fallo. Por lo tanto, el grupo desaparecía de la UI de inmediato, pero la eliminación en backend fallaba silenciosamente en 428 y el grupo seguía vivo en la base de datos (reapareciendo tras recargar o bloqueando resolvers en SketchUp).
4. `OptionGroup` en el dominio TS y en `optionGroupFromApi` descartaban el campo `version` que `ListOptionGroups` siempre envió.

## Fix

- **Dominio y mappers**: `OptionGroup` en `@granete/domain` añade `readonly version?: number;` y `optionGroupFromApi` preserva `raw.version`.
- **`hardDeleteOnAuth` (`shared.ts`)**: acepta `options?: { expectedVersion?: number }`. Si se proporciona la versión, envía `If-Match: "v<expectedVersion>"` directamente. Si se omite, realiza un `GET` previo para aprender el `ETag` / `version` actual (tratando 404 como ya eliminado). En `DELETE`, un 404 se trata como éxito idempotente.
- **`deleteOptionGroup` (`optionGroups.ts`)**: envía la versión conocida a `hardDeleteOnAuth`. Si `hardDeleteOnAuth` falla, **aborta sin mutar el catálogo local**, preservando el grupo en pantalla para permitir reintentar ("nunca desaparecer sólo en pantalla").
- **UI (`HardwareKitAccessoriesSection.tsx`)**: el botón de eliminar selector muestra estado de carga (`Eliminando…`) y se deshabilita mientras viaja la promesa; si falla, se restaura a `Eliminar selector` y se rehabilita.
- **Backend tests**: `backend-go/internal/api/catalog_ifmatch_families_test.go` añade tests para `DELETE /api/catalog/option-groups/{id}`:
  - Sin `If-Match` responde 428.
  - Con `If-Match` válido borra y responde 200.
  - Con `If-Match` stale responde 412 `VERSION_CONFLICT`.
- **Web tests**: `apps/web/src/stores/catalogStore.test.ts` añade cobertura completa:
  - Modo guest: borra local sin llamadas de red.
  - Modo auth con versión conocida: envía `DELETE` con `If-Match: "v1"`.
  - Modo auth con versión desconocida: realiza `GET` para aprender versión y luego `DELETE` con `If-Match: "v3"`.
  - Modo auth ante fallo (500): el grupo **permanece en el catálogo local** y emite toast de error.

## Verificación

- V0: `pnpm typecheck` limpio en todos los paquetes; `gofmt` y `go vet` limpios.
- V1 Web: `vitest run src/stores/catalogStore.test.ts` (63/63 tests PASS).
- V1 UI: `vitest run src/catalogs/hardware/HardwareKitAccessoriesSection.test.tsx` (2/2 PASS) y suite `src/catalogs/hardware` (91/91 PASS).
- V1 Go: `go test -count=1 ./internal/api -run TestCatalogSimpleFamilies_IfMatchGuardsWrites` (PASS).
