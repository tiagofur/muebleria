# Compras/Almacén — Gestión de materiales

**Fase:** 4 | **Prioridad:** MEDIA | **Esfuerzo:** 2-3 semanas

---

## 0. Purpose

Dedicated workspace for warehouse operators to manage material stock, pick items for production orders, and (future) handle purchasing. Separates material management from the production floor.

---

## 1. Who sees it

| Role | Access | Scope |
|------|--------|-------|
| admin | ✅ full | All materials |
| gerente_produccion | 👁 read-only | All materials |
| almacen | ✅ own materials | Only assigned material types |
| ingeniero | ❌ | — |
| gerente_ventas | ❌ | — |
| vendedor | ❌ | — |
| produccion | ❌ | — |

---

## 2. Screen structure

```
┌─────────────────────────────────────────────────────────────┐
│  COMPRAS / ALMACÉN                                          │
├─────────────────────────────────────────────────────────────┤
│  [Herrajes] [Tableros] [Cintillas] [Compras] (futuro)      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  TAB ACTIVO: Herrajes                                      │
│                                                             │
│  Necesario para obras activas:                              │
│  ┌─────────────────────────────────────────────────┐    │
│  │ Cocina López                                       │    │
│  │   · 12 bisagras 35mm                               │    │
│  │   · 6 tiradores 128mm                              │    │
│  │   · 36 tornillos 4x40mm                           │    │
│  │   [▶ Marcar despachado]                            │    │
│  ├─────────────────────────────────────────────────┤    │
│  │ Placard Martínez                                   │    │
│  │   · 6 tiradores 128mm                              │    │
│  │   [▶ Marcar despachado]                            │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Tabs

### Tab: Herrajes

**Purpose:** Lista de picking de herrajes por proyecto activo. El almacén ve qué necesita cada proyecto y marca cuando lo despachó. **Sin gestión de stock** — solo listas de necesidades.

**Content:**
- Lista de herrajes necesarios por proyecto (de `generateHardwareList()`), agrupada por proyecto
- Botón "Marcar despachado" por proyecto
- No hay sección de stock actual (se agrega en fase futura)

**Data source:** Reuses `generateHardwareList()` from domain, `HardwarePurchaseRow[]`.

**Conexión con Ingeniería:** La lista de herrajes la genera Ingeniería (tab Documentos). Almacén la recibe ya calculada y solo hace el picking.

---

### Tab: Tableros

**Purpose:** Lista de tableros necesarios por proyecto activo. La cantidad se muestra en **planchas** (no m²), tal como resultó de la optimización de corte en Ingeniería.

**Content:**
- Tableros necesarios por proyecto: tipo, grosor, cantidad en planchas
- Botón "Marcar despachado" por proyecto
- No hay stock actual (fase futura)

**Data source:** Reuses `summarizeProductionTotals()` from domain — quantity expressed in full sheets, not m².

---

### Tab: Cintillas

**Purpose:** Lista de cintillas/cantos necesarios por proyecto activo, en metros lineales.

**Content:**
- Cintillas necesarias por proyecto: tipo, grosor, largo en ml
- Botón "Marcar despachado" por proyecto
- No hay stock actual (fase futura)

**Data source:** Reuses `summarizeProductionTotals()` from domain.

---

### Tab: Compras (future)

**Purpose:** Purchase orders, suppliers, receiving.

**Content:**
- Purchase order list (new domain model)
- Supplier directory (new domain model)
- Receiving workflow (new)

**Status:** Not implemented yet. Placeholder tab.

---

## 4. Key design decisions

### 4.1 La lista de herrajes viene de Ingeniería

El almacén no genera la lista de herrajes — la recibe de Ingeniería. El flujo es:

1. Ingeniero diseña proyecto → genera lista de herrajes en tab Documentos
2. Lista queda guardada en el proyecto
3. Almacén abre Compras/Almacén → tab Herrajes → ve qué necesita cada proyecto
4. Almacén hace picking → marca despachado por proyecto
5. Material llega al piso de producción

### 4.2 Tableros en planchas, no en m²

La cantidad de tableros que necesita cada proyecto se muestra en **planchas completas**, resultado de la optimización de corte. El almacén trabaja con planchas físicas, no con áreas.

### 4.3 Sin stock — solo listados (MVP)

En el MVP, el sistema muestra **qué necesita cada proyecto** pero no lleva inventario real. El operador de almacén sabe qué pedir o buscar porque la lista viene del diseño. La gestión de stock (entrada/salida, saldos, alertas de mínimos) es una fase futura que se integrará cuando el flujo base esté funcionando.

### 4.4 Materiales como sectores de primera clase

Los 3 tipos de material (herrajes, tableros, cintillas) son valores `ProductionSector` de primera clase. Esta pantalla es la interfaz principal del rol `almacen`.

---

## 5. Navigation

- **Nav item:** "Compras / Almacén" — new top-level section
- **Icon:** `Warehouse` (lucide)
- **Visible when:** `roleCanAccessPurchasingNav(role)` returns true (admin, gerente_produccion read-only, almacen)
- **Sub-items:** Herrajes, Tableros, Cintillas (tabs within the screen)

---

## 6. Future enhancements

- Real inventory tracking (stock in/out)
- Purchase order workflow
- Supplier management
- Barcode/QR scanning for receiving
- Low stock alerts
- Integration with accounting
