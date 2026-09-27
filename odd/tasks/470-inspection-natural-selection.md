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
- [x] Auditoría del flujo exacto (D1–D5)
- [x] Reproducción con tests que fallan (5F+1E contra HEAD eafc014f)
- [x] Implementación del fix
- [x] Suite Ruby de unidad + rubocop (1218 unit + 6 boundary, 0 fallos; lint limpio)
- [ ] TestUp host smoke (host ocupado por run ajeno phase1 al momento del fix)
- [ ] Verificación (`verify_affected`) + publicación PR

## Evidencia

### Reproducción (pre-fix, HEAD eafc014f)

`test/unit/overlay_natural_selection_test.rb` — 7 tests: 5 failures + 1 error
(NoMethodError `select_naturally`), 1 pass (marker click, comportamiento ya
correcto). Fallos mapeados: D1 (selección no escrita), D3 (vacío no limpia),
D4 (leaf vs topmost), D2 (`on_viewport_selection` expuesto), brecha latente
de rescope post-clear.

### Implementación (archivos tocados)

- `src/granete_for_sketchup/overlay/inspection_tool.rb`: fall-through →
  `@manager.select_naturally(pick_path_under_cursor(x, y, view))` + consume
  (`true`); pick crudo root→leaf, sin resolución semántica en la tool.
- `src/granete_for_sketchup/overlay/manager.rb`: `select_naturally(path)`
  escribe `model.selection` (replace/clear, no-op idempotente, fail-soft);
  `native_selection_target` = primer elemento tras el prefijo común con
  `active_path`; `rescope` misma-mueble auto-sana con refresh cuando el
  snapshot es nil; eliminados kwarg/método `on_viewport_selection`.
- `src/granete_for_sketchup/ui/bridges/manufacturing_inspection_bridge.rb`:
  eliminados wiring y `handle_viewport_selection` (segunda autoridad).
- `test/support/sketchup.rb`: `PickHelperStub` + `ModelStub#active_path`
  (host-faithful, default []).
- `test/unit/overlay_natural_selection_test.rb`: 7 tests del contrato.
- `test/unit/overlay_inspection_tool_test.rb`: click-away sin pickhelper →
  consumido e inerte (antes: `refute handled` — codificaba el bug).
- `test/testup/TC_ManufacturingOverlaySmoke.rb`: B2 real-host natural
  selection (click en mueble → topmost; vacío → clear).

### Post-fix (ruby@3.2, bundle del repo)

- overlay_natural_selection: 7 runs / 31 assertions, 0 fallos
- overlay_inspection_tool: 7/12, 0 fallos; overlay_manager: 16/68, 0 fallos
- `rake unit boundary`: 1218 runs / 9066 assertions + 6 / 4043, 0 fallos
- rubocop (7 archivos tocados): no offenses

### Flujo resultante (una sola autoridad)

click fuera de markers → `select_naturally` → `model.selection` (replace/clear)
→ `SelectionObserver` (#476, el mismo de siempre) → `handle_selection_change`
→ dialog `onSelectionChange` + `rescope_overlay_from_selection` → overlay
re-scopeado/limpio honestamente. Click en marker → selección especial MF, sin
tocar `model.selection`.

