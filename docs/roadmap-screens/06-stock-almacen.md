# Stock / Almacén — Inventario real por material

**Fase:** 3b (siguiente de Compras/Almacén) | **Prioridad:** ALTA | **Esfuerzo:** 2-3 semanas
**Depende de:** Fase 3 (picking persistido — `project_picking` ya guarda despachos)

---

## 0. Purpose

Llevar **inventario real por material** con entradas/salidas auditable, **alertas de
mínimos** y **recepción de compras**. Hoy el workspace muestra *qué necesita cada
proyecto* (picking) y guarda el estado de despacho; esta fase agrega el saldo real que
el picking descuenta.

El tab **Compras** (hoy placeholder "Próximamente") se convierte en el **panel de
stock**: saldos, mínimos, movimientos y recepción. Los tabs de picking (Herrajes /
Tableros / Cintillas) ganan contexto de stock (columna + chip por línea) y el despacho
**descuenta stock automáticamente**.

---

## 1. Who sees it

| Role | Access | Scope |
|------|--------|-------|
| admin | ✅ full (lee y escribe) | Todos los materiales |
| gerente_produccion | 👁 read-only | Todos los materiales (alerta si falta stock) |
| almacen | ✅ gestiona stock | Solo sus tipos de material asignados |
| ingeniero | ❌ | — |
| gerente_ventas / vendedor / produccion | ❌ | — |

**RBAC:** `roleCanManageStock(role)` = `admin | almacen` (escribe movimientos y mínimos).
Lectura = `roleCanAccessPurchasingNav(role)` (admin, gerente_produccion, almacen).

---

## 2. Modelo de datos

### 2.1 Dos tablas: saldo vivo + ledger inmutable

Mismo patrón que el piso de fábrica (`project_items.floor_status` saldo vivo +
`project_item_floor_events` ledger F092): el **saldo es derivado**, el ledger es la
verdad.

```sql
-- 000055_material_stock.up.sql — saldo vivo + mínimo por material de catálogo
CREATE TABLE IF NOT EXISTS material_stock (
    kind        TEXT NOT NULL CHECK (kind IN ('herrajes','tableros','cintillas')),
    material_id TEXT NOT NULL,          -- id del catálogo (hardware/material/edge)
    quantity    NUMERIC NOT NULL DEFAULT 0,
    min_stock   NUMERIC NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (kind, material_id)
);

-- 000056_stock_movements.up.sql — ledger inmutable (quién/cuándo/por qué)
CREATE TABLE IF NOT EXISTS stock_movements (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    kind          TEXT NOT NULL,
    material_id   TEXT NOT NULL,
    type          TEXT NOT NULL CHECK (type IN ('entrada','salida','ajuste','despacho')),
    delta         NUMERIC NOT NULL,     -- + entrada / − salida
    balance_after NUMERIC NOT NULL,     -- snapshot del saldo tras el movimiento
    project_id    UUID REFERENCES projects(id) ON DELETE SET NULL,  -- despacho → obra
    note          TEXT,
    reverts_id    UUID REFERENCES stock_movements(id) ON DELETE SET NULL,  -- reversiones auditables
    by_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    by_name       TEXT,
    at            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_material
    ON stock_movements(kind, material_id, at);
```

**Invariantes:**
- Insertar movimiento y actualizar `balance_after`/`quantity` en **una transacción**.
- `balance_after` = saldo anterior + `delta` (nunca confiar en un saldo cacheado).
- **Salida/despacho que deja saldo negativo → rechazada** (400 con detalle de cuánto
  falta). `ajuste` (físico) sí puede corregir a cero/positivo — es la vía de arreglo.

### 2.2 Unidades por tipo

| Kind | Unidad de stock | Fuente | Detalle |
|------|-----------------|--------|---------|
| herrajes | `unit` del catálogo (pieza/juego/metro) | `Hardware.unit` | coincide con las líneas de picking |
| tableros | **planchas** (entero) | `estimateBoardSheets()` | mismo criterio que el tab Tableros |
| cintillas | **metros lineales** (decimal) | suma ml | los rollos quedan como mejora futura |

---

## 3. Tipos de movimiento

