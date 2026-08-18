# Judgment Day — La App Completa (Estado, UX, Diseño, Bugs, Roadmap)

**Fecha:** 2026-08-13
**Scope:** Toda la app (apps/web + packages/ui + packages/domain + backend-go).
**Objetivo:** Crítica honesta del estado actual + roadmap de mejoras UX/diseño/bugs para llevar la app de "funciona" a "APP" (limpia, amigable, sin abrumar).

---

## 0. Veredicto ejecutivo

La app está **sólida en el 80%**: catálogos, BOM, costos, backend Go/Postgres, módulo Producción, agregados/herrajes — todo funciona y está testeado. El design system está **bien pensado y mayoritariamente respetado**.

Pero hay **3 focos de fricción** que hacen que se sienta "desordenada" (la queja del usuario):

1. **UX: tabs anidados en el editor de Muebles** — el único caso real de pestañas-dentro-de-pestañas. Es el origen directo de la sensación de desorden.
2. **UX: progressive disclosure inconsistente** — Materials colapsa "Vista 3D" (bien), Hardware no (mal), Module General muestra todo siempre (mal). Cada entidad sigue su propio criterio.
3. **Visual: el editor 3D/espacial vive con un dark theme paralelo** (hex hardcoded, sombras y spacing fuera de tokens) que se ve "de otra app".

Arreglar esos 3 focos + algunos detalles de pulido **transforma la percepción** sin tocar arquitectura. Estimado: 2-3 días de refactor presentacional (sin tocar lógica de dominio).

---

## 1. Estado global

