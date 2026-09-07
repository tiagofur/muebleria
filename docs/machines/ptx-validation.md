# Validación PTX import/readback (#348) — auditoría, fixture congelado y contrato

> **Estado: entrega PARCIAL de [#348](https://github.com/tiagofur/muebleria/issues/348)
> (2026-09-06).** Este documento prepara la validación: no la ejecuta ni la
> sustituye. **Ningún claim de compatibilidad** con SCM, HOMAG/HOLZMA, Biesse,
> CADmatic, Cut Rite ni ningún otro software/máquina existe hoy. El estado de
> toda combinación máquina/software es **`NOT_TESTED`**
> (`docs/machines/README.md`, vocabulario de evidencia).
>
> Alcance: el output PTX **genérico actual** de Granete y su validación. Los
> dossiers por cliente viven en [`client-a/`](./client-a/) (#352) y futuro
> `client-b/` (#353); este documento los referencia pero no los duplica.

---

## 1. Qué entrega esta preparación — y qué no

| Entregado | No entregado (y por qué) |
|---|---|
| Auditoría exacta del generador PTX actual | Import real en software receptor |
| Fixture sintético congelado + golden PTX con SHA-256 | Readback real capturado en taller |
| Modelo expected/readback machine-neutral | Operator sign-off |
| Contrato de comparación determinista + helper offline puro | Claim de compatibilidad PTX |
| Runbook operator-safe de validación | #351 MachineProfile/PostprocessorAdapter |
| Plantilla de paquete de evidencia sanitizado | Cambios al serializador PTX existente |
| Lista explícita de gaps / `FIELD_VERIFICATION_REQUIRED` | Trabajo de #577 (ProductionRelease/BOM) |

Abrir el archivo en el software receptor **no es validación** (§11).

## 2. Cadena de generación PTX hoy

```text
Panel de Optimización (packages/ui ProductionOrderOptimizationPanel)
        │  optimizeCutPlan() — packages/domain/optimizer (guillotine/CNC)
        ▼
CutPlan resuelto (estado del proyecto; persistido vía cut_plan en project payload)
        │  generatePtxString() / ptxCutPlanExport() / generatePtxByMaterial()
        ▼
packages/excel/src/ptxCutPlanExport.ts   ← ÚNICO punto de serialización PTX
        │  downloadCutPlanPtx() — apps/web/src/exportCutPlanPtx.ts
        ▼
Archivo .ptx (ASCII, CRLF) o ZIP por material  → software receptor externo
```

Capas:

- **Dominio** (`packages/domain`): dueño del CutPlan, del optimizador, de kerf/trim
  por defecto (`optimizer/types.ts`), de la semántica de piezas (`ProductionCutRow`,
  `unrollRows` con deducción de canto).
- **Serialización** (`packages/excel/ptxCutPlanExport.ts`): dueña del formato PTX.
  Consume `CutPlan`; no recálcula dominio.
- **Web** (`apps/web`): orquesta descarga (unified vs by-material,
  `WorkshopSettings.ptxExportMode`); no calcula dominio.
- **Backend Go**: **sin participación** en PTX hoy. No hay endpoint, ni storage, ni
  fingerprint de export.
- **SketchUp**: sin rol en PTX (autoría va por el Digital Thread, #384/#465).

## 3. Auditoría del generador actual

Verificado en código + tests al commit que introduce este documento (rama
`feat/348-ptx-readback-validation-prep`). Base: `packages/excel/src/ptxCutPlanExport.ts`,
`packages/domain/src/optimizer/{types,guillotine,pieces}.ts`.

### 3.1 Mapa campo semántico → representación PTX

| Campo semántico Granete | Representación PTX | Probado en tests | Concern |
|---|---|---|---|
| Proyecto | `JOB_NAME`, `PROJECT_CODE` (= `cutPlan.projectId`) | ✓ estructura | texto libre sanitizado |
| Cliente | `CUSTOMER` (free text, default `Cliente`) | ✓ | sin identidad real |
| Unidades | `UNIT=MM`, `METRIC=1` | ✓ | todo en mm; áreas m² |
| Fecha | `DATE` = `generatedAt` (sólo fecha) | implícito | **A5** |
| Kerf | `KERF` en header y por material | ✓ | **A8/A13** |
| Trim | `TRIM_TOP/BOTTOM/LEFT/RIGHT` + pasos phase 0 en `[CUTS]` | ✓ | coordenadas incluyen trim |
| DEDUCT_EDGEBAND | `0/1` en header | ✓ | **A6** |
| Material | `[MATERIALS]` código+nombre+L/A/espesor+trim+kerf | ✓ | **A7** espesor fallback 18 |
| Tablero (sheet) | `[PATTERNS]` `PAT_n` con SHEET_INDEX secuencial | ✓ | **A2** identidad por secuencia |
| Pieza (placed) | `[PARTS]` una fila por instancia: `PART_ID` seq, `PART_CODE`, `PART_NAME`, `MATERIAL_ID`, `FINISHED_L/W`, `CUT_L/W`, `QTY=1`, `GRAIN`, `ROTATED`, 4 espesores de canto, `BARCODE`, `CNC_PROG` (vacío), `MODULE_CODE`, `MODULE_NAME`, `PROJECT_CODE` | ✓ | **A2/A3/A6/A16** |
| Medida final vs corte | `FINISHED_L/W` = originales; `CUT_L/W` = colocadas (deducción de canto aplicada por `unrollRows`) | ✓ | A6 |
| Cantidad | `QTY=1` por fila; fila repetida por instancia (unroll) | ✓ excel test | **A3** |
| Grano | `GRAIN` 0/1 (heredado del material; `Grain = 0 \| 1`) | ✓ | A12 |
| Rotación | `ROTATED` 0/1 + dims colocadas intercambiadas | ✓ fixture nuevo | A12 |
| Canto | espesor mm por lado (`EDGE_L1..W2`); **código y nombre NO viajan** | ✓ | **A6/A16** |
| Etiqueta/identidad | `BARCODE` = `labelRef \|\| piece.id` | ✓ | **A2** |
| CNC/perforación | `CNC_PROG` placeholder vacío | parcial | **no representado** |
| Posición XY | implícita en `[CUTS]` (no hay columna XY por pieza en `[PARTS]`) | ✓ | **A8** |
| Secuencia de corte | `[CUTS]` derivada de geometría al serializar | ✓ estructura | **A4** |
| Optimización | `[PATTERNS]` RUN_QTY=1, eficiencia/desperdicio informativos | ✓ | **A14** |
| Retazos | `[REMNANTS]` (todos) + corte `REMNANT_USEFUL` en `[CUTS]` | ✓ | **A9** áreas 1 decimal |
| `sheet.instructions` (`CutInstruction[]`) | **no serializadas** | ✗ | **A15** |
| Provenance (BOM/release/revisión) | **no representado** | ✗ | **A10** |

### 3.2 Hallazgos de auditoría

- **A1 — El "formato PTX v1.14" es definido en el repositorio** (commit
  `c43f1443`, 2026-08-20). Los nombres de bloques y campos no están verificados
  contra software receptor real; los fabricantes listados en el header del
  módulo son `PUBLIC_REFERENCE_ONLY`. **Todo el archivo es
  `FORMAT_VERIFICATION_REQUIRED` hasta el primer import real.**
- **A2 — Identidad por secuencia.** `PART_ID`/`PAT_ID`/`REM_ID` son
  secuenciales por archivo (`P_1…`): cambian entre exportaciones. La identidad
  durable viaja por `PART_CODE` y `BARCODE` (`labelRef || id`) y depende de la
  calidad aguas arriba.
- **A3 — Cantidades como filas repetidas.** Cada instancia es una fila con
  `QTY=1`; un receptor que muestre "piezas agrupadas" debe reconstruir la
  cantidad sumando filas por `PART_CODE`.
- **A4 — `[CUTS]` se deriva de la geometría, no de `cutSequenceNumber`.**
  El serializador reconstruye strips (Y únicos ordenados) y cross-cuts (X
  ordenado); los cortes de retazo útil se agregan **después** de todas las
  strips. El campo `cutSequenceNumber` del dominio no se usa aquí y la
  maquinabilidad exacta de esa secuencia no está verificada.
- **A5 — Fecha no determinista fuera del flujo normal.** `DATE` usa
  `generatedAt`, pero si el plan no lo trae, cae a `new Date()` (reloj). El
  fixture congelado fija `generatedAt` para eliminar esto en validación.
- **A6 — Canto: sólo espesor.** `EDGE_*` cargan mm (strings); el código/nombre
  del canto (`edgeBandCode/Name`) no viajan. Fallback silencioso a `0.45` si el
  piece no trae espesor. "Sin canto" y "canto 0" son indistinguibles en el
  archivo.
- **A7 — Espesor de material con fallback silencioso a 18** en `[MATERIALS]`
  cuando el sheet no trae `thicknessMm`.
- **A8 — Semántica de `POSITION_MM` no definida** (línea de centro del disco vs
  borde de pieza) y sistema de coordenadas implícito: posiciones relativas a la
  esquina del tablero crudo, con el trim ya incluido en las XY de las piezas.
  `FORMAT_VERIFICATION_REQUIRED` contra el receptor.
- **A9 — Precisión 1 decimal** (`toFixed(1)`) en todas las magnitudes; áreas de
  remanente en m² con 1 decimal (0.3468 → `0.3`). Un receptor que reporte más
  precisión no debe leerse como diferencia; uno que redondee a enteros exige
  tolerancia explícita en la comparación (§7).
- **A10 — Sin provenance.** El PTX no transporta `bomFingerprint`,
  `designRevisionId`, `productionReleaseId`, `cutPlan.id` ni `cutPlan.version`.
  El archivo **no puede demostrar por sí mismo contra qué se generó**: eso vive
  en el evidence pack (§10) hasta que #351 defina manifest
  (`sketchup-manufacturing-contract.md` §12).
- **A11 — Sanitización de texto** a ASCII imprimible (comillas y `;` → espacio,
  máx 120 chars) para header y campos de texto.
- **A12 — Grano/rotación.** `GRAIN=1` prohíbe rotación a nivel optimizador
  (`allowRotationNoGrain` + `grain === 0`); el flag `ROTATED` más las dims
  colocadas son la única forma de verificar orientación en el receptor.
- **A13 — Kerf declarativo.** El kerf viaja en header/materiales y las
  posiciones del optimizador ya incluyen gaps de kerf; **quién aplica el kerf**
  (Granete ya lo aplicó vs el receptor lo reaplica) es exactamente la pregunta
  de campo del dossier HPP 250 (`client-a/machine-b-hpp250.md` §4).
- **A14 — Granete exporta patrones pre-optimizados + secuencia** (`RUN_QTY=1`
  por patrón): hoy el código asume que el layout viaja decidido (§8).
- **A15 — `instructions` del dominio no se serializan**; `stripIndex` viaja
  implícito por el orden de `[CUTS]`; `EFFICIENCY_PCT`/`WASTE_PCT` son
  informativos (yield/desperdicio del plan, no del receptor).
- **A16 — `MODULE_NAME` transporta `labelRef`** (fallback `moduleCode`), no un
  nombre de módulo — coincide hoy con `BARCODE`; no contar esa columna para
  semántica de módulo.

### 3.3 Determinismo

Dado un `CutPlan` fijo, `generatePtxString` es determinista (sin reloj, sin
aleatoriedad; único riesgo el fallback de fecha de A5). Los tests de fixture
congelan esta propiedad byte a byte (§5).

## 4. Alcance actual del formato

Por implementación (no por la extensión), el PTX de Granete es un **formato de
intercambio de corte de tablero para seccionadoras** (beam saws): lista de
piezas + patrones pre-optimizados + secuencia guillotina + remanentes.

**No es hoy**: programa de máquina (sin tools/velocidades), perforación/CNC
(`CNC_PROG` vacío), nesting libre (sólo guillotina), layout de etiquetas (sólo
string de barcode), ni canal de comunicación. El output CNC/nesting por pieza
es territorio de #351/#354 y del `production pack` existente, no de este PTX.

## 5. Fixture congelado `fixture-board-001` r1

| Artefacto | Ubicación |
|---|---|
| Definición del fixture (CutPlan determinista + expected readback) | `packages/excel/src/ptxValidationFixture.ts` |
| **Golden PTX congelado** (artefacto a importar) | `packages/excel/src/__fixtures__/ptx/fixture-board-001.ptx` |
| Lock byte-exacto + SHA-256 + invariantes | `packages/excel/src/ptxValidationFixture.test.ts` |
| Helper de comparación + tests | `packages/excel/src/ptxReadback.ts` / `.test.ts` |

**SHA-256 del golden:** `544dcae574bc19e19f934f96b2ad1dc104a2d7b1f668262a83ae09df72510f09`

El fixture es sintético de punta a punta (`fixture-part-*`, `sample-material-*`,
`fixture-module-*`, cliente `Fixture Operator`): sin datos de cliente real, y
construido a mano (no es output del optimizador) para que cada valor sea
deliberado e inspeccionable.

### 5.1 Cobertura (qué error atrapa cada pieza)

| Elemento | Atrapa |
|---|---|
| 2 materiales (`sample-material-a/b`, 18/16mm, tableros 2750×1830 / 2440×1220) | mezcla de materiales, espesor y tamaño de tablero |
| `fixture-part-001` y `002`: medidas idénticas, identidad distinta | receptores que colapsan duplicados o pierden identidad |
| `fixture-part-004` qty 2 (una rotada, una no; grano 0) | colapso de cantidades, manejo de rotación legal |
| `fixture-part-001/002/005` grano 1 nunca rotadas | rotación ilegal de piezas con veta |
| coordenadas no enteras (kerf 4.4; deducción de canto 0.8/1.0) | errores de unidad, redondeo y kerf |
| `fixture-part-003/006` sin canto | ambigüedad "sin canto" vs canto 0 |
| retazo útil + scrap en ambos tableros | semántica de remanentes |

### 5.2 Reglas de congelamiento

- El fixture **no se edita in place**: un cambio de datos o de serializador
  produce otro SHA-256 y exige **revisión nueva** (`r2`, `r3`…) con su propia
  fila de evidencia. El test falla ante cualquier drift byte.
- El golden es el artefacto canónico a importar; también se puede regenerar con:

```bash
PTX_EMIT_FIXTURE_DIR=/tmp/ptx-validation \
  pnpm -C packages/excel exec vitest run ptxValidationFixture.test.ts -t emits
# escribe fixture-board-001.ptx + fixture-board-001.expected.json +
# fixture-board-001.actual-template.json e imprime el SHA-256
```

- Límite del alcance: el fixture valida el **archivo + receptor** (qué dice el
  PTX y qué entiende el software). Reproducir este fixture *desde la app*
  exigiría sembrar el proyecto en la base — fuera de alcance aquí.

## 6. Expected readback (modelo esperado)

Definición machine-neutral: `buildExpectedPtxReadback()` (mismo módulo que el
fixture, para que expected y exportado no puedan divergir en silencio). El
receptor reporta lo que exponga; lo que no exponga se marca, no se inventa.

| Campo | Clasificación para validar |
|---|---|
| Unidades (`mm`) | **REQUIRED_FOR_VALIDATION** |
| Kerf | **REQUIRED_FOR_VALIDATION** |
| Trim por lado | **REQUIRED_FOR_VALIDATION** |
| Cantidad de tableros / piezas colocadas | **REQUIRED_FOR_VALIDATION** |
| Piezas: `partCode`, cantidad, medidas finales, espesor, grano | **REQUIRED_FOR_VALIDATION** |
| Material: código, dimensiones de tablero, espesor | **REQUIRED_FOR_VALIDATION** |
| Rotación por instancia | **OPTIONAL_IF_RECEIVER_EXPOSES** |
| Medidas de corte (vs finales) | **OPTIONAL_IF_RECEIVER_EXPOSES** |
| Espesor de canto por lado | **OPTIONAL_IF_RECEIVER_EXPOSES** |
| Barcode / identidad de pieza | **OPTIONAL_IF_RECEIVER_EXPOSES** (su pérdida se evalúa explícito, §7) |
| Orden de corte observado | **OPTIONAL_IF_RECEIVER_EXPOSES** |
| Posiciones XY colocadas | **OPTIONAL_IF_RECEIVER_EXPOSES** (el PTX no las trae por pieza) |
| `bomFingerprint`, revisión/release de origen | **NOT_REPRESENTED_BY_CURRENT_PTX** (A10) |
| Código/nombre de canto, perforación, herrajes, layout de etiqueta | **NOT_REPRESENTED_BY_CURRENT_PTX** |
| Significado exacto de `POSITION_MM`, convención de ejes/origen, encoding aceptado, límites de campos | **UNKNOWN_FORMAT_CAPABILITY** (A1/A8 — dossier de campo) |

## 7. Contrato de comparación

`comparePtxReadback(expected, actual)` (puro, offline, determinista; sin red,
sin máquina, sin mutar PTX). Cada diferencia cae en una clase:

| Clase | Significado | Ejemplos codificados |
|---|---|---|
| `PASS` | coincide (dimensión dentro de 0.05mm) | — |
| `WARNING` | requiere decisión humana | desvío ≤ 1mm (redondeo), código de barra cambiado/perdido, rotación distinta en pieza sin veta, **orden de corte distinto** |
| `BLOCKER` | invalida la validación | unidad ≠ mm, cantidad ≠, dimensión > 1mm, espesor/material ≠, kerf/trim ≠, grano ≠, pieza con veta rotada, pieza faltante o inesperada |
| `UNSUPPORTED_CAPABILITY` | el PTX actual no transporta el dato | provenance, código de canto, "sin canto vs 0" |
| `NOT_OBSERVABLE` | el receptor no expone el campo | ausencia se reporta, no se castiga |

Ambigüedades documentadas (decisión humana, no automática):

- **Identidad perdida con dimensiones correctas** → `WARNING` con nota: evaluar
  cómo se identifica la pieza cortada aguas abajo (etiqueta del receptor, §8 del
  dossier BHX).
- **Orden de corte distinto** → nunca bloqueante automático: la clasificación
  depende del ownership de la optimización (§8). Un receptor que reordena
  legítimamente no es blocker por sí solo.
- **Tolerancia de redondeo** configurable (`dimensionWarningToleranceMm`, default
  1mm) por A9.

**Prueba negativa estructural:** el comparador **no emite ningún estado
"VALIDATED"**. Un resultado sin blockers es *insumo* para el evidence pack;
ningún output automatizado constituye validación (§11).

## 8. Pregunta abierta: ¿quién es dueño de la optimización final?

Documento/discovery only — **aquí no se decide**.

- **Lo que el código asume hoy (A14):** Granete pre-optimiza (guillotina) y
  serializa patrones completos + secuencia — el layout viaja decidido
  (arquitectura tipo A/C: piezas + constraints + layout propio).
- **Lo que el receptor podría hacer:** software tipo Cut Rite/CADmatic
  típicamente re-anida desde lista de piezas; nada en el archivo declara si los
  patrones son vinculantes ni hay negotiation de capacidades.
- **Lo que espera #351:** `MachineProfile` + `PostprocessorAdapter` con
  capabilities declaradas y negotiation **antes** del export; adapters que
  serializan sin inventar reglas (`machine-profiles-and-adapters.md`). #503
  espera que la UI sólo descargue artifacts respaldados por release + contrato
  de máquina.
- **Evidencia de campo necesaria** (ya instrumentada, no duplicar aquí):
  `client-a/machine-b-hpp250.md` §4–§5 — si CADmatic importa patrones como
  fijos o como lista a re-optimizar, si el operador puede bloquear patrones,
  qué pasa con `[CUTS]`, quién define kerf/trim, y si el orden puede leerse de
  vuelta.

## 9. Runbook de validación en taller (operator-safe)

> Regla absoluta: **nunca usar material de producción de un cliente como
> primera validación.** Sólo `fixture-board-001`. Nunca ejecutar corte
> productivo sin aprobación explícita del taller (fuera de alcance de #348).

1. **Generar/obtener el fixture.** Usar el golden commiteado o emitirlo (§5.2).
   Verificar contra el registro del paquete (§10).
2. **Registrar revisión exacta de Granete:** SHA del commit que produjo el
   golden + SHA-256 del `.ptx` + `fixture revision` (`r1`).
3. **Transferir** el `.ptx` al equipo del software receptor por el medio real
   del taller (USB/red del taller). Documentar el medio, sin hostnames/IPs.
4. **Importar** en el software receptor. Si ofrece "verificar/validar job",
   ejecutarla. **No ejecutar corte.**
5. **Capturar readback** por el medio más estructurado que exponga el software
   (reporte/export > pantalla > foto sanitizada): lista de piezas con medidas,
   cantidades, material, grano/rotación, kerf/trim, orden de corte.
6. **Llenar el readback actual:** partir de `fixture-board-001.actual-template.json`
   (forma correcta del readback actual; el `expected.json` tiene otra forma y
   **no** sirve como actual), sobrescribir con lo observado, **borrar lo no
   expuesto** (no dejar valores esperados sin verificar).
7. **Comparar:**
   ```bash
   PTX_COMPARE_ACTUAL_JSON=/tmp/ptx-validation/fixture-board-001.actual.json \
   PTX_EMIT_FIXTURE_DIR=/tmp/ptx-validation \
     pnpm -C packages/excel exec vitest run ptxReadback.test.ts -t 'field run'
   ```
   → `ptx-readback-comparison.json` con cada diferencia clasificada (§7).
8. **Clasificar warnings restantes** con el operador (identidad, orden de
   corte, redondeo). Cada warning queda resuelto o escalado en el pack.
9. **Sanitizar evidencia:** renombrar archivos, revisar metadatos/fotos
   (§10). Nada de clientes, paths ni datos comerciales.
10. **Operator sign-off** con el checklist del dossier
    (`docs/templates/machine-dossier-template.md` §7): el operador confirma en
    entorno no productivo qué leyó el software, con limitaciones explícitas.

## 10. Paquete de evidencia sanitizado

Estructura y campos: [`docs/templates/ptx-readback-evidence-template.md`](../templates/ptx-readback-evidence-template.md).

Reglas (ya vigentes en `docs/machines/README.md`): sin nombres de
clientes/personas, emails, direcciones, precios, credenciales, hostnames, IPs,
paths privados ni nombres reales de proyecto. Identidad sólo por claves opacas
(`client-a`, `machine-b`, `fixture-board-001`). El pack referencia `commit SHA
de Granete`, `SHA-256 del PTX`, expected/actual/diff/clasificación y el estado
de sign-off — nunca crea el claim por sí mismo.

## 11. Prueba negativa — qué NO demuestra esta validación

| Esto | NO demuestra esto |
|---|---|
| Archivo generado | compatibilidad |
| El archivo abre sin error | validación |
| Misma extensión `.ptx` | mismo formato/semántica |
| Misma marca de máquina | compatibilidad (capabilities no se infieren por marca) |
| Versión distinta del software receptor | lo ya validado (versión ≠ ⇒ perfil ≠) |
| Evidencia de client-a | client-b (#353: packs independientes) |
| Comparación sin blockers | validación completa (falta sign-off + campos `NOT_OBSERVABLE`/`UNSUPPORTED` evaluados) |
| Fixture validado | output de producción con datos reales validado |

La matriz final de compatibilidad (`validated` / `partial` / `unsupported`) se
declara por combinación exacta máquina/controlador/versión según
`docs/machines/README.md` y el contrato de manufactura §12.

## 12. Gaps abiertos / `FIELD_VERIFICATION_REQUIRED`

1. **A1** — Aceptación real del formato (bloques, campos, encoding, límites)
   por el software receptor: primer import del fixture.
2. **A8/A13** — Semántica de `POSITION_MM`, origen/ejes, y quién aplica kerf/trim.
3. **A4** — Si `[CUTS]` es vinculante, maquinable y legible de vuelta.
4. **A2/A3** — Cómo reconstruye el receptor identidad y cantidades (filas
   repetidas vs agrupado) y qué pasa con duplicados.
5. **A6** — Cómo representa el receptor el canto y su espesor por lado; si el
   dato alcanza para la enchapadora aguas abajo.
6. **A10** — Provenance fuera del archivo: hoy depende 100% del evidence pack;
   el manifest de #351 (contrato §12) es el cierre arquitectónico.
7. **§8** — Ownership de la optimización final (decisión post-campo).
8. **A5** — El fallback de fecha del serializador (higienización trivial,
   **fuera de alcance aquí**: requiere issue/fix separado según #348).
9. Reproducibilidad app→fixture: sembrar el fixture en un proyecto de prueba
   para validar también el camino de export de la UI (hoy se valida el archivo).

---

Referencias: `docs/verification.md` (§ exports físicos), `docs/sketchup-manufacturing-contract.md`
(§10–§12), `docs/architecture/machine-profiles-and-adapters.md`, `docs/production-flow-v2.md`
(corte trabaja piezas), issues #348/#351/#352/#353/#354/#503, #111 (antecedente F132).
