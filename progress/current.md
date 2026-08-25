# Sesión

**Feature en curso:** #349 — Smart Parametric Furniture Library MVP & #350 — Hardware Placement/Machining Sync
**Inicio:** 2026-08-24
**Estado:** Implementado y verificado (ver `progress/implementation_F164.md`).
**Rama:** `feat/349-parametric-furniture-library`
**Worktree:** `/Users/tiagofur/dev/carpinteria/muebles-worktrees/sketchup-extension-bootstrap`

## Notas de sesión

- Auditoría arquitectónica completada y documentada en `docs/architecture/parametric-furniture-library.md` y `docs/adr/0002-parametric-furniture-library-architecture.md`.
- 7 entidades desacopladas modeladas en `smartFurnitureDomain.ts`.
- Motor de instanciación `instantiateFurniture` en `furnitureCompositionEngine.ts`.
- Sincronización y aislamiento de herrajes en `sketchupHardwareSync.ts`.
- 85 test files y 1087 tests en domain pasando al 100%, typecheck 7/7 workspaces limpio.

## Corrección pipeline de inserción (2026-08-25)

**Problema:** al insertar un mueble real del taller sólo se generaban los
laterales y el contador decía "2 piezas" — la extensión no recibía la
composición del mueble (el contrato de definiciones sólo proyectaba
identidad/parámetros) y el builder caía al fallback genérico
(`shelfCount`/`doorCount` ausentes en módulos reales).

**Solución (resolución server-side, invariante intacta — Ruby nunca compone):**

- `backend-go/internal/domain/engine/layout.go`: `ResolveFurnitureLayout`
  resuelve estructura + componentes del módulo + agregados (unidades
  verticales/horizontales con gap) + herrajes visibles → cajas AABB
  pre-horneadas (min-corner, marco taller) + herrajes en world-space con
  shape/size/projection/color. Espejo de `bom.ts`/`spatialPlacement.ts`/
  `spatialAnchor.ts`/`agregados.ts`/`hardwarePlacement.ts`. Fórmulas ganan
  variables `B` (zoclo) y `HW`.
- `GET /api/furniture/definitions/{id}/layout?widthMm=&heightMm=&depthMm=`:
  auth + licencia; overrides de cotas; 404/400/422/403 explícitos.
- `GET /api/furniture/definitions`: cada definición lleva
  `estimatedPartCount`/`estimatedHardwareCount` (contador de piezas real).
- Ruby: `RemoteCatalogProvider#resolved_layout` (nil ⇒ fallback genérico,
  nunca guess local), `DialogController` (FurnitureBridge) pasa
  `resolved_layout:` al builder, `FurnitureBuilder` renderiza tableros +
  herrajes y reporta `board_count`/`hardware_count`/`component_count`;
  pushpull ahora +dz (min-corner). dialog.html usa `estimatedPartsLabel`.
- Módulos legados: piezas apiladas por índice (completitud sin inventar).

**Verificación:** `go test ./...` (backend completo) y `bundle exec rake`
(lint + 93 unit + boundary) en verde.

## Elección de materiales por rol en SketchUp (2026-08-25)

**Modelo:** idéntico a la app web — `OptionChoices = { [optionGroupCode]:
materialId }`; el `optionRole` del componente es el código del grupo
(`findOptionGroup(catalog, role)`). Grupos `kind: 'board'` curan los tableros
permitidos por rol (`optionIds`).

- Engine: `ResolveFurnitureLayout` acepta `optionChoices`; tablero con elección
  válida lleva `materialId/Code/Name/ColorHex` reales (previewColor
  normalizado); elección desconocida/inactiva → error explícito (422 en el
  endpoint); rol sin elección → paleta por rol (tolerante).
- `GET /api/furniture/definitions`: envelope `materials` (tableros activos) +
  `materialRoles: [{role, label, optionIds}]` por definición (grupo curado o
  todos los activos como fallback). ETag/revisionId ahora cubre materials.
- `GET .../layout?choice.ROL=<id>`: elecciones viajan en query porque el token
  de extensión es read-only (GET + refresh).
- Ruby: `resolved_layout(id, params, choices)` reenvía `choice.ROLE=id`;
  `all_materials` en el contrato del provider; controller reenvía
  `materialChoices` del payload; builder pinta grupos con
  `Model::MaterialApplier` (materiales namespaced `Granete · <nombre>`, color
  de `materialColorHex`/herrajes `colorHex`).
- dialog.html: sección "Materiales del Taller" (configurator + inspector), un
  select por rol con default = primera opción, payload `materialChoices`.

**Verificación:** `go test ./...` y `bundle exec rake` (lint + 97 unit +
boundary) en verde.

## Invariante

**SketchUp owns authoring/interaction; Granete owns manufacturing truth.** Ruby no
calcula BOM, partes resueltas, joints, drilling, nesting, kerf, preflight/release ni
postprocessing.
