# ODD — #1189 Diario de posiciones durable (SketchUp, sólo local)

- Issue: https://github.com/tiagofur/muebles/issues/1189 (`status:approved`, `type:feature`)
- Base: `main` @ `affdcfc4` — Rama: `feat/1189-position-journal` (worktree
  `muebles-worktrees/1189-position-journal`, escritor único).
- Topología: Delegated Direct (multi-archivo Ruby+JS+tests, artefacto único).
- Auditoría previa: el problema verificado en código — la posición vive sólo en
  `design_working_items.transform`; el sync explícito (`DesignSync::Synchronizer`,
  `include_removals: true`) la borra vía §5b (`design_working_copy.go:491-524`)
  que captura snapshot de autoría SIN transform; la card `unplaced` sólo ofrece
  "Colocar" (`granete-project-furniture.js:544`).

## Alcance autorizado

Diario de posiciones durable POR ARCHIVO (attribute dictionary a nivel modelo,
patrón `ModelBinding::Store`) + carril "↶ Restaurar posición" para cards
`unplaced` con entrada. SIN backend: cero migraciones, cero contratos, cero API.

- **Escritura**: transform confirmada por readback en `Placer#sync_placement` y
  en los 3 readbacks del `PositionSyncCoordinator` (`converge_inserted_unit`,
  `sync_moved_entities`, `converge_pending`); `forget` en `Placer#remove`.
- **Lectura**: `hasRecordedPosition` en la fila del panel (`PanelState`), sólo
  para filas `unplaced` de unidades activas (precedencia WC > diario).
- **Restore**: variante del `Restorer` — cuando el Working Copy ya no tiene el
  item (y sólo entonces), inserta con la transform del diario + inputs de
  autoría del snapshot #977 (carril 3 de `placement_inputs`), sin crear
  identidad ni escribir el Working Copy; queda `pending_confirmation` y
  "Reintentar sincronización" converge por el flujo existente.
- **Sin entrada / archivo distinto / unidad terminal**: sólo "Colocar".

## Fuera de alcance

Recuperar posiciones desde `design_revision_items` (publicaciones), extender el
snapshot server-side con transform (opción F documentada en la auditoría),
cambios de semántica de sync (`include_removals` intacto), paridad React.

## Verificación

- V0: preflight `PREFLIGHT_OK_NOT_VERIFIED` + `verify_affected --plan`
  (todo seleccionado por "unknown input"; superficie real = extensión) +
  rubocop limpio en los 10 archivos tocados.
- V1: `bundle exec rake verify` (ruby 3.2.11) en el worktree — syntax, lint,
  unit 1397 runs / 0 fallos, boundary 6 runs / 4079 assertions, RBZ
  construido con readback sha256 68d67ee3…31b4. Harness JS panel 71/71,
  dialog host 27/27. Nuevos tests: position_journal_test 9/9, sección #1189
  en project_furniture_test (9 tests: restore exacto desde el diario,
  convergencia por reintento, fail-closed sin entrada/entrada corrupta,
  precedencia WC > diario, terminal nunca restaura, confirm graba entrada,
  remove olvida entrada, hasRecordedPosition por fila), coordinator 1 test
  (readbacks confirman → diario avanza).
- V2: smoke del owner en host real (relaunch, ciclo aceptación 1-2 del issue) —
  NOT_RUN para el escritor; queda como puerta previa al merge.

## Resultado

IMPLEMENTED_PENDING_REVIEW — entregado en 1 commit de trabajo (código+tests+
artefacto), rama `feat/1189-position-journal`, base affdcfc4. Sin backend:
cero migraciones, cero contratos, cero cambios de API.
