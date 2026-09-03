# Resumen de Implementación — #390 DT-6 (Catalog → Backend FurnitureInstance → SketchUp → DesignWorkingCopy)

## Contexto y Objetivo
En el flujo Design-first, cuando un usuario selecciona y configura un mueble desde el catálogo de la extensión de SketchUp:
1. El backend crea primero la identidad autoritativa (`FurnitureInstance.id`) con origen `design`.
2. SketchUp coloca esa misma instancia en el modelo (`model.entities`).
3. Al confirmar la posición, el `DesignWorkingCopy` se actualiza referenciando esa misma identidad y preservando parámetros y elecciones de materiales.

## Reglas Duras e Invariantes Verificados
- **Identidad Server-Authoritative**: SketchUp nunca genera business IDs. `POST /api/projects/{projectId}/furniture-instances` asigna el UUID autoritativo.
- **Origen autoritativo**: Para clientes de autoría (SketchUp extension bearer token), el backend estampa `origin = "design"`, sin confiar en payloads del cliente.
- **Least-privilege en Middleware**: Se habilitó el patrón `^/api/projects/[^/]+/furniture-instances$` en `extensionTokenMayPostPatterns` para el cliente de extensión.
- **Idempotencia**: Se pasa el header `Idempotency-Key` en la creación para evitar duplicados en reintentos.
- **Sin borrado destructivo**: Si la inserción local falla o el usuario cancela la colocación, la entidad en el backend permanece activa en el proyecto (pendiente de colocación en el diseño). Nunca se emite un DELETE al backend.
- **Parámetros y Materiales**: Los parámetros configurados y la selección de materiales (`materialChoices`) se conservan a través de la colocación y se persisten en el `DesignWorkingCopy`.

## Archivos Modificados

### Backend (Go)
- `backend-go/internal/api/middleware.go`: Habilitado `POST /api/projects/{projectId}/furniture-instances` en `extensionTokenMayPostPatterns`.
- `backend-go/internal/api/furniture_instances.go`: Establece `origin = domain.FurnitureInstanceOriginDesign` cuando `claims.Client == auth.ExtensionClient`.
- `backend-go/internal/api/middleware_test.go`: Actualizado `TestExtensionClientBoundaryProjectFurniture`.
- `backend-go/internal/api/furniture_test.go`: Actualizado `TestExtensionTokenDenyByDefault`.
- `backend-go/internal/api/furniture_instances_test.go`: Añadido `TestHandleProjectFurnitureInstances_CreateExtensionClientSetsOriginDesign`.

### Extensión SketchUp (Ruby & HTML/JS)
- `apps/sketchup-extension/src/granete_for_sketchup/connection/project_furniture.rb`:
  - `Service#create_furniture_instance`: Envía `POST /projects/{projectId}/furniture-instances` con header `Idempotency-Key` y parsea respuesta 201.
  - `Placer#create_and_place`: Flujo completo que valida binding, crea en backend, inserta unidad localmente y devuelve estado `pending_position`.
  - `Placer#insert_created_unit`: Inserción local sin rollback destructivo en backend ante fallos locales.
- `apps/sketchup-extension/src/granete_for_sketchup/connection/project_furniture_contract.rb`:
  - `WorkingCopyMerger.catalog_parameters`: Fusión de defaults del catálogo con parámetros configurados.
  - `WorkingCopyMerger.resolve_layout`: Soporte para `material_choices`.
- `apps/sketchup-extension/src/granete_for_sketchup/ui/dialog_controller.rb`:
  - Registrado callback `create_project_furniture` y manejador `handle_create_project_furniture`.
- `apps/sketchup-extension/src/granete_for_sketchup/resources/dialog.html`:
  - `updateLibraryInsertButton`: Muestra "Agregar al diseño" cuando el modelo está conectado a un proyecto y diseño.
  - `btnInsert` click listener: Envía `create_project_furniture` con `idempotencyKey` generado y previene dobles clics.
  - Bridge callback `onCreateProjectFurnitureResult` y actualización de mensajes en `pfPlaceFailureMessage`.
- `apps/sketchup-extension/test/unit/application_test.rb`: Actualizada lista de callbacks esperados.
- `apps/sketchup-extension/test/unit/project_furniture_test.rb`: 6 nuevos tests unitarios que validan el flujo completo, idempotencia, fallos y preservación en working copy.
- `apps/sketchup-extension/test/js/dialog_project_furniture_test.js`: Mock y tests de despacho y manejo de resultados en el diálogo.

## Evidencia de Verificación
- `eval "$(rbenv init -)" && bundle exec rake unit`: 358 tests, 0 fallos, 0 errores.
- `node test/js/dialog_project_furniture_test.js`: 14 tests pasados.
- `go test ./...` en `backend-go`: Pasado con código 0.
- `pnpm openapi:check`: Pasado sin drift.
- `pnpm typecheck`: Pasado en todos los paquetes del workspace.
- `pnpm test`: 411 tests en 33 archivos pasados.
