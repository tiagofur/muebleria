# PTX / CADmatic 4 — dossier r5 tras el segundo rechazo de CADLink

> Fecha de investigación: 2026-09-18.
>
> Este documento nace después de que el segundo candidato real de Granete,
> `GD8754F0B9995.ptx` (`ptx-cadmatic-4@r4`), volviera a ser rechazado por el
> flujo del cliente. Preserva r4 como evidencia histórica y concentra lo que ya
> sabemos antes de escribir r5.
>
> **No declarar compatibilidad.** El estado sigue `NOT_TESTED/notClaimed` hasta
> una conversión real exitosa por CADLink hacia CADmatic 4.

## 1. Objetivo

Dejar de iterar el PTX por ensayo/error y construir el siguiente candidato desde
una base verificable:

```text
Pattern Exchange documentado
+ dialecto observado en R2201/R7301
+ receiver profile específico HPP 250 / CADmatic 4
+ validación estricta antes de exportar
+ información suficiente para etiquetas
+ puente explícito hacia CNC
```

La próxima prueba de cliente debe ser un **resultado de un contrato r5 completo**,
no otra colección de parches locales sobre r4.

---

## 2. Jerarquía de fuentes

### 2.1 Primarias / normativas para este trabajo

1. Magi-Cut Interface Guide V11 — Pattern Exchange:
   https://www.magi-cut.co.uk/media/1590/v11-interface-guide.pdf
2. CADLink help — `/CAD4`, `/RESULT`, errores e `/INF`/`/UDI`:
   https://www.magi-cut.co.uk/files/html/V12webhelp/Cadlink.htm
3. Pattern Exchange import:
   https://www.magi-cut.co.uk/files/html/V12webhelp/ptx01.htm
4. Edging diagram / labels:
   https://www.magi-cut.co.uk/files/html/V12webhelp/mct1088.htm
5. Machining interface:
   https://www.magi-cut.co.uk/machining-interface
6. Homag WoodWop machining transfer:
   https://www.magi-cut.co.uk/files/html/V12webhelp/mct1865.htm
7. HOLZMA HPP 250 brochure — CADmatic 4 PRACTIVE:
   https://wtp.hoechsmann.com/es/lexikon/pdf/hom_practive_katalog_2009_en.pdf

La Interface Guide se usa como contrato del formato PTX. La ayuda actual de
Magi-Cut se usa para comportamiento de CADLink y conceptos de etiquetas/CNC.
Los detalles concretos del receptor del cliente se validan además contra sus dos
PTX funcionales.

### 2.2 Evidencia real del cliente

- `R2201.PTX`
- `R7301.PTX`

Los originales no se versionan. Las formas saneadas permanecen en
`docs/machines/ptx-cadmatic4/field/`.

### 2.3 Fuentes secundarias / contexto operativo

- WOOD TEC PEDIA: HPP 250 / CADmatic 4:
  https://wtp.hoechsmann.com/es/lexikon/5543/holzma_hpp_250
- CADmatic 4.0 PRACTIVE:
  https://wtp.hoechsmann.com/en/lexikon/31382/cadmatic_40_practive
- PROMEBELclub — casos reales de PTX → CADLink → CADmatic 4/4.1:
  https://promebelclub.ru/forum/printthread.php?page=2&pp=40&t=756
  https://promebelclub.ru/forum/printthread.php?page=3&pp=40&t=756
  https://promebelclub.ru/forum/printthread.php?page=7&pp=40&t=9511

Los foros **no gobiernan bytes**. Sólo confirman que el flujo
`PTX → CADLink → SAW → CADmatic 4` es usado en HPP 250 y que archivos PTX
aparentemente válidos pueden fallar por detalles del postprocesador/configuración.

---

## 3. Receptor objetivo

La familia de máquina/controlador objetivo es coherente:

```text
HOLZMA HPP 250
→ CADmatic 4 PRACTIVE
→ CADLink /CAD4
→ .SAW
```