| type | delta | Cuándo | Campos extra |
|------|-------|--------|--------------|
| `entrada` | + | **Recepción de compra** / stock-in manual | `note` (n° de orden, proveedor en texto libre en MVP) |
| `salida` | − | Consumo fuera de obra (desperdicio, préstamo, devolución a proveedor) | `note` |
| `ajuste` | ± | Corrección por conteo físico | `note` obligatorio |
| `despacho` | − | **Auto-descuento** al marcar una lista de picking despachada | `project_id` |
| `despacho` (reversión) | + | Al **desmarcar** un despacho | `reverts_id` → movimiento original |

**Despacho → salida automática (decisión clave 4.2):** al marcar "Despachado" en un
tab de picking, el sistema debita por línea:

- **Herrajes:** `hardwareId × purchaseQuantity` (en `Hardware.unit`).
- **Tableros:** `materialId × estimatedSheets` (planchas). Materiales sin estimación de
  planchas → se omiten (se anotan en el `note` del movimiento).
- **Cintillas:** ml por canto.

Solo afecta a materiales **con fila de stock** (materiales nunca cargados → el despacho
se comporta igual que hoy, backward compatible). Si algún material con stock **no
alcanza**, el despacho **se bloquea** con el detalle ("faltan 6 bisagras 35mm") → el
flujo natural es recibir más stock antes de despachar.

---

## 4. Screen structure

```
COMPRAS / ALMACÉN
[Herrajes] [Tableros] [Cintillas] [Compras]        ← badge de alertas en Compras
                                                    (n materiales bajo mínimo)

TAB COMPRAS (nuevo panel de stock):
┌──────────────────────────────────────────────────────────────┐
│ ⚠ 3 materiales bajo mínimo · 1 agotado        [Recibir stock]│
├──────────────────────────────────────────────────────────────┤
│ Filtro: [todos] [bajo mínimo] [agotado]  ·  búsqueda         │
│                                                              │
│ Material            Unidad   Stock   Mínimo   Estado   Último │
│ Bisagra cazoleta 35  pieza    38      50       ⚠ bajo    hoy  │
│ Tirador 128mm        pieza    6       10       ⚠ bajo    hoy  │
│ MDF 15mm             plancha  14      10       ✅ ok     ayer │
│ Canto mel 1mm        ml       320,5   500      ⚠ bajo    hoy  │
│                                  [Recibir] [Salida] [Ajustar] │
└──────────────────────────────────────────────────────────────┘

TABS DE PICKING (cambio): cada línea muestra stock actual + chip:
  · 12 bisagras 35mm   · stock 38  ✅   → despacho descuenta 12 → stock 26
  · 4 planchas MDF-15  · stock 14  ✅
  · 6 planchas MDF-18  · sin stock —   → despacha sin efecto stock
  · 36 tornillos       · stock 10  ⚠ bajo (faltan 26)
```

---

## 5. Flujos

### 5.1 Recepción de compras (entrada)

1. Tab Compras → botón **"Recibir stock"** (o acción por fila `[Recibir]`).
2. Modal: tipo de material → selector del catálogo (con búsqueda) → cantidad → nota
   (n° de orden/proveedor en texto libre, MVP).
3. `POST /api/stock/movements` `{kind, material_id, type:"entrada", quantity, note}`.
4. El servidor crea la fila de stock si no existe (upsert de saldo) y devuelve el
   movimiento con `balance_after`.

### 5.2 Salida manual y ajuste

- `[Salida]`: mismo modal con `type:"salida"` + nota. Rechazada si deja saldo negativo.
- `[Ajustar]`: `type:"ajuste"` con cantidad firmada y **nota obligatoria** (conteo
  físico). Puede llevar el saldo a 0 (nunca negativo).

### 5.3 Mínimos y alertas

- `min_stock` se edita por fila (`PUT /api/stock`). Estado **derivado**:
  `quantity == 0 → agotado` · `0 < quantity <= min → bajo` · `quantity > min → ok`.
- UI: banner en el tab Compras ("N materiales bajo mínimo · M agotados"), badge en el
  tab, y chip por línea en los tabs de picking. Sin emails/notificaciones en MVP.

### 5.4 Despacho con stock

