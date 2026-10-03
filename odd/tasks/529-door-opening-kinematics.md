# #529 — Agregado opening kinematics: puertas Izquierda y Derecha con bisagras y jaladera (Web React + SketchUp)

## Objective and authority

Tracks issue [#529](https://github.com/tiagofur/muebles/issues/529).
Owner mandate (2026-10-03):
1. Implementar la apertura cinemática exclusivamente para **puertas Izquierda y Derecha** (y par batiente), cuidando que **las bisagras y la jaladera roten solidarias a la puerta** alrededor de su pivote real, sin desfasarse ni quedar flotando en la pose cerrada.
2. Permitir en la **app Web React** marcar quién puede abrir y su grado máximo de apertura en las definiciones de **Herrajes, Agregados y Componentes** (catálogo/editor).
3. **INVARIANTE EXPRESA:** Proyectar 3D en la app Web (`FurnitureScene3D.tsx`) permanece **en pausa y NO se modifica**; el foco de visualización e interacción 3D es **Granete for SketchUp**.
4. **INVARIANTE DE MANUFACTURA:** La apertura y cierre es una **pose de presentación transitoria** (`progress: 0..1`). Cerrar (`progress = 0`) recomputa desde la transformación cerrada canónica sin acumular ningún delta. Abrir/cerrar **NUNCA** modifica el BOM, las dimensiones, los materiales, el maquinado CNC, el `bomFingerprint`, ni genera `MoveComponentIntent` ni marca la revisión de diseño como sucia (`authoringDirty = false`).

---

## Tasks

### T0 — Saneamiento y estabilización del worktree (Dejar base en verde)
- [x] T0.1 — Restaurar la definición eliminada por accidente de `furniture-base-drawers` en `packages/domain/src/pilotFurnitureCatalog.ts`.
- [x] T0.2 — Registrar `'optionLabels'` en `PARAMETER_FIELDS` dentro de `packages/domain/src/furnitureParameters.ts` para que la validación fail-closed de parámetros acepte etiquetas de visualización de enums.
- [x] T0.3 — Corregir token CSS en `apps/sketchup-extension/src/granete_for_sketchup/resources/css/inspector.css`: reemplazar el inexistente `var(--success-700)` y afines por tokens canónicos de `theme.css`.
- [x] T0.4 — Armonizar el contrato y JSON Schema de `sketchupAuthoringResolve` v1 eliminando inyecciones no esquematizadas en `resolved` que violaban `additionalProperties: false`.
- [x] T0.5 — Validar que `vitest` en `@granete/domain` (124 suites, 1756 tests), `go test` en `backend-go` y `rake unit` en `apps/sketchup-extension` (1314 runs, 9598 assertions) pasen 100% en verde.

### T1 — Web React: Autoría de apertura y grado máximo (Herrajes, Agregados y Componentes)
- [x] T1.1 — Herrajes (`Hardware`):
  - Añadir campo de dominio `maxOpeningAngleDeg?: number` a `Hardware` en `packages/domain/src/types.ts`.
  - En `Hardware3DSection.tsx` (`packages/ui/src/catalogs/hardware/`), para herrajes de forma bisagra (`previewShape === 'hinge'`), exponer input numérico *"Ángulo máx. de apertura (°)"* (`data-testid="hardware-form-max-opening-angle"`).
  - Mapear en `hardwareDraft.ts` y en `apps/web/src/stores/catalog/hardware.ts`.
- [x] T1.2 — Agregados (`Agregado`):
  - Modelar en `Agregado` la cinemática de presentación `presentationMotion?: AgregadoPresentationMotion` (rotate: pivot 'left'|'right', axis Z, openAngleDeg).
  - En `AgregadoEditorGeneralPanel.tsx` (`packages/ui/src/agregados/editor/`), añadir tarjeta/sección *"Cinemática y Apertura (3D)"* con selector de tipo de movimiento y campo de ángulo máximo (`data-testid="agregado-field-motion-type"`, `data-testid="agregado-field-open-angle"`).
  - Mapear bidireccionalmente en `agregadoDraft.ts`.
- [x] T1.3 — Componentes (`Component`):
  - Añadir `canOpen?: boolean` y `maxOpeningAngleDeg?: number` a `Component` en `packages/domain/src/types.ts`.
  - En `ComponentEditorGeneralPanel.tsx` (`packages/ui/src/components/editor/`), permitir marcar si el componente es elemento móvil y configurar su ángulo máximo (`data-testid="input-can-open"`, `data-testid="input-max-opening-angle"`).
  - Mapear en `componentDraft.ts` y en `catalogMappers.ts`.
- [x] T1.4 — Pruebas unitarias de UI y contratos en Web React:
  - `HardwareCatalog.test.tsx`: test de renderizado y persistencia de `maxOpeningAngleDeg` (13/13 pasadas).
  - `AgregadoEditorForm.test.tsx`: test de selección de tipo de cinemática y ángulo en pestaña General (11/11 pasadas).
  - `ComponentsScreen.test.tsx`: test de configuración de `canOpen` y `maxOpeningAngleDeg` (32/32 pasadas).
  - `catalogMappers.test.ts`: test de mapeo de entidad de componente (4/4 pasadas).
  - Typecheck monorepo: `pnpm -r typecheck` limpio en los 7 proyectos.
  - Proyectar 3D (`packages/ui/src/preview3d/`): cero archivos modificados (100% en pausa).

### T2 — Contratos y resolución backend (Go ↔ TS)
- [x] T2.1 — Modelo semántico de colocación y afinidad de bisagras y jaladera según lado de apertura (`doorSwing`: left, right, pair) en `backend-go/internal/domain/engine/authoring_door_swing.go`.
- [x] T2.2 — Afinidad de puerta (`DoorAffinity`) transportada en los placements del normalized snapshot sin romper la validación cerrada `additionalProperties: false` de `sketchup-authoring-resolve.v1`.
- [x] T2.3 — Pruebas de contrato dorado en Go (`UPDATE_AUTHORING_RESOLVE_GOLDEN=1 go test ./...`) y vitest de contrato (`sketchupAuthoringResolve.contract.test.ts` 20/20, `sketchupAuthoringResolve.schema.test.ts` 6/6) pasando en verde.

### T3 — Granete for SketchUp: Cinemática interactiva de puertas con Bisagras y Jaladera
- [x] T3.1 — Reimplementación completa de `PresentationMotionAdapter`:
  - Almacena `@closed_transforms` indexado por `persistent_id` / `object_id` al primer toque, eliminando la errónea búsqueda en `definition.instances.first`.
  - Calcula la rotación pura relativa alrededor del eje de bisagra vertical (Z) en el sistema local del mueble.
  - Rota el panel de la puerta y transfiere solidariamente la misma transformación relativa `rel_t` a todos los herrajes montados (`@hardware_by_host[comp_id]`), garantizando que la jaladera y las bisagras roten unidas a la puerta sin desfasarse ni quedar flotando.
  - Al cerrar (`progress = 0`), restituye directamente la pose cerrada canónica sin acumular ningún delta.
- [x] T3.2 — Acción interactiva de Apertura/Cierre en el Inspector de SketchUp:
  - Botón individual *"Abrir / Cerrar"* por cada puerta en la tarjeta "Apertura y Accesorios" (`door-toggle-motion-btn`).
  - Botón *"Cerrar todas"* en la cabecera de la tarjeta.
  - Bridge Ruby (`InspectorBridge#handle_toggle_door_motion`, `InspectorBridge#handle_close_all_doors`) registrado en `DialogController` y sincronizado bidireccionalmente con el JS del Inspector.
  - Acción puramente transitoria en el viewport: no altera el BOM, no toca CNC, no emite intents y no ensucia la revisión de diseño (`authoringDirty = false`).
- [x] T3.3 — Pruebas unitarias en Ruby:
  - `presentation_motion_adapter_test.rb`: 4/4 tests en verde (19 assertions), cubriendo rotación izquierda, rotación derecha alrededor del borde derecho, rotación solidaria de herrajes hijos, 50 ciclos continuos de abrir/cerrar con cero drift verificado, y `close_all`.
  - Suite completa `rake verify`: 1318 runs, 9617 assertions, 0 failures, 0 errors, lint limpio (287 files, 0 offenses) y paquete RBZ determinista verificado.

---

## Evidence

- **T0 (2026-10-03):**
  - `@granete/domain` vitest: 124 suites pasadas de 124 (1756 tests, 0 fallos). `pilotFurnitureCatalog.test.ts` y `pilotFurnitureCatalog.contract.test.ts` en verde con `furniture-base-drawers` restaurado y `optionLabels` soportado.
  - `sketchupAuthoringResolve`: tanto `sketchupAuthoringResolve.schema.test.ts` (6/6) como `sketchupAuthoringResolve.contract.test.ts` (20/20) pasan en verde tras retirar campos no esquematizados de `resolved`.
  - `apps/sketchup-extension` Ruby: `rake unit` pasa 100% (1314 runs, 9598 assertions, 0 failures, 0 errors); `TokenHealthJsTest` pasa limpio con los tokens corregidos en `inspector.css`.
  - `backend-go`: `go test ./internal/api/...` y `go test ./internal/domain/engine/...` en verde.
- **T1 (2026-10-03):**
  - `pnpm -r typecheck`: 7/7 paquetes limpios (domain, storage, excel, ui, mobile, desktop, web).
  - `@granete/ui` vitest: 183 suites pasadas de 183 (2073 tests, 0 fallos), incluyendo nuevos tests en `HardwareCatalog.test.tsx` (13/13), `AgregadoEditorForm.test.tsx` (11/11), `ComponentsScreen.test.tsx` (32/32), y `catalogMappers.test.ts` (4/4).
  - Cero archivos modificados en `packages/ui/src/preview3d/` (Proyectar 3D permanece intacto).
- **T2 & T3 (2026-10-03):**
  - `apps/sketchup-extension` Ruby `rake verify`: suite completa en VERDE (syntax, 287 files rubocop lint sin ofensas, 1318 unit tests, 6 boundary tests, y RBZ determinista verificado sha256 `0821376c49bf35b03fef77ece03d7fd4d9caf98a75a3a07486f753cac8b8e0d5`).
  - `test/unit/presentation_motion_adapter_test.rb`: 4/4 tests pasando (19 assertions), demostrando rotación de puerta izq/der, movimiento solidario de jaladera y bisagras, cero drift en 50 aperturas/cierres y restauración total en `close_all`.
  - `@granete/domain` vitest: 124 suites pasadas de 124 (1756 tests en verde).
  - `backend-go`: `go test ./internal/api/...` y `go test ./internal/domain/engine/...` en verde.

---

## NOT_RUN / deferred

- **Proyectar 3D (React / R3F):** En pausa por instrucción expresa del propietario. Ningún archivo bajo `packages/ui/src/preview3d/` se modificará en esta issue.
- **Cinemáticas complejas no solicitadas:** Elevadores especiales (AVENTOS HL/HS/HF) y mecanismos de tijera quedan diferidos para slices posteriores. Solo se cubren puertas Izquierda, Derecha y batiente doble.
- **Simulación física:** No se calculan resortes, muelles de gas ni colisiones entre puertas adyacentes.
