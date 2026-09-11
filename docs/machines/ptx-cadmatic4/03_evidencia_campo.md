# PTX / CADmatic 4 — Evidencia de campo y base para r3

> Añadido 2026-09-11, tras el cierre técnico del candidato r2 (#650, PR #660).
> Fuente: dos archivos `.ptx` reales del cliente (ver [`field/README.md`](field/README.md)
> por procedencia y reglas de saneado). Este documento registra **qué confirma la
> evidencia**, **qué preguntas abre** y **qué decisiones habilita para una futura
> revisión r3 del perfil**. No modifica r2, no valida el receptor y no promete
> compatibilidad: `NOT_TESTED/notClaimed` sigue vigente.

## 1. Lo que la evidencia confirma del candidato r2

Cuatro decisiones "de candidato" de r2 resultan ser el dialecto real del
optimizador del cliente:

| Decisión r2 | Muestra real | Veredicto |
|---|---|---|
| `HEADER.VERSION = 1` | `HEADER, 1, ...` (ambas) | coincide |
| `UNITS = 0` (mm), `ORIGIN = 0` | `, 0, 0,` (ambas) | coincide |
| `TRIM_TYPE = 1` (refilado fijo primero) | última celda del HEADER = `1` (ambas) | coincide |
| ASCII + CRLF | ASCII imprimible, CRLF en ambas | coincide |

Además, el modelo estructural de CUTS de #656/#657 se ve reflejado 1:1:

- **`CUT_INDEX` ≠ `SEQUENCE`**: la muestra B (patrón 1) tiene `SEQUENCE`
  `1, 5, 6, 10, 7, 12, 8, 14, 9, 16, 2, 18, 3, 20` con `CUT_INDEX` 1..14 en
  preorder — subárboles entrelazados exactamente como el fragmento 03 del
  dossier y nuestro compilador.
- **FUNCTION 1/2/3 con staging por fases**: fase 2 estructural con
  `PART_INDEX=0`, fase 3 = recut que libera la pieza (`PART_INDEX=n`), y la
  pieza queda referida por la pasada que la libera — igual que nuestra política
  de referencia por lado kept.
- **`PARTS_REQ` idénticas a nuestras 11 columnas**, con `GRAIN` 0/1 y medidas
  con decimales (`317.4`, `289.7`).
- **`Xn` como referencia de retazo** (`PART_INDEX = X1` apuntando a la fila
  `OFFCUTS`), nunca eje ni giro.

## 2. Refilados: la evidencia que faltaba

Este era el bloqueador de r2 (`ptx_compile.trim_unsupported`): sin mapping
evidenciado para pasadas de trim. La evidencia real muestra un modelo
**distinto al que asumíamos**:

### 2.1 Los refilados no son filas CUTS

En los **4 patrones** de ambas muestras **no existe ninguna fila de refilado
perimetral** (ningún FUNCTION 90/91/93..). Los trims viven en `MATERIALS`:

```text
MATERIALS, 1, n, <código>, , 16.300, 3, 4.400, 4.400,
                     10.000, 0, 10.000, 0, 20.000, 20.000, 0, 6, 1, 1, 1
                     └KERF_RIP┘└KERF_XCT┘ └FRIP┘└VRIP┘ └FXCT┘└VXCT┘ └HEAD┘└FRCT┘└VRCT┘ └R1..R4┘
```

`TRIM_FRIP=10, TRIM_VRIP=0, TRIM_FXCT=10, TRIM_VXCT=0, TRIM_HEAD=20,
TRIM_FRCT=20, TRIM_VRCT=0` en todos los materiales de ambas muestras (con
`RULE1=6, RULE2=1, RULE3=1, RULE4=1`).

### 2.2 La aritmética cierra (trims incluyen kerf, son totales)

Las sumas exactas — con `TRIM_HEAD=20` y `TRIM_FRCT=20` consumidos como bandas
totales de 20 mm — verifican en cinco puntos independientes:

```text
Muestra A, tablero 1 (2440×1220), eje X: 697 + 4.4 + 20 + 1718.601 = 2440.001 ✓
Muestra A, tablero 1, eje Y:              20 + 333 + 4.4 + 862.601 = 1220.001 ✓
Muestra A, tablero 2 (2440×463), eje X:   20 + 2400 + 20           = 2440     ✓
Muestra B, tablero (2440×1220), eje X:    1200 + 4.4 + 20 + 1215.590 = 2439.99 ✓
Muestra B, tablero, eje Y:                350 + 4.4 + 845.601 + 20 = 1220.001 ✓
```

(los 0.001 son redondeo a 3 decimales de los offcuts). El tablero 2 de la
muestra A es el caso más limpio: tres tiras `2400×100` con `20 + 2400 + 20 =
2440` exactos. Interpretación: **el optimizador del cliente declara el refilo
en `MATERIALS` y dimensiona el patrón al área útil; no emite pasadas de trim.**

### 2.3 FUNCTION 92 = liberación del retazo (pasada real)

En ambas muestras, exactamente una fila por patrón usa `FUNCTION 92`
(trim/waste de fase 2) y es la que libera el retazo:

```text
CUTS,   1,   1,   6,   6,  92,   1718.6, 1,   X1   (muestra A: DIM = largo del offcut 1718.601)
CUTS,   1,   2,  12,  15,  92,    845.6, 1,   X1   (muestra B: DIM = ancho del offcut 845.601)
```

Es una **pasada física real**: `SEQUENCE` operativo (> 0, no cero), `QTY_RPT=1`,
`PART_INDEX=Xn` referenciando la fila `OFFCUTS`, y `DIMENSION` = la medida del
retazo sobre el eje de esa pasada. Difiere de nuestra política r2 de
liberaciones relacionales `QTY_RPT=0/SEQUENCE=0` (fragmento 04): el dialecto
real modela la liberación del retazo como corte real de fase 2/waste.

## 3. Otras observaciones del dialecto real

1. **`PATTERNS.TYPE=1` (giro inicial de tablero) existe en la práctica**
   (muestra B, patrón 2). r2 sólo emite 0/4; si Granete rota tableros, r3
   necesita TYPE=1 con su semántica verificada.
2. **Dos `PATTERNS` comparten una fila `BOARDS`** (muestra B: patrones 1 y 2 →
   `BRD_INDEX=1`): el índice de tablero identifica el formato/stock, no la
   hoja física. Nuestro modelo 1 BOARDS:1 PATTERNS no es el único válido.
3. **`BOOK=3` y `MAX_BOOK=3`**: el cliente apila libros de 3 tableros con
   `QTY_CYCLES=1`. Nuestra política conservadora `BOOK=1` sigue siendo válida
   para el candidato, pero r3 puede alinearla con la práctica real del taller.
4. **`MATERIALS` repite el mismo código** con `MAT_INDEX` distintos (muestra A:
   `T MDF LINEN 18MM 2C` tres veces) — el receptor tolera filas de material no
   referenciadas por tableros.
5. **`OFFCUTS`**: `CODE` **vacío** en ambas muestras + una columna extra al
   final (`1`, probablemente cantidad). Nuestro lector exige CODE no vacío:
   sólo importaría si algún día leemos PTX del cliente.
6. **`BOARDS`**: 2 columnas extra tras `QTY_USED` (p. ej. `1979.572, 0`),
   significado no documentado en el dossier.
7. **Tolerancias sintácticas del receptor** (evidencia de que el formato real
   es más laxo que nuestro emisor estricto): espacios tras las comas, campos
   con comillas y espacios, **líneas en blanco entre familias**, comas finales
   con celda vacía en `PATTERNS`, columnas finales omitidas (`CUTS` sin
   `QTY_PARTS`/`COMMENT` cuando no aplican), decimales de 1 a 3 lugares
   (`333.0`, `317.4`, `862.601`).
8. **Familias fuera de nuestro subconjunto, presentes**: `PARTS_INF`
   (cantos por lado, módulo, barcode, ambiente), `PARTS_UDI` (imagen de
   etiqueta, código de taladros como `2WD2LD`), `NOTES` (ruta del archivo
   fuente). No hacen falta para cortar; son la cantera natural para el futuro
   de etiquetas/taladros.
9. **`JOBS`** con fechas `DD/MM/YYYY` y `STATUS=1`; `CUSTOMER` puede ir vacío
   (celda vacía intermedia real).

## 4. Preguntas abiertas (a cerrar antes o durante r3)

1. **DIMENSION de la segunda rip**: 872.4 en muestra A frente a un resto
   geométrico de 862.601 (delta ≈ 9.8), y 1225.5 en B frente a 845.601/1215.59
   (delta ≈ 9.9). El delta es consistente entre muestras pero no cierra con
   kerf 4.4 ni con trim 10 de forma obvia. Entender esta semántica es
   **requisito** para emitir rips con nuestro modelo kept-extent sin
   desalinear el receptor.
2. **Dónde entran `TRIM_FRIP=10` y `TRIM_FXCT=10`** en la aritmética (HEAD=20
   y FRCT=20 sí cierran; los de 10 no aparecen en las sumas reconstruidas).
3. **¿El receptor recomputa los trims desde `MATERIALS` o espera el patrón ya
   re-dimensionado?** Las muestras muestran dimensiones ya re-dimensionadas;
   falta ver qué hace CADLink/CADmatic 4 al importar (prueba de campo).
4. **Significado de las 2 columnas extra de `BOARDS`**.
5. **Mapping exacto de nuestros 4 refilados de configuración
   (izq/der/inf/sup) a `TRIM_FRIP/VRIP/FXCT/VXCT/HEAD/FRCT/VRCT`**: hoy sólo
   hay candidatos; requiere decidir por clase de pasada (rip/cross/recut/head)
   y por lado, con fixture aritmético.

## 5. Implicaciones para r3 (propuesta de alcance)

Con esta evidencia, la revisión r3 del perfil `ptx-cadmatic-4` dejaría de
necesitar códigos 90..99 para refilados perimetrales:

1. **Trims**: mapear los refilados del plan a `MATERIALS.TRIM_*` (incluyen
   kerf; bandas totales) y re-dimensionar el patrón al área útil, eliminando
   las divisiones de trim del árbol emitido (el dominio las conserva: la
   vista previa y las instrucciones siguen mostrándolas). El compilador deja
   de fallar con `trim_unsupported` cuando el mapping esté cerrado.
2. **Retazos**: reemplazar las liberaciones `QTY_RPT=0/SEQUENCE=0` por una
   pasada real `FUNCTION 92 + Xn` con `DIMENSION` = medida del retazo en el
   eje de la pasada (ambas muestras coinciden).
3. **Decisiones secundarias con evidencia**: `BOOK`/`MAX_BOOK` según práctica
   del taller; `PATTERNS.TYPE=1` si se rota tablero; tolerar/emisión sigue
   siendo estricta.
4. **Verificador y parser**: re-derivar expectations para el nuevo modelo de
   trims y releases; mutaciones negativas por cada regla nueva; golden nuevo.
5. **Perfil r3 inmutable + adapter versionado + paridad Go/TS + UI** sin
   promover claims (`NOT_TESTED` hasta importación real en CADmatic 4).

## 6. Lo que esto NO es

- No es validación del receptor: nada fue importado en CADmatic 4 todavía.
- No habilita producción: los gates de #348 (import/readback real, evidencia
  de taller) siguen gobernando claims de compatibilidad.
- No modifica r2 ni sus artefactos: la evidencia alimenta una revisión nueva.
