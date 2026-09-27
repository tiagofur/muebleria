# ODD — #470 Inspección de manufactura: restaurar la selección natural bajo el overlay

- **Issue**: #470 ([P1][SU-VIS-1] ManufacturingFeature 3D inspection overlay with provenance navigation) — `status:approved`
- **Escritor**: implementador ZCode, branch `fix/470-inspection-natural-selection`, base `origin/main` @ `eafc014f`
- **Lane**: ODD (auditoría + reproducción + fix + tests de unidad y host)
- **Fecha**: 2026-09-27

## Alcance autorizado

Bug real-host reportado por el owner: con una pieza managed seleccionada y
`Ver fabricación` activo, `InspectionTool` toma el viewport y la selección queda
aparentemente bloqueada. El código declara que los clicks fuera de
ManufacturingFeatures siguen el flujo natural de selección y que el overlay se
re-scopea, pero `select_under_cursor` sólo resuelve semánticamente la entidad vía
PickHelper y no actualiza `model.selection`; tampoco limpia la selección al
clicar vacío.

Objetivo: restaurar el comportamiento natural de selección de SketchUp mientras
el overlay está activo, sin perder la selección especial de ManufacturingFeatures
ni crear otra autoridad de selección.

### Exclusiones

- Modificadores de selección (shift/ctrl para multi-select): hoy `onLButtonDown`
  ignora flags; se mantiene plain-click replace. Follow-up si el owner lo pide.
- Cambios en el vocabulario visual del overlay, provenance, stale/refresh:
  cubiertos por entregas previas de #470, fuera de este bug.
