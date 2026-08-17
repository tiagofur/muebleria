# Fábrica — Cola de trabajo por estación

**Fase:** 1 | **Prioridad:** URGENTE | **Esfuerzo:** 1-2 semanas

---

## 0. Purpose

The operator's primary work screen. Shows items waiting at each production station, organized by sector. Operators advance items through the pipeline; supervisors see all sectors and can reassign.

Replaces "Mi Estación" (`StationQueueScreen`) and incorporates the floor-level tabs from ProductionOrderHub (Piso, Control de Carga, Etiquetas).

---

## 1. Who sees it

| Role | Access | Scope |
|------|--------|-------|
| admin | ✅ full | All sectors, all items |
| gerente_produccion | ✅ full | All sectors, all items |
| produccion | ✅ own sectors | Only assigned sectors |
| almacen | ❌ | Uses Compras/Almacén instead |
| ingeniero | 👁 read-only | All sectors |
| gerente_ventas | 👁 read-only | All sectors |
| vendedor | ❌ | — |

---

## 2. Screen structure

```
┌─────────────────────────────────────────────────────────────┐
│  FÁBRICA                                  32 items en cola  │
├─────────────────────────────────────────────────────────────┤
│  [Corte] [Encintado] [CNC] [Armado] [Embalaje]             │
│  [Despacho] [Instalación]                                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  TAB ACTIVO: Corte (8 items)                                │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Cocina López · Juan P. · 12 muebles · Pendiente    │    │
│  │ [▶ Marcar Cortado]                                  │    │
│  ├─────────────────────────────────────────────────────┤    │
│  │ Placard Martínez · María G. · 6 muebles · Pendiente│    │
│  │ [▶ Marcar Cortado]                                  │    │
│  ├─────────────────────────────────────────────────────┤    │
│  │ Cocina Ana · Ana R. · 8 muebles · Pendiente        │    │
│  │ [▶ Marcar Cortado]                                  │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  Toggle (gerente/admin): [Cola] [Métricas]                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Tabs — Production sectors

| Tab | Sector | Items shown | Action button | Target status |
|-----|--------|-------------|---------------|---------------|
| **Corte** | `cutting` | `pending` items | Marcar Cortado | `cut` |
| **Encintado** | `edge_banding` | `cut` items | Marcar Encintado | `edged` |
| **CNC** | `cnc` | `edged` items (Fase 3) | Marcar Mecanizado | `machined` (future) |
| **Armado** | `assembly` | `edged` items | Marcar Armado | `assembled` |
| **Embalaje** | `packaging` | `assembled` items | Marcar Embalado | `packaged` |
| **Despacho** | `shipping` | `packaged` items | Marcar Cargado | `loaded` |
| **Instalación** | `installation` | `loaded` items | Marcar Instalado | `installed` |

---

## 4. Tabs detail

### Tab: Corte (and all production tabs)

**Each production tab shows:**

```
┌─────────────────────────────────────────────────────────┐
│  Corte (8 items esperando)                              │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │ Proyecto: Cocina López                          │    │
│  │ Cliente: Juan Pérez                             │    │
│  │ Módulo: MDF-15-BASE · 4 unidades               │    │
│  │ Estado actual: Pendiente                        │    │
│  │ [▶ Marcar Cortado]                              │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │ Proyecto: Placard Martínez                      │    │
│  │ Cliente: María González                         │    │
│  │ Módulo: MDF-18-ALTO · 2 unidades               │    │
│  │ Estado actual: Pendiente                        │    │
│  │ [▶ Marcar Cortado]                              │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  ... (6 more items)                                     │
└─────────────────────────────────────────────────────────┘
```

**Each row shows:**
- Project name
- Customer name
- Module ID + quantity
- Current floor status
- Action button (advance to next status)

**Action:**
- Click "Marcar Cortado" → `onAdvance(projectId, itemId, 'cut')`
- Server enforces station scoping (operator can only advance items in their assigned sectors)

---

### Tab: Despacho (shipping + dispatch control)

**Purpose:** Control de Carga — what's ready to ship, what's loaded, what's dispatched.

```
┌─────────────────────────────────────────────────────────┐
│  Despacho (5 items)                                     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Pendientes de carga:                                   │
│  ┌─────────────────────────────────────────────────┐    │
│  │ Cocina López · 12 módulos · Embalado            │    │
│  │ [▶ Marcar Cargado]                              │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  Cargados (listos para enviar):                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │ Placard Martínez · 6 módulos · Cargado          │    │
│  │ [▶ Ver detalle]                                 │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  ─────────────────────────────────────────────────────  │
│  Control de carga:                                      │
│  Total: 18 módulos · 42 piezas · Peso est: 850 kg      │
└─────────────────────────────────────────────────────────┘
```

**Additional content (from ProductionOrderDispatchPanel):**
- Summary: total modules, pieces, estimated weight
- Loaded items grouped by project
- Dispatch history

---

### Tab: Instalación

**Purpose:** Items ready for on-site installation.

```
┌─────────────────────────────────────────────────────────┐
│  Instalación (3 items)                                  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │ Cocina López · 12 módulos · Cargado             │    │
│  │ Dirección: Av. Siempre Viva 123                 │    │
│  │ [▶ Marcar Instalado]                            │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │ Placard Martínez · 6 módulos · Cargado          │    │
│  │ Dirección: Calle Falsa 456                      │    │
│  │ [▶ Marcar Instalado]                            │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

