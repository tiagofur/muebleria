# PTX / CADmatic 4 — PARTS_INF, PARTS_UDI, etiquetas y puente de identidad CNC (#789, r5-B)

> Incremento R5-B del programa [#787](https://github.com/tiagofur/muebleria/issues/787).
> Sólo este incremento: modelo tipado de PARTS_INF/PARTS_UDI, proyección
> industrial de etiqueta por pieza física, identidad CNC (DRAWING/BARCODE) y
> las verificaciones asociadas. El receiver profile HPP250/CAD4 (#790), la
> semántica CUTS diferencial (#791), CADLink/RLT (#792) y el candidato final
> r5 (#793) quedan fuera. Sin envío de PTX al cliente; `supportStatus`
> sigue `NOT_TESTED` y el claim sigue `notClaimed`.

## 1. Autoridad documental nueva (diccionario §20, pp. 168–171)

Extraída de la fuente primaria S03 (Magi-Cut Interface Guide V11) el
2026-09-19 con la receta de decodificación del PDF (CID+0x1D):

```text
§20 p.168 — PARTS_INF (32 columnas documentadas):
  1 JOB_INDEX  'Job index IDX 1-250'
  2 PART_INDEX 'Part index IDX 1-9999'
  3 DESC       'Second part desc TXT 200 chars max.'
  4 LABEL_QTY  'Label quantity TXT 200 chars max.'
  5 FIN_LENGTH 'Finished length TXT 200 chars max.'
  6 FIN_WIDTH  'Finished width TXT 200 chars max.'
  7 ORDER      'Original order TXT 200 chars max.'
  8 EDGE1      'Btm length edge code TXT 200 chars max.'
  9 EDGE2      'Top length edge code TXT 200 chars max.'
 10 EDGE3      'Left width edge code TXT 200 chars max.'
 11 EDGE4      'Right width edge code TXT 200 chars max.'
 12 EDG_PG1..4 'Bottom/Top/Left/Right edge program TXT 200'
 16 FACE_LAM   'Face laminate TXT 200'
 17 BACK_LAM   'Back laminate TXT 200'
 18 CORE_MAT   'Core material TXT 200'   (el nombre documentado es CORE_MAT, no CORE)
 19 PALLET     'Pallet layout TXT 200'
 20 DRAWING    'Name of drawing file TXT 200'
 21 PRODUCT    'Product code TXT 200'
 22 PROD_INFO  'Product description TXT 200'
 23 PROD_WIDTH 'Product width TXT 200'
 24 PROD_HGT   'Product height TXT 200'
 25 PROD_DEPTH 'Product depth TXT 200'
 26 PROD_NUM   'Product number TXT 200'
 27 ROOM       'Room/group TXT 200'
 28 BARCODE1   'Data for first barcode TXT 200'
 29 BARCODE2   'Data for second barcode TXT 200'
 30 COLOUR     'Extended colour name TXT 200'
 31 SECOND_CUT_LENGTH 'Length prior to second cut TXT 200'
 32 SECOND_CUT_WIDTH  'Width prior to second cut TXT 200'
§20 pp.169–171 — PARTS_UDI: JOB_INDEX (IDX 1-250), PART_INDEX (IDX 1-9999) y
  INFO1..INFO60 'Information field N TXT 200 chars max.' (60 columnas homogéneas).
§5 p.240 (CADLink) — "/INF /UDI - all 28 PARTS_INF followed by all PARTS_UDI
  (88 boxes in total)": la AYUDA de CADLink habla de 28 campos PARTS_INF y 60
  PARTS_UDI para sus information boxes; el DICCIONARIO del formato lista 32
  columnas PARTS_INF. Ambos datos se registran; ninguno autoriza a Granete a
  alterar el ancho documentado (32), y el shape final del candidato r5 lo
  decide el receiver profile (#790).
```

Dos consecuencias de contrato que #789 respeta:

- **LABEL_QTY, FIN_LENGTH, FIN_WIDTH, PROD_WIDTH/HGT/DEPTH y PROD_NUM son
  TXT**, no DIM/QTY/INT: el modelo tipado lleva strings, el lector jamás
  coacciona números, y el preflight NO aplica rangos DIM/QTY a esta familia
  (no hay autoridad para inventarlos). La forma numérica al escribir es
  política del candidato (misma resolución/serialización que el resto del
  archivo).
- El límite de cada campo es **200 caracteres** (catálogo del preflight,
  filas `PARTS_INF.*` / `PARTS_UDI.INFO*`), y las referencias
  `PARTS_INF.PART_INDEX` / `PARTS_UDI.PART_INDEX` deben resolver contra
  `PARTS_REQ` del mismo job (SPEC).

## 2. Proyección industrial congelada (`packages/excel/src/ptx/partLabels.ts`)

El serializer PTX **no reconstruye** datos de etiqueta. Toda la información
viene de `PtxPartLabelData` — UNA entrada por PIEZA FÍSICA, construida una
vez por `buildPtxPartLabels` desde las filas de ingeniería
(`ProductionCutRow`, convención terminada) y el contexto de unidad congelado
(ordinal, módulo, room), y después sólo PROYECTADA a columnas:

```text
physical piece
  ↔ manufacturingPartCode (= PARTS_REQ.CODE bajo workshop-labelref, r4+)
  ↔ PART_INDEX
  ↔ PARTS_INF row
  ↔ DRAWING (D<hex12>) / BARCODE1 (*D<hex12>*)
  ↔ futuro artefacto CNC (MPR/MPRX) — NO se genera en #789
```

El compiler (`compileCutPlanToPtxDocument({ partLabels, partsUdi })`) sólo
proyecta: nunca consulta BOM, catálogo, SketchUp, nombres ni geometría para
"completar" datos. La expansión quantity>1 usa el MISMO sufijo `-C<n>` que
el optimizador asigna a las piezas colocadas (`unrollRows`), de modo que la
clave de la proyección es exactamente el `PARTS_REQ.CODE` del candidato.

## 3. Política r5 de dimensiones PARTS_REQ

- **SPEC:** `PARTS_REQ.LENGTH` y `PARTS_REQ.WIDTH` describen las dimensiones
  requeridas de la pieza de la lista de corte en el frame local de la pieza.
  `PARTS_REQ.GRAIN=0` permite rotar la pieza durante la optimización. Esta
  lectura documenta el significado de los bytes; no afirma aceptación por el
  receptor ni por una máquina.
- **PRODUCT POLICY r5:** el candidato r5 usa explícitamente
  `partsReqDimensionPolicy: 'part-local-pre-rotation-cut'`. Cuando el
  optimizador coloca una pieza rotada, el compiler escribe `PARTS_REQ`
  intercambiando las dimensiones colocadas de vuelta al frame local de corte
  de la pieza; no recalcula descuentos ni inventa una segunda geometría.
- **Gate de etiquetas r5:** `partLabels` requiere
  `partsReqDimensionPolicy: 'part-local-pre-rotation-cut'`. `partLabels` con
  la política ausente o con `placement` falla cerrado en el compiler con
  `ptx_compile.options_invalid`; las etiquetas NO seleccionan ni infieren
  automáticamente la política local.
- **Compatibilidad histórica:** sin `partLabels`, la opción ausente o
  `placement` conserva la política r2/r3/r4 byte-exact: `PARTS_REQ` refleja
  las dimensiones colocadas. Sin etiquetas,
  `part-local-pre-rotation-cut` también es una opción reutilizable y válida.
- **Readback independiente:** `verifyCutPlanPtxReadback` aplica una derivación
  condicional independiente de la del compiler. `FIN_LENGTH`/`FIN_WIDTH` se
  mantienen como dimensiones terminadas originales, y la identidad esperada
  sigue siendo `FIN = corte local de pieza + descuentos de canto`.
- **Fixture vigente:** el caso rotado real tiene `piece.rotated === true`,
  colocación `39×549`, `PARTS_REQ 549×39`, `GRAIN=0`, `FIN 550×40` y cantos
  `EDGE2`/`EDGE4`; una mutación vieja que vuelve `PARTS_REQ` a las dimensiones
  colocadas falla con `parts.dims`, mientras que el caso no rotado conserva
  igualdad entre dimensiones colocadas y locales.

## 4. Mapping Granete → PARTS_INF (autoridad por campo)

| Columna PTX | Fuente Granete | Autoridad / clasificación |
|---|---|---|
| JOB_INDEX, PART_INDEX | wiring del compiler (1..N por pieza colocada) | PRODUCT (estructura; ranges SPEC §20) |
| DESC | `row.partName ?? row.description` (nombre humano) | PRODUCT_POLICY; las muestras lo llevan VACÍO (decisión de su optimizador, no una regla) |
| LABEL_QTY | `String(1)` — una fila por pieza física ⇒ una etiqueta por pieza | PRODUCT_POLICY documentada; NO copiada de las muestras; §20 la tipa TXT |
| FIN_LENGTH / FIN_WIDTH | `row.lengthMm` / `row.widthMm` COPIADOS (convención terminada de la fila de ingeniería) | PRODUCT: la fila ES la verdad terminada; el descuento de canto vive SOLO en `unrollRows` (optimizador). Test de identidad: corte (PARTS_REQ) + descuento == terminada (PARTS_INF), desde los bytes |
| ORDER | `orderRef` corto de release (p.ej. `R3`) | PRODUCT (referencia de obra); vacío si no existe |
| EDGE1 (Btm length) | bandera **L2** + `edgeBandCode` | SPEC (nombre de columna §20) + PRODUCT (mapeo de lados, §5 abajo) |
| EDGE2 (Top length) | bandera **L1** + `edgeBandCode` | ídem |
| EDGE3 (Left width) | bandera **W1** + `edgeBandCode` | ídem |
| EDGE4 (Right width) | bandera **W2** + `edgeBandCode` | ídem |
| EDG_PG1..4 | **VACÍO** — Granete no tiene código de operación/programa de canto | UNKNOWN: no se inventan valores ("EDGE", "1", …) sólo porque la columna existe |
| FACE_LAM / BACK_LAM | **VACÍO** — sin autoridad de laminación separada | UNKNOWN → vacío |
| CORE_MAT | `row.materialCode` (`ProductionCutRow.materialCode`) | PRODUCT_POLICY: autoridad del tablero ya existente; no introduce receiver MATERIALS tuning |
| PALLET | **VACÍO** — nombre nominal del campo; posición serializada sin cambios respecto del contrato de 32 columnas | UNKNOWN |
| DRAWING | `D<hex12>` sólo con autoridad CNC explícita (`hasCncMachining: true`) y `cncScope` congelado no vacío (ver §6) | PRODUCT_POLICY sobre campo SPEC TXT 200; ausencia/false deja DRAWING y BARCODE1 vacíos |
| PRODUCT | `unit.moduleCode` | PRODUCT |
| PROD_INFO | `unit.moduleName` | PRODUCT |
| PROD_WIDTH/HGT/DEPTH | `unit.module{Width,Height,Depth}Mm` (dims finales del mueble) | PRODUCT; §20 las tipa TXT |
| PROD_NUM | `unit.workshopOccurrenceOrdinal` — el ordinal 1-based CONGELADO al liberar (#781), nunca orden de array/léxico | PRODUCT sobre autoridad congelada |
| ROOM | `unit.room` (espacio nombrado del proyecto; autoría `ModuleLabel.spaceName`) | PRODUCT |
| BARCODE1 | `*D<hex12>*` — token de scan Code 39 vinculado a DRAWING | PRODUCT (muestras evidencian el envoltorio `*…*`; la elección de BARCODE1 vs BARCODE2 es política — R2201 y R7301 la usan OPUESTA entre sí) |
| BARCODE2 | el `manufacturingPartCode` verbatim | PRODUCT (token de tracking con autoridad real) |
| COLOUR | **VACÍO** — sin autoridad de color separada del material | UNKNOWN |
| SECOND_CUT_* | **VACÍO** — sin segundo corte en el subconjunto | UNKNOWN |

## 5. Orientación de cantos: L1/L2/W1/W2 → EDGE1..4

- Convención de taller de Granete (documentada en
  `packages/ui/src/components/editor/PlankEdgeDiagram.tsx` y usada por
  `zplLabels.ts`): pieza apoyada, largo horizontal, mirando la cara
  etiquetada — **L1 = canto largo superior, L2 = canto largo inferior,
  W1 = canto corto izquierdo, W2 = canto corto derecho**.
- Diccionario §20 (comentarios de columna): EDGE1 "Btm length", EDGE2 "Top
  length", EDGE3 "Left width", EDGE4 "Right width".
- Ambas convenciones miran la misma cara con el largo horizontal, por lo que
  el mapeo es:

```text
EDGE1 (Btm length)  ← L2        EDGE2 (Top length) ← L1
EDGE3 (Left width)  ← W1        EDGE4 (Right width) ← W2
```

El mapeo NO es simétrico (L1 NO alimenta EDGE1) a propósito: la trampa de
los tests (`partLabels.test.ts`, golden) usa piezas con patrones asimétricos
(3+1, sólo-L2, sólo-W1/W2) de modo que cualquier swap L1↔L2 o eje L↔W
cambia el tuple emitido y falla. Límite honesto: Granete lleva UN código de
banda por pieza; piezas con dos o
más lados encintados emiten el mismo `edgeBandCode` en cada lado marcado. Un
flag de canto sin `edgeBandCode` autoritativo falla cerrado; distinguir códigos
de banda distintos por lado queda fuera de #789/#797.

## 6. Puente CNC: DRAWING / BARCODE / colisiones

Clasificación separada:

- **SPEC:** DRAWING y BARCODE1 son columnas TXT 200 del diccionario §20; el
  diccionario no define el algoritmo ni autoriza inferir mecanizado por nombre.
- **PRODUCT POLICY:** `cncDrawingRef = 'D' + sha256('granete:ptx-cnc-drawing:' +
  cncScope + ':' + manufacturingPartCode)[0..12].toUpperCase()` — ASCII, 13
  chars, determinista, derivado sólo de un scope CNC/release congelado y
  explícito más el código de fabricación. No es UUID, no usa reloj/azar y no
  reserva un basename futuro cuando el mecanizado es desconocido.
- **PRODUCT POLICY:** sólo `hasCncMachining: true` con `cncScope` no vacío emite
  DRAWING y BARCODE1. `hasCncMachining: false` o ausente deja ambos campos
  VACÍOS; BARCODE2 conserva el código de fabricación porque el tracking no
  depende del mecanizado.
- **RECEIVER EVIDENCE:** BARCODE1 usa el envoltorio Code 39 `*D<hex12>*`, forma
  observada en las muestras; la columna BARCODE1 vs BARCODE2 sigue siendo
  política de Granete porque R2201 y R7301 usan tokens opuestos.
- **UNKNOWN:** no se genera MPR/MPRX/BHX, no se afirma aceptación CADLink y no
  se infiere compatibilidad del centro CNC.
- Fail-closed en el compiler: dos piezas con el mismo DRAWING →
  `ptx_compile.label_drawing_duplicate`; dos piezas con el mismo BARCODE1 →
  `ptx_compile.label_barcode_duplicate`; BARCODE2 ≠ código de fabricación →
  `ptx_compile.label_invalid`. Nada se trunca ni se desambigua en silencio.

## 7. PARTS_UDI: inventario, clasificación y política de #789

| Campo | Clasificación | Decisión #789 |
|---|---|---|
| JOB_INDEX / PART_INDEX | SPEC_DOCUMENTED (§20 IDX) | emitidos; referencia a PARTS_REQ verificada |
| INFO1..INFO60 (shape TXT 200) | SPEC_DOCUMENTED | modelados como array posicional; lector acepta filas cortas (trailing omitted) |
| INFO1 = `<imagen>.png` (muestras R2201/R7301) | RECEIVER_EVIDENCED | NO se genera imagen en #789; la proyección lleva `udiPictureRef` opcional y el compiler lo escribe si existe (hoy: vacío) |
| INFO2 = encoding compacto de cantos (`2WE2LE`, `2WD2LD`, `2LE`, `2WI1LI1LE`, …) | **UNKNOWN** | JAMÁS generado ni interpretado: la semántica exacta no está demostrada por spec ni documentación; se lee crudo en el lector externo |
| INFO3/INFO4 = código de acabado (LINEA-A/B/C) | RECEIVER_EVIDENCED | vacíos hasta #790 (una conjetura de face/back no es autoridad) |
| INFO5..60 | UNKNOWN | vacíos |

`partsUdi: 'structural'` emite UNA fila por pieza con JOB/PART y los INFO
definidos por la proyección (hoy: ninguno ⇒ fila corta de 2 celdas): la
familia queda MODELADA y PRESENTE sin inventar semántica. La política final
del receptor (imagen de diagrama de cantos incluida) es #790. El diagrama de
cantos (Edging diagram de Magi-Cut) es PRESENTACIÓN, no autoridad: la verdad
de lados/cantos ya viaja en EDGE1..4.

## 8. Orden de records y shape

- El compiler emite los bloques PARTS_INF y PARTS_UDI **inmediatamente
  después del bloque PARTS_REQ** (contiguos, orden por PART_INDEX). La
  adyacencia PARTS_REQ→PARTS_INF→PARTS_UDI es RECEIVER_EVIDENCED en
  R2201/R7301 (orden completo observado: HEADER, JOBS, PARTS_REQ, PARTS_INF,
  PARTS_UDI, BOARDS, MATERIALS, NOTES, OFFCUTS, PATTERNS/CUTS).
- El resto del orden de familias NO se tocó en #789 (r4 dialect: MATERIALS
  antes de PARTS_REQ, OFFCUTS antes de PATTERNS). Convertir el orden completo
  observado en política del profile HPP250 es #790.
- Writer shape: PARTS_INF escribe el ancho documentado completo (32 celdas;
  los valores ausentes van como celdas vacías finales, la misma filosofía
  que JOBS). PARTS_UDI escribe sólo el prefijo INFO definido (trailing
  omitted, la disciplina de OFFCUTS.OFC_QTY). El lector acepta filas más
  cortas (trailing opcional) y falla cerrado pasadas las 32/62 columnas.

## 9. Verificación y gates

- `specPreflight` (extendido): TXT 200 por cada campo PARTS_INF y
  PARTS_UDI.INFO1..60; IDX 1-250/1-9999; referencias PART_INDEX → PARTS_REQ.
  Unicidad de PARTS_INF por pieza NO es SPEC (el diccionario no la
  documenta): es contrato de producto y vive en `validatePtxDocument`
  (DUPLICATE_INDEX), documentado como PRODUCT.
- `validatePtxDocument` (extendido): referencias (job, part) a PARTS_REQ,
  duplicados por pieza, ASCII imprimible en todos los TXT.
- `verifyCutPlanPtxReadback` (extendido): desde los BYTES, cada PARTS_INF
  debe ser la proyección pura de la etiqueta de SU pieza (todas las celdas),
  los campos sin autoridad deben estar AUSENTES (un byte mutado que los
  rellena es `parts_inf.authority_violation`), y la IDENTIDAD DE MEDIDAS se
  re-deriva de forma independiente: la fila terminada del optimizador
  (`originalLength/WidthMm`, preservada pre-rotación) y el corte esperado bajo
  la política activa (`placement` histórica o `part-local-pre-rotation-cut`
  r5) + descuentos de canto deben coincidir con la etiqueta — una etiqueta
  cableada a la pieza equivocada falla en dimensiones o cantos.
- Gates del compiler: `label_missing`, `label_code_unknown`,
  `label_code_duplicate`, `label_drawing_duplicate`,
  `label_barcode_duplicate`, `label_invalid`, `options_invalid`
  (`partLabels` exige `partCodeAuthority: 'workshop-labelref'` y
  `partsReqDimensionPolicy: 'part-local-pre-rotation-cut'`; `partLabels` con
  política ausente/`placement` falla cerrado; las etiquetas no infieren esa
  política; `partsUdi: 'structural'` exige partLabels).
- Fixtures nuevos: `cutPlanPtxLabelsGolden.ts` (2 módulos, 3 unidades
  físicas con ocurrencia repetida, orden léxico OPUESTO al de ordinales
  —trampa antisimétrica—, nombres de pieza distintos, patrones de canto
  3+1/todos/1-L2/sólo-eje-W/ninguno, dos materiales y dos cantos con
  espesores distintos, qty-2 con -C2, ROOM distinto en la ocurrencia
  repetida, ORDER, drawing refs y barcodes). El hardening #797 añade un caso
  real del optimizador con `grain=0` y `allowRotationNoGrain`: la pieza queda
  `rotated === true`, colocada `39×549`, `PARTS_REQ 549×39`, `FIN 550×40`,
  `EDGE2`/`EDGE4`; preserva lados físicos L1/L2/W1/W2 en la etiqueta (no
  ejes del tablero), y pasa serialize→parse→readback independiente. El
  hardening T6 agrega cobertura E2E compiler→bytes→parse con
  `hasCncMachining: false`, confirmando DRAWING/BARCODE1 ausentes y BARCODE2
  ligado a `PARTS_REQ.CODE` sin cambiar la implementación CNC. Tests en
  `partLabels.test.ts`, `compileCutPlan.partsInf.test.ts`,
  `specPreflight.test.ts` (#789), `roundtrip.test.ts` (#789) y
  `externalDialect.test.ts` (R2201/R7301 ahora leídas TIPADAS en
  PARTS_INF/PARTS_UDI con sus relaciones verificadas).
- r2/r3/r4: sin la opción `partLabels` el compiler no emite PARTS_INF ni
  PARTS_UDI; los goldens históricos recompilan byte-exact (la regresión de
  inmutabilidad del preflight sigue en verde). Ningún golden histórico fue
  modificado.

## 10. Pertenencia posterior (NO parte de #789)

- #790 receiver profile HPP250/CAD4: shape final de columnas opcionales,
  orden completo de familias, MATERIALS receiver policy (BOOK/kerf/trims/
  RULE1..4), tuning receptor de materiales, INFO3/4 e imagen de etiqueta.
- #791 CUTS diferencial (FUNCTION 90..99 como fases, no "92 = offcut").
- Futuro CNC real: generación MPR/MPRX/BHX con basename = cncDrawingRef;
  el escaneo de BARCODE1 en el centro de mecanizado resuelve el programa.
- #793 productivo r5: el scope CNC debe derivarse de
  `CutPlan.releaseBase.manufacturingFingerprint` o de un equivalente congelado
  autoritativo, y debe bloquearse si falta `releaseBase`. Los strings
  `release:789:r5:*` siguen siendo fixtures de laboratorio; este documento no
  implementa ese wiring.
- Normalización de códigos del receptor (espacios→underscore, uppercase al
  importar, §20 p.166): riesgo de fusión de identidades, sigue en #790.

## 11. Verificación ejecutada

Evidencia enfocada observada para el hardening #797 antes de T4/T5:

```sh
# HEAD 32518fc47273f74af71520985953f68d9ca32bf3
pnpm --filter @granete/excel test   # 45 archivos, 534 PASS + 3 skips
pnpm typecheck                      # PASS
# prior diff check                  # limpio
```

T4 agregó la política explícita `partsReqDimensionPolicy:
'part-local-pre-rotation-cut'`. Work-unit de política:
`f4dac0af791fd58052b49b7acf91a31c70ebd118`. La verificación local final del
candidato rotado de T5 se hizo en `ed1d5066b61db18da64e774879f8f14f59b16011`;
ese commit es una corrección test-only que importa `PtxRecord` después de la
falla inicial de `pnpm typecheck` del candidato. Evidencia en `ed1d5066`: Excel
45 archivos / 534 PASS + 3 skips, `pnpm typecheck` PASS y `git diff --check`
PASS.

Intento de selector autorizado sobre el candidato
`ed1d5066b61db18da64e774879f8f14f59b16011` contra base
`b7446866ed247677d8b8f83238cddbd96579db97`:

```sh
python3 scripts/verify_affected.py --base origin/main --budget-seconds 3600
```

Resultado: bloqueado antes de ejecutar gates porque requiere un `DATABASE_URL`
aislado. El selector se ejecutó una sola vez con presupuesto de 3600 s y
seleccionó los jobs `typescript`, `backend-go`, `sketchup-extension`,
`proyectar-visual`, `foundation-postgres` y `organization-browser`; ninguno de
esos gates corrió ni se registra como PASS local.

T6 quedó registrado en el HEAD `d68aa969cbc47d243f1d51828ffbfa87866e3718`:
`partLabels` exige `partsReqDimensionPolicy: 'part-local-pre-rotation-cut'`;
`partLabels` con política ausente/`placement` falla cerrado como
`ptx_compile.options_invalid`; las etiquetas no auto-seleccionan ni infieren esa
política; sin etiquetas, las políticas ausente/`placement` conservan el
comportamiento histórico y `part-local-pre-rotation-cut` es reutilizable/válida.
La cobertura E2E CNC=false compiler→bytes→parse confirma DRAWING/BARCODE1
ausentes y BARCODE2 ligado a `PARTS_REQ.CODE`, sin cambio de implementación CNC.

Verificación local final del candidato
`18d09e350c741b2c1a5f38ee95df22a1b161b700`: Excel 45 archivos / 539 PASS / 3
skips, `pnpm typecheck` PASS y `git diff --check` PASS. El selector autorizado
corrió una sola vez con 3600 s en ese candidato contra base
`b7446866ed247677d8b8f83238cddbd96579db97` y bloqueó antes de selected gates
porque falta un `DATABASE_URL` aislado. Los gates seleccionados de
TypeScript/Go/Ruby/WebGL/Foundation no corrieron localmente y no son evidencia
PASS. CI final del nuevo HEAD sigue pendiente; T7 sigue en curso para push/CI
del mismo PR #797. No hay claim de entrega completa ni de aceptación de
receptor/máquina.

Inmutabilidad r2/r3/r4: los goldens históricos se recompilan byte-exact dentro
de la suite focalizada; r2/r3/r4, FUNCTION 92, perfiles/adapters y salidas de
cliente quedan fuera de #797 y no fueron tocados por este hardening.
