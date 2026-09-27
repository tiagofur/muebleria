# DXF de plan de corte: proyección e integridad — #676

> Decisión de salida autorizada el 2026-09-27. Owner: [#676](https://github.com/tiagofur/muebleria/issues/676).
> Especificación y handoff; **no afirma que el candidato local esté integrado ni que una CNC esté homologada**.
> Contexto: [construcción y uniones](../architecture/factory-construction-and-joinery.md), [perfiles/adapters](../architecture/machine-profiles-and-adapters.md), #348/#351/#354.

## D1. Qué se fija y qué no

La base inspeccionada `eafc014f0003dacb776a4cdf61ef5c0ceb04c5da` excluye perforaciones bajo `drillingByPiece && !p.rotated`. El reporte del implementador reproduce un rectángulo asimétrico cuyos agujeros desaparecen al rotarlo, aunque sus capas se declaren. Código: [exportador](../../packages/excel/src/dxfCutPlanExport.ts).

`CutPlanPlacedPiece.rotated` es booleano; el contrato histórico no registra sentido de giro ni correspondencia de esquinas. La nueva **política de proyección DXF** elige +90 grados antihorarios en XY, visto desde +Z hacia el plano, con X derecha/Y arriba. No redefine globalmente el optimizador, PTX ni el giro físico de piezas antiguas.

Ancla: mínimo del rectángulo resultante normalizado, no esquina original de la pieza. Espejo posterior en el marco local no rotado; después giro; por último traslación. Esta convención no es configurable por fábrica. Configuración constructiva y transformaciones específicas de máquina pertenecen a otros límites.

## D2. Fórmulas y fixture independiente

`u` longitudinal, `v` transversal; `L,W` dimensiones no rotadas en el MISMO marco que las perforaciones; `(X0,Y0)` origen del rectángulo de salida.

```text
front: (u,v) = (hole.yMm, hole.xMm)
back:  (u,v) = (hole.yMm, W-hole.xMm)  // espejo local ya previsto por el DXF

sin rotar: (X,Y) = (X0+u, Y0+v)
rotado:    (X,Y) = (X0+W-v, Y0+u)
```

El giro lineal `(-v,u)` se normaliza con `(W,0)`. Esquinas frontales: `(0,0)→(W,0)`, `(L,0)→(W,L)`, `(L,W)→(0,L)`, `(0,W)→(0,0)`. No aplicar espejo sobre Y de tablero después del giro ni dos espejos por error.

Fixture exclusivamente geométrica: `L=600,W=400,X0=1000,Y0=200`, dimensiones colocadas rotadas `400×600`, sin descuento dimensional. A frontal `xMm=40,yMm=100,diameterMm=5`; B posterior `xMm=70,yMm=450,diameterMm=8`. Profundidades explícitas compatibles con el fixture, no recetas de fabricante.

| Salida | A | B |
|---|---|---|
| Sin rotar | (1100,240) | (1450,530) |
| Rotada en tablero | (1360,300) | (1070,650) |
| Rotada individual, origen cero | (360,100) | (70,450) |

Leer coordenadas directamente de las entidades DXF. Expected numérico no se calcula con el helper bajo prueba. Declarar capas no prueba que existan CIRCLE. Distancias/radios se conservan; el espejo invierte orientación, no tamaño.

## D3. Cantos, rutas y límites dimensionales

Para símbolos de canto existentes: left `(hole.yMm,0)`, right `(hole.yMm,W)`, bottom `(0,hole.xMm)`, top `(L,hole.xMm)`, seguidos de la misma colocación. Conservar cara intrínseca; no transformar una perforación horizontal en vertical. Un símbolo 2D no codifica todo eje/altura/profundidad de mecanizado.

Mismo helper para `dxfCutPlanExport` sheets/pieces, `generateDxfBySheet` y `generateDxfByPiece`. Usar el origen que cada variante provee: tablero, desplazamiento entre tableros, grilla o cero individual. No sumar dos veces `piece.xMm/yMm` ni eliminar rotación en una ruta sin contrato nuevo.

Dimensiones de contorno no rotado: si rotated=false, `Lc=lengthMm,Wc=widthMm`; si true, `Lc=widthMm,Wc=lengthMm`. Compararlas con PartDrillingPattern dentro de tolerancia numérica declarada, no holgura industrial. `originalLengthMm/originalWidthMm` pueden incluir dimensiones antes del descuento de cantos: no son equivalentes automáticamente a Lc/Wc.

Si existe transformación canónica verificada entre terminado y crudo, reutilizarla. Si difieren marcos y falta ese mapping, bloquear esa exportación con perforaciones. No escalar, clamp, cambiar contorno, restar tapacantos otra vez ni adivinar origen. Un plan sin drilling no se bloquea sólo por esta comprobación específica.

Binding por referencia inequívoca de ocurrencia. No relacionar por nombre/medidas/proximidad; detectar duplicados antes de construir un Map last-write-wins. Fallback por código sólo con correspondencia inequívoca demostrada. Conservar todos los metadatos disponibles, sin inventar provenance que el contrato no entrega.

## D4. Integridad del BOM secundario y diagnóstico interno

En la base inspeccionada, [projectDrilling.ts](../../packages/domain/src/projectDrilling.ts) captura una excepción de `resolveBom` secundario y hace `continue`. `ProjectDrillingResult` sólo expone patterns/data/links. Una pérdida de placements puede quedar indistinguible de un fallback previsto.

Ampliación acotada autorizada: incidencia estructurada obligatoriamente transportada por el resultado **interno** del assembler, por ejemplo `resolutionIssues`, vacía cuando no hay incidencias de esa clase. Reutilizar taxonomía adecuada; no inventar un `hole` para encajar en DrillingIssue. Código estable, mensaje español sanitizado, etapa y IDs realmente conocidos. Logs solos no bastan. No convertir ausencia de este error en `manufacturingReady` global.

Mantener intactos `result.data`, `muebles.drilling-data.v1`, DTOs persistidos y contratos generados. Inspeccionar consumidores reales antes de afirmar que el wrapper nunca se serializa. Ajustar únicamente los consumidores mínimos y pruebas autorizados; no rediseñar caché/BOM/identidad de todo el assembler.

```text
resolveProjectDrilling completo
→ comprobar incidencias de resolución y de piezas aplicables
→ sólo entonces proyectar a data.patterns
→ serializar lote
→ ofrecer descarga
```

Todas las rutas de proyecto deben pasar por el guard. Una excepción no se vuelve válida porque una heurística produzca agujeros. Resultados parciales de diagnóstico siguen bloqueados; no devolver ZIP parcial, crear archivos antes del guard, sustituir error por array vacío ni presentar un artefacto anterior como éxito actual. El serializador de bajo nivel no necesita conocer el BOM; el límite con contexto sí valida su integridad.

No bloquear indiscriminadamente fallbackUsed o cero agujeros: mantener la política preexistente explícita para casos válidos. Fallo de resolución, perfil requerido faltante y ausencia legítima de operaciones son hechos diferentes. La integridad de otras rutas industriales queda en sus owners; este arreglo no las certifica.

## D5. Evidencia requerida y publicación

RED específica: generación inicial de cut rows/links exitosa y resolución secundaria fallida; demostrar que se alcanzó exactamente ese catch y que ningún export/descarga se ejecuta. Un fallo anterior de generateCutRowsWithLinks no prueba esta rama. Inyección controlada admisible para probar el detector, identificada como tal y sin alegar reproducción natural.

Cobertura: éxito, fallback previsto, sin agujeros válido, varios items con uno fallido, invocaciones independientes, no mutación de inputs, payload persistido intacto y guards web. Geometría: cuatro esquinas/cantos, rectángulo y cuadrado asimétricos, doble espejo, giro opuesto, doble traslación, múltiples tableros, cuatro rutas y bindings ambiguos. Goldens sólo tras aserciones independientes.

Identificador de salida propuesto `granete.dxf-cut-plan-projection.v1`, constante/documentación y comentario ASCII grupo 999 en ubicación válida. [Autodesk documenta el comentario 999](https://help.autodesk.com/cloudhelp/2018/ENU/AutoCAD-DXF/files/GUID-3F0380A5-1C15-464D-BC66-2C5F094BCFB9.htm); el lector puede ignorarlo y un reexport eliminarlo. No es negociación de capacidades. No reutilizar CutPlan.version ni sobrescribir artefactos históricos.

Pruebas de Excel/dominio/web y typechecks corresponden al HEAD final; gates proporcionales por impacto real. No sumar corridas ni contar omisiones como PASS. Typecheck/jsdom no prueban navegador ni receptor. Revisión independiente exacta, CI/readback remoto y límites publicados; #348/#354 conservan importación física separada.

El propietario autorizó para el candidato #676 una excepción justificada al umbral orientativo de 400 líneas, incluyendo este fallo secundario y sus pruebas. No autoriza crecimiento ilimitado: registrar código/tests/fixtures/docs por separado, no compactar ni omitir evidencia. No cambiar controles de publicación para evitar revisión.

### Estado comunicado, no revalidado por esta documentación

El implementador reportó rama `fix/676-rotated-dxf`, base eafc014f, cambios sin commit, fixture con puntos esperados y pruebas locales verdes. El último bloqueo comunicado fue la pérdida secundaria del BOM. Esta documentación registra su autorización de corrección; NO demuestra que ya esté corregida o publicada. Consultar #676/PR para HEAD, revisión, CI y estado reales. No requiere volver a pedir autorización por el mismo alcance ya fijado; sí respetar reservas y dependencias nuevas realmente demostradas.
