# Review Completo — App Muebles

> Fecha: 29 de julio de 2026
> Contexto: Revisión integral de la app enfocada en 3D, proyectos, presentación a cliente y presupuestos.

---

## Resumen Ejecutivo

Se realizó una auditoría completa del sistema Muebles cubriendo 4 áreas principales:
1. **Visualización 3D** — Escenas R3F, presentaciones, capturas
2. **Gestión de Proyectos** — Editor de cotización, ítems, opciones
3. **Presentación a Cliente** — Modo fullscreen, links compartidos
4. **Presupuestos y Cotización** — Escenarios A/B, exports, cálculos

### Hallazgos Críticos

| # | Hallazgo | Área | Severidad | Issue |
|---|----------|------|-----------|-------|
| 1 | PNG capture roto — falta `preserveDrawingBuffer` | 3D | 🔴 Crítico | [#186](https://github.com/tiagofur/muebleria/issues/186) |
| 2 | Sin ErrorBoundary en Canvas R3F | 3D | 🔴 Crítico | [#187](https://github.com/tiagofur/muebleria/issues/187) |
| 3 | `ProjectDetailView` con 40+ props (prop drilling) | Proyectos | 🔴 Crítico | [#193](https://github.com/tiagofur/muebleria/issues/193) |
| 4 | Cero accesibilidad en viewer 3D | 3D | 🔴 Crítico | [#188](https://github.com/tiagofur/muebleria/issues/188) |
| 5 | Sin responsive en presentación | Presentación | 🔴 Crítico | [#191](https://github.com/tiagofur/muebleria/issues/191) |
| 6 | Colores hardcodeados bypassing design system | Presentación | 🟡 Alto | [#190](https://github.com/tiagofur/muebleria/issues/190) |
| 7 | Inline styles en `QuoteScenarioCompare` | Presupuestos | 🟡 Alto | [#194](https://github.com/tiagofur/muebleria/issues/194) |
| 8 | Errores silenciados en `scenarioCompare.ts` | Presupuestos | 🟡 Alto | [#195](https://github.com/tiagofur/muebleria/issues/195) |
| 9 | Sin loading states en cálculos de precio | Presupuestos | 🟡 Alto | [#196](https://github.com/tiagofur/muebleria/issues/196) |
| 10 | Share link frágil (origin + pathname) | Presentación | 🟡 Alto | — |

---

## 1. Visualización 3D

### Archivos Analizados
- `packages/ui/src/preview3d/FurnitureScene3D.tsx`
- `packages/ui/src/preview3d/ModuleScene3D.tsx`
- `packages/ui/src/preview3d/project3dPreview.ts`
- `packages/ui/src/preview3d/boardPartVisual.ts`
- `packages/ui/src/modules/module3dPreview.ts`
- `packages/ui/src/modules/module3dPreview.test.ts`
- `packages/ui/src/editor/BoardCanvas.tsx`
- `packages/ui/src/editor/isoProjection.ts`

### Estado Actual
- React Three Fiber (R3F) con `FurnitureScene3D` como componente genérico
- Vista explosionada con slider (factor 0–3x)
- Modos de color: por material / por función
- Cámaras: perspectiva y ortográfica
- Presets de vista: front, top, side, isometric
- Detección de WebGL con fallback

### Problemas Encontrados

#### P1: PNG Capture Roto (CRÍTICO)
**Archivo:** `FurnitureScene3D.tsx`
**Problema:** El `<Canvas>` de R3F no tiene `preserveDrawingBuffer: true`. Cuando `handleCapturePng` en `ProjectPresentationMode` intenta hacer `canvas.toDataURL('image/png')`, el buffer del canvas ya fue limpiado por el compositor WebGL.

**Evidencia:** El `try/catch` en `handleCapturePng` falla silenciosamente sin feedback al usuario.

**Fix:** Agregar `preserveDrawingBuffer: true` al objeto `gl`.

**Issue:** [#186](https://github.com/tiagofur/muebleria/issues/186)

#### P2: Sin ErrorBoundary (CRÍTICO)
**Archivo:** `FurnitureScene3D.tsx`
**Problema:** No hay `<ErrorBoundary>` alrededor del `<Canvas>`. Un error de renderizado en cualquier `BoardMesh` crashea toda la presentación sin posibilidad de recuperación.

**Impacto:** El usuario pierde toda la vista y debe recargar la página.

**Issue:** [#187](https://github.com/tiagofur/muebleria/issues/187)

#### P3: Cero Accesibilidad (CRÍTICO)
**Archivos:** `FurnitureScene3D.tsx`, `ProjectPresentationMode.tsx`
**Problemas:**
- No hay `aria-label` en los controles del viewer
- No hay navegación por teclado para orbitar/seleccionar
- No hay anuncios de screen reader para el estado de la escena
- Los botones de color mode no tienen `aria-pressed`
- El slider de explosión no tiene `aria-valuenow`/`aria-valuemin`/`aria-valuemax` explícitos

**Issue:** [#188](https://github.com/tiagofur/muebleria/issues/188)

#### P4: Sin Loading Skeleton
**Archivo:** `FurnitureScene3D.tsx`
**Problema:** Mientras WebGL inicializa, el usuario ve espacio vacío sin indicación de progreso.

**Issue:** [#189](https://github.com/tiagofur/muebleria/issues/189)

#### P5: Performance en Escenas Grandes
**Problema:** No hay implementación de LOD (Level of Detail) ni instanced rendering para proyectos con muchos módulos.

### Mejoras Recomendadas

| Prioridad | Mejora | Esfuerzo | Issue |
|-----------|--------|----------|-------|
| 🔴 P0 | `preserveDrawingBuffer: true` | 1 línea | [#186](https://github.com/tiagofur/muebleria/issues/186) |
| 🔴 P0 | ErrorBoundary alrededor de Canvas | ~30 líneas | [#187](https://github.com/tiagofur/muebleria/issues/187) |
| 🔴 P0 | ARIA labels + keyboard nav | ~100 líneas | [#188](https://github.com/tiagofur/muebleria/issues/188) |
| 🟡 P1 | Loading skeleton | ~20 líneas | [#189](https://github.com/tiagofur/muebleria/issues/189) |
| 🟡 P1 | Measurement tools | ~200 líneas | [#198](https://github.com/tiagofur/muebleria/issues/198) |
| 🟢 P2 | Export 3D (OBJ/GLTF) | ~300 líneas | [#199](https://github.com/tiagofur/muebleria/issues/199) |

---

## 2. Gestión de Proyectos

### Archivos Analizados
- `packages/ui/src/projects/ProjectsScreen.tsx`
- `packages/ui/src/projects/components/ProjectDetailView.tsx`
- `packages/ui/src/projects/components/ProjectsListView.tsx`
- `packages/ui/src/projects/components/ProjectMetaModal.tsx`
- `packages/ui/src/projects/projectHelpers.ts`
- `apps/web/src/stores/projectStore.ts`
- `packages/domain/src/engine.ts`
- `packages/domain/src/scenarioCompare.ts`

### Estado Actual
- Zustand stores: `projectStore`, `catalogStore`, `workspaceStore`, `uiStore`
- Project detail con chrome sticky (status + total + acciones)
- Kitchen layout panel con sistema de muros + placements
- Installation checklist
- Scenario comparison (A/B testing)
- Measure defaults por tipo de mueble

### Problemas Encontrados

#### P6: ProjectDetailView Prop Drilling (CRÍTICO)
**Archivo:** `ProjectDetailView.tsx`
**Problema:** El componente recibe **40+ props**. Esto es inmanejable y hace casi imposible agregar funcionalidad sin modificar la interfaz.

**Solución:** React Context o compound component pattern.

**Issue:** [#193](https://github.com/tiagofur/muebleria/issues/193)

#### P7: Inline Styles en QuoteScenarioCompare
**Archivo:** `QuoteScenarioCompare.tsx`
**Problema:** Estilos inline bypassing el design system.

**Solución:** Mover a clases CSS usando los tokens del design system.

**Issue:** [#194](https://github.com/tiagofur/muebleria/issues/194)

#### P8: Errores Silenciados
**Archivo:** `packages/domain/src/scenarioCompare.ts`
**Problema:** El catch en `compareRoleScenario` devuelve `{ ok: false, message }` pero pierde el stack trace original, dificultando debugging.

**Issue:** [#195](https://github.com/tiagofur/muebleria/issues/195)

### Mejoras Recomendadas

| Prioridad | Mejora | Esfuerzo | Issue |
|-----------|--------|----------|-------|
| 🔴 P0 | Refactorizar ProjectDetailView props | ~400 líneas | [#193](https://github.com/tiagofur/muebleria/issues/193) |
| 🟡 P1 | Mover inline styles a CSS | ~100 líneas | [#194](https://github.com/tiagofur/muebleria/issues/194) |
| 🟡 P1 | Project versioning / history | ~300 líneas | [#200](https://github.com/tiagofur/muebleria/issues/200) |

---

## 3. Presentación a Cliente

### Archivos Analizados
- `packages/ui/src/projects/components/ProjectPresentationMode.tsx`
- `packages/ui/src/projects/components/ProjectDetailView.tsx` (onOpenPresentation)
- `apps/web/src/exportCommercialQuotePdf.ts`
- `apps/web/src/exportCommercialQuote.ts`
- `apps/web/src/exportScenarioPdf.ts`

### Estado Actual
- Fullscreen overlay con lista comercial (sin costos)
- 3D viewer con vista explosionada
- Share link via clipboard
- PNG capture de vista 3D
- Escape para cerrar

### Problemas Encontrados

#### P9: Colores Hardcodeados (ALTO)
**Archivo:** `ProjectPresentationMode.tsx`
**Problema:** Colores bypassing design system.

**Issue:** [#190](https://github.com/tiagofur/muebleria/issues/190)

#### P10: Sin Responsive (ALTO)
**Archivo:** `ProjectPresentationMode.tsx`
**Problema:** Cero media queries. El layout de 2 columnas (lista + 3D) no se adapta a mobile. El link compartido es inútil en phones.

**Issue:** [#191](https://github.com/tiagofur/muebleria/issues/191)

#### P11: Share Link Frágil
**Archivo:** `ProjectPresentationMode.tsx`
**Problema:** URL construida con `origin + pathname` que puede ser frágil en deployments con base path.

### Mejoras Recomendadas

| Prioridad | Mejora | Esfuerzo | Issue |
|-----------|--------|----------|-------|
| 🔴 P0 | Reemplazar colores hardcodeados por tokens | ~15 reemplazos | [#190](https://github.com/tiagofur/muebleria/issues/190) |
| 🔴 P0 | Layout responsive con media queries | ~80 líneas | [#191](https://github.com/tiagofur/muebleria/issues/191) |
| 🟡 P1 | Slide/section navigation | ~200 líneas | [#201](https://github.com/tiagofur/muebleria/issues/201) |

---

## 4. Presupuestos y Cotización

### Archivos Analizados
- `packages/domain/src/scenarioCompare.ts`
- `packages/domain/src/scenarioCompare.test.ts`
- `packages/ui/src/projects/components/QuoteScenarioCompare.tsx`
- `apps/web/src/exportCommercialQuote.ts`
- `apps/web/src/exportCommercialQuotePdf.ts`
- `apps/web/src/exportScenarioPdf.ts`
- `packages/excel/src/commercialScenarioPdfExport.ts`
- `packages/excel/src/materialSummaryPdfExport.ts`

### Estado Actual
- Scenario comparison A/B con `compareRoleScenario`
- Export comercial: Excel (F030) y PDF (F045)
- Export Optimizer: cut-list para planta
- Export herrajes: lista de compras
- Price snapshots para proyectos cerrados
- Material summary: m² por material

### Problemas Encontrados

#### P13: Inline Styles en QuoteScenarioCompare (ALTO)
**Archivo:** `QuoteScenarioCompare.tsx`
**Problema:** Estilos inline extensos bypassing design system.

**Issue:** [#194](https://github.com/tiagofur/muebleria/issues/194)

#### P14: Sin Loading States
**Problema:** Los cálculos de precio (`calcProjectBreakdown`) son síncronos pero pueden ser lentos en proyectos grandes. No hay indicador de progreso.

**Issue:** [#196](https://github.com/tiagofur/muebleria/issues/196)

#### P15: Export PDF Sin Branding
**Archivo:** `exportCommercialQuotePdf.ts`
**Problema:** El PDF generado no tiene logo ni branding del taller. Es funcional pero no profesional.

**Issue:** [#197](https://github.com/tiagofur/muebleria/issues/197)

### Mejoras Recomendadas

| Prioridad | Mejora | Esfuerzo | Issue |
|-----------|--------|----------|-------|
| 🟡 P1 | Mover inline styles a CSS | ~100 líneas | [#194](https://github.com/tiagofur/muebleria/issues/194) |
| 🟡 P1 | Loading skeleton durante cálculos | ~30 líneas | [#196](https://github.com/tiagofur/muebleria/issues/196) |
| 🟡 P1 | PDF con branding del taller | ~200 líneas | [#197](https://github.com/tiagofur/muebleria/issues/197) |
| 🟢 P2 | Tiered pricing (volume discounts) | ~150 líneas | [#202](https://github.com/tiagofur/muebleria/issues/202) |

---

## 5. Problemas Transversales

### Accesibilidad
- **3D Viewer:** Cero keyboard nav, zero ARIA labels, zero screen reader support → [#188](https://github.com/tiagofur/muebleria/issues/188)
- **ProjectPresentationMode:** Controles sin labels accesibles → [#192](https://github.com/tiagofur/muebleria/issues/192)

### Error Handling
- **R3F Canvas:** Sin ErrorBoundary — crash total ante error de render → [#187](https://github.com/tiagofur/muebleria/issues/187)
- **scenarioCompare.ts:** Errores silenciados en catch blocks → [#195](https://github.com/tiagofur/muebleria/issues/195)
- **PNG capture:** Falla silenciosa sin feedback → [#186](https://github.com/tiagofur/muebleria/issues/186)

### Mobile / Responsive
- **ProjectPresentationMode:** Sin media queries → [#191](https://github.com/tiagofur/muebleria/issues/191)

### Design System
- **Colores hardcodeados:** `#b91c1c`, `#15803d`, `#cbd5e1` en presentación → [#190](https://github.com/tiagofur/muebleria/issues/190)
- **Inline styles:** `QuoteScenarioCompare.tsx` con ~20 estilos inline → [#194](https://github.com/tiagofur/muebleria/issues/194)

---

## Issues Creados en GitHub

### Grupo 1: 3D — Fixes Críticos
| Issue | Título | Labels |
|-------|--------|--------|
| [#186](https://github.com/tiagofur/muebleria/issues/186) | Agregar `preserveDrawingBuffer` al Canvas R3F | bug, critical, frontend |
| [#187](https://github.com/tiagofur/muebleria/issues/187) | Agregar ErrorBoundary alrededor de FurnitureScene3D | bug, critical, frontend |
| [#188](https://github.com/tiagofur/muebleria/issues/188) | Accesibilidad: keyboard nav + ARIA labels en viewer 3D | enhancement, critical, frontend |
| [#189](https://github.com/tiagofur/muebleria/issues/189) | Loading skeleton mientras WebGL inicializa | enhancement, high, frontend |

### Grupo 2: Presentación — Responsive + Design System
| Issue | Título | Labels |
|-------|--------|--------|
| [#190](https://github.com/tiagofur/muebleria/issues/190) | Reemplazar colores hardcodeados por design tokens | enhancement, high, frontend |
| [#191](https://github.com/tiagofur/muebleria/issues/191) | Layout responsive para ProjectPresentationMode | enhancement, high, frontend |
| [#192](https://github.com/tiagofur/muebleria/issues/192) | ARIA labels accesibles en controles de presentación | enhancement, high, frontend |

### Grupo 3: Proyectos — Refactorización
| Issue | Título | Labels |
|-------|--------|--------|
| [#193](https://github.com/tiagofur/muebleria/issues/193) | Refactorizar ProjectDetailView (reducir prop drilling) | enhancement, critical, frontend |
| [#194](https://github.com/tiagofur/muebleria/issues/194) | Mover inline styles de QuoteScenarioCompare a CSS | enhancement, high, frontend |
| [#195](https://github.com/tiagofur/muebleria/issues/195) | Corregir error handling en scenarioCompare.ts | bug, medium, domain |

### Grupo 4: Presupuestos — UX + Branding
| Issue | Título | Labels |
|-------|--------|--------|
| [#196](https://github.com/tiagofur/muebleria/issues/196) | Loading states durante cálculos de precio | enhancement, medium, frontend |
| [#197](https://github.com/tiagofur/muebleria/issues/197) | PDF con branding del taller | enhancement, medium, frontend |

### Grupo 5: Mejoras Futuras
| Issue | Título | Labels |
|-------|--------|--------|
| [#198](https://github.com/tiagofur/muebleria/issues/198) | Herramientas de medición en vista 3D | enhancement, medium, frontend |
| [#199](https://github.com/tiagofur/muebleria/issues/199) | Export de modelos 3D (OBJ, GLTF, STL) | enhancement, low, frontend |
| [#200](https://github.com/tiagofur/muebleria/issues/200) | Versioning / historial de proyectos | enhancement, medium, frontend |
| [#201](https://github.com/tiagofur/muebleria/issues/201) | Navegación por slides/secciones en presentación | enhancement, low, frontend |
| [#202](https://github.com/tiagofur/muebleria/issues/202) | Tiered pricing (descuentos por volumen) | enhancement, low, domain |
