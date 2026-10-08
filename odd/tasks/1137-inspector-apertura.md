# ODD — #1137 Inspector «Apertura» en SketchUp (PR A: el portador server-side)

- **Issue**: tiagofur/muebleria#1137 (`status:approved`, épica OPEN-FRONT).
- **Lane**: cadena de dos PRs bajo la misma issue — **PR A (este)**: el
  portador server-side de la intención + su resolve (base de todo); **PR B**:
  la sección «Apertura» del Inspector de SketchUp (JS + tests). Un escritor.
- **Base**: `origin/main` @ `ec11e79b` (post merge del fix de #1136). Rama:
  `feat/1137-design-opening-server`, worktree
  `../muebles-worktrees/1137-inspector-apertura`.
- **Estado**: IMPLEMENTED_PENDING_REVIEW (PR A; alcance restante = PR B,
  explícito abajo).

## Resultado observable (PR A)

La intención de apertura existe como ESTADO DEL DISEÑO en el servidor:

- `PUT /api/designs/{designId}/opening` valida la selección como AUTORÍA
  NUEVA (capacidades de fábrica #1134 + catálogo de perfiles #1130 vía el
  validador #1135) y la persiste en el bloque de authoring defaults del
  working copy. Inválida ⇒ 422 `INVALID_OPENING_CONFIGURATION` con
  `details.reason` — la selección persistida previa queda intacta (el
  cliente sigue mostrándola).
- `GET /api/designs/{designId}/opening` reconstruye el estado autoritativo:
  la intención persistida + su resolución (fronts read-only del resolver
  #1131) + `dimsKnown`. Reabrir el Inspector reconstruye desde acá.
- La resolución es histérica-regla limpia: una selección PERSISTIDA resuelve
  sin consultar capacidades de hoy; la evidencia pendiente (OQ-3, ficha)
  aparece como estado `blocked` veraz — nunca dims inventadas.
- La escritura es QUIRÚRGICA (`SetDesignWorkingCopyOpening`): toca sólo el
  campo opening de los defaults — jamás los working items (el update genérico
  hace delete-and-reinsert de items, que una selección semántica no debe
  disparar).

## Decisiones de diseño

- **D1 Portador = authoring defaults** (el wrapper #784 es explícitamente
  extensible "through their own capability contracts"): `opening` entra como
  `DesignOpeningSelection` con validación propia. Cero migración (JSONB);
  el snapshot de revisiones lo congela automático (round-trip JSONB probado).
- **D2 Preservación en la ruta genérica**: el DTO generado no puede llevar
  `opening`, así que un save genérico del working copy con defaults carga el
  opening almacenado hacia adelante — un guardado genérico jamás borra en
  silencio la intención del diseño.
- **D3 Layout v1 = una zona ratio 1**: el piloto resuelve UNA región de
  frente por mueble (ADR-0009 §4 first slices = one module; §10 mantiene al
  Inspector libre de matemática de layout). El editor de zonas sobre la
  composición de agregados es scope posterior explícito.
- **D4 Dims veraces o ausentes**: las dims del frente salen de los
  parámetros explícitos del primer item (`CommercialDimsFromParameters`).
  Sin dims explícitas ⇒ `dimsKnown:false` + resolución ausente — la UI dice
  la verdad (el mueble necesita medidas), nunca adivina. Fallback a
  preset/base del módulo = scope posterior (resolver dims completas del
  pipeline de authoring).
- **D5 Patrones respetados**: handlers con structs planos (misma decisión
  que #1130 — sin codegen openapi); permisos RoleCanAccessProjects
  (lectura) / edición (escritura) como el resto de design; overlay roto ⇒
  sin resolución (fail-closed, jamás stale).
- **D6 No-capacidades-en-el-resolver**: `ResolveDesignOpening` NO recibe
  capabilities — disponible gobierna la escritura; la resolución de lo
  persistido es histórica. Probado por firma + test de repetición idéntica.

## Alcance restante (PR B — el plugin, misma issue)

La sección «Apertura» del Design Inspector (`granete-design-inspector.js`):
sistema/perfil/posición como selects semánticos filtrados por capacidades,
frentes read-only desde GET, manejo de 422 conservando la selección válida
previa con error accionable, reconstrucción al reabrir. Ruby sigue sin
calcular nada de apertura; sin BOM/machining local.

## Verificación (PR A)

- Engine: resuelto/blocked/baseline/sin-intent/dims-basura + repetición
  idéntica (6 tests).
- API: PUT válido persiste quirúrgicamente y resuelve; PUT inválido 422 con
  razón y selección previa intacta; GET reconstruye estado autoritativo;
  sin dims = ausencia veraz; forma inválida falla cerrado; método
  incorrecto 405 (6 tests).
- Domain: validación del wrapper con opening + round-trip JSONB (1 test).
- `go build/vet/test ./internal/...` verdes; suite PG completa en corrida.

## Siguiente

PR B: la superficie SketchUp que envía selecciones a estos endpoints.
