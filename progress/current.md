# Sesión — F082 Motor Paramétrico de Agregados (#294, Fase 1)

- **Fecha:** 2026-08-11
- **Scope:** Implementación de F082 (Plan Maestro de Agregados, docs/agregados-subassemblies-plan.md, Issue #294)

## Contexto de la sesión

Análisis conceptual y auditoría de Agregados completada. Se creó la especificación técnica en `docs/agregados-subassemblies-plan.md` y 4 GitHub Issues (#294-#297).
Se acordó implementar en paralelo la Fase 1 (Dominio) y Fase 2 (UI Estructuras) sin interferir con las mejoras 3D de Proyectar.

## En Curso — F082 Motor Paramétrico de Agregados (#294)

1. Extender `ModuleAgregadoInstance` en `packages/domain/src/types.ts`.
2. Actualizar `resolveAgregadoInstance` en `packages/domain/src/agregados.ts` para calcular Bounding Box local y apilamiento.
3. Actualizar `bom.ts` para evaluar fórmulas dentro de $W_{\text{local}}, H_{\text{local}}, D_{\text{local}}$.
4. Unit tests en `packages/domain/src/agregados.test.ts`.

## Hecho — Planeamiento

- `docs/roadmap-comercial-v2.md` (nuevo): única fuente de verdad, consolida
  4 roadmaps solapados. Decisiones D1-D4, Fases A-D + Congelada.
- `docs/prd.md §17`: reescrito, referencia al roadmap comercial.
- `feature_list.json`: +17 features F065-F081 (60→77 total).
- GitHub: 17 issues #277-#293 + 5 milestones (Fase A-E). Issues #254-#256
  reasignados a Fase C.
- Commits en main: `9675c2e` (planeamiento) + push.
- WIP hardware-3d preservado en rama feat (`9dbc1d7`) + push.

## Hecho — F066 Inspector 3D colapsable (#278, Fase A)

- `useInspectorSectionState.ts` (nuevo): hook SSR-safe con persistencia en
  localStorage. Default: 4 secciones abiertas + advanced cerrada.
- `useInspectorSectionState.test.ts` (nuevo): 8 tests (default, toggle,
  setOpen, persistencia, rehidratación, merge defaults, corrupt JSON, no-op).
- `PartInspector.tsx`: rediseñado en 5 secciones colapsables
  (Dimensiones/Material/Herrajes/Acabado/Avanzado) con sub-componentes
  CollapsibleSection + FieldGrid. Placeholders en Herrajes/Acabado para F069/F070.
- `partInspector.css`: estilos de sección colapsable con tokens del repo
  (ChevronDown/Right, aria-expanded, hover/focus, surface-input body).
- `PartInspector.test.tsx`: 8 tests (existentes adaptados + nuevos: 5 headers,
  toggle, advanced collapsed default, placeholders, persistencia remount).

### Decisión de testing
El test existente hacía `getByTestId('part-inspector-role')` asumiendo que
role estaba visible. Con F066, role vive en sección "Avanzado" que arranca
cerrada por defecto. Se adaptó el test para abrir la sección antes del assert
— no es romper el test, es reflejar el nuevo comportamiento intencional
(advanced = datos técnicos, cierra por defecto).

## Validación

- `pnpm --filter @muebles/ui test`: 634/634 ✓
- `pnpm typecheck`: 6 workspaces ✓
- `./init.sh`: entorno + tests + typecheck verde completo ✓

## Siguiente

- Commit F066 + push + cerrar issue #278 ✓ (hecho)
- F067 paleta de materiales (en curso)

## Hecho — F067 Paleta de materiales con drag-apply (#279, Fase A)

Reemplaza los `<select>` nativos de Piso/Pared del ProjectSpatialStudio por
una paleta de ambient materials arrastrable al 3D, con highlight del mesh
objetivo. Es el "paint" de Promob, limitado a piso/muro (board materials queda
para después).

- `paintMaterial.ts` (new): tipos PaintSurface/PaintDrop + función pura
  `resolvePaintSurface` (testeable sin WebGL) + encode/decode del drag payload
  + `canApplyMaterial` (valida surfaceType floor↔wall).
- `MaterialPalette.tsx` (new): paleta separa floor/wall, drag HTML5 source con
  dataTransfer (PAINT_DRAG_MIME), thumbnail (textureUrl img o previewColor swatch),
  marca el material activo.
- `AmbientMeshes.tsx`: FloorAmbientMesh/WallAmbientMesh aceptan `paintHover` →
  overlay verde (#4ade80, opacity 0.3) cuando es el target. FloorAmbientMesh
  gana userData surface:'floor' para raycast.
- `FurnitureScene3D.tsx`: props onPaintDrop/onPaintHover/paintHoverSurface.
  SceneContent registra un resolver (useThree + raycaster) que el wrapper del
  canvas invoca en onDragOver/onDrop (HTML5). Lee dataTransfer, raycastea,
  resuelve surface y llama al callback con el drop completo.
- `ProjectSpatialStudio.tsx`: reemplaza selects por `<MaterialPalette>`,
  handlers handlePaintHover/handlePaintDrop (valida surfaceType, commitea
  floor/wallMaterialId).
- Tests: +28 (15 paintMaterial + 9 MaterialPalette + 2 AmbientMeshes constants
  + 3 Studio: floor drop, wall drop, mismatch ignorado).

### Decisión de testing
El drag HTML5 → raycast → drop NO es testeable en jsdom (no hay WebGL, el
raycast vive dentro del Canvas). El mock de FurnitureScene3D en el test del
Studio expone botones que invocan onPaintDrop con drops resueltos, simulando
lo que el canvas real haría. La función pura resolvePaintSurface se testea
aislada. Verificación visual del gesture completo queda como smoke manual en
browser (mismo patrón que el resto del 3D del repo).

### Verificación visual pendiente (browser smoke)
- Drag material de piso al canvas → highlight verde del piso → aplica textura.
- Drag material de muro al canvas → highlight verde del muro → aplica color.
- Drag material de piso sobre un muro → no aplica (surfaceType mismatch).
- Estos 3 casos requieren browser real (WebGL), no cubiertos por jsdom.

## Validación

- `pnpm --filter @muebles/ui test`: 662/662 ✓
- `pnpm typecheck`: 6 workspaces ✓
- `./init.sh`: verde completo ✓