- Al marcar **Despachado**, tras el estado local optimista (comportamiento actual) el
  shell llama `POST /api/stock/movements` con un `despacho` por material con stock.
  Si falla por insuficiencia, el despacho se revierte en UI y se muestra el faltante.
- Al **Desmarcar**, se registra la reversión (`reverts_id` → movimiento original).

---

## 6. Key design decisions

| # | Decisión | Por qué |
|---|----------|---------|
| 6.1 | **Ledger inmutable + saldo vivo** (2 tablas) | Mismo patrón probado del piso (F092); el saldo se puede reconstruir y auditar quién/cuándo/por qué |
| 6.2 | **Despacho auto-descuenta** solo materiales con fila de stock | El picking ya itemiza el catálogo exacto (`hardwareId`, `materialId`, canto); instalaciones sin stock siguen funcionando igual |
| 6.3 | **Salida negativa bloqueada**; `ajuste` como vía de corrección | El stock es físico; el ajuste documentado es el arreglo honesto |
| 6.4 | **Mínimos por material**, estados derivados | Sin tablas extra ni jobs; el estado sale de `quantity` vs `min_stock` |
| 6.5 | **Unidades del dominio**: planchas y ml | Coinciden con lo que muestra el picking; el operador no convierte nada |
| 6.6 | **Compras tab = panel de stock** | Reutiliza el placeholder; órdenes de compra/proveedores quedan como fase posterior |
| 6.7 | **Recepción crea la fila** si el material nunca fue cargado | No hay paso de "alta de stock" separado |

---

## 7. API + RBAC

| Método | Ruta | Permiso | Body / Query |
|--------|------|---------|--------------|
| GET | `/api/stock` | `RoleCanAccessPurchasingNav` | — → saldos + mínimo + estado derivado |
| PUT | `/api/stock` | `RoleCanManageStock` | `{kind, material_id, min_stock}` |
| POST | `/api/stock/movements` | `RoleCanManageStock` | `{kind, material_id, type, quantity, project_id?, note?}` → movimiento con `balance_after` |
| GET | `/api/stock/movements` | `RoleCanAccessPurchasingNav` | `?kind=&material_id=&limit=` → ledger |

`RoleCanManageStock(role)` (Go + TS, paridad): `admin | almacen`.

---

## 8. Storage port (`packages/storage`)

```ts
getStock?(): Promise<readonly MaterialStock[]>;
upsertStock?(stock: { kind: StockMaterialKind; materialId: string; minStock: number }): Promise<MaterialStock>;
recordStockMovement?(payload: {
  kind: StockMaterialKind;
  materialId: string;
  type: StockMovementType;
  quantity: number;              // absoluto; el signo lo decide el server
  projectId?: string;
  note?: string;
}): Promise<StockMovement>;
listStockMovements?(filter?: { kind?: StockMaterialKind; materialId?: string; limit?: number }): Promise<readonly StockMovement[]>;
```

- **API adapter:** los 4 endpoints de §7 (snake_case en wire, camelCase en dominio).
- **LocalStorage (guest):** claves `muebles_guest_stock` (saldo) y
  `muebles_guest_stock_movements` (ledger), misma mecánica que `muebles_guest_picking`.
- **Mapper:** `stockFromApi` / `stockMovementFromApi` en `apiMappers.ts`.

---

## 9. Dominio (`packages/domain/src/stock.ts` — nuevo)

```ts
export type StockMaterialKind = 'herrajes' | 'tableros' | 'cintillas';
export type StockMovementType = 'entrada' | 'salida' | 'ajuste' | 'despacho';
export type StockStatus = 'ok' | 'bajo' | 'agotado';

export type MaterialStock = {
  readonly kind: StockMaterialKind;
  readonly materialId: string;
  readonly quantity: number;
  readonly minStock: number;
  readonly updatedAt?: string;
};

export type StockMovement = {
  readonly id: string;
  readonly kind: StockMaterialKind;
  readonly materialId: string;
  readonly type: StockMovementType;
  readonly delta: number;
  readonly balanceAfter: number;
  readonly projectId?: string;
  readonly note?: string;
  readonly revertsId?: string;
  readonly byUserId: string;
  readonly byName?: string;
  readonly at: string;
};

// Helpers puros y testeables
export function stockStatus(quantity: number, minStock: number): StockStatus;
export function stockKindLabel(kind: StockMaterialKind): string;          // 'Herrajes' | 'Tableros' | 'Cintillas'
export function stockUnitLabel(kind: StockMaterialKind, hardwareUnit?: string): string; // pieza/juego/metro | plancha | ml
export function applyStockMovement(balance: number, delta: number): number;  // nunca negativa
```