El material histórico de HOLZMA lista CADmatic 4 PRACTIVE como software de
operación de HPP 250. También existen instalaciones HPP 250 con CADmatic 4.0 y
4.1.

**Pendiente no bloqueante:** la subversión exacta del cliente (4.0/4.1/build).
El postprocesador debe seguir apuntando a la familia `CADmatic 4`; no se inventa
una subversión sin evidencia.

---

## 4. Evidencia del segundo candidato Granete

Artefacto enviado:

```text
filename: GD8754F0B9995.ptx
bytes: 5908
sha256: a9ab9bf26f3af80aaa4d2b7e7381d3e9c6ef9850effdd1f354307b1976f9792e
encoding: ASCII-compatible UTF-8, no BOM
line endings: CRLF
lines: 136
result: REJECTED by customer CADLink/CADmatic flow
```

Familias emitidas:

| Familia | filas | celdas totales por fila |
|---|---:|---:|
| HEADER | 1 | 6 |
| JOBS | 1 | 12 |
| MATERIALS | 2 | 20 |
| PARTS_REQ | 48 | 12 |
| OFFCUTS | 1 | 8 |
| BOARDS | 4 | 9 |
| PATTERNS | 4 | 8 |
| CUTS | 75 | 11 |

Familias **no emitidas** por r4:

```text
PARTS_INF
PARTS_UDI
NOTES
```

Esto último no demuestra la causa del rechazo: Pattern Exchange permite un
subconjunto mínimo de importación de piezas. Sí demuestra que r4 no transporta
la información necesaria para un flujo rico de etiquetas.

---

## 5. Defecto objetivo encontrado después de r4

### 5.1 HEADER.TITLE excede el límite documentado

r4 genera:

```text
HEADER,1,GRANETE-PTX-CANDIDATE NOT_MACHINE_VALIDATED,0,0,1
```

El título tiene **43 caracteres**.

La tabla de restricciones del Interface Guide limita:

```text
HEADER.TITLE = 25 chars max
```

Los dos archivos funcionales del cliente observados cumplen:

```text
R2201 title length = 25
R7301 title length = 22
```

Clasificación:

```text
SPEC VIOLATION: CONFIRMED
ROOT CAUSE OF CADLINK FAILURE: NOT PROVEN
R5 ACTION: MUST FIX + FAIL CLOSED
```

r5 no puede serializar un TITLE >25. No truncar silenciosamente datos críticos:
el título industrial debe construirse ya dentro del límite.

---

## 6. Diferencias que NO deben seguir tratándose como defectos por apariencia

El Interface Guide confirma:

- comillas en texto son opcionales;
- espacios iniciales se ignoran;
- trailing commas no son necesarias;
- campos textuales con coma deben ir entre comillas;
- los índices deben iniciar en 1 y ser consecutivos.

Por tanto no se debe perder tiempo intentando igualar visualmente:

```text
CUTS,   1,   1...
```

frente a:

```text
CUTS,1,1...
```

Tampoco es un defecto por sí solo usar `CUTS.COMMENT`: el campo está definido y
es opcional. r5 puede omitir comentarios internos `strip-*`/`place-*` por
conservadurismo del receptor, pero no se declarará que fueran la causa del fallo.

---

## 7. Información de pieza y etiquetas: PARTS_INF es el contrato estándar

El Interface Guide define:

```text
PARTS_INF,
JOB_INDEX,
PART_INDEX,
DESC,
LABEL_QTY,
FIN_LENGTH,
FIN_WIDTH,
ORDER,
EDGE1,
EDGE2,
EDGE3,
EDGE4,
EDG_PG1,
EDG_PG2,
EDG_PG3,
EDG_PG4,
FACE_LAM,
BACK_LAM,
CORE,
DRAWING,
PRODUCT,
PROD_INFO,
PROD_WIDTH,
PROD_HGT,
PROD_DEPTH,
PROD_NUM,
ROOM,
BARCODE1,
BARCODE2,
COLOUR,
...
```

y especifica explícitamente que uno de sus usos es **label printing**.

Mapping propuesto desde Granete:

