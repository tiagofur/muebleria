-- F122: bugfixes críticos de inventario Compras/Almacén
-- 1. Secuencia de números de orden de compra (OC-0001, OC-0002...) sin colisiones.
-- 2. Índice único parcial en stock_movements.reverts_id para impedir que un mismo
--    despacho se revierta más de una vez (C1).

CREATE SEQUENCE IF NOT EXISTS purchase_order_number_seq START WITH 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_movements_reverts_id_unique
    ON stock_movements (reverts_id)
    WHERE reverts_id IS NOT NULL;
