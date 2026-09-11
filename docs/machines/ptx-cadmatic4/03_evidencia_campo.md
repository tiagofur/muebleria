# PTX / CADmatic 4 — evidencia de campo y base segura para r3

> Añadido 2026-09-11 tras integrar el candidato r2 (#650 / PR #660).
> Fuente: dos archivos `.ptx` reales enviados por el cliente al propietario; ver
> [`field/README.md`](field/README.md) para procedencia y reglas de saneado.
>
> Este documento separa estrictamente **observación**, **inferencia** y **decisión de
> implementación**. Dos muestras reales son evidencia fuerte del dialecto usado por
> el cliente, pero no prueban por sí solas una regla universal de CADLink/CADmatic.
> `NOT_TESTED/notClaimed` permanece hasta importación/readback real.
>
> Las decisiones implementables derivadas de esta evidencia se congelan en
> [`04_contrato_r3_refilados.md`](04_contrato_r3_refilados.md). Este archivo conserva
> el análisis; el 04 es la autoridad de implementación para #661.

## 1. Evidencia que refuerza decisiones de r2

En ambas muestras aparecen las siguientes decisiones ya usadas por r2:

| Decisión r2 | Observación en las muestras | Alcance de la conclusión |
|---|---|---|
| `HEADER.VERSION = 1` | `HEADER, 1, ...` | confirmada para las dos muestras |
| `UNITS = 0`, `ORIGIN = 0` | presentes en ambas | confirmada para las dos muestras |
| `TRIM_TYPE = 1` | última celda de HEADER = `1` | confirmada para las dos muestras |
| ASCII + CRLF | observado en ambas | dialecto observado; no requisito universal demostrado |
| `CUT_INDEX` separado de `SEQUENCE` | orden estructural y operativo difieren | coincide con el modelo r2 |
| FUNCTION 1/2/3 | presentes en los patrones | coincide con staging soportado por r2 |
| `Xn` referencia `OFFCUTS` | `PART_INDEX=X1` apunta al retazo | significado confirmado para estas muestras |

La muestra B, patrón 1, demuestra especialmente que `CUT_INDEX` y `SEQUENCE`
no son intercambiables: `CUT_INDEX` crece 1..N mientras `SEQUENCE` intercala
subárboles.

## 2. Refilados: evidencia nueva

r2 bloquea cualquier refilado positivo (`ptx_compile.trim_unsupported`) porque,
cuando se implementó, faltaba evidencia suficiente para mapear la geometría de
Granete al contrato PTX.

Las muestras nuevas permiten avanzar.

### 2.1 Observación: los refilados perimetrales están declarados en MATERIALS

En los cuatro patrones inspeccionados no aparece una fila CUTS que pueda
identificarse como la pasada perimetral de refilo. En cambio, todos los
materiales relevantes contienen:

```text
TRIM_FRIP = 10
TRIM_VRIP = 0
TRIM_FXCT = 10
TRIM_VXCT = 0
TRIM_HEAD = 20
TRIM_FRCT = 20
TRIM_VRCT = 0
```

junto a `KERF_RIP=4.4` y `KERF_XCT=4.4`.

Conclusión permitida:

> El optimizador que produjo estas dos muestras expresa al menos parte de la
> política de refilado mediante `MATERIALS.TRIM_*`; Granete r3 debe poder emitir
> esos campos cuando exista un mapping demostrado desde su geometría.

No se concluye una tabla universal `left/right/top/bottom → TRIM_*`.

### 2.2 Evidencia aritmética de bandas totales

Las muestras contienen varias igualdades geométricas compatibles con bandas de
trim que incluyen el consumo de sierra. Ejemplos:

```text
Muestra A, tablero 1, eje X: 697 + 4.4 + 20 + 1718.601 = 2440.001
Muestra A, tablero 1, eje Y: 20 + 333 + 4.4 + 862.601 = 1220.001
Muestra A, tablero 2, eje X: 20 + 2400 + 20 = 2440
Muestra B, tablero, eje X: 1200 + 4.4 + 20 + 1215.590 = 2439.99
Muestra B, tablero, eje Y: 350 + 4.4 + 845.601 + 20 = 1220.001
```

Además, las dos rips que inicialmente parecían tener un delta inexplicable
quedan explicadas por el fixed rip trim de 10 mm:

```text
Muestra A: 333.0 + 4.4 + 872.4  + 10.0 = 1219.8 ≈ 1220
Muestra B: 1200  + 4.4 + 1225.5 + 10.0 = 2439.9 ≈ 2440
```

Esto cierra G1: no hay evidencia para cambiar `CUTS.DIMENSION` a coordenada
global. La implementación debe compilar sobre una raíz útil después de proyectar
los trims, conservando medidas relativas.

La lectura consistente es que el patrón está expresado sobre un área ya
condicionada por trims y que los `TRIM_*` representan magnitudes totales que
incluyen kerf.

### 2.3 Observación: FUNCTION 92 aparece asociado a X1/offcut

En ambas muestras existe una fila `FUNCTION 92` que referencia `X1`:

```text
CUTS,...,92,1718.6,1,X1
CUTS,...,92,845.6,1,X1
```

En esas filas:

- `SEQUENCE > 0`;
- `QTY_RPT = 1`;
- `PART_INDEX = X1`;
- la magnitud está alineada con el extent del retazo sobre el eje productor.

Además, el patrón estructural se repite exactamente:

```text
phase-2 producer (FUNCTION 2)
→ release física 92/X1
→ recut dependiente phase 3
```

Muestra A:

```text
FN2  DIM=697.0   SEQ=5
FN92 DIM=1718.6  SEQ=6  X1
FN3  DIM=333.0   SEQ=7
```

Muestra B:

```text
FN2  DIM=350.0   SEQ=14
FN92 DIM=845.6   SEQ=15 X1
FN3  DIM=1200.0  SEQ=16
```

Conclusión permitida:

> Para el subconjunto documentado en el contrato r3, un rest-side remnant
> producido por una división phase 2 puede representarse como una pasada física
> `FUNCTION 92 + Xn` cuando cumple todas las precondiciones geométricas.

Esto **no autoriza** convertir toda liberación relacional de r2 en FUNCTION 92.

## 3. Otras observaciones — fuera del núcleo obligatorio de r3 trims

Las muestras también enseñan capacidades/dialectos útiles, pero no forman parte
obligatoria del próximo incremento de refilados salvo dependencia real:

1. `PATTERNS.TYPE=1` aparece en la muestra B.
2. Dos `PATTERNS` pueden referenciar una misma fila `BOARDS`.
3. `BOOK=3` / `MAX_BOOK=3` aparece en el sistema del cliente.
4. Un mismo código de material puede aparecer en varios `MAT_INDEX`.
5. `OFFCUTS.CODE` aparece vacío y existe una columna final adicional.
6. `BOARDS` contiene dos columnas posteriores a nuestro subconjunto conocido.
7. Se observan espacios tras comas, líneas en blanco, trailing commas y
   decimales con distinta cantidad de posiciones.
8. Aparecen familias fuera de nuestro subconjunto: `PARTS_INF`, `PARTS_UDI`,
   `NOTES`.
9. `JOBS` contiene campos operativos adicionales.

Estas observaciones quedan como cantera de futuras revisiones. No incorporarlas
a r3 únicamente por parecerse más al archivo externo.

## 4. Resultado de las preguntas G1–G5

La investigación posterior a estas muestras produjo el contrato de
[`04_contrato_r3_refilados.md`](04_contrato_r3_refilados.md):

| Gate | Estado |
|---|---|
| G1 — DIMENSION | `RESOLVED` |
| G2 — four-side mapping | `SPEC_POLICY_READY` para `TRIM_TYPE=1` y frame sin giro inicial |
| G3 — HEAD/recut | `PROFILE_POLICY`: no derivar; blank/no override en primera r3 |
| G4 — double counting | `RESOLVED`: trims totales + raíz útil PTX |
| G5 — FUNCTION 92 | `RESOLVED_SUBSET`: sólo rest-side remnant de phase 2 con contrato geométrico |

**El discovery gate queda cerrado para el subconjunto r3.** No hace falta otra
ronda abierta de investigación antes de escribir tests/código. El implementador
debe obedecer el 04 y fallar cerrado fuera de ese frame.

## 5. Alcance recomendado para r3

r3 debe ser deliberadamente pequeño: **hacer utilizable CADmatic 4 con refilos
positivos dentro del frame demostrado**, sin convertir la evidencia en un
proyecto de compatibilidad total.

Incluye:

1. planner/mapping desde `CutProgramTrace` a `MATERIALS.TRIM_*`;
2. proyección de una raíz útil sin volver a emitir las divisiones perimetrales;
3. no double-counting de kerf/trim;
4. `FUNCTION 92 + Xn` sólo para el release phase-2 demostrado;
5. scheduler PTX que inserte el evento físico sin confundir CUT_INDEX y SEQUENCE;
6. verifier independiente y mutation tests;
7. golden trim>0 de Granete;
8. nueva revisión `ptx-cadmatic-4@r3`, adapter versionado/paridad y descarga
   existente;
9. UI todavía `Candidato — no validado en máquina`.

Fuera salvo dependencia demostrada:

- `PATTERNS.TYPE=1`;
- BOOK/MAX_BOOK > 1;
- compartir un BOARDS entre varios patterns;
- `PARTS_INF` / `PARTS_UDI` / `NOTES`;
- parser tolerante del dialecto externo;
- CADmatic 3/5;
- SAW/MPR/drilling;
- cinco cocinas y validación del cliente.

## 6. Estado de compatibilidad

Nada de esta evidencia prueba todavía que un PTX generado por Granete sea
aceptado por CADLink/CADmatic 4. Hasta importación real:

```text
NOT_TESTED
notClaimed
```

r2 permanece inmutable. r3 será una nueva revisión basada en evidencia, no una
reescritura histórica.