| PTX | Autoridad Granete |
|---|---|
| `DESC` | nombre humano de pieza |
| `LABEL_QTY` | política de etiquetas por pieza física |
| `FIN_LENGTH/WIDTH` | medida final terminada, no re-derivada en serializer |
| `ORDER` | orden/release industrial sanitizado |
| `EDGE1..4` | canto por lado desde BOM/engineering truth |
| `EDG_PG1..4` | sólo si existe código de operación real |
| `FACE_LAM/BACK_LAM/CORE` | acabados/material cuando exista autoridad |
| `DRAWING` | referencia corta del dibujo/programa CNC |
| `PRODUCT` | código del mueble/módulo |
| `PROD_INFO` | nombre/descripción de mueble |
| `PROD_WIDTH/HGT/DEPTH` | dimensiones del mueble |
| `PROD_NUM` | ordinal físico del mueble en la obra/release |
| `ROOM` | ambiente/space cuando exista |
| `BARCODE1` | token CNC/drawing corto |
| `BARCODE2` | manufacturing part code o tracking token |
| `COLOUR` | acabado/color normalizado |

**Invariante:** el serializer no reconstruye estos datos. Los recibe desde una
proyección industrial congelada del release.

---

## 8. PARTS_UDI: extensión útil, no sustituto de PARTS_INF

Pattern Exchange define campos user-defined por pieza. CADLink documenta el
mapeo de `PARTS_UDI` y `PARTS_INF` a information boxes mediante `/UDI` y
`/INF`.

Los dos archivos funcionales del cliente usan una forma semejante a:

```text
PARTS_UDI,...,<image>.png,<compact edge info>,<finish>,<finish>
```

Eso es evidencia fuerte de su instalación, pero la semántica exacta de códigos
como `2WE2LE` **no está demostrada como estándar PTX**.

Política r5:

1. usar `PARTS_INF` para datos estándar;
2. reservar `PARTS_UDI` para el receiver profile del cliente;
3. no copiar el encoding UDI del software actual sin entenderlo;
4. si se genera imagen de pieza/cantos, definir nombre, path y lifecycle de
   forma explícita y testeada.

---

## 9. Diagrama de cantos

La ayuda de Magi-Cut documenta un **Edging diagram** cuyo uso principal es
imprimir gráficamente en la etiqueta el método de canteado. También indica
opciones específicas disponibles para CADmatic 4.

Granete ya posee la verdad de:

```text
pieza
+ orientación
+ EDGE1/2/3/4
+ material/espesor de canto
```

Por tanto r5 debe poder:

- transportar `EDGE1..4` de forma estándar;
- generar un diagrama/imagen sólo como presentación;
- nunca convertir la imagen en autoridad de fabricación.

---

## 10. Puente a CNC

`PARTS_INF.DRAWING` está documentado como nombre de:

```text
drawing file
or drill program
or CNC program for machine centre
```

Esto da el enlace industrial que necesitamos:

```text
physical piece
  ├─ manufacturingPartCode
  ├─ PARTS_REQ.CODE
  ├─ PARTS_INF.DRAWING = short CNC/drawing ref
  ├─ BARCODE1 = same/related scan token
  └─ CNC artifact = MPR/MPRX when generated
```

La documentación de machining transfer de Magi-Cut muestra Homag WoodWop V4–V9
como transferencia MPR/MPRX y el flujo de etiqueta con barcode de drawing
reference que se escanea en el centro de mecanizado.

**No-goal de r5 de corte:** generar todavía el programa de perforación BHX.
Sí es objetivo fijar la identidad y el campo que lo enlazará.

El límite general documentado incluye referencias de dibujo y de machine drawing
más cortas que nuestros IDs internos. La referencia CNC debe ser un identificador
industrial corto; UUIDs nunca entran en `DRAWING`.

---

## 11. CUTS también gobierna la sincronización de etiquetas

El Interface Guide explica que `CUTS` determina qué piezas produce cada corte y
que esa relación se usa, por ejemplo, para imprimir la etiqueta correcta en la
sierra sincronizada con el corte.

