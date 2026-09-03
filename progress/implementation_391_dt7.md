# Implementación #391 DT-7 — Detect and resolve duplicated managed furniture identity in SketchUp

- Fecha: 2026-09-03
- Branch: `feat/391-duplicate-furniture-instance-identity`
- Modo: Demo Commercial Rescue Mode

---

## 1. Resumen de la Solución

El objetivo de la issue #391 DT-7 es asegurar que una copia física de un mueble en SketchUp (Copy / Paste / Move+Copy) nunca termine con dos entidades compartiendo la misma identidad de negocio (`furnitureInstanceId`).

### Flujo implementado
1. **Detección de duplicados**:
   - `EntitiesObserver` observa eventos `onElementAdded` en `Sketchup.active_model.entities`.
   - `DuplicateResolver` analiza la entidad agregada. Si tiene metadatos de mueble gestionado con un `furnitureInstanceId` que ya existe en otra entidad del modelo, se detecta la duplicación.
   - También existe `rescan_and_resolve` para el momento de abrir o reabrir un modelo guardado con duplicados.
2. **Discriminación de Original vs Copia**:
   - Utiliza evidencia técnica autoritativa: el `technical_client_locator` (persistent_id de SketchUp) registrado en el `DesignWorkingCopy` del Backend.
   - La entidad cuyo `persistent_id` coincide con el del WorkingCopy se mantiene como la original intacta (conserva ID, metadatos y nombre).
   - La otra entidad se clasifica como la copia a renombrar y sincronizar.
   - Si no hay evidencia autoritativa (ambigüedad), ninguna se adivina: ambas quedan marcadas en estado explícito `duplicateStatus = 'unresolved'`, bloqueando el precheck de publicación.
3. **Autoridad del Backend (Server Authority)**:
   - SketchUp NUNCA genera IDs de negocio localmente.
   - Se llama al endpoint `POST /projects/{projectId}/furniture-instances/{instanceId}:duplicate` con `origin = 'duplicate'` y `origin_furniture_instance_id = source_id`.
   - Se envía una Idempotency-Key determinista: `"dup:#{project_id}:#{design_id}:#{source_furniture_instance_id}:#{copied_persistent_id}"`.
   - El Backend crea la nueva fila en `project_furniture_instances` dentro de la transacción del tenant, garantizando aislamiento RLS y que ambas instancias pertenezcan al mismo proyecto.
4. **Reescritura de la Copia**:
   - La copia recibe el nuevo `furnitureInstanceId` del backend en su diccionario de atributos.
   - Metadatos actualizados: `origin = 'duplicate'`, `originFurnitureInstanceId = source_id`.
   - Se limpian `duplicateStatus` y marcas temporales.
   - Se actualiza el nombre visible de la entidad en SketchUp si contenía el ID anterior.
5. **Sincronización con DesignWorkingCopy**:
   - Se agrega el nuevo ítem al `DesignWorkingCopy` con su transformación espacial actual (en mm y grados extrínsecos XYZ) y su `technical_client_locator`.
