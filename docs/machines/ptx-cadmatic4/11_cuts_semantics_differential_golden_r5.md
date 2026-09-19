# PTX / CADmatic 4 — semántica CUTS, diferencial y golden r5

> Addendum documental de #791. Este documento corrige la interpretación conceptual
> de r5 sin reescribir los contratos históricos r3/r4 ni reclamar compatibilidad de
> campo. Los bytes históricos, perfiles, adapters y digests previos siguen
> inmutables.

## 1. Split semántico: `FUNCTION` no es `PART_INDEX`

En `CUTS`, `FUNCTION` y `PART_INDEX` son campos independientes:

- `FUNCTION` describe la semántica de fase o evento físico de corte.
- `PART_INDEX` referencia una pieza por índice positivo de `PARTS_REQ` o un remanente/offcut (`Xn`).

Por lo tanto, `FUNCTION 92` no significa por sí mismo “liberar cualquier offcut”.
La referencia `Xn` tampoco cambia la fase física del corte. La combinación
observada `92 + Xn` sólo es válida cuando ambas condiciones son ciertas a la vez:
la fila representa un evento físico de trim/waste phase 2 y el objeto afectado es
el offcut `Xn` correspondiente.

## 2. Tabla de funciones soportadas para r5

| FUNCTION | Significado en especificación | Fase | Spec-valid | Soporte producto Granete | Emisión r5 | Evidencia receptor |
|---|---|---:|---|---|---|---|
| `0` | Corte normal / división productiva sin clasificación phase 1..3 específica | n/a | Sí | Soportado para el subconjunto existente cuando el compiler lo produce desde `CutProgram` | Permitida | Dialecto interno histórico y readback independiente; no es evidencia universal CAD4. |
| `1` | Rip / phase 1 | 1 | Sí | Soportado como división productiva ejecutable | Permitida | Presente en el dialecto Granete y compatible con el modelo Pattern Exchange. |
| `2` | Crosscut / phase 2 | 2 | Sí | Soportado como división productiva ejecutable y como producer requerido para el offcut rest-side | Permitida | R2201/R7301 muestran producers phase 2 antes de releases `92 + Xn`. |
| `3` | Recut / phase 3 | 3 | Sí | Soportado para recuts dependientes ya representables | Permitida | R2201/R7301 muestran recut dependiente después del release. |
| `90` | Trim/waste phase 0/normal según familia 90..99 | 0 / n/a | Sí | Sin emisión productiva r5 hasta tener evento físico demostrado | No emitir por ahora | Sin evidencia suficiente del receiver HPP250/CAD4 para publicar bytes. |
| `91` | Trim/waste phase 1 | 1 | Sí | Conceptualmente distinto de `PART_INDEX`; no soportado por producto r5 actual | No emitir por ahora | Sin fixture receptor que justifique combinación actual. |
| `92` | Trim/waste phase 2 | 2 | Sí | Soportado sólo para el evento físico rest-side offcut descrito abajo | Permitida sólo con regla r5 | Observado en R2201/R7301 como `FUNCTION 92` con `PART_INDEX X1`. |
| `93` | Trim/waste phase 3 | 3 | Sí | Conceptualmente distinto de `PART_INDEX`; no soportado por producto r5 actual | No emitir por ahora | Sin fixture receptor que justifique combinación actual. |
| `Xn` | No es `FUNCTION`: referencia a `OFFCUTS n` en `PART_INDEX` | n/a | Sí como referencia | Validado independientemente contra OFFCUTS | Permitido como `PART_INDEX` donde corresponda | R2201/R7301 usan `X1` para el remanente observado. |

### Regla operacional para `92 + Xn`

- `92` = trim/waste phase 2.
- `Xn` = referencia al registro `OFFCUTS n`.
- `92 + Xn` = combinación observada del receiver, permitida en el subconjunto r5
  actual sólo cuando el evento físico coincide con el caso demostrado:
  1. el producer es una división phase 2 (`FUNCTION 2`);
  2. el remanente es el terminal rest-side rectangular de esa división;
  3. existe una referencia `OFFCUTS n` única y válida;
  4. la fila 92 se ordena después del producer y antes de cualquier recut
     dependiente;
  5. no se duplica la liberación física del mismo `Xn`.

Cualquier otro uso de `92`, cualquier uso de `Xn` sin offcut válido, o cualquier
combinación `92 + Xn` sin el evento físico anterior debe bloquearse o permanecer
en blanco/configurable según corresponda. No se convierte por heurística.

## 3. Resumen diferencial R2201/R7301 por propiedad

La comparación r5 es por propiedades, no por copia byte a byte de archivos de
cliente:

| Propiedad | R2201/R7301 saneados | Decisión r5 |
|---|---|---|
| Familias de records | Contienen familias core de Pattern Exchange y familias de labels/offcuts relevantes para CADLink/CAD4 | Mantener shape compatible sólo dentro del receiver profile HPP250/CAD4 documentado. |
| Orden de familias | Orden receptor observado: `HEADER`, `JOBS`, `PARTS_REQ`, `PARTS_INF`, `PARTS_UDI`, `BOARDS`, `MATERIALS`, `NOTES`, `OFFCUTS`, `PATTERNS/CUTS` | Clasificar como `RECEIVER_EVIDENCED`, no estándar universal. |
| `FUNCTION` 90..99 | `92` aparece como evento de trim/waste phase 2 | Separar fase de referencia a pieza/offcut; emitir `92` sólo para el caso físico demostrado. |
| `PART_INDEX Xn` | `X1` referencia OFFCUTS en filas 92 observadas | Validar `Xn` contra OFFCUTS independientemente de `FUNCTION`. |
| Secuencia producer → release → recut | Producer phase 2 precede release 92; recut dependiente ocurre después | Verificar relaciones de orden, no copiar gaps numéricos del optimizador externo. |
| PARTS_INF | Transporta identidad industrial/etiquetas por pieza | r5 exige mapping tipado desde datos congelados; campos sin autoridad quedan vacíos. |
| PARTS_UDI | Transporta información compacta de etiqueta/receiver | r5 documenta política explícita y conserva desconocidos como blank/configurable. |
| MATERIALS | Incluye política receptor de book, kerf, trims y reglas | r5 usa autoridad del receiver profile; no promueve constantes universales. |
| CNC drawing/barcode | Aparece como identidad útil para labels/mecanizado | r5 usa `cncDrawingRef`/barcode estable cuando hay mecanizado real; no genera programas falsos. |
| Comentarios en CUTS | No son la autoridad industrial del receiver | r5 omite comentarios internos salvo justificación explícita. |

## 4. Golden r5 LAB/TEST

El golden #791 es un fixture determinista de laboratorio. Existe para proteger el
pipeline y el contrato documental; no representa una validación CADLink/CADmatic.

### Contenido cubierto

- al menos dos muebles / productos (`ZZ-ALTO`, `AA-BAJO` en la evidencia actual);
- piezas con y sin cantos;
- piezas con y sin referencia CNC;
- dos materiales;
- múltiples hojas;
- un offcut con combinación `FUNCTION 92 + PART_INDEX X1`;
- barcode y `cncDrawingRef` donde hay mecanizado real;
- `PARTS_INF` y `PARTS_UDI` por pieza física;
- título cercano al límite (`LAB-R5-GOLDEN-TEST-ONLY1`, 24 caracteres);
- manifest estable de bytes y conteos.

### Pipeline de generación

El fixture se genera únicamente por el pipeline real:

```text
engineering rows
→ optimizeCutPlan
→ buildPtxPartLabels
→ compileCutPlanToPtxDocument
→ serializePtxDocumentBytesSpecChecked
→ parsePtxDocumentBytes
→ validatePtxDocument + ptxSpecPreflightDocument + verifyCutPlanPtxReadback
```

No debe editarse byte a byte ni copiar muestras de cliente. Si cambia el output,
el cambio debe justificarse por una modificación deliberada del contrato o del
pipeline y actualizar manifest/tests en el mismo cambio.

### SHA, tamaño y conteos actuales

| Campo | Valor |
|---|---:|
| SHA-256 | `239e9f7c8989c5f3756545da94a184b7b79aa1bdda797755c065301917201932` |
| byte length | `3303` |
| records | `60` |
| PARTS_REQ / parts | `10` |
| materials | `2` |
| sheets / BOARDS | `4` |
| OFFCUTS | `1` |
| PARTS_INF | `10` |
| PARTS_UDI | `10` |
| CNC drawings | `9` |

### Limitaciones

- LAB/TEST only: no es perfil/adaptador productivo r5 publicado.
- No prueba importación CADLink, generación `.rlt`, saw file ni revisión de operador.
- No prueba corte físico ni machine dry-run.
- No generaliza todas las combinaciones 90..99.
- No valida UDI compacto histórico más allá de la política explícita r5.
- No autoriza compatibilidad por similitud con R2201/R7301.

## 5. Unknowns y no-claims

Quedan desconocidos o pendientes hasta evidencia externa:

- límites exactos de CADLink 4.x que sólo aparecen al importar con `/CAD4`;
- comportamiento efectivo de `/INF`, `/UDI`, `cadlink.ini` y labels en la instalación;
- interpretación completa de UDI compacto de muestras históricas;
- mapping real desde `DRAWING`/barcode hacia BHX/woodWOP en el entorno del cliente;
- campos opcionales de `BOARDS`, `PATTERNS` y `CUTS` que CAD4 podría consumir;
- aceptación de `92 + Xn` fuera del caso rest-side phase 2 demostrado.

Este documento no publica compatibilidad, no afirma que r5 haya sido aceptado por
CADLink/CADmatic, no autoriza envío a cliente por sí solo y no habilita corte físico.
El estado sigue `NOT_TESTED/notClaimed` hasta que el field pack y el readback real
lo demuestren en issues posteriores.
