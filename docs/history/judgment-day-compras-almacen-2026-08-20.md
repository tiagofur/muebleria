# Judgment Day — COMPRAS / ALMACÉN

**Fecha:** 2026-08-20
**Scope:** Compras/Almacén completo: pantallas (`PurchasingScreen`, `StockPanel`, `PurchaseOrdersPanel`, `WarehouseDashboard`), `purchasingStore`, `usePurchasingDerivations`, dominio (`purchasing.ts`, `stock.ts`, `purchasingOrders.ts`), persistencia TS (localStorage repo + API repo + mappers), backend Go (picking, stock, suppliers, POs — handlers, storage, migraciones 000054–000057), seeds y tests.
**Método:** 3 exploraciones exhaustivas en paralelo (UI/store, dominio+persistencia TS, backend Go) + verificación manual de los 3 hallazgos más graves contra el código.
**Features registradas al cierre:** F122 (bugfixes críticos de inventario), F123 (hardening + tests).

---

## 0. Resumen ejecutivo / Veredicto

Las pantallas están bien construidas y los flujos de lectura son sólidos; el backend tiene buena disciplina transaccional (FOR UPDATE, una tx por movimiento, receive atómico con lock de PO). Pero **el camino de escritura que mueve inventario real tiene 3 bugs críticos confirmados**:

1. **Doble reintegro al desmarcar picking** — el filtro `!m.revertsId` no distingue despachos ya revertidos: marcar→desmarcar→marcar→desmarcar **acredita dos veces el mismo despacho** (stock inflado, silencioso, persistido). El server no ayuda: sin unique en `reverts_id`, sin check de ya-revertido, y **monto del revert sin validar contra el original**.
2. **Colisión de números de OC** — `OC-` + slice de 6 chars del id cliente (`po-XXXXXXXX`) = **4096 números posibles** con UNIQUE en Postgres → 500s crudos pasados ~75 pedidos; duplicados silenciosos en guest.
3. **Recepción de OC inyecta inventario libre** — `receivePurchaseOrder` acredita entradas de stock por **cualquier línea enviada sin validar que pertenezca a la OC** (Go itera `lines` directo), sin tope de over-receive, y el modal sin `max`.

Además: ventana de 200 movimientos que pierde despachos viejos al desmarcar, carrera sin serialización en `togglePick`, débitos de herrajes por cantidad redondeada a paquete (no consumo neto), validación de signos ausente en TS (entrada negativa en guest), persistencia guest no-atómica con quota tragada, y **cero tests del `purchasingStore`** (donde vive toda la orquestación con bugs).

**Recomendación:** F122 antes que nada — el doble reintegro y la recepción libre corrompen saldos de inventario silenciosamente.

---

## 1. Mapa del área

| Pieza | Archivo | Líneas | Rol |
|---|---|---|---|
| PurchasingScreen | `packages/ui/src/purchasing/PurchasingScreen.tsx` | 792 | Landing Almacén: tabs herrajes/tableros/cintillas/compras, cards de picking |
| StockPanel + MovementModal | `StockPanel.tsx` / `StockMovementModal.tsx` | 399 / 219 | Saldos, mínimos, movimientos manuales |
| PurchaseOrdersPanel | `PurchaseOrdersPanel.tsx` | 963 | OCs (borrador→emitida→recibida/cancelada) + proveedores |
| WarehouseDashboard | `WarehouseDashboard.tsx` | 430 | KPIs, salud de stock, alertas, tabla de obras |
| purchasingStore | `apps/web/src/stores/purchasingStore.ts` | 478 | Picking/stock/suppliers/POs + togglePick (débito/revert) |
| usePurchasingDerivations | `apps/web/src/derivations/…` | ~190 | Listas de picking, agregados warehouse, líneas de débito |
| Dominio | `purchasing.ts`, `stock.ts`, `purchasingOrders.ts` | — | Entidades + math del ledger |
| Persistencia guest | `localStorageWorkspaceRepository.ts` (6 keys) | — | Todo Compras en localStorage |
| API repo + mappers | `apiWorkspaceRepository.ts` / `apiMappers.ts` | — | REST ↔ Go |
| Backend | `api/{projectPicking,stock,suppliers,purchaseOrders}.go`, `storage/{stock,purchaseOrders,projectPicking}.go`, migraciones 000054–57 | — | Postgres |

Flujo: repos → `purchasingStore` → selectors en AppContent → props a screens. El débito de despacho es **orquestado por el cliente** en N requests secuenciales + PUT de picking.

---

## 2. Bugs CRÍTICOS (verificados personalmente)