Contrato:

```text
CUTS.PART_INDEX
→ PARTS_REQ.PART_INDEX
→ PARTS_INF / PARTS_UDI
→ label / barcode / drawing reference
```

Por ello los índices de parte son identidad estructural crítica; no son sólo
metadata del optimizador.

---

## 12. Corrección conceptual: FUNCTION 90..99

El Interface Guide define:

```text
0 = head cut
1 = rip
2 = crosscut
3..9 = later phases/recuts
90..99 = trim/waste cut corresponding to phase
```

En particular:

```text
90/91/92/93 = trim/waste cut de la fase correspondiente
```

Por tanto `FUNCTION 92` **no significa universalmente “offcut release”**.
En los dos PTX funcionales del cliente sí aparece `92 + X1`, lo cual prueba
ese dialecto para esas muestras.

r5 debe modelar separadamente:

```text
cut function semantics
+
PART_INDEX = Xn offcut reference
```

y dejar de nombrar F92 como si la función por sí sola expresara la identidad del
remanente.

---

## 13. MATERIALS: diferencia operacional muy fuerte

Los dos PTX funcionales del cliente repiten una configuración consistente:

```text
BOOK        = 3
KERF_RIP    = 4.400
KERF_XCT    = 4.400
TRIM_FRIP   = 10
TRIM_VRIP   = 0
TRIM_FXCT   = 10
TRIM_VXCT   = 0
TRIM_HEAD   = 20
TRIM_FRCT   = 20
TRIM_VRCT   = 0
RULE1       = 6
RULE2       = 1
RULE3       = 1
RULE4       = 1
```

El r4 de Granete emitió aproximadamente:

```text
BOOK        = 1
KERF        = 4.4 / 4.4
TRIM        = 10 / 10 / 10 / 10
HEAD/RECUT  = blank
RULE1..4    = blank
```

La guía define estos campos como parámetros reales de material/sierra:
máximo book, kerf, trims y reglas de optimización.

Clasificación:

```text
SYNTAX INVALID: NO
OPERATIONAL / RECEIVER DIFFERENCE: STRONG
MUST BE HARDCODED GLOBALLY: NO
R5 ACTION: receiver-profile configuration
```

El patrón de las muestras no autoriza copiar números de forma universal.
Debe existir un perfil explícito HPP250/CAD4 para el cliente y una fuente
configurada de cada parámetro.

---

## 14. BOARDS / PATTERNS / JOBS: anchuras observadas vs estándar

Segundo candidato r4:

```text
JOBS      12 cells total
BOARDS     9
PATTERNS   8
CUTS      11
```

Muestras funcionales del cliente:

```text
JOBS       8 cells total
BOARDS    11
PATTERNS   9
CUTS       9..10
```

La especificación demuestra que varios campos posteriores son opcionales y que
trailing blanks no son necesarios. Por tanto la diferencia de anchura **no es
por sí sola un defecto**.

Aun así, para el receiver profile de este cliente r5 debe decidir de forma
explícita si replica la forma observada cuando no exista valor semántico
adicional, en vez de dejar que el serializer genérico determine el shape por
accidente.

---

## 15. Orden de familias

Las dos muestras funcionales siguen:

```text
HEADER
JOBS
PARTS_REQ
PARTS_INF
PARTS_UDI
BOARDS
MATERIALS
NOTES
OFFCUTS
PATTERNS/CUTS...
```

r4 sigue:

```text
HEADER
JOBS
MATERIALS
PARTS_REQ
OFFCUTS
BOARDS/PATTERNS/CUTS...
```

No se encontró todavía evidencia primaria que convierta el orden completo de
familias en un requisito universal. El orden observado sí es evidencia de
receptor.

Política de investigación:

- clasificar cada reorder como REQUIRED / RECEIVER-PREFERRED / FORMATTING ONLY;
- si no hay razón para divergir, r5 puede adoptar el orden conocido-bueno;
- no afirmar que el orden causó el segundo rechazo sin `.rlt`.

