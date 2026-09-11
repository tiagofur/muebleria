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

- `cutProgram.test.ts`: 64/64 (46 de PR1 + R1/R2 + 8 nuevos: kerf-only, blade
  exit, unexpected/missing rest, blade_exit_mismatch).
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