### C1 — Doble reintegro al desmarcar (stock inflado)
`purchasingStore.ts:403-410`: al desmarcar, escanea movimientos y filtra `type==='despacho' && projectId && !m.revertsId`. Un revert es una fila NUEVA con `revertsId` apuntando al original — **el original nunca se marca como revertido**. Secuencia marcar→desmarcar→marcar→desmarcar: el segundo desmarcado encuentra D1 (ya revertido) y D2 → acredita ambos → **stock inflado por un despacho completo**. Confirmado además:
- Go: sin unique index en `reverts_id` (migración 000056), sin check de ya-revertido (`api/stock.go:158-174`), y **el monto del revert no se valida contra el |delta| original** (`:175-177` solo voltea el signo — revertir un despacho de 4 con quantity 1000 acredita 1000).
- Guest: sin validación alguna del revert (`localStorageWorkspaceRepository.ts:466-478`).
- El tipo tampoco se fuerza: `{type:'entrada', revertsId}` registra una "entrada" con delta negativo.

### C2 — Números de OC colisionan (500 en server, duplicados en guest)
`poNumber(id) = 'OC-' + id.slice(0,6).toUpperCase()` duplicado verbatim en `localStorageWorkspaceRepository.ts:577-580` y `api/purchaseOrders.go:33-39`. Los ids cliente son `po-` + 8 hex (`purchasingStore.ts:118-122`) → número = `OC-PO-` + **3 hex (4096 valores)**. Con `number UNIQUE` en Postgres (migración 000057) → colisión = 23505 → **500 crudo** (el helper `isDuplicateKey` existe pero no se usa acá). En guest: duplicados silenciosos. El número es la clave humana y el link del ledger (`note` de las entradas).

### C3 — Recepción de OC acredita líneas que no están en la OC
`storage/purchaseOrders.go:289-311` (verificado): itera `lines` directo para las entradas de stock — una línea de cualquier material acredita inventario con note "OC-XXXXXX" sin tocar `received_quantity` de la OC. **Inyección de inventario libre vía POST.** Además:
- Sin tope de over-receive: `received = prev + byQty` sin cap (`:273`); el modal del UI no tiene `max` (`PurchaseOrdersPanel.tsx:827-840`) — el dominio cuenta `>=` como completa.
- Guest igual: `localStorageWorkspaceRepository.ts:761-779` + sin validación de cantidad negativa.
- Guest no-atómico: entradas primero, PO después, con quota tragada (`catch { // ignore }`) → media recepción y reintento duplica el crédito.

---

## 3. Bugs ALTOS

| # | Hallazgo | Dónde |
|---|---|---|
| A1 | **Ventana de 200 movimientos al desmarcar**: server ordena `at DESC` y capa 200 (`api/stock.go:249-251`) — un despacho más viejo que los últimos 200 del kind **nunca se revierte** (débito fantasma permanente) | `purchasingStore.ts:404` |
| A2 | **togglePick sin serialización**: dos toggles rápidos → el scan del revert no ve débitos in-flight (nunca re-acreditados) y los PUT de picking pisan el estado final | `purchasingStore.ts:360-428` |
| A3 | **Débitos de herrajes por cantidad redondeada a paquete** (purchaseQuantity, no consumo neto): needing 5m de barras de 4m debita 8m — sistemáticamente sobre-debita vs físico | `usePurchasingDerivations.ts:160-167` |
| A4 | **Tableros solo debitan si hay sheetEstimates** — si `estimateBoardSheets` falló (tragado) o el tablero no tiene tamaño de plancha, se marca despachado **sin debitar nada** mientras los chips mostraban stock trackeado | `usePurchasingDerivations.ts:169-177`, `:83-89` |
| A5 | **Validación de signos ausente en TS**: `stockMovementDelta` no rechaza q≤0 (Go sí) → guest registra "entrada" negativa que resta stock; modal solo chequea `qty===0` | `stock.ts:101-108`, `StockMovementModal.tsx:76-83` |
| A6 | **UpdatePurchaseOrder race (Go)**: UPDATE…WHERE status='borrador' sin rows-affected; un emit concurrente entre pre-check y tx → header no-op pero los items se borran y re-insertan (**items de una OC emitida reescritos**) | `storage/purchaseOrders.go:167-188` |
| A7 | **Despachos huérfanos**: proyecto que sale del stage almacén (Material completo/cancel/reopen) desaparece de las listas → el despacho pendiente **no puede revertirse desde la UI nunca más**; el server no valida stage en el upsert | `usePurchasingDerivations.ts:61-98`, `projectPicking.go:83-87` |
| A8 | **Cancel tras recepción parcial** deja el stock acreditado sin reversión y el UI muestra "quedan X" en canceladas | `storage/purchaseOrders.go:214-232`, `PurchaseOrdersPanel.tsx:414-446` |
| A9 | **loadAll**: (a) fallo de lectura → conserva arrays del workspace ANTERIOR; (b) early-return si el repo no tiene los TRES lectores (repos parciales cargan nada); (c) 401 en bulk → almacén vacío en vez de logout | `purchasingStore.ts:142-180` |
| A10 | **Confusión de unidades herrajes**: StockPanel muestra siempre "pieza" (`stockUnitLabel(kind)`), chips muestran pieza/juego/metro, y el modal de recepción no muestra unidad — misma fila "5 piezas" vs "5 metros" | `StockPanel.tsx:261`, `PurchaseOrdersPanel.tsx:429-435` |
| A11 | **Errores duplicados → 500**: el detector de conflictos TS espera 409/400 con mensajes que los handlers de compras nunca emiten; emit/cancel bajo carrera → 500 | `apiWorkspaceRepository.ts:1756-1762`, `api/purchaseOrders.go:214-247` |
| A12 | **Proyecto inalcanzable "todo despachado"** sin lista de un material (sin cintillas) → sin botón para ese material, dashboard lo muestra pendiente para siempre | `PurchasingScreen.tsx:400-402`, `purchasing.ts:147` |

