# Fases de implementación

**Fecha:** 2026-08-17  
**Estado:** Plan aprobado

---

## Estado de implementación (2026-08-17)

| Fase | Estado | Notas |
|------|--------|-------|
| 1 — Fábrica | ✅ Done | `FabricScreen` con tabs por sector (`7f11e7a`) |
| 2a — Ingeniería | ✅ Done | Landing + workspace 8 tabs; Hub recortado a 6 tabs (`7f11e7a`, `2211e2c`) |
| 2b — Dashboard Ventas | ✅ Done | `SalesDashboard` (`7f11e7a`) |
| 3 — Compras/Almacén | ✅ Done | Picking + persistencia (migración 000054) |
| 3b — Stock real | ✅ Done | Ledger inmutable + panel de stock (000055/000056, doc `06-stock-almacen.md`) |
| 3c — Órdenes de compra | ✅ Done | POs + proveedores + costo/valor (000057) |
| 4 — Dashboards refinados | ✅ Done | Ver abajo |
| 5 — Polish y optimización | ✅ Done | Ver abajo |

**Fase 4 — qué se hizo:**
- 4.1 Toggle **[Cola]/[Métricas]** en `FabricScreen` para admin/gerente_produccion
  (tabla por sector: cola, operarios, hechos hoy, tiempo promedio ponderado;
  datos de `getProductionDashboard`, fetch al abrir la pantalla).
- 4.2 `SalesDashboard`: gráfico **Actividad por mes** (últimos 6 meses, creadas
  vs ganadas por `priceSnapshot.capturedAt`; barras CSS, sigue el filtro de
  vendedor; se oculta si no hay actividad en la ventana).
- 4.3 Ingeniería: fallback de proyecto desconocido usa el `EmptyState` compartido.
- 4.4 `roleCanAccessFabricNav`: admin y gerente_produccion ganan el nav Fábrica
  (tabs completas + toggle; los operadores sector-scoped no cambian).
- 4.5 **ProductionOrderHub NO se elimina**: conserva piso/despacho/etiquetas/
  herrajes/documentos y es el workspace por obra para 5 roles. Solo se quitaría
  si esas tabs migran (no planificado); los tabs técnicos ya viven en Ingeniería.

**Fase 5 — qué se hizo (time-boxed):**
- 5.1 Responsive: header de Fábrica apila y su tabla de métricas scrollea
  (≤720px); gráfico mensual de Ventas scrollea en vez de comprimirse (≤600px);
  cards de Ingeniería envuelven meta/fecha (≤640px). Purchasing ya estaba
  cubierto (stats auto-fit + tabla de stock con wrapper).
- 5.2 Teclado: hook compartido `useRovingTabList` (flechas/Home/End + roving
  tabindex, el patrón de los editores) aplicado a los tablists de Fábrica,
  Ingeniería y Compras (principal + sub-tabs Stock/Órdenes).
- 5.3 Loading: cubierto por el gate full-page del workspace + primitivas
  existentes (`PageLoading`, `ListSkeleton`); las pantallas no muestran datos
  faltantes post-mount que justifiquen skeletons decorativos — no se agregaron.
- 5.4 Error boundaries: `ScreenBoundary` (preset del `ErrorBoundary` común)
  envuelve las 5 pantallas en el shell — un crash de pantalla muestra fallback
  con Reintentar/Ir al inicio y la nav sigue viva, en vez de tumbar toda la app.
- 5.5 Performance: se intentó `lazy()` de `FurnitureScene3D` en
  `ProductionOrderViewsPanel`, pero el build mostró que NO separa el chunk:
  el barrel de `@granete/ui` re-exporta preview3d y ~8 modals/pantallas lo
  importan estático → three.js queda eager igual. Revertido; quedó la
  extracción de `canUseWebGL` a `preview3d/webglSupport.ts` (chequeo de WebGL
  sin arrastrar three) y el import directo del panel a FurnitureScene3D
  (evita el barrel). **Split real de three.js = follow-up**: sacar los
  componentes 3D del barrel raíz + lazy en cada modal (Structure3DModal,
  Project3DModal, Module3DModal, Agregado3DModal, Furniture3DViewer...).
  Sin `React.memo` en pantallas: reciben callbacks inline del shell y no
  ganaría nada sin estabilizarlos (time-box honesto).

---

## Overview

5 phases, ordered by priority and dependency. Each phase produces a working screen.

```
Fase 1: Fábrica (urgente — fix actual)
    ↓
Fase 2: Ingeniería + Dashboard Ventas (paralelo)
    ↓
Fase 3: Compras/Almacén
    ↓
Fase 4: Dashboards refinados
    ↓
Fase 5: Polish y optimización
```

---

