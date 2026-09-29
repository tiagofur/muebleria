# ODD — #784 R3b: Furniture Inspector, pending edits con un solo Apply

- Issue: #784 (`[P1][SU-UX-4] Design defaults, inheritance and contextual Inspector`), slice R3b.
- Autorización: prompt del owner 2026-09-29 (checkpoint pre-commit, sin commit/push/PR).
- Lane: ODD. Estado: IMPLEMENTED_PENDING_REVIEW (checkpoint aprobado por el owner 2026-09-29; PR publicado).
- Base: `origin/main` @ `376a08c9b5846cc5edd05056084097031cbca9ff` (#909 merged d2078079, #911 merged).
- Branch/worktree: `feat/784-r3b-pending-edits` @ `muebles-worktrees/784-r3b-pending-edits`.

## Objetivo

Las ediciones de parámetros y roles de material del Furniture Inspector van a un
draft local con footer de pendientes; un solo `[Aplicar]` emite UNA mutación
(`GraneteMutation.submitUpdate` → `update_furniture`) con el intent completo
(parámetros + materialChoices + materialChoiceModes) = un resolve = UNA operación
de SketchUp = un undo coherente. Replica en el mueble el patrón ratificado por R2
para los defaults del Design.

## Auditoría (obligatoria, previa a escribir)

### 1. Controles con mutación inmediata hoy

| Control | Camino | Nota |
| --- | --- | --- |
| `btn-update` "Actualizar Mueble" (dock) | `GraneteMutation.submitUpdate` → `host.update_furniture` | Commitea los snapshots de params+choices sin modes; dispara incluso con 0 cambios. |
| `applyRoleRestore` (R3, botón "Restaurar valor del diseño") | `submitUpdate` con `materialChoiceModes {role: design}` | Inmediato. |
| `onMaterialChoiceApplied` rama inspector (respuesta del selector nativo Ruby, `option_selector_bridge.rb`) | **Legacy directo** `window.sketchup.update_furniture(...)` — SIN GraneteMutation (sin busy guard ni máquina de fases) | Inmediato por cada pick. |

El param form onChange y el fallback JS del finish selector sólo escriben los
snapshots locales (`inspectorParams` / `inspectorMaterialChoices`): sin submit.

### 2. Acciones excluidas del draft (por contrato, quedan inmediatas)

- Eliminar (`btn-delete`): confirmación de dos clics propia + `canDelete`.
- Herrajes (colocación `submitHardwarePlacementUpdate`, sustitución
  `submitHardwareSubstitution`, ops de componentes `submitComponentMutation`):
  envelopes y contrato propios (#467/#468) del child Inspector.
- Batch editing (#471, `submitBatchUpdate`): carril de lote intacto.
- Defaults de proyecto de sesión (`setProjectDefaultMaterial`): sin mutación.
- Carriles Configurator y Design Inspector (R2 draft + PUT): intactos.

### 3. Cadena `materialChoiceModes` en `build_update_command`

COMPLETA para roles arbitrarios: payload JS `materialChoiceModes` (Hash
cualquiera) → `host_mutation_bridge.rb#build_update_command` (`raw_modes`) →
`apply_update_result(material_choice_modes:)` → `FurnitureBuilder#update_furniture`
→ `MetadataWriter.write_furniture`; el sync de working copy
(`project_furniture_contract.rb`) mergea los modes del intent. Falta sólo que el
draft emita modes en el payload del Apply.

### 4. Ciclo de vida del draft

- Ancla: snapshot del contexto (`parameters` + `materialChoices`) fijado en la
  primera edición (espíritu `draftBase` de R2). No hay token de versión
  cliente-visible en el camino `update_furniture`; la protección honesta es
  morir ante divergencia + los guards existentes (`context_valid?`, resolve
  server-side).
- Muere: cambio de selección real (otra ref/kind/null; misma ref con
  parámetros/choices divergentes = el server avanzó, sin rebase silencioso; la
  republicación idéntica de la misma ref sobrevive), cambio real de binding
  (nueva costura `inspector.onBindingStatus` en el orchestrator
  `onModelBindingStatus`, espíritu #906: sólo cambios reales), y fail-closed
  existente (multi/capacidad denegada deshabilita el fieldset completo).
- `[Descartar]` read-only; `[Aplicar]` con guard anti doble-submit
  (`submitUpdate` "busy" + disabled en flight); fallo conserva el draft y
  mensaje honesto; éxito limpia draft + `refreshInheritance()` (R3).

### 5. Tests que pinnean update inmediato → migración

- `granete_inspector_test.js`: "update: click payload…", "update: success…/failure
  rolls back", "update: no-host fallback", "materials: inspector target applies…",
  "R3 restore: applyRoleRestore emite…" → migran a draft+Apply (restore entra al
  draft con mode design; fallo conserva el draft en vez de rollback).
- `dialog_inspector_test.js`: flujos de click en `btn-update` (typed params,
  payload ref local) → migran a draft+Apply.
- `dialog_library_view_test.rb:186`: pin estructural `id="btn-update"` dentro del
  fieldset → se actualizará al footer (`btn-apply`/`btn-discard`).
- `TC_HostMutationSmoke#test_restore_materializes_current_default_with_design_mode`:
  sigue válido (nivel payload, build_update_command directo) — se conserva como
  regresión y se AÑADE el smoke R3b propio.
- No cambia la firma del builder ni callbacks Ruby → sin dobles que migrar.

## Decisión de UI (ratificada por el owner al aprobar el checkpoint)

`btn-update` ("Actualizar Mueble") se elimina; su lugar lo ocupa el footer del
draft dentro del fieldset de mutación: `inspector-pending` ("N cambios
pendientes") + `[Descartar]` (`btn-discard`) + `[Aplicar]` (`btn-apply`). El dock
conserva el resumen de medidas/piezas. Sin draft no hay footer (ni botón primario
de mutación, coherente con "una primary action contextual").

Semántica de modes en el Apply: rol editado por pick ⇒ `override`; rol restaurado
⇒ `design` (última acción por rol gana); un pick que vuelve al valor base
disuelve la entrada salvo marker de restore (corrección de linaje explícita).

## Tareas

- [x] Auditoría previa (este archivo).
- [x] RED: tests nuevos R3b en `granete_inspector_test.js` (draft/apply/guards).
- [x] Migración de tests JS existentes al modelo draft+Apply.
- [x] Implementación: draft + footer + Apply + onBindingStatus en
  `granete-inspector.js`; footer en `dialog.html`; costura en el orchestrator.
- [x] Pines estructurales Ruby actualizados (dialog_library_view_test,
  granete_material_roles_js_test).
- [x] Smoke R3b en `TC_HostMutationSmoke` (multi-campo → 1 op → metadata → undo).
- [x] V0/V1: JS harnesses + `rake verify` FULL (0 ofensas, 0 failures).
- [x] V2: TestUp exact-head (smoke R3b + regresión R1/R2/R3) + RBZ sha.
- [x] Checkpoint pre-commit para review del owner.

## Verificación (evidencia observada 2026-09-29)

- RED: `granete_inspector_test.js` falló en el primer aserto nuevo
  (`'' !== '1 cambio pendiente'`) antes de la implementación (el harness corre
  los tests secuencialmente: los siguientes no llegaron a ejecutarse).
- JS: `granete_inspector_test.js` 48/48 (14 tests R3b nuevos, 5 migrados),
  `dialog_inspector_test.js` 74/74, `granete_design_inspector_test.js` 33/33,
  `granete_inspector_child_test.js` 23/23, `host_mutation_test.js` 21/21,
  `granete_material_roles_test.js` 32/32 — sólo los dos primeros cambiaron.
- `rake verify` FULL (ruby 3.2.11, worktree): syntax OK, rubocop 274 files /
  0 offenses, unit 1267 runs / 9383 assertions / **0 failures, 0 errors**,
  boundary 6 runs / 4187 assertions / 0 failures, package:verify determinista.
- RBZ sha256: `e1857cda5d93b1c6dedfd94c7a2da97c3fc0ecc386f1597485828c365f220903`
  (v0.1.16, sin bump).
- V2 TestUp exact-head — SketchUp 2026 arm64 real, RBZ candidato instalado
  (Plugins, fail-closed checks del smoke en PASS), seed 10299:
  `progress/host_smoke_784_r3b_testup_ci.json` — **18/18, 109 assertions, 0
  failures, 0 errors**:
  - `TC_HostMutationSmoke` 8/8, incl. el nuevo
    `test_draft_apply_multi_field_intent_commits_one_operation_and_undo_reverts_all`
    (11 assertions: 1 start + 1 commit, metadata completa, UN undo revierte
    parámetros y materiales) + regresión restore R3.
  - `TC_DesignInspectorSmoke` 10/10 (regresión R1/R2/R3, incl. cero writes de
    working copy y un PUT por Apply del design).
  - Evidencia en archivo PROPIO; `host_smoke_784_r1/r3/r3_restore_*.json`
    intactos.
- Trabajos del draft sin mutación: los tests JS prueban 0 submitUpdate y 0
  `update_furniture` en ediciones; el único canal del Apply es
  `update_furniture` (mutación host) — el draft no emite PUTs de working copy.

## Límites / NO hecho (explícito)

- R4 herencia en inserción (bloqueada por follow-up Codex), R5 rollout,
  hardware/parameter defaults de Design, backend/contratos (intactos),
  `material_choice_sources` (intacto), carril batch y child/hardware
  (intactos).
- Sin commit/push/PR: entrega pre-commit para review del owner. La evidencia
  TestUp corresponde al árbol de trabajo del candidato (RBZ e1857cda…) en la
  base 376a08c9; el commit congelará el mismo árbol.
- Verificación local de 8 harnesses JS ajenos falla standalone por ambiente
  (idéntico en base limpia); dentro de `rake verify` unit: 0 failures.
