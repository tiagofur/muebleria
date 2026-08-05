# Sesión actual — Muebles: slices 1–5 (auditoría perfecta)

- **Carpeta canónica:** `/Users/tiagofur/dev/carpinteria/muebles`
- **Branch:** `wip/jd-w3-lateral-rotation-fix`
- **Inicio:** 2026-08-05

## Slices (auditoría muebles) — TODOS ✅

| # | Slice | Estado |
|---|--------|--------|
| 1 | Chrome híbrido (Agregar + BoardEditor) | ✅ |
| 2 | BoardEditor draft-aware | ✅ |
| 3 | Structure overrides JSONB persist | ✅ |
| 4 | Inspector 3D click/lista | ✅ |
| 5 | UI overrides por instancia | ✅ |

### Slice 5 — detalle
- `InstanceOverridesEditor`: disclosure “Avanzado: fórmulas y rotación”
- Integrado en **módulo** y **estructura** (lista de instancias)
- Helpers: `patchInstanceOverrides`, `cleanInstanceOverrides`, summary
- `moduleCompositionKey` incluye fórmulas del **draft** (no boardOverrides)
- `BoardEditor` recibe `compositionKey` separado para no pelear con el drag

## Tests
moduleHelpers, InstanceOverridesEditor, ModulesScreen, StructuresScreen, typecheck ui+web

## Siguiente
**Commit + push** de slices 1–5 + Fase 1 del rediseño UI/UX INGENIERÍA.

## Convención veta piso/techo (2026-08-05)
- **Base / superior:** Largo = ancho del mueble (`PW…`, veta izq→der); Ancho = profundidad (`PD`).
- Pose default: `rotateY: 90`, `y: PD` (local box `[W,T,L]` → length en X, width en Z).
- Seeds plantilla actualizados (piso gab/caj, base alacena/despensa) + edges L↔W.
- **Datos ya guardados en DB** con L=PD siguen viejos hasta editarlos manualmente.

## Materiales en preview 3D (2026-08-05) ✅ slice
- `BoardMeshMaterial`: color sólido | veta procedural si `grain=1` | textura foto si `previewTextureUrl`.
- UV veta alineada al Largo (local Z del box); densidad `grainUvRepeat`.
- `materialTextureMap` cableado en cotización, módulo, estructura, componente.
- Materiales: checkbox “Usar foto como textura 3D”.
- Tests: boardPartVisual + grainTexture; `pnpm --filter @muebles/ui test` + typecheck OK.

## UX 3D: modo de pintado + selector de acabados (2026-08-05) ✅
- “Colores” → **Cómo se pinta** con labels claros + hint (no elige material).
- **Acabados de preview** en Module/Structure 3D: select por grupo board (INTERIOR/FRENTE…) que re-resuelve el BOM.
- Cotización 3D: hint de que los acabados vienen de las opciones de la línea.
- Helpers: `boardFinishPickerGroupsForModule`, override en `resolveModule3DPreview` / `resolveStructure3DPreview`.

## Vista del acabado (color / veta / textura) ✅
- Nuevo control **Vista del acabado** (visible solo si “Cómo se pinta” = material):
  - Solo color · Color + marca de veta · Textura (foto)
- Default: Color + marca de veta. Textura cae a veta/color si no hay foto.
- `MaterialSurfaceMode` + `resolveMaterialSurface` en boardPartVisual.

## Fix: 3 vistas se veían iguales (2026-08-05)
- Three no limpiaba el `map` al cambiar modo → remount con `key`.
- Veta se tintaba dos veces (color × map) → color blanco cuando hay map.
- Veta procedural con más contraste; modo grain siempre dibuja rayas.
- Texturas: fallback a `imageUrl` + `resolveMediaUrl` (token) para TextureLoader.

## Escala de textura en material (mm X/Y) ✅
- Campos `previewTextureTileWidthMm` (X ancho) y `previewTextureTileLengthMm` (Y largo/veta).
- UV = tamaño_pieza / tamaño_muestra. Default 280 mm si vacío.
- Migración `000031_material_texture_tile`; form en Materiales; 3D usa tile del material.

## Contornos 3D ✅
- Check **Contornos** (default ON): Edges en cada pieza sin transparencia.
- Separado de **Rayos X**. En Furniture3DViewer, cotización, presentación, editor de componente.

## Rediseño UI/UX — INGENIERÍA
- **Fase 1 completada:** Reordenamiento semántico del menú lateral en `AppShell.tsx`:
  `Muebles` → `Estructuras` → `Componentes` → `Grupos` → `Materiales` → `Cantos` → `Herrajes`
- **Fase 2 completada:** Estandarización de vistas en Catálogos Base (Materiales, Cantos, Herrajes):
  - Añadidos estilos CSS adaptativos en `catalogs.css` para el panel de detalle en vista lateral (`.catalog-drawer` con ancho `100vw` en móviles/pantallas chicas `<768px` y `26rem` en escritorios).
  - Estilo de tarjetas de catálogo en grilla adaptativa (`.catalog-grid`).
  - Sincronización de fixture de exportación Optimizer (`modGab01CutRows.json`) con las rotaciones de veta actualizadas.
- **Fase 3 completada:** Reglas y Sub-ensambles (Grupos de Opciones, Componentes, Estructuras):
  - Añadidos badges de conteo numérico `(N)` en pestañas de editores (`StructureEditorForm.tsx`, `ComponentEditorForm.tsx`) para prescindir de inspecciones a ciegas.
  - Estandarización de pestañas del editor y controles de previsualización 3D.
- Verificación completa con `./init.sh` (todos los tests de la app pasan 100%).