## 4. MEDIOS

- `stock_movements.project_id ON DELETE SET NULL` → borrar proyecto rompe el heuristic de revert por projectId.
- Sin `CHECK (quantity >= 0)` en `material_stock`; sin unique `reverts_id`; sin CHECK de `material` en picking (y el mapper coerciona unknown→'herrajes' silenciosamente).
- Movimientos limitados a 50 en el store → columna "Último" puede mostrar movimiento viejo.
- Input de mínimo uncontrolled (`defaultValue`) → muestra valores no persistidos tras fallo.
- Mappers coercionan silenciosamente: type unknown→'despacho', status unknown→'borrador', línea de OC con materialId vacío se DROPEA (la OC "pierde" líneas sin error).
- `markedBy` = nombre display (no email como documenta el tipo); guest no estampa `markedBy`.
- Dashboard: "Días" = días desde CREACIÓN (no desde ingreso a almacén); "Agotado (0)" hardcodeado con quantity negativa; `hardwareCount` suma unidades mezcladas (por suerte no se renderiza).
- CSS: `status-badge--bajo/agotado/neutral` no existen → badges sin estilo (querían --warning/--danger).
- "Ver picking" del dashboard navega al listado genérico ignorando el proyecto.
- RBAC UI inconsistente: `handleRecordStockMovement`/`handleUpsertStockMin` sin guard de rol en el shell (solo botones ocultos + server); PurchasingScreen reimplementa `roleCanMarkPicking` a mano.
- Muertos: stats `hardwareLines/areaM2/edgeMl` computados sin render, imports sin uso, `TITLES.despacho` muerto, doc comment "Not persisted yet" mintiendo (fase 3 los persiste).

## 5. Cobertura de tests

- Buena: handlers Go (RBAC, transiciones, reversión rechaza no-despacho), dominio PO lifecycle, localStorage stock/PO happy paths + un revert, screens (render/interacción).
- **Crítico sin tests**: `purchasingStore.togglePick` (donde viven C1/A1/A2/A4 — no existe `purchasingStore.test.ts`), `stockDebitLinesFor` (A3/A4), doble-revert en cualquier capa, over-receive/foreign-lines, cancel-tras-parcial, quota guest, mappers de compras (cero tests directos), y **cero tests de storage Go contra Postgres real** (todo es stub — las garantías de FOR UPDATE/tx nunca se ejecutan).

---

## 6. Plan de acción

### F122 — `purchasing_critical_bugfixes` (primero, es inventario real)
1. **C1 doble-revert**: (a) dominio: helper `activeDespachosFor(projectId, material, moves)` que excluya despachos que ya tienen revert (set de `revertsId`s); (b) Go: validación de ya-revertido + monto == |delta original| + type forzado a despacho en reverts + unique index parcial en `reverts_id` (migración aditiva); (c) guest: mismas validaciones.
2. **C2 números**: Go genera número server-side con secuencia (`OC-0001`, tabla contador o `to_char(nextval)`) — el cliente deja de mandarlo; guest usa contador persistido en su key. Mapear 23505→409.
3. **C3 recepción**: validar membresía de líneas contra items de la OC + cap a remaining (Go y guest); rechazar quantity≤0; modal con `max` por línea.
4. A1: revert scan con paginación hasta agotar (o endpoint `GET /stock/movements?projectId=`); A2: mutex simple en togglePick (in-flight guard por pickingKey); A5: `stockMovementDelta` validación paridad Go + modal min.
5. A9: loadAll — no conservar arrays de sesión anterior, soportar repos parciales, 401→markSessionExpired.

### F123 — `purchasing_hardening_tests`
1. Tests del `purchasingStore.togglePick` (doble-revert, ventana, carrera, fallo parcial del débito) + `stockDebitLinesFor`.
2. Tests Go de storage contra Postgres (revert idempotencia, receive membresía/cap, update race) — seguir el patrón de integración existente.
3. A6 (rows-affected en UpdatePO), A7 (guard de stage o purga de picking al salir de almacén), A8 (copy/estado de canceladas con recepción), A10 (unidades), muertos + CSS badges.
4. Decisión de producto: débito por paquete vs neto (A3) — documentar o cambiar.

---

## 7. Registro

- **F122** `purchasing_critical_bugfixes` — pending, prioridad máxima.
- **F123** `purchasing_hardening_tests` — pending, después de F122.
- Próximos JD sugeridos: Cotizaciones/Proyectos, Producción, Proyectar 3D.
