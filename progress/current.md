# F193 — SelectionContext semántico + inspector contextual (#476)

Estado: `in_progress` (implementación y verificación completas; pendiente de
review/cierre).

Worktree: `../muebles-worktrees/476-selection-context` (rama
`codex/476-selection-context` desde `origin/main` b4f8e7e).

## Qué se implementó

- `Selection::SelectionContext` (`apps/sketchup-extension/src/granete_for_sketchup/selection/`):
  contrato canónico único `kind = furniture | aggregate | part | hardware |
  unmanaged` con separación de IDs (`furnitureInstanceId`,
  `componentInstanceId`, `componentDefinitionId`, `catalogComponentId`,
  `hardwarePlacementId`, `hardwareDefinitionId`, `hostComponentInstanceId`) y
  `hostLocator` marcado técnico (persistent_id), jamás autoridad.
- `Selection::Resolver`: entidad → contexto leyendo SOLO metadata namespaced;
  recupera el mueble dueño escaneando la raíz del modelo por
  `furnitureInstanceRef` (compatible con lectura legacy pre-#476 vía binding
  estructurado `hostComponentInstanceId`, nunca por nombre). Geometría de
  usuario y Groups sin metadata → `unmanaged`. Group legacy con metadata de
  mueble → `furniture` + `representation=legacy-group` con edición fail-closed
  (#416).
- `Selection::CapabilityPolicy` + `CapabilityReasons`: única autoridad de
  acciones legales por kind; lo no soportado queda presente-but-disabled con
  explicación en español (referencia a #391/#466/#467/#468/#470).
- Metadata: `MetadataWriter.write_part`/`write_hardware` persisten
  `intent.entityClass`, `hardwareDefinitionId` y `placementOrigin`
  (`resolved` hoy; `manual` llega con #468). Store valida los nuevos campos.
- `SelectionObserver` reescrito como bridge fino sobre el resolver; publica el
  payload del contexto (única representación que cruza a HtmlDialog).
  `DialogController`: nuevo callback `select_furniture` (view state only) para
  el breadcrumb.
- `dialog.html`: inspector contextual por kind — furniture con gating por
  capabilities (bloqueo con razón para legacy/definición faltante), vista
  drill-down part/hardware/aggregate con breadcrumb al mueble dueño, facts de
  identidad y lista de capabilities, estado unmanaged explícito, nota de
  multi-selección (#471). Estado central único `selectedContext`.

## Verificación

- `bundle exec rake verify` verde: syntax, RuboCop, 192 unit, 3 boundary,
  RBZ determinista `b75008b1…`.
- Host real SketchUp 2026.2 (Ruby 3.2.2) + TestUp 2.5.4 contra RBZ instalado:
  suite completa **35/35 tests, 1040 assertions, Success** (incluye
  `TC_SelectionContextSmoke` nueva: furniture, pieza anidada, herraje
  derivado, rename, move/rotate, rebuild con nuevo host locator, dos
  ocurrencias sharing definition sin colapso, unmanaged). Evidencia:
  `progress/host_smoke_F193_testup_ci.json`.

## Decisiones registradas

- El observer publica payload (hash) — una sola representación cruza el
  bridge; `resolve` devuelve el objeto Ruby para consumidores internos.
- `ownership_test`: se retiró el término singular `part` de la lista de
  términos prohibidos (era proxy de vocabulario de manufactura); desde #476
  `part` es el kind canónico de selección del contrato de interacción. El
  plural `parts`/familia resolvedparts sigue vetado.
- TestUp: SketchUp difiere los eventos de `SelectionObserver` al event loop;
  la suite resuelve vía `resolve` del observer (el código exacto que ejecuta
  el evento diferido) en lugar de correr contra el loop.
