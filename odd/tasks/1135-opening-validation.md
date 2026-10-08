# ODD — #1135 Validación INVALID_OPENING_CONFIGURATION y available-vs-valid

- **Issue**: tiagofur/muebleria#1135 (`status:approved`, labels backend +
  security — validación autoritativa).
- **Lane**: Inline Direct (validador puro + endpoint, bounded, un escritor)
  con artefacto para recuperación — las superficies de selección (#1136
  migración jaladeras, #1137 Inspector) son sus consumidoras.
- **Base**: `origin/main` @ `127d0e8c` (post merge del PR de #1134). Rama:
  `feat/1135-opening-validation`, worktree
  `../muebles-worktrees/1135-opening-validation`.
- **Estado**: IMPLEMENTED_PENDING_REVIEW.

## Resultado observable

`POST /api/catalog/opening-configuration/validate` valida una selección de
apertura para AUTORÍA NUEVA (sistema, perfil, tipo de mueble, placements)
contra las capacidades de fábrica (#1134) y el catálogo de perfiles (#1130).
Inválida ⇒ 422 con code `INVALID_OPENING_CONFIGURATION` y
`details.reason` (código estable + mensaje de taller); disponible pero
bloqueada por evidencia (rebase inferior / OQ-3) ⇒ 200 con el estado veraz
`blocked`; válida ⇒ 200 `valid`. Ocultar en UI jamás sustituye esta
validación.

## Decisiones de diseño

- **D1 Tres estados, no dos**: `valid` / `blocked` / `invalid`. El bloqueo
  por evidencia (OQ-3) NO es un error ni una invención: es el mismo concepto
  de "bloqueado" del contrato (#1129), ahora en el gate de selección. La
  API lo devuelve 200 para que las superficies lo muestren como «espera
  evidencia de campo».
- **D2 Envelope con precedente propio**: mismo patrón que
  PARAMETER_DEFINITION_INVALID (422 con code literal + details) — un solo
  contrato de error para web y SketchUp, sin tocar el enum generado
  OpenAPI en este slice.
- **D3 Razones estables con mensaje de taller junto al código**
  (`OpeningSelectionReasonMessage` / `openingSelectionReasonMessage`): la UI
  imprime texto, nunca el código solo; totalidad del mapeo probada en test.
- **D4 Gate sólo para autoría nueva**: la capability deshabilitada rechaza
  la selección nueva (`OPENING_SYSTEM_UNAVAILABLE`) pero los diseños
  persistidos no pasan por acá — resuelven contra su release fijado.
  `TestOpeningConfigurationHistoricalSemantics` fija: (a) cambiar la
  capability de hoy no altera la resolución histórica (byte-idéntica),
  (b) una revisión más nueva del perfil NO se filtra a la resolución
  histórica (el resolver consume el set pineado que el llamador pasa),
  (c) el release pineado sin el perfil falla explícito
  (`OPENING_PROFILE_UNKNOWN`) — no existe fallback a latest POR
  CONSTRUCCIÓN: el motor no tiene lookup, consume el set del llamador.
- **D5 Sin nuevo método de storage**: el handler compone
  `GetOpeningCapabilities` + `ListOpeningProfiles` (ya existentes) y
  proyecta la entidad al slice de validación. Overlay roto ⇒ 500
  fail-closed (test con store que falla SÓLO la lectura de capacidades).
- **D6 Fixture compartido de 13 casos**: disponible sin decisión,
  válida completa, deshabilitada, fuera de curaduría, ficha pendiente,
  bloqueado por evidencia, placement restringida por tipo, placement
  incompatible, perfil desconocido, gola sin perfil, perfil en sistema que
  no lo consume, tipo desconocido, sistema desconocido.

## Fuera de alcance (explícito)

- El CONSUMO del validador por las superficies de selección: llega con la
  migración de jaladeras (#1136) y el Inspector (#1137), que son quienes
  envían selecciones.
- Persistencia de la intención en diseños (portador) — depende de las
  mismas superficies.
- bottom_overhang sigue bloqueado por OQ-3 en TODO el sistema (el caso
  `blocked` es su comportamiento correcto, no un pendiente de este slice).

## Verificación

- Go: fixture de paridad (13 casos) + semántica histórica + totalidad de
  mensajes + handler (válido / disabled / incompatible / blocked /
  overlay-roto / método) — build/vet/test internos verdes.
- `pnpm typecheck` workspace limpio; `pnpm test` raíz VERDE (16 tests
  domain del validador; suites existentes intactas).
- Sin cambios storage/SQL: no aplica `scripts/backend-test.sh`.

## Siguiente slice

#1136 migración de opciones `jaladera-gola-*` al modelo de grip — la
primera superficie que ENVÍA selecciones al validador de este slice.
