-- Fase 3c — Compras: directorio de proveedores + órdenes de compra con ítems.
-- La recepción de una PO registra entradas de stock (stock_movements) y avanza
-- received_quantity hasta marcar la orden como recibida.

CREATE TABLE IF NOT EXISTS suppliers (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    contact_name TEXT NOT NULL DEFAULT '',
    email        TEXT NOT NULL DEFAULT '',
    phone        TEXT NOT NULL DEFAULT '',
    notes        TEXT NOT NULL DEFAULT '',
    active       BOOLEAN NOT NULL DEFAULT true,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS purchase_orders (
    id          TEXT PRIMARY KEY,
    number      TEXT NOT NULL UNIQUE,
    supplier_id TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
    status      TEXT NOT NULL DEFAULT 'borrador'
                CHECK (status IN ('borrador','emitida','recibida','cancelada')),
    notes       TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    received_at TIMESTAMPTZ,
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier ON purchase_orders(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON purchase_orders(status);

CREATE TABLE IF NOT EXISTS purchase_order_items (
    po_id             TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    kind              TEXT NOT NULL CHECK (kind IN ('herrajes','tableros','cintillas')),
    material_id       TEXT NOT NULL,
    quantity          NUMERIC NOT NULL CHECK (quantity > 0),
    received_quantity NUMERIC NOT NULL DEFAULT 0,
    PRIMARY KEY (po_id, kind, material_id)
);
