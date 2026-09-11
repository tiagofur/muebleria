# Implementación #650 — PR 5: compilar CutProgram real a PTX documentado

- Issue: #650. Quinto incremento técnico de la entrega B (sobre PR #656 fusionado).
- Rama: `feat/650-cut-program-to-ptx`. Base exacta: `origin/main@25c2cbb55f86d379ffba9c47844ce850552b09f9` (merge de PR #656). Single writer. `origin/main` sin movimiento durante el trabajo (frente Cotización/Diseño intacto y no tocado).
- Fecha: 2026-09-11. Estado: `IMPLEMENTED_PENDING_REVIEW` (R1–R3 de revisión aplicadas sobre el mismo PR #657).
- Spec: prompt del propietario "continuar PTX + integración CADmatic sin tocar Cotización/Diseño" (secciones 1–33) + correcciones finales R1–R3.

## Correcciones de revisión (R1–R3, mismo PR #657)

- **R1 — independencia semántica del verifier**: `verifyCutPlanPtxReadback.ts`
  ya NO importa helpers productivos del compiler (sólo `import type`). Las
  expectativas se re-derivan localmente desde `CutProgramTrace` con reglas
  duplicadas a propósito (comprobación cruzada, no lógica compartida):
  `deriveDivisionExpectations` (fase/FUNCTION por generaciones de staging),
  `deriveStructuralPreorder`, `derivePatternType`, `deriveReleases`,
  `deriveVectorLine` y `auxAscii` para texto auxiliar. Regresión RED-first:
  test de guard de fuente (todo import desde `./compileCutPlan` debe ser
  type-only; lista de helpers prohibidos) + test de mutación FUNCTION con
  `validatePtxDocument` verde y verifier rojo. Un bug industrial del writer
  ya no puede verificarse a sí mismo.
- **R2 — identidad ASCII crítica fail-closed**: nueva política de dos
  grupos. Identidad crítica (código de material de hoja/pieza, claves que
  agrupan MATERIALS o resuelven mapeos, `PARTS_REQ.CODE` contractual):
  debe ser ASCII de impresión o falla con `ptx_compile.identity_not_ascii`
  (campo, valor original, entidad) — 'MDFÁ' y 'MDF' jamás se fusionan al
  filtrar; partCode vacío → código técnico explícito `PART-<n>`. Texto
  auxiliar (descriptions, COMMENT, nombres visibles): filtro determinista
  documentado. `HEADER.title` sin cambios (ya exigía ASCII). Regresiones
  RED-first: material ASCII válido, material con Á, par colisionable
  ('MDF'+'MDFÁ'), partCode 'LARGUERO-Ñ', partCode vacío → PART-1. Se
  eliminó además un path silencioso (materialCode de pieza no-ASCII se
  ignoraba y reventaba después con TypeError).
- **R3 — MATERIALS.BOOK conservador**: relectura sólo del dossier congelado:
  lo único establecido es "BOOK cuenta tableros, no milímetros" [S03
  pp.134–135]; "total de tableros del material en el job" NO está
  documentado. El compiler emite `BOOK = 1` (política de un tablero por
  ciclo, coherente con MAX_BOOK=1/QTY_CYCLES=1 y un BOARDS por sheet) y el
  verifier valida esa misma política documentada sin helper compartido.
  Test que distingue BOOK (1 fila MATERIALS) de MAX_BOOK/QTY_RUN/QTY_CYCLES
  (filas PATTERNS) y BOARDS.QTY_STOCK/QTY_USED (filas BOARDS). El golden no
  cambió (ya emitía BOOK=1).

## Alcance implementado

El compilador `CutPlan/CutProgram → PtxDocument` sobre el núcleo PTX de #656,
con verificación semántica de readback contra el programa original y golden
candidato congelado. El MISMO programa que alimenta el preview React genera el
candidato PTX. **Sin** conectar el adapter productivo, **sin** tocar el botón
de descarga, **sin** sustituir `ptxCutPlanExport.ts`, **sin** leer
MachineProfile/perfil CADmatic, **sin** claim de compatibilidad CADmatic 4,
**sin** las cinco cocinas, **sin** cambios en Cotización/Diseño/Proyectar/
SketchUp/backend/API/migrations.

### Archivos nuevos

- `packages/excel/src/ptx/compileCutPlan.ts` — compilador:
  - `compileCutPlanToPtxDocument(cutPlan, options) → { document, mapping }`.
    Frontera fail-closed: el documento devuelto ya pasó `validatePtxDocument`.
  - `executeCutProgram` como única autoridad geométrica: sin reoptimizar, sin
    clustering X/Y, sin ProductionBoardLayout/SVG/CutInstruction, sin
    reconstrucción desde placements.
  - Dirección de dependencia: `@granete/domain → compiler → PtxDocument →
    núcleo #656`. El dominio nunca importa excel; sin semántica PTX en
    `cutProgram.ts`.
- `packages/excel/src/ptx/verifyCutPlanPtxReadback.ts` — verificador cruzado
  independiente del compilador (no lo re-ejecuta; re-ejecuta el programa con
  el núcleo de dominio y compara fuente contra readback).
- `packages/excel/src/ptx/compileCutPlan.test.ts` — 39 tests.
- `packages/excel/src/ptx/cutPlanPtxGolden.ts` + `cutPlanPtxGolden.test.ts` —
  golden candidato real congelado.
- `packages/excel/src/index.ts` — exportación pública.
- `docs/machines/ptx-cadmatic4/README.md` — estado del compilador.

### Decisiones documentadas (contrato del candidato)

- **JOBS determinista**: sólo campos estables del plan (projectId); sin
  `new Date()`; ORD_DATE/OPT_PARAM/SAW_PARAM/CUT_TIME/WASTE_PCNT vacíos.
  `HEADER.TITLE` viene de `options.title` (etiqueta del candidato).
- **MATERIALS**: THICK/BOOK/KERF_RIP/KERF_XCT obligatorios desde el plan
  (sin 4/18 hardcodeados; espesor ausente → fail closed); kerfs separados
  alimentados por la única configuración de disco; TRIM_*/RULE1..4 vacíos.
- **BOARDS**: una fila por tablero físico → dos formatos del mismo material
  producen 1 MATERIALS + 2 BOARDS (Caso E probado) sin perder identidad de
  stock.
- **PARTS_REQ**: una fila por pieza colocada con medidas YA resueltas (sin
  re-deducir cantos), QTY_REQ=1, sin agregación ("ante duda no agrupar");
  piezas idénticas conservan identidad separada (Caso G).
- **Grain**: mapeo explícito 0→0 (free) y 1→1 (length/no rotation); el
  dominio no soporta transverse con certeza → no se inventa; valor no
  mapeable → fail closed.
- **PATTERNS**: 1 hoja física → 1 PTN_INDEX, sin compresión
  (QTY_RUN/QTY_CYCLES/MAX_BOOK = 1). TYPE derivado de la estructura real del
  programa (0 si la primera división avanza sobre y; 4 en otro caso); nunca
  desde promedios/layout/placements/cutId; sin mapeo seguro sería fail closed
  (el mapeo actual es total y documentado).
- **CUTS desde `CutProgramTraceDivision`**:
  - **CUT_INDEX vs SEQUENCE**: filas emitidas en PREORDER ESTRUCTURAL del
    árbol (subárbol kept primero) con CUT_INDEX secuencial = estructura;
    SEQUENCE = orden de ejecución del programa, derivado independientemente.
    Test con subárboles intercalados: filas [cutA(1,1), cutC(2,3), cutB(3,2)]
    — como el fragmento 03 (STRIP_B SEQUENCE=2 con CUT_INDEX posterior).
  - **DIMENSION**: siempre `division.keptExtentMm` (medida relativa del
    sub-panel). Caso obligatorio probado: padre global X=454, kept=280, borde
    global=734 → `DIMENSION=280`, `expect(...).not.toBe(734)`. Nunca
    `cutOffsetMm`/`positionMm`/coordenadas SVG.
  - **FUNCTION** por fase del árbol (generación de staging: board=1, kept
    sube, rest conserva): fase ≤ 2 → rol por eje (y→1 rip, x→2 cross); fase 3
    → 3. Caso obligatorio: operación sobre X en tercera fase → 3, no 1/2.
    Fase > 3 → `ptx_compile.phase_unsupported` (la fase 4 espera fixture).
    Códigos 4/5..9/81/90..99 jamás emitidos.
  - **Trims**: FAIL CLOSED (`ptx_compile.trim_unsupported`) para planes con
    refilados positivos: no hay mapping documentado inequívoco a 0/head ni
    90..99 habilitados. No se ignoran, no se escriben como 0, no se quitan,
    no se duplican. El primer candidato soporta trim=0 correctamente.
  - **Exact-fit**: pieza terminal sin división adicional NO genera fila
    ficticia; la referencia PART_INDEX va en la operación padre que la hizo
    disponible (probado: A llena su columna; 2 piezas → 4 pasadas).
  - **Producción**: PART_INDEX/QTY_PARTS verificados contra terminales del
    CutProgram; piezas idénticas no se cruzan (Caso G).
  - **QTY_RPT=1** sin compresión.
- **OFFCUTS**: sólo terminales `kind=remnant` (retazos reutilizables reales,
  nunca waste). Caso D probado: 1200×1000, A 600×1000, B 500×200, kerf 4 →
  OFFCUT 500×796 con X1; la fila relacional QTY_RPT=0 no se convierte en
  pasada física. Retazo/pieza terminal inatribuible (sin división productora)
  → fail closed.
- **VECTORS**: `includeVectors=false` por defecto; opcionalmente una fila por
  división derivada de CutProgramTrace con transformación explícita a origen
  superior izquierdo (yTop = anchoTablero − yBottom); HEADER.ORIGIN se lleva
  verbatim como convención declarada; nunca se lee SVG.
- **Quantization**: `decimalPlaces` explícito; magnitud no representable en
  la resolución (más allá del ruido aritmético 1e-9 relativo) →
  `ptx_compile.magnitude_not_representable`. Casos 333.3 y kerf 3.2 verdes;
  333.3 con 0 decimales falla cerrado. Sin redondeo silencioso.
- **Determinismo**: mismo input + opciones → mismo documento, mismo mapping,
  mismos bytes (probado con dos compilaciones independientes). Sin reloj,
  random ni UUID nuevos. Índices 1..N deterministas (JOB/MAT/BRD/PTN/PART/
  CUT/OFFCUT), sin UUID de negocio como índice PTX.
- **Mapping inverso (tabla inversa)**: responde qué cutId produjo CUT_INDEX n
  (`cutIdByCutIndex`), qué placement produjo PART_INDEX n
  (`pieceRefByPartIndex`), qué sheet produjo PTN_INDEX n
  (`sheetIndexByPatternIndex`) y qué remnant produjo Xn
  (`offcutRegionIdByOffcutIndex`), además de los mapas hacia adelante.
- **Fail-closed adicional** (§26): hoja sin cutProgram, programa inválido,
  CNC nesting, falta thickness, material irresuelto (pieza con material sin
  tablero), fase > 3, trim positivo, grain no mapeable, decimal no
  representable, pieza/remnant inconsistente (inatribuible). Sin caer al
  serializer legacy en ningún caso. 16 códigos `ptx_compile.*`.

### Verificador independiente (§24 + R1)

`verifyCutPlanPtxReadback(parsed, cutPlan, mapping, options)`: re-valida el
documento parseado, re-ejecuta cada programa con `executeCutProgram` (nunca
re-ejecuta el compilador) y compara fuente contra readback: sheets/patterns,
materials, formatos de tablero, espesor, kerf, piezas, dimensiones, grain,
cantidades, CUTS representados (preorder + SEQUENCE), DIMENSION, FUNCTION,
PART_INDEX, OFFCUTS y VECTORS. Además reconstruye extents derivando de bytes
(BOARDS + dimensiones + kerf) y los compara contra la traza. Tolerancia =
sólo ruido aritmético (1e-9 relativo).

**Mutación obligatoria probada**: tras serializar, cambiar un CUTS.DIMENSION
por otro valor válido → `validatePtxDocument` sigue verde y
`verifyCutPlanPtxReadback` FALLA (`cuts.dimension`). También se detectan:
función alterada, SEQUENCE alterado, PART_INDEX cruzado, filas reordenadas
físicamente, kerf alterado, medidas de PARTS_REQ alteradas, dimensión de
liberación alterada, vector desplazado y fila borrada (hueco de índice).

### Casos con optimizeCutPlan REAL (§25)

- **A** básico: 1 material/1 tablero/2 piezas/trim 0/kerf 4; cadena completa;
  máximo FUNCTION 2; con y sin vectores.
- **B** tercera fase: ejercicio didáctico 1200×700 (A 450×320 + B 280×210)
  vía heurística strip REAL: CUT_A..CUT_D reproducidos (fns 1,2,2,3; dims
  320,450,280,210), TYPE 0, DIMENSION=280≠734.
- **C** decimal: 333.3 con kerf 3.2 conservados; negativo a resolución 0.
- **D** offcut: 500×796 con X1 y fila QTY_RPT=0.
- **E** dos formatos: 2440×1830 + 2750×1830 del mismo material → 1 MATERIALS
  + 2 BOARDS, BOOK=2.
- **F** multi-sheet: CUT_INDEX reinicia por patrón, PART_INDEX único por job.
- **G** piezas iguales: identidad separada, sin cruces.

### Golden candidato (§27)

`cutPlanPtxGolden.ts`: input (rows/catálogo/config/opciones), PtxDocument
esperado, mapping esperado, texto candidato (ASCII/CRLF, revisable contra los
fragmentos del dossier) y readback esperado — generado desde un CutPlan real
de `optimizeCutPlan` (ganador determinista best-fit-v: fns 2,1,2,3, TYPE 4,
OFFCUT 746×700 como X1). Etiquetado `LAB_FIXTURE NOT_MACHINE_VALIDATED`.
Nunca dice "CADmatic accepted". No es una cocina.

### Preview React ↔ PTX (§28)

Test a nivel dominio/programa (sin React, sin píxeles/DOM): cada paso de
`projectCutProgram` (lo que consume el preview) tiene su fila CUTS con el
mismo cutId, misma medida conservada (`row.dimension === step.keptExtentMm`),
mismo número de paso (SEQUENCE), mismo kerf (MATERIALS) y pieza producida
coincidente (PART_INDEX vía mapping). Caso explícito: preview línea local
280 (cutLine.x1=734) ↔ PTX DIMENSION 280.

## Evidence (HEAD tras R1–R3)

- `packages/excel` 36 archivos / 276 tests pasados (+3 skipped preexistentes
  de hardware); `compileCutPlan.test.ts` 46/46 (6 regresiones R1–R3 escritas
  RED primero); `cutPlanPtxGolden.test.ts` 4/4 sin cambios del fixture;
  núcleo PTX #656 (parse/serialize/validate/roundtrip/equivalence) verde.
- Monorepo: domain 105/1407, storage 12/191, ui 160/1704, web 35/444,
  desktop 3/17, mobile 10/73 — todo verde (`pnpm test` raíz).
- `pnpm typecheck` 7/7 paquetes Done, 0 errores. `pnpm openapi:check` sin
  drift. `git diff --check` limpio.
- Sin cambios en `@granete/domain`, React/UI, adapter productivo
  (`ptxAdapter.ts`), `ptxCutPlanExport.ts`, backend, API ni contratos.

## Limitaciones y estado de campo

- Trims positivos no compilables en este PR (fail closed deliberado).
- Fase > 3 no soportada (programas best-fit profundos fallan con causa
  específica; la fase 4 espera fixture explícito).
- Sin VECTORS la posición/lado no es verificable desde bytes; con VECTORS sí.
- OFFCUTS sólo desde terminales remnant del dominio (el desperdicio no es
  stock retornable).
- Campo sigue NOT_TESTED/notClaimed: nada certifica CADLink/CADmatic ni
  habilita fabricación. #348/#352/#353 conservan sus gates. El usuario no
  debe descargar este PTX desde producción.