- Navegación a contexto de autoría (#466) y demás acceptance de #470 ya cubierta.

## Auditoría del flujo (hechos, código actual)

1. `InspectionTool#onLButtonDown` (overlay/inspection_tool.rb:67):
   pick de feature → `manager.select_feature` + return `true` (consumido). Sin
   feature → `select_under_cursor` + return `false`.
2. `select_under_cursor` (inspection_tool.rb:129): `view.pickhelper(x,y).best_path`
   → `entity = picked&.last` (la HOJA del path) → `manager.on_viewport_selection(entity)`
   sólo si hay entidad. **Nunca escribe `model.selection` ni la limpia.**
3. `Manager#on_viewport_selection` (overlay/manager.rb:235) → callback del bridge
   `handle_viewport_selection` (ui/bridges/manufacturing_inspection_bridge.rb:98):
   resuelve el contexto con `Selection::Resolver` (#476) y llama
   `handle_selection_change` → dialog + `rescope_overlay_from_selection`.
4. `Selection::Resolver` es metadata-driven por entidad (selection/resolver.rb:34):
   no camina ancestros. Una hoja (face/edge) del pick casi nunca tiene metadata
   Granete → resuelve `unmanaged` → `scope_of_selection` = `{}` → el overlay se
   borra honestamente en vez de re-scopearse al mueble/pieza clicada.

### Divergencias probadas contra lo declarado

- **D1**: `model.selection` nunca cambia → highlight congelado en la pieza
  seleccionada al activar; el usuario percibe la selección bloqueada (bug
  real-host). El observer #476 (`onSelectionBulkChange`/`onSelectionCleared`)
  nunca dispara por clicks del usuario con el overlay activo.
- **D2**: la vía `on_viewport_selection` ES una segunda autoridad de selección de
  facto — exactamente lo que el comentario de la issue prohíbe («No definir un
  segundo selector de entidades para overlays»).
- **D3**: click en vacío: `entity` nil → no-op; ni limpia selección ni actualiza
  el dialog ni re-scopea. La selección nativa de SketchUp limpia.
- **D4**: el leaf-pick (`.last`) diverge de la selección nativa (topmost del
  contexto de edición activo): clic en la cara de un board resuelve `unmanaged`
  en lugar de seleccionar el mueble (raíz) como haría el Select nativo.
- **D5**: `resolve(entity, selection: model.selection)` lee `selection_count` de
  la selección vieja congelada → payload con conteo stale.

## Plan

1. **Reproducir primero**: tests de unidad que codifiquen el comportamiento
   deseado (selección nativa restaurada) y fallen contra HEAD.
   - Stub: `PickHelperStub` + `ViewStub#pickhelper`/DrawSpyView con pickhelper;
     `ModelStub#active_path` (host-faithful, default []).
   - Flujo completo: tool + manager + `SelectionObserver` real attachado →
     asserts de `model.selection`, payload del observer y re-scope.
2. **Fix** (una pasada coherente):
   - `InspectionTool`: el fall-through calcula la entidad que el Select nativo
     elegiría (primer elemento de `best_path` tras recortar `active_path`) y
     delega en `Manager#select_naturally(entity)`; consume el evento (`true`).
     Click en feature: sin cambios (selección especial MF intacta).
   - `Manager#select_naturally(entity)`: escribe `model.selection` (replace/clear,
     idempotente) vía `model_provider`. El observer #476 existente arrastra
     dialog + re-scope por el MISMO flujo que un click sin overlay.
   - Eliminar la vía paralela: `Manager#on_viewport_selection`, kwarg del
     constructor, y `handle_viewport_selection` del bridge.
3. **TestUp host smoke**: test real-host de selección natural (click en geometría
   → `model.selection` = topmost; click vacío → clear; click en marker →
   selección intacta). NOT_RUN/BLOCKED si no hay host.

## Tareas

- [x] Arranque: issue + skills + preflight + reservas (sin escritor previo)
- [x] Auditoría del flujo exacto (D1–D6)
- [x] Reproducción con tests que fallan (5F+1E contra HEAD eafc014f)
- [x] Implementación del fix
- [x] Suite Ruby de unidad + rubocop (1217 unit + 6 boundary, 0 fallos; lint limpio)
- [x] TestUp host smoke REAL: 6/6 PASS, 44 assertions (RBZ del branch, host restaurado)
- [x] Verificación (`rake verify` + package reproducible) + publicación PR

## Evidencia

### Reproducción (pre-fix, HEAD eafc014f)

`test/unit/overlay_natural_selection_test.rb` — 7 tests: 5 failures + 1 error
(NoMethodError `select_naturally`), 1 pass (marker click, comportamiento ya
correcto). Fallos mapeados: D1 (selección no escrita), D3 (vacío no limpia),
D4 (leaf vs topmost), D2 (`on_viewport_selection` expuesto), brecha latente
de rescope post-clear.

### D6 — métodos fantasma de la API (descubierto en host real)

El `select_under_cursor` original llamaba `View#pickhelper` y
`PickHelper#best_path`, que NO existen en el host real (verificado contra
sketchup-api-stubs 0.7.11: los nombres reales son `View#pick_helper` —
forma sin args SU 2025+ — `PickHelper#do_pick(x,y)` y `#best_picked`,
documentado como «la entidad que habría picado el Select tool»). El guard
`respond_to?(:pickhelper)` retornaba temprano: todo el fall-through estaba
MUERTO en producción. El fix usa la API real y delega la semántica de
selección nativa al propio host (sin trimming manual de paths).

### Implementación (archivos tocados)

- `src/granete_for_sketchup/overlay/inspection_tool.rb`: fall-through →
  `@manager.select_naturally(native_pick_under_cursor(x, y, view))`
  (do_pick + best_picked) + consume (`true`); sin resolución semántica en
  la tool.
- `src/granete_for_sketchup/overlay/manager.rb`: `select_naturally(entity)`
  escribe `model.selection` (replace/clear, no-op idempotente, fail-soft);
  `rescope` misma-mueble auto-sana con refresh cuando el snapshot es nil;
  eliminados kwarg/método `on_viewport_selection`.
- `src/granete_for_sketchup/ui/bridges/manufacturing_inspection_bridge.rb`:
  eliminados wiring y `handle_viewport_selection` (segunda autoridad).
- `test/support/sketchup.rb`: `PickHelperStub` (do_pick/best_picked/path_at)
  + `ModelStub#active_path` (host-faithful, default []).
- `test/unit/overlay_natural_selection_test.rb`: 7 tests del contrato.
- `test/unit/overlay_inspection_tool_test.rb`: click-away sin pick_helper →
  consumido e inerte (antes: `refute handled` — codificaba el bug).
- `test/testup/TC_ManufacturingOverlaySmoke.rb`: B2 real-host natural
  selection (zoom al mueble; grid screen-space con do_pick/path_at; click
  en mueble → selección topmost; vacío → clear).

### Post-fix local (ruby@3.2, bundle del repo, commit 9fd3983a)

- overlay_natural_selection: 7 runs / 31 assertions, 0 fallos
- `rake verify`: syntax OK, rubocop limpio, unit 1217/9064, boundary 6/4043,
  package reproducible sha256 bab73b08057e7af9ef268690fbc83926aa9d49d8bafde6906677457b1680e985

### Host real (SketchUp 2026 arm64, RBZ del branch instalado)

- `progress/host_smoke_470_testup_ci.json` (TestUp CI, config
  `testup-ci-470.yml`): **Success — 6/6 PASS, 44 assertions, 0 failures**,
  incluyendo `test_clicks_outside_markers_follow_natural_selection`:
  click en mueble (fuera de markers) → `model.selection` = [instancia
  mueble topmost]; click en vacío → selección limpia; marker click →
  selección especial sin tocar el modelo (test A).
- Instalación del host restaurada al backup original tras el run
  (granete_for_sketchup.rb sha256 a7fdbfed… verificado).
- Nota de proceso: el host estuvo ocupado por el run TestUp del worktree
  phase1 (base eafc014f) al comenzar; se esperó su salida antes de tocar
  la instalación compartida.

### Flujo resultante (una sola autoridad)

click fuera de markers → `select_naturally` → `model.selection` (replace/clear)
→ `SelectionObserver` (#476, el mismo de siempre) → `handle_selection_change`
→ dialog `onSelectionChange` + `rescope_overlay_from_selection` → overlay
re-scopeado/limpio honestamente. Click en marker → selección especial MF, sin
tocar `model.selection`.

## Ronda 2 — reporte del owner: editor atrapado (mismo PR, mismo issue)

Escenario real del owner: doble clic entra al mueble → selecciona pieza →
activa Ver fabricación → no puede deseleccionar, ni elegir otra pieza, ni
salir del editor con Esc o clics afuera; el botón «volver al mueble»
(breadcrumb → `handle_select_furniture`, sólo selección) deja el host
totalmente inerte.

### Nuevas causas raíz

- **D7** — `pop_tool` usaba `model.select_tool(nil)`: el host queda SIN tool
  activo (select_tool(nil) deselecciona sin restaurar nada) → parálisis
  total tras ocultar el overlay.
- **D8** — `InspectionTool` no implementaba `onLButtonDoubleClick` ni Esc
  con semántica nativa: dentro de un contexto de edición no se podía salir
  (Esc sólo invalidaba la vista).
- **D9** — `Sketchup::Entity` NO define `==`: en el host real dos wrappers
  de la MISMA entidad comparan distintos (identidad de objetos Ruby);
  comparaciones por identidad requieren `entityID`.

### Fixes ronda 2

- `push_tool`/`pop_tool`: stack moderno `Model#tools.push_tool/pop_tool`
  (restaura el tool previo, p.ej. el Select nativo); `select_tool` queda
  como fallback legacy.
- `Manager#escape_naturally` (Esc): dentro de contexto → `close_active`
  (un nivel, como el Select nativo); en raíz → limpia selección.
- `Manager#open_or_close_context_naturally` (doble-click): sobre la
  instancia que el primer click seleccionó → entra (`active_path=`); en
  vacío dentro de contexto → sale un nivel; otro caso → selección natural.
- `Manager#same_entity?`: identidad por `entityID` (host-faithful).
- Normalización `active_path` nil (el host devuelve nil en raíz, no []).
- Marker/doble-click en marker: selección especial intacta.

### Hechos de host descubiertos (SU 2026)

- `close_active` LIMPIA la selección anidada al salir del contexto
  (nativo; los tests lo codifican).
- `onSelectionCleared` dispara sincrónico; `onSelectionBulkChange` se
  difiere a idle.
- `PickHelper#do_pick` necesita un pase de render previo en proceso fresco:
  el smoke fuerza uno con `write_image` a temp (3/3 corridas verdes).
- TestUp sólo filtra por CLASE en `Tests:`; la navegación pesada corre en
  proceso propio (`testup-ci-470-navigation.yml`).

### Evidencia ronda 2

- Unit: 1227 runs / 9110 assertions + boundary 6/4043, 0 fallos; rubocop
  limpio; `rake verify` PASS; paquete reproducible sha256 2de89992….
- Host real (RBZ del branch, instalación restaurada):
  - `progress/host_smoke_470_testup_ci.json`: 6/6 PASS — **3 corridas
    consecutivas verdes** tras el render-force.
  - `progress/host_smoke_470_navigation_testup_ci.json`: 1/1 PASS / 10
    aserciones — flujo exacto del owner: dentro del mueble + pieza
    seleccionada + overlay ON → Esc sale (selección anidada se limpia como
    el nativo, overlay sigue ON) → doble-click re-entra → doble-click en
    vacío sale → Esc en raíz limpia selección → disable cierra limpio.

### Correcciones de cifras (bloqueo 1 de la revisión independiente)

- El archivo de test commiteado en el pin 6c156803 tenía 6 tests / 29
  aserciones y el RED pre-fix verificado por el revisor fue 4F+1E (no
  7/5F+1E como decía la primer versión de este artefacto).
- El archivo final tras la ronda 2 tiene 16 tests / 73 aserciones, todos
  verdes.

## Entrega

- Ronda 1: HEAD `9fd3983a` + evidencia `6c156803`. Ronda 2: este commit.
- PR #872: `Refs #470` + `Delivery: partial` — el bug de selección y el
  editor atrapado están fixeados y probados (unit + host real); el cierre
  de #470 queda sujeto a la validación en vivo del owner.
- Exclusiones reafirmadas: modificadores shift/ctrl; menú contextual bajo
  el overlay.