---

## 10. UI (`packages/ui/src/purchasing/`)

| Archivo | Cambio |
|---------|--------|
| `StockPanel.tsx` (nuevo) | Tab Compras: banner de alertas, tabla con filtros/estados, acciones por fila |
| `StockMovementModal.tsx` (nuevo) | Modal único para recibir / salida / ajuste (tipo define el título y el signo) |
| `PurchasingScreen.tsx` | Tab Compras → `StockPanel`; columna de stock + chip en las 3 listas de picking; despacho llama al callback de stock |
| `purchasing.css` | Reusa prefijo `.purch-`; clases nuevas para tabla/estados (`.purch-stock-*`) |

Props nuevas de `PurchasingScreen`:
```ts
stock?: readonly MaterialStock[];                       // saldos para chips y despacho
onRecordStockMovement?: (mov: {...}) => Promise<void>;  // recepción/salida/ajuste
onUpsertStockMin?: (stock: { kind; materialId; minStock }) => Promise<void>;
```

---

## 11. Archivos afectados

**Go (`backend-go`)**
- `db/migration/000055_material_stock.{up,down}.sql`, `000056_stock_movements.{up,down}.sql`
- `internal/domain/stock.go` (nuevo: `MaterialStock`, `StockMovement`, helpers de signo/validación)
- `internal/domain/rbac.go` → `RoleCanManageStock`
- `internal/storage/stock.go` (nuevo: `ListStock`, `UpsertStockMin`, `RecordStockMovement` tx, `ListStockMovements`)
- `internal/api/store.go` → interface; `internal/api/stock.go` (nuevo: 4 handlers)
- `internal/api/routes.go` → rutas; `internal/api/handlers_test.go` → stubs; `stock_test.go` (nuevo)

**TS**
- `packages/domain/src/stock.ts` (nuevo) + export en `index.ts` + `rbac.ts` (`roleCanManageStock`) + tests
- `packages/storage/src/workspaceRepository.ts` (puerto) + `apiMappers.ts` + `apiWorkspaceRepository.ts` + `localStorageWorkspaceRepository.ts` + tests
- `packages/ui/src/purchasing/StockPanel.tsx`, `StockMovementModal.tsx` + `PurchasingScreen.tsx` + `purchasing.css` + tests
- `apps/web/src/App.tsx` (carga de stock, callbacks de persistencia)

---

## 12. Verification checklist

- [ ] Tab Compras muestra saldos con estado (ok/bajo/agotado) y último movimiento
- [ ] Banner de alertas lista materiales bajo mínimo y agotados
- [ ] `[Recibir]` crea fila si no existía y actualiza saldo (balance_after correcto)
- [ ] `[Salida]` rechaza saldo negativo con detalle del faltante
- [ ] `[Ajustar]` requiere nota y corrige el saldo
- [ ] Editar mínimo cambia el estado derivado sin tocar el saldo
- [ ] Despachar en Herrajes/Tableros/Cintillas descuenta stock por línea (solo materiales con fila)
- [ ] Despacho con stock insuficiente se bloquea mostrando cuánto falta
- [ ] Desmarcar revierte el descuento (movimiento con `reverts_id`)
- [ ] Material sin fila de stock se despacha sin efecto (backward compatible)
- [ ] gerente_produccion ve todo read-only; almacen solo sus tipos; admin todo
- [ ] Guest/local persiste en localStorage
- [ ] Tests Go + TS pasan · `pnpm typecheck` verde

---

## 13. Fuera de alcance (fases posteriores)

- Órdenes de compra + proveedores (modelo PO con estados) — hoy `note` en texto libre
- Código de barras / QR para recepción
- Rollos de cintilla con largo variable
- Múltiples depósitos / ubicaciones
- Costo en recepción e integración con contabilidad
- Emails/notificaciones de mínimos