6. **Precheck de Publicación (#391 DT-7 §21-22)**:
   - Se implementa `validate_managed_furniture_identity` / `validate_model`.
   - Detecta duplicados no resueltos, formatos de UUID inventados localmente, identidades de proyectos ajenos y entidades con `duplicateStatus = 'unresolved'`.

---

## 2. Evidencia de Negative Proofs y Reglas de Negocio

1. **Proof 1: Duplicado simple genera nuevo ID de Backend y reescribe solo la copia**
   - Test: `test_simple_copy_creates_new_backend_id_and_rewrites_copy_only`
   - Verificado: La copia recibe el nuevo ID emitido por el backend; el original conserva su ID.

2. **Proof 2: Idempotencia en callbacks repetidos**
   - Test: `test_repeated_resolution_is_idempotent`
   - Verificado: El envío repetido con la misma clave idempotente no duplica llamadas al backend ni genera IDs extras.

3. **Proof 3: El original preserva su ID y metadatos intactos**
   - Test: `test_original_preserves_its_id_and_metadata`
   - Verificado: `original.name` y su `furnitureInstanceId` no son alterados por la resolución de la copia.

4. **Proof 4: Fallo de servidor deja la copia en estado unresolved sin borrarla**
   - Test: `test_server_failure_leaves_copy_unresolved_without_deleting_it`
   - Verificado: Ante error 500 / red, la geometría de la copia NO se destruye; se marca `duplicateStatus = 'unresolved'`.

5. **Proof 5: Rescan al reabrir modelo resuelve usando evidencia del WorkingCopy**
   - Test: `test_reopen_duplicate_rescan_resolves_using_working_copy_evidence`
   - Verificado: Modelos con duplicados persistidos se resuelven al reabrir utilizando el locator almacenado en el WorkingCopy.

6. **Proof 6: Guardar y reabrir modelo ya resuelto NO crea instancias extras**
   - Test: `test_save_reopen_resolved_does_not_create_extra_instances`
   - Verificado: Una vez resueltos con IDs distintos, abrir el modelo no dispara llamadas de duplicación ni altera nada.

7. **Proof 7: UUID inventado localmente es rechazado por el precheck**
   - Test: `test_validate_model_detects_random_or_fake_uuid`
   - Verificado: IDs no conformes con UUID v4 son detectados y reportados como `invalid_furniture_identity`.

8. **Proof 8: Identidad de proyecto ajeno es rechazada por el precheck**
   - Test: `test_validate_model_detects_foreign_project_identity`
   - Verificado: Muebles copiados de otro proyecto con ID de proyecto diferente son reportados como `foreign_project_identity`.

9. **Proof 9: ComponentDefinition no es identidad de negocio**
   - Test: `test_component_definition_is_not_identity`
   - Verificado: Dos instancias pueden compartir la misma `ComponentDefinition` (mismo mueble base del catálogo) y tener identidades de negocio independientes sin considerarse duplicados.

10. **Proof 10: Ambigüedad sin evidencia de WorkingCopy marca unresolved**
    - Test: `test_ambiguous_duplicate_without_locator_evidence_marks_unresolved`
    - Verificado: Si no se puede determinar cuál es el original, ambas quedan en `unresolved` sin adivinar.

11. **Proof 11: Integración con EntitiesObserver**
    - Test: `test_entities_observer_dispatches_to_resolver`
    - Verificado: Eventos de adición despachan al resolver y procesan la resolución adecuadamente.

---

## 3. Pruebas Automatizadas Ejecutadas

### SketchUp Extension (Ruby Unit Tests)
```bash
eval "$(rbenv init -)" && bundle exec rake unit
372 runs, 3064 assertions, 0 failures, 0 errors, 0 skips
```

### Backend Go (API + Storage PostgreSQL)
```bash
go test -v -run TestHandleFurnitureInstanceDuplicate ./internal/api
=== RUN   TestHandleFurnitureInstanceDuplicate_HappyPath
--- PASS: TestHandleFurnitureInstanceDuplicate_HappyPath (0.00s)
=== RUN   TestHandleFurnitureInstanceDuplicate_Idempotency
--- PASS: TestHandleFurnitureInstanceDuplicate_Idempotency (0.00s)
=== RUN   TestHandleFurnitureInstanceDuplicate_RoleGuard
--- PASS: TestHandleFurnitureInstanceDuplicate_RoleGuard (0.00s)
=== RUN   TestHandleFurnitureInstanceDuplicate_InvalidUUID
--- PASS: TestHandleFurnitureInstanceDuplicate_InvalidUUID (0.00s)
=== RUN   TestHandleFurnitureInstanceDuplicate_Errors
--- PASS: TestHandleFurnitureInstanceDuplicate_Errors (0.00s)
PASS

go test ./internal/storage -run TestFurnitureInstances_Duplicate
PASS: TestFurnitureInstances_Duplicate
```

### Contratos y Calidad de Monorepo
```bash
pnpm openapi:check
# OpenAPI generated files are current; operation drift negative proofs passed (0 drift)

pnpm typecheck
# 7 of 8 workspace projects typechecked with 0 errors

pnpm test
# 33 test files passed, 411 tests passed with 0 errors
```