---

## 5. Visibility logic

### 5.1 Which tabs does each user see?

**produccion (with assigned sectors):**
- Only tabs for assigned sectors
- Example: assigned to `['cutting', 'edge_banding']` → sees Corte + Encintado tabs

**produccion (without assignments — legacy):**
- All production tabs (full access)

**gerente_produccion / admin:**
- All tabs
- Additionally sees: [Cola] [Métricas] toggle

**ingeniero / gerente_ventas (read-only):**
- All tabs
- No action buttons (read-only view)

### 5.2 Items per tab

Items are derived from `itemsWaitingForSector(project, sector)` for each project in the factory queue (`status === 'accepted' || status === 'produced'`).

---

## 6. Metrics toggle (gerente/admin only)

When toggled to "Métricas", the screen shows:

```
┌─────────────────────────────────────────────────────────┐
│  MÉTRICAS POR SECTOR                                    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Sector      │ Cola │ Activos │ Completados hoy │ Tiempo │
│  ────────────┼──────┼─────────┼─────────────────┼────────│
│  Corte       │  8   │    2    │       5         │ 45 min │
│  Encintado   │  5   │    1    │       3         │ 30 min │
│  Armado      │  3   │    3    │       2         │ 60 min │
│  Embalaje    │  2   │    1    │       4         │ 20 min │
│  Despacho    │  1   │    0    │       1         │  —     │
│  Instalación │  0   │    0    │       2         │  —     │
│                                                         │
│  Total: 19 items en cola · 7 operadores activos         │
│  Completados hoy: 17 · Tiempo promedio: 39 min          │
└─────────────────────────────────────────────────────────┘
```

**Data source:** Reuses `ProductionManagerDashboard` data structure (`SectorDashboard`).

---

## 7. Data requirements

```ts
type FabricScreenData = {
  sectors: PipelineSector[];
  rowsBySector: Map<PipelineSector, StationRow[]>;
  totalWaiting: number;
  // Metrics (gerente/admin only)
  metrics?: {
    sectors: SectorDashboard[];
    totalActiveOperators: number;
    todayCompleted: number;
    avgTimeMinutes: number;
  };
};

type StationRow = {
  projectId: string;
  projectName: string;
  customerLabel: string;
  itemId: string;
  moduleName: string;
  quantity: number;
  currentStatus: ItemFloorStatus;
};
```

**Existing data sources to reuse:**
- `itemsWaitingForSector()` — per-sector queue
- `PIPELINE_SECTORS` — sector list
- `PRODUCTION_SECTOR_LABELS_ES` — sector labels
- `ITEM_FLOOR_STATUS_LABELS_ES` — status labels
- `roleCanAdvanceStation()` — RBAC check

---

## 8. Navigation

- **Nav item:** "Fábrica" in the PRODUCCIÓN section
- **Icon:** `Factory` (lucide)
- **Visible when:** `roleCanAccessFabricNav(role)` returns true (admin, gerente_produccion, produccion, ingeniero read-only)
- **Replaces:** "Mi Estación" (remove from nav)

---

## 9. Implementation notes

### 9.1 Start from StationQueueScreen

`StationQueueScreen.tsx` already implements the core logic:
- Filter sectors by `assignedSectors`
- Compute `rowsBySector` from `itemsWaitingForSector`
- Render per-sector sections with advance buttons

**Changes needed:**
1. Rename to `FabricScreen`
2. Add tab navigation (currently all sectors are shown as sections, not tabs)
3. Add Despacho tab (move from `ProductionOrderDispatchPanel`)
4. Add Instalación tab
5. Add metrics toggle (move from `ProductionManagerDashboard`)
6. Update CSS from `station` to `fabric` class prefix

### 9.2 Remove from ProductionOrderHub

The following tabs move OUT of ProductionOrderHub to other screens:

| Tab | Moves to |
|-----|----------|
| piso | Fábrica (integrated into sector tabs) |
| despacho | Fábrica → Despacho tab |
| etiquetas | Ingeniería → Documentos (generation) + Fábrica (print reference) |
| herrajes | Compras/Almacén → Herrajes tab |
