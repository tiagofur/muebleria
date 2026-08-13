# Sesión — F085 Export Optimizer, Persistencia y Trazabilidad de Agregados (#297, Fase 4)

- **Fecha:** 2026-08-11
- **Scope:** Implementación de F085 (Plan Maestro de Agregados, docs/agregados-subassemblies-plan.md, Issue #297)

## Hecho — F082 Motor Paramétrico de Agregados (#294, Fase 1)

- `ModuleAgregadoInstance` extendido en `packages/domain/src/types.ts` con `position`, `dimensions`, `layoutDirection`, `gapMm` y `optionOverrides`.
- `agregados.ts` implementa `calculateAgregadoSubspaceUnits(...)` para desglosar y apilar N unidades (vertical/horizontal/none) con separación `gapMm`.
- `bom.ts` evalúa fórmulas dentro del sub-espacio ($W_{\text{local}}, H_{\text{local}}, D_{\text{local}}$) y desplaza las coordenadas 3D de cada pieza producida.
- 402/402 tests en `@muebles/domain` pasando ✓. Commit `a0753ea`.

## Hecho — F083 UI de Agregados en Muebles (#295, Fase 2)

- Pestaña **Agregados** integrada en `StructureEditorForm.tsx` y `StructureDraft` (`packages/ui/src/structures`).
- Creado `StructureEditorAgregadosPanel.tsx` con selector del catálogo de agregados y formulario de parametrización ($N$, apilamiento, luz `gapMm`, posición $Z$, $W$, $H$, espejeado).
- 679/679 tests en `@muebles/ui` pasando ✓. Commit `d928f9d`.

## Hecho — F084 Jerarquía y Preview 3D de Agregados (#296, Fase 3)

- `structure3dPreview.ts` y `module3dPreview.ts` resuelven piezas de agregados en sus coordenadas $(X,Y,Z)$ calculadas en tiempo real.
- Pruebas unitarias de resolución 3D en `structure3dPreview.test.ts`. Commit `9b190b0`.

## En Curso — F085 Export Optimizer, Persistencia y Trazabilidad (#297, Fase 4)

1. Trazabilidad de agregados en despiece BOM y exportador de Excel (`packages/excel` / `Plantilla_Optimizer.xlsx`).
2. Persistencia en `packages/storage` y backend Go (migraciones SQL / modelos de agregados).
3. Verificación de tests end-to-end en todo el monorepo.

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

## Hecho — F070 Editor de Placement 3D de Herrajes con Gizmo (Fase B)

Implementado editor de placement 3D de herrajes con Gizmo interactivo R3F e integración en el inspector colapsable:

- `packages/domain/src/hardwarePlacement.ts`:
  - `snapValue(value, step)` para redondear milímetros y grados a la grilla de ajuste (default 5mm / 5°).
  - `convertWorldDeltaToFaceMm(delta, anchorFace)` para proyectar desplazamientos del puntero en 3D al plano 2D de la cara de la pieza.
  - Tests unitarios en `hardwarePlacementGizmo.test.ts` (458/458 domain tests pasando ✓).
- `packages/ui/src/preview3d/HardwarePlacementGizmo.tsx`:
  - Componente 3D (R3F) con handles de traslación X/Y y anillo de rotación Z.
  - Funciones puras de cálculo de posición y rotación (`computeNextPosition`, `computeNextRotation`).
  - Tests en `HardwarePlacementGizmo.test.tsx`.
- `packages/ui/src/preview3d/HardwareMesh.tsx`:
  - Highlighting de selección (`#3b82f6`) y soporte para handlers de selección/modificación.
- `packages/ui/src/preview3d/PartInspector.tsx`:
  - Sección **Herrajes** del inspector colapsable (F066) con inputs numéricos para editar X (mm), Y (mm) y Rot Z (°).
- `packages/ui/src/preview3d/FurnitureScene3D.tsx`:
  - Conexión de selección de herrajes y callbacks de modificación de placement en la escena.

## Hecho — F071 Etiquetas Zebra/ZPL para Impresoras Térmicas (Fase C)

Implementado generador ZPL II y modal de vista previa e impresión de etiquetas térmicas:

- `packages/domain/src/zplLabels.ts`:
  - `pieceToZpl` y `pieceBatchToZpl`: generador ZPL II puro con 3 presets de tamaño (`100x50` mm estándar, `100x150` mm grande, `50x25` mm compacta) y conmutación 203/300 DPI.
  - Sanitización de texto ZPL (`sanitizeZplText`) e integración con el QR payload nativo (`^BQ`).
  - Unit tests en `zplLabelExport.test.ts`.
- `packages/excel/src/zplLabelExport.ts`:
  - Re-exportación de helpers ZPL para compatibilidad del paquete de exportaciones.
- `packages/ui/src/production/ZplLabelPreviewModal.tsx` & `zplLabelPreviewModal.css`:
  - Modal interactivo con selector de preset, DPI (203/300), toggle de bordes, visual card mock, alternador de código ZPL raw, paginación de piezas y botones de descarga batch `.zpl` e impresión.
  - Unit tests en `ZplLabelPreviewModal.test.tsx`.
- `packages/ui/src/production/ProductionOrderOptimizationPanel.tsx`:
  - Botón **"Etiquetas ZPL (Zebra)"** al lado del export de Optimizer.

## Hecho — F072 PDF Preview de Corte Visual para Cortes Manuales (Fase C)

Implementado generador PDF vectorial de plano de corte visual para carpinterías sin CNC:

- `packages/excel/src/cutPreviewPdfExport.ts`:
  - `cutPreviewPdfExport` y `packCutRowsIntoSheets`: empaquetado LTR/TTB de piezas con margen de disco configurable (`sawKerfMm`, default 4mm) y paginación automática en múltiples tableros estándar (default 2440×1830 mm).
  - Título del proyecto, dimensiones del tablero, índice de pliego (`Tablero X de N`), rectángulos proporcionales etiquetados con código + dimensiones, y bloque de leyenda con área total en $m²$ y material dominante.
  - Pruebas unitarias en `cutPreviewPdfExport.test.ts` (48/48 excel tests pasando ✓).
- `packages/excel/src/index.ts`:
  - Re-exportación de `cutPreviewPdfExport`, `packCutRowsIntoSheets` y sus tipos.
- `packages/ui/src/production/ProductionOrderOptimizationPanel.tsx`:
  - Botón **"Preview Corte Visual (PDF)"** en la sección de plan de corte oficial de producción.
- `apps/web/src/exportProductionPack.ts`:
  - Integrado el archivo `preview_corte_visual_{baseName}.pdf` dentro del pack ZIP de producción.

## Hecho — F073 CSV de Plan de Corte Editable y Configurable (Fase C)

Implementado exportador de plano de corte en formato CSV configurable con presets para optimizadores de terceros:

- `packages/domain/src/cutListConfigurableCsv.ts`:
  - `cutListConfigurableCsvExport`: formateador puro de CSV con selección de delimitador (`;`, `,`, `\t`), toggle de encabezados y filtro por material.
  - Presets preconfigurados para optimizadores industriales: **Estándar**, **Lepton Optimizer**, **CorteCerto** y **OptiNest**.
- `packages/excel/src/cutListConfigurableCsvExport.ts` & `cutListConfigurableCsvExport.test.ts`:
  - Re-exportación para la capa de exportaciones y pruebas unitarias (56/56 excel tests pasando ✓).
- `packages/ui/src/production/CsvExportConfigModal.tsx` & `csvExportConfigModal.css`:
  - Modal interactivo para configurar delimitador, preset, material y visualización previa en tiempo real del archivo `.csv` antes de descargar.
  - Pruebas unitarias en `CsvExportConfigModal.test.tsx` (742/742 ui tests pasando ✓).
- `packages/ui/src/production/ProductionOrderOptimizationPanel.tsx`:
  - Botón **"CSV Configurable"** en la sección del plan de corte de producción.

## Hecho — F076 Onboarding + Datos Semilla Demo Comercial (Fase D)

Implementado sistema completo de onboarding interactivo y catálogo ampliado de demostración para talleres de Latinoamérica:

- `packages/domain/src/__fixtures__/cocinaLopezDemo.ts`:
  - Fixture `createCocinaLopezDemoProject()` con despiece y disposición espacial 3D de cocina en L completa (4 bajomesadas, 4 alacenas, isla central, torre despensa, zócalo) y ambientación de piso porcelanato y muros blanco marfil.
  - Catálogo ampliado LatAm (`seedCatalogExpandedLatAm`) con 17+ módulos paramétricos comunes en la región (esquineros L, cajoneras 3C, alacena campana, torre horno).
  - Pruebas unitarias en `cocinaLopezDemo.test.ts` (465/465 domain tests pasando ✓).
- `packages/storage/src/seed.ts`:
  - `createSeedWorkspace()` actualizado para incluir el proyecto de demostración "Cocina López" y el catálogo expandido LatAm.
  - Pruebas unitarias de almacenamiento en `seed.test.ts` y `workspace.test.ts` (78/78 storage tests pasando ✓).
- `packages/ui/src/onboarding/OnboardingTourModal.tsx` & `onboardingTourModal.css`:
  - Modal overlay interactivo de 3 pasos (1: Experiencia 3D Instantánea, 2: Catálogo de Ingeniería LatAm, 3: Exportación a Producción).
  - Control de avance, omitir, checkbox "No volver a mostrar en el inicio" persistido en `localStorage` (`muebles_has_seen_onboarding_v1`) y botón para cargar el demo 3D al finalizar.
  - Pruebas unitarias en `OnboardingTourModal.test.tsx` (748/748 ui tests pasando ✓).
- `packages/ui/src/settings/SettingsScreen.tsx`:
  - Sección **Ayuda & Tour** con botón *"Ver tour de bienvenida"* para re-activar el onboarding en cualquier momento.
- `apps/web/src/App.tsx`:
  - Integración en la shell principal con apertura automática en primer uso y manejo de la carga de la demo 3D.
  - Pruebas de integración en `App.test.ts` (232/232 web tests pasando ✓).

## Validación monorepo

- `pnpm --filter @muebles/domain test`: 465/465 ✓
- `pnpm --filter @muebles/storage test`: 78/78 ✓
- `pnpm --filter @muebles/excel test`: 60/60 ✓
- `pnpm --filter @muebles/ui test`: 748/748 ✓
- `pnpm --filter @muebles/web test`: 232/232 ✓
- `pnpm typecheck`: 6 workspaces ✓
- `./init.sh`: verde completo ✓





