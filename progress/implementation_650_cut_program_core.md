# Implementación #650 — PR 1: núcleo ejecutable del programa de corte guillotina

- Issue: #650 (status:approved). Entrega parcial: primer incremento técnico de la entrega A.
- Rama: `feat/650-cut-program-core`. Base exacta: `origin/main@ad8865e132c0d319324f34aa50505dd8149c7c48` (PR documental #651 integrado).
- Fecha: 2026-09-10. Autor: implementador GLM. Estado: `IMPLEMENTED_PENDING_REVIEW`.

## Alcance implementado

Un núcleo de dominio capaz de representar, validar y reproducir un programa
de cortes guillotina sobre regiones rectangulares. Sólo geometría e identidad
del programa: no optimiza, no recalcula BOM/cantos, no proyecta UI y no
serializa PTX.

### Archivos nuevos

- `packages/domain/src/optimizer/cutProgram.ts` — núcleo:
  - `CutProgramInput`: tablero, regiones declaradas con identidad/geometría,
    divisiones (padre, eje de avance, medida relativa, kerf, kept/rest) en
    orden de ejecución, y terminales pieza/retazo/desperdicio con referencia
    de pieza esperada (sin acuñar identidad de negocio nueva).
  - `divideRegion(parent, axis, keptExtentMm, kerfMm)`: geometría pura
    kept/kerf/rest. El eje está documentado como eje de avance/separación de
    la medida (la línea de sierra lo cruza perpendicularmente sobre la región
    activa, no necesariamente el tablero completo).
  - `executeCutProgram(program)`: valida y reproduce recalculando cada
    división desde su padre, eje, medida y kerf (no confía en la geometría
    declarada), y devuelve la traza (divisiones ejecutadas con geometría
    autoritativa, bandas de kerf identificadas `kerf:<cutId>`, terminales,
    mapa de regiones y áreas board/leaf/kerf).
  - `checkExpectedPieces(trace, expected)`: compara hojas de pieza contra
    referencias y dimensiones esperadas por identidad (la superficie total
    que coincida no valida piezas de medidas incorrectas).
- `packages/domain/src/__fixtures__/cutProgramScenarios.ts` — escenarios
  documentales acotados: ejercicio de tercera fase (1200×700, kerf 4) y
  contraejemplo vertical (1000×600, kerf 4). Literales derivados del dossier;
  el script Python de verificación NO es dependencia del producto.
- `packages/domain/src/optimizer/cutProgram.test.ts` — 46 tests.
- `packages/domain/src/optimizer/index.ts` — export del módulo.

### Invariantes cubiertos

Números finitos (NaN/Infinity rechazados); medida y kerf dentro del dominio;
IDs únicos y referencias existentes; ninguna región consumida dos veces ni
usada antes de existir; sin ciclos/regiones huérfanas/operaciones
desconectadas; hijos + kerf contenidos en el padre sin solapes y conservando
su superficie; hojas + kerf conservan la superficie del tablero; ninguna
pieza esperada omitida/duplicada/sustituida; sin regiones de área cero; el
ajuste exacto se representa como hoja terminal sin pasada ficticia; corte al
borde devuelve limitación explícita (`cut_program.cut_at_border_unsupported`)
sin recortar el disco silenciosamente; kerf cero admitido como banda de área
nula que no fabrica región física; determinismo (sin reloj/aleatoriedad) y no
mutación de argumentos (probado con input deep-frozen).

Política numérica: tolerancia aritmética relativa 1e-9 (ruido IEEE-754 de
decimales), explícitamente distinta de la tolerancia visual de agrupación de
2 mm y de cualquier tolerancia de fabricación; errores de milímetros fallan.

Errores `ValidationError` con código máquina (`cut_program.*`) y contexto que
localiza corte/región/pieza, incluido `executedDivisions` para diferenciar el
diagnóstico parcial de un programa válido. Nunca se devuelve una traza parcial
como válida.

## Evidencia (HEAD exacto del commit de este PR)

- `pnpm vitest run src/optimizer/cutProgram.test.ts` (packages/domain):
  46/46 pass.
- `pnpm vitest run` (packages/domain): 102 archivos / 1329 tests pass.
- `pnpm typecheck` (raíz, 7 proyectos): pass, sin errores.
- `pnpm test` (monorepo): domain 102, storage 12, excel 30, desktop 3,
  mobile 10, ui 160, web 34 archivos — todos pass.
- `git diff --check`: limpio.

Casos positivos clave (valores esperados independientes del dossier, no
generados por el código bajo prueba): ejercicio de tercera fase (bloque B en
X=454, borde conservado hasta X=734, medida relativa 280 del tercer corte,
cuarto corte limitado al bloque; hojas 831520 mm², kerf 8480 mm², tablero
840000 mm²) y contraejemplo vertical (primera separación X=400 con avance en
X, cortes siguientes limitados a la región derecha; hojas 592832 mm² + kerf
7168 mm² = 600000 mm²; pieza D como hoja de tamaño exacto sin pasada;
dos piezas idénticas con referencias distintas).

## Ronda de corrección de revisión (mismo PR #652, 2026-09-10)

Base de la corrección: `e28cfdc974099fa93c02335dba5e77f786626204`. Regresiones
añadidas ANTES del fix (7 tests nuevos en RED sobre ese HEAD), luego corrección
y verificación completa.

### R1 — rechazo incorrecto de geometría decimal válida

- Causa: `assertDivisionPartition` comparaba contención con `<=`/`>=` estrictos
  mientras igualdad y superficies usaban tolerancia aritmética; extremos
  recalculados con ruido IEEE-754 (2440.0000000000005 vs 2440) disparaban
  `cut_program.invariant_violated`.
- Corrección: una sola política aritmética para igualdad, contención y límites
  (`sameMeasure`, `atMost`, `atLeast`; relativa 1e-9). `sameMeasure` endurecido:
  valores no finitos nunca son equivalentes; `divideRegion` rechaza geometrías
  resultantes no finitas (`cut_program.geometry_not_representable`). El dominio
  del corte al borde se evalúa con la misma política: el resto debe superar el
  ruido aritmético, sin fabricar regiones de área ~0. Comentario de escala de
  tolerancia corregido (nanómetros en longitudes de tablero, < 0,005 mm² en
  áreas; no es tolerancia visual de 2 mm ni de fabricación). No se recorta
  geometría para pasar validaciones y no hay dependencias numéricas nuevas.
- Regresiones: programa decimal 2440×1830 (kept 100.1, kerf 3.2) completo;
  equivalente en eje Y (ancho 1000, kept 100.3, kerf 4.4); origen desplazado;
  división encadenada de región creada por corte decimal; desviación real de
  1 mm sigue rechazada. Los tests de NaN/Infinity/kerf inválido/borde
  permanecen.

### R2 — geometría de salida no canónica y compartida con la entrada

- Causa: `regionRects` guardaba referencias directas a `region.rect` del input;
  la traza mezclaba geometría declarada y recalculada y los cortes descendientes
  usaban el rect declarado del padre.
- Corrección: mapas separados. `declaredRects` (input, sólo inspección/
  validación) y `executedRects` (autoridad de salida): raíz copiada, cada
  división consume el rect ejecutado de su padre, los hijos recalculados se
  registran como regiones ejecutadas, y boardRect/divisiones/terminales/
  regionRects/totales se construyen desde esa geometría ejecutada. Disponibilidad
  de padres, unicidad, huérfanos y completitud se conservan; una diferencia
  declarada fuera de la política aritmética sigue fallando (sin
  autocorrección); input no se congela ni modifica; contrato readonly público
  intacto.
- Regresiones: mutar el input tras ejecutar no altera la traza; el resultado no
  comparte rectángulos con la entrada; geometría de una misma región coincide en
  divisiones/terminales/mapa/padre de cortes posteriores; declaración
  300.0000001 admitida como ruido NO se propaga (salida ejecutada 300 y totales
  exactos 600000/2400); desviación real rechazada; casos positivos de tercera
  fase y vertical conservados; determinismo/no-mutación (deep-frozen)
  conservado.

### Evidencia de la corrección (HEAD del commit de corrección)

- RED confirmado antes del fix: 7 tests nuevos fallando (4 de R1, 3 de R2).
- `pnpm vitest run src/optimizer/cutProgram.test.ts`: 56/56 pass.
- `pnpm vitest run` (packages/domain): 102 archivos / 1339 tests pass.
- `pnpm typecheck` (raíz, 7 proyectos): 0 errores.
- `pnpm test` (monorepo): verde en los 7 workspaces.
- `git diff --check`: limpio.

## Pendiente (siguientes incrementos de #650)

- Integración con el optimizador existente (conservar árbol de la candidata
  ganadora y generar el programa) — no iniciada.
- Vista previa (ProductionBoardView/Svg consumiendo la traza) — no iniciada;
  la divergencia UI/exportador del contraejemplo NO se declara corregida.
- Serializador PTX, perfil CADmatic 4 y lector inverso (entrega B) — no iniciados.
- Validación externa (CADLink/CADmatic, campo): no ejecutada y fuera de este
  incremento; el estado de campo sigue `NOT_TESTED/notClaimed`.

## No tocado

Heurísticas del optimizador, `generateCuttingInstructions`, React/SVG/UI,
serializador PTX y goldens, perfiles/adapters, backend Go, APIs, contratos,
migraciones, BOM/catálogo, SketchUp, CI.
