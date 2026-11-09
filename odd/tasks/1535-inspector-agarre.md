# #1535 — [SketchUp] Inspector: agarre del proyecto sin selección y excepción por mueble

Lane: Delegated Direct (backend acotado + plugin Ruby/JS + pruebas). Writer: esta sesión (worktree `1535-inspector-agarre`, rama `feat/1535-inspector-agarre`, base origin/main 8b621c85).
Prerrequisito UX: brief publicado y aprobado por el owner (comentario #6749341728, 2026-11-09); suposiciones honradas.

## Alcance ejecutado
1. Backend: el 422 de grip lleva el código en `details.reason` (mismo envelope que la fachada de apertura) — el mapa del taller del plugin puede nombrar acción y lugar. La oración del taller se compone desde el reporte del GET de #1532 (alturas A3, descuentos aplicados, modo por posición) — sin anchos/BOM que el servidor no resuelve (suposición 2 del brief).
2. Ruby: bridge `project_grip_bridge.rb` (get_project_grip / apply_project_grip_style / apply_project_grip_furniture / undo / redo) con estado de intención POR PROYECTO (ProjectGripSessionState), If-Match "v<versión>" desde el último GET/PUT, 412 tipado en el HTTP (antes caía a «respuesta inesperada»), rechazo de proyectos ajenos en el propio bridge, undo/redo como re-PUT de la intención previa/siguiente. El transport muerto de la fachada `/designs/{id}/opening` se retira (design_opening_bridge + su test); los accessors compartidos (design_opening_placer/binding_store) migran al geometry bridge que los comparten sync/canal/proyect-furniture.
3. JS: módulo `granete-grip.js` — estado indexado por proyecto, descarte de respuestas tardías ajenas (proyecto o requestId), las tres superficies («Agarre del proyecto» sin selección, tarjeta «Agarre» por mueble con badge Hereda/Excepción, bloque del lote con «Aplicar a N muebles»), oración del taller desde el reporte, mapa GRIP_* en español con acción y lugar, banner 412 con Recargar, radiogroup accesible y aria-live en el resultado.
4. Retiro: las dos tarjetas «Apertura del diseño» y su módulo (granete-opening.js + harness) desaparecen; «Apertura y presentación» → «Apertura» (vaivén y presentación, §14.7); ningún texto visible contiene códigos OPENING_.
5. RBZ 0.1.108 (identity.rb).

## Evidencia
- Ruby: rake unit 1478 runs / 0 fallos (incluye granete_grip_test.js 11 casos: 6 estados + tardías por proyecto + intenciones; harness del inspector 54; registro de callbacks y loader al día); rubocop 0 ofensas; rake verify verde (RBZ firmado); git diff --check limpio.
- Host real (SketchUp 2026, RBZ 0.1.108 instalado en Plugins): **TC_ProjectGripSmoke 5 corridas / 20 aserciones / 0 fallos** vía TestUp::API.run_suite_without_gui — intención de estilo sin selección con If-Match del último GET y deshacer/rehacer por re-PUT, excepción de UN mueble, excepción de N muebles en UNA operación, rechazo de proyecto ajeno (stale_binding) y modelo sin vincular con el motivo del taller. Nota de host: Model#delete_attribute no borra — el clear usa cadena vacía (el store la trata como ausencia).
- Backend: go test domain/domain-engine/api/storage ok.
- Hallazgos corregidos durante el host run: contrato camelCase (JS manda projectId; el bridge leía project_id — la guarda de proyecto ajeno estaba muerta) y el quirk de delete_attribute.

## Pendiente (vivo owner)
- Los 5 escenarios de aceptación en flujo COMPLETO con servidor y proyecto vinculados (elegir estilo viendo el dialog, heredar, excepción, aplicar a 3, deshacer con Ctrl+Z del host) — el TC de host cubre los mismos flujos a nivel bridge con servicio de grabación; el vivo del dialog queda para la verificación del owner junto con #1536 (representación).

## Entrega
Un PR contra main. Los criterios de la issue cubiertos: pruebas JS de los 6 estados ✓, cero tarjetas «Apertura del diseño» y cero OPENING_ visibles ✓ (asertado por el harness y el runner Ruby), TestUp en host real ✓ (nivel bridge), respuestas tardías indexadas por proyecto ✓ (unit + bridge). Brief honrado: https://github.com/tiagofur/muebleria/issues/1535#issuecomment-6749341728