---

## 16. CADLink: diagnóstico que debemos automatizar

CADLink soporta:

```text
/CAD4
/RESULT[=path]
/INF
/UDI
```

Para un PTX ASCII, el `.rlt` contiene:

```text
error number
field number
line number
```

Errores documentados relevantes:

```text
0  success
2  bad format
3  too many jobs
4  duplicate jobs
5  too many part types
6  too many board types
7  too many patterns
8  too many cuts
9  illegal part index
10 illegal board index
11 illegal pattern index
12 illegal cut index
13 illegal offcut index
17 illegal material index
```

La próxima entrega debe incluir instrucciones para ejecutar con `/RESULT`. Si el
cliente puede devolver un único archivo, debe ser el `.rlt`, no una descripción
manual del popup.

También debemos documentar que `cadlink.ini` y las opciones `/INF`/`/UDI`
pueden cambiar qué información termina en los information boxes del SAW.

---

## 17. Qué NO explica por sí solo el segundo rechazo

No convertir en nueva superstición:

- ausencia de `PARTS_INF` / `PARTS_UDI`: es un problema funcional de labels,
  pero PTX puede importar subconjuntos mínimos;
- quoting o espacios tras comas;
- usar enteros frente a `10.000` cuando el valor numérico es equivalente;
- filename r4 corto: se conserva, pero no hay evidencia de que el nombre previo
  fuese la causa;
- `CUTS.COMMENT`: permitido por especificación.

---

## 18. Clasificación final de hallazgos

### CONFIRMED SPEC DEFECT

- `HEADER.TITLE` r4 = 43 > 25.

### CONFIRMED PRODUCT GAPS

- no `PARTS_INF`;
- no `PARTS_UDI`;
- no contrato de etiqueta completo;
- no `DRAWING`/barcode como puente CNC;
- documentación de F92 demasiado específica;
- no receiver profile que modele de forma explícita los parámetros observados
  de HPP250/CAD4.

### STRONG RECEIVER EVIDENCE

- estructura repetida R2201/R7301;
- `BOOK=3`, kerf 4.4, trims/rules coincidentes;
- `PARTS_INF` + `PARTS_UDI` presentes por cada part;
- `OFFCUTS` antes de patterns;
- `92 + X1`;
- `PATTERNS.MAX_BOOK=3`.

### STILL UNKNOWN

- root cause exacta del segundo rechazo;
- subversión exacta CADmatic 4.0/4.1;
- semántica exacta del UDI compacto del software del cliente;
- obligación del orden completo de familias;
- qué overrides exactos exige su `cadlink.ini`;
- si todos los parámetros MATERIALS observados son necesarios para convertir o
  sólo para ejecutar/visualizar correctamente.

---

## 19. Regla de gobernanza para r5

```text
r4 = evidencia histórica rechazada
r5 = nueva identidad industrial
```

No mutar bytes/digests de r4.

Esperado, sujeto a la gobernanza existente:

```text
profile: ptx-cadmatic-4@r5
adapter: granete-ptx@1.4.0
supportStatus: NOT_TESTED
claim: notClaimed
```

Ninguna promotion de soporte ocurre por tests internos.

---

## 20. Gate para empezar implementación

Antes de escribir serializer r5, el agente debe:

1. leer este dossier completo;
2. leer `01`–`05` sin reescribir su historia;
3. contrastar cualquier nuevo cambio de bytes contra el Interface Guide;
4. usar las muestras saneadas como evidencia del receptor;
5. registrar toda nueva fuente primaria encontrada;
6. clasificar cada decisión:
   - `SPEC_REQUIRED`
   - `RECEIVER_EVIDENCED`
   - `PRODUCT_POLICY`
   - `UNKNOWN`
7. **STOP** si una decisión industrial necesita inventar una semántica no
   respaldada por spec, código actual o evidencia de cliente.

El plan de implementación autoritativo para r5 está en
[`07_plan_r5_receiver_labels_cnc.md`](07_plan_r5_receiver_labels_cnc.md).
