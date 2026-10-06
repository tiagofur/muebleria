# ODD — #1177: quitar un mueble del proyecto (UI para el comando `:remove`)

## Scope aprobado

Issue #1177 (`status:approved` 2026-10-06; el owner dio el adelante explícito y
eligió mantener el copy "Colocar" tal como está). Salida explícita y terminal
que no existía: quitar una unidad del proyecto desde la pestaña Proyecto del
dialog de SketchUp, consumiendo el comando backend ya construido y huérfano
(`POST /api/furniture-instances/{id}:remove` — #385/DT-1). Sin cambios de
backend, contrato OpenAPI ni migraciones: sólo su consumo.

## Cambios

- **Contract Ruby** (`connection/project_furniture_contract.rb`): `Instance`
  y su parser fail-closed exigen `version` (Integer ≥ 1, presente en el DTO
  real `toFurnitureInstanceDTO`). Es el token If-Match del comando.
- **Service** (`connection/project_furniture.rb`): nuevo
  `remove_furniture_instance(instance_id, expected_version:)` → POST
  `:remove` con `If-Match: "v<N>"` (ETag fuerte del backend). Conflictos
  tipados del servidor llegan como `Service::Error` 409.
- **Placer#remove** — orden servidor → diseño → host:
  1. re-lectura FRESCA de la autoridad (`list_project_furniture`) para el
     guard active + la versión del If-Match — la fila del panel NO viaja con
     versión (refinement del ODD original: la fila puede quedar stale por un
     sync de posiciones y causar 409 espurios; la lectura fresca sigue
     optimista porque el 409 real del `:remove` se surfaca tipado);
  2. `drop_working_copy_item`: el item de la unidad sale del design working
     copy por el frontier canónico #810 (`DesignSync::SafeWrite`) — sin esto
     la card zombi "Identidad no vigente" sobreviviría hasta un sync manual.
     Falla → flag honesto `designPending` (la unidad YA está removida del
     proyecto; "Sincronizar diseño" converge después);
  3. `erase_local_unit`: la entidad gestionada local se borra con
     `FurnitureBuilder#rollback_placement` (erase + purge en una operación
     undoable). Duplicados o fallo de erase → flag `localPending` con razón;
     éxito → `localErased` (marca save-pending en el bridge).
- **Bridge** (`ui/bridges/project_furniture_bridge.rb`): callback
  `remove_project_furniture` + `handle_remove_project_furniture` (guard
  `mutation_coordinator.busy?` como restore; refresca el panel SIEMPRE — éxito
  dropea la fila, 409 refresca la fuente del If-Match para el reintento).
- **dialog.html**: delegación `onRemoveFurnitureResult` en GraneteDialog.
- **Panel JS** (`resources/js/granete-project-furniture.js`): botón danger
  "Quitar del proyecto" (papelera) en toda card con identidad viva del
  proyecto (excluye `terminal_or_orphan_local` / `unknown` / sin id);
  confirmación en dos pasos dentro de la card sin modal (`removeArmed` se
  desarma con cualquier render de autoridad fresca); caveat comercial honesto
  en la confirmación (la verdad de cantidades vive en la Q — puede
  re-materializarse desde la web); gating cruzado de acciones en vuelo
  (`pfRemoving`); `handleRemoveFurnitureResult` con toasts diferenciados
  (éxito / designPending → info "Sincronizá diseño" / localPending → error
  con razón / conflict → reintento honesto).
- **Versión**: EXTENSION_VERSION 0.1.45 → 0.1.46 (RBZ reconstruido,
  sha256 bf2c4abb…).

## Riesgos / no goals (confirmados)

- Carril #870/#977 INTACTO: borrar el componente en el modelo sigue siendo
  recuperable. El botón es la decisión explícita y terminal.
- Identidad nunca destruida: `lifecycle_status='removed'` auditable;
  `MaterializeQuoteLine` desvincula removed; el requote deriva del diseño.
- No editar líneas de cotización desde SketchUp; sin botón en la web; sin
  cambios de backend.
- Aceptación #6 (aviso "cuando esté vinculada a línea vigente") implementada
  como caveat condicional-fraseado en TODA confirmación: la API no expone el
  estado de vínculo por unidad y exponerlo sería scope backend (excluido).
  El copy condicional nunca miente.

## Verificación

- V0: rubocop limpio en archivos tocados; `rake verify` (syntax + lint +
  package readback) VERDE; RBZ determinista verificado.
- V1: suite completa del plugin VERDE — unit 1375 runs / 0 fallos (incluye
  harness JS del módulo 68/68, harness dialog 27/27 y placement preview,
  tests nuevos del remove: If-Match `"v3"` desde lectura fresca, terminal/
  not_found/409 tipado, WC drop verbatim de otros items, designPending en
  conflicto WC, erase local real, localPending por erase-failed y
  duplicados, contract version fail-closed) + boundary 6 runs / 4047
  assertions. Contrato JS exacto actualizado (API + missing card 3 hijos).
- V2 (owner, host real): pendiente — instalar RBZ 0.1.46, relaunch, quitar
  una pendiente; quitar una colocada (desaparece del modelo y de la lista);
  verificar que una Q vigente muestra el caveat y el requote no trae el
  mueble.

## Entrega

Un PR, `Closes #1177 + Delivery: complete` (pendiente del smoke V2 del owner
antes del merge), un escritor, rama aislada `feat/1177-quitar-mueble-proyecto`,
base main @480a29b5.