| Área | Madurez | Notas |
|------|---------|-------|
| Catálogos (materiales, cantos, herrajes, componentes, agregados) | ✅ Maduro | CRUD completo, persistencia, validación. |
| BOM + costos + cotización | ✅ Maduro | resolveBom, pricing, scenarios, option groups. |
| Backend Go + Postgres | ✅ Maduro | Auth, RBAC, ownership, 40 migraciones, paridad alta con TS. |
| Módulo Producción | ✅ Maduro | Fases 0-4 cerradas (META #214). |
| Agregados + herrajes 3D | ✅ Recién cerrado | Dominio + UI + 3D + costo = posiciones (sesión ago 11-13). |
| UX 3D / Proyectar | 🟡 Verde | F065-070 (drag-drop, inspector, herrajes 3D, gizmo). |
| Exports avanzados | 🟡 Verde | F071-074 (Zebra, PDF corte, CSV, perforaciones). |
| Empaquetado/comercial | 🟡 Verde | F075-077 (Electron, demo, pricing). |
| Congelados (demanda) | ⏸️ | SketchUp, Blender, perforaciones CNC. |

**Feature tracker:** 81 features totales, **64 done (79%)**, 17 pending (21%). Drift: `feature_list.json` desactualizado (F066/F067/F085 marcados pending pero hechos).

---

## 2. UX / Estructura — dolor points priorizados

### 2.1 [ALTO] Tabs anidados en ModuleEditorForm — el dolor #1

**Dónde:** `packages/ui/src/modules/components/ModuleEditorForm.tsx:230-363` + `moduleEditorTabs.ts:7-41`.

**El problema:** 3 niveles visuales de tablist — primary tabs (General / Composición / Costo) +, cuando "Composición" está activo, una SEGUNDA fila de sub-tabs (Estructura / Componentes / Agregados / Medidas / Herrajes). El usuario pierde referencia de dónde está.

**Es el ÚNICO caso real** de tabs-dentro-de-tabs. Structure/Component/Agregado editors son planos (4 tabs cada uno, limpios).

**Solución:** aplanar a una sola tablist (como Structure/Component), o promover Estructura+Componentes a primarios y mover Medidas/Herrajes/Agregados a un disclosure "Avanzado".

### 2.2 [ALTO] Progressive disclosure inconsistente

| Entidad | "Vista 3D" / avanzado | Estado |
|---------|----------------------|--------|
| Materials | ✅ Colapsa (disclosure) | **Modelo a copiar** |
| Component (Geometría) | ✅ Colapsa (advancedSummary) | Bueno |
| Hardware | ❌ Siempre visible (forma/acabado/color) | Inconsistente |
| Module General | ❌ ~12 campos siempre visibles | Inconsistente |

**Solución:** copiar el patrón de Materials (`MaterialsCatalog.tsx:1015`) en Hardware (`HardwareCatalog.tsx:585`) y Module General.

### 2.3 [ALTO] ModuleEditorGeneralPanel — demasiados campos siempre visibles

**Dónde:** `modules/components/ModuleEditorGeneralPanel.tsx:46-277`. ~10-12 campos: código, nombre, MO, foto, tipo, base (zoclo/patas), altura B, **cascada categoría 3 niveles** (L1/L2/L3 siempre desplegada), notas.

**Solución:** colapsar L2/L3 de categoría (mostrar solo si L1 tiene hijos) + colapsar "Base/clearance" en un disclosure.

### 2.4 [MEDIO] ProjectDetailView — chrome abrumador

**Dónde:** `projects/components/ProjectDetailView.tsx:534-650`. 5-7 botones en el chrome (Presentar, Proyectar, Editar, Más, exports, status).

**Solución:** mover secundarios (Proyectar, Presentar, exports) al DropdownMenu "Más"; dejar solo el primary de status.

### 2.5 [MEDIO] ProductionOrderHub — 8 tabs en una fila

**Dónde:** `production/ProductionOrderHub.tsx:401-419`. Resumen/Módulos/Piso/Despiece/Herrajes/Vistas/Optimización/Documentos.

**Solución:** agrupar en 3 categorías (Fábrica / Corte / Outputs) o mover Documentos a un botón "Exportar".

### 2.6 [MEDIO] Agregados no enruta el editor

**Dónde:** `apps/web/src/App.tsx:2263-2277`. A diferencia de Modules/Structures/Components (que exponen `/section/:id/edit`), Agregados vive solo en estado local. Rompe back/forward del navegador.

### 2.7 Inconsistencias menores (BAJO)

- Label primer tab: Agregado usa "General & Dimensiones" (spanglish); demás usan "General".
- Breakpoints CSS mezclados: 639/640, 719/720, 899/900 entre archivos.
- ProjectItemsSection: option-choices por item siempre visibles (pared de selects con muchos items).

---

## 3. Design system — violaciones priorizadas

**Veredicto:** el design system está bien pensado. Las violaciones son **concentradas en 2 zonas** (3D espacial + features recientes), no sistémicas.

### 3.1 [P0] Dark theme paralelo del Spatial Studio

**Dónde:** `projects/components/projectSpatialStudio.css:418,447,461,478` + `preview3d/moduleScene3d.css:143-153`.

Hex hardcoded (`#1a1c1e`, `#0f1216`, `#f59e0b`), sombras y spacing fuera de tokens. Es la **única superficie oscura** de la app — se ve "de otra familia".

**Solución:** definir tokens `--surface-3d-*` / `--text-3d-*` en tokens.css y reemplazar hex por `var()`. O alinear a surfaces claras.

### 3.2 [P1] Estilos inline en features recientes

- `KitchenPlanPanel.tsx`: 16 inline styles con rem/px literales.
- `ProjectSpatialStudio.tsx`: 9 inline (mezcla px + tokens).
- `ProjectTotalsAside.tsx`: 7, `ModuleMeasureSection.tsx`: 6.

**Solución:** migrar a clases BEM + tokens. Crear CSS co-localizado.

### 3.3 [P1] Gaps off-scale

`projects.css:18` usa `gap: 0.65rem` (10.4px, fuera de la escala de 4px). Varios `gap: 2px/3px/5px` en projectSpatialStudio.css.

### 3.4 [P2] Loading states faltantes

**10 screens sin loading visible:** Customers, Settings, OptionGroups, Components, Agregados, StructureListView, ProjectsListView, ComponentListView, AgregadoListView, ModuleListView. Sólo Projects/Dashboard/Users/Modules usan PageLoading. Hoy cargan síncrono (seed local) pero al pasar a API se verán rotos.

### 3.5 Conteo global

- 10 hex reales sin `var()` (el resto son fallbacks tolerables).
- 117 px sueltos (mayoría `1px` borders legítimos, pero también gaps off-scale).
- 72 inline styles en TSX (deberían ser 0).
- Iconografía: 100% Lucide, cero emojis/otras libs. ✅
- Modal sizing: 100% con size explícito. ✅
- EmptyState: cobertura amplia. ✅

---

## 4. Bugs / robustez

### 4.1 Agregados (del JD 2026-08-11, frescos)

- **R-1 🔴**: `duplicateModule` pierde agregados (`duplicate.ts:93-125`).
- **R-2 🔴**: snapshot de cotización ignora agregados (`versioning.ts`) — cotización cerrada se re-resuelve con estructura viva.
- **R-3 🟠**: validación no cubre agregados; estructura solo-con-agregados se rechaza.
- **R-5 🟡**: `agregadoId` inexistente → BOM vacío silencioso.
- **R-11 🟠**: sin tests end-to-end de costo/herrajes con agregados.

### 4.2 Históricos

- **BoardEditor no persiste** (JD 2026-08-04 Gap #1 🔴): poses se descartan al desmontar.
- **Integridad referencial**: desactivar componente/material deja referencias rotas sin badge.
- **Drift tracking**: `feature_list.json` desincronizado con `current.md`.

### 4.3 Paridad TS↔Go

Riesgo residual de BOM distinto cliente vs servidor en fórmulas espaciales/compuestas (overrides, agregados recientes migraciones 000038-000040).

---

## 5. Roadmap pendiente (top por impacto)

### Cadena comercial (llegar a vendible)
1. **F075** — Electron empaquetado + firma Windows + auto-update.
2. **F076** — Onboarding + demo comercial ("Cocina López").
3. **F077** — Pricing tiers + landing + script de venta.

### Cadena 3D (se sienta como Promob)
4. **F068** — Geometrías 3D de herrajes (hecho parcial: bisagra/corredera/riel/pata + jaladeras).
5. **F069** — Variantes de acabado (hecho parcial: presets cromado/negro/bronce).
6. **F070** — Editor de placement 3D con gizmo (precursor: editor tabular hecho).

### Exports de producción
7. **F071** — Etiquetas Zebra/ZPL.
8. **F074** — Perforaciones como datos estructurados (CSV + ZPL).
9. **F072/F073** — PDF corte visual + CSV plan configurable.

### Congelados (demanda real)
- F078 SketchUp, F079 Blender, F080 capas acabado, F081 perforaciones CNC.

---

## 6. Plan de acción recomendado

### Fase 1 — UX rápido (1-2 días, refactor presentacional, sin tocar dominio)
Mayor impacto en la queja "desordenado":

1. **Aplanar ModuleEditorForm** (sacar sub-tabs, una sola tablist).
2. **Colapsar HardwareCatalog "Vista 3D"** (copiar Materials).
3. **Colapsar Module General** (cascada categoría L2/L3 + base/clearance).
4. **Aligerar ProjectDetailView chrome** (mover botones a "Más").
5. **Label Agregado** "General & Dimensiones" → "General".

### Fase 2 — Limpieza visual (1-2 días)
1. **Tokens para dark theme 3D** (eliminar hex hardcoded).
2. **Migrar inline styles a BEM** (KitchenPlanPanel, ProjectTotalsAside, etc.).
3. **Corregir gaps off-scale** (projects.css, projectSpatialStudio.css).
4. **Loading states** en 10 screens.

### Fase 3 — Robustez (según prioridad)
1. Cerrar **R-1/R-2/R-3** de agregados (silenciosos pero peligrosos).
2. Reconciliar drift `feature_list.json`.
3. BoardEditor persistencia (si se retoma board-first).

### Fase 4 — Comercial/3D (roadmap de producto)
1. F075 Electron → F076/F077 demo/pricing.
2. F070 gizmo 3D → F071/F074 exports.

---

## 7. Archivos clave (referencia)

- Tabs anidados: `packages/ui/src/modules/components/ModuleEditorForm.tsx`, `moduleEditorTabs.ts`.
- Progressive disclosure modelos: `packages/ui/src/catalogs/MaterialsCatalog.tsx:1015` (bueno), `HardwareCatalog.tsx:585` (malo).
- Dark theme 3D: `packages/ui/src/projects/components/projectSpatialStudio.css`, `packages/ui/src/preview3d/moduleScene3d.css`.
- Bugs agregados: `packages/domain/src/duplicate.ts`, `packages/domain/src/structures/versioning.ts`, `packages/domain/src/engine/validate.ts`.
- Roadmap: `feature_list.json`, `docs/app-excellence.md`, `progress/current.md`.