## Phase 1: Fábrica (reemplaza Mi Estación)

**Priority:** URGENTE  
**Effort:** 1-2 weeks  
**Depends on:** Nothing (can start now)

### Goal

Replace the broken "Mi Estación" with a proper tabbed "Fábrica" screen. Fix the role↔sector binding (already done in previous session).

### Tasks

| # | Task | Files | Notes |
|---|------|-------|-------|
| 1.1 | Rename `StationQueueScreen` → `FabricScreen` | `StationQueueScreen.tsx` | Keep all existing logic |
| 1.2 | Add tab navigation (horizontal tabs) | `FabricScreen.tsx` | CSS tabs, one sector per tab |
| 1.3 | Add Despacho tab | `FabricScreen.tsx` | Move from `ProductionOrderDispatchPanel` |
| 1.4 | Add Instalación tab | `FabricScreen.tsx` | New tab for `installation` sector |
| 1.5 | Update nav shell | `AppShell.tsx` | Replace "Mi Estación" with "Fábrica" |
| 1.6 | Update `navIdsForRole` | `rbac.ts` | Add `fabric` nav id |
| 1.7 | Update CSS | `station.css` → `fabric.css` | Rename class prefix |
| 1.8 | Update tests | `StationQueueScreen.test.tsx` | Rename + add tab tests |

### Files affected

- `packages/ui/src/production/StationQueueScreen.tsx` → rename to `FabricScreen.tsx`
- `packages/ui/src/production/station.css` → rename to `fabric.css`
- `packages/ui/src/production/StationQueueScreen.test.tsx` → rename + update
- `packages/ui/src/shell/AppShell.tsx` — nav item
- `packages/domain/src/rbac.ts` — `navIdsForRole`

### Verification

- [ ] Tab navigation works (click tab → shows sector queue)
- [ ] Operator with 1 sector sees 1 tab
- [ ] Operator with 3 sectors sees 3 tabs
- [ ] Gerente sees all tabs
- [ ] Advance button works (calls `onAdvance`)
- [ ] Despacho tab shows loaded items
- [ ] Instalación tab shows loaded items
- [ ] Empty state shows per tab
- [ ] Tests pass

---

## Phase 2a: Ingeniería

**Priority:** ALTA  
**Effort:** 2-3 weeks  
**Depends on:** Phase 1 (uses same project data)

### Goal

Separate engineering documentation from the production workspace. Create a dedicated screen with a project landing list (with audit trail) and a tabbed workspace per project.

### Tasks

| # | Task | Files | Notes |
|---|------|-------|-------|
| 2a.1 | Create `EngineeringScreen.tsx` | Nuevo | Pantalla principal (landing de proyectos) |
| 2a.2 | Create `EngineeringWorkspace.tsx` | Nuevo | Workspace tabbed para un proyecto |
| 2a.3 | Add `EngineeringLog` domain type | `packages/domain/src/engineering.ts` | `startedBy/At`, `generatedBy/At`, `sentToProductionBy/At`, `revision` |
| 2a.4 | Add `engineeringLog` to project storage | `packages/storage` | Nuevo campo en proyecto persistido |
| 2a.5 | Landing: project list with eng status | `EngineeringScreen.tsx` | Estados: Pendiente / En proceso / Documentado |
| 2a.6 | Landing: "Iniciar ingeniería" action | `EngineeringScreen.tsx` | Registra `startedBy` + `startedAt` |
| 2a.7 | Move Resumen tab | `ProductionOrderHub.tsx` | Extract resumen section; tableros en planchas (no m²) |
| 2a.8 | Move Módulos tab | `ProductionOrderHub.tsx` | Extract modules panel; mantener filtro ambiente |
| 2a.9 | Move Despiece tab | `ProductionOrderDespiecePanel.tsx` | Agregar botón `[Imprimir A4]` |
| 2a.10 | Move Vistas tab | `ProductionOrderViewsPanel.tsx` | Move component |
| 2a.11 | Move Optimización tab | `ProductionOrderOptimizationPanel.tsx` | Tab principal del ingeniero |
| 2a.12 | Move Documentos tab | `ProductionOrderDocumentsPanel.tsx` | Etiquetas con `[Imprimir]` + `[PDF]`; Despiece A4 |
| 2a.13 | Move Etiquetas (generation) | `ProductionOrderLabelsPanel.tsx` | Mover a Documentos; PDF con tamaño de etiqueta correcto |
| 2a.14 | Move Herrajes (generation) | `ProductionOrderHardwarePanel.tsx` | Mover a Documentos |
| 2a.15 | "Marcar en producción" registra log | `EngineeringWorkspace.tsx` | Guarda `sentToProductionBy` + `sentToProductionAt` (con hora); sube `revision` |
| 2a.16 | Update nav shell | `AppShell.tsx` | "Ingeniería" nav item → landing screen |
| 2a.17 | Add RBAC functions | `rbac.ts` | `roleCanAccessEngineeringNav` |
| 2a.18 | Clean up ProductionOrderHub | `ProductionOrderHub.tsx` | Remove moved tabs |
| 2a.19 | Update tests | Various | Landing + workspace + log tests |

