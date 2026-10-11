# ODD 1261 — Descubribilidad de la Apertura en el Inspector de SketchUp

Issue: #1261 (status:approved). Base: origin/main cf70127c. Rama: feat/1261-opening-discoverability.
Writer: agente ZCode (único escritor). Lane: Delegated Direct.

## El problema

En SketchUp, la tarjeta de «Apertura del diseño» (#1137) sólo aparece cuando NADA está seleccionado en el modelo (carril `handleNoSelection`). Cuando el usuario selecciona un mueble:
1. El carril muestra las propiedades del mueble y la apertura desaparece por completo.
2. La tarjeta #529 se llama «Presentación de puertas» (rename de #1256), pero no hay indicación de qué apertura tiene el diseño ni cómo configurarla.
3. El usuario piensa que la gola no existe o no funciona porque al hacer clic en el mueble no ve ninguna opción de apertura.

## Solución aprobada

1. En el Inspector del mueble seleccionado (`renderFurnitureInspector`):
   - Agregar una tarjeta visible `inspector-opening-summary-card` cuando el modelo esté vinculado a un diseño (`authoring_design_id` / `binding.design_id`).
   - Muestra el estado actual de la apertura del diseño (ej: "Sistema: Gola L (GOLA-L-8006)" o "Sistema: Jaladera").
   - Si no está configurada, muestra "Sistema: Jaladera (predeterminado)".
   - Incluye un botón/acción accesible "Configurar apertura del diseño" que deselecciona el modelo (`sketchup.clear_selection()` o `selection.clear`) llevando al usuario directamente a la tarjeta completa de apertura del diseño.
2. Si el modelo NO está vinculado a un diseño:
   - Ya existe `inspector-binding-hint` indicando conectar a un diseño en Proyecto.
3. Garantizar que si la apertura cambia, el resumen en el mueble se actualiza automáticamente.
4. Bump a `EXTENSION_VERSION = 0.1.61` y actualizar tests unitarios de Ruby y JS.

## Tareas

- [x] CU1 HTML/CSS: agregar la tarjeta `inspector-opening-summary-card` en `dialog.html` dentro de `inspector-active-view` + bootstrap de `GraneteUI.opening.init`.
- [x] CU2 JS: en `granete-opening.js`, implementar `getSummary()`, `ensureLoaded()`, `onSummaryChanged` y auto-inicialización con `window.sketchup`.
- [x] CU3 JS: en `granete-inspector.js` (`renderFurnitureInspector`), `renderOpeningSummaryCard()` muestra el sistema, perfil y frente resuelto con botón `Configurar`.
- [x] CU4 JS/Ruby: botón `Configurar` invoca `clear_selection`; `InspectorBridge.handle_clear_selection` vacía la selección nativa en SketchUp activando `handleNoSelection()`.
- [x] CU5 Tests: tests unitarios en JS (`granete_opening_test.js` 11/11, `granete_inspector_test.js` 54/54) y Ruby (`dialog_controller_test.rb`, `application_test.rb`).
- [x] CU6 Bump `0.1.61`, `bundle exec rake verify` (1413 tests, 10000 assertions, 0 failures, 0 offenses), RBZ empaquetado.

## Evidencia

- `rake verify` COMPLETO verde (Ruby 3.2):
  - syntax: OK
  - rubocop: 306 files inspected, no offenses detected
  - unit: 1413 runs, 10000 assertions, 0 failures, 0 errors, 0 skips
  - boundary: 6 runs, 4207 assertions, 0 failures, 0 errors, 0 skips
  - package:verified: `dist/granete_for_sketchup.rbz` (0.1.61) sha256 c91a3595...
- Node JS tests:
  - `granete_opening_test.js`: 11 tests passed
  - `granete_inspector_test.js`: 54 tests passed
- Hallazgo raíz resuelto: `window.GraneteUI.opening.init` nunca se invocaba en el bootstrap de `dialog.html`, por lo que en tiempo de ejecución de SketchUp la tarjeta de apertura fallaba cerrado en el guard de inicialización. Ahora se auto-inicializa y se invoca explícitamente en el bootstrap.
