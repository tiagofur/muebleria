# PTX / CADmatic 4 — evidencia de campo y base segura para r3

> Añadido 2026-09-11 tras integrar el candidato r2 (#650 / PR #660).
> Fuente: dos archivos `.ptx` reales enviados por el cliente al propietario; ver
> [`field/README.md`](field/README.md) para procedencia y reglas de saneado.
>
> Este documento separa estrictamente **observación**, **inferencia** y **decisión de
> implementación**. Dos muestras reales son evidencia fuerte del dialecto usado por
> el cliente, pero no prueban por sí solas una regla universal de CADLink/CADmatic.
> `NOT_TESTED/notClaimed` permanece hasta importación/readback real.

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

Las muestras nuevas permiten avanzar, pero no eliminan todas las preguntas.

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

No se concluye todavía una tabla fija `left/right/top/bottom → TRIM_*`.

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

La lectura consistente es que el patrón está expresado sobre un área ya
condicionada por trims y que algunos `TRIM_*` representan bandas totales.

Pero **no** está resuelto todavía:

- cómo participan exactamente `TRIM_FRIP=10` y `TRIM_FXCT=10`;
- por qué `TRIM_HEAD=20` y `TRIM_FRCT=20` son 20 en estas muestras;
- si CADLink recomputa trims desde MATERIALS o espera geometría ya reducida;
- si la relación observada se mantiene para trims asimétricos.

Por tanto queda prohibido implementar fórmulas como `HEAD = 2 × trim` o
`FRCT = 2 × trim` sólo a partir de estas dos muestras.

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
- la magnitud está alineada con una dimensión del retazo referido.

Conclusión permitida:

> En las dos muestras observadas, `FUNCTION 92 + Xn` representa una pasada
> física asociada a la producción/liberación de un retazo.

Esto **no autoriza** convertir toda liberación relacional de r2
`QTY_RPT=0/SEQUENCE=0` en FUNCTION 92 automáticamente.

Para r3 sólo se emitirá FUNCTION 92 cuando la geometría, fase y relación con el
retazo coincidan con una regla documentada/evidenciada. Los demás casos deben
seguir fail-closed hasta contar con evidencia suficiente.

## 3. Otras observaciones — fuera del núcleo obligatorio de r3 trims

Las muestras también enseñan capacidades/dialectos útiles, pero no forman parte
obligatoria del próximo incremento de refilados salvo que una dependencia real
lo haga necesario:

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

Estas observaciones quedan registradas como cantera de futuras revisiones. No
se deben incorporar a r3 únicamente por “parecer más parecido” al archivo del
cliente.

## 4. Preguntas que deben cerrarse antes de escribir el mapping de trims

### G1 — semántica de DIMENSION en las rips observadas

Hay diferencias aproximadas de 9.8/9.9 mm entre algunas magnitudes CUTS y los
restos geométricos reconstruidos. Antes de modificar la política
`DIMENSION = keptExtentMm`, hay que explicar esas diferencias con una regla
consistente o declarar el caso no representable.

### G2 — mapping de los cuatro refilados físicos

Granete configura:

```text
left / right / bottom / top
```

PTX ofrece:

```text
TRIM_FRIP / TRIM_VRIP
TRIM_FXCT / TRIM_VXCT
TRIM_HEAD
TRIM_FRCT / TRIM_VRCT
```

No existe todavía un mapping demostrado uno-a-uno. La resolución debe depender
de la clase de pasada, orientación del patrón, lado fijo/variable, `leadingBand`
y `TRIM_TYPE`; no de una tabla por nombre de lado.

### G3 — HEAD y recut trims

Las muestras usan `TRIM_HEAD=20` y `TRIM_FRCT=20`, pero dos archivos no prueban
cómo derivarlos para cualquier configuración. Si no se consigue una regla
inequívoca, r3 debe exponer una política explícita de perfil o bloquear los
casos que necesiten esos campos; nunca inventar valores.

### G4 — MATERIALS vs geometría emitida

Debe decidirse si r3:

1. elimina las divisiones de trim sólo de la representación PTX y compila el
   árbol sobre el área útil; o
2. necesita otro ajuste para evitar que MATERIALS y CUTS contabilicen dos veces
   el mismo margen.

La prueba obligatoria es conservación geométrica sin doble kerf/trim.

### G5 — FUNCTION 92

Hay que definir exactamente qué terminal/remnant y qué fase permiten sustituir
una relación r2 por una pasada física 92. La ausencia de esa prueba implica
fail-closed, no una conversión por defecto.

## 5. Alcance recomendado para r3

r3 debe ser deliberadamente pequeño: **hacer utilizable CADmatic 4 con refilos
positivos**, sin convertir la evidencia en un proyecto de compatibilidad total.

### Incluido

1. Planner/mapping explícito desde la geometría ejecutada del `CutProgram` a
   los `MATERIALS.TRIM_*` que puedan demostrarse.
2. Los `TRIM_*` representan magnitudes totales según el contrato documentado;
   no sumar kerf dos veces.
3. Compilar el área útil sin emitir filas ficticias de refilo perimetral.
4. FUNCTION 92 + Xn únicamente para la clase de offcut demostrada por regla;
   otros releases permanecen con la semántica vigente o bloquean si ambas
   representaciones serían incompatibles.
5. Verificador independiente para `TRIM_*`, geometría útil y cualquier 92
   soportado, con mutation tests.
6. Golden propio de Granete con trim > 0, marcado `LAB_FIXTURE` /
   `NOT_MACHINE_VALIDATED`.
7. Nueva revisión inmutable `ptx-cadmatic-4@r3`, nuevo adapter version/digest y
   paridad Go/TS cuando cambie comportamiento industrial.
8. Descarga existente unified/by-material/ZIP, sin botón paralelo.
9. UI permanece `Candidato — no validado en máquina`.

### Fuera del incremento salvo dependencia demostrada

- `PATTERNS.TYPE=1`;
- BOOK/MAX_BOOK > 1;
- compartir un BOARDS entre varios patterns;
- familias `PARTS_INF` / `PARTS_UDI` / `NOTES`;
- parser tolerante del dialecto externo;
- CADmatic 3/5;
- SAW/MPR/drilling;
- cinco cocinas y validación del cliente.

## 6. Criterio para comenzar código

No comenzar la implementación r3 hasta tener una tabla/algoritmo de mapping con
estas columnas como mínimo:

| Granete | Contexto | PTX | Magnitud | Evidencia | Si no aplica |
|---|---|---|---|---|---|
| trim físico | eje/fase/lado/leadingBand | `TRIM_*` | total incl. kerf | manual + fixture | fail closed |
| remnant release | fase + terminal + geometría | FUNCTION 92/Xn cuando demostrado | relativa al subpanel | manual + muestras | conservar semántica soportada o fail closed |

La tabla debe explicar casos simétricos, asimétricos, `trim == kerf`,
`trim < kerf` y trim cero.

## 7. Estado de compatibilidad

Nada de esta evidencia prueba todavía que un PTX generado por Granete sea
aceptado por CADLink/CADmatic 4. Hasta importación real:

```text
NOT_TESTED
notClaimed
```

r2 permanece inmutable. r3 será una nueva revisión basada en evidencia, no una
reescritura histórica.