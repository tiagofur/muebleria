# PTX / CADmatic 4 — strict spec preflight y límites documentados (#788, r5-A)

> Incremento R5-A del programa [#787](https://github.com/tiagofur/muebleria/issues/787)
> (reconstrucción del receiver HPP250/CAD4 tras el segundo rechazo CADLink del
> candidato `GD8754F0B9995.ptx`, `ptx-cadmatic-4@r4` + `granete-ptx@1.3.0`).
> Sólo este incremento: validador estricto de especificación ANTES de
> serializar. Las etiquetas/CNC (#789), el receiver profile (#790), CUTS
> diferencial (#791), CADLink/RLT (#792) y el candidato final r5 (#793) quedan
> fuera.
>
> Nota de procedencia: al INICIAR #788 los docs `06_dossier…` y `07_plan…`
> referenciados por #787 no existían en el repo; la autoridad de los límites
> se obtuvo directamente de la fuente primaria S03 ya citada por la
> investigación (01 §2), con extracción local del texto del PDF (2026-09-18)
> y citas verbatim abajo. El PR #794 integró el dossier y el plan DURANTE esta
> tarea: sus reglas (06 §5.1 TITLE 25/fail-closed; 07 §4 matriz R5-A, ORIGIN
> 0..3, espacios iniciales ignorados, índices desde 1 consecutivos) se
> contrastaron contra esta implementación y coinciden punto por punto.

## 1. Hallazgo objetivo que inicia este trabajo

Historia precisa: hubo candidatos previos de Granete rechazados por el flujo
CADLink/CADmatic 4 del cliente; r4 (`GD8754F0B9995.ptx`,
`ptx-cadmatic-4@r4` + `granete-ptx@1.3.0`) es el **segundo candidato real
documentado en el dossier (#787)** y también fue rechazado. r4 produce
(industrial y lab):

```text
HEADER,1,GRANETE-PTX-CANDIDATE NOT_MACHINE_VALIDATED,0,0,1   → TITLE 43 chars
HEADER,1,LAB_FIXTURE NOT_MACHINE_VALIDATED,0,0,1              → TITLE 33 chars (goldens)
```

El diccionario de campos de Pattern Exchange documenta `TITLE … TXT 25 chars
max.` La clasificación honesta:

- `SPEC VIOLATION: CONFIRMED` (43 > 25 y 33 > 25);
- `ROOT CAUSE OF CADLINK FAILURE: NOT PROVEN` — ningún texto de este programa
  afirma que el TITLE haya sido el motivo del rechazo.

Ningún candidato r5 debe poder volver a producir este defecto: el valor que no
cabe **bloquea** (`fail closed`); jamás se trunca, reemplaza ni oculta.

## 2. Autoridad documental de cada límite

Fuente primaria S03 = [Magi-Cut Interface Guide
V11](https://www.magi-cut.co.uk/files/V11%20Interface%20Guide.pdf), capítulo 3
(Pattern Exchange). §4 (prose, p.118 impresa) describe el HEADER; §20
"Summary of data structure" (pp. 166–178) es el diccionario de campos con
tipos y límites por columna (TXT → "maximum length of each text field is
listed in the comment column"; IDX → rangos enteros por registro).

Citas verbatim extraídas del PDF (2026-09-18):

```text
§20 p.166 — "The job records must have unique job index numbers starting at 1,
             and incrementing consecutively within specified range. The part,
             board and pattern records must each have their respective index
             numbers unique within the job, and again be numbered from 1 and
             incremented consecutively."
§4  p.118 — "All 'index numbers' must be integer values, starting at 1 for the
             first record, and incrementing consecutively up to the maximum
             specified. Note, in particular that all part, board, pattern and
             cutting records must contain the appropriate job index number
             showing which job they relate to."
§20 p.167 — HEADER:  VERSION "Set to 1.06" · TITLE "25 chars max." ·
             UNITS "INT 0,1" · ORIGIN "INT 0-3" · TRIM_TYPE "INT 0,1"
             JOBS:   JOB_INDEX "IDX 1-250" · NAME/DESC "50 chars max." ·
             CUSTOMER "100 chars max." · OPT_PARAM/SAW_PARAM "50 chars max."
§20 p.168 — PARTS_REQ: PART_INDEX "IDX 1-9999" · CODE "TXT 50 chars max."
§20 p.173 — BOARDS: BRD_INDEX "IDX 1-5000" · CODE "50 chars max"
             MATERIALS: CODE/DESC "50 chars max"
§20 p.175 — PATTERNS: PTN_INDEX/BRD_INDEX "IDX 1-5000"
             OFFCUTS: OFC_INDEX "IDX 1-7500" · CODE "50 chars max"
§20 p.178 — CUTS: CUT_INDEX "IDX 1-5000" · COMMENT "TXT 100 chars max" ·
             PART_INDEX "TXT 1-9999 or X1-X7500" · FUNCTION "INT 0-9, 90-99"
§4  p.118 — ORIGIN: 0 = top to bottom - left to right; 1 = top to bottom
             right to left; 2 = bottom to top left to right; 3 = bottom to
             top right to left. UNITS: 0 (metric), 1 (decimal inches).
§20 p.166 — "DIM Dimension. Number single. When working in millimetres these
             range from 0.0 to 9999.9. When working in decimal inches
             dimensions must range from 0.000 to 999.9"
§20 p.166 — "QTY A long integer used to store quantity. No quantity can be
             greater than 99999."
§20 p.166/174 — MATERIALS: RULE1 "INT 1-9" · RULE2/RULE3/RULE4 "INT 0,1"
§20 p.168 — PARTS_REQ: GRAIN "INT 0,1,2" · LENGTH/WIDTH "DIM" ·
             QTY_REQ/QTY_OVER/QTY_UNDER/QTY_PROD "QTY Max 99999"
§20 p.167 — JOBS: STATUS "INT 0,1,2" · CUT_TIME "Total cut time INT"
§5  p.120 — STATUS: "0 - not optimised 1 - optimised 2 - optimise failed Note:
             there may be a range of other error codes" (conocidos, NO
             exhaustivos) · CUT_TIME: "Total cutting time for the job in
             seconds" (§5 p.121)
§20 p.178 — CUTS: SEQUENCE "Cut sequence INT Number-Integer"
§20 p.175 — PATTERNS: TYPE "INT 0-8" · QTY_RUN/QTY_CYCLES/MAX_BOOK "QTY"
§5  p.120 — "This record contains data about each job contained in the file.
             These records are optional and in the absence of job records all
             parts and patterns are assumed to belong to the same job."
```

La propia guía advierte (§4 p.118): *"the limitations (eg. max length of
material code) will vary according to the implementation and specification of
the saw"* — `SPEC_REQUIRED` es el máximo DEL FORMATO, no un claim de
compatibilidad del receiver. `supportStatus` sigue `NOT_TESTED` y el claim
sigue `notClaimed`.

### Límites implementados (`packages/excel/src/ptx/specPreflight.ts`, `PTX_SPEC_LIMITS`)

| Campo | Límite | Clasificación | Localizador |
|---|---|---|---|
| HEADER.TITLE | ≤ 25 chars | SPEC_REQUIRED | §20 p.167 |
| HEADER.UNITS | ∈ {0, 1} | SPEC_REQUIRED | §20 p.167 + §4 p.118 |
| HEADER.ORIGIN | ∈ {0, 1, 2, 3} | SPEC_REQUIRED | §20 p.167 + §4 p.118 |
| HEADER.TRIM_TYPE | ∈ {0, 1} | SPEC_REQUIRED | §20 p.167 |
| HEADER.VERSION | numérico positivo finito | SPEC_REQUIRED (forma); valor exacto UNKNOWN | §20 p.167 "Set to 1.06" vs §4 p.118 "(1.08)" vs ejemplos con 1 — investigación §9 |
| JOBS.NAME / DESC / OPT_PARAM / SAW_PARAM | ≤ 50 | SPEC_REQUIRED | §20 p.167 |
| JOBS.CUSTOMER | ≤ 100 | SPEC_REQUIRED | §20 p.167 |
| JOBS.JOB_INDEX | 1..250 | SPEC_REQUIRED | §20 p.167 |
| PARTS_REQ.CODE / BOARDS.CODE / MATERIALS.CODE / MATERIALS.DESC / OFFCUTS.CODE | ≤ 50 | SPEC_REQUIRED | §20 pp.168/173/175 |
| PARTS_REQ.PART_INDEX / MAT_INDEX | 1..9999 | SPEC_REQUIRED | §20 p.168 |
| BOARDS.BRD_INDEX | 1..5000 | SPEC_REQUIRED | §20 p.173 |
| PATTERNS.PTN_INDEX / BRD_INDEX | 1..5000 | SPEC_REQUIRED | §20 p.175 |
| OFFCUTS.OFC_INDEX | 1..7500 | SPEC_REQUIRED | §20 p.175 |
| CUTS.CUT_INDEX | 1..5000 | SPEC_REQUIRED | §20 p.178 |
| CUTS.COMMENT | ≤ 100 | SPEC_REQUIRED | §20 p.178 |
| CUTS.PART_INDEX (numérica / Xn) | 1..9999 / X1..X7500 | SPEC_REQUIRED | §20 p.178 |
| Índices por tabla | enteros ≥ 1, únicos, consecutivos desde 1 (JOBS a nivel archivo; partes/tableros/patrones/materiales/offcuts por job; cortes por patrón) | SPEC_REQUIRED | §20 p.166 + §4 p.118 |
| Referencias | JOB/MAT/BRD/PTN/PART/Xn/CUT deben apuntar a filas existentes del job correspondiente | SPEC_REQUIRED | §4 p.118 + tablas §20 |
| JOBS opcional | sin filas JOBS, un único job implícito es SPEC-válido; >1 JOB_INDEX sin JOBS → `job_scope_ambiguous` (fail closed, no inventado) | SPEC_REQUIRED | §5 p.120 (cita arriba) |
| Campos DIM modelados (PARTS_REQ/BOARDS/OFFCUTS LENGTH+WIDTH, MATERIALS THICK/KERF_RIP/KERF_XCT/TRIM_*, CUTS DIMENSION) | magnitud 0..9999.9 (mm) / 0..999.9 (in) según HEADER.UNITS; sólo magnitud — precisión y mínimos semánticos quedan en producto | SPEC_REQUIRED | §20 p.166 (DIM, cita verbatim) + filas DIM por registro |
| Campos QTY modelados (PARTS_REQ QTY_REQ/OVER/UNDER/PROD, BOARDS QTY_STOCK/USED, MATERIALS BOOK, OFFCUTS OFC_QTY, PATTERNS QTY_RUN/CYCLES/MAX_BOOK, CUTS QTY_RPT/QTY_PARTS) | ENTERO (LONG INTEGER: decimal = spec-invalid) Y ≤ 99999; mínimos quedan en producto | SPEC_REQUIRED | §20 p.166 (QTY, cita verbatim: "A long integer … No quantity can be greater than 99999.") |
| JOBS.STATUS | forma INT (entero); 0/1/2 = códigos CONOCIDOS, no exhaustivos ("there may be a range of other error codes") — otros enteros no son spec-invalid por valor | SPEC_REQUIRED (forma INT) | §20 p.167 + §5 p.120 |
| JOBS.CUT_TIME | forma INT (segundos) cuando está presente — parser/serializer/preflight comparten el contrato entero | SPEC_REQUIRED | §20 p.167 'CUT_TIME Total cut time INT' + §5 p.121 |
| CUTS.SEQUENCE | forma INT (chequeo propio del spec preflight, independiente de validate.ts) | SPEC_REQUIRED | §20 p.178 'SEQUENCE Cut sequence INT Number-Integer' |
| PARTS_REQ.GRAIN | ∈ {0, 1, 2} | SPEC_REQUIRED | §20 p.168 |
| MATERIALS.RULE1 | 1..9 | SPEC_REQUIRED | §20 p.174 |
| MATERIALS.RULE2 / RULE3 / RULE4 | ∈ {0, 1} | SPEC_REQUIRED | §20 p.174 |
| PATTERNS.TYPE | 0..8 (SPEC range) | SPEC_REQUIRED | §20 p.175 |
| CUTS.FUNCTION | diccionario 0..9 ∪ 90..99 (SPEC range) | SPEC_REQUIRED | §20 p.178 |

Nota: el `partCodeMaxLength: 50` de r4 era `PRODUCT_POLICY`; el diccionario
documenta el mismo 50 para `PARTS_REQ.CODE`, por lo que el preflight lo exige
ahora como `SPEC_REQUIRED`.

### SPEC vs PRODUCT CAPABILITY (taxonomía tipada)

`classifyPtxDocumentedEnumSupport` expresa la separación que #790/#791
consumirán, SIN habilitar capacidad nueva:

```text
SPEC_INVALID                        fuera del diccionario documentado
SPEC_VALID_BUT_PRODUCT_UNSUPPORTED  Pattern-Exchange-válido, fuera del subset
                                    del candidato (lo rechaza validate.ts/
                                    compiler — nunca como "invalid Pattern
                                    Exchange")
PRODUCT_SUPPORTED                   documentado Y dentro del subset productivo
```

Casos concretos: `PATTERNS.TYPE` 5..8 (plantillas de veta, S12) y
`CUTS.FUNCTION` 4..9 / 90 / 91 / 93..99 son SPEC_VALID_BUT_PRODUCT_UNSUPPORTED.
La separación vale en document Y EN BYTES (ronda 3): el reading model de
`PATTERNS.TYPE` es el dominio documentado 0..8 (`PtxDocumentedPatternType`;
el parser sólo rechaza <0/>8 como fuera de diccionario), de modo que el spec
preflight de bytes OBSERVA TYPE 5..8 sin clasificarlos spec-error, y la capa
productiva los sigue rechazando (validate.ts INVALID_ENUM_VALUE +
serializePtxDocument rehúsa entregar bytes). Los subsets productivos siguen
siendo los const históricos de `records.ts` (`PTX_PATTERN_TYPE` 0..4,
`PTX_SUPPORTED_CUT_FUNCTION_CODES` [0,1,2,3,92]) — nada de esto habilita
emisión nueva (test lo congela).

### VECTORS y VERSION: decisiones explícitas

- **VECTORS**: §20 NO tiene fila VECTORS (§17 p.146 lo documenta en prose,
  coordenadas "always positive", sin rango numérico). No se aplica rango DIM:
  no hay autoridad para inventarlo. Sólo aplican las referencias PTN/CUT.
- **VERSION**: sólo la FORMA (número positivo finito) es spec. El valor
  exacto del header es UNKNOWN hasta que un receiver profile lo fije con
  evidencia (la guía se contradice: 1.06 vs 1.08 vs ejemplos con 1). Un PASS
  del preflight NUNCA significa "versión verificada por el receptor"; el r5
  final deberá llevar su versión fijada explícitamente por profile.

### Documentado pero NO enforceado en #788 (registrado, no inventado)

- §20 p.166: "spaces are not allowed in the material code, and any spaces will
  be converted to an underscore (_) on import. Also note that material, part
  and board codes are converted to upper case on import." Es normalización del
  receptor (riesgo de fusión de identidades `A B`/`A_B` en importación);
  pertenece al tuning MATERIALS del receiver (#790), no a este preflight.
- PARTS_INF/PARTS_UDI (límites TXT 200): las familias no tienen modelo tipado
  hasta #789.
- Columnas documentadas no modeladas (BOARDS COST/STK_FLAG/INFORMATION/…,
  MATERIALS MAT_PARAM/GRAIN/PICTURE/DENSITY, PATTERNS PICTURE/CYCLE_TIME,
  OFFCUTS COST/TYPE): sin modelo tipado no hay preflight; entran con su
  modelado (#789/#790).

## 3. Independencia writer / validator

El preflight no es "el writer valida lo que acaba de escribir":

```text
CutPlan/CutProgram ──compileCutPlanToPtxDocument──▶ PtxDocument
PtxDocument ──serializePtxDocument──▶ bytes ──parse (lector independiente)──▶
PtxDocument leído ──ptxSpecPreflightDocument──▶ PASS | ptx_spec.*
```

- `specPreflight.ts` NO importa el compiler, el adapter ni `validate.ts`: las
  derivaciones de índices/referencias se reimplementan a propósito (misma
  política de duplicación deliberada que `verifyCutPlanPtxReadback` — un punto
  ciego compartido con el writer no puede autoverificarse dos veces).
- `ptxSpecPreflightBytes` decodifica y parsea con el lector independiente
  (`parse.ts` nunca importa el serializer): un defecto introducido al
  serializar se detecta aunque el modelo en memoria fuera válido (demostrado
  por mutación de bytes post-serialización).
- Fronteras fail-closed que un r5 debe usar:
  - `compileCutPlanToPtxDocument({ strictSpecPreflight: 'pattern-exchange-v1' })`
    → `ptx_compile.spec_preflight_failed` con los `ptx_spec.*` en el contexto
    (blocker accionable en `canSerialize` cuando la ruta r5 exista);
  - `serializePtxDocumentBytesSpecChecked(doc, options)` → bytes sólo si el
    preflight de bytes PASA; si no, `PtxSpecPreflightError` con todas las
    violaciones.
- r2/r3/r4 no activan ninguna de las dos (opción ausente): sus bytes quedan
  congelados (ver §5). El routing del adapter a r5 y el profile/digest nuevos
  pertenecen a #790/#793.

### JOBS: semántica de especificación vs política de producto

La guía (§5 p.120) hace JOBS **opcional**: sin filas JOBS, todas las partes y
patrones pertenecen al mismo job implícito. El preflight separa las dos
preocupaciones:

- **A) SPEC**: un documento sin JOBS y con UN único JOB_INDEX es válido; con
  más de un JOB_INDEX distinto sin JOBS, el caso no puede justificarse con la
  guía y falla cerrado (`ptx_spec.job_scope_ambiguous` — fail closed, nada
  inventado sobre multi-job implícito).
- **B) PRODUCT**: el compiler de Granete sigue EMITIENDO su fila JOBS
  explícita (probado por test) y puede seguir exigiéndola como política del
  candidato — esa exigencia nunca se reporta como "spec invalid".

Errores con contexto accionable, convención `ptx_spec.*` (misma familia
punteada del verifier). Ejemplo de la regresión obligatoria:

```text
code:  ptx_spec.header_title_too_long
field: HEADER.TITLE
observed: 43   maximum: 25
locator: S03 V11 Interface Guide §20 p.167 'TITLE File title TXT 25 chars max.'
message: HEADER.TITLE tiene 43 caracteres y el máximo documentado es 25
         ('GRANETE-PTX-CANDIDATE NOT_MACHINE_VALIDATED' no se trunca ni se
         reescribe: fail closed)
```

## 4. Shape externo: R2201/R7301 y el lector estructural

`packages/excel/src/ptx/externalDialect.ts` lee archivos PTX de OTROS
optimizadores dentro del subset modelado sin exigir el ancho exacto del writer
Granete:

- distingue **prefijo requerido** (siempre presente), **columnas modeladas**,
  **celda vacía** (`,,`) y **trailing omitido** (la fila termina antes);
  expone `cellsProvided` / `extraTrailingCells` / `emptyModeledColumns` y
  `ptxExternalColumnPresence`;
- tolera el dialecto observado y documentado: espacios alrededor de celdas
  sin comillas (la propia guía los usa en sus ejemplos), líneas en blanco,
  columnas finales documentadas no modeladas (BOARDS COST/STK_FLAG, PATTERNS
  PICTURE) — contadas, nunca descartadas en silencio;
- las familias documentadas sin modelo (PARTS_INF, PARTS_UDI, PARTS_DST,
  PTN_UDI, NOTES) quedan registradas opacas con sus celdas crudas; #789 les
  da forma tipada sobre este mismo lector (ninguna decisión aquí lo bloquea:
  el row view conserva todas las celdas);
- fail-closed en lo que NO es tolerancia de shape: familia no documentada,
  prefijo incompleto, valor inválido en columna modelada, quoting roto.

Resultado (tests `externalDialect.test.ts`): R2201 y R7301 saneados se leen
estructuralmente (5/12 piezas, 2/4 materiales, TYPE 0 y 1, OFFCUTS con
OFC_QTY=1, X1 en FUNCTION 92, CUSTOMER vacío presente) y el subset modelado de
ambos pasa el strict spec preflight — observación sobre el subset leído, no un
claim sobre el archivo completo ni sobre el receptor. Los fixtures NO se
modificaron.

## 5. Inmutabilidad histórica r2/r3/r4

- Los tres goldens se RECOMPILAN de verdad (optimizeCutPlan → compile →
  serialize) y producen sus bytes exactos (`GOLDEN_TEXT` / `GOLDEN_R3_TEXT` /
  `GOLDEN_R4_TEXT`); sus sha256 siguen siendo los del contrato industrial
  (`PTX_ADAPTER_INDUSTRIAL_CONTRACT`) y el descriptor del adapter no cambió
  (digest canónico intacto). Ningún golden histórico se modificó para pasar
  tests.
- Honestidad deliberada: los bytes históricos r2/r3/r4 **VIOLAN** el límite
  TITLE (33 chars lab; 43 industrial) y el preflight nuevo lo reporta. r4 fue
  rechazado y queda congelado como evidencia; este PR no lo "repara".
- Ninguna ruta existente pasa por las nuevas fronteras: la opción del compiler
  y la serialización spec-checked son opt-in de revisiones futuras.

## 6. No implementado aquí (dueños propios)

`PARTS_INF`/`PARTS_UDI`/etiquetas/EDGE1..4/BARCODE/DRAWING/PRODUCT/ROOM/
COLOUR/CNC (#789); tuning MATERIALS HPP250, BOOK=3, RULE1..4 (#790);
semántica CUTS diferencial (#791); CADLink/RLT/field pack (#792); profile
r5, adapter 1.4.0, candidato final (#793). Sin envío de PTX al cliente, sin
claims de compatibilidad, `NOT_TESTED/notClaimed` permanece.

## 7. Verificación

```sh
pnpm --filter @granete/excel test    # specPreflight.test.ts (77) +
                                     # externalDialect.test.ts (22) + suite completa
pnpm typecheck
```

Matriz mínima de la issue cubierta en `specPreflight.test.ts` /
`externalDialect.test.ts`: TITLE 25 PASS · TITLE >25 BLOCK (26 y las
regresiones 33/43) · VERSION/UNITS/ORIGIN/TRIM_TYPE inválidos · índice
duplicado/no consecutivo/fuera de rango · referencias PART/BOARD/MATERIAL/
PATTERN/Xn/JOBS inexistentes · prefijo requerido incompleto · trailing
omitido válido · vacío vs omitido · R2201/R7301 estructural · mutaciones de
fixture válido (bytes y modelo) · inmutabilidad r2/r3/r4 (recompile real de
los tres + sha256 exactos + gate inerte para historia).

Ronda de revisión independiente (segunda): fronteras DIM métrico 9999.9
PASS / 10000 BLOCK · DIM pulgadas 999.9 PASS / 1000 BLOCK (según
HEADER.UNITS) · DIM negativo BLOCK · QTY 99999 PASS / 100000 BLOCK (más
cobertura de todos los campos QTY modelados) · DIM/QTY también sobre bytes
mutados post-serialización · RULE1=10 / RULE2=2 / GRAIN=3 /
PATTERNS.TYPE=9 / FUNCTION=81 BLOCK como spec · FUNCTION=4 y TYPE=6 sin issue
de spec (SPEC_VALID_BUT_PRODUCT_UNSUPPORTED, rechazados por validate.ts) ·
taxonomía completa `classifyPtxDocumentedEnumSupport` · JOBS
ausente con job único PASS / con dos jobs `job_scope_ambiguous` / compiler
sigue emitiendo JOBS explícito · VERSION 1/1.06/1.08 PASS (sin pin) y el
issue de VERSION no afirma "verificado".

Ronda de revisión (tercera): STATUS 0/1/2/4/17 válidos (forma INT; conocidos
no exhaustivos) y STATUS decimal BLOCK (`int_not_integer`) · QTY decimal
BLOCK (`quantity_not_integer`) en document y bytes · CUT_TIME entero PASS /
decimal BLOCK en spec preflight, parser (INVALID_INTEGER) y serializer
(fail-closed) · SEQUENCE decimal BLOCK en el spec preflight sin depender de
validate.ts · **SPEC vs PRODUCT también en bytes**: el lector representa el
dominio documentado TYPE 0..8 (`PtxDocumentedPatternType`), bytes con TYPE=6
→ sin spec issue + clasificación
`SPEC_VALID_BUT_PRODUCT_UNSUPPORTED` + producto fail-closed (validate
INVALID_ENUM_VALUE y serialize rehúsa entregar bytes; subset productivo
0..4 congelado), bytes con TYPE=9 → `ptx_spec.parse_error` con el rango
documentado 0-8.

### Tabla final de reglas implementadas

| Regla | Fuente/localizador (S03 V11 Interface Guide) | Frontera PASS | Frontera BLOCK | Clasificación |
|---|---|---|---|---|
| HEADER.TITLE ≤ 25 | §20 p.167 | 25 chars | 26 / 33 lab / 43 industrial (`header_title_too_long`) | SPEC |
| HEADER.UNITS ∈ {0,1} | §20 p.167 + §4 p.118 | 0, 1 | 2 | SPEC |
| HEADER.ORIGIN ∈ 0..3 | §20 p.167 + §4 p.118 | 0..3 | 4 | SPEC |
| HEADER.TRIM_TYPE ∈ {0,1} | §20 p.167 | 0, 1 | 2 | SPEC |
| HEADER.VERSION forma positiva finita | §20 p.167 + §4 p.118 + §9 | 1 / 1.06 / 1.08 | 0 / NaN | SPEC (forma); valor exacto UNKNOWN |
| TXT máximos (NAME/DESC/CUSTOMER/OPT/SAW/CODES/COMMENT) | §20 pp.167–178 | 50/100 exactos | +1 char (`text_too_long`) | SPEC |
| Índices IDX (250/9999/5000/7500) | §20 pp.167–178 | dentro de rango | fuera de rango (`index_out_of_range`) | SPEC |
| Índices consecutivos únicos desde 1 | §20 p.166 + §4 p.118 | 1..N | hueco / duplicado | SPEC |
| Referencias JOB/MAT/BRD/PTN/PART/Xn | §4 p.118 + §20 | existen | inexistentes (`reference_unknown`) | SPEC |
| JOBS opcional, job implícito único | §5 p.120 | sin JOBS + 1 job | sin JOBS + 2 jobs (`job_scope_ambiguous`) | SPEC |
| DIM 0..9999.9 mm / 0..999.9 in | §20 p.166 (DIM) | 9999.9 mm / 999.9 in | 10000 mm / 1000 in / negativo (`dimension_out_of_range`) | SPEC |
| QTY entero y ≤ 99999 | §20 p.166 (QTY: 'A long integer …') | 1, 99999 | 1.5 (`quantity_not_integer`) / 100000 (`quantity_out_of_range`) | SPEC |
| JOBS.STATUS forma INT (conocidos 0/1/2, no exhaustivos) | §20 p.167 + §5 p.120 | 0/1/2 y otros enteros (4, 17) | decimal 1.5 (`int_not_integer`) | SPEC (forma); restringir otros enteros = PRODUCT/RECEIVER |
| JOBS.CUT_TIME forma INT (segundos) | §20 p.167 + §5 p.121 | entero (821) | 1.5 (`int_not_integer`; parser INVALID_INTEGER; serializer fail-closed) | SPEC |
| CUTS.SEQUENCE forma INT | §20 p.178 | entero | 1.5 (`int_not_integer`, chequeo propio del preflight) | SPEC |
| PARTS_REQ.GRAIN ∈ {0,1,2} | §20 p.168 | 0..2 | 3 | SPEC |
| MATERIALS.RULE1 1..9 | §20 p.174 | 1..9 | 10 | SPEC |
| MATERIALS.RULE2/3/4 ∈ {0,1} | §20 p.174 | 0, 1 | 2 | SPEC |
| PATTERNS.TYPE 0..8 | §20 p.175 | 0..8 (5..8 = SPEC-valid, producto no) | 9 | SPEC |
| CUTS.FUNCTION 0..9 ∪ 90..99 | §20 p.178 | 0..9, 90..99 (4..9/90/91/93..99 = SPEC-valid, producto no) | 81 (`function_code_invalid`) | SPEC |
| VECTORS sin rango DIM | §17 p.146 (prose, sin diccionario §20) | n/a | n/a — no se inventa autoridad | UNKNOWN (sin regla) |
| partCodeMaxLength 50 (r4) | política r4 (#781) | ≤ 50 | > 50 (`ptx_compile.part_code_too_long`) | PRODUCT (coincide con el 50 SPEC del diccionario) |
| normalización espacios/uppercase de códigos al importar | §20 p.166 | n/a (no enforceada) | n/a | RECEIVER (→ #790) |
