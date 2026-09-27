# Project Furniture: save/reopen, identidad y diagnóstico de intermitencias

> Owner: [#873](https://github.com/tiagofur/muebleria/issues/873). Decisión de seguimiento: 2026-09-27.
> Estado: **causa original indeterminada**. Especificación de diagnóstico/aceptación; no fix de producto certificado.
> Base de revisión: `b5697951021f6484cf3e71161ec396ff6f434194`. Revalidar HEAD, issue, PR y reservas antes de trabajar.

## H1. Retomar y separar autoridades

Leer #873 y este documento, después `AGENTS.md`, `apps/sketchup-extension/AGENTS.md` y `docs/demo/software-factory-human-start.md` según el alcance exacto. El writer existente conserva su rama/host. Artefacto de ejecución comunicado: `odd/tasks/873-pf-save-reopen-lifecycle.md`; no crear otro ODD ni escribir sobre trabajo local que esta documentación no contiene.

Esta entrega es documental. El candidato reportado `fix/873-pf-save-reopen-lifecycle` era tests-only y no estaba publicado al preparar la revisión. Los logs completos, diff y hashes finales deben entregarse por ese writer. No se inspeccionó su worktree del Mac ni se reejecutó TestUp desde esta documentación.

#821 conserva autoridad de materiales; #870/#871 recuperación explícita; #470 selección/overlay; #354 prueba integrada. #676 y el programa de uniones/CNC son carriles independientes. Un diagnóstico de host no autoriza tocar todos esos owners.

## H2. Hechos reportados, hipótesis y retractación

La issue original reportó: identidad ausente tras save/close/reopen, dos raíces con la misma identidad, conteos mayores en pruebas de contexto anidado/dos unidades y rol INTERIOR ausente. Se conservan como síntomas históricos, no se convierten en hechos causales.

El checkpoint del implementador reportó ejecuciones posteriores verdes con bases/condiciones distintas y un gate final del smoke endurecido. No volver a sumar los bloques narrativos repetidos ni llamar a todas las corridas pruebas de current main: algunas se hicieron en eafc014f. La contabilidad necesita run IDs únicos, base/RBZ/test hash, seed y configuración.

La atribución del primer commit malo a `db44b5ad..6cb68626` se retira como conclusión demostrada: se basaba en corridas aisladas de un flake. La ausencia posterior de fallos NO demuestra independencia de código, seed, carga o ambiente.

| Observación | Deducción permitida | Causa que no queda demostrada |
|---|---|---|
| Dos raíces con igual FurnitureInstance | Invariante de identidad violada en el estado inspeccionado | Que file_new necesariamente haya fallado |
| locate devuelve nil | No se encontró la entidad en esa consulta | Que save necesariamente guardó otro documento |
| Rol INTERIOR ausente | Estructura/metadata esperada no encontrada | Que necesariamente se seleccionó una raíz vieja |
| Reset omitido por inyección hace fallar guard | El detector encuentra esa condición controlada | Reproducción del disparador histórico |
| Racha posterior verde | No se reprodujo bajo las condiciones registradas | Producto exonerado o causa exclusivamente TEST INFRA |

Clasificación vigente: fallo original no reproducido en los intentos posteriores reportados; causa raíz indeterminada; cambio/interferencia de documento activo como hipótesis; candidato de hardening/diagnóstico; corrección causal no demostrada. No usar «única explicación consistente», «producto exonerado» o «lifecycle fix listo» como hechos.

## H3. Identidad del modelo: no usar GUID como prueba única

La [documentación oficial de Model#guid](https://ruby.sketchup.com/Sketchup/Model.html#guid-instance_method) indica que cambia después de modificar y guardar el modelo. No es identidad inmutable del documento en memoria. Un cambio de GUID no demuestra cambio externo de documento; puede conservarse como observación de diagnóstico.

Separar modelo abierto esperado, modelo realmente activo, archivo de prueba guardado/reabierto e identidad comercial del mueble. Conservar referencias vivas por fase y validar en el host objetivo la comparación de identidad usada. Un object_id numérico aislado tras perder su referencia tampoco establece identidad persistente. Después de un reopen intencional capturar y validar la nueva fase: no exigir el mismo objeto Ruby anterior.

No ocultar un cambio de active_model haciendo que el helper `model` siempre devuelva un modelo cacheado. Operar sobre el sujeto esperado y comprobar cuál está activo son responsabilidades diferentes. Mantener coherencia entre model, metadata_store y builder.

Fuentes primarias adicionales: [Sketchup.active_model](https://ruby.sketchup.com/Sketchup.html#active_model-class_method), [AppObserver](https://ruby.sketchup.com/Sketchup/AppObserver.html). Esas APIs permiten observar creación/apertura/activación; su existencia no demuestra que un callback causó el flake.

## H4. Aserciones por fases antes y después de guardar

El smoke de la base en `apps/sketchup-extension/test/testup/TC_ProjectFurnitureSmoke.rb`, método `test_placed_identity_survives_save_close_and_reopen`, no comprobaba el retorno de place antes de guardar. Revisar el candidato y cerrar esa brecha sin atribuirle automáticamente la causa.

Secuencia mínima verificable:

```text
reset verificado
→ modelo esperado y activo identificados
→ place devuelve éxito
→ entidad válida en ese modelo + identidad exacta + una raíz antes de save
→ guardar ese modelo en archivo de prueba previsto y comprobar resultado
→ abrir el archivo de prueba previsto y establecer nueva fase
→ comprobar identidad/raíces/configuración exactas
→ select → save → reopen y repetir invariantes
```

Una ausencia ya presente antes de save no se etiqueta como fallo de reopen. No basta con metadata no vacía: comparar parámetros/materialChoices, IDs y transform que el caso promete conservar. Entidades/definiciones iniciales se validan contra la plantilla de prueba declarada; no purgar basura después de crear para que pase.

Estado aceptado: cada unidad colocada tiene una raíz; unidad ausente legítimamente, cero. Los tests negativos pueden crear dos raíces intencionalmente: deben detectarlas como estado inválido, nunca deduplicarlas para simular éxito. Reconciliar/abrir/seleccionar no crea muebles ni dispara restauración implícita.

## H5. Witness mínimo y seguro

Registrar una traza acotada en memoria alrededor de reset/place/save/open/locate, con fase, run/test/seed, referencia esperada/activa, GUID como observación, resultado y conteos/IDs pertinentes. Escribir el witness **antes** del teardown que limpia evidencia y sólo cuando falle; límites de tamaño explícitos.

Sanitizar ruta privada, credenciales, datos comerciales y payloads. Identificar archivo de fixture sin copiar modelos del cliente. Usar ruta de artefactos calculada desde la raíz/configuración de pruebas verificada; probar que el witness no termina por error en `apps/progress`. No añadir fixtures de clientes a Git.

Etiquetas neutrales propuestas: `MODEL_RESET_PRECONDITION_FAILED`, `ACTIVE_MODEL_CHANGED_UNEXPECTEDLY`, `EXPECTED_FURNITURE_IDENTITY_MISSING`. Nombrar la invariante, no atribuir automáticamente «external race».

Si se necesita AppObserver temporal, hacerlo pasivo, mínimo y desmontarlo con garantías. No agregar telemetría/coordinadores a producto. Un fallo al escribir witness conserva la excepción original y no contamina el siguiente test. Instrumentación que no escribe al pasar debe ejercitarse con fallo controlado tras cualquier modificación final de ruta.

## H6. Pruebas discriminantes

| ID | Prueba | Qué debe demostrar |
|---|---|---|
| PF01 | Modificar y guardar el mismo modelo | Cambio de GUID no produce falso diagnóstico externo |
| PF02 | Omitir reset o iniciar fixture contaminada de forma controlada | Guard falla antes de colocar y conserva witness |
| PF03 | Cambiar documento activo después de setup bajo control del harness | Se detecta en la fase correcta; setup solo no basta |
| PF04 | Introducir identidad ausente/duplicada sin cambiar de documento | Error de identidad, no inferencia obligatoria de carrera externa |
| PF05 | Place/save/reopen/select/save/reopen | Una raíz, IDs, parámetros, materialChoices y transform esperados exactos |
| PF06 | Fallar escritura del witness | Excepción original preservada; soporte desmontado |
| PF07 | Regresión #870/#871 | Restaurar y colocar manualmente siguen explícitos y conservan identidad |

Inyección controlada prueba el detector; no se denomina reproducción natural. No sleeps arbitrarios, retries para pasar, orden fijo correctivo, skips nuevos, cambio de IDs para ocultar contaminación, purga correctiva o dedup después de crear. Cada caso usa modelos/archivos descartables, nunca cierra, guarda, mata ni fuerza la sesión del propietario.

La observación con diálogo cerrado sólo caracteriza ese modo. No certifica flujo con diálogo abierto; cuando una hipótesis necesite esa frontera, planificar su prueba exacta bajo #873/#354 en host aislado. No declarar benigno universal un callback a partir del único modo CI inspeccionado.

## H7. Entrega parcial y criterio de cierre

Una ronda focalizada: corregir inferencias/documentación, comprobar señales del guard, añadir aserciones pre-save, ejecutar PF01–PF07 aplicables y gates vigentes del candidato. No gastar otra batería extensa sólo buscando una racha verde. Ante falta de entorno registrar BLOCKED/NOT_RUN por capa, no aprobar por conteo acumulado.

Inventario por ejecución: run ID único, commit/base, digest del diff si aún no hay commit, hash completo RBZ e instalación, hash tests/config, versión SketchUp/OS, seed, diálogo/configuración y expected/actual. Tras corregir, congelar commit y obtener revisión independiente del exacto HEAD/base; anteriores pases no validan cambios posteriores.

El PR de hardening puede ser parcial: `Refs #873` y `Delivery: partial`. Conserva abierta la causa. Esta documentación no requiere reproducir el fallo histórico para aceptar una mejora de diagnóstico, pero tampoco permite cerrarlo como FIXED porque se entregó el detector.

Para una afirmación posterior de corrección causal: witness/reproductor que distinga hipótesis, mecanismo exacto responsable, cambio mínimo del owner correcto, RED/GREEN y regresiones aplicables en host real. Si no se logra causa y el propietario decide aceptar riesgo residual, registrar esa decisión como tal; no convertirla retroactivamente en prueba de TEST INFRA.

Antes del handoff, publicar artefactos sanitizados y links reales, readback del PR/CI/revisión y limitaciones. No merge automático, etiquetas protegidas por conveniencia ni cierre por API. El estado vivo queda en #873; este documento conserva cómo seguir sin depender del autor de la conversación.
