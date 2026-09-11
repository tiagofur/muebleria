# Implementación #650 — PR 2: conservar el programa real del optimizador

- Issue: #650 (status:approved). Entrega parcial: integración del núcleo de PR #652
  con las heurísticas guillotina existentes (parte de la entrega A).
- Rama: `feat/650-optimizer-cut-program`. Base exacta:
  `origin/main@e1d2e832b07e936bbdb7884021b7bf3c6f0ca307` (post-fusión de PR #652).
- Fecha: 2026-09-10. Estado: `IMPLEMENTED_PENDING_REVIEW`.

## Qué se implementó

El optimizador entrega, junto con las piezas colocadas, el programa explícito de
divisiones que produjo esa colocación, registrado DURANTE el empaquetado. Las
colocaciones no cambiaron: la aritmética de regiones libres proviene ahora de la
misma fuente que el programa (`divideRegion`), expresiones idénticas a las
históricas — los 7 tests previos del optimizador y los 5 de nesting pasan sin
modificación.

### Extensión mínima del núcleo (`cutProgram.ts`)

- `separateExtent(parentExtent, kept, kerf)`: clasificador único de la política
  de separación: `exact_fit` (la región ya coincide: hoja terminal sin pasada),
  `kerf_only` (el resto iguala al disco: pasada real sin sobrante sólido),
  `solid_rest`, `blade_exits_parent` (resto menor que el disco). Las heurísticas
  no reimplementan estas reglas.
- Divisiones kerf-only: `restRegionId` opcional y `restRect` null; sin regiones
  de área cero. Errores dedicados si se declara un resto inexistente
  (`unexpected_rest_region`) o se omite un resto sólido real
  (`missing_rest_region`).
- Política explícita de salida de disco: `divideRegion(..., { allowBladeExit })`
  admite la pasada cuando el resto es menor que el disco, registrando la banda
  RECORTADA al padre y el marcador `bladeExitsParent` (validado en
  `executeCutProgram`; inconsistencia → `blade_exit_mismatch`). El sobre-marcha
  del disco fuera de la región sólo consume material ya retirado: en las cadenas
  del optimizador todo borde lejano de región es borde de tablero/refilado o una
  banda de kerf previa, nunca material vivo. Sin la opción, sigue siendo
  `cut_at_border_unsupported`. Motivación real: el test histórico de nesting
  (kerf 12, pieza 490 en región 498) coloca exactamente así; rechazarlo habría
  degradado colocaciones aceptadas. El disco se contabiliza una sola vez.

### Builder interno (`cutProgramBuilder.ts`)

`CutProgramSheetBuilder` + `registerTrimDivisions`: registran regiones,
divisiones y terminales mientras se empaqueta. Refilados como separaciones
sólidas con kerf 0 (la semántica de márgenes existente ya incluye el material
retirado; cada superficie se cuenta una vez, separada del disco). Mapping
bottom→origen Y / top→borde lejano explícito, sin inversión silenciosa. Los
retazos/sobrantes se clasifican con `isUsefulRemnant`; el programa no borra
sobrantes pequeños que la lista histórica omite.

### Instrumentación de heurísticas (`guillotine.ts`)

- Best-Fit V (primera separación X: columna de pieza + resto a altura completa,
  luego pieza dentro de la columna) y H (primera Y: banda + resto a ancho
  completo, luego pieza dentro de la banda). Los FreeRect que itera la heurística
  SON las regiones del programa (identidad + geometría de quien las creó).
- Strip/Shelf: separación de franja (kerf real), troceado X por colocación y
  recorte Y explícito cuando la pieza es menor que la franja (caso 320/210 →
  sobrante sólido 106 + disco 4), sobrante de franja y sobrante final como
  terminales reales.
- Identidad: cada hoja de pieza enlaza la colocación concreta
  (`pieceRef = placed.id = <ocurrencia>-s<tablero>`); piezas idénticas conservan
  referencias distintas; no se acuña identidad de negocio nueva.

### Candidatas y selección

`runPackingStrategy` + `validateCandidatePrograms` + `pickWinningStrategyCandidate`:
cada candidata conserva juntas piezas/programa/terminales/retazos/pendientes.
Antes de comparar rendimiento: demanda completamente colocada, programa ejecutado
y validado, `checkExpectedPieces` contra medidas COLOCADAS (rotación incluida,
canto no vuelto a deducir) y correspondencia hoja↔colocación incluida posición
(`cutProgramRectMatches`). Candidatas incompletas/no representables quedan
excluidas con causa (`cut_plan.pieces_not_placed`,
`cut_plan.placement_not_representable`, etc.); si ninguna satisface,
`cut_plan.no_representable_candidate` con piezas y causas (nunca un plan parcial
presentado como completo). Demanda vacía: política explícita compatible (0
tableros, sin error).

### Transporte al resultado

`PlacementResult.cutProgram` y `CutPlanSheet.cutProgram` (opcional,
serializable `CutProgramInput`, validado al generar). `buildSheetModels` lo
conserva. Programas antiguos siguen legibles; su ausencia no significa programa
verificado. cnc-nesting intacto y sin programas. Round-trip JSON probado; la
persistencia en servidor NO pertenece a este PR y no se declara probada.

## Evidencia (HEAD del commit de este PR)

- `cutProgram.test.ts`: 64/64 (56 heredados del núcleo de #652 ya corregido —
  46 originales más 10 de la ronda R1/R2 de revisión de ese PR — y 8 nuevos
  de kerf-only/blade-exit y sus negativos).
- `optimizerCutProgram.test.ts` (nuevo): 24/24 — variantes Best-Fit X/Y con
  geometría literal independiente, Strip con recorte 210/320→106, candidata
  ganadora coherente, pick excluye incompleta con menos tableros, decimales,
  trims asimétricos (literales 5/11/13/7), canto una vez, rotada vs veta,
  duplicados, encajes exactos (2 pasadas kerf-only / 1 pasada + hoja plena),
  sobrante de 2 mm como terminal real, varios tableros y materiales, rechazo de
  imposible, demanda vacía, buildSheetModels, JSON round-trip, negativos
  (división/hoja eliminadas), nesting sin programa, determinismo (sheets
  iguales, id/timestamps aparte) y no mutación (inputs deep-frozen).
- `optimizer.test.ts` 7/7 y `nesting.test.ts` 5/5 sin cambios (colocaciones
  idénticas a las históricas).
- Suite domain: 103 archivos / 1371 tests. `pnpm typecheck` raíz (7 proyectos):
  0 errores. `pnpm test` monorepo verde. `git diff --check` limpio.

## Ronda de corrección de revisión (mismo PR #654, 2026-09-10)

Base de la corrección: `fd42f023bc90d44428bad6170ef7949310edcd70` (más merge con
`origin/main@41e8a0bd`, PR #653, preservando ambos trabajos; el único conflicto
fue `progress/current.md`). Regresiones añadidas ANTES del fix (12 tests nuevos
en RED sobre ese HEAD), luego corrección y verificación completa.

### R1 — refilados con geometría de disco real

- Causa: `registerTrimDivisions` registraba todos los trims con kerf 0 —
  conservaba área algebraicamente pero no representaba las pasadas reales.
- Corrección: semántica de MARGEN TOTAL explícita con disco real: margen 10 +
  disco 4 = desperdicio sólido X=0..6 + banda X=6..10 + región útil desde X=10
  (sin sumar el kerf encima del margen ni bandas de área cera con disco
  positivo). Casos de borde: margen == kerf → pasada kerf-only (todo el margen
  es disco); margen < kerf → banda recortada al margen y disco que sale por el
  borde del tablero (`bladeExitsParent`); kerf 0 → sólido = margen completo con
  banda nula (configuración de kerf cero, no un sustituto de disco positivo).
  Los lados cercanos (izquierda/abajo) usan la extensión mínima `leadingBand`
  ([resto][banda][kept], kept anclado al extremo lejano); los lejanos usan el
  layout normal. Las coordenadas del área útil y de las piezas NO cambian. La
  identificación no depende de nombres de cutId: `leadingBand`,
  `bladeExitsParent` y `liberated` son datos semánticos del contrato.
- Regresiones: cuatro lados asimétricos con sólidos/bandas literales,
  identidad padre/hijas de la cadena, ejemplo obligatorio 10/4 (3600+2400),
  margen==kerf, margen<kerf, kerf 0, conservación del tablero crudo.

### R2 — límites y garantía verificada de la salida del disco

- Causa: keptExtent > parentExtent se clasificaba como blade_exits y devolvía
  banda negativa (keptRect 601, banda -1); y el flag bladeExitsParent no
  demostraba nada sobre el espacio fuera del padre.
- Corrección: `separateExtent` clasifica `kept_exceeds_parent` (piezas fuera
  del padre o entradas no finitas) y `divideRegion` falla SIEMPRE con
  `cut_program.kept_exceeds_parent` (la salida del disco es la herramienta
  fuera del padre, no la pieza); ninguna función devuelve banda negativa. La
  sobre-marcha queda VERIFICADA por cobertura en `executeCutProgram`
  (`assertBladeOverhangClear` + barrido de coordenadas): la huella nominal
  completa (banda consumida + sobre-marcha = kerf) sólo puede cruzar exterior
  del tablero, bandas de kerf de divisiones ANTERIORES, o desperdicio
  explícitamente `liberated` ya producido (retazos de refilado descartados con
  su pasada; declararlo en terminales no-waste se rechaza). Cualquier otra
  región viva (piezas, retazos, libres, subpaneles no retirados) obstruye →
  `cut_program.blade_overhang_obstructed`. No se modelan movimientos de
  subpanel: retirar/reposicionar un vecino es una precondición que sólo el
  writer declara explícitamente vía `liberated`, nunca algo que la suma de
  áreas demuestre. Comentarios contradictorios sobre "never clip" corregidos:
  el recorte de banda existe, es la única admisión, es visible (flag + ancho)
  y ahora está verificado.
- Contraejemplo de control: kerf 4 (banda 500..504) y luego kerf 12
  (huella 499..511) → los 504..511 invaden el subpanel derecho vivo →
  rechazado. Con kerfs iguales (12): la huella cae sobre la banda previa
  500..512 → aceptado con evidencia. El caso histórico 490-en-región-498 con
  kerf 12 y margen 10 se resuelve con evidencia: el margen 10 < kerf 12 hace
  del refilado una pasada blade-exit cuya banda 1010..1020 cubre la
  sobre-marcha de la pieza.
- Regresiones: kept>parent en ambos ejes y no finitas en `separateExtent`;
  banda positiva y huella coherente con el kerf nominal; cobertura suficiente
  (banda previa), insuficiente (contraejemplo), exterior, liberated
  (positivo/negativo), flag inconsistente, rechazo sin autorización.

### R3 — una misma verdad para retazos y selección

- Causa: Strip registraba el sobrante del recorte como terminal del programa
  pero no en `sheet.remnants`; `pickWinningStrategyCandidate` compara área
  útil desde `remnants` → programa y métrica discrepaban (repro: 500×796,
  0.398 m², útil, ausente).
- Corrección: `deriveSheetRemnants` deriva la lista desde las terminales del
  programa (útiles = kind 'remnant' clasificado por `isUsefulRemnant` al
  registrar; desperdicios sobre el umbral de presentación histórico —5 mm
  Best-Fit / 10 mm Strip— siguen visibles; basura de refilado excluida de la
  presentación). Sin reconstrucción por coordenadas, sin reglas duplicadas,
  sin duplicados; selección de candidata y estadísticas consumen esa única
  lista; los desperdicios pequeños no desaparecen de la contabilidad
  geométrica.
- Regresiones: repro 500×796 presente y coincidente con su terminal;
  correspondencia bidireccional útiles↔remnants; área útil coincidente; sin
  duplicados; varios tableros/materiales con material/tablero correctos y
  estadísticas coherentes.

### Evidencia de la corrección (HEAD del commit de corrección)

- RED confirmado antes del fix: 12 tests nuevos fallando (5 R1, 4 R2, 3 R3 —
  uno de R3 quedó en GREEN accidental y se conserva como guarda).
- `cutProgram.test.ts`: 73/73 (56 heredados del núcleo de #652 ya corregido +
  8 de la extensión PR2 + 9 nuevos de límites/cobertura).
- `optimizerCutProgram.test.ts`: 31/31 (24 de PR2 con el test de trims
  reescrito a la semántica física correcta + 7 nuevos de R1/R3).
- `optimizer.test.ts` 7/7 y `nesting.test.ts` 5/5 sin cambios.
- Suite domain: 103 archivos / 1387 tests. `pnpm typecheck` raíz (7
  proyectos): 0 errores. `pnpm test` monorepo: verde. `git diff --check`:
  limpio.

## Pendiente (siguientes incrementos de #650)

- Vista previa (ProductionBoardView/Svg consumiendo la traza) y migración de
  instrucciones: no iniciadas; la divergencia UI/exportador NO se declara
  corregida.
- PTX, perfil CADmatic 4 y lector inverso (entrega B): no iniciados.
- Persistencia del programa en backend y validación externa: no verificadas en
  este incremento; campo sigue `NOT_TESTED/notClaimed`.

## No tocado

`generateCuttingInstructions` y su consumidor, `productionBoardLayout.ts`,
ProductionBoardView/Svg, pantallas/estilos/navegación, serializador PTX y
fixtures, perfiles/adapters/selección/descargas, backend Go/APIs/migraciones,
BOM/catálogo/liberación, SketchUp, CI/permisos. cnc-nesting sin cambios de
algoritmo.
