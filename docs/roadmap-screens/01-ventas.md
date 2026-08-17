# Dashboard de Ventas

**Fase:** 2 | **Prioridad:** ALTA | **Esfuerzo:** 1 semana

---

## 0. Purpose

Provide sales roles (gerente_ventas, vendedor) with a dedicated view of the commercial pipeline: where each project stands, what's pending, and performance metrics. Admin can also see this dashboard.

---

## 1. Who sees it

| Role | Access | Scope |
|------|--------|-------|
| admin | ✅ full | All projects |
| gerente_ventas | ✅ full | All projects |
| vendedor | ✅ own portfolio | Only own customers |
| ingeniero | 👁 read-only | All projects |
| gerente_produccion | 👁 read-only | All projects |
| produccion | ❌ | — |
| almacen | ❌ | — |

---

## 2. Screen structure

```
┌─────────────────────────────────────────────────────────────┐
│  DASHBOARD VENTAS                        $1,250,000 total   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │Cotizaciones│ │ Aceptadas│ │En Fábrica│ │Instaladas│       │
│  │    12     │ │    8     │ │    5     │ │    3     │       │
│  │  $450K    │ │  $320K   │ │  $280K   │ │  $200K   │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
│                                                             │
│  Pipeline visual:                                           │
│  [Cotizando] ──→ [Aceptadas] ──→ [En fábrica] ──→ [Instaladas]│
│      12              8               5              3       │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  Mi cartera (vendedor: solo los suyos; gerente: todos)      │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Cocina López    · Juan P.  · $85,000  · Cotizada   │    │
│  │ Placard Martínez· María G. · $42,000  · Aceptada   │    │
│  │ Placard Ana     · Ana R.   · $38,000  · En fábrica │    │
│  │ ...                                                 │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│  Alertas:                                                   │
│  ⚠ 3 cotizaciones sin respuesta > 7 días                    │
│  ⚠ 1 obra con > 30 días en fábrica                          │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Sections

### 3.1 Summary cards (top)

Four metric cards showing project counts and total value by status:

| Card | Status filter | Shows |
|------|--------------|-------|
| Cotizaciones | `draft`, `quoted` | Count + sum of sale prices |
| Aceptadas | `accepted` | Count + sum of sale prices |
| En Fábrica | `produced` | Count + sum of sale prices |
| Instaladas | `installed` | Count + sum of sale prices |

**Data source:** `projectsForRole()` filtered by status, with `salePrice` aggregation.

### 3.2 Pipeline bar

Visual horizontal bar showing the flow of projects through stages. Each segment width proportional to count.

### 3.3 Project list (main table)

| Column | Description |
|--------|-------------|
| Nombre | Project name |
| Cliente | Customer label |
| Valor | Sale price |
| Estado | Status badge (cotizada/aceptada/en fábrica/instalada) |
| Última actualización | `updatedAt` |
| Acciones | Link to project detail (or production order if in factory) |

**For vendedor:** Only shows projects where `ownerUserId === currentUser.id`.  
**For gerente_ventas:** Shows all projects.

### 3.4 Alerts section

| Alert | Condition | Action |
|-------|-----------|--------|
| Cotizaciones viejas | `status === 'quoted'` and `updatedAt > 7 days ago` | Link to project |
| Obras con demora | `status === 'produced'` and `updatedAt > 30 days ago` | Link to production order |
| Instalaciones pendientes | `status === 'loaded'` (ready for install) | Link to production order |

---

## 4. Data requirements

```ts
type SalesDashboardData = {
  summary: {
    cotizaciones: { count: number; totalValue: number };
    aceptadas: { count: number; totalValue: number };
    enFabrica: { count: number; totalValue: number };
    instaladas: { count: number; totalValue: number };
  };
  projects: Array<{
    project: Project;
    customerLabel: string;
    salePrice: number | null;
  }>;
  alerts: Array<{
    type: 'old_quote' | 'slow_project' | 'pending_install';
    projectId: string;
    message: string;
  }>;
};
```

**Existing data sources to reuse:**
- `projectsForRole()` — already filters by role/ownership
- `projectStatusLabel()` — status badges
- `formatMoneyDisplay()` — currency formatting
- `formatIsoDate()` — date formatting

---

## 5. Navigation

- **Nav item:** "Dashboard Ventas" in the INICIO section
- **Icon:** `TrendingUp` (lucide)
- **Visible when:** `roleCanAccessSalesDashboard(role)` returns true

---

## 6. Future enhancements (Phase 5)

- Export to Excel/CSV
- Charts (pie chart by status, bar chart by month)
- Filter by date range
- Filter by customer
- Comparison: this month vs last month