## Judgment Day UI/UX + Fase 0 fundación (2026-08-05)

### JD Round 1 (general UI/UX)
- Dual blind judges → confirmed CRITICALs: multi-primary cotización, progressive disclosure, botones fantasma, Materials SM sprawl, Structure dead tokens/inline tabs, catalog-screen headers.
- Plan pantalla por pantalla (Fases 0–8). **No fix de flujos aún.**

### Fase 0 ✅ — Fundación UI (botones / headers / tokens)
- **Botones:** `btn--secondary` / `btn--outline` / `btn--sm` → canónicos (`.btn` base, `.btn--small`).
- **Headers:** Estructuras + Componentes migrados a `catalog-page__*` + `page-header__subtitle`.
- **Tokens:** usos de `--primary/--border/--bg-card/--text` → canónicos; safety aliases en `tokens.css`.
- **Tabs Structure:** sin inline styles; reutiliza `.module-editor__tabs`.
- **Fantasmas:** `mr-1`, `mb-4`, `font-mono` class, `badge--inactive` → patrones reales.
- **3D camera buttons:** `btn btn--small` sin padding hardcodeado.
- Tests: `pnpm --filter @muebles/ui test` → 439 passed.

### Fase 1 ✅ — Cotización detail (chrome + progressive disclosure)
- **Un solo primary por estado:** draft→Enviar · quoted→Aceptar · accepted→Marcar producción · produced→Export Optimizer.
- Export Optimizer siempre visible (primary solo si es la acción de etapa); Pack y otros exports en menú **Más**.
- Meta (Duplicar / Plantilla / Reabrir) en **Más**; Editar + Presentar + Eliminar siguen en chrome.
- Body: opciones → medidas → **ítems** primero; Plan cocina / Escenarios / Checklist detrás de tabs (cerrados por defecto).
- Totales un poco más anchos (`260–320px`).
- Tests: 440 passed (incluye single-primary + tools collapsed).

### Fase 2 ✅ — Cotizaciones lista (chips + empty state)
- Chips de estado: Todos / Borrador / Cotizado / Aceptado / En producción (`filterProjectsList` + `StatusChips` genérico).
- EmptyState: CTA secundaria “Crear desde plantilla” dentro del componente (sin dual-primary / inline styles).
- Limpiar filtros resetea search + status.
- Tests: 443 passed.

### Fase 3 ✅ — Materiales form (agrupado + progressive disclosure)
- Modal **MD** (antes SM) con secciones: **Identidad** · **Tablero y precio** · **Vista 3D y textura** (colapsable).
- 3D (color, textura foto, tile mm) cerrado en create; se abre en edit si ya hay config.
- Crear cintilla como modal hermano (no anidado dentro del form).
- Título de pantalla: **Materiales** + subtítulo “Tableros…”.
- Tests: 445+ passed.

### Fase 4 ✅ — Muebles editor full-page + tabs agrupados
- **Siempre workspace full-page** (`inlineEditMode = modalOpen`): chrome sticky + aside de costo; sin Modal LG.
- Tabs primarios: **General · Composición · Costo**; subtabs en Composición: Estructura · Componentes · Medidas · Herrajes.
- Board hybrid sigue en Componentes; badge de conteos en Composición.
- Tests ModulesScreen actualizados a `module-editor-page`.

### Fase 5 ✅ — Estructuras + Componentes (mismo patrón Muebles)
- **card-detalle**: click en card → detalle (chrome + acciones); sin expand in-card.
- **Editor full-page** (`inlineEditMode = modalOpen`) + Guardar/Cancelar en workspace chrome.
- Listas simplificadas (`StructureListView` / `ComponentListView`); footers de form fuera del modal.
- Tabs estructura: labels cortos (General · Presets · Componentes · Vista 3D).
- Tests UI: 445 passed.

### Fase 6 ✅ — Shell IA (INGENIERÍA agrupada)
- Orden canónico design.md: Muebles → Estructuras → Componentes → Materiales → Cantos → Herrajes → Grupos.
- Subgrupos visuales: **Composición** (muebles/estructuras/componentes) y **Catálogos** (materiales/cantos/herrajes/grupos).
- Items anidados con indent; command palette keywords incluyen subgrupo.

### Fase 7 ✅ — Chrome 3D compartido
- `furniture3dViewer.css`: toolbar primaria (proyección · contornos · cámara) + disclosure **Acabados y vista avanzada** (Rayos X · cómo se pinta · vista acabado).
- Sin inline styles en el chrome del viewer; testids preservados.
- Modales module/structure/project usan `viewer-3d-chrome` / `viewer-3d-modal-body`.

### Fase 8 ✅ — Paridad residual (catálogos / clientes / ajustes / cola)
- Títulos = nav: **Clientes**, **Grupos** (+ subtítulos); Cantos/Herrajes con lead.
- Cola: título sigue el tab (**Para fabricar** / **Ya en planta**).
- Ajustes: secciones Cotización · Identidad · Permisos; feedback sin emoji.
- Tests: 446 passed.

### JD R2 residuals ✅
- Cola: 1 primary (Pack > Exportar corte).
- Cotización: Export solo en chrome si plant-ready; si no → Más (disabled).
- Tools: `role=group` + `aria-pressed` (no tablist inválido).
- Módulo: tab ids = panel labels; Costo tab oculto si hay aside sticky.
- BoardFinishPickers: CSS + tokens canónicos.
- C1: Estructuras/Componentes list title `h2` (no dual h1).
- C2: Structure editor panels sin layout inline (CSS en structures.css).