### Files affected

- `packages/domain/src/engineering.ts` — nuevo (`EngineeringLog` type + helpers)
- `packages/storage/src/engineeringLog.ts` — nuevo (persist/load log por proyecto)
- `packages/ui/src/engineering/EngineeringScreen.tsx` — nuevo (landing)
- `packages/ui/src/engineering/EngineeringWorkspace.tsx` — nuevo (workspace tabs)
- `packages/ui/src/engineering/engineering.css` — nuevo
- `packages/ui/src/production/ProductionOrderHub.tsx` — quitar tabs movidos
- `packages/ui/src/production/ProductionOrderDespiecePanel.tsx` — mover + A4 print
- `packages/ui/src/production/ProductionOrderViewsPanel.tsx` — mover
- `packages/ui/src/production/ProductionOrderOptimizationPanel.tsx` — mover
- `packages/ui/src/production/ProductionOrderDocumentsPanel.tsx` — mover + etiquetas print
- `packages/ui/src/production/ProductionOrderLabelsPanel.tsx` — mover a Documentos
- `packages/ui/src/production/ProductionOrderHardwarePanel.tsx` — mover a Documentos
- `packages/ui/src/shell/AppShell.tsx` — nav item
- `packages/domain/src/rbac.ts` — RBAC

### Verification

- [ ] Landing muestra lista de proyectos con estado de ingeniería
- [ ] "Iniciar ingeniería" registra `startedBy` + `startedAt`
- [ ] Al abrir workspace se ve el proyecto correcto
- [ ] Los 6 tabs renderizan correctamente: Resumen, Módulos, Despiece, Vistas, Optimización, Documentos
- [ ] Resumen muestra tableros en **planchas** (no m²)
- [ ] Resumen incluye herrajes en la lista de materiales
- [ ] Módulos muestra tabla con filtro por ambiente
- [ ] Despiece tiene botón `[Imprimir A4]`
- [ ] Optimización genera el Optimizer (Excel)
- [ ] Documentos: etiquetas tienen `[Imprimir]` + `[PDF]`
- [ ] Documentos: Despiece aparece con `[Imprimir A4]` + `[PDF]`
- [ ] Etiquetas PDF tienen el tamaño de etiqueta correcto
- [ ] "Marcar en producción" registra `sentToProductionBy` + `sentToProductionAt` con hora exacta
- [ ] "Marcar en producción" sube el número de `revision`
- [ ] Landing muestra el ingeniero asignado, fecha inicio y fecha de generación
- [ ] ProductionOrderHub sigue funcionando para los tabs que quedan
- [ ] Tests pass

---

## Phase 2b: Dashboard de Ventas

**Priority:** ALTA  
**Effort:** 1 week  
**Depends on:** Nothing (can run in parallel with 2a)

### Goal

Create a dedicated sales dashboard for vendedor and gerente_ventas roles.

### Tasks

| # | Task | Files | Notes |
|---|------|-------|-------|
| 2b.1 | Create `SalesDashboard.tsx` | Nuevo | Summary cards + pipeline + list |
| 2b.2 | Add sales summary logic | `productionHelpers.ts` or nuevo | Aggregate by status |
| 2b.3 | Add pipeline visualization | Nuevo | Horizontal bar |
| 2b.4 | Add alerts section | Nuevo | Old quotes, slow projects |
| 2b.5 | Update nav shell | `AppShell.tsx` | Add "Dashboard Ventas" |
| 2b.6 | Add RBAC functions | `rbac.ts` | `roleCanAccessSalesDashboard` |
| 2b.7 | Add tests | Nuevo | `SalesDashboard.test.tsx` |

### Files affected

- `packages/ui/src/sales/SalesDashboard.tsx` — nuevo
- `packages/ui/src/sales/sales.css` — nuevo
- `packages/ui/src/sales/SalesDashboard.test.tsx` — nuevo
- `packages/ui/src/shell/AppShell.tsx` — nav item
- `packages/domain/src/rbac.ts` — RBAC

### Verification

- [ ] Summary cards show correct counts and values
- [ ] Pipeline bar renders
- [ ] Project list shows correct projects per role
- [ ] Vendedor sees only own projects
- [ ] Gerente sees all projects
- [ ] Alerts show correctly
- [ ] Tests pass

