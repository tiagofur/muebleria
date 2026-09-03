# Implementación #392 DT-8 — Publish immutable DesignRevision with manifest and 3D artifacts

- Fecha: 2026-09-03
- Branch: `feat/392-publish-design-revision`
- Modo: Demo Commercial Rescue Mode

---

## 1. Resumen de la Solución

El objetivo de la issue #392 DT-8 es cerrar el ciclo de publicación de un diseño modelado en SketchUp hacia la plataforma Granete, produciendo una `DesignRevision` inmutable acompañada de sus artefactos 3D (`model.skp`, `manifest.json`, `preview.png`), con verificación estricta de integridad (SHA-256) y avance del `baseRevisionId` en el modelo y en el `DesignWorkingCopy`.

### Flujo implementado
1. **Precheck de Identidad (#391 DT-7)**:
   - Reutiliza `DuplicateResolver.validate_model` / `validate_managed_furniture_identity`.
   - Bloquea la publicación si existen muebles duplicados no resueltos, `working_copy_unsynced`, IDs no válidos o de proyectos ajenos.
2. **Construcción del Manifiesto Semántico v1**:
   - `ManifestBuilder`: Recorre el modelo y filtra **exclusivamente** instancias gestionadas por Granete (`FurnitureInstance`).
   - Geometría no gestionada (paredes, plantas, decoración) es excluida de raíz (Negative Proof B).
   - Valida esquema v1: `projectId`, `designId`, `baseRevisionId`, `source` (client='sketchup', versions) e `items`.
3. **Sincronización Previa con DesignWorkingCopy**:
   - Asegura que las coordenadas y locators actuales en SketchUp estén sincronizados en el borrador de trabajo del servidor antes de preparar la sesión.
4. **Exportación de Artefactos Segura para el Host**:
   - `ArtifactExporter`: Guarda una copia limpia (`save_copy`) del `.skp`, genera el `manifest.json` y captura una preview (`write_image`) en un directorio temporal aislado (`with_temp_dir`).
   - El archivo activo del usuario nunca es modificado ni desplazado.
5. **Sesión de Publicación Escalonada (Prepare → Upload → Finalize)**:
   - `POST /api/designs/{id}/publish:prepare`: Valida el manifiesto contra el `DesignWorkingCopy` autoritativo y fija el `base_revision_id` bajo lock de diseño. Retorna `DesignPublishSession` con TTL de 24h.
   - `POST /api/designs/{id}/publish/{sessionId}/artifacts/{kind}`: Subida por streaming multipart (`MultipartBody`) de `model`, `manifest` y `preview`. El servidor calcula el hash SHA-256 autoritativo y lo almacena en `design_publish_artifacts`.
   - `Publisher` en SketchUp compara el SHA-256 devuelto por el servidor contra el SHA-256 calculado localmente antes de continuar.
   - `POST /api/designs/{id}/publish/{sessionId}:finalize`: Concurrencia optimista y serialización bajo lock `FOR UPDATE`. Valida que todos los artefactos requeridos existan, que no haya habido carreras sobre el `baseRevisionId`, crea la `DesignRevision` inmutable (`status='published'`), copia los ítems relacionales a `design_revision_items`, genera `design_revision_artifacts` inmutables y avanza el `base_revision_id` del `DesignWorkingCopy`.
6. **Avance de Base en SketchUp**:
   - Tras el éxito autoritativo, el plugin ejecuta `adopt_authoritative_base`, actualizando el diccionario de atributos del modelo a la nueva revisión (ej. R8).
   - La UI del panel se refresca mostrando `Base R8` y toast de éxito.

---

## 2. Evidencia de Negative Proofs y Reglas de Negocio

1. **Negative Proof A: Falla de precheck bloquea la publicación**
   - Si hay duplicados o muebles sin sincronizar, `publish` retorna error y no inicia sesión de subida ni crea revisiones.
2. **Negative Proof B: Geometría no gestionada excluida del manifiesto**
   - Paredes, plantas o luces en el modelo no entran en `manifest.json` ni en `design_revision_items`.
3. **Negative Proof C & D: IDs duplicados o desconocidos en el manifiesto**
   - El validador del backend y el esquema rechazan fail-closed cualquier duplicado o UUID ajeno al proyecto.
4. **Negative Proof F & G: Stale base y carrera entre prepare y finalize**
   - Finalize re-valida `base_revision_id` bajo lock de fila en `designs`. Si otra sesión publicó en el interín, finalize retorna 409 Conflict.
5. **Negative Proof H & I: Fallo en subida de artefactos**
   - Si falta `model`, `manifest` o `preview`, finalize es rechazado; no se crea ninguna revisión en la base de datos.
6. **Negative Proof J: Hash mismatch**
   - Si el hash calculado difiere del archivo exportado, la publicación se aborta inmediatamente.
7. **Negative Proof L: Idempotencia en Finalize**
   - Reintentar con la misma `Idempotency-Key` devuelve exactamente la misma revisión R8 sin crear R9.
8. **Negative Proof M: Aislamiento multi-organización**
   - Tablas `design_publish_sessions`, `design_publish_artifacts` y `design_revision_artifacts` están protegidas por RLS `explicitly-shared` con inventory en `rls_policy_inventory`. Descarga de artefactos firmada con token HMAC de media (`designart/`).

---

## 3. Verificación Ejecutada

- **OpenAPI Drift**: `pnpm openapi:check` -> PASS (sin drift).
- **TypeScript Typecheck**: `pnpm typecheck` -> PASS (7 proyectos limpios).
- **Monorepo Tests**: `pnpm test` -> PASS (1508 pruebas en UI, 411 en web).
- **Go Tests**:
  - `domain`: `go test ./internal/domain/...` -> PASS.
  - `api`: `go test ./internal/api/...` -> PASS.
  - `storage`: `go test -run "TestDesign" ./internal/storage/...` -> PASS (PostgreSQL real, migraciones 00001 a 00114 aplicadas).
- **SketchUp Ruby Tests**:
  - `unit`: 373 runs, 3099 assertions, 0 failures.
  - `boundary`: 3 runs, 1599 assertions, 0 failures (respetando restricciones de dependencias y términos prohibidos de manufactura).
  - `js`: `dialog_publish_test.js` -> 9 passed.
