# Sesión activa

**Feature:** F122 (`purchasing_critical_bugfixes`)
**Estado:** done
**Fecha:** 2026-08-20

## Objetivo

Implementar los bugfixes críticos de inventario Compras/Almacén surgidos del Judgment Day:
1. C1: Doble reintegro al desmarcar picking (`activeDespachosFor`, validación Go/Guest + índice único parcial en `reverts_id`).
2. C2: Números de OC secuenciales sin colisiones (secuencia Postgres `purchase_order_number_seq` `OC-0001+`, guest persistent counter).
3. C3: Recepción de OC con validación de membresía y cap a remaining (Go, guest y modal max).
4. A1 & A2: Serialización mutex de `togglePick` y soporte de `project_id` en query de movimientos.
5. A5: Validación de signos en delta de stock (TS/Go/Modal).
6. A9: `loadAll` sin mezclar datos de sesión anterior y detección de 401 para expirar sesión.

## Qué se hizo

1. **Dominio TypeScript (`packages/domain`)**:
   - `packages/domain/src/stock.ts`: `stockMovementDelta` valida `quantity > 0` (y `!== 0` para ajuste).
   - `packages/domain/src/purchasing.ts`: Implementado `activeDespachosFor(projectId, material, movements)`.
   - `packages/domain/src/stock.test.ts`: Tests unitarios de `stockMovementDelta` y `activeDespachosFor`.

2. **Backend Go (`backend-go`)**:
   - Migración `000062_stock_reverts_unique.up.sql` y `.down.sql`: Secuencia `purchase_order_number_seq` e índice único parcial en `stock_movements.reverts_id WHERE reverts_id IS NOT NULL`.
   - `storage/stock.go`: Implementado `GetStockMovementByRevertsID` y soporte de filtro `project_id` en `ListStockMovements`.
   - `api/stock.go`: Validación en reversiones (tipo `despacho`, monto idéntico a `|delta|`, no revertido previamente `409 Conflict`), query param `project_id`.
   - `storage/purchaseOrders.go`: Generación de números secuenciales (`OC-0001+`) y validación estricta de items en recepción (membresía y cap contra `remaining`).
   - `api/purchaseOrders.go`: Mapeo de errores de validación de recepción a `400 Bad Request`.
   - Tests en `stock_test.go` y `purchaseOrders_test.go` actualizados y pasando al 100%.

3. **Almacenamiento TypeScript (`packages/storage`)**:
   - `workspaceRepository.ts` & `apiWorkspaceRepository.ts`: Soporte de `projectId` en `listStockMovements`.
   - `localStorageWorkspaceRepository.ts`: Contador persistido `muebles_guest_po_counter`, validación estricta de reversión única y validación de items/remaining en recepción.
   - Tests en `localStorageStock.test.ts` y `localStoragePurchaseOrders.test.ts` actualizados y pasando.

4. **Frontend (`apps/web` y `packages/ui`)**:
   - `purchasingStore.ts`: Mutex in-flight (`inFlightPicks`) por `pickingKey`, `activeDespachosFor` con filtro `projectId` al desmarcar, limpieza de estado en `loadAll` y captura de 401.
   - `PurchaseOrdersPanel.tsx`: `max={remaining}` y validación contra negativos/excedentes en submit.
   - `StockMovementModal.tsx`: Validación de `quantity > 0`.

5. **Verificación**:
   - `go test ./...` verde.
   - `pnpm test` verde en todos los paquetes.
   - `pnpm typecheck` verde.
   - `./init.sh` completamente verde.