---

## Phase 3: Compras/Almacén

**Priority:** MEDIA  
**Effort:** 2-3 weeks  
**Depends on:** Phase 1 (uses same material sector model)

### Goal

Create a dedicated workspace for warehouse operators to manage materials.

### Tasks

| # | Task | Files | Notes |
|---|------|-------|-------|
| 3.1 | Create `PurchasingScreen.tsx` | Nuevo | Tabbed workspace |
| 3.2 | Move Herrajes tab | `ProductionOrderHardwarePanel.tsx` | Adapt for stock view |
| 3.3 | Create Tableros tab | Nuevo | Board stock management |
| 3.4 | Create Cintillas tab | Nuevo | Edge banding stock |
| 3.5 | Add stock domain model | `packages/domain` | Stock types + helpers |
| 3.6 | Update nav shell | `AppShell.tsx` | Add "Compras / Almacén" |
| 3.7 | Add RBAC functions | `rbac.ts` | `roleCanAccessPurchasingNav` |
| 3.8 | Add tests | Nuevo | `PurchasingScreen.test.tsx` |

### Files affected

- `packages/ui/src/purchasing/PurchasingScreen.tsx` — nuevo
- `packages/ui/src/purchasing/purchasing.css` — nuevo
- `packages/ui/src/purchasing/PurchasingScreen.test.tsx` — nuevo
- `packages/domain/src/purchasing.ts` — nuevo (stock types)
- `packages/ui/src/shell/AppShell.tsx` — nav item
- `packages/domain/src/rbac.ts` — RBAC

### Verification

- [ ] Herrajes tab shows hardware list from project
- [ ] Tableros tab shows board needs
- [ ] Cintillas tab shows edge banding needs
- [ ] Dispatch button works
- [ ] Almacén role sees only assigned material types
- [ ] Tests pass

---

## Phase 4: Dashboards refinados

**Priority:** BAJA  
**Effort:** 1-2 weeks  
**Depends on:** Phases 2a, 2b, 3

### Goal

Polish dashboards, add metrics to Fábrica, ensure admin can see everything.

### Tasks

| # | Task | Files | Notes |
|---|------|-------|-------|
| 4.1 | Add metrics toggle to Fábrica | `FabricScreen.tsx` | Gerente/admin only |
| 4.2 | Refine Sales Dashboard | `SalesDashboard.tsx` | Add charts |
| 4.3 | Refine Engineering screen | `EngineeringScreen.tsx` | Polish UX |
| 4.4 | Admin cross-dashboard view | `AppShell.tsx` | Admin sees all nav items |
| 4.5 | Clean up old ProductionOrderHub | `ProductionOrderHub.tsx` | Remove if fully replaced |

---

## Phase 5: Polish y optimización

**Priority:** BAJA  
**Effort:** 1 week  
**Depends on:** Phase 4

### Goal

Final polish, performance optimization, accessibility.

### Tasks

| # | Task | Files | Notes |
|---|------|-------|-------|
| 5.1 | Responsive design | All new screens | Mobile-first |
| 5.2 | Keyboard navigation | All new screens | Tab/arrow keys |
| 5.3 | Loading states | All new screens | Skeleton loaders |
| 5.4 | Error boundaries | All new screens | Graceful fallbacks |
| 5.5 | Performance | All new screens | Memo, lazy loading |

---

## Dependency graph

```
Phase 1 (Fábrica)
├── Phase 2a (Ingeniería)
│   └── Phase 4 (Dashboards)
│       └── Phase 5 (Polish)
├── Phase 2b (Dashboard Ventas) ← parallel with 2a
│   └── Phase 4
└── Phase 3 (Compras/Almacén)
    └── Phase 4
```

---

## Risk assessment

| Phase | Risk | Mitigation |
|-------|------|------------|
| 1 | Breaking existing Mi Estación | Start from working code, rename only |
| 2a | Moving too many panels at once | Move one tab at a time, test each |
| 2b | New screen with no existing code | Use existing project data helpers |
| 3 | Stock model doesn't exist yet | Start with derived data, add real stock later |
| 4 | Scope creep | Stick to polish, no new features |
| 5 | Perfectionism | Time-box to 1 week |

---

## Success criteria

After all phases:

1. ✅ Each role has a dedicated, focused screen
2. ✅ No screen mixes concerns (engineering + production + warehouse)
3. ✅ Engineering generates docs, Factory uses them
4. ✅ Almacén has its own workspace for materials
5. ✅ Sales has its own dashboard
6. ✅ Admin can see everything
7. ✅ Navigation is clear and role-appropriate
8. ✅ All existing functionality is preserved
9. ✅ Tests pass
10. ✅ No regressions in existing features
