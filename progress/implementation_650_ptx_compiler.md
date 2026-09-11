# Implementación #650 — PR 5: compilar CutProgram real a PTX documentado

- Issue: #650. Quinto incremento técnico de la entrega B (sobre PR #656 fusionado).
- Rama: `feat/650-ptx-compiler`. Base exacta: `origin/main@25c2cbb55f86d379ffba9c47844ce850552b09f9` (merge de PR #656). Single writer.
- Fecha: 2026-09-11. Estado: `IMPLEMENTED_PENDING_REVIEW`.

## Alcance implementado

El compilador `CutPlan/CutProgram → PtxDocument` sobre el núcleo PTX de #656,
con verificación semántica de readback contra el programa original. El mismo
programa que alimenta el preview React (#654/#655) produce un modelo PTX
equivalente y validable. **Sin** conectar el adapter productivo, **sin** tocar
el botón de descarga, **sin** sustituir `ptxCutPlanExport.ts`, **sin** claim de
compatibilidad CADmatic 4 y **sin** generar las cinco cocinas.

### Archivos nuevos

- `packages/excel/src/ptx/compileCutPlan.ts` — compilador:
  - `compileCutPlanToPtxDocument(cutPlan, options) → { document, mapping }`.
    Frontera fail-closed: el documento devuelto ya pasó `validatePtxDocument`.
  - `executeCutProgram` como única autoridad geométrica: sin reoptimizar, sin
    reconstruir el árbol desde coordenadas de piezas.
  - Emisión: un JOBS por plan; MATERIALS por código de material (orden de
    primera aparición; BOOK = tableros del material); PARTS_REQ por pieza
    colocada con `QTY_REQ=1` (sin agregación de tipo: la identidad sobrevive
    para etiquetas); BOARDS+PATTERNS por hoja (`QTY_RUN/QTY_CYCLES/MAX_BOOK`
    = 1: un tablero por ciclo, sin compresión); CUTS por división en orden de
    programa + filas de liberación; OFFCUTS por terminal de retazo; VECTORS
    opcionales por división.
  - Política FUNCTION documentada (decisión de candidato, no claim de
    receptor): fase = generación de staging de la región padre (board=1; kept
    sube generación, rest la conserva — el material que queda en banco no se
    re-escenifica; los trims son transparentes y no avanzan generación). Esta
    política reproduce el ejercicio didáctico del dossier: franja fase 1
    (fn 1), cortes dentro de franja fase 2 (fn 2, CUT_B/CUT_C), bloque
    separado reprocesado en fase 3 (fn 3, CUT_D). Fases ≤ 2 emiten el rol por
    eje (y→1 rip, x→2 cross); fase 3 emite 3; fase > 3 falla cerrado (la fase
    4 espera fixture explícito, records.ts de #656). Los códigos 90..99
    siguen sin soporte: los trims se emiten como pasadas reales de su fase y
    la geometría de refilado vive en las filas CUTS, no en MATERIALS.
  - PATTERNS.TYPE: 0 (rip longitudinal) si la primera división no-trim avanza
    sobre y; 4 (sólo troceado, sin claim de staging) en otro caso. Tipos
    1/2/3 (giro/cabeceados) nunca se declaran.
  - MATERIALS: kerf uniforme exigido (cada división debe igualar
    `config.sawKerfMm` o falla cerrado); THICK obligatorio sin default; trims
    TRIM_* y RULE1..4 vacíos (semántica por clase = ambigüedad §9; vacío ≠ 0).
  - Liberaciones QTY_RPT=0/SEQUENCE=0: un OFFCUTS/retazo por hoja remnant y
    una fila por pieza en lado rest de una división doble-pieza (atribución de
    producción sin pasada nueva; fragmento 04 del dossier).
  - VECTORS: línea en el borde de banda alejado del lado conservado, acotada
    al padre, con inversión Y a origen superior izquierdo
    (`yTop = anchoTablero − yBottom`, §6 de la investigación).
  - Cuantización coherente a `options.decimalPlaces` antes de emitir; ASCII
    de impresión con fail-closed si un campo requerido queda vacío.
  - Determinismo: función pura de (cutPlan, options).
  - `PtxCompilationError` con códigos `ptx_compile.*` específicos (14 causas).
- `packages/excel/src/ptx/verifyCutPlanPtxReadback.ts` — comprobación
  semántica del readback contra el programa original:
  - Re-valida el documento parseado, re-ejecuta cada programa con el núcleo de
    dominio (independiente del compilador) y compara vía la tabla inversa:
    orden/fila por división, CUT_INDEX, SEQUENCE, FUNCTION (política
    documentada), DIMENSION cuantizada, referencias de pieza/retazo,
    QTY_RPT/QTY_PARTS, PARTS_REQ (código/medidas resueltas/veta/cantidades),
    MATERIALS (kerf/espesor/BOOK), BOARDS/PATTERNS, OFFCUTS y VECTORS.
  - Reconstrucción derivada de bytes: extents de padre/hijos derivados de
    BOARDS+dimensiones+kerf y comparados contra la traza ejecutada (detecta
    mutaciones que rompen la clasificación resto/kerf aunque el CSV sea
    válido). Tolerancia = resolución de cuantización declarada (2 ulp), jamás
    tolerancia de fabricación o agrupación visual.
  - Limitación documentada: la clase de staging y el eje de un recut de fase 3
    no están determinados por los bytes solos; la tabla inversa es el puente
    de auditoría y los VECTORS llevan las posiciones absolutas cuando se
    emiten.
- `packages/excel/src/ptx/compileCutPlan.test.ts` — 24 tests.
- `packages/excel/src/index.ts` — exportación pública del compilador,
  opciones, mapeo y verificador.
- `docs/machines/ptx-cadmatic4/README.md` — sección de núcleo actualizada:
  existe la capa compiladora sobre el núcleo; sigue sin haber conexión a
  perfil CADmatic 4, adapter productivo, descarga ni exportador legacy.

### Cadena demostrada (criterio del PR)

`optimizeCutPlan` (plan real) → programas validados con `executeCutProgram`
→ `compileCutPlanToPtxDocument` → `validatePtxDocument === []`
→ `serializePtxDocumentBytes` → `parsePtxDocumentBytes`
→ equivalencia estructural (`ptxDocumentsEqual`) y
`verifyCutPlanPtxReadback === []`, con y sin vectores.

El ejercicio didáctico del dossier (1200×700, kerf 4, A 450×320 + B 280×210,
sin refilados) ejecutado con la heurística strip REAL compila a las filas
documentadas CUT_A..CUT_D: mismas funciones (1, 2, 2, 3), mismas dimensiones
relativas (320, 450, 280, 210 — nunca coordenadas globales) y mismas
referencias de pieza; el resto de tablero 1200×376 vuelve como retazo con fila
de liberación QTY_RPT=0 y OFFCUTS. El sobrante de franja 462×320 queda como
desperdicio bajo la política de retazos útiles del dominio (0.148 m² < 0.24
m²): no es stock retornable y no se declara OFFCUTS.

### Tests (24)

- Cadena completa sobre plan real de `optimizeCutPlan`, con vectores y sin
  ellos; plan multi-material (2 MATERIALS/BOARDS/PATTERNS, PARTS_REQ
  contiguos); determinismo (dos compilaciones iguales); marcado no productivo
  (título y descripción).
- Didáctico: filas CUT_A..CUT_D, TYPE 0, liberaciones/OFFCUTS con medidas,
  vectores absolutos (inversión Y verificada), cuatro refilados como pasadas
  reales de fase 1 con kept extents correctos (2430/2420/1820/1810 en
  2440×1830 con margen 10 y disco 4).
- Mutaciones semánticas detectadas (CSV sigue válido salvo la indicada):
  dimensión modificada, función de fase alterada, PART_INDEX cruzado, filas
  reordenadas físicamente (el orden codifica el árbol), kerf alterado,
  medidas de PARTS_REQ alteradas, dimensión de liberación alterada, vector
  desplazado, fila borrada (hueco de índice vía validación).
- Fail-closed: CNC nesting, hoja legada sin programa, plan sin tableros,
  espesor ausente, kerf no uniforme, fase 4 no soportada.

## Limitaciones y estado de campo

- Fase > 3 no soportada a propósito (programas best-fit profundos fallan
  cerrado con causa específica; la fase 4 espera fixture explícito).
- Sin VECTORS la posición/lado (leadingBand) no es verificable desde bytes;
  con VECTORS sí (líneas absolutas).
- OFFCUTS sólo desde terminales remnant del dominio (política de retazo
  útil); el desperdicio no se declara como stock.
- Campo sigue NOT_TESTED/notClaimed: nada aquí certifica CADLink/CADmatic ni
  habilita fabricación. #348/#352/#353 conservan sus gates.

## Evidence (HEAD del commit de este reporte)

- `packages/excel` 35 archivos / 250 tests pasados (+3 skipped preexistentes
  de hardware); `compileCutPlan.test.ts` 24/24.
- Monorepo: domain 105/1407, storage 12/191, ui 160/1704, web 35/444,
  desktop 3/17, mobile 10/73 — todo verde.
- `pnpm typecheck` 7/7 paquetes Done, 0 errores. `pnpm openapi:check` sin
  drift. `git diff --check` limpio.
- Sin cambios en `@granete/domain`, React/UI, adapter productivo,
  `ptxCutPlanExport.ts`, backend ni contratos.